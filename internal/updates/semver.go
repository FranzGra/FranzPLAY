package updates

import (
	"strconv"
	"strings"
)

// semver is a version like 1.4.2 or 1.5.0-rc.1. The build part after "+"
// is ignored, as the rules of semantic versioning say.
type semver struct {
	major, minor, patch int
	pre                 []string // empty for a normal release
}

// parseVersion reads "1.2.3" or "v1.2.3". ok is false for anything else,
// for example a commit name like "1c57e51" or "dev".
func parseVersion(s string) (v semver, ok bool) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	if i := strings.IndexByte(s, '+'); i >= 0 {
		s = s[:i]
	}
	core, pre, hasPre := strings.Cut(s, "-")
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return semver{}, false
	}
	nums := make([]int, 3)
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || p == "" || (len(p) > 1 && p[0] == '0') {
			return semver{}, false
		}
		nums[i] = n
	}
	v = semver{major: nums[0], minor: nums[1], patch: nums[2]}
	if hasPre {
		if pre == "" {
			return semver{}, false
		}
		v.pre = strings.Split(pre, ".")
	}
	return v, true
}

// compare is -1, 0 or 1 as a is older, the same as or newer than b.
func compare(a, b semver) int {
	for _, d := range [][2]int{{a.major, b.major}, {a.minor, b.minor}, {a.patch, b.patch}} {
		if d[0] != d[1] {
			return cmpInt(d[0], d[1])
		}
	}
	// A version with a pre-release part comes before the release itself.
	switch {
	case len(a.pre) == 0 && len(b.pre) == 0:
		return 0
	case len(a.pre) == 0:
		return 1
	case len(b.pre) == 0:
		return -1
	}
	for i := 0; i < len(a.pre) && i < len(b.pre); i++ {
		x, y := a.pre[i], b.pre[i]
		nx, errX := strconv.Atoi(x)
		ny, errY := strconv.Atoi(y)
		switch {
		case errX == nil && errY == nil:
			if nx != ny {
				return cmpInt(nx, ny)
			}
		case errX == nil: // numbers come before words
			return -1
		case errY == nil:
			return 1
		case x != y:
			return strings.Compare(x, y)
		}
	}
	return cmpInt(len(a.pre), len(b.pre))
}

func cmpInt(a, b int) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// Newer says whether latest is a newer version than installed. Anything
// that is not a version (a development build, a broken tag) is never
// newer, so nobody is told to update by mistake.
func Newer(installed, latest string) bool {
	a, okA := parseVersion(installed)
	b, okB := parseVersion(latest)
	return okA && okB && compare(b, a) > 0
}

// CleanRelease turns the release name given at build time into "1.2.3",
// or "" when the program was not built from a release tag.
func CleanRelease(s string) string {
	if _, ok := parseVersion(s); !ok {
		return ""
	}
	return strings.TrimPrefix(strings.TrimSpace(s), "v")
}
