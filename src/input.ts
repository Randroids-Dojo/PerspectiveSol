/**
 * Keyboard, gamepad and touch, merged into one set of game controls. Presses
 * are latched between simulation steps so a quick tap on a slow frame is never
 * lost. The most recently used scheme decides which prompts the UI shows.
 */
export type Scheme = "keyboard" | "gamepad" | "touch";
export type MenuKey = "up" | "down" | "left" | "right" | "confirm" | "back";

const KEYS = {
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  jump: ["Space", "KeyK", "KeyZ"],
  fold: ["ShiftLeft", "ShiftRight", "KeyX", "KeyF", "KeyJ"],
  pause: ["Escape", "KeyP"],
};
const DEAD = 0.2;

export class Controls {
  scheme: Scheme = matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard";
  /** Fires when the active scheme changes. */
  onScheme: (s: Scheme) => void = () => {};
  /** Pause requested from any device. */
  onPause: () => void = () => {};
  /** Menu navigation from keyboard or gamepad. */
  onMenu: (k: MenuKey) => void = () => {};
  /** M key. */
  onMute: () => void = () => {};
  /** Any key, button or tap: used to unlock audio. */
  onGesture: () => void = () => {};
  /** Whether gameplay is live; menus get navigation instead. */
  playing = false;

  private keys = new Set<string>();
  private folds = 0;
  private jumpLatch = false;
  private touchMove = { x: 0, z: 0 };
  private touchJump = false;
  private padPrev: boolean[] = [];
  private padRepeat = 0;
  private padDir: MenuKey | null = null;

  constructor() {
    addEventListener("keydown", (e) => this.keydown(e));
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.clear());
    for (const type of ["pointerup", "touchend", "click", "keydown"])
      addEventListener(type, () => this.onGesture(), { capture: true, passive: true });
  }

  private use(s: Scheme) {
    if (this.scheme === s) return;
    this.scheme = s;
    this.onScheme(s);
  }

  private keydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.matches?.("input[type=range]") && ["ArrowLeft", "ArrowRight"].includes(e.code)) return;
    this.use("keyboard");
    const game = this.playing;
    if (game && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyM" && !e.repeat) this.onMute();
    if (KEYS.pause.includes(e.code) && !e.repeat) {
      e.preventDefault();
      if (game) this.onPause();
      else this.onMenu("back");
      return;
    }
    if (!game) {
      const nav: Record<string, MenuKey> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        KeyW: "up",
        KeyS: "down",
        Backspace: "back",
      };
      if (nav[e.code]) {
        e.preventDefault();
        this.onMenu(nav[e.code]);
      }
      return;
    }
    if (e.repeat) return;
    this.keys.add(e.code);
    if (KEYS.fold.includes(e.code)) this.folds++;
    if (KEYS.jump.includes(e.code)) this.jumpLatch = true;
  }

  /** Touch controls report here. */
  setTouch(x: number, z: number) {
    this.touchMove = { x, z };
    if (x || z) this.use("touch");
  }
  touchJumpDown() {
    this.use("touch");
    this.touchJump = true;
    this.jumpLatch = true;
  }
  touchJumpUp() {
    this.touchJump = false;
  }
  touchFold() {
    this.use("touch");
    this.folds++;
  }

  clear() {
    this.keys.clear();
    this.folds = 0;
    this.jumpLatch = false;
    this.touchMove = { x: 0, z: 0 };
    this.touchJump = false;
  }

  /** Poll gamepads once per frame. Returns analog movement and held buttons. */
  private pad(dt: number) {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return null;
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    const pressed = (i: number) => b(i) && !this.padPrev[i];
    let x = pad.axes[0] ?? 0,
      z = pad.axes[1] ?? 0;
    const mag = Math.hypot(x, z);
    if (mag < DEAD) x = z = 0;
    else {
      const k = Math.min(1, (mag - DEAD) / (1 - DEAD)) / mag;
      x *= k;
      z *= k;
    }
    if (b(14)) x = -1;
    if (b(15)) x = 1;
    if (b(12)) z = -1;
    if (b(13)) z = 1;
    const any = pad.buttons.some((v) => v.pressed) || mag > 0.5;
    if (any) this.use("gamepad");
    if (pressed(9)) {
      if (this.playing) this.onPause();
      else this.onMenu("back");
    }
    if (this.playing) {
      if (pressed(0)) this.jumpLatch = true;
      for (const i of [2, 3, 4, 5, 6, 7]) if (pressed(i)) this.folds++;
    } else {
      if (pressed(0)) this.onMenu("confirm");
      if (pressed(1)) this.onMenu("back");
      const dir: MenuKey | null =
        z < -0.5 ? "up" : z > 0.5 ? "down" : x < -0.5 ? "left" : x > 0.5 ? "right" : null;
      if (dir !== this.padDir) {
        this.padDir = dir;
        this.padRepeat = 0.38;
        if (dir) this.onMenu(dir);
      } else if (dir) {
        this.padRepeat -= dt;
        if (this.padRepeat <= 0) {
          this.padRepeat = 0.14;
          this.onMenu(dir);
        }
      }
    }
    this.padPrev = pad.buttons.map((v) => v.pressed);
    return { x, z, jump: b(0) };
  }

  /** Read the controls for this frame. Call `consume()` after a simulation step uses them. */
  read(dt: number) {
    const k = (codes: string[]) => codes.some((c) => this.keys.has(c));
    const pad = this.pad(dt);
    let x = (k(KEYS.right) ? 1 : 0) - (k(KEYS.left) ? 1 : 0);
    let z = (k(KEYS.down) ? 1 : 0) - (k(KEYS.up) ? 1 : 0);
    x += this.touchMove.x + (pad?.x ?? 0);
    z += this.touchMove.z + (pad?.z ?? 0);
    return {
      x: Math.max(-1, Math.min(1, x)),
      z: Math.max(-1, Math.min(1, z)),
      jump: k(KEYS.jump) || this.touchJump || !!pad?.jump || this.jumpLatch,
      fold: this.folds,
    };
  }

  /** Clear one-shot presses once a simulation step has seen them. */
  consume() {
    this.folds = 0;
    this.jumpLatch = false;
  }
}

/** Labels for prompts, by scheme. */
export function labels(s: Scheme) {
  if (s === "gamepad")
    return { move: "Left stick", depth: "Stick up / down", jump: "A", fold: "X", pause: "Start" };
  if (s === "touch")
    return { move: "The stick", depth: "Stick up / down", jump: "Jump", fold: "Fold", pause: "II" };
  return { move: "A D", depth: "W S", jump: "Space", fold: "Shift", pause: "Esc" };
}
