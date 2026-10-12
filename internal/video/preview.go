package video

// Previews are small frames of a video, taken every few seconds and joined
// in one image, a grid of PreviewColumns per row. The player shows the
// right one above the timeline while the pointer moves over it.
const (
	PreviewWidth     = 160 // pixels of one frame
	PreviewHeight    = 90
	PreviewColumns   = 10  // frames per row of the image
	MaxPreviewFrames = 100 // 10 rows: about 100-200 KB, quick to download
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
