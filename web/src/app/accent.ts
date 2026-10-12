// The accent color each person can choose in the profile. The interface
// draws buttons, links and bars with a few CSS variables (styles/global.css);
// a chosen color replaces them on the whole page.

// The accent colors offered ready to pick, the same as in the old FranzPLAY.
export const accentChoices = [
  { name: "Rosso", value: "#dc2626" },
  { name: "Arancione", value: "#ea580c" },
  { name: "Viola", value: "#7c3aed" },
  { name: "Blu", value: "#2563eb" },
  { name: "Oro", value: "#ca8a04" },
  { name: "Ciano", value: "#0891b2" },
  { name: "Verde acqua", value: "#0d9488" },
  { name: "Indaco", value: "#4f46e5" },
  { name: "Rosa", value: "#db2777" },
  { name: "Smeraldo", value: "#10b981" },
  { name: "Ardesia", value: "#64748b" },
] as const;

const hexColor = /^#[0-9a-f]{6}$/;

// isAccentColor tells whether a text is a color as the server keeps it.
export function isAccentColor(value: string): boolean {
  return hexColor.test(value);
}

// The CSS variables a chosen color replaces.
const accentNames = [
  "--color-accent",
  "--color-accent-light",
  "--color-accent-hover",
  "--color-accent-rgb",
  "--color-on-accent",
];

// accentVariables returns the CSS variables that paint the interface with
// color ("#rrggbb"): the color itself, a lighter one for gradients and
// hover, its numbers for see-through shades and, on a light color, dark
// text that stays readable on top of it.
export function accentVariables(color: string): Record<string, string> {
  if (!isAccentColor(color)) {
    throw new Error(`accent: not a color ${JSON.stringify(color)}`);
  }
  const rgb = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
  const towardWhite = (amount: number) =>
    `#${rgb
      .map((c) =>
        Math.round(c + (255 - c) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  const variables: Record<string, string> = {
    "--color-accent": color,
    "--color-accent-light": towardWhite(0.15),
    "--color-accent-hover": towardWhite(0.25),
    "--color-accent-rgb": rgb.join(" "),
  };
  if (brightness(rgb) > 0.6) {
    variables["--color-on-accent"] = "var(--color-bg)";
  }
  return variables;
}

// brightness is how light a color looks to the eye, from 0 to 1.
function brightness([r = 0, g = 0, b = 0]: number[]): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// applyAccent paints the page with color, or with FranzPLAY's own when
// color is "".
export function applyAccent(color: string, root: HTMLElement = document.documentElement) {
  for (const name of accentNames) {
    root.style.removeProperty(name);
  }
  if (color === "") return;
  for (const [name, value] of Object.entries(accentVariables(color))) {
    root.style.setProperty(name, value);
  }
}
