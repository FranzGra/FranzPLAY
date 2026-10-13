package video

// Previews are small frames of a video, taken every few seconds and joined
// in one image, a grid of PreviewColumns per row. The player shows the
// right one above the timeline while the pointer moves over it.
//
// The player shows a frame 160 points wide on a phone and 240 on a
// computer. Phones have 3 real pixels per point and Mac screens 2, so
// 480×270 frames look sharp on both. With 100 of them the image is about
// 0.5-0.8 MB and the program needs about 100 MB of memory to join them.
// Full HD frames would make a 10 MB image and need about 900 MB: too much
// for a Raspberry Pi, and too heavy to show for a phone. Both sides must
// be even numbers (ffmpeg's frames are cut in 2×2 squares).
const (
	PreviewWidth     = 480 // pixels of one frame
	PreviewHeight    = 270
	PreviewColumns   = 10  // frames per row of the image
	MaxPreviewFrames = 100 // 10 rows
	minPreviewGap    = 2   // seconds: closer frames would add nothing
)

// PreviewGap returns how many seconds apart the previews of a video that
// lasts duration seconds are: as close as possible, but no more than
// MaxPreviewFrames in all. Videos too short to need them get 0.
func PreviewGap(duration int64) int64 {
	if duration < 2*minPreviewGap {
		return 0
	}
	return max(minPreviewGap, (duration+MaxPreviewFrames-1)/MaxPreviewFrames)
}

// PreviewGrid returns the columns and rows of the image holding count
// frames. Fewer than a full row make a single shorter row.
func PreviewGrid(count int) (columns, rows int) {
	if count <= 0 {
		return 0, 0
	}
	columns = min(count, PreviewColumns)
	return columns, (count + columns - 1) / columns
}
