// subtitleLabel says in a few letters which subtitles a video has, as the
// old FranzPLAY did: "Sottotitoli IT/EN". "" when it has none.
export function subtitleLabel(tracks) {
    if (tracks.length === 0)
        return "";
    const langs = [
        ...new Set(tracks
            .map((t) => t.lang.split("-")[0]?.toUpperCase() ?? "")
            .filter((lang) => /^[A-Z]{2,3}$/.test(lang))),
    ];
    return langs.length > 0 ? `Sottotitoli ${langs.join("/")}` : "Sottotitoli";
}
