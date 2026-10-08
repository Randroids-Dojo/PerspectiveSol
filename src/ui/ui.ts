import type { Scheme, MenuKey } from "../input";
import { labels } from "../input";
import type { Progress, Settings } from "../save";
import { LEVELS } from "../sim/levels";
import type { Level, Mode } from "../sim/types";
import { NUMERALS, arrow, cube, lock, mote, pause, seed, square, sun } from "./icons";

export type Screen = "none" | "title" | "pause" | "settings" | "chapters" | "howto" | "clear" | "ending";

export type Action =
  | { type: "begin" }
  | { type: "continue" }
  | { type: "chapter"; index: number }
  | { type: "resume" }
  | { type: "restart" }
  | { type: "checkpoint" }
  | { type: "next" }
  | { type: "title" }
  | { type: "open"; screen: "settings" | "chapters" | "howto" }
  | { type: "back" }
  | { type: "fold" }
  | { type: "pause" }
  | { type: "setting"; key: keyof Settings; value: Settings[keyof Settings] };

export type ClearStats = {
  level: Level;
  time: number;
  best: number | null;
  record: boolean;
  folds: number;
  deaths: number;
  motes: number;
  moteTotal: number;
  last: boolean;
};

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Replace {fold}, {jump}, {move}, {depth} with key chips for the active scheme. */
export function promptHtml(text: string, scheme: Scheme) {
  const l = labels(scheme) as Record<string, string>;
  return esc(text).replace(/\{(\w+)\}/g, (_, k) => (l[k] ? `<kbd>${esc(l[k])}</kbd>` : k));
}

export class Interface {
  onAction: (a: Action) => void = () => {};
  /** Plays UI sounds. */
  onSound: (s: "ui-move" | "ui-select" | "ui-back") => void = () => {};
  screen: Screen = "none";
  scheme: Scheme = "keyboard";
  private root: HTMLElement;
  private hud: HTMLElement;
  private panel: HTMLElement;
  private fx: HTMLElement;
  private hintTimer = 0;
  private toastTimer = 0;
  private hintMode: Mode | null = null;
  private seedsShown = -1;
  private cardUntil = 0;
  private pendingHint = 0;
  private backAction: Action = { type: "back" };
  private screenStack: Screen[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="hud" id="hud" hidden>
        <header class="hud-top">
          <div class="chapter-mark"><span class="numeral" id="hud-numeral"></span><span class="name" id="hud-name"></span></div>
          <div class="hud-right">
            <div class="motes" id="hud-motes" aria-label="Light motes">${mote("mote-icon")}<b id="hud-mote-count">0</b><span id="hud-mote-total">/0</span></div>
            <div class="sockets" id="hud-seeds" aria-label="Sun seeds"></div>
            <button class="round" data-act="pause" aria-label="Pause">${pause()}</button>
          </div>
        </header>
        <button class="perspective" data-act="fold" aria-label="Fold or unfold the world" id="hud-perspective">
          <span class="seg seg-2d">${square()}<span>Flat</span></span>
          <span class="seg seg-3d">${cube()}<span>Depth</span></span>
          <span class="glider" aria-hidden="true"></span>
          <kbd id="hud-fold-key">Shift</kbd>
        </button>
        <div class="hint" id="hint" role="status" aria-live="polite"></div>
        <div class="toast" id="toast" role="status" aria-live="polite"></div>
        <div class="title-card" id="title-card" aria-hidden="true"></div>
        <div class="touch" id="touch" hidden>
          <div class="stick-zone" id="stick-zone"><div class="stick" id="stick"><div class="stick-ring"></div><div class="stick-knob" id="stick-knob"></div></div></div>
          <button class="touch-fold" id="touch-fold" aria-label="Fold">${square("fold-flat")}${cube("fold-deep")}<span>Fold</span></button>
          <button class="touch-jump" id="touch-jump" aria-label="Jump"><span>Jump</span></button>
        </div>
      </div>
      <div class="screen" id="screen" hidden></div>
      <div class="fx" id="fx" aria-hidden="true"></div>
      <div class="flash" id="flash" aria-hidden="true"></div>`;
    this.hud = root.querySelector("#hud")!;
    this.panel = root.querySelector("#screen")!;
    this.fx = root.querySelector("#fx")!;
    root.addEventListener("click", (e) => {
      const el = (e.target as Element).closest<HTMLElement>("[data-act]");
      if (!el || (el as HTMLButtonElement).disabled) return;
      const act = el.dataset.act!;
      if (act === "fold" || act === "pause") {
        this.onAction({ type: act });
        return;
      }
      if (act === "chapter") this.onAction({ type: "chapter", index: Number(el.dataset.index) });
      else if (act === "open") this.onAction({ type: "open", screen: el.dataset.screen as "settings" });
      else if (act === "choice") {
        const key = el.dataset.key as keyof Settings;
        this.onAction({ type: "setting", key, value: el.dataset.value as Settings[keyof Settings] });
        el.parentElement!.querySelectorAll("[data-act=choice]").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
      } else if (act === "toggle") {
        const on = el.getAttribute("aria-pressed") !== "true";
        el.setAttribute("aria-pressed", String(on));
        this.onAction({ type: "setting", key: el.dataset.key as keyof Settings, value: on });
      } else this.onAction({ type: act } as Action);
      this.onSound(act === "back" ? "ui-back" : "ui-select");
    });
    root.addEventListener("input", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.key) this.onAction({ type: "setting", key: t.dataset.key as keyof Settings, value: Number(t.value) });
    });
    root.addEventListener("pointerover", (e) => {
      const b = (e.target as Element).closest<HTMLElement>(".screen button:not(:disabled)");
      if (b && document.activeElement !== b && e.pointerType === "mouse") {
        b.focus({ preventScroll: true });
        this.onSound("ui-move");
      }
    });
  }

  // ------------------------------------------------------------------ HUD

  showHud(on: boolean) {
    this.hud.hidden = !on;
  }

  setChapter(level: Level) {
    this.root.style.setProperty("--accent", level.theme.palette.accent);
    this.text("#hud-numeral", `Chapter ${NUMERALS[level.index]}`);
    this.text("#hud-name", level.name);
    const total = level.pickups.filter((p) => p.kind === "seed").length;
    this.root.querySelector("#hud-seeds")!.innerHTML = Array.from(
      { length: total },
      (_, i) => `<span class="socket" data-i="${i}">${seed()}</span>`,
    ).join("");
    this.seedsShown = -1;
    this.hideHint();
  }

  setSeeds(n: number) {
    if (n === this.seedsShown) return;
    this.root.querySelectorAll<HTMLElement>("#hud-seeds .socket").forEach((s, i) => {
      const was = s.classList.contains("on");
      s.classList.toggle("on", i < n);
      if (!was && i < n && this.seedsShown >= 0) {
        s.classList.remove("arrive");
        void s.offsetWidth;
        s.classList.add("arrive");
      }
    });
    this.root.querySelector("#hud-seeds")!.classList.toggle("complete", n >= 3);
    this.seedsShown = n;
  }

  setMotes(n: number, total: number) {
    this.text("#hud-mote-count", String(n));
    this.text("#hud-mote-total", `/${total}`);
  }

  /** Bump the mote counter. */
  pulseMotes() {
    const m = this.root.querySelector("#hud-motes")!;
    m.classList.remove("pulse");
    void (m as HTMLElement).offsetWidth;
    m.classList.add("pulse");
  }

  /** fold: 0 = depth, 1 = flat. */
  setFold(fold: number, mode: Mode) {
    const el = this.root.querySelector<HTMLElement>("#hud-perspective")!;
    el.style.setProperty("--fold", fold.toFixed(3));
    el.dataset.mode = mode;
    this.root.querySelector("#touch")!.classList.toggle("flat", mode === "2d");
    if (this.hintMode && mode !== this.hintMode) this.hideHint();
  }

  setScheme(s: Scheme, touchSetting: Settings["touch"]) {
    this.scheme = s;
    this.text("#hud-fold-key", labels(s).fold);
    this.root.classList.toggle("scheme-gamepad", s === "gamepad");
    const touch = touchSetting === "on" || (touchSetting === "auto" && s === "touch");
    this.root.querySelector<HTMLElement>("#touch")!.hidden = !touch;
    this.hud.classList.toggle("with-touch", touch);
  }

  hint(text: string, mode: Mode | null, seconds = 7.5) {
    // Never compete with the chapter title card.
    const wait = this.cardUntil - performance.now();
    clearTimeout(this.pendingHint);
    if (wait > 0) {
      this.pendingHint = window.setTimeout(() => this.hint(text, mode, seconds), wait);
      return;
    }
    const el = this.root.querySelector<HTMLElement>("#hint")!;
    el.innerHTML = `${sun("hint-icon")}<p>${promptHtml(text, this.scheme)}</p>`;
    el.classList.add("on");
    this.hintMode = mode;
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hideHint(), seconds * 1000);
  }

  hideHint() {
    clearTimeout(this.pendingHint);
    this.root.querySelector("#hint")?.classList.remove("on");
    this.hintMode = null;
  }

  toast(html: string, seconds = 2.6, tone: "" | "gold" | "warn" = "") {
    const el = this.root.querySelector<HTMLElement>("#toast")!;
    el.innerHTML = html;
    el.className = `toast on ${tone}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove("on"), seconds * 1000);
  }

  titleCard(level: Level) {
    const el = this.root.querySelector<HTMLElement>("#title-card")!;
    el.innerHTML = `<span class="numeral">Chapter ${NUMERALS[level.index]}</span><h2>${esc(level.name)}</h2><p>${esc(level.subtitle)}</p>`;
    el.classList.remove("on");
    void el.offsetWidth;
    el.classList.add("on");
    this.cardUntil = performance.now() + 3200;
  }

  /** A seed flies from where it was taken into its socket. */
  flySeed(from: { x: number; y: number } | null, index: number) {
    const socket = this.root.querySelector<HTMLElement>(`#hud-seeds .socket[data-i="${index}"]`);
    if (!socket || !from) return;
    const to = socket.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "flying-seed";
    el.innerHTML = seed();
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    this.fx.append(el);
    requestAnimationFrame(() => {
      el.style.transform = `translate(${to.left + to.width / 2 - from.x}px, ${to.top + to.height / 2 - from.y}px) scale(.55)`;
      el.style.opacity = "0.2";
    });
    setTimeout(() => el.remove(), 900);
  }

  flash(tone: "light" | "dark" | "gold") {
    const el = this.root.querySelector<HTMLElement>("#flash")!;
    el.className = "flash";
    void el.offsetWidth;
    el.className = `flash on ${tone}`;
  }

  private text(sel: string, t: string) {
    const el = this.root.querySelector(sel);
    if (el && el.textContent !== t) el.textContent = t;
  }

  // -------------------------------------------------------------- screens

  private show(screen: Screen, html: string, back: Action, cls = "") {
    this.screen = screen;
    this.backAction = back;
    this.panel.hidden = false;
    this.panel.className = `screen screen-${screen} ${cls}`;
    this.panel.innerHTML = html;
    this.panel.scrollTop = 0;
    requestAnimationFrame(() => {
      const first = this.panel.querySelector<HTMLElement>("[autofocus], button:not(:disabled), input");
      first?.focus({ preventScroll: true });
    });
  }

  hide() {
    this.screen = "none";
    this.panel.hidden = true;
    this.panel.innerHTML = "";
    this.screenStack = [];
  }

  /** Open a sub screen and remember where to return. */
  push(from: Screen) {
    this.screenStack.push(from);
  }
  pop(): Screen | undefined {
    return this.screenStack.pop();
  }

  title(p: Progress, hasContinue: boolean) {
    const resume = hasContinue && p.current;
    const continueLabel = resume ? `Continue · ${esc(LEVELS[p.current!.level].name)}` : "";
    this.show(
      "title",
      `<div class="title-layout">
        <div class="title-brand">${sun("brand-sun")}<span>Randroid’s Dojo</span></div>
        <h1 class="logo"><span class="logo-a">Perspective</span><span class="logo-b">Sol</span></h1>
        <p class="tagline">Fold the world flat. Unfold it into depth.<br>Carry a little sun home through six floating observatories.</p>
        <nav class="title-menu">
          ${resume ? `<button class="primary" data-act="continue" autofocus>${sun()}<span>${continueLabel}</span></button>` : ""}
          <button class="${resume ? "secondary" : "primary"}" data-act="begin" ${resume ? "" : "autofocus"}>${resume ? "" : sun()}<span>${p.finished ? "Begin again" : resume ? "New journey" : "Begin the journey"}</span></button>
          ${p.unlocked > 0 || p.finished ? `<button class="secondary" data-act="open" data-screen="chapters"><span>Chapters</span></button>` : ""}
          <button class="secondary" data-act="open" data-screen="howto"><span>How to play</span></button>
          <button class="secondary" data-act="open" data-screen="settings"><span>Settings</span></button>
        </nav>
        <footer class="title-foot"><span class="headphones"><i></i><i></i><i></i>Best with headphones</span><span class="credit">An original game. Music and sound made in code.</span></footer>
      </div>`,
      { type: "title" },
      "title-screen",
    );
  }

  pauseMenu(level: Level, elapsed: number, seeds: number, motes: number, moteTotal: number) {
    this.show(
      "pause",
      `<section class="panel">
        ${sun("panel-sun")}
        <span class="numeral">Chapter ${NUMERALS[level.index]} · paused</span>
        <h2>${esc(level.name)}</h2>
        <div class="stats compact"><div><strong>${clock(elapsed)}</strong>Time</div><div><strong>${seeds}/3</strong>Sun seeds</div><div><strong>${motes}/${moteTotal}</strong>Motes</div></div>
        <div class="stack">
          <button class="primary" data-act="resume" autofocus><span>Return to the journey</span></button>
          <button class="secondary" data-act="checkpoint"><span>Back to last checkpoint</span></button>
          <button class="secondary" data-act="restart"><span>Restart chapter</span></button>
          <div class="row">
            <button class="secondary" data-act="open" data-screen="settings"><span>Settings</span></button>
            <button class="secondary" data-act="open" data-screen="howto"><span>How to play</span></button>
          </div>
          <button class="ghost" data-act="title"><span>Title screen</span></button>
        </div>
      </section>`,
      { type: "resume" },
    );
  }

  settings(s: Settings) {
    const choice = (key: keyof Settings, options: [string, string][]) =>
      `<div class="choice" role="group">${options
        .map(([v, label]) => `<button data-act="choice" data-key="${key}" data-value="${v}" aria-pressed="${s[key] === v}">${label}</button>`)
        .join("")}</div>`;
    const toggle = (key: keyof Settings) =>
      `<button class="toggle" data-act="toggle" data-key="${key}" aria-pressed="${s[key]}"><i></i></button>`;
    this.show(
      "settings",
      `<section class="panel wide">
        <span class="numeral">Settings</span>
        <h2>Make yourself at home.</h2>
        <div class="settings">
          <label class="setting"><span>Music</span><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-key="music" aria-label="Music volume"></label>
          <label class="setting"><span>World sounds</span><input type="range" min="0" max="1" step="0.05" value="${s.effects}" data-key="effects" aria-label="Sound effects volume"></label>
          <div class="setting"><span>Graphics</span>${choice("quality", [["auto", "Auto"], ["high", "High"], ["low", "Light"]])}</div>
          <div class="setting"><span>Touch controls</span>${choice("touch", [["auto", "Auto"], ["on", "On"], ["off", "Off"]])}</div>
          <div class="setting"><span>Gentle motion</span>${toggle("reduced")}</div>
          <div class="setting"><span>Screen shake</span>${toggle("shake")}</div>
          <div class="setting"><span>Teaching hints</span>${toggle("hints")}</div>
        </div>
        <button class="primary" data-act="back"><span>Done</span></button>
        <p class="smallprint">Progress saves on this device. M mutes. Controllers work everywhere.</p>
      </section>`,
      { type: "back" },
    );
  }

  howTo() {
    const l = labels(this.scheme);
    this.show(
      "howto",
      `<section class="panel wide">
        <span class="numeral">How to play</span>
        <h2>Two ways through.</h2>
        <div class="rules">
          <figure class="rule">
            <svg viewBox="0 0 220 120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4"><rect x="12" y="74" width="60" height="12" rx="2"/><rect x="92" y="74" width="54" height="12" rx="2" stroke-dasharray="3 3" opacity=".55"/><rect x="152" y="74" width="56" height="12" rx="2"/><path d="M116 70V28" stroke-width="7" stroke-linecap="round" opacity=".9"/></g><circle cx="40" cy="62" r="7" fill="currentColor"/><path d="M96 54c10-12 30-12 40 0" stroke="currentColor" fill="none" stroke-dasharray="2 3"/></svg>
            <figcaption><strong>${square()} Folded · flat</strong>Depth disappears. Islands far apart become one path, and you can touch distant lanterns. But everything at every depth is in your way: walls, rocks and sentinels.</figcaption>
          </figure>
          <figure class="rule">
            <svg viewBox="0 0 220 120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4"><path d="M14 80l40-14 40 14-40 14Z"/><path d="M120 54l34-12 34 12-34 12Z" opacity=".55"/><path d="M84 72v-38l14-5v38" stroke-width="2"/></g><circle cx="54" cy="70" r="7" fill="currentColor"/><path d="M62 74c18 8 34 8 50-2" stroke="currentColor" fill="none" stroke-dasharray="2 3"/></svg>
            <figcaption><strong>${cube()} Unfolded · depth</strong>Depth is real. Walk around walls and past sentinels guarding another depth, and climb sunglass that only exists here. Distant islands are truly distant.</figcaption>
          </figure>
        </div>
        <p class="rules-note">Switch any time, even in midair. Find three sun seeds in each chapter, then bring them to the observatory. Golden floor rings remember your place.</p>
        <div class="controls-grid">
          <div><kbd>${l.move}</kbd>Walk</div>
          <div><kbd>${l.depth}</kbd>Step into depth (3D)</div>
          <div><kbd>${l.jump}</kbd>Jump, hold to rise higher</div>
          <div><kbd>${l.fold}</kbd>Fold or unfold</div>
          <div><kbd>${l.pause}</kbd>Pause</div>
        </div>
        <button class="primary" data-act="back" autofocus><span>Got it</span></button>
      </section>`,
      { type: "back" },
    );
  }

  chapters(p: Progress) {
    this.show(
      "chapters",
      `<section class="panel wide">
        <span class="numeral">The journey</span>
        <h2>Six observatories.</h2>
        <div class="chapter-grid">
          ${LEVELS.map((l, i) => {
            const open = i <= p.unlocked;
            const motes = l.pickups.filter((x) => x.kind === "mote").length;
            const best = p.records[i];
            return `<button class="chapter-card" data-act="chapter" data-index="${i}" ${open ? "" : "disabled"} style="--sky:${l.theme.palette.skyTop};--horizon:${l.theme.palette.skyHorizon};--sun:${l.theme.palette.sun}">
              <span class="card-sky"><i></i></span>
              <span class="numeral">${NUMERALS[i]}</span>
              <strong>${open ? esc(l.name) : "Unvisited"}</strong>
              <span class="card-meta">${open ? `${best !== null ? `${sun()} ${clock(best)}` : "Awaiting the light"} · ${mote()} ${p.motes[i].length}/${motes}` : `${lock()} Restore the chapter before`}</span>
            </button>`;
          }).join("")}
        </div>
        <button class="secondary" data-act="back"><span>Return</span></button>
      </section>`,
      { type: "back" },
    );
  }

  clear(c: ClearStats) {
    this.show(
      "clear",
      `<section class="panel">
        ${sun("panel-sun big")}
        <span class="numeral">Chapter ${NUMERALS[c.level.index]} restored</span>
        <h2>${esc(c.level.epigraph)}</h2>
        <div class="stats">
          <div><strong>${clock(c.time)}</strong>${c.record ? "New best" : c.best !== null ? `Best ${clock(c.best)}` : "Time"}</div>
          <div><strong>${c.motes}/${c.moteTotal}</strong>Light motes</div>
          <div><strong>${c.folds}</strong>Folds</div>
          <div><strong>${c.deaths}</strong>Returns</div>
        </div>
        ${c.time <= c.level.par ? `<p class="par">${sun()} Faster than the keeper’s pace of ${clock(c.level.par)}</p>` : ""}
        <div class="stack">
          <button class="primary" data-act="next" autofocus><span>${c.last ? "Watch the sunrise" : "Follow the light"}</span>${arrow()}</button>
          <div class="row">
            <button class="secondary" data-act="restart"><span>Replay</span></button>
            <button class="secondary" data-act="title"><span>Rest here</span></button>
          </div>
        </div>
      </section>`,
      { type: "next" },
    );
  }

  ending(p: Progress) {
    const total = p.records.reduce<number>((a, b) => a + (b ?? 0), 0);
    const motes = p.motes.reduce((a, m) => a + m.length, 0);
    const moteTotal = LEVELS.reduce((a, l) => a + l.pickups.filter((x) => x.kind === "mote").length, 0);
    this.show(
      "ending",
      `<section class="panel ending">
        ${sun("panel-sun big rising")}
        <span class="numeral">Epilogue</span>
        <h2>And so, the morning returns.</h2>
        <p class="epilogue">You crossed the world in two ways: flat as a page, deep as a sky.<br>Eighteen seeds found their way home. The observatories are lit again,<br>and every one of them keeps a little of your sun.</p>
        <div class="stats">
          <div><strong>6/6</strong>Observatories</div>
          <div><strong>${motes}/${moteTotal}</strong>Light motes</div>
          <div><strong>${clock(total)}</strong>Best journey</div>
        </div>
        <p class="credits">Perspective Sol · Randroid’s Dojo<br>Thank you for carrying the light.</p>
        <div class="row">
          <button class="primary" data-act="open" data-screen="chapters" autofocus><span>Wander again</span></button>
          <button class="secondary" data-act="title"><span>Title screen</span></button>
        </div>
      </section>`,
      { type: "title" },
      "ending-screen",
    );
  }

  // ----------------------------------------------------------- navigation

  menu(k: MenuKey) {
    if (this.screen === "none") return;
    if (k === "back") {
      this.onSound("ui-back");
      this.onAction(this.backAction);
      return;
    }
    const items = [...this.panel.querySelectorAll<HTMLElement>("button:not(:disabled), input")];
    if (!items.length) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    if (k === "confirm") {
      (index >= 0 ? items[index] : items[0]).click();
      return;
    }
    if ((k === "left" || k === "right") && active?.matches("input[type=range]")) {
      const input = active as HTMLInputElement;
      input.value = String(Number(input.value) + (k === "right" ? 0.05 : -0.05));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      this.onSound("ui-move");
      return;
    }
    if ((k === "left" || k === "right") && active?.closest(".choice, .row")) {
      const group = [...active.closest(".choice, .row")!.querySelectorAll<HTMLElement>("button")];
      const i = group.indexOf(active) + (k === "right" ? 1 : -1);
      if (group[i]) {
        group[i].focus();
        if (active.closest(".choice")) group[i].click();
        this.onSound("ui-move");
      }
      return;
    }
    const step = k === "down" || k === "right" ? 1 : -1;
    const next = items[(index + step + items.length) % items.length];
    next.focus({ preventScroll: false });
    this.onSound("ui-move");
  }
}
