// Colour tokens. Wallet colours are a validated dark-mode categorical
// palette (lightness band, chroma floor, CVD separation and ≥ 3:1 contrast),
// checked against the panel surface #0e1725. On the scatter chart every wallet ALSO gets its
// own marker shape and a direct name label (secondary encoding), because
// past three series not every pair clears the all-pairs CVD floor.

export const SURFACE = "#0e1725";
export const SURFACE_2 = "#111d2f";
export const BORDER = "#26344a";
export const GRID = "#1e2a3d";
export const TEXT_PRIMARY = "#e8edf5";
export const TEXT_SECONDARY = "#a8b7ca";
export const TEXT_MUTED = "#6f7f96";

export const WALLET_COLORS = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#0ca30c", // green
  "#9085e9", // violet
  "#e66767", // red
] as const;

export type MarkerShape = "circle" | "square" | "diamond" | "triangle" | "triangle-down" | "pentagon" | "hexagon" | "cross";
export const WALLET_SHAPES: MarkerShape[] = [
  "circle",
  "square",
  "diamond",
  "triangle",
  "triangle-down",
  "pentagon",
  "hexagon",
  "cross",
];

export function walletColor(slot: number): string {
  return WALLET_COLORS[((slot % WALLET_COLORS.length) + WALLET_COLORS.length) % WALLET_COLORS.length];
}
export function walletShape(slot: number): MarkerShape {
  return WALLET_SHAPES[((slot % WALLET_SHAPES.length) + WALLET_SHAPES.length) % WALLET_SHAPES.length];
}

/** Frontier & special-portfolio inks are neutral so they never read as a wallet. */
export const FRONTIER_INK = "#e8edf5";
export const CAL_INK = "#8fa3bf";
export const ASSET_INK = "#8fa3bf";

/** Sequential blue ramp (dataviz reference, dark-safe steps) for the cloud & heatmap. */
export const SEQ_BLUE = ["#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef"];

/** Diverging blue ↔ red with neutral midpoint (correlation heatmap). */
export const DIVERGING = { negative: [0x39, 0x87, 0xe5], neutral: [0x2a, 0x33, 0x40], positive: [0xe6, 0x67, 0x67] };

export function divergingColor(value: number): string {
  const t = Math.max(-1, Math.min(1, value));
  const pole = t < 0 ? DIVERGING.negative : DIVERGING.positive;
  const a = Math.abs(t);
  const rgb = [0, 1, 2].map((i) => Math.round(DIVERGING.neutral[i] + (pole[i] - DIVERGING.neutral[i]) * a));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

export function shapePath(shape: MarkerShape, cx: number, cy: number, r: number): string {
  const poly = (k: number, rot: number) =>
    Array.from({ length: k }, (_, i) => {
      const a = rot + (2 * Math.PI * i) / k;
      return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    }).join(" L");
  switch (shape) {
    case "square":
      return `M${cx - r * 0.85},${cy - r * 0.85} h${r * 1.7} v${r * 1.7} h${-r * 1.7} Z`;
    case "diamond":
      return `M${cx},${cy - r * 1.15} L${cx + r * 1.15},${cy} L${cx},${cy + r * 1.15} L${cx - r * 1.15},${cy} Z`;
    case "triangle":
      return `M${poly(3, -Math.PI / 2)} Z`;
    case "triangle-down":
      return `M${poly(3, Math.PI / 2)} Z`;
    case "pentagon":
      return `M${poly(5, -Math.PI / 2)} Z`;
    case "hexagon":
      return `M${poly(6, 0)} Z`;
    case "cross": {
      const w = r * 0.45;
      return `M${cx - w},${cy - r} h${2 * w} v${r - w} h${r - w} v${2 * w} h${w - r} v${r - w} h${-2 * w} v${w - r} h${w - r} v${-2 * w} h${r - w} Z`;
    }
    default:
      return `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}
