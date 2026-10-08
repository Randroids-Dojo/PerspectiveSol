import "./style.css";
import { Game, EMPTY, type Input } from "./core";
import { LEVELS } from "./levels";
import { World } from "./world";
import { IllustratedWorld } from "./illustrated-world";
import { Sound } from "./audio";

const sun =
  '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="32" cy="32" r="10"/><circle cx="32" cy="32" r="21"/><path d="M32 1v10m0 42v10M1 32h10m42 0h10M10 10l7 7m30 30l7 7M10 54l7-7m30-30l7-7"/></svg>';
const seed =
  '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="16" cy="16" r="12"/><path d="m16 7 6 9-6 9-6-9Z"/><path d="M4 16h6m12 0h6"/></svg>';
const cube =
  '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="m16 3 12 7v13l-12 7-12-7V10Z M4 10l12 7 12-7 M16 17v13"/></svg>';
const flat =
  '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="5" y="5" width="22" height="22"/><circle cx="16" cy="16" r="6"/></svg>';
const pauseIcon =
  '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="5" y="3" width="3" height="14"/><rect x="12" y="3" width="3" height="14"/></svg>';
const STORE = "perspective-sol:v1",
  SETTINGS = "perspective-sol:settings";
function read(key: string) {
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
const settings = {
  music: 0.55,
  effects: 0.7,
  reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  low: false,
  autoGraphics: true,
  touch: matchMedia("(pointer: coarse)").matches,
};
const stored = read(SETTINGS);
if (stored && typeof stored === "object") {
  for (const k of ["music", "effects"] as const)
    if (typeof stored[k] === "number" && Number.isFinite(stored[k]))
      settings[k] = Math.max(0, Math.min(1, stored[k]));
  for (const k of ["reduced", "low", "autoGraphics", "touch"] as const)
    if (typeof stored[k] === "boolean") settings[k] = stored[k];
}
const game = new Game();
const saved = read(STORE);
let hasSave = game.restore(saved);
const audio = new Sound();
audio.setVolumes(settings.music, settings.effects);
const ui = document.querySelector<HTMLDivElement>("#ui")!;
ui.innerHTML = `<div class="hud hidden" id="hud"><div class="hud-top"><div><div class="chapter" id="chapter"></div><div class="chapter-index" id="chapter-index"></div></div><div class="hud-right"><div class="seeds" id="seeds">${[0, 1, 2].map(() => seed).join("")}<span>Sun seeds</span></div><button class="icon-button" data-action="pause" aria-label="Pause game">${pauseIcon}</button></div></div><div class="hud-controls"><div><kbd>A D / ← →</kbd> Walk <span id="depth-help"> &nbsp; <kbd>W S / ↑ ↓</kbd> Depth</span></div><div><kbd>Space</kbd> Jump &nbsp; <kbd>E</kbd> Kindle &nbsp; <kbd>Esc</kbd> Pause</div></div><button class="view-control" data-action="shift" aria-label="Switch perspective"><span id="view-icon">${cube}</span><span class="label" id="view-label">Unfolded · 3D</span><span class="key">Shift / X</span></button><div class="toast" role="status" aria-live="polite" id="toast"></div><button class="world-prompt" id="prompt" data-action="interact" hidden></button><div class="touch" id="touch"><div class="dpad"><button data-control="up" aria-label="Move away">↑</button><button data-control="left" aria-label="Move left">←</button><button data-control="right" aria-label="Move right">→</button><button data-control="down" aria-label="Move toward camera">↓</button></div><span class="depth-label">Walk / depth</span><div class="touch-actions"><button data-control="interact" aria-label="Kindle observatory">E</button><button data-control="jump" aria-label="Jump">Jump</button></div></div><div class="mote-count">✧ <span id="motes">0</span></div></div><div id="screen"></div>`;
const screen = document.querySelector<HTMLDivElement>("#screen")!,
  hud = document.querySelector<HTMLDivElement>("#hud")!;
let world: World;
try {
  world = new World(document.querySelector<HTMLCanvasElement>("#world")!);
} catch (error) {
  document.querySelector("#loading")!.innerHTML =
    "<p>This observatory needs WebGL to open.<br>Enable hardware acceleration or use a WebGL-capable browser, then reload.</p>";
  throw error;
}
world.reduced = settings.reduced;
world.quality(settings.low);
world.load(game.level);
const illustrated = new IllustratedWorld(
  document.querySelector<HTMLCanvasElement>("#world-2d")!,
);
illustrated.reduced = settings.reduced;
illustrated.load(game.level);
type View =
  | "menu"
  | "play"
  | "pause"
  | "settings"
  | "chapters"
  | "controls"
  | "clear"
  | "ending";
let view: View = "menu";
let returnView: View = "menu";
let keys = new Set<string>(),
  touchKeys = new Map<number, string>();
let pendingFolds = 0;
let interactPulse = false,
  jumpPulse = false;
let toastUntil = 0;
let lastMode = "";
let accumulator = 0,
  last = performance.now(),
  playStarted = false;
let muted = false;
let eventLog: { type: string; time: number; level: number; mode: string }[] =
  [];
let testInput: ((game: Game) => Input) | null = null;
let slowFrames = 0;
const seconds = (v: number) =>
  `${Math.floor(v / 60)}:${Math.floor(v % 60)
    .toString()
    .padStart(2, "0")}`;
function save() {
  hasSave = true;
  if (!write(STORE, game.save()))
    notify(
      "Progress could not be saved in this browser. Keep this tab open.",
      7,
    );
}
function clearInput() {
  keys.clear();
  touchKeys.clear();
  document.querySelectorAll(".held").forEach((b) => b.classList.remove("held"));
  pendingFolds = 0;
  interactPulse = false;
  jumpPulse = false;
  game.lastJump = false;
  game.lastShift = false;
  game.lastInteract = false;
}
function notify(message: string, duration = 5) {
  const t = document.querySelector("#toast")!;
  t.textContent = message;
  t.classList.add("on");
  toastUntil = performance.now() + duration * 1000;
}
function setView(next: typeof view) {
  view = next;
  clearInput();
  hud.classList.toggle("hidden", next !== "play");
  hud.inert = next !== "play";
  screen.innerHTML = "";
  if (next === "play") {
    void audio.pause(false);
    return;
  }
  if (next !== "menu") void audio.pause(next !== "clear" && next !== "ending");
  const panel = (content: string) =>
    `<div class="veil"><section class="panel">${content}</section></div>`;
  if (next === "menu") {
    void audio.pause(!playStarted);
    screen.innerHTML = `<div class="menu"><div class="menu-content"><div class="dojo">${sun} Randroid’s Dojo</div><h1 class="title"><span>Perspective</span><span class="sol">Sol</span></h1><p class="menu-description"><strong>A world with two ways through.</strong><br>Fold the distance. Unfold the impossible.<br>Carry a little light back to the sky.</p><div class="menu-actions"><button class="primary" data-action="begin">${sun}${hasSave && !game.finished ? "Continue the journey" : "Begin the journey"}</button>${hasSave ? '<button class="secondary" data-action="chapters">Observatories</button>' : ""}</div></div><div class="menu-footer"><div class="footer-links"><button data-action="controls">How to play</button><button data-action="settings">Sound & settings</button></div><div class="audio-mark"><i></i><i></i><i></i><span>Best with headphones</span></div></div></div>`;
  }
  if (next === "pause")
    screen.innerHTML = panel(
      `${sun.replace("<svg", '<svg class="sun-emblem"')}<h1>A moment in the clouds.</h1><p>${game.level.name}<br>Your light is safe here.</p><button class="primary" data-action="resume">Return to the journey</button><button class="secondary" data-action="settings">Sound & settings</button><button class="secondary" data-action="chapters">Observatories</button><div><button class="secondary" data-action="retry">Restart chapter</button><button class="secondary" data-action="menu">Title screen</button></div>`,
    );
  if (next === "settings")
    screen.innerHTML = panel(
      `<h1>Make yourself at home.</h1><label class="panel-row">Music<input aria-label="Music volume" type="range" data-setting="music" min="0" max="1" step=".01" value="${settings.music}"></label><label class="panel-row">World sounds<input aria-label="Sound effects volume" type="range" data-setting="effects" min="0" max="1" step=".01" value="${settings.effects}"></label><label class="panel-row">Gentle motion<input type="checkbox" data-setting="reduced" ${settings.reduced ? "checked" : ""}></label><label class="panel-row">Performance mode<input type="checkbox" data-setting="low" ${settings.low ? "checked" : ""}></label><label class="panel-row">Touch controls<input type="checkbox" data-setting="touch" ${settings.touch ? "checked" : ""}></label><button class="primary" data-action="back">Done</button><p class="smallprint" style="margin-top:17px;margin-bottom:0">Progress saves on this device. Shift / X folds the world.<br>M mutes sound. A controller works too.</p>`,
    );
  if (next === "controls")
    screen.innerHTML = panel(
      `<h1>Two ways through.</h1><p>Find three sun seeds in each observatory.<br>In 2D, distant islands become one path.<br>In 3D, walk around walls and sentinels.</p><div class="controls-table"><div><kbd>A D / ← →</kbd>Walk left and right</div><div><kbd>W S / ↑ ↓</kbd>Explore depth in 3D</div><div><kbd>Space</kbd>Jump. Hold to rise higher.</div><div><kbd>Shift / X</kbd>Fold or unfold, even in midair</div><div><kbd>E / Enter</kbd>Kindle the observatory</div><div><kbd>Esc / P</kbd>Pause and settings</div></div><p class="smallprint">Controller: left stick to move, A to jump, X / shoulder to fold, B to kindle, Start to pause. Golden floor rings are checkpoints.</p><button class="primary" data-action="back">Got it</button>`,
    );
  if (next === "chapters")
    screen.innerHTML = panel(
      `<h1>The observatories.</h1><p>Six places. One returning sun.</p><div class="chapter-list">${LEVELS.map((l, i) => `<button class="chapter-choice" data-level="${i}" ${i > game.unlocked ? "disabled" : ""}><span>${i > game.unlocked ? "Unvisited" : game.records[i] !== null ? `Best ${seconds(game.records[i]!)}` : "Awaiting the light"}</span><strong>${l.name}</strong></button>`).join("")}</div><button class="secondary" data-action="back">Return</button>`,
    );
  if (next === "clear")
    screen.innerHTML = panel(
      `${sun.replace("<svg", '<svg class="sun-emblem"')}<h1>${["The garden wakes.", "The courtyard shines.", "The tide turns.", "The archive remembers.", "The night gives way."][game.levelIndex]}</h1><p>${game.level.subtitle}<br>Another observatory waits beyond the clouds.</p><div class="stats"><div><strong>${seconds(game.elapsed)}</strong>Journey time</div><div><strong>${game.shifts}</strong>World folds</div><div><strong>${game.deaths}</strong>Returns to the light</div></div><button class="primary" data-action="next">Follow the light</button><button class="secondary" data-action="menu">Rest here</button>`,
    );
  if (next === "ending")
    screen.innerHTML = panel(
      `${sun.replace("<svg", '<svg class="sun-emblem"')}<h1>And so, the morning returns.</h1><p>You crossed a world in two ways.<br>You found light in its forgotten corners.<br>Now every observatory carries a little of your sun.</p><p class="credits">Thank you for making the journey.</p><div class="stats"><div><strong>6</strong>Observatories restored</div><div><strong>${game.motes}</strong>Light motes found</div><div><strong>${seconds(game.records.reduce<number>((sum, n) => sum + (n ?? 0), 0))}</strong>Total best time</div></div><button class="primary" data-action="chapters">Wander again</button><button class="secondary" data-action="menu">Return to the beginning</button>`,
    );
}
function begin(index?: number) {
  if (index !== undefined) {
    game.loadLevel(index);
    save();
  } else if (game.finished) {
    game.loadLevel(0);
    save();
  }
  world.load(game.level);
  illustrated.load(game.level);
  world.blend = game.mode === "3d" ? 1 : 0;
  playStarted = true;
  setView("play");
  void audio
    .start()
    .then(() =>
      audio.setVolumes(
        muted ? 0 : settings.music,
        muted ? 0 : settings.effects,
      ),
    );
  updateHud();
  notify(game.level.hint, 8);
}
function updateHud() {
  document.querySelector("#chapter")!.textContent = game.level.name;
  document.querySelector("#chapter-index")!.innerHTML = LEVELS.map(
    (_, i) => `<i class="${i <= game.levelIndex ? "on" : ""}"></i>`,
  ).join("");
  const shards = game.snapshot().shards;
  document
    .querySelectorAll("#seeds svg")
    .forEach((s, i) => s.classList.toggle("on", i < shards));
  document.querySelector("#motes")!.textContent = String(game.motes);
  document.querySelector("#touch")!.classList.toggle("show", settings.touch);
  hud.classList.toggle("touch-enabled", settings.touch);
  if (lastMode !== game.mode) {
    lastMode = game.mode;
    document.querySelector("#view-icon")!.innerHTML =
      game.mode === "3d" ? cube : flat;
    document.querySelector("#view-label")!.textContent =
      game.mode === "3d" ? "Unfolded · 3D" : "Folded · 2D";
    document
      .querySelector("#depth-help")!
      .setAttribute("style", game.mode === "2d" ? "opacity:.3" : "");
    document
      .querySelectorAll("[data-control=up],[data-control=down]")
      .forEach((b) => b.classList.toggle("depth-off", game.mode === "2d"));
  }
  const e = game.level.exit,
    b = game.player,
    near =
      Math.abs(b.x - e.x) < 2.4 &&
      Math.abs(b.y - e.y) < 2 &&
      (game.mode === "2d" || Math.abs(b.z - e.z) < 2.4);
  const prompt = document.querySelector<HTMLButtonElement>("#prompt")!;
  prompt.hidden = !near;
  prompt.innerHTML =
    shards === 3
      ? "<kbd>E</kbd> Kindle the observatory"
      : `Find ${3 - shards} more sun ${3 - shards === 1 ? "seed" : "seeds"}`;
}
ui.addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>("button");
  if (!button) return;
  const action = button.dataset.action;
  if (button.dataset.level !== undefined) {
    begin(Number(button.dataset.level));
    return;
  }
  if (action === "begin") {
    begin();
    return;
  }
  if (action === "shift" && view === "play") {
    pendingFolds++;
    return;
  }
  if (action === "interact" && view === "play") {
    interactPulse = true;
    return;
  }
  if (action === "pause" && view === "play") {
    setView("pause");
    return;
  }
  if (action === "resume") {
    setView("play");
    return;
  }
  if (action === "settings" || action === "controls" || action === "chapters") {
    returnView = view;
    setView(action);
    return;
  }
  if (action === "back") {
    setView(returnView);
    return;
  }
  if (action === "menu") {
    save();
    setView("menu");
    return;
  }
  if (action === "retry") {
    begin(game.levelIndex);
    return;
  }
  if (action === "next") {
    begin(game.levelIndex + 1);
    return;
  }
});
ui.addEventListener("input", (e) => {
  const target = e.target as HTMLInputElement;
  const key = target.dataset.setting as keyof typeof settings;
  if (!key) return;
  if (key === "music" || key === "effects")
    settings[key] = Number(target.value);
  else settings[key] = target.checked;
  if (key === "low") settings.autoGraphics = false;
  write(SETTINGS, settings);
  audio.setVolumes(muted ? 0 : settings.music, muted ? 0 : settings.effects);
  world.reduced = settings.reduced;
  illustrated.reduced = settings.reduced;
  if (key === "low") world.quality(settings.low);
  updateHud();
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-control]",
)) {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    touchKeys.set(e.pointerId, button.dataset.control!);
    if (button.dataset.control === "jump") jumpPulse = true;
    if (button.dataset.control === "interact") interactPulse = true;
    button.classList.add("held");
  });
  const release = (e: PointerEvent) => {
    touchKeys.delete(e.pointerId);
    button.classList.remove("held");
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
}
window.addEventListener("keydown", (e) => {
  if ((e.target as Element).matches("input")) return;
  if (
    ["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
      e.code,
    )
  )
    e.preventDefault();
  if (e.repeat) {
    keys.add(e.code);
    return;
  }
  if (e.code === "Escape" || e.code === "KeyP") {
    if (view === "play") setView("pause");
    else if (view === "pause") setView("play");
    else if (view !== "menu") setView(returnView);
    return;
  }
  if (e.code === "KeyM") {
    muted = !muted;
    audio.setVolumes(muted ? 0 : settings.music, muted ? 0 : settings.effects);
    if (view === "play")
      notify(
        muted ? "Sound muted. Press M to listen again." : "Sound restored.",
        2,
      );
    return;
  }
  if (e.code === "Enter" && view === "menu") {
    begin();
    return;
  }
  if (view === "play") {
    if (["ShiftLeft", "ShiftRight", "KeyX"].includes(e.code)) pendingFolds++;
    if (e.code === "Space") jumpPulse = true;
    if (e.code === "KeyE" || e.code === "Enter") interactPulse = true;
  }
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  if (view === "play") setView("pause");
  clearInput();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && view === "play") setView("pause");
});
window.addEventListener("resize", () => {
  world.resize();
  illustrated.resize();
});
let padPause = false;
function input(): Input {
  const touch = [...touchKeys.values()];
  const pads = navigator.getGamepads?.() ?? [];
  const pad = [...pads].find(Boolean);
  let px = 0,
    pz = 0,
    pjump = false,
    pshift = false,
    pinteract = false;
  if (pad) {
    px = Math.abs(pad.axes[0] ?? 0) > 0.16 ? pad.axes[0] : 0;
    pz = Math.abs(pad.axes[1] ?? 0) > 0.16 ? pad.axes[1] : 0;
    if (pad.buttons[14]?.pressed) px = -1;
    if (pad.buttons[15]?.pressed) px = 1;
    if (pad.buttons[12]?.pressed) pz = -1;
    if (pad.buttons[13]?.pressed) pz = 1;
    pjump = !!pad.buttons[0]?.pressed;
    pshift = !!(
      pad.buttons[2]?.pressed ||
      pad.buttons[4]?.pressed ||
      pad.buttons[5]?.pressed
    );
    pinteract = !!pad.buttons[1]?.pressed;
    const start = !!pad.buttons[9]?.pressed;
    if (start && !padPause) {
      if (view === "play") setView("pause");
      else if (view === "pause") setView("play");
    }
    padPause = start;
  }
  const key = (...codes: string[]) => codes.some((c) => keys.has(c));
  return {
    x:
      px +
      (key("KeyD", "ArrowRight") || touch.includes("right") ? 1 : 0) -
      (key("KeyA", "ArrowLeft") || touch.includes("left") ? 1 : 0),
    z:
      pz +
      (key("KeyS", "ArrowDown") || touch.includes("down") ? 1 : 0) -
      (key("KeyW", "ArrowUp") || touch.includes("up") ? 1 : 0),
    jump: pjump || jumpPulse || key("Space") || touch.includes("jump"),
    shift: pshift || key("ShiftLeft", "ShiftRight", "KeyX"),
    interact:
      pinteract ||
      interactPulse ||
      key("KeyE", "Enter") ||
      touch.includes("interact"),
  };
}
function events() {
  for (const e of game.events) {
    eventLog.push({
      type: e.type,
      time: game.time,
      level: game.levelIndex,
      mode: game.mode,
    });
    if (eventLog.length > 300) eventLog.shift();
    world.event(e);
    illustrated.event(e);
    audio.event(e, (e.position.x - game.player.x) / 10);
    if (e.type === "shard") {
      save();
      const n = game.snapshot().shards;
      notify(
        n === 3
          ? "All three sun seeds found. Kindle the observatory ahead."
          : `${n} of 3 sun seeds found.`,
        4,
      );
      updateHud();
    }
    if (e.type === "checkpoint") {
      save();
      notify("A place to return to. Checkpoint lit.", 3);
    }
    if (e.type === "mote") {
      save();
      updateHud();
    }
    if (e.type === "fall")
      notify("Your light returns to the last checkpoint.", 3);
    if (e.type === "locked")
      notify(
        `The observatory needs ${e.value} more sun ${e.value === 1 ? "seed" : "seeds"}.`,
        4,
      );
    if (e.type === "clear") {
      save();
      setView(game.status === "complete" ? "ending" : "clear");
    }
  }
}
function frame(now: number) {
  const rawDt = (now - last) / 1000;
  const dt = Math.min(rawDt, 0.1);
  last = now;
  const controls = input();
  if (view === "play") {
    accumulator += dt;
    let stepped = false;
    while (accumulator >= 1 / 120) {
      const nextInput = testInput?.(game) ?? {
        ...controls,
        shiftPressed: pendingFolds > 0,
      };
      if (!testInput && pendingFolds > 0) pendingFolds--;
      game.step(nextInput, 1 / 120);
      events();
      accumulator -= 1 / 120;
      stepped = true;
      if (view !== "play") break;
    }
    if (stepped) {
      interactPulse = false;
      jumpPulse = false;
    }
    if (
      game.player.grounded &&
      Math.hypot(game.player.vx, game.player.vz) > 0.7
    )
      audio.footstep(game.time, true);
    updateHud();
  } else accumulator = 0;
  if (
    view === "play" &&
    world.blend > 0 &&
    settings.autoGraphics &&
    !settings.low
  ) {
    slowFrames =
      rawDt > 1 / 28 ? slowFrames + rawDt : Math.max(0, slowFrames - dt * 2);
    if (slowFrames > 3) {
      settings.low = true;
      world.quality(true);
      write(SETTINGS, settings);
    }
  }
  if (now > toastUntil)
    document.querySelector("#toast")!.classList.remove("on");
  world.update(
    game,
    dt,
    view === "menu",
    view !== "play" && view !== "menu",
    rawDt,
  );
  const flatOpacity = 1 - world.blend * world.blend * (3 - 2 * world.blend);
  illustrated.update(
    game,
    dt,
    world.flatCamera(),
    flatOpacity,
    view !== "play",
  );
  audio.perspective(world.blend);
  requestAnimationFrame(frame);
}
// Read-only diagnostics expose actual simulation and rendering, with no level-complete shortcut.
Object.assign(window, {
  sol: {
    snapshot: () => ({
      ...game.snapshot(),
      view,
      render: {
        ...world.snapshot(),
        engine:
          world.blend === 0
            ? "canvas2d"
            : world.blend === 1
              ? "webgl"
              : "crossfade",
        projection:
          world.blend === 0
            ? "illustrated-2d"
            : world.blend === 1
              ? "perspective"
              : "transition",
        flat: illustrated.snapshot(),
      },
      audio: audio.snapshot(),
      events: [...eventLog],
      saveAvailable: hasSave,
    }),
    ...(import.meta.env.DEV
      ? {
          game,
          world,
          illustrated,
          audio,
          setInputSource: (source: typeof testInput) => (testInput = source),
        }
      : {}),
  },
});
setView("menu");
updateHud();
const loading = document.querySelector("#loading")!;
loading.classList.add("gone");
setTimeout(() => loading.remove(), 700);
requestAnimationFrame(frame);
