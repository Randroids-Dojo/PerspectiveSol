import "./style.css";
import type { AudioDirector, Quality, WorldRenderer } from "./contract";
import { Controls } from "./input";
import { Sound } from "./audio/index";
import { Illustrated } from "./render2d/index";
import { Sculpted } from "./render3d/index";
import { loadProgress, loadSettings, saveProgress, saveSettings, type Settings } from "./save";
import { STEP } from "./sim/constants";
import { Game } from "./sim/game";
import { LEVELS } from "./sim/levels";
import { drive } from "./sim/route";
import { ROUTES } from "./sim/routes";
import { IDLE, type GameEvent, type Input, type Vec3 } from "./sim/types";
import { Interface, type Action, type Screen } from "./ui/ui";
import { mountTouch } from "./ui/touch";
import {
  CameraRig,
  FOLD_SECONDS,
  REDUCED_FOLD_SECONDS,
  layerOpacity,
  viewHeightFor,
  type ViewFrame,
} from "./view";

/**
 * The director: owns the simulation clock, the shared camera and the fold
 * transition, and routes events to the two renderers, the audio and the UI.
 */

type Phase = "title" | "play" | "pause" | "clear" | "ending";

const settings = loadSettings();
const progress = loadProgress();
const controls = new Controls();
const ui = new Interface(document.querySelector<HTMLElement>("#ui")!);
const canvas3d = document.querySelector<HTMLCanvasElement>("#world")!;
const canvas2d = document.querySelector<HTMLCanvasElement>("#world-2d")!;
const haptic = (ms: number) => {
  if (controls.scheme === "touch") navigator.vibrate?.(ms);
};
const touch = mountTouch(document.querySelector<HTMLElement>("#ui")!, controls, haptic);

let sculpted: WorldRenderer | null = null;
try {
  sculpted = new Sculpted(canvas3d);
} catch (error) {
  console.error(error);
}
const flat: WorldRenderer = new Illustrated(canvas2d);
const audio: AudioDirector = new Sound();
const renderers = () => (sculpted ? [sculpted, flat] : [flat]);

let phase: Phase = "title";
let game: Game;
let demo: { game: Game; steps: Generator<Partial<Input>, void, void> } | null = null;
let demoIndex = -1;
let accumulator = 0;
let clock = 0;
let last = performance.now();
let muted = false;
let quality: Quality = settings.quality === "low" ? "low" : "high";
let slowTime = 0;
const eventLog: { type: string; id?: string; t: number; mode: string; level: number }[] = [];
let testInput: ((g: Game) => Partial<Input>) | null = null;
let timeScale = 1;

const rig = new CameraRig();
const view: ViewFrame = {
  width: innerWidth,
  height: innerHeight,
  dpr: Math.min(2, devicePixelRatio || 1),
  focus: { x: 0, y: 0, z: 0 },
  viewHeight: viewHeightFor(innerWidth, innerHeight),
  fold: 0,
  heading: "unfold",
  sinceSwitch: 9,
  shake: 0,
  reduced: settings.reduced,
  cinematic: 1,
};

// --------------------------------------------------------------- helpers

function save() {
  if (phase === "play" || phase === "pause") progress.current = game.chapterState();
  if (!saveProgress(progress)) ui.toast("Progress could not be saved in this browser.", 4, "warn");
}

function load(level: Game) {
  for (const r of renderers()) r.load(level.level);
}

function project(p: Vec3) {
  const r = view.fold > 0.5 || !sculpted ? flat : sculpted;
  return r.project(p);
}

function applyQuality() {
  for (const r of renderers()) r.setQuality(quality);
}

function resize() {
  view.width = innerWidth;
  view.height = innerHeight;
  view.dpr = Math.min(2, devicePixelRatio || 1);
  view.viewHeight = viewHeightFor(view.width, view.height);
  for (const r of renderers()) r.resize(view.width, view.height, view.dpr);
}

function setVolumes() {
  audio.setVolumes(settings.music, settings.effects);
  audio.setMuted(muted);
}

// ----------------------------------------------------------- the title demo

function startDemo() {
  // The title shows the keeper playing through the chapters already reached.
  demoIndex = (demoIndex + 1) % (Math.min(progress.unlocked, LEVELS.length - 1) + 1);
  const index = demoIndex;
  const g = new Game(LEVELS[index]);
  demo = { game: g, steps: drive(g, ROUTES[index]) };
  game = g;
  load(g);
  view.fold = g.mode === "2d" ? 1 : 0;
  rig.snap(g, view.viewHeight);
}

function stepDemo() {
  if (!demo) return;
  const g = demo.game;
  let input: Partial<Input> = {};
  try {
    const next = demo.steps.next();
    if (next.done || g.status !== "playing") {
      if (g.status === "clear" || next.done) startDemo();
      return;
    }
    input = next.value;
  } catch {
    startDemo();
    return;
  }
  g.step({ ...IDLE, ...input });
  for (const e of g.events) {
    for (const r of renderers()) r.event(e, g);
    if (e.type === "fold") {
      view.heading = e.value === 1 ? "fold" : "unfold";
      view.sinceSwitch = 0;
    }
  }
}

// ------------------------------------------------------------------ flow

function startChapter(index: number, resume = false) {
  const state = resume && progress.current?.level === index ? progress.current : undefined;
  demo = null;
  game = new Game(LEVELS[index], state);
  load(game);
  view.fold = game.mode === "2d" ? 1 : 0;
  view.heading = game.mode === "2d" ? "fold" : "unfold";
  view.cinematic = 0;
  rig.snap(game, view.viewHeight);
  accumulator = 0;
  phase = "play";
  ui.hide();
  ui.setChapter(game.level);
  ui.setSeeds(game.seeds);
  ui.setMotes(game.motes, game.moteTotal);
  ui.showHud(true);
  ui.titleCard(game.level);
  controls.clear();
  touch.reset();
  controls.playing = true;
  audio.cue(index);
  audio.setPaused(false);
  audio.stinger("chapter-start");
  progress.current = game.chapterState();
  save();
}

function toTitle() {
  if (phase === "play" || phase === "pause") save();
  phase = "title";
  controls.playing = false;
  ui.showHud(false);
  ui.hideHint();
  view.cinematic = 1;
  startDemo();
  audio.setPaused(false);
  audio.cue("title");
  ui.title(progress, !!progress.current);
}

function pauseGame() {
  if (phase !== "play") return;
  phase = "pause";
  controls.playing = false;
  controls.clear();
  touch.reset();
  audio.setPaused(true);
  audio.stinger("pause");
  ui.pauseMenu(game.level, game.elapsed, game.seeds, game.motes, game.moteTotal);
  save();
}

function resumeGame() {
  if (phase !== "pause") return;
  phase = "play";
  ui.hide();
  controls.clear();
  controls.playing = true;
  last = performance.now();
  audio.setPaused(false);
  audio.stinger("resume");
}

function finishChapter() {
  const i = game.level.index;
  const best = progress.records[i];
  const record = best === null || game.elapsed < best;
  if (record) progress.records[i] = game.elapsed;
  progress.unlocked = Math.max(progress.unlocked, Math.min(LEVELS.length - 1, i + 1));
  const found = new Set(progress.motes[i]);
  for (const p of game.level.pickups) if (p.kind === "mote" && game.collected.has(p.id)) found.add(p.id);
  progress.motes[i] = [...found];
  const lastChapter = i === LEVELS.length - 1;
  if (lastChapter) progress.finished = true;
  progress.current = null;
  phase = "clear";
  controls.playing = false;
  saveProgress(progress);
  ui.hideHint();
  audio.stinger("clear");
  ui.clear({
    level: game.level,
    time: game.elapsed,
    best: record ? null : best,
    record: record && best !== null,
    folds: game.folds,
    deaths: game.deaths,
    motes: game.motes,
    moteTotal: game.moteTotal,
    last: lastChapter,
  });
}

function showEnding() {
  phase = "ending";
  // The sunrise is seen with depth.
  game.mode = "3d";
  ui.showHud(false);
  audio.cue("ending");
  audio.stinger("ending");
  ui.ending(progress);
}

function openSub(screen: "settings" | "chapters" | "howto", from: Screen) {
  ui.push(from);
  if (screen === "settings") ui.settings(settings);
  if (screen === "chapters") ui.chapters(progress);
  if (screen === "howto") ui.howTo();
}

function back() {
  const to = ui.pop();
  if (to === "pause") ui.pauseMenu(game.level, game.elapsed, game.seeds, game.motes, game.moteTotal);
  else if (to === "ending") ui.ending(progress);
  else ui.title(progress, !!progress.current);
}

function setting(key: keyof Settings, value: Settings[keyof Settings]) {
  (settings as Record<string, unknown>)[key] = value;
  saveSettings(settings);
  if (key === "music" || key === "effects") setVolumes();
  if (key === "reduced") view.reduced = settings.reduced;
  if (key === "quality") {
    quality = settings.quality === "low" ? "low" : "high";
    applyQuality();
  }
  if (key === "touch") ui.setScheme(controls.scheme, settings.touch);
}

ui.onAction = (a: Action) => {
  switch (a.type) {
    case "begin":
      progress.current = null;
      startChapter(0);
      break;
    case "continue":
      startChapter(progress.current?.level ?? 0, true);
      break;
    case "chapter":
      if (a.index <= progress.unlocked) startChapter(a.index);
      break;
    case "resume":
      resumeGame();
      break;
    case "restart":
      startChapter(game.level.index);
      break;
    case "checkpoint":
      progress.current = game.chapterState();
      startChapter(game.level.index, true);
      break;
    case "next":
      if (game.level.index === LEVELS.length - 1) showEnding();
      else startChapter(game.level.index + 1);
      break;
    case "title":
      toTitle();
      break;
    case "open":
      openSub(a.screen, ui.screen);
      break;
    case "back":
      back();
      break;
    case "fold":
      if (phase === "play") controls.touchFold();
      break;
    case "pause":
      pauseGame();
      break;
    case "setting":
      setting(a.key, a.value);
      break;
  }
};
ui.onSound = (s) => audio.stinger(s);
controls.onPause = pauseGame;
controls.onMenu = (k) => ui.menu(k);
controls.onMute = () => {
  muted = !muted;
  setVolumes();
  if (phase === "play") ui.toast(muted ? "Sound muted · M to restore" : "Sound restored", 1.8);
};
controls.onGesture = () => audio.unlock();
controls.onScheme = (s) => ui.setScheme(s, settings.touch);
ui.setScheme(controls.scheme, settings.touch);

// ---------------------------------------------------------------- events

function onEvent(e: GameEvent) {
  eventLog.push({ type: e.type, id: e.id, t: Math.round(game.time * 100) / 100, mode: game.mode, level: game.level.index });
  if (eventLog.length > 400) eventLog.shift();
  for (const r of renderers()) r.event(e, game);
  const screen = project(e.position);
  audio.event(e, game, screen ? Math.max(-1, Math.min(1, (screen.x / view.width) * 2 - 1)) : 0);
  switch (e.type) {
    case "fold":
      view.heading = e.value === 1 ? "fold" : "unfold";
      view.sinceSwitch = 0;
      haptic(10);
      break;
    case "seed": {
      const n = e.value ?? game.seeds;
      ui.flySeed(project(e.position), n - 1);
      setTimeout(() => ui.setSeeds(game.seeds), 650);
      ui.toast(
        n >= game.seedTotal
          ? `<b>All three sun seeds.</b> The observatory is waking.`
          : `<b>Sun seed</b> · ${n} of ${game.seedTotal}`,
        3,
        "gold",
      );
      haptic(25);
      save();
      break;
    }
    case "mote":
      ui.setMotes(game.motes, game.moteTotal);
      ui.pulseMotes();
      break;
    case "checkpoint":
      ui.toast("Checkpoint · the sundial remembers you", 2.2);
      save();
      break;
    case "lantern":
      ui.toast("A lantern wakes", 2);
      save();
      break;
    case "locked":
      ui.toast(`The observatory needs ${e.value} more sun ${e.value === 1 ? "seed" : "seeds"}`, 3, "warn");
      break;
    case "die":
      if (settings.shake) rig.kick(0.32);
      haptic(40);
      break;
    case "land":
      if ((e.value ?? 0) > 15 && settings.shake) rig.kick(0.14);
      break;
    case "exit":
      ui.hideHint();
      ui.flash("gold");
      break;
    case "hint": {
      if (!settings.hints) break;
      const h = game.level.hints.find((v) => v.id === e.id);
      if (h) ui.hint(h.text, h.mode ?? null);
      break;
    }
  }
}

// ------------------------------------------------------------------ loop

function frame(now: number) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  clock += dt;
  const live = controls.read(dt);

  if (phase === "play") {
    accumulator += dt * timeScale;
    let steps = 0;
    while (accumulator >= STEP && steps < 14 * timeScale) {
      const input: Input = testInput ? { ...IDLE, ...testInput(game) } : live;
      game.step(input);
      controls.consume();
      live.fold = 0;
      for (const e of game.events) onEvent(e);
      accumulator -= STEP;
      steps++;
      if (game.status === "clear") {
        finishChapter();
        break;
      }
    }
    if (steps >= 14 * timeScale) accumulator = 0;
    rig.update(game, dt, view.viewHeight, view.width / view.height);
  } else if (phase === "title" && demo) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 14) {
      stepDemo();
      accumulator -= STEP;
      steps++;
    }
    rig.update(game, dt, view.viewHeight, view.width / view.height);
  } else accumulator = 0;

  const target = game.mode === "2d" ? 1 : 0;
  const rate = dt / (view.reduced ? REDUCED_FOLD_SECONDS : FOLD_SECONDS);
  view.fold = view.fold < target ? Math.min(target, view.fold + rate) : Math.max(target, view.fold - rate);
  view.sinceSwitch += dt;
  view.focus = { ...rig.focus };
  view.shake = settings.shake ? rig.shake : 0;
  const cinematic = phase === "title" || phase === "ending" ? 1 : 0;
  view.cinematic += (cinematic - view.cinematic) * Math.min(1, dt * (phase === "ending" ? 0.4 : 2.5));

  const layers = layerOpacity(sculpted ? view.fold : 1);
  canvas3d.style.visibility = sculpted && layers.sculpted > 0 ? "visible" : "hidden";
  canvas2d.style.visibility = layers.flat > 0 ? "visible" : "hidden";
  const paused = phase === "pause" || phase === "clear" || phase === "ending";
  const frameInput = { game, view, dt, clock, paused };
  sculpted?.frame(frameInput);
  flat.frame(frameInput);
  audio.setFold(view.fold);
  audio.update(phase === "play" ? game : null, dt);
  ui.setFold(view.fold, game.mode);

  // Automatic graphics: drop to the light setting if the sculpted world struggles.
  if (settings.quality === "auto" && quality === "high" && phase === "play" && view.fold < 1) {
    slowTime = dt > 1 / 40 ? slowTime + dt : Math.max(0, slowTime - dt * 0.5);
    if (slowTime > 2.5) {
      quality = "low";
      applyQuality();
    }
  }
  requestAnimationFrame(frame);
}

// --------------------------------------------------------------- startup

addEventListener("resize", resize);
addEventListener("pagehide", () => {
  if (phase === "play" || phase === "pause") save();
});
addEventListener("blur", () => {
  if (phase === "play") pauseGame();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && phase === "play") pauseGame();
  audio.suspend(document.hidden);
  last = performance.now();
});

resize();
applyQuality();
setVolumes();
startDemo();
ui.title(progress, !!progress.current);
audio.cue("title");
if (!sculpted)
  ui.toast("This browser could not start WebGL, so the world stays folded. Enable hardware acceleration for depth.", 8, "warn");

// Read-only diagnostics for tests; the development build adds an input hook.
Object.assign(window, {
  sol: {
    snapshot: () => ({
      phase,
      screen: ui.screen,
      ...game.snapshot(),
      fold: view.fold,
      focus: { ...view.focus },
      render: {
        engine: view.fold >= 1 || !sculpted ? "canvas2d" : view.fold <= 0 ? "webgl" : "transition",
        sculpted: sculpted?.snapshot() ?? null,
        flat: flat.snapshot(),
        quality,
      },
      audio: audio.snapshot(),
      events: [...eventLog],
      progress: JSON.parse(JSON.stringify(progress)),
    }),
    ...(import.meta.env.DEV
      ? {
          dev: {
            get game() {
              return game;
            },
            setInput: (f: typeof testInput) => (testInput = f),
            speed: (v: number) => (timeScale = v),
            /** Play a chapter's route through the real loop. */
            autoplay(index = game.level.index) {
              const steps = drive(game, ROUTES[index]);
              testInput = () => {
                const n = steps.next();
                return n.done ? {} : n.value;
              };
            },
            project,
          },
        }
      : {}),
  },
});

// The loading veil lifts once the first frames have compiled their shaders.
let framesDrawn = 0;
function lift() {
  if (++framesDrawn < 3) return requestAnimationFrame(lift);
  const loading = document.querySelector("#loading");
  loading?.classList.add("gone");
  setTimeout(() => loading?.remove(), 800);
}
requestAnimationFrame(frame);
requestAnimationFrame(lift);
