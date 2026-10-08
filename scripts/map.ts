/**
 * Draws chapter layouts as SVG blueprints: a top view (x by depth) and a side
 * view (x by height), for designing and reviewing levels.
 *
 *   npx tsx scripts/map.ts [outDir]   (default /tmp/sol-maps)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { LEVELS } from "../src/sim/levels";
import { gallery } from "../src/sim/gallery";
import { HEIGHT } from "../src/sim/constants";
import type { Level } from "../src/sim/types";

const out = process.argv[2] ?? "/tmp/sol-maps";
mkdirSync(out, { recursive: true });
const S = 14;

function svg(l: Level) {
  const x0 = l.bounds.x0 - 2,
    x1 = l.bounds.x1 + 2;
  const zs = [...l.islands.map((i) => [i.z - i.d / 2 - (i.motion?.axis === "z" ? i.motion.range : 0), i.z + i.d / 2 + (i.motion?.axis === "z" ? i.motion.range : 0)]).flat(), ...l.walls.map((w) => [w.z - w.d / 2, w.z + w.d / 2]).flat()];
  const z0 = Math.min(-6, ...zs) - 2,
    z1 = Math.max(6, ...zs) + 2;
  const ys = [...l.islands.map((i) => [i.y - i.h, i.y + (i.motion?.axis === "y" ? i.motion.range : 0)]).flat(), ...l.walls.map((w) => w.y + w.h)];
  const y0 = Math.min(...ys) - 1,
    y1 = Math.max(...ys) + 3;
  const W = (x1 - x0) * S;
  const topH = (z1 - z0) * S;
  const sideH = (y1 - y0) * S;
  const X = (x: number) => (x - x0) * S;
  const Z = (z: number) => (z - z0) * S; // far (negative z) at top
  const Y = (y: number) => topH + 30 + (y1 - y) * S;
  const parts: string[] = [];
  const add = (s: string) => parts.push(s);
  add(`<rect width="${W}" height="${topH + sideH + 60}" fill="#101820"/>`);
  for (let x = Math.ceil(x0 / 5) * 5; x <= x1; x += 5) {
    add(`<line x1="${X(x)}" x2="${X(x)}" y1="0" y2="${topH + sideH + 60}" stroke="#ffffff10"/>`);
    add(`<text x="${X(x) + 2}" y="${topH + 22}" fill="#8899aa" font-size="10">${x}</text>`);
  }
  for (let z = Math.ceil(z0 / 2) * 2; z <= z1; z += 2)
    add(`<line x1="0" x2="${W}" y1="${Z(z)}" y2="${Z(z)}" stroke="${z === 0 ? "#ffffff30" : "#ffffff08"}"/>`);
  for (let y = Math.ceil(y0); y <= y1; y++)
    add(`<line x1="0" x2="${W}" y1="${Y(y)}" y2="${Y(y)}" stroke="${y === 0 ? "#ffffff30" : "#ffffff08"}"/>`);
  add(`<text x="4" y="12" fill="#ccd" font-size="11">${l.index}. ${l.name} (top: far at top)</text>`);
  add(`<text x="4" y="${topH + 44}" fill="#ccd" font-size="11">side (folded view)</text>`);
  const style = (i: Level["islands"][number]) =>
    i.only === "2d"
      ? `fill="#4060ff40" stroke="#80a0ff" stroke-dasharray="4 2"`
      : i.only === "3d"
        ? `fill="#40ffe040" stroke="#80fff0" stroke-dasharray="2 2"`
        : i.lantern && !i.motion
          ? `fill="#ffa04030" stroke="#ffa040" stroke-dasharray="5 3"`
          : i.motion
            ? `fill="#c0904060" stroke="#e0b060"`
            : `fill="#c8c0a860" stroke="#e8e0c8"`;
  for (const i of l.islands) {
    const m = i.motion;
    // top view
    add(`<rect x="${X(i.x - i.w / 2)}" y="${Z(i.z - i.d / 2)}" width="${i.w * S}" height="${i.d * S}" ${style(i)}/>`);
    add(`<text x="${X(i.x) - 4}" y="${Z(i.z) + 4}" fill="#fff" font-size="10">${i.id}</text>`);
    add(`<text x="${X(i.x - i.w / 2) + 2}" y="${Z(i.z + i.d / 2) - 2}" fill="#aab" font-size="8">y${i.y}</text>`);
    if (m && m.axis !== "y") {
      const ax = m.axis === "x";
      add(`<rect x="${X(i.x - i.w / 2 - (ax ? m.range : 0))}" y="${Z(i.z - i.d / 2 - (ax ? 0 : m.range))}" width="${(i.w + (ax ? 2 * m.range : 0)) * S}" height="${(i.d + (ax ? 0 : 2 * m.range)) * S}" fill="none" stroke="#e0b06080" stroke-dasharray="3 3"/>`);
    }
    // side view
    add(`<rect x="${X(i.x - i.w / 2)}" y="${Y(i.y)}" width="${i.w * S}" height="${i.h * S}" ${style(i)}/>`);
    if (m && m.axis !== "z") {
      const ax = m.axis === "x";
      add(`<rect x="${X(i.x - i.w / 2 - (ax ? m.range : 0))}" y="${Y(i.y + (ax ? 0 : m.range))}" width="${(i.w + (ax ? 2 * m.range : 0)) * S}" height="${(i.h + (ax ? 0 : 2 * m.range)) * S}" fill="none" stroke="#e0b06080" stroke-dasharray="3 3"/>`);
    }
    add(`<text x="${X(i.x) - 4}" y="${Y(i.y) + 11}" fill="#fff" font-size="9">${i.id}</text>`);
  }
  for (const w of l.walls) {
    const c = w.kind === "gate" ? "#ff7050" : w.kind === "rock" ? "#8a7a6a" : "#f0f0ff";
    add(`<rect x="${X(w.x - w.w / 2)}" y="${Z(w.z - w.d / 2)}" width="${w.w * S}" height="${w.d * S}" fill="${c}" opacity=".85"/>`);
    add(`<rect x="${X(w.x - w.w / 2)}" y="${Y(w.y + w.h)}" width="${w.w * S}" height="${w.h * S}" fill="${c}" opacity=".6"/>`);
  }
  for (const s of l.sentinels) {
    const m = s.motion;
    add(`<circle cx="${X(s.x)}" cy="${Z(s.z)}" r="${s.r * S}" fill="#ff3060"/>`);
    add(`<circle cx="${X(s.x)}" cy="${Y(s.y)}" r="${s.r * S}" fill="#ff3060"/>`);
    if (m) {
      const dx = m.axis === "x" ? m.range : 0,
        dz = m.axis === "z" ? m.range : 0,
        dy = m.axis === "y" ? m.range : 0;
      add(`<line x1="${X(s.x - dx)}" x2="${X(s.x + dx)}" y1="${Z(s.z - dz)}" y2="${Z(s.z + dz)}" stroke="#ff3060" stroke-width="2"/>`);
      add(`<line x1="${X(s.x - dx)}" x2="${X(s.x + dx)}" y1="${Y(s.y - dy)}" y2="${Y(s.y + dy)}" stroke="#ff3060" stroke-width="2"/>`);
    }
  }
  for (const p of l.pickups) {
    const r = p.kind === "seed" ? 6 : 3;
    const c = p.kind === "seed" ? "#ffd040" : "#fff4c0";
    add(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${r}" fill="${c}"/><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${r}" fill="${c}"/>`);
    if (p.kind === "seed") add(`<text x="${X(p.x) + 7}" y="${Y(p.y) + 3}" fill="#ffd040" font-size="9">${p.id}</text>`);
  }
  for (const l2 of l.lanterns) {
    add(`<rect x="${X(l2.x) - 3}" y="${Z(l2.z) - 3}" width="6" height="6" fill="#ff9020"/>`);
    add(`<rect x="${X(l2.x) - 3}" y="${Y(l2.y + 1.6)}" width="6" height="${1.6 * S}" fill="#ff9020"/>`);
    add(`<text x="${X(l2.x) + 5}" y="${Y(l2.y + 1.6)}" fill="#ff9020" font-size="9">${l2.id}</text>`);
  }
  for (const c of l.checkpoints) {
    add(`<circle cx="${X(c.x)}" cy="${Z(c.z)}" r="5" fill="none" stroke="#50ff90" stroke-width="2"/>`);
    add(`<rect x="${X(c.x) - 6}" y="${Y(c.y) - 3}" width="12" height="3" fill="#50ff90"/>`);
  }
  const e = l.exit;
  add(`<circle cx="${X(e.x)}" cy="${Z(e.z)}" r="8" fill="#c070ff"/><rect x="${X(e.x) - 8}" y="${Y(e.y + 2.5)}" width="16" height="${2.5 * S}" fill="#c070ff"/>`);
  const st = l.start;
  add(`<circle cx="${X(st.x)}" cy="${Z(st.z)}" r="5" fill="#fff"/><rect x="${X(st.x) - 0.3 * S}" y="${Y(st.y + HEIGHT)}" width="${0.6 * S}" height="${HEIGHT * S}" fill="#fff"/>`);
  for (const h of l.hints)
    add(`<rect x="${X(h.x0)}" y="${topH + 26}" width="${(h.x1 - h.x0) * S}" height="4" fill="${h.mode === "2d" ? "#80a0ff" : h.mode === "3d" ? "#80fff0" : "#ffffff"}" opacity=".6"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${topH + sideH + 60}" font-family="monospace">${parts.join("")}</svg>`;
}

for (const l of [...LEVELS, gallery()]) {
  const name = l.id === "gallery" ? "gallery" : `L${l.index}`;
  writeFileSync(`${out}/${name}.svg`, svg(l));
}
console.log(`maps written to ${out}`);
