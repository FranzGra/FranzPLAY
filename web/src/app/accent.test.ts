import { accentChoices, accentVariables, applyAccent, isAccentColor } from "./accent";

describe("accent color", () => {
  it("knows a color as the server keeps it", () => {
    expect(isAccentColor("#dc2626")).toBe(true);
    expect(isAccentColor("#DC2626")).toBe(false);
    expect(isAccentColor("red")).toBe(false);
    expect(isAccentColor("#dc2626;color:red")).toBe(false);
    expect(isAccentColor("")).toBe(false);
  });

  it("offers the 11 colors of the old FranzPLAY", () => {
    expect(accentChoices).toHaveLength(11);
    for (const choice of accentChoices) {
      expect(isAccentColor(choice.value)).toBe(true);
    }
  });

  it("makes the variables of a dark color", () => {
    expect(accentVariables("#dc2626")).toEqual({
      "--color-accent": "#dc2626",
      "--color-accent-light": "#e14747",
      "--color-accent-hover": "#e55c5c",
      "--color-accent-rgb": "220 38 38",
    });
  });

  it("puts dark text on a light color", () => {
    expect(accentVariables("#f5f5a0")["--color-on-accent"]).toBe("var(--color-bg)");
  });

  it("refuses what is not a color", () => {
    expect(() => accentVariables("url(x)")).toThrow();
  });

  it("paints the page and goes back to FranzPLAY's own", () => {
    const root = document.createElement("div");
    applyAccent("#f5f5a0", root);
    expect(root.style.getPropertyValue("--color-accent")).toBe("#f5f5a0");
    expect(root.style.getPropertyValue("--color-on-accent")).toBe("var(--color-bg)");
    applyAccent("#dc2626", root);
    expect(root.style.getPropertyValue("--color-on-accent")).toBe("");
    applyAccent("", root);
    expect(root.style.getPropertyValue("--color-accent")).toBe("");
    expect(root.getAttribute("style")).toBe("");
  });
});
