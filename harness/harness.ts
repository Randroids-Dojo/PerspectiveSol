/**
 * Development harness for the renderers and audio. Not shipped.
 *
 *   /harness.html?level=gallery&time=night&mode=2d&only=3d&x=40&audio=1&info=0
 *
 * level: gallery | 0..5   time: gallery palette   mode: starting perspective
 * only: 3d | 2d to mount one renderer   x,y,z: start position   freeze=1: hold the sim
 * quality=low   reduced=1   info=0 hides the overlay
 *
 * Keys: A/D ←/→ walk, W/S ↑/↓ depth, Space jump, Shift/X fold, R restart,
 * F freeze, . step one frame while frozen, Q toggle quality, I toggle info.
 * window.harness exposes the game, rig, renderers and helpers for scripts.
 */
import type { AudioDirector, Quality, WorldRenderer } from "../src/contract";
import { Game } from "../src/sim/game";
import { gallery } from "../src/sim/gallery";
import { LEVELS } from "../src/sim/levels";
import { STEP } from "../src/sim/constants";
import type { Level, Mode, TimeOfDay } from "../src/sim/types";
import {
  CameraRig,
  FOLD_SECONDS,
  REDUCED_FOLD_SECONDS,
  layerOpacity,
  viewHeightFor,
  type ViewFrame,
} from "../src/view";

const q = new URLSearchParams(location.search);
const levelParam = q.get("level") ?? "gallery";
const only = q.get("only");
let quality: Quality = q.get("quality") === "low" ? "low" : "high";
const reduced = q.get("reduced") === "1";
let frozen = q.get("freeze") === "1";
const info = document.querySelector<HTMLDivElement>("#info")!;
if (q.get("info") === "0") info.classList.add("hidden");

function makeLevel(): Level {
  if (levelParam === "gallery")
    return gallery((q.get("time") as TimeOfDay) ?? "morning");
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, Number(levelParam)))];
}

let level = makeLevel();
let game = new Game(level);
function placeFromQuery() {
  if (q.get("mode")) game.mode = q.get("mode") as Mode;
  const p = game.player;
  for (const k of ["x", "y", "z"] as const)
    if (q.get(k) !== null) p[k] = Number(q.get(k));
  if (q.get("x") !== null && q.get("y") === null) {
    const top = game
      .solids()
      .filter((b) => p.x > b.x0 && p.x < b.x1 && (game.mode === "2d" || (p.z > b.z0 && p.z < b.z1)))
      .sort((a, b) => b.y1 - a.y1)[0];
    if (top) p.y = top.y1;
  }
}
placeFromQuery();

const canvas3d = document.querySelector<HTMLCanvasElement>("#world")!;
const canvas2d = document.querySelector<HTMLCanvasElement>("#world-2d")!;
let r3: WorldRenderer | null = null;
let r2: WorldRenderer | null = null;
let audio: AudioDirector | null = null;
const errors: string[] = [];

async function mount() {
  if (only !== "2d")
    try {
      const m = await import("../src/render3d/index");
      r3 = new m.Sculpted(canvas3d);
    } catch (e) {
      errors.push(`3D: ${(e as Error).stack ?? e}`);
    }
  if (only !== "3d")
    try {
      const m = await import("../src/render2d/index");
      r2 = new m.Illustrated(canvas2d);
    } catch (e) {
      errors.push(`2D: ${(e as Error).stack ?? e}`);
    }
  if (q.get("audio") === "1")
    try {
      const m = await import("../src/audio/index");
      audio = new m.Sound();
    } catch (e) {
      errors.push(`audio: ${(e as Error).stack ?? e}`);
    }
  for (const r of [r3, r2]) {
    r?.setQuality(quality);
    r?.load(level);
  }
  audio?.cue(level.index);
  resize();
}

const rig = new CameraRig();
const view: ViewFrame = {
  width: innerWidth,
  height: innerHeight,
  dpr: Math.min(2, devicePixelRatio || 1),
  focus: { x: 0, y: 0, z: 0 },
  viewHeight: viewHeightFor(innerWidth, innerHeight),
  fold: game.mode === "2d" ? 1 : 0,
  heading: game.mode === "2d" ? "fold" : "unfold",
  sinceSwitch: 9,
  shake: 0,
  reduced,
  cinematic: 0,
};
rig.snap(game, view.viewHeight);
let fixedFold: number | null = q.get("fold") !== null ? Number(q.get("fold")) : null;

function resize() {
  view.width = innerWidth;
  view.height = innerHeight;
  view.dpr = Math.min(2, devicePixelRatio || 1);
  view.viewHeight = viewHeightFor(view.width, view.height);
  r3?.resize(view.width, view.height, view.dpr);
  r2?.resize(view.width, view.height, view.dpr);
}
addEventListener("resize", resize);

const keys = new Set<string>();
let folds = 0;
let jumpLatch = false;
addEventListener("keydown", (e) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  audio?.unlock();
  if (e.repeat) return;
  keys.add(e.code);
  if (["ShiftLeft", "ShiftRight", "KeyX"].includes(e.code)) folds++;
  if (e.code === "Space") jumpLatch = true;
  if (e.code === "KeyR") restart();
  if (e.code === "KeyF") frozen = !frozen;
  if (e.code === "Period" && frozen) advance(STEP);
  if (e.code === "KeyI") info.classList.toggle("hidden");
  if (e.code === "KeyQ") {
    quality = quality === "high" ? "low" : "high";
    r3?.setQuality(quality);
    r2?.setQuality(quality);
  }
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("pointerup", () => audio?.unlock());

function restart() {
  level = makeLevel();
  game = new Game(level);
  placeFromQuery();
  r3?.load(level);
  r2?.load(level);
  rig.snap(game, view.viewHeight);
}

function input() {
  const k = (...c: string[]) => c.some((v) => keys.has(v));
  const x = (k("KeyD", "ArrowRight") ? 1 : 0) - (k("KeyA", "ArrowLeft") ? 1 : 0);
  const z = (k("KeyS", "ArrowDown") ? 1 : 0) - (k("KeyW", "ArrowUp") ? 1 : 0);
  return { x, z, jump: k("Space") || jumpLatch, fold: folds };
}

function advance(dt: number) {
  const i = input();
  game.step(i, dt);
  folds = 0;
  jumpLatch = false;
  for (const e of game.events) {
    r3?.event(e, game);
    r2?.event(e, game);
    if (audio) {
      const s = (r2 ?? r3)?.project(e.position);
      audio.event(e, game, s ? (s.x / view.width) * 2 - 1 : 0);
    }
    if (e.type === "fold") {
      view.heading = e.value === 1 ? "fold" : "unfold";
      view.sinceSwitch = 0;
    }
    if (e.type === "land" && (e.value ?? 0) > 14) rig.kick(0.12);
    if (e.type === "die") rig.kick(0.25);
  }
  if (game.status === "clear") restart();
}

let last = performance.now();
let acc = 0;
let clock = 0;
let fpsTime = 0,
  fpsFrames = 0,
  fps = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  if (!frozen) {
    acc += dt;
    while (acc >= STEP) {
      advance(STEP);
      acc -= STEP;
    }
  } else acc = 0;
  const target = game.mode === "2d" ? 1 : 0;
  const speed = 1 / (reduced ? REDUCED_FOLD_SECONDS : FOLD_SECONDS);
  view.fold =
    fixedFold ?? (view.fold < target ? Math.min(target, view.fold + speed * dt) : Math.max(target, view.fold - speed * dt));
  view.sinceSwitch += dt;
  rig.update(game, frozen ? 0 : dt, view.viewHeight, view.width / view.height);
  view.focus = { ...rig.focus };
  view.shake = rig.shake;
  const layers = layerOpacity(view.fold);
  canvas3d.style.visibility = layers.sculpted > 0 ? "visible" : "hidden";
  canvas2d.style.visibility = layers.flat > 0 ? "visible" : "hidden";
  const frameInput = { game, view, dt: frozen ? 0 : dt, clock, paused: false };
  r3?.frame(frameInput);
  r2?.frame(frameInput);
  audio?.setFold(view.fold);
  audio?.update(game, dt);
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime > 0.5) {
    fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  const p = game.player;
  info.textContent =
    `${level.name} · ${game.mode} · fold ${view.fold.toFixed(2)} · ${fps} fps · ${quality}\n` +
    `x ${p.x.toFixed(2)} y ${p.y.toFixed(2)} z ${p.z.toFixed(2)} ${p.grounded ? "ground" : "air"} ${p.support ?? ""} ${game.status}\n` +
    `seeds ${game.seeds}/${game.seedTotal} motes ${game.motes}/${game.moteTotal} lit ${[...game.lit.keys()].join(",")} ghosts ${[...game.ghosts].join(",")}` +
    (errors.length ? `\n${errors.join("\n")}` : "");
  requestAnimationFrame(frame);
}

Object.assign(window, {
  harness: {
    get game() {
      return game;
    },
    rig,
    view,
    get r3() {
      return r3;
    },
    get r2() {
      return r2;
    },
    get audio() {
      return audio;
    },
    errors,
    /** Place the keeper; y defaults to the top of whatever is underneath. */
    teleport(x: number, z = game.player.z, y?: number) {
      const p = game.player;
      p.x = x;
      p.z = z;
      if (y !== undefined) p.y = y;
      else {
        const top = game
          .solids()
          .filter((b) => x > b.x0 && x < b.x1 && (game.mode === "2d" || (z > b.z0 && z < b.z1)))
          .sort((a, b) => b.y1 - a.y1)[0];
        if (top) p.y = top.y1;
      }
      p.vx = p.vy = p.vz = 0;
      rig.snap(game, view.viewHeight);
    },
    /** Switch perspective; instant skips the transition. */
    setMode(m: Mode, instant = false) {
      if (game.mode !== m) game.toggleMode();
      if (instant) view.fold = m === "2d" ? 1 : 0;
    },
    /** Pin the transition at a value (null releases it). */
    setFold(v: number | null) {
      fixedFold = v;
      if (v !== null) view.fold = v;
    },
    freeze(v: boolean) {
      frozen = v;
    },
    /** Advance the simulation by n fixed steps with an optional held input. */
    step(n: number, held: Partial<ReturnType<typeof input>> = {}) {
      for (let i = 0; i < n; i++) {
        game.step({ ...input(), ...held, fold: 0 }, STEP);
        for (const e of game.events) {
          r3?.event(e, game);
          r2?.event(e, game);
        }
      }
    },
    lightAll() {
      for (const l of level.lanterns) game.lit.set(l.id, game.time - 10);
    },
    restart,
  },
});

void mount().then(() => requestAnimationFrame(frame));
