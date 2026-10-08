import * as THREE from "three";
import type { Palette, TimeOfDay } from "../sim/types";
import { col, mixCol, scaleCol, shiftCol } from "./util";

/** Linear-space chapter colours, derived from the shared palette. */
export type Pal = {
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  sun: THREE.Color;
  cloud: THREE.Color;
  fog: THREE.Color;
  stone: THREE.Color;
  stoneShade: THREE.Color;
  grass: THREE.Color;
  foliage: THREE.Color;
  bronze: THREE.Color;
  accent: THREE.Color;
  ink: THREE.Color;
  /** Derived. */
  earth: THREE.Color;
  rock: THREE.Color;
  rockDeep: THREE.Color;
  gold: THREE.Color;
  grassDry: THREE.Color;
  leafLight: THREE.Color;
  bark: THREE.Color;
  danger: THREE.Color;
  dangerHot: THREE.Color;
  scarf: THREE.Color;
  ivory: THREE.Color;
};

export function makePal(p: Palette, time: TimeOfDay): Pal {
  const night = time === "night";
  return {
    skyTop: col(p.skyTop),
    skyHorizon: col(p.skyHorizon),
    sun: col(p.sun),
    cloud: col(p.cloud),
    fog: col(p.fog),
    stone: col(p.stone),
    stoneShade: col(p.stoneShade),
    grass: col(p.grass),
    foliage: col(p.foliage),
    bronze: col(p.bronze),
    accent: col(p.accent),
    ink: col(p.ink),
    earth: mixCol(mixCol(p.stoneShade, "#8a6a4a", 0.45), p.ink, night ? 0.25 : 0.12),
    rock: mixCol(p.stoneShade, p.stone, 0.35),
    rockDeep: mixCol(p.stoneShade, p.ink, 0.62),
    gold: mixCol(p.accent, "#e8b04a", 0.65),
    grassDry: mixCol(p.grass, "#d8c27a", 0.4),
    leafLight: shiftCol(mixCol(p.foliage, p.grass, 0.55), 0, 0.05, 0.06),
    bark: mixCol("#6b5040", p.ink, 0.25),
    danger: col("#d63a4f"),
    dangerHot: col("#ff6f86"),
    scarf: col("#d9472b"),
    ivory: col("#f1e9da"),
  };
}

export type Mood = {
  time: TimeOfDay;
  /** Direction toward the visible sun or moon in the sky. */
  sunDir: THREE.Vector3;
  /** Direction toward the key light used for shading (kept toward the camera for readability). */
  keyDir: THREE.Vector3;
  keyColor: THREE.Color;
  keyIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  envIntensity: number;
  exposure: number;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  fogLow: THREE.Color;
  sunFog: THREE.Color;
  rim: THREE.Color;
  skyTop: THREE.Color;
  skyMid: THREE.Color;
  skyHorizon: THREE.Color;
  skyBelow: THREE.Color;
  sunColor: THREE.Color;
  glow: THREE.Color;
  sunSize: number;
  night: number;
  moon: number;
  stars: number;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  cloudDeep: THREE.Color;
  cloudCover: number;
  keeperLight: number;
  propLight: number;
  bloom: { strength: number; radius: number; threshold: number };
  grade: { lift: THREE.Color; gain: THREE.Color; saturation: number; contrast: number; vignette: number };
  wind: number;
};

const dir = (azDeg: number, elDeg: number) => {
  // az 0 = straight behind the scene (-z), positive toward +x.
  const az = (azDeg * Math.PI) / 180,
    el = (elDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
};

export function makeMood(time: TimeOfDay, p: Pal): Mood {
  const g = (lift: string, gain: string, saturation: number, contrast: number, vignette: number) => ({
    lift: col(lift),
    gain: col(gain),
    saturation,
    contrast,
    vignette,
  });
  type Spec = Omit<Mood, "time" | "skyMid" | "skyHorizon" | "skyBelow" | "fogColor" | "fogLow" | "sunFog" | "night" | "moon" | "stars"> & {
    haze: THREE.Color;
    night?: number;
    stars?: number;
  };
  const finish = (s: Spec): Mood => ({
    ...s,
    time,
    skyMid: mixCol(s.skyTop, s.haze, 0.45),
    skyHorizon: s.haze.clone(),
    skyBelow: mixCol(s.haze, s.cloudShade, 0.25),
    fogColor: s.haze.clone(),
    fogLow: mixCol(s.cloudShade, s.haze, 0.45),
    sunFog: mixCol(s.glow, s.haze, 0.35),
    night: s.night ?? 0,
    moon: s.night ?? 0,
    stars: s.stars ?? 0,
  });
  const common = { fogNear: 38, fogFar: 300, cloudCover: 0.52, keeperLight: 1.6, propLight: 4, sunSize: 0.035, wind: 0.05 };
  switch (time) {
    case "morning":
      return finish({
        ...common,
        sunDir: dir(-36, 13),
        keyDir: new THREE.Vector3(-0.78, 0.56, 0.3).normalize(),
        keyColor: col("#ffd9a6"),
        keyIntensity: 3.6,
        hemiSky: col("#8ab4e0"),
        hemiGround: mixCol(p.grass, "#5a5a48", 0.6),
        hemiIntensity: 0.48,
        envIntensity: 0.36,
        exposure: 0.82,
        rim: scaleCol("#fff0d0", 0.3),
        skyTop: mixCol(p.skyTop, "#245c9c", 0.35),
        haze: mixCol(p.fog, p.skyTop, 0.38),
        sunColor: col("#fff1cc"),
        glow: col("#ffcf92"),
        cloudLit: scaleCol("#fff1dc", 1.08),
        cloudShade: col("#8098c4"),
        cloudDeep: col("#4f6898"),
        fogNear: 46,
        bloom: { strength: 0.55, radius: 0.55, threshold: 1.3 },
        grade: g("#06101e", "#fff6e8", 1.14, 1.12, 0.34),
      });
    case "noon":
      return finish({
        ...common,
        sunDir: dir(20, 62),
        keyDir: new THREE.Vector3(0.5, 0.76, 0.42).normalize(),
        keyColor: col("#ffeccc"),
        keyIntensity: 3.7,
        hemiSky: col("#84b6e8"),
        hemiGround: mixCol(p.stone, "#7d6c52", 0.65),
        hemiIntensity: 0.48,
        envIntensity: 0.38,
        exposure: 0.76,
        rim: scaleCol("#e6f2ff", 0.25),
        skyTop: mixCol(p.skyTop, "#1c5ca8", 0.35),
        haze: mixCol(p.skyHorizon, p.skyTop, 0.3),
        sunColor: col("#fffaf0"),
        glow: col("#fff1d2"),
        cloudLit: scaleCol("#fffaf0", 1.06),
        cloudShade: col("#94aed6"),
        cloudDeep: col("#5f84bc"),
        cloudCover: 0.48,
        sunSize: 0.03,
        fogNear: 48,
        bloom: { strength: 0.45, radius: 0.5, threshold: 1.35 },
        grade: g("#040c1c", "#fff7ea", 1.14, 1.14, 0.32),
      });
    case "afternoon":
      return finish({
        ...common,
        sunDir: dir(40, 18),
        keyDir: new THREE.Vector3(0.78, 0.5, 0.36).normalize(),
        keyColor: col("#ffcf8e"),
        keyIntensity: 3.5,
        hemiSky: col("#8db8c0"),
        hemiGround: mixCol(p.bronze, "#4f4a3a", 0.55),
        hemiIntensity: 0.48,
        envIntensity: 0.38,
        exposure: 0.8,
        rim: scaleCol("#ffdcae", 0.35),
        skyTop: mixCol(p.skyTop, "#1f5f74", 0.3),
        haze: mixCol(p.fog, p.skyTop, 0.3),
        sunColor: col("#fff0cf"),
        glow: col("#ffc278"),
        cloudLit: scaleCol("#ffe4bc", 1.02),
        cloudShade: col("#a19db2"),
        cloudDeep: col("#66788a"),
        fogNear: 46,
        bloom: { strength: 0.55, radius: 0.55, threshold: 1.32 },
        grade: g("#080c12", "#fff2de", 1.12, 1.12, 0.36),
      });
    case "dusk":
      return finish({
        ...common,
        sunDir: dir(34, 3),
        keyDir: new THREE.Vector3(0.82, 0.38, 0.42).normalize(),
        keyColor: col("#ffa877"),
        keyIntensity: 2.2,
        hemiSky: col("#8577c2"),
        hemiGround: col("#3a2a48"),
        hemiIntensity: 0.7,
        envIntensity: 0.55,
        exposure: 0.92,
        rim: scaleCol("#ffb8a0", 0.45),
        skyTop: col("#26245a"),
        haze: col("#a98bb6"),
        sunColor: col("#ffd2a8"),
        glow: col("#ff9466"),
        cloudLit: scaleCol("#ffc6a2", 1.05),
        cloudShade: col("#76659c"),
        cloudDeep: col("#3f3668"),
        stars: 0.25,
        sunSize: 0.045,
        keeperLight: 2.6,
        propLight: 6,
        bloom: { strength: 0.7, radius: 0.6, threshold: 1.2 },
        grade: g("#0c0820", "#fff2ea", 1.1, 1.08, 0.4),
      });
    case "night":
      return finish({
        ...common,
        sunDir: dir(-28, 32),
        keyDir: new THREE.Vector3(-0.55, 0.72, 0.42).normalize(),
        keyColor: col("#b4caff"),
        keyIntensity: 1.6,
        hemiSky: col("#5272b0"),
        hemiGround: col("#1a2440"),
        hemiIntensity: 0.85,
        envIntensity: 0.7,
        exposure: 1.12,
        rim: scaleCol("#9cb8ff", 0.5),
        skyTop: col("#040917"),
        haze: col("#1a2c50"),
        sunColor: col("#eef3ff"),
        glow: col("#3d5c9c"),
        cloudLit: col("#6a86c0"),
        cloudShade: col("#22325a"),
        cloudDeep: col("#0c162e"),
        night: 1,
        stars: 1,
        sunSize: 0.045,
        keeperLight: 4.5,
        propLight: 9,
        fogNear: 30,
        fogFar: 240,
        bloom: { strength: 0.7, radius: 0.6, threshold: 1.1 },
        grade: g("#02040c", "#f0f4ff", 1.06, 1.1, 0.48),
      });
    case "dawn":
      return finish({
        ...common,
        sunDir: dir(-14, 3.5),
        keyDir: new THREE.Vector3(-0.76, 0.44, 0.48).normalize(),
        keyColor: col("#ffc68c"),
        keyIntensity: 2.9,
        hemiSky: col("#9a8ccc"),
        hemiGround: col("#5d4242"),
        hemiIntensity: 0.62,
        envIntensity: 0.55,
        exposure: 0.86,
        rim: scaleCol("#ffcfa0", 0.45),
        skyTop: col("#38457f"),
        haze: col("#e2ac9e"),
        sunColor: col("#fff1c6"),
        glow: col("#f0a066"),
        cloudLit: scaleCol("#ffd6a8", 1.1),
        cloudShade: col("#8c7aac"),
        cloudDeep: col("#544a80"),
        stars: 0.12,
        sunSize: 0.05,
        keeperLight: 2.2,
        propLight: 5,
        bloom: { strength: 0.5, radius: 0.55, threshold: 1.45 },
        grade: g("#0a0816", "#fff4e6", 1.12, 1.07, 0.38),
      });
  }
}
