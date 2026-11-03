import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";
import type { SnapCnTheme } from "@/lib/snap-cn-ui";

// Geist (Vercel, SIL Open Font License), served from public/fonts.
loadFont({ family: "Geist", url: staticFile("fonts/Geist-Variable.woff2"), weight: "100 900" });
loadFont({ family: "Geist Serif", url: staticFile("fonts/GeistSerifVF.woff2"), weight: "100 900" });
loadFont({ family: "Geist Mono", url: staticFile("fonts/GeistMono-Regular.woff2"), weight: "400" });
loadFont({ family: "Geist Mono", url: staticFile("fonts/GeistMono-Medium.woff2"), weight: "500" });

export const SANS = "Geist, sans-serif";
export const SERIF = '"Geist Serif", serif';
export const MONO = '"Geist Mono", monospace';

// Vercel-style monochrome. Oxblood stays only as Folio's brand mark.
export const WHITE = "#ffffff";
export const BLACK = "#0a0a0a";
export const GRAY = "#666666";
export const GRAY_LIGHT = "#a1a1a1";
export const LINE = "#eaeaea";
export const OXBLOOD = "#8c2e26";

// The ending keeps Folio's paper look.
export const PAPER = "#fdfbf7";
export const INK = "#1f1916";
export const MUTED = "#706760";

export const monoTheme: Partial<SnapCnTheme> = {
  background: WHITE,
  foreground: BLACK,
  card: WHITE,
  cardForeground: BLACK,
  popover: WHITE,
  popoverForeground: BLACK,
  primary: BLACK,
  primaryForeground: WHITE,
  secondary: "#f5f5f5",
  secondaryForeground: BLACK,
  muted: "#f5f5f5",
  mutedForeground: GRAY,
  accent: "#f5f5f5",
  accentForeground: BLACK,
  border: LINE,
  input: LINE,
  ring: BLACK,
};
