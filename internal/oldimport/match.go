package oldimport

import "strings"

// newVideo is a video of the new FranzPLAY's catalog.
type newVideo struct {
	id   int64
	path string // inside its video folder, with "/"
}

// videoMatch says which new video each old video is.
type videoMatch struct {
	byOld     map[int64]int64 // old id → new id
	missing   []oldVideo      // not found among the new videos
	ambiguous []oldVideo      // more than one new video fits equally well
}

// matchVideos finds the new video of each old one, by path.
//
// The old FranzPLAY knew a video only by its path inside its video folder
// ("Vacanze/Mare 2019.mp4"), and it had no fingerprint of the content. The
// new one has its own paths, inside the folders the administrator set,
// which may be the same folder, a folder above it or below it. So paths
// are compared from the end: the new video that shares the most parts
// with the old path, at least the file name, is the one. When two new
// videos share as many parts, nobody can tell which is right: the old
// video is reported, not guessed.
func matchVideos(old []oldVideo, current []newVideo) videoMatch {
	byName := map[string][]newVideo{}
	for _, v := range current {
		parts := split(v.path)
		if len(parts) == 0 {
			continue
		}
		name := parts[len(parts)-1]
		byName[name] = append(byName[name], v)
	}
	m := videoMatch{byOld: map[int64]int64{}}
	for _, o := range old {
		parts := split(o.path)
		if len(parts) == 0 {
			m.missing = append(m.missing, o)
			continue
		}
		best, bestScore, ties := int64(0), 0, 0
		for _, v := range byName[parts[len(parts)-1]] {
			score := commonTail(parts, split(v.path))
			switch {
			case score > bestScore:
				best, bestScore, ties = v.id, score, 1
			case score == bestScore:
				ties++
			}
		}
		switch {
		case bestScore == 0:
			m.missing = append(m.missing, o)
		case ties > 1:
			m.ambiguous = append(m.ambiguous, o)
		default:
			m.byOld[o.id] = best
		}
	}
	return m
}

// split cuts a path into its parts, ignoring slashes at the ends and
// doubled ones.
func split(path string) []string {
	var parts []string
	for _, p := range strings.Split(path, "/") {
		if p != "" && p != "." {
			parts = append(parts, p)
		}
	}
	return parts
}

// commonTail counts the parts two paths share, from the end.
func commonTail(a, b []string) int {
	n := 0
	for n < len(a) && n < len(b) && a[len(a)-1-n] == b[len(b)-1-n] {
		n++
	}
	return n
}
