package video

import (
	"errors"
	"testing"
)

func TestParseNFO(t *testing.T) {
	tests := []struct {
		name string
		data string
		want Details
	}{
		{
			name: "a film written by Jellyfin",
			data: `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<movie>
  <plot><![CDATA[Due amici in viaggio.
Fino al mare.]]></plot>
  <outline>Un viaggio.</outline>
  <title>Il viaggio</title>
  <director>Anna Bianchi</director>
  <studio>Studio Uno</studio>
  <premiered>2001-05-20</premiered>
  <year>2001</year>
</movie>`,
			want: Details{Title: "Il viaggio", Description: "Due amici in viaggio.\nFino al mare.",
				Author: "Anna Bianchi", Date: "2001-05-20"},
		},
		{
			name: "a YouTube video saved as an episode of its channel",
			data: `<episodedetails><title>Gita in montagna</title><showtitle>Famiglia Rossi</showtitle>
				<aired>2019-03-15</aired><plot>Che giornata!</plot></episodedetails>`,
			want: Details{Title: "Gita in montagna", Description: "Che giornata!", Author: "Famiglia Rossi", Date: "2019-03-15"},
		},
		{
			name: "a song: the singer, the short description, a day with the time",
			data: `<musicvideo><title>Canzone</title><artist>  </artist><artist>Mina</artist>
				<outline>Dal vivo.</outline><releasedate>1999-12-31 21:00:00</releasedate></musicvideo>`,
			want: Details{Title: "Canzone", Description: "Dal vivo.", Author: "Mina", Date: "1999-12-31"},
		},
		{
			name: "text cleaned, HTML entities understood",
			data: `<movie><title>Natale&nbsp;2019
				&amp; Capodanno</title></movie>`,
			want: Details{Title: "Natale 2019 & Capodanno"},
		},
		{
			name: "days that are not real are dropped",
			data: `<movie><premiered>2019-02-30</premiered><aired>1800-01-01</aired></movie>`,
			want: Details{},
		},
		{
			name: "only a web address, for Kodi's own search",
			data: "https://www.themoviedb.org/movie/603\n",
			want: Details{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseNFO([]byte(tt.data))
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Errorf("ParseNFO = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestParseNFORefusesWhatIsNotOne(t *testing.T) {
	for _, data := range []string{
		`<movie><title>never closed`,
		`<tvshow><title>A whole series</title></tvshow>`,
		`<?xml version="1.0" encoding="ISO-8859-1"?><movie><title>x</title></movie>`,
	} {
		if _, err := ParseNFO([]byte(data)); !errors.Is(err, ErrBadDetails) {
			t.Errorf("%q: error %v, want ErrBadDetails", data, err)
		}
	}
}

func TestDetailsOr(t *testing.T) {
	a := Details{Title: "Dal json", Date: "2019-03-15"}
	b := Details{Title: "Dal nfo", Description: "Descrizione", Author: "Autore", Date: "2000-01-01"}
	want := Details{Title: "Dal json", Description: "Descrizione", Author: "Autore", Date: "2019-03-15"}
	if got := a.Or(b); got != want {
		t.Errorf("Or = %+v, want %+v", got, want)
	}
}
