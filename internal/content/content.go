// Package content says where FranzPLAY keeps what it makes and what people
// give it: covers, previews, copies, subtitles, models, uploads, photos.
//
// It is the only place that knows these folders. The rest of the program asks
// a Root and never builds these paths by itself. The database is not here: it
// stays in the data folder, which is another setting (see package config).
package content

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// Root is the folder that holds all the content. It is the setting
// FRANZPLAY_CONTENT_DIR, or the data folder when that is not set.
type Root string

// The folders below are the old flat ones, with one file per kind and per
// video. Nothing new about a video is written there (see videofolder.go): they
// are read for what is already in them, until a later version moves it.

// Covers holds the covers.
func (r Root) Covers() string { return r.folder("covers") }

// OwnCovers holds the images the administrator uploaded as covers, as they
// were sent. The cover job turns them into covers like any other picture.
func (r Root) OwnCovers() string { return r.folder("own-covers") }

// Previews holds the previews shown over the player's timeline.
func (r Root) Previews() string { return r.folder("previews") }

// Clips holds the clips that play on a video's card when the pointer rests
// on it.
func (r Root) Clips() string { return r.folder("clips") }

// ClipsHD holds the same clips made sharper, for browsers on a good
// connection. Each has the same name as its light twin in Clips.
func (r Root) ClipsHD() string { return r.folder("clips-hd") }

// OwnClips holds the videos the administrator uploaded as clips, as they were
// sent. The clip job turns them into clips like the others: small, silent,
// quick to load.
func (r Root) OwnClips() string { return r.folder("own-clips") }

// Converted holds the copies of the videos that not every browser plays.
func (r Root) Converted() string { return r.folder("converted") }

// Subtitles holds the copies of the subtitles found inside the video files.
func (r Root) Subtitles() string { return r.folder("subtitles") }

// AutoSubtitles holds the subtitles written by whisper and their translations.
func (r Root) AutoSubtitles() string { return r.folder("autosubtitles") }

// OnlineImages holds the pictures downloaded from the internet. The cover job
// turns them into covers.
func (r Root) OnlineImages() string { return r.folder("online") }

// The folders below hold what belongs to no video. New files go in the first
// method of each pair; the Old one is read until "franzplay migrate-content"
// has copied what is in it (see Find).

// WhisperModels is where the administrator puts whisper's models:
// ggml-small.bin, ggml-medium.bin…
func (r Root) WhisperModels() string { return r.folder("modelli", "whisper") }

// OldWhisperModels is where those models were.
func (r Root) OldWhisperModels() string { return r.folder("whisper") }

// WhisperModelsInUse is the folder of the whisper models that the page shows and
// a new model goes to: the old one while it has models and the new one none, so
// the models of an installation not moved yet are not split in two places.
// It is not a method of Root: it looks at the disk, and Root only says paths.
func WhisperModelsInUse(r Root) string {
	if hasModels(r.OldWhisperModels()) && !hasModels(r.WhisperModels()) {
		return r.OldWhisperModels()
	}
	return r.WhisperModels()
}

// hasModels says whether a folder holds a whisper model.
func hasModels(dir string) bool {
	found, err := filepath.Glob(filepath.Join(dir, "ggml-*.bin"))
	return err == nil && len(found) > 0
}

// TranslatorModels holds the models of the translator inside the image.
func (r Root) TranslatorModels() string { return r.folder("modelli", "translator") }

// OldTranslatorModels is where those models were.
func (r Root) OldTranslatorModels() string { return r.folder("translator") }

// Categories holds what belongs to the categories, and categorie.json.
func (r Root) Categories() string { return r.folder("categorie") }

// CategoryImages holds the images of the categories uploaded by the
// administrator.
func (r Root) CategoryImages() string { return r.folder("categorie", "immagini") }

// OldCategoryImages is where those images were.
func (r Root) OldCategoryImages() string { return r.folder("category-images") }

// CategoryPictures holds the light copies of the pictures found in the
// folders of the categories.
func (r Root) CategoryPictures() string { return r.folder("categorie", "copie") }

// OldCategoryPictures is where those copies were.
func (r Root) OldCategoryPictures() string { return r.folder("category-pictures") }

// Avatars holds the profile photos.
func (r Root) Avatars() string { return r.folder("utenti") }

// OldAvatars is where the profile photos were.
func (r Root) OldAvatars() string { return r.folder("avatars") }

// Uploads holds the finished uploads, one folder per person. The scanner
// reads it like a video folder.
func (r Root) Uploads() string { return r.folder("caricati", "video") }

// OldUploads is where the finished uploads were. The scanner reads it too,
// until they are transferred.
func (r Root) OldUploads() string { return r.folder("uploads") }

// Incoming holds the uploads still arriving.
func (r Root) Incoming() string { return r.folder("caricati", "in-arrivo") }

// OldIncoming is where the uploads still arriving were.
func (r Root) OldIncoming() string { return r.folder("incoming") }

// Database holds the safety copies of the database, not the one in use.
func (r Root) Database() string { return r.folder("database") }

func (r Root) folder(names ...string) string {
	return filepath.Join(append([]string{string(r)}, names...)...)
}

// Find returns where a file is: in the folder dir, or in old if it is only
// there. A file that is nowhere gets its place in dir, so who opens it finds it
// missing and who writes it writes the new one. The rule is the same for models,
// photos and pictures: the new place wins.
func Find(dir, old, name string) string {
	file := filepath.Join(dir, name)
	if _, err := os.Stat(file); !errors.Is(err, fs.ErrNotExist) {
		return file
	}
	before := filepath.Join(old, name)
	if _, err := os.Stat(before); err == nil {
		return before
	}
	return file
}
