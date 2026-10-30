import {
  cueLines,
  defaultSubtitleStyle,
  linesAt,
  parseSubtitleStyle,
  subtitleCSS,
  subtitlePreviewCSS,
} from "./subtitleStyle";

describe("parseSubtitleStyle", () => {
  it("keeps a valid style", () => {
    const style = { size: "huge", color: "yellow", background: "black", position: "top" };
    expect(parseSubtitleStyle(style)).toEqual(style);
  });

  it("replaces unknown values with the defaults", () => {
    expect(parseSubtitleStyle({ size: "enormous", color: "yellow" })).toEqual({
      ...defaultSubtitleStyle,
      color: "yellow",
    });
    expect(parseSubtitleStyle(null)).toEqual(defaultSubtitleStyle);
    expect(parseSubtitleStyle("big")).toEqual(defaultSubtitleStyle);
  });
});

describe("subtitleCSS", () => {
  it("draws the chosen look", () => {
    const css = subtitleCSS({
      size: "large",
      color: "yellow",
      background: "shadow",
      position: "top",
    });
    expect(css.fontSize).toBe("max(14px, 5cqh)");
    expect(css.color).toBe("#ffe14d");
    expect(css.backgroundColor).toBe("transparent");
    expect(css.textShadow).not.toBe("none");
  });

  it("has no shadow on a background", () => {
    expect(subtitleCSS(defaultSubtitleStyle).textShadow).toBe("none");
  });
});

describe("subtitlePreviewCSS", () => {
  it("looks like the subtitles, in a size that fits the preview", () => {
    const style = { ...defaultSubtitleStyle, size: "huge", color: "yellow" } as const;
    const css = subtitlePreviewCSS(style);
    expect(css.color).toBe(subtitleCSS(style).color);
    expect(css.fontSize).toBe("max(14px, min(6.5cqh, 28.0px))");
  });

  it("keeps the proportions between the sizes", () => {
    const size = (size: "small" | "large") =>
      subtitlePreviewCSS({ ...defaultSubtitleStyle, size }).fontSize;
    expect(size("small")).toBe("max(14px, min(3cqh, 12.9px))");
    expect(size("large")).toBe("max(14px, min(5cqh, 21.5px))");
  });
});

describe("cueLines", () => {
  it.each([
    ["Ciao", ["Ciao"]],
    ["Prima riga\nSeconda riga", ["Prima riga", "Seconda riga"]],
    ["<i>Corsivo</i> e <b>grassetto</b>", ["Corsivo e grassetto"]],
    ["<v Giulia>Eccomi</v>", ["Eccomi"]],
    ["<script>alert(1)</script>Ciao", ["alert(1)Ciao"]],
    ["Tom &amp; Jerry &lt;3", ["Tom & Jerry <3"]],
    ["\n  \n", []],
  ])("%j", (text, want) => {
    expect(cueLines(text)).toEqual(want);
  });
});

describe("linesAt", () => {
  const cues = [
    { startTime: 1, endTime: 3, text: "Ciao" },
    { startTime: 2, endTime: 4, text: "<i>a tutti</i>" },
  ];
  it.each([
    [0, []],
    [1, ["Ciao"]],
    [2.5, ["Ciao", "a tutti"]],
    [3, ["a tutti"]],
    [4, []],
  ])("at %s seconds", (time, lines) => {
    expect(linesAt(cues, time)).toEqual(lines);
  });
});
