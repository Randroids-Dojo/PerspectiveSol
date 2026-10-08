import { ROOTS, allKeys, renderKey, type InstrumentName } from "./catalog";

/**
 * The sample bank. Everything is synthesised at start-up in a worker (or in
 * small main-thread slices if workers are unavailable) and stored as
 * AudioBuffers that any AudioContext can play, including offline ones.
 */

export type Sample = { buffer: AudioBuffer; loopStart?: number; loopEnd?: number };
export type Picked = Sample & { rate: number; root: number };

type Message = {
  key?: string;
  data?: Float32Array;
  sr?: number;
  loopStart?: number;
  loopEnd?: number;
  error?: string;
  done?: boolean;
};

const makeBuffer = (data: Float32Array, sr: number): AudioBuffer => {
  const b = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate: sr });
  b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return b;
};

export class Bank {
  private samples = new Map<string, Sample>();
  private started = false;
  private worker: Worker | null = null;
  private resolveAll: (() => void) | null = null;
  readonly ready: Promise<void>;
  total = 0;
  loaded = 0;
  errors: string[] = [];
  startedAt = 0;
  finishedAt = 0;
  firstAt = 0;

  constructor() {
    this.ready = new Promise((r) => (this.resolveAll = r));
  }

  get complete() {
    return this.total > 0 && this.loaded + this.errors.length >= this.total;
  }

  /** Begin rendering. Safe to call more than once. */
  start(first: "sculpted" | "illustrated" = "sculpted") {
    if (this.started || typeof AudioBuffer === "undefined") return;
    this.started = true;
    this.startedAt = performance.now();
    const keys = allKeys(first);
    this.total = keys.length;
    // Two workers split the list so start-up finishes sooner on many-core phones.
    const halves = [keys.filter((_, i) => i % 2 === 0), keys.filter((_, i) => i % 2 === 1)];
    let workersOk = typeof Worker !== "undefined";
    let running = 0;
    if (workersOk) {
      try {
        for (const part of halves) {
          const w = new Worker(new URL("./bank.worker.ts", import.meta.url), { type: "module" });
          running++;
          w.onmessage = (e: MessageEvent<Message>) => {
            const m = e.data;
            if (m.done) {
              w.terminate();
              return;
            }
            if (m.error) this.fail(m.key ?? "?", m.error);
            else if (m.key && m.data && m.sr) this.add(m.key, m.data, m.sr, m.loopStart, m.loopEnd);
          };
          w.onerror = (err) => {
            // Fall back to the main thread for whatever this worker had left.
            err.preventDefault?.();
            w.terminate();
            this.renderOnMain(part.filter((k) => !this.samples.has(k)));
          };
          w.postMessage({ keys: part });
          if (!this.worker) this.worker = w;
        }
      } catch {
        workersOk = false;
      }
    }
    if (!workersOk || running === 0) this.renderOnMain(keys);
  }

  /** Render in small slices so frames keep flowing. */
  private renderOnMain(keys: string[]) {
    let i = 0;
    const slice = () => {
      const t0 = performance.now();
      while (i < keys.length && performance.now() - t0 < 8) {
        const k = keys[i++];
        if (this.samples.has(k)) continue;
        try {
          const r = renderKey(k);
          this.add(k, r.data, r.sr, r.loopStart, r.loopEnd);
        } catch (err) {
          this.fail(k, String(err));
        }
      }
      if (i < keys.length) setTimeout(slice, 0);
    };
    setTimeout(slice, 0);
  }

  /** Render everything synchronously (offline tools only). */
  renderAllNow() {
    if (!this.started) {
      this.started = true;
      this.startedAt = performance.now();
      const keys = allKeys();
      this.total = keys.length;
      for (const k of keys) {
        const r = renderKey(k);
        this.add(k, r.data, r.sr, r.loopStart, r.loopEnd);
      }
    }
    return this.ready;
  }

  private add(key: string, data: Float32Array, sr: number, loopStart?: number, loopEnd?: number) {
    if (this.samples.has(key)) return;
    this.samples.set(key, { buffer: makeBuffer(data, sr), loopStart, loopEnd });
    this.loaded++;
    if (!this.firstAt) this.firstAt = performance.now();
    this.check();
  }

  private fail(key: string, error: string) {
    this.errors.push(`${key}: ${error}`);
    this.check();
  }

  private check() {
    if (this.complete && this.resolveAll) {
      this.finishedAt = performance.now();
      this.resolveAll();
      this.resolveAll = null;
    }
  }

  get(key: string): Sample | null {
    return this.samples.get(key) ?? null;
  }

  has(key: string) {
    return this.samples.has(key);
  }

  /** Nearest sampled root for a pitch, and the playback rate to reach it. */
  pick(inst: InstrumentName, midi: number): Picked | null {
    const roots = ROOTS[inst];
    let best = -1;
    let bestD = Infinity;
    for (const r of roots) {
      if (!this.samples.has(`inst:${inst}:${r}`)) continue;
      // Prefer shifting down slightly: it keeps attacks crisp.
      const d = Math.abs(midi - r) + (midi < r ? 0.1 : 0);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (best < 0 || bestD > 7) return null;
    const s = this.samples.get(`inst:${inst}:${best}`)!;
    return { ...s, rate: Math.pow(2, (midi - best) / 12), root: best };
  }

  /** Approximate memory held by sample data, in megabytes. */
  get megabytes() {
    let n = 0;
    for (const s of this.samples.values()) n += s.buffer.length * 4;
    return n / 1048576;
  }
}

/** One bank per page: every context (live or offline) shares it. */
export const bank = new Bank();
