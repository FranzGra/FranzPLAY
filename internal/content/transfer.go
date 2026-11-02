package content

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/safefile"
)

// The transfer copies what was made before the folders of this package to where
// the program now expects it, with FranzPLAY stopped:
//
//   - The old files are never touched. A copy counts only after its size and its
//     hash were read back from the disk, and it appears under its name only then.
//   - The database changes at the very end, in one transaction, together with the
//     video.json files: if anything stops before, the rows still name the old
//     files, which are still there, and running it again goes on from there.
//   - moved_files remembers what was copied. Only those files can ever be deleted,
//     by --remove-old, after being checked again.

// TransferSchema is the oldest database the plan can read with no change.
const TransferSchema = 53

// keyUploadsMoved is the settings row that says the uploads are in their new
// folder: the old one must not be read as a library any more.
const keyUploadsMoved = "content.uploads_moved"

// UploadsMoved reports whether the uploads were transferred.
func UploadsMoved(ctx context.Context, db *sql.DB) (moved bool, err error) {
	err = db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM settings WHERE key = ?)`, keyUploadsMoved).Scan(&moved)
	if err != nil {
		return false, fmt.Errorf("read where the uploads are: %w", err)
	}
	return moved, nil
}

// ForgetMoved deletes the old copy of a file a person deleted on purpose.
func ForgetMoved(ctx context.Context, tx *sql.Tx, newPath string) error {
	var old string
	err := tx.QueryRowContext(ctx, `DELETE FROM moved_files WHERE new_path = ? RETURNING old_path`, newPath).Scan(&old)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := os.Remove(old); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// Transfer is one run of the command.
type Transfer struct {
	DB   *sql.DB
	Root Root // the content folder: where the new files go, and maybe old ones
	Data Root // the data folder: where the old files were, when it is another one

	Free   func(dir string) (uint64, error)
	Backup func(ctx context.Context, db *sql.DB, dir, name string) error
	Out    io.Writer
	Now    func() time.Time // time.Now if nil
}

func (t *Transfer) now() time.Time {
	if t.Now != nil {
		return t.Now()
	}
	return time.Now()
}

// say writes a line for the person.
func (t *Transfer) say(format string, args ...any) {
	fmt.Fprintf(t.Out, format+"\n", args...) //nolint:errcheck // nothing to do if the terminal is gone
}

// oldRoots are the folders where old files may be, the content folder first.
func (t *Transfer) oldRoots() []Root {
	if t.Data == t.Root {
		return []Root{t.Root}
	}
	return []Root{t.Root, t.Data}
}

// movedFile is a file to copy.
type movedFile struct {
	kind string
	old  string
	size int64

	// A file of a video goes in its folder; any other goes to the path to.
	videoID           int64
	fingerprint, path string // of the video
	file              string // inside its folder
	to                string

	// rewrite changes what is copied: it is set for a model's settings, which
	// name their own folder.
	rewrite func([]byte) []byte
	// row says the database in saying where the new file is, once it is known.
	row func(ctx context.Context, tx *sql.Tx, value string) error
	// version is put in the address of the new file: a hash is a fine version.
	versioned bool
}

// plan is what a run would do.
type plan struct {
	files   []*movedFile
	missing map[string]int // named by the database, and not on the disk, by kind
	// old are the old files whose row names them by that name: they are in use
	// until the row says otherwise.
	old map[string]bool
	// oldLibraries are the old uploads folders the libraries table names.
	oldLibraries []string
}

// A transferred file of a video: its kind for the person, the column naming it,
// where the old ones are, and its name in the folder.
type flatColumn struct {
	kind, column string
	folder       func(Root) string
	file         string // the fixed name; "" for the files keeping their extension
	prefix       string
}

var flatColumns = []flatColumn{
	{kind: "copertine", column: "cover", folder: Root.Covers, file: FileCover},
	{kind: "copertine scelte", column: "own_cover", folder: Root.OwnCovers, prefix: FileOwnCover},
	{kind: "anteprime sulla barra", column: "preview", folder: Root.Previews, file: FileTimeline},
	{kind: "anteprime", column: "clip", folder: Root.Clips, file: FileClip},
	{kind: "anteprime nitide", column: "clip_hd", folder: Root.ClipsHD, file: FileClipHD},
	{kind: "anteprime scelte", column: "own_clip", folder: Root.OwnClips, prefix: FileOwnClip},
	{kind: "copie convertite", column: "converted", folder: Root.Converted, file: FileConverted},
	{kind: "immagini da internet", column: "online_cover", folder: Root.OnlineImages, file: FileOnlineImage},
}

// findOld looks for a flat file in the old folders.
func (t *Transfer) findOld(folder func(Root) string, name string) (string, int64, bool) {
	for _, root := range t.oldRoots() {
		file := filepath.Join(folder(root), filepath.Base(name))
		if info, err := os.Stat(file); err == nil && info.Mode().IsRegular() {
			return file, info.Size(), true
		}
	}
	return "", 0, false
}

// makePlan reads what there is to copy. It changes nothing, on the disk or in the
// database.
func (t *Transfer) makePlan(ctx context.Context) (*plan, error) {
	p := &plan{missing: map[string]int{}, old: map[string]bool{}}
	if err := t.planVideoFiles(ctx, p); err != nil {
		return nil, fmt.Errorf("read the files of the videos: %w", err)
	}
	if err := t.planSubtitles(ctx, p); err != nil {
		return nil, fmt.Errorf("read the subtitles: %w", err)
	}
	if err := t.planCategories(ctx, p); err != nil {
		return nil, fmt.Errorf("read the categories: %w", err)
	}
	if err := t.planFolders(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// add puts a flat file named by the database in the plan.
func (t *Transfer) add(p *plan, f movedFile, folder func(Root) string, name string) {
	old, size, ok := t.findOld(folder, name)
	if !ok {
		p.missing[f.kind]++
		return
	}
	f.old, f.size = old, size
	p.files = append(p.files, &f)
	if f.row != nil {
		p.old[old] = true
	}
}

func (t *Transfer) planVideoFiles(ctx context.Context, p *plan) (err error) {
	columns := "id, fingerprint, path"
	for _, c := range flatColumns {
		columns += ", " + c.column
	}
	rows, err := t.DB.QueryContext(ctx, `SELECT `+columns+` FROM videos ORDER BY id`) //nolint:gosec // constants of this file
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	values := make([]sql.NullString, len(flatColumns))
	into := make([]any, 0, len(flatColumns)+3)
	var id int64
	var fingerprint, path string
	into = append(into, &id, &fingerprint, &path)
	for i := range values {
		into = append(into, &values[i])
	}
	for rows.Next() {
		if err := rows.Scan(into...); err != nil {
			return err
		}
		for i, c := range flatColumns {
			value := values[i].String
			if value == "" || IsStored(value) {
				continue
			}
			videoID, file := id, c.file
			if file == "" {
				ext := strings.TrimPrefix(filepath.Ext(value), ".")
				if !validExt.MatchString(ext) {
					p.missing[c.kind]++
					continue
				}
				file = c.prefix + "." + ext
			}
			t.add(p, movedFile{
				kind: c.kind, videoID: videoID, fingerprint: fingerprint, path: path, file: file, versioned: true,
				row: func(ctx context.Context, tx *sql.Tx, stored string) error {
					_, err := tx.ExecContext(ctx, `UPDATE videos SET `+c.column+` = ? WHERE id = ? AND `+c.column+` = ?`, stored, videoID, value) //nolint:gosec // constants of this file
					return err
				},
			}, c.folder, value)
		}
	}
	return rows.Err()
}

func (t *Transfer) planSubtitles(ctx context.Context, p *plan) error {
	inside, err := flatRows(ctx, t.DB, `SELECT s.video_id, v.fingerprint, v.path, s.file, s.stream, ''
		FROM video_subtitles s JOIN videos v ON v.id = s.video_id ORDER BY s.video_id, s.stream`)
	if err != nil {
		return err
	}
	for _, s := range inside {
		t.add(p, movedFile{
			kind: "sottotitoli del file", videoID: s.id, fingerprint: s.fingerprint, path: s.path, file: InsideSubtitleFile(int(s.stream)),
			row: func(ctx context.Context, tx *sql.Tx, stored string) error {
				_, err := tx.ExecContext(ctx, `UPDATE video_subtitles SET file = ? WHERE video_id = ? AND stream = ? AND file = ?`, stored, s.id, s.stream, s.value)
				return err
			},
		}, Root.Subtitles, s.value)
	}
	auto, err := flatRows(ctx, t.DB, `SELECT a.video_id, v.fingerprint, v.path, a.file, 0, a.lang
		FROM auto_subtitles a JOIN videos v ON v.id = a.video_id ORDER BY a.video_id, a.lang`)
	if err != nil {
		return err
	}
	for _, s := range auto {
		if !validLang.MatchString(s.lang) {
			p.missing["sottotitoli automatici"]++
			continue
		}
		t.add(p, movedFile{
			kind: "sottotitoli automatici", videoID: s.id, fingerprint: s.fingerprint, path: s.path, file: AutoSubtitleFile(s.lang),
			row: func(ctx context.Context, tx *sql.Tx, stored string) error {
				_, err := tx.ExecContext(ctx, `UPDATE auto_subtitles SET file = ? WHERE video_id = ? AND lang = ? AND file = ?`, stored, s.id, s.lang, s.value)
				return err
			},
		}, Root.AutoSubtitles, s.value)
	}
	proposals, err := flatRows(ctx, t.DB, `SELECT p.video_id, v.fingerprint, v.path, p.image, 0, ''
		FROM online_proposals p JOIN videos v ON v.id = p.video_id WHERE p.image IS NOT NULL ORDER BY p.video_id`)
	if err != nil {
		return err
	}
	for _, s := range proposals {
		t.add(p, movedFile{
			kind: "immagini suggerite", videoID: s.id, fingerprint: s.fingerprint, path: s.path, file: FileProposalImage,
			row: func(ctx context.Context, tx *sql.Tx, stored string) error {
				_, err := tx.ExecContext(ctx, `UPDATE online_proposals SET image = ? WHERE video_id = ? AND image = ?`, stored, s.id, s.value)
				return err
			},
		}, Root.OnlineImages, s.value)
	}
	return nil
}

// flatRow is a row naming a flat file of a video.
type flatRow struct {
	id                int64
	fingerprint, path string
	value             string
	stream            int64
	lang              string
}

// flatRows reads the rows of a query that still name a flat file. query is a
// constant of this file.
func flatRows(ctx context.Context, db *sql.DB, query string) (out []flatRow, err error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var r flatRow
		if err := rows.Scan(&r.id, &r.fingerprint, &r.path, &r.value, &r.stream, &r.lang); err != nil {
			return nil, err
		}
		if !IsStored(r.value) {
			out = append(out, r)
		}
	}
	return out, rows.Err()
}

// planCategories adds the images the database names. Their name does not change:
// only the folder, which the routes look for by themselves.
func (t *Transfer) planCategories(ctx context.Context, p *plan) error {
	for _, c := range []struct {
		kind, query string
		old         func(Root) string
		dir         string
	}{
		{"immagini delle categorie", `SELECT image FROM categories`, Root.OldCategoryImages, t.Root.CategoryImages()},
		{"copie delle immagini delle categorie", `SELECT file FROM category_pictures`, Root.OldCategoryPictures, t.Root.CategoryPictures()},
	} {
		named, err := column(ctx, t.DB, c.query)
		if err != nil {
			return err
		}
		for name := range named {
			if name != filepath.Base(name) {
				continue
			}
			f := movedFile{kind: c.kind, to: filepath.Join(c.dir, name)}
			if _, err := os.Stat(f.to); err == nil {
				if _, _, ok := t.findOld(c.old, name); !ok {
					continue // made after this version arrived: nothing old about it
				}
			}
			t.add(p, f, c.old, name)
		}
	}
	return nil
}

// configPaths finds the paths in the settings of a translation model.
var configPaths = regexp.MustCompile(`"[^"\n]*/(model\.bin|vocab\.spm|lex\.bin)"`)

// planFolders adds what is copied whole: photos, models, uploads. There, whatever
// is in the old folder counts, named by the database or not: an original video
// may be on the disk before the database knows it.
func (t *Transfer) planFolders(ctx context.Context, p *plan) error {
	seen := map[string]bool{}
	for _, root := range t.oldRoots() {
		for _, c := range []struct {
			kind     string
			old, new string
			skip     func(rel string) bool
			rewrite  func(rel string) func([]byte) []byte
		}{
			{kind: "foto dei profili", old: root.OldAvatars(), new: t.Root.Avatars()},
			{kind: "modelli whisper", old: root.OldWhisperModels(), new: t.Root.WhisperModels()},
			{
				kind: "modelli di traduzione", old: root.OldTranslatorModels(), new: t.Root.TranslatorModels(),
				skip: func(rel string) bool { return strings.HasPrefix(rel, ".partial-") },
				rewrite: func(rel string) func([]byte) []byte {
					if filepath.Base(rel) != "config.yml" {
						return nil
					}
					final := filepath.ToSlash(filepath.Join(t.Root.TranslatorModels(), filepath.Dir(rel)))
					return func(data []byte) []byte {
						return configPaths.ReplaceAll(data, []byte(`"`+final+`/$1"`))
					}
				},
			},
			{kind: "video caricati", old: root.OldUploads(), new: t.Root.Uploads()},
			{kind: "caricamenti in corso", old: root.OldIncoming(), new: t.Root.Incoming()},
		} {
			err := filepath.WalkDir(c.old, func(path string, d fs.DirEntry, err error) error {
				if errors.Is(err, fs.ErrNotExist) {
					return nil
				}
				if err != nil {
					return err
				}
				if !d.Type().IsRegular() || strings.HasPrefix(d.Name(), ".new-") {
					return nil
				}
				rel, err := filepath.Rel(c.old, path)
				if err != nil {
					return err
				}
				if (c.skip != nil && c.skip(rel)) || seen[c.kind+"/"+rel] {
					return nil
				}
				info, err := d.Info()
				if err != nil {
					return err
				}
				seen[c.kind+"/"+rel] = true
				f := &movedFile{kind: c.kind, old: path, size: info.Size(), to: filepath.Join(c.new, rel)}
				if c.rewrite != nil {
					f.rewrite = c.rewrite(rel)
				}
				p.files = append(p.files, f)
				return nil
			})
			if err != nil {
				return fmt.Errorf("read %s: %w", c.old, err)
			}
		}
		abs, err := filepath.Abs(root.OldUploads())
		if err != nil {
			return err
		}
		var known bool
		if err := t.DB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM libraries WHERE path = ?)`, abs).Scan(&known); err != nil {
			return fmt.Errorf("read the libraries: %w", err)
		}
		if known {
			p.oldLibraries = append(p.oldLibraries, abs)
		}
	}
	return nil
}

// loadMoved reads what earlier runs copied. Each such file is done, even if its
// copy has gone since: somebody deleted it, and it must not come back.
func (t *Transfer) loadMoved(ctx context.Context) (map[string]bool, error) {
	if !t.hasMovedTable(ctx) {
		return map[string]bool{}, nil
	}
	moved, err := column(ctx, t.DB, `SELECT old_path FROM moved_files`)
	if err != nil {
		return nil, fmt.Errorf("read what was copied: %w", err)
	}
	return moved, nil
}

// hasMovedTable says whether the table exists: a database only read may be older.
func (t *Transfer) hasMovedTable(ctx context.Context) bool {
	var has bool
	err := t.DB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE name = 'moved_files')`).Scan(&has)
	return err == nil && has
}

// show writes the plan, with numbers and sizes.
func (t *Transfer) show(p *plan, moved map[string]bool) (need int64) {
	type total struct {
		count int
		size  int64
	}
	totals := map[string]*total{}
	var kinds []string
	for _, f := range p.files {
		if moved[f.old] {
			continue
		}
		if totals[f.kind] == nil {
			totals[f.kind] = &total{}
			kinds = append(kinds, f.kind)
		}
		totals[f.kind].count++
		totals[f.kind].size += f.size
		need += f.size
	}
	t.say("Dati: %s", t.Data)
	t.say("Contenuti: %s", t.Root)
	if len(kinds) == 0 {
		t.say("Niente da copiare.")
	} else {
		t.say("Da copiare:")
		for _, kind := range kinds {
			t.say("  %-40s %6d file  %s", kind, totals[kind].count, sizeInWords(totals[kind].size))
		}
		t.say("  %-40s %6s       %s", "in tutto", "", sizeInWords(need))
	}
	for kind, n := range p.missing {
		t.say("Attenzione: %d %s nominati dal database non sono sul disco: restano come sono.", n, kind)
	}
	return need
}

// sizeInWords writes a size for people.
func sizeInWords(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGT"[min(exp, 3)])
}

// ErrNoSpace means the disk of the content folder cannot take the copies.
var ErrNoSpace = errors.New("not enough free space")

// spareSpace is left free on top of what is copied. The copies of the video.json
// files and the database are small next to it.
const spareSpace = 64 << 20

// checkSpace refuses when the copies do not fit.
func (t *Transfer) checkSpace(need int64) error {
	dir := string(t.Root)
	for {
		_, err := os.Stat(dir)
		parent := filepath.Dir(dir)
		if err == nil || parent == dir {
			break
		}
		dir = parent
	}
	free, err := t.Free(dir)
	if err != nil {
		return err
	}
	var database int64
	if info, err := os.Stat(filepath.Join(string(t.Data), "franzplay.db")); err == nil {
		database = info.Size()
	}
	want := need + database + spareSpace
	if want < 0 || uint64(want) > free { //nolint:gosec // want is checked not to be negative
		return fmt.Errorf("%w on %s: it takes %s, there are %s. Nothing was changed",
			ErrNoSpace, dir, sizeInWords(want), sizeInWords(int64(min(free, 1<<62)))) //nolint:gosec // cut to fit
	}
	return nil
}

// CheckSpace refuses when the copies do not fit, saying nothing else.
func (t *Transfer) CheckSpace(ctx context.Context) error {
	p, err := t.makePlan(ctx)
	if err != nil {
		return err
	}
	moved, err := t.loadMoved(ctx)
	if err != nil {
		return err
	}
	var need int64
	for _, f := range p.files {
		if !moved[f.old] {
			need += f.size
		}
	}
	return t.checkSpace(need)
}

// DryRun says what Apply would do. It changes nothing.
func (t *Transfer) DryRun(ctx context.Context) error {
	p, err := t.makePlan(ctx)
	if err != nil {
		return err
	}
	moved, err := t.loadMoved(ctx)
	if err != nil {
		return err
	}
	need := t.show(p, moved)
	if err := t.checkSpace(need); err != nil {
		return err
	}
	t.say("Non ho cambiato niente. Per copiare davvero: franzplay migrate-content --apply")
	return nil
}

// Apply copies, checks and updates the database. Stopped at any moment and run
// again, it goes on: a copy already there and identical is not made again.
func (t *Transfer) Apply(ctx context.Context) (err error) {
	p, err := t.makePlan(ctx)
	if err != nil {
		return err
	}
	moved, err := t.loadMoved(ctx)
	if err != nil {
		return err
	}
	if err := t.checkSpace(t.show(p, moved)); err != nil {
		return err
	}
	if err := RemoveWork(t.Root); err != nil {
		return err
	}
	if err := t.backupBefore(ctx); err != nil {
		return err
	}
	var done []*copied
	conflicts := map[string]bool{}
	for i, f := range p.files {
		if moved[f.old] {
			continue
		}
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("stopped: run it again to go on: %w", err)
		}
		c, err := t.copyFile(ctx, f)
		if errors.Is(err, errConflict) {
			t.say("Lasciato com'è: %s (in %s c'è già un altro file)", f.old, f.to)
			conflicts[f.old] = true
			continue
		}
		if err != nil {
			return fmt.Errorf("copy %s: %w", f.old, err)
		}
		done = append(done, c)
		if (i+1)%100 == 0 {
			t.say("  %d file su %d…", i+1, len(p.files))
		}
	}
	if err := t.save(ctx, p, done, conflicts); err != nil {
		return err
	}
	t.say("Fatto: %d file copiati e controllati. I file vecchi sono ancora tutti al loro posto.", len(done))
	if len(conflicts) > 0 {
		t.say("Attenzione: %d file sono rimasti dov'erano, vedi sopra.", len(conflicts))
	}
	t.say("Riaccendi FranzPLAY e controlla che tutto si veda. Dopo, per liberare il disco: franzplay migrate-content --remove-old")
	return nil
}

// backupBefore makes a copy of the database before the first change, and does not
// replace one already made today by a run that stopped.
func (t *Transfer) backupBefore(ctx context.Context) error {
	dir := t.Root.Database()
	name := "franzplay_prima-del-trasferimento_" + t.now().Format("02-01-2006") + ".db"
	if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
		t.say("Copia del database già fatta: %s", filepath.Join(dir, name))
		return nil
	}
	if err := t.Backup(ctx, t.DB, dir, name); err != nil {
		return err
	}
	t.say("Copia del database: %s", filepath.Join(dir, name))
	return nil
}

// copied is a file copied and checked.
type copied struct {
	file     *movedFile
	to       string
	oldHash  string
	newHash  string
	folderID string // the code of the video's folder, "" for the others
	// saved is what moved_files keeps as the new place: in a video's folder, the
	// code and the file, since the folder may be renamed before --remove-old.
	saved string
}

// newPlace is the new place moved_files keeps for a copy.
func (c *copied) newPlace() string {
	if c.saved != "" {
		return c.saved
	}
	return c.to
}

// errConflict means another file is already where a copy should go.
var errConflict = errors.New("another file is there")

// copyFile makes one verified copy. A file already there and identical counts as
// copied, by a run that stopped.
func (t *Transfer) copyFile(_ context.Context, f *movedFile) (*copied, error) {
	c := &copied{file: f, to: f.to}
	if f.fingerprint != "" {
		code, _, err := t.Root.EnsureFolder(f.fingerprint, f.path)
		if err != nil {
			return nil, err
		}
		c.folderID, c.to = code, t.Root.FileIn(code, f.file)
		f.to = c.to
		c.saved = Stored(code, f.file, "")
	}
	data, oldHash, err := readForCopy(f)
	if err != nil {
		return nil, err
	}
	c.oldHash = oldHash
	c.newHash = oldHash
	if f.rewrite != nil {
		sum := sha256.Sum256(data)
		c.newHash = hex.EncodeToString(sum[:])
	}
	if _, err := os.Lstat(c.to); err == nil {
		have, _, err := hashFile(c.to)
		if err != nil {
			return nil, err
		}
		if have != c.newHash {
			return nil, errConflict
		}
		return c, nil
	}
	if err := t.writeCopy(f, c, data); err != nil {
		return nil, err
	}
	return c, nil
}

// readForCopy returns the hash of the old file, and its content when it is to be
// rewritten: only small files are.
func readForCopy(f *movedFile) (data []byte, sum string, err error) {
	if f.rewrite != nil {
		data, err = os.ReadFile(f.old)
		if err != nil {
			return nil, "", err
		}
		old := sha256.Sum256(data)
		return f.rewrite(data), hex.EncodeToString(old[:]), nil
	}
	sum, _, err = hashFile(f.old)
	return nil, sum, err
}

// writeCopy writes the copy in the work folder and reads it back before it takes
// its name. It keeps permissions and date: the scanner compares the date.
func (t *Transfer) writeCopy(f *movedFile, c *copied, data []byte) (err error) {
	work, err := t.Root.MakeWork()
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(work, ".transfer-*")
	if err != nil {
		return err
	}
	defer func() {
		if rmErr := os.Remove(tmp.Name()); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()
	var size int64
	if f.rewrite != nil {
		n, err := tmp.Write(data)
		if err != nil {
			return errors.Join(err, tmp.Close())
		}
		size = int64(n)
	} else {
		in, err := os.Open(f.old)
		if err != nil {
			return errors.Join(err, tmp.Close())
		}
		size, err = io.Copy(tmp, in)
		if err = errors.Join(err, in.Close()); err != nil {
			return errors.Join(err, tmp.Close())
		}
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	have, written, err := hashFile(tmp.Name())
	if err != nil {
		return err
	}
	if have != c.newHash || written != size || (f.rewrite == nil && written != f.size) {
		return fmt.Errorf("the copy is not identical: %d bytes, hash %s", written, have)
	}
	info, err := os.Stat(f.old)
	if err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), info.Mode().Perm()); err != nil {
		return err
	}
	if err := os.Chtimes(tmp.Name(), info.ModTime(), info.ModTime()); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(c.to), 0o750); err != nil {
		return err
	}
	return renameInto(tmp.Name(), c.to)
}

// renameInto puts a finished file in its place.
func renameInto(from, to string) error { return safefile.Rename(from, to) }

// hashFile returns the sha256 of a file and its size.
func hashFile(path string) (string, int64, error) {
	f, err := os.Open(path) //nolint:gosec // a file of the folders of this package
	if err != nil {
		return "", 0, err
	}
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err = errors.Join(err, f.Close()); err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

// save writes the database and the video.json files in one transaction. The rows
// say the new names; the video.json files, made from those rows, are written
// before the commit: if it fails they name files that exist, and the rows still
// name the old ones.
func (t *Transfer) save(ctx context.Context, p *plan, done []*copied, conflicts map[string]bool) (err error) {
	tx, err := t.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("update the database: %w", err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	now := t.now().Unix()
	videos := map[int64]bool{}
	for _, c := range done {
		if c.file.row != nil {
			version := ""
			if c.file.versioned {
				version = c.newHash[:12]
			}
			if err := c.file.row(ctx, tx, Stored(c.folderID, c.file.file, version)); err != nil {
				return fmt.Errorf("update the database for %s: %w", c.file.old, err)
			}
			videos[c.file.videoID] = true
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO moved_files (old_path, new_path, size, old_sha256, new_sha256, moved_at) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (old_path) DO UPDATE SET new_path = excluded.new_path, size = excluded.size,
				old_sha256 = excluded.old_sha256, new_sha256 = excluded.new_sha256, moved_at = excluded.moved_at`,
			c.file.old, c.newPlace(), c.file.size, c.oldHash, c.newHash, now); err != nil {
			return fmt.Errorf("update the database for %s: %w", c.file.old, err)
		}
	}
	if err := t.moveUploads(ctx, tx, p, conflicts); err != nil {
		return fmt.Errorf("update the database for the uploads: %w", err)
	}
	if len(done) > 0 {
		if err := holdFlatFiles(ctx, tx, t.now()); err != nil {
			return fmt.Errorf("update the database: %w", err)
		}
	}
	// The video.json of an uploaded video names its library.
	uploaded, err := column(ctx, tx, `SELECT v.id FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE l.path = '`+strings.ReplaceAll(t.uploadsFolder(), "'", "''")+`'`)
	if err != nil {
		return fmt.Errorf("update the database for the uploads: %w", err)
	}
	for id := range uploaded {
		n, err := strconv.ParseInt(id, 10, 64)
		if err != nil {
			return err
		}
		videos[n] = true
	}
	for id := range videos {
		if err := saveManifest(ctx, tx, t.Root, id); err != nil {
			return err
		}
	}
	return saveCategories(ctx, tx, t.Root)
}

// moveUploads makes the libraries point to the new uploads folder, with the same
// paths inside: the video files are identical, so their fingerprints are the same
// and nothing is done again. A video whose copy could not be made stays in the old
// library, which then stays too.
func (t *Transfer) moveUploads(ctx context.Context, tx *sql.Tx, p *plan, conflicts map[string]bool) error {
	folder := t.uploadsFolder()
	all := true
	for _, old := range p.oldLibraries {
		if !nothingStayed(old, conflicts) {
			all = false
			continue
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO libraries (path) VALUES (?) ON CONFLICT (path) DO NOTHING`, folder); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE videos SET library_id = (SELECT id FROM libraries WHERE path = ?)
			WHERE library_id = (SELECT id FROM libraries WHERE path = ?)`, folder, old); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM category_pictures WHERE library_id = (SELECT id FROM libraries WHERE path = ?)`, old); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM libraries WHERE path = ?`, old); err != nil {
			return err
		}
	}
	for _, f := range p.files {
		if conflicts[f.old] && strings.HasPrefix(f.to, t.Root.Uploads()) {
			all = false
		}
	}
	if !all {
		return nil
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`,
		keyUploadsMoved, fmt.Sprint(t.now().Unix()))
	return err
}

// uploadsFolder is the library of the uploads: an absolute path, as main names it.
func (t *Transfer) uploadsFolder() string {
	folder, err := filepath.Abs(t.Root.Uploads())
	if err != nil {
		return t.Root.Uploads()
	}
	return folder
}

// nothingStayed reports whether no file of an old folder stayed behind.
func nothingStayed(old string, conflicts map[string]bool) bool {
	for path := range conflicts {
		if strings.HasPrefix(path, old+string(filepath.Separator)) {
			return false
		}
	}
	return true
}

// RemoveOld deletes the old files that were copied, each after checking again
// that the old file and its copy are what they were. Whatever does not match
// stays and is listed. Nothing else in the old folders is touched: what was never
// copied was never in moved_files.
func (t *Transfer) RemoveOld(ctx context.Context) error {
	p, err := t.makePlan(ctx)
	if err != nil {
		return err
	}
	named := map[string]bool{}
	for old := range p.old { // the database still names it
		named[old] = true
	}
	for _, f := range p.files {
		for _, lib := range p.oldLibraries { // its library is still the old one
			if strings.HasPrefix(f.old, lib+string(filepath.Separator)) {
				named[f.old] = true
			}
		}
	}
	type row struct {
		old, new, oldHash, newHash string
	}
	rows, err := t.DB.QueryContext(ctx, `SELECT old_path, new_path, old_sha256, new_sha256 FROM moved_files ORDER BY old_path`)
	if err != nil {
		return fmt.Errorf("read what was copied: %w", err)
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.old, &r.new, &r.oldHash, &r.newHash); err != nil {
			return errors.Join(fmt.Errorf("read what was copied: %w", err), rows.Close())
		}
		all = append(all, r)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return fmt.Errorf("read what was copied: %w", err)
	}
	removed, kept := 0, 0
	keep := func(r row, why string) {
		kept++
		t.say("Tenuto: %s (%s)", r.old, why)
	}
	for _, r := range all {
		if err := ctx.Err(); err != nil {
			return err
		}
		if _, err := os.Lstat(r.old); errors.Is(err, fs.ErrNotExist) {
			if _, err := t.DB.ExecContext(ctx, `DELETE FROM moved_files WHERE old_path = ?`, r.old); err != nil {
				return err
			}
			continue
		}
		if named[r.old] {
			keep(r, "il database lo usa ancora")
			continue
		}
		have, _, err := hashFile(r.old)
		if err != nil || have != r.oldHash {
			keep(r, "non è più il file che era stato copiato")
			continue
		}
		newFile := r.new
		if s, ok := parseStored(r.new); ok {
			newFile = t.Root.FileIn(s.code, s.file)
		}
		have, _, err = hashFile(newFile)
		if err != nil || have != r.newHash {
			keep(r, "la copia è cambiata o non c'è più: "+newFile)
			continue
		}
		if err := os.Remove(r.old); err != nil {
			return fmt.Errorf("remove %s: %w", r.old, err)
		}
		if _, err := t.DB.ExecContext(ctx, `DELETE FROM moved_files WHERE old_path = ?`, r.old); err != nil {
			return err
		}
		t.removeEmptyParents(r.old)
		removed++
	}
	t.say("Cancellati %d file vecchi, tutti con la loro copia controllata. Tenuti: %d.", removed, kept)
	return t.releaseHold(ctx)
}

// removeEmptyParents takes away the old folders left empty, never the root.
func (t *Transfer) removeEmptyParents(file string) {
	for dir := filepath.Dir(file); dir != string(t.Root) && dir != string(t.Data) && dir != filepath.Dir(dir); dir = filepath.Dir(dir) {
		if os.Remove(dir) != nil {
			return // not empty: the folders above are not either
		}
	}
}

// releaseHold lets the cleanings work again when no flat file is left. A flat file
// still there was not copied, or kept above: it stays, and so does the hold. The
// person decides, and once they are gone the next start sees there is nothing to hold.
func (t *Transfer) releaseHold(ctx context.Context) error {
	total := 0
	for _, root := range t.oldRoots() {
		for _, dir := range root.flatFolders() {
			n, err := countFiles(dir)
			if err != nil {
				return err
			}
			if n > 0 {
				t.say("Restano %d file mai copiati in %s: nessuno li cancella. Se non ti servono, cancellali a mano.", n, dir)
			}
			total += n
		}
	}
	if total > 0 {
		return nil
	}
	if _, err := t.DB.ExecContext(ctx, `DELETE FROM settings WHERE key = ?`, keyHoldFlatFiles); err != nil {
		return fmt.Errorf("let the cleanings work again: %w", err)
	}
	return nil
}
