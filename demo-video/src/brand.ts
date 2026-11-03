import { loadFont as loadSerif } from "@remotion/google-fonts/SourceSerif4";
import { loadFont as loadSans } from "@remotion/google-fonts/Inter";
import type { SnapCnTheme } from "@/lib/snap-cn-ui";

// Folio's default theme (src/index.css in the app), converted to hex.
export const PAPER = "#fdfbf7";
export const CARD = "#fffefb";
export const INK = "#1f1916";
export const OXBLOOD = "#8c2e26";
export const MUTED = "#706760";
export const SECONDARY = "#f4f1eb";
export const BORDER = "#e4dfd8";

export const SERIF = loadSerif("normal", { weights: ["400", "600"], subsets: ["latin"] }).fontFamily;
export const SANS = loadSans("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;

export const folioTheme: Partial<SnapCnTheme> = {
  background: PAPER,
  foreground: INK,
  card: CARD,
  cardForeground: INK,
  popover: CARD,
  popoverForeground: INK,
  primary: OXBLOOD,
  primaryForeground: PAPER,
  secondary: SECONDARY,
  secondaryForeground: INK,
  muted: SECONDARY,
  mutedForeground: MUTED,
  accent: "#f3ede5",
  accentForeground: INK,
  border: BORDER,
  input: BORDER,
  ring: OXBLOOD,
};
