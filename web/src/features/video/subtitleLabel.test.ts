import type { SubtitleTrack } from "../../api/videos";
import { subtitleLabel } from "./subtitleLabel";

const track = (key: string, lang: string): SubtitleTrack => ({
  key,
  lang,
  label: key,
  src: `/api/videos/7/subtitles/${key}`,
});

describe("subtitleLabel", () => {
  it.each([
    ["no subtitles", [], ""],
    ["one language", [track("a", "it")], "Sottotitoli IT"],
    [
      "two, each once",
      [track("a", "it"), track("b", "en-US"), track("c", "en")],
      "Sottotitoli IT/EN",
    ],
    ["language not known", [track("a", "")], "Sottotitoli"],
    ["known and not known", [track("a", ""), track("b", "fr")], "Sottotitoli FR"],
  ])("%s", (_, tracks, want) => {
    expect(subtitleLabel(tracks)).toBe(want);
  });
});
