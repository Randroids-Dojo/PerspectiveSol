import type { ChapterState } from "./sim/game";
import { LEVELS } from "./sim/levels";

/** Local progress and settings. Corrupt or foreign data is ignored, never trusted. */

export type Progress = {
  version: 2;
  /** Highest chapter that may be played. */
  unlocked: number;
  /** Best finishing time per chapter. */
  records: (number | null)[];
  /** Mote ids ever found per chapter. */
  motes: string[][];
  finished: boolean;
  /** The chapter in progress, resumed by Continue. */
  current: ChapterState | null;
};

export type Settings = {
  music: number;
  effects: number;
  reduced: boolean;
  quality: "auto" | "high" | "low";
  touch: "auto" | "on" | "off";
  shake: boolean;
  hints: boolean;
};

const PROGRESS = "perspective-sol:progress";
const LEGACY = "perspective-sol:v1";
const SETTINGS = "perspective-sol:settings:v2";
const N = LEVELS.length;

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function freshProgress(): Progress {
  return {
    version: 2,
    unlocked: 0,
    records: Array(N).fill(null),
    motes: Array.from({ length: N }, () => []),
    finished: false,
    current: null,
  };
}

const isTime = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v > 0);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

function chapterState(v: unknown): ChapterState | null {
  if (!v || typeof v !== "object") return null;
  const s = v as ChapterState;
  if (!Number.isInteger(s.level) || s.level < 0 || s.level >= N) return null;
  if (s.checkpoint !== null && typeof s.checkpoint !== "string") return null;
  if (!isStrings(s.collected) || !isStrings(s.lit)) return null;
  for (const k of ["elapsed", "deaths", "folds"] as const)
    if (typeof s[k] !== "number" || !Number.isFinite(s[k]) || s[k] < 0) return null;
  if (s.mode !== "2d" && s.mode !== "3d") return null;
  return {
    level: s.level,
    checkpoint: s.checkpoint,
    collected: s.collected,
    lit: s.lit,
    elapsed: s.elapsed,
    deaths: s.deaths,
    folds: s.folds,
    mode: s.mode,
  };
}

export function loadProgress(): Progress {
  const raw = read(PROGRESS) as Progress | null;
  if (raw && raw.version === 2) {
    const p = freshProgress();
    if (Number.isInteger(raw.unlocked)) p.unlocked = Math.max(0, Math.min(N - 1, raw.unlocked));
    if (Array.isArray(raw.records) && raw.records.length === N && raw.records.every(isTime))
      p.records = raw.records;
    if (Array.isArray(raw.motes) && raw.motes.length === N && raw.motes.every(isStrings)) p.motes = raw.motes;
    p.finished = raw.finished === true;
    p.current = chapterState(raw.current);
    if (p.current && p.current.level > p.unlocked) p.current = null;
    return p;
  }
  // The first release saved chapter unlocks and records; the chapters have since been rebuilt.
  const legacy = read(LEGACY) as { version?: number; unlocked?: number; finished?: boolean } | null;
  const p = freshProgress();
  if (legacy && legacy.version === 1 && Number.isInteger(legacy.unlocked)) {
    p.unlocked = Math.max(0, Math.min(N - 1, legacy.unlocked!));
    p.finished = legacy.finished === true;
  }
  return p;
}

export function saveProgress(p: Progress) {
  return write(PROGRESS, p);
}

export function defaultSettings(): Settings {
  return {
    music: 0.6,
    effects: 0.8,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    quality: "auto",
    touch: "auto",
    shake: true,
    hints: true,
  };
}

export function loadSettings(): Settings {
  const s = defaultSettings();
  const raw = read(SETTINGS) as Partial<Settings> | null;
  if (!raw || typeof raw !== "object") return s;
  for (const k of ["music", "effects"] as const)
    if (typeof raw[k] === "number" && Number.isFinite(raw[k])) s[k] = Math.max(0, Math.min(1, raw[k]!));
  for (const k of ["reduced", "shake", "hints"] as const) if (typeof raw[k] === "boolean") s[k] = raw[k]!;
  if (raw.quality === "auto" || raw.quality === "high" || raw.quality === "low") s.quality = raw.quality;
  if (raw.touch === "auto" || raw.touch === "on" || raw.touch === "off") s.touch = raw.touch;
  return s;
}

export function saveSettings(s: Settings) {
  return write(SETTINGS, s);
}
