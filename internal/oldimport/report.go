package oldimport

import (
	"fmt"
	"io"
	"strings"
)

// Report says what the import did, and what it could not do.
type Report struct {
	Try      bool // nothing was saved
	Videos   VideoReport
	People   PeopleReport
	Likes    Counts
	Comments CommentCounts
	Saved    Counts // "Salvati", now in "Guarda più tardi"
	History  Counts
	Logins   LoginCounts
	Photos   PhotoCounts
	Look     LookOutcome
	// What the administrator changed by hand.
	Titles     Counts // titles of videos
	Categories Counts // names of categories (Skipped: no video has their folder)
	Covers     CoverCounts
	// LeftOut is what was not brought.
	LeftOut LeftOut
	// Problems are rows of the old database that could not be read.
	Problems []string
}

// VideoReport says how many old videos were found among the new ones.
type VideoReport struct {
	Old, Found int
	Missing    []string // old paths with no new video
	Ambiguous  []string // old paths that fit more than one new video
}

// PeopleReport lists the people, by their new name.
type PeopleReport struct {
	Added      []string
	Existing   []string // already in the new FranzPLAY: joined, password and role unchanged
	Renamed    []Renamed
	NoPassword []string // their old password cannot be read: the administrator must set a new one
}

// Renamed is a person whose old name the new FranzPLAY does not accept.
type Renamed struct{ Old, New string }

// Counts are the rows of one kind.
type Counts struct {
	Added    int // added (for the history: added or brought up to date)
	Existing int // already there
	Skipped  int // their person or video is not in the new FranzPLAY
}

// CommentCounts are Counts with what was done to the texts.
type CommentCounts struct {
	Counts
	Empty     int // only spaces: left out
	Shortened int // added, but longer than the new limit: cut, with "…" at the end
}

// LoginCounts are the rows of the access log.
type LoginCounts struct {
	Added, Existing int
	Old             int // older than the 90 days the new FranzPLAY keeps
}

// PhotoCounts are the profile photos.
type PhotoCounts struct {
	Added    int      // brought over
	Existing int      // the person already had a photo in the new FranzPLAY: kept
	Failed   []string // "name (file): why"
}

// CoverCounts are the covers chosen by hand.
type CoverCounts struct {
	Added    int      // brought over
	Existing int      // the video already had a cover chosen in the new FranzPLAY: kept
	Failed   []string // "path: why"
}

// LookOutcome is what happened to the old site's name and color.
type LookOutcome int

// The outcomes for the site's look.
const (
	LookDefault    LookOutcome = iota // never changed in the old site: nothing to bring
	LookAdded                         // brought over
	LookKept                          // the new site already has its own: kept
	LookUnreadable                    // the new site cannot show it
)

// LeftOut counts what the new FranzPLAY does not bring.
type LeftOut struct {
	Photos    int // profile photos, when their folder was not given
	Subtitles int // subtitles made by Whisper
}

// maxListed is how many paths or problems are written out; the rest are
// counted.
const maxListed = 20

// Write writes the report for the person who ran the import, in Italian.
func (r *Report) Write(w io.Writer) error {
	var b strings.Builder
	if r.Try {
		b.WriteString("PROVA: non è stato salvato niente. Ecco cosa succederebbe.\n\n")
	} else {
		b.WriteString("Importazione finita.\n\n")
	}

	fmt.Fprintf(&b, "Video: %d del vecchio FranzPLAY, %d ritrovati nel nuovo.\n", r.Videos.Old, r.Videos.Found)
	list(&b, "Non trovati (mi piace, commenti e cronologia di questi video restano fuori)", r.Videos.Missing)
	list(&b, "Più di un video con lo stesso nome nel nuovo, non si sa quale scegliere", r.Videos.Ambiguous)

	fmt.Fprintf(&b, "\nPersone: %d nuove", len(r.People.Added))
	if len(r.People.Existing) > 0 {
		fmt.Fprintf(&b, ", %d c'erano già (%s): password e ruolo restano quelli del nuovo",
			len(r.People.Existing), strings.Join(r.People.Existing, ", "))
	}
	b.WriteString(".\n")
	for _, n := range r.People.Renamed {
		fmt.Fprintf(&b, "  - «%s» ora si chiama «%s»: il vecchio nome non va bene nel nuovo FranzPLAY\n", n.Old, n.New)
	}
	if len(r.People.NoPassword) > 0 {
		fmt.Fprintf(&b, "  - Password vecchia non leggibile, va data una nuova dall'amministrazione: %s\n",
			strings.Join(r.People.NoPassword, ", "))
	}

	counts(&b, "Mi piace", r.Likes)
	counts(&b, "Commenti", r.Comments.Counts)
	if r.Comments.Empty > 0 {
		fmt.Fprintf(&b, "  - %d vuoti, lasciati fuori\n", r.Comments.Empty)
	}
	if r.Comments.Shortened > 0 {
		fmt.Fprintf(&b, "  - %d più lunghi di %d caratteri, accorciati\n", r.Comments.Shortened, maxComment)
	}
	counts(&b, "Salvati (ora in «Guarda più tardi»)", r.Saved)
	counts(&b, "Cronologia e «Continua a guardare»", r.History)
	fmt.Fprintf(&b, "Registro degli accessi: %d aggiunti, %d c'erano già, %d più vecchi di 90 giorni lasciati fuori.\n",
		r.Logins.Added, r.Logins.Existing, r.Logins.Old)

	if r.Photos.Added > 0 || r.Photos.Existing > 0 || len(r.Photos.Failed) > 0 {
		fmt.Fprintf(&b, "Foto del profilo: %d aggiunte, %d persone ne avevano già una.\n", r.Photos.Added, r.Photos.Existing)
		list(&b, "  Foto non portate", r.Photos.Failed)
	}

	switch r.Look {
	case LookAdded:
		b.WriteString("Nome e colore del sito: presi dal vecchio.\n")
	case LookKept:
		b.WriteString("Nome e colore del sito: il nuovo ha già i suoi, restano quelli.\n")
	case LookUnreadable:
		b.WriteString("Nome e colore del sito: quelli del vecchio non vanno bene nel nuovo, restano quelli di serie.\n")
	case LookDefault:
	}

	if r.Titles != (Counts{}) {
		fmt.Fprintf(&b, "Titoli cambiati a mano: %d aggiunti, %d video avevano già un titolo scelto nel nuovo",
			r.Titles.Added, r.Titles.Existing)
		if r.Titles.Skipped > 0 {
			fmt.Fprintf(&b, ", %d lasciati fuori perché il video non c'è", r.Titles.Skipped)
		}
		b.WriteString(".\n")
	}
	if r.Categories != (Counts{}) {
		fmt.Fprintf(&b, "Nomi delle categorie cambiati a mano: %d aggiunti, %d categorie avevano già un nome scelto nel nuovo",
			r.Categories.Added, r.Categories.Existing)
		if r.Categories.Skipped > 0 {
			fmt.Fprintf(&b, ", %d lasciati fuori perché nessun video ha più la loro cartella", r.Categories.Skipped)
		}
		b.WriteString(".\n")
	}
	if r.Covers.Added > 0 || r.Covers.Existing > 0 || len(r.Covers.Failed) > 0 {
		fmt.Fprintf(&b, "Copertine scelte a mano: %d aggiunte, %d video ne avevano già una scelta nel nuovo.\n",
			r.Covers.Added, r.Covers.Existing)
		list(&b, "  Copertine non portate", r.Covers.Failed)
	}

	lo := r.LeftOut
	if lo != (LeftOut{}) {
		b.WriteString("\nQueste cose del vecchio restano fuori:\n")
		item(&b, lo.Photos, "foto del profilo (per portarle serve -photos, vedi la guida)")
		item(&b, lo.Subtitles, "sottotitoli fatti da Whisper (il nuovo li può rifare)")
	}

	if len(r.Problems) > 0 {
		b.WriteString("\n")
		list(&b, "Righe del vecchio database che non si leggono, lasciate fuori", r.Problems)
	}
	if !r.Try {
		b.WriteString("\nSi può rilanciare quando si vuole: quello che c'è già non viene aggiunto due volte.\n")
	}
	_, err := io.WriteString(w, b.String())
	return err
}

func list(b *strings.Builder, title string, items []string) {
	if len(items) == 0 {
		return
	}
	fmt.Fprintf(b, "%s: %d\n", title, len(items))
	for i, it := range items {
		if i == maxListed {
			fmt.Fprintf(b, "  … e altri %d\n", len(items)-maxListed)
			break
		}
		fmt.Fprintf(b, "  - %s\n", it)
	}
}

func counts(b *strings.Builder, title string, c Counts) {
	fmt.Fprintf(b, "%s: %d aggiunti, %d c'erano già", title, c.Added, c.Existing)
	if c.Skipped > 0 {
		fmt.Fprintf(b, ", %d lasciati fuori perché il video o la persona non ci sono", c.Skipped)
	}
	b.WriteString(".\n")
}

func item(b *strings.Builder, n int, what string) {
	if n > 0 {
		fmt.Fprintf(b, "  - %d %s\n", n, what)
	}
}
