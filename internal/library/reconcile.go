package library

import (
	"cmp"
	"slices"
	"time"
)

// This file is the pure core of a scan: it compares what the database
// knows with what is on disk and decides what to change. No disk, no
// database, no clock: every case is a fast table test.
//
// A scan works in three steps:
//  1. compare: files whose path, size and modification time match a known
//     video are unchanged. Every other file must be identified.
//  2. the scanner reads the fingerprint of those files (only those, which
//     keeps a scan of an unchanged library very fast).
//  3. reconcile: fingerprints decide whether each file is new, a known video
//     that moved, a known video whose file changed, or a duplicate copy.

// location is where a file sits: a library and a path inside it, with "/".
type location struct {
	library int64
	path    string
}

// known is a video the database already has.
type known struct {
	id          int64
	fingerprint string
	loc         location // last place where it was seen
	size        int64
	modTime     int64 // Unix nanoseconds
	missing     bool  // not found by an earlier scan
}

// found is a video file seen on disk by this scan.
type found struct {
	loc     location
	size    int64
	modTime int64
}

// identified is a found file together with its fingerprint.
type identified struct {
	found
	fingerprint string
}

// updateKind says why an existing video changes.
type updateKind int

const (
	// touched: same place, same content, only size or date changed on disk.
	touched updateKind = iota + 1
	// replaced: same place, but the file now has different content.
	// It keeps its history: someone replaced the file with a new version.
	replaced
	// moved: same content found in a new place (renamed or moved file),
	// or a missing video that came back.
	moved
)

// update changes an existing video.
type update struct {
	id   int64
	kind updateKind
	file identified
	// wasMissing is true when the video had disappeared and is back.
	wasMissing bool
}

// changes is everything a scan decided.
type changes struct {
	unchanged  []int64      // known videos found exactly where they were
	updates    []update     // known videos to update
	added      []identified // new videos
	duplicates []identified // second copies of a video already in place
	gone       []int64      // present videos no longer found: mark them missing
}

// compare splits the found files into those already known and unchanged,
// and those that need a fingerprint. Only present videos are matched by
// path: a missing video comes back through its fingerprint.
func compare(knownVideos []known, files []found) (unchanged []int64, toIdentify []found) {
	byLoc := make(map[location]known, len(knownVideos))
	for _, k := range knownVideos {
		if !k.missing {
			byLoc[k.loc] = k
		}
	}
	for _, f := range files {
		k, ok := byLoc[f.loc]
		if ok && k.size == f.size && k.modTime == f.modTime {
			unchanged = append(unchanged, k.id)
			continue
		}
		toIdentify = append(toIdentify, f)
	}
	return unchanged, toIdentify
}

// reconcile decides what happens to each identified file and each known
// video. trusted reports whether a library was read completely: only in
// a trusted library can a video that was not found be marked missing.
func reconcile(knownVideos []known, unchanged []int64, files []identified, trusted func(library int64) bool) changes {
	ch := changes{unchanged: unchanged}

	// Process files in a fixed order so the result never depends on the
	// order the disk returned them.
	files = slices.Clone(files)
	slices.SortFunc(files, func(a, b identified) int {
		return cmp.Or(cmp.Compare(a.loc.library, b.loc.library), cmp.Compare(a.loc.path, b.loc.path))
	})

	byFingerprint := make(map[string]known, len(knownVideos))
	presentByLoc := make(map[location]known, len(knownVideos))
	for _, k := range knownVideos {
		byFingerprint[k.fingerprint] = k
		if !k.missing {
			presentByLoc[k.loc] = k
		}
	}

	// claimed holds the known videos that already have a file in this scan.
	claimed := make(map[int64]bool, len(knownVideos))
	for _, id := range unchanged {
		claimed[id] = true
	}

	// First pass: match by content. The content is what identifies a video,
	// so it wins over the path.
	var unmatched []identified
	for _, f := range files {
		k, ok := byFingerprint[f.fingerprint]
		switch {
		case !ok:
			unmatched = append(unmatched, f)
		case claimed[k.id]:
			ch.duplicates = append(ch.duplicates, f)
		default:
			claimed[k.id] = true
			kind := moved
			if !k.missing && k.loc == f.loc {
				kind = touched
			}
			ch.updates = append(ch.updates, update{id: k.id, kind: kind, file: f, wasMissing: k.missing})
		}
	}

	// Second pass: new content. If the place belonged to a video that has
	// not been found elsewhere, the file was replaced with a new version.
	// Two copies of the same new video count once.
	newFingerprints := make(map[string]bool, len(unmatched))
	for _, f := range unmatched {
		if newFingerprints[f.fingerprint] {
			ch.duplicates = append(ch.duplicates, f)
			continue
		}
		newFingerprints[f.fingerprint] = true
		k, ok := presentByLoc[f.loc]
		if ok && !claimed[k.id] {
			claimed[k.id] = true
			ch.updates = append(ch.updates, update{id: k.id, kind: replaced, file: f})
			continue
		}
		ch.added = append(ch.added, f)
	}

	// Present videos that were not found anywhere are gone, but only when
	// their library was read completely. Otherwise we doubt and wait.
	for _, k := range knownVideos {
		if !k.missing && !claimed[k.id] && trusted(k.loc.library) {
			ch.gone = append(ch.gone, k.id)
		}
	}
	return ch
}

// libraryTrusted decides whether a scan of one library is complete enough
// to mark videos as missing. An empty library that used to have videos is
// most likely a disk that is not mounted, not a user who deleted everything.
func libraryTrusted(readWithoutErrors bool, filesFound, videosKnown int) bool {
	if !readWithoutErrors {
		return false
	}
	return filesFound > 0 || videosKnown == 0
}

// settleTime is how long a file must stay untouched before FranzPLAY trusts
// it is complete. A film being copied into the folder changes at every scan.
const settleTime = 2 * time.Minute

// stillCopying reports whether a file that needs identifying looks like it
// is still being written, so the scan should leave it alone for now:
// it changed in the last settleTime, and it is either a known video's file
// being rewritten, or a new file that changed since the previous scan.
// A new file seen for the first time is taken at once: most files arrive
// whole, and people want to see them right away.
//
// now and the times are Unix nanoseconds. A date in the future (a wrong
// clock) never counts as recent, so such a file is never kept waiting.
func stillCopying(f found, before found, seenBefore, knownHere bool, now int64) bool {
	age := now - f.modTime
	if age < 0 || age >= int64(settleTime) {
		return false
	}
	return knownHere || (seenBefore && before != f)
}
