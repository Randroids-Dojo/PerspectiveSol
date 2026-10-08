import type { Level, Palette, TimeOfDay } from "../sim/types";
import { lum, mix, rgba } from "./util";

/**
 * Art direction for one chapter, derived from the shared palette. Everything
 * the illustrated world paints reads its colours from here so a chapter is one
 * coherent plate.
 */
export type Art = {
  time: TimeOfDay;
  p: Palette;
  seed: number;
  night: boolean;
  /** Sun or moon placement as fractions of the screen, radius as a fraction of height. */
  body: { kind: "sun" | "moon"; x: number; y: number; r: number };
  /** Horizontal direction the light comes from: -1 left, 1 right, 0 above. */
  light: number;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  paper: string;
  paperShade: string;
  gold: string;
  goldLight: string;
  goldDark: string;
  stoneLit: string;
  stone: string;
  stoneMid: string;
  stoneDark: string;
  stoneDeep: string;
  rockTop: string;
  rockMid: string;
  rockTip: string;
  rockLine: string;
  soil: string;
  grassLit: string;
  grass: string;
  grassDark: string;
  foliageLit: string;
  foliage: string;
  foliageDark: string;
  bark: string;
  bronzeLit: string;
  bronze: string;
  bronzeDark: string;
  flowers: string[];
  /** Decoration tint: props behind the walkway are pushed slightly into the air. */
  air: string;
  airAmount: number;
  /** Warm light for lanterns, seeds, the keeper's sun. */
  warm: string;
  warmCore: string;
  /** Rim light colour on edges facing the sun or moon. */
  rim: string;
  fabric: string;
  fabricDark: string;
  /** Danger: rose and crimson are reserved for sentinels. */
  rose: string;
  crimson: string;
  wine: string;
  vermilion: string;
  vermilionLit: string;
  vermilionDark: string;
  ivory: string;
  ivoryShade: string;
};

const BODY: Record<TimeOfDay, Art["body"] & { light: number }> = {
  morning: { kind: "sun", x: 0.2, y: 0.27, r: 0.085, light: -1 },
  noon: { kind: "sun", x: 0.64, y: 0.13, r: 0.075, light: 0.3 },
  afternoon: { kind: "sun", x: 0.8, y: 0.3, r: 0.09, light: 1 },
  dusk: { kind: "sun", x: 0.3, y: 0.6, r: 0.13, light: -1 },
  night: { kind: "moon", x: 0.78, y: 0.2, r: 0.07, light: 1 },
  dawn: { kind: "sun", x: 0.52, y: 0.66, r: 0.12, light: 0 },
};

const FLOWERS: Record<TimeOfDay, string[]> = {
  morning: ["#f4f0e2", "#f2c14e", "#7ba2d9", "#f08a3c"],
  noon: ["#ffffff", "#f6d35b", "#e9835a", "#9c8ad8"],
  afternoon: ["#f6b94a", "#f3e1b0", "#e07b39", "#c9a2e0"],
  dusk: ["#c4a7f0", "#efe2ff", "#f2c76a", "#8f7fd6"],
  night: ["#e6f0ff", "#bfe3ff", "#fff4c2", "#9fb8e8"],
  dawn: ["#ffe7a8", "#ffffff", "#f5b55e", "#b9a6e8"],
};

export function makeArt(level: Level): Art {
  const p = level.theme.palette;
  const time = level.theme.time;
  const night = time === "night";
  const b = BODY[time];
  const ink = p.ink;
  const white = "#fffaf0";
  const dark = lum(p.skyTop) < 0.25;
  const goldBase = night ? "#e2b45c" : mix("#d6a23e", p.sun, 0.15);
  const air = mix(p.fog, p.skyHorizon, 0.35);
  const stoneLit = mix(p.stone, white, night ? 0.08 : 0.42);
  return {
    time,
    p,
    seed: level.theme.seed,
    night,
    body: { kind: b.kind, x: b.x, y: b.y, r: b.r },
    light: b.light,
    ink,
    inkSoft: rgba(ink, 0.55),
    inkFaint: rgba(ink, 0.22),
    paper: mix("#f6eedb", p.cloud, 0.25),
    paperShade: mix("#e3d5b5", p.stoneShade, 0.25),
    gold: goldBase,
    goldLight: mix(goldBase, "#fff6d0", 0.55),
    goldDark: mix(goldBase, "#5a3510", 0.45),
    stoneLit,
    stone: p.stone,
    stoneMid: mix(p.stone, p.stoneShade, 0.45),
    stoneDark: p.stoneShade,
    stoneDeep: mix(p.stoneShade, ink, 0.45),
    rockTop: mix(mix(p.stoneShade, night ? p.stoneShade : "#8a5a3a", 0.35), ink, 0.22),
    rockMid: mix(mix(p.stoneShade, ink, 0.48), p.skyTop, 0.14),
    rockTip: mix(mix(p.stoneShade, p.fog, 0.5), p.skyHorizon, dark ? 0.1 : 0.22),
    rockLine: rgba(mix(ink, p.stoneShade, 0.2), 0.5),
    soil: mix(mix("#6b4a32", p.stoneShade, 0.4), ink, 0.15),
    grassLit: mix(p.grass, night ? "#cfe8ff" : "#fff3b8", night ? 0.18 : 0.38),
    grass: p.grass,
    grassDark: mix(p.grass, ink, 0.38),
    foliageLit: mix(p.foliage, night ? "#bfe0ff" : "#f9f0b0", night ? 0.2 : 0.32),
    foliage: p.foliage,
    foliageDark: mix(p.foliage, ink, 0.42),
    bark: mix(mix("#6d5440", p.stoneShade, 0.3), ink, 0.25),
    bronzeLit: mix(p.bronze, "#ffe9b8", 0.45),
    bronze: p.bronze,
    bronzeDark: mix(p.bronze, ink, 0.5),
    flowers: FLOWERS[time],
    air,
    airAmount: night ? 0.16 : 0.2,
    warm: "#ffc65c",
    warmCore: "#fff3c4",
    rim: night ? "#d8e6ff" : mix(p.sun, white, 0.4),
    fabric: time === "dusk" ? "#6b5aa8" : time === "night" ? "#3e5f8a" : time === "afternoon" ? "#2f6f73" : "#3c6e9a",
    fabricDark: mix(time === "dusk" ? "#6b5aa8" : "#3c6e9a", ink, 0.4),
    rose: "#ff7d96",
    crimson: "#d8203f",
    wine: "#5e0a22",
    vermilion: "#de4a2a",
    vermilionLit: "#f6824e",
    vermilionDark: "#9c2618",
    ivory: "#f8f1df",
    ivoryShade: mix("#d9cdb2", p.fog, 0.25),
  };
}
