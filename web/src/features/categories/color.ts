import type { Category } from "../../api/videos";

// The colors of a category the administrator gave no color: each name
// always gets the same one, from its letters.
const palette = [
  "#dc2626",
  "#2563eb",
  "#059669",
  "#7c3aed",
  "#d97706",
  "#db2777",
  "#0891b2",
  "#4f46e5",
];

// tileColor is the color of a category's card: the administrator's, or
// one from the palette.
export function tileColor(category: Pick<Category, "name" | "color">): string {
  if (category.color) return category.color;
  let sum = 0;
  for (const ch of category.name) sum = (sum * 31 + (ch.codePointAt(0) ?? 0)) % 1_000_003;
  return palette[sum % palette.length] ?? "#2563eb";
}
