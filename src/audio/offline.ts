import type { Cue, Stinger } from "../contract";
import type { TimeOfDay } from "../sim/types";
import { bank } from "./bank";
import { Engine } from "./engine";
import { cueDef } from "./score";
import { Composer } from "./composer";
import { MODES, parseMelody, parseProgression, chordPcs, mod12, type ModeName } from "./theory";
import { METERS } from "./theory";

/**
 * Offline rendering and analysis for the audio checks (scripts/audio-check.mjs).
 * Renders run through the same engine as the game, in an OfflineAudioContext,
 * advancing the scheduler with context suspends exactly as the live timer does.
 */

export type RenderOptions = {
  cue?: Cue;
  seconds: number;
  sampleRate?: number;
  /** Fold over time (seconds -> 0..1) or a constant. */
  fold?: number | ((t: number) => number);
  radiant?: boolean;
  ambience?: TimeOfDay | null;
  /** Calls into the engine at given times (effects, stingers, pauses). */
  actions?: { at: number; run: (e: Engine) => void }[];
  economy?: boolean;
  log?: boolean;
  music?: number;
  effects?: number;
};

export async function render(o: RenderOptions) {
  bank.start();
  await bank.ready;
  const sr = o.sampleRate ?? 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(o.seconds * sr), sr);
  const engine = new Engine(ctx, bank);
  engine.setVolumes(o.music ?? 0.6, o.effects ?? 0.8);
  engine.music.economy = o.economy ?? true;
  if (o.log) engine.music.log = [];
  const foldAt = typeof o.fold === "function" ? o.fold : () => (o.fold as number | undefined) ?? 0;
  engine.setFold(foldAt(0));
  if (o.radiant) {
    engine.music.radiant = true;
    for (const side of [0, 1] as const) {
      engine.mixer.role(side, "shimmer").gain.value = engine.mixer.roleLevel(side, "shimmer");
      engine.mixer.role(side, "halo").gain.value = engine.mixer.roleLevel(side, "halo");
    }
  }
  if (o.cue !== undefined) engine.cue(o.cue);
  const step = 0.05;
  const actions = [...(o.actions ?? [])].sort((a, b) => a.at - b.at);
  let next = 0;
  for (let t = step; t < o.seconds - 0.01; t += step) {
    const at = t;
    void ctx.suspend(at).then(() => {
      engine.setFold(foldAt(at));
      while (next < actions.length && actions[next].at <= at + 1e-6) actions[next++].run(engine);
      if (o.ambience !== undefined) engine.ambience.update(o.ambience, step, engine.music.targetKey(), null);
      engine.pump();
      void ctx.resume();
    });
  }
  const t0 = performance.now();
  const buffer = await ctx.startRendering();
  const ms = performance.now() - t0;
  return {
    buffer,
    renderMs: ms,
    realtimeFactor: o.seconds / (ms / 1000),
    schedulerMsPerCall: engine.schedulerMs / Math.max(1, engine.schedulerCalls),
    stats: { ...engine.music.stats },
    log: engine.music.log,
    effectsPlayed: engine.fx.played,
  };
}

/** Render one effect or stinger in a given key context. */
export function renderEffect(name: string, cue: Cue = "title", fold = 0) {
  const call = (e: Engine) => {
    const pan = 0;
    const game = fakeGame();
    const ev = (type: string, extra: Record<string, unknown> = {}) =>
      e.event({ type, position: { x: 0, y: 0, z: 0 }, ...extra } as never, game as never, pan);
    switch (name) {
      case "jump":
        return ev("jump");
      case "land":
        return ev("land", { value: 12 });
      case "land-heavy":
        return ev("land", { value: 22 });
      case "step-grass":
        game.player.support = "g";
        return ev("step", { value: 0 });
      case "step-stone":
        game.player.support = "s";
        return ev("step", { value: 1 });
      case "step-bronze":
        game.player.support = "p";
        return ev("step", { value: 0 });
      case "bump":
        return ev("bump");
      case "fold":
        return ev("fold", { value: 1 });
      case "unfold":
        return ev("fold", { value: 0 });
      case "seed":
        return ev("seed", { value: 1 });
      case "seed-final":
        return ev("seed", { value: 3 });
      case "mote":
        return ev("mote", { value: 3 });
      case "checkpoint":
        return ev("checkpoint");
      case "lantern":
        return ev("lantern");
      case "gate":
        return ev("gate");
      case "bridge":
        return ev("bridge");
      case "die-sentinel":
        return ev("die", { cause: "sentinel" });
      case "die-void":
        return ev("die", { cause: "void" });
      case "respawn":
        return ev("respawn");
      case "locked":
        return ev("locked", { value: 2 });
      case "exit":
        return ev("exit");
      case "hint":
        return ev("hint");
      default:
        return e.stinger(name as Stinger);
    }
  };
  return render({
    seconds: 4.5,
    fold,
    music: 0,
    actions: [
      // Establish the key without letting music sound.
      { at: 0.05, run: (e) => e.music.cue(String(cue)) },
      { at: 0.5, run: call },
    ],
  });
}

function fakeGame() {
  const islands: Record<string, { style: string; only?: string }> = {
    g: { style: "garden" },
    s: { style: "stone" },
    p: { style: "plinth" },
  };
  return {
    player: { x: 0, y: 0, z: 0, support: "s" as string | null },
    seeds: 1,
    seedTotal: 3,
    motes: 1,
    island: (id: string) => islands[id],
    level: { walls: [], sentinels: [], theme: { time: "morning" } },
  };
}

// ------------------------------------------------------------------ analysis

export type Analysis = {
  seconds: number;
  peak: number;
  peakDb: number;
  rmsDb: number;
  lufs: number;
  clipped: number;
  clicks: number;
  clickTimes: number[];
  silentSeconds: number;
  longestSilence: number;
  bands: Record<string, number>;
  centroid: number;
  chroma: number[];
  inKey?: number;
  dcOffset: number;
};

const db = (x: number) => 20 * Math.log10(Math.max(1e-9, x));

export function analyze(buffer: AudioBuffer, key?: { tonic: number; mode: ModeName }, skip = 0): Analysis {
  const sr = buffer.sampleRate;
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const from = Math.floor(skip * sr);
  const n = buffer.length;
  let peak = 0,
    sum = 0,
    clipped = 0,
    dc = 0;
  for (const d of chans)
    for (let i = from; i < n; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += d[i] * d[i];
      dc += d[i];
    }
  const count = (n - from) * chans.length;
  const rms = Math.sqrt(sum / count);

  // Integrated loudness (BS.1770 K-weighting, gated).
  const kw = chans.map((d) => kWeight(d, sr));
  const block = Math.floor(0.4 * sr);
  const hop = Math.floor(0.1 * sr);
  const blocks: number[] = [];
  for (let s = from; s + block <= n; s += hop) {
    let z = 0;
    for (const k of kw) for (let i = s; i < s + block; i++) z += k[i] * k[i];
    blocks.push(z / block);
  }
  const loud = (z: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, z));
  const abs = blocks.filter((z) => loud(z) > -70);
  const meanAbs = abs.reduce((a, b) => a + b, 0) / Math.max(1, abs.length);
  const rel = abs.filter((z) => loud(z) > loud(meanAbs) - 10);
  const lufs = loud(rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length));

  // Clicks: isolated spikes in the second difference against a local mean.
  const clickTimes: number[] = [];
  const W = 96;
  for (const d of chans) {
    const y = new Float32Array(n);
    for (let i = 2; i < n; i++) y[i] = Math.abs(d[i] - 2 * d[i - 1] + d[i - 2]);
    let acc = 0;
    for (let i = 0; i < Math.min(n, 2 * W + 1); i++) acc += y[i];
    let last = -1;
    for (let i = W + 1; i < n - W - 1; i++) {
      acc += y[i + W] - y[i - W - 1];
      const mean = acc / (2 * W + 1);
      if (i >= from && y[i] > 0.012 && y[i] > 16 * mean) {
        // A discontinuity concentrates in one or two samples; band-limited
        // transients (designed taps, crackles, paper grains) ring for longer.
        let around = 0;
        for (const j of [i - 4, i - 3, i + 3, i + 4, i + 5]) around = Math.max(around, y[j]);
        if (around < 0.3 * y[i]) {
          if (last < 0 || i - last > sr * 0.005) clickTimes.push(i / sr);
          last = i;
        }
      }
    }
  }
  clickTimes.sort((a, b) => a - b);

  // Silence.
  const win = Math.floor(0.25 * sr);
  let silent = 0,
    run = 0,
    longest = 0;
  for (let s = from; s + win <= n; s += win) {
    let z = 0;
    for (const d of chans) for (let i = s; i < s + win; i++) z += d[i] * d[i];
    const r = Math.sqrt(z / (win * chans.length));
    if (db(r) < -60) {
      silent += 0.25;
      run += 0.25;
      longest = Math.max(longest, run);
    } else run = 0;
  }

  // Spectrum: averaged power spectrum of the mid signal.
  const N = 8192;
  const spec = new Float64Array(N / 2);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let frames = 0;
  for (let s = from; s + N <= n; s += N) {
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      let v = 0;
      for (const d of chans) v += d[s + i];
      re[i] = (v / chans.length) * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  const edges = [20, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const bandsRaw = new Array(edges.length - 1).fill(0);
  let total = 0,
    centroidNum = 0;
  const chroma = new Array(12).fill(0);
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    const p = spec[k];
    total += p;
    centroidNum += p * f;
    for (let b = 0; b < edges.length - 1; b++) if (f >= edges[b] && f < edges[b + 1]) bandsRaw[b] += p;
    if (f > 70 && f < 2200 && k > 8 && k < N / 2 - 9) {
      // Tonal peaks only: a local maximum well above its neighbourhood, so
      // noise layers (wind, paper, whooshes) do not count as pitches.
      if (p < spec[k - 1] || p < spec[k + 1]) continue;
      let floor = 0;
      for (let j = k - 8; j <= k + 8; j++) floor += spec[j];
      floor /= 17;
      if (p < 4 * floor) continue;
      const midi = 69 + 12 * Math.log2(f / 440);
      const near = Math.round(midi);
      if (Math.abs(midi - near) < 0.35) chroma[mod12(near)] += p;
    }
  }
  const bands: Record<string, number> = {};
  for (let b = 0; b < bandsRaw.length; b++) bands[`${edges[b]}-${edges[b + 1]}`] = Math.round(10 * Math.log10(Math.max(1e-12, bandsRaw[b] / total)) * 10) / 10;
  const cs = chroma.reduce((a, b) => a + b, 0) || 1;
  const chromaN = chroma.map((c) => Math.round((c / cs) * 1000) / 1000);
  let inKey: number | undefined;
  if (key) {
    const pcs = MODES[key.mode].map((s) => mod12(s + key.tonic));
    inKey = pcs.reduce((a, pc) => a + chromaN[pc], 0);
  }
  return {
    seconds: (n - from) / sr,
    peak,
    peakDb: db(peak),
    rmsDb: db(rms),
    lufs,
    clipped,
    clicks: clickTimes.length,
    clickTimes: clickTimes.slice(0, 10),
    silentSeconds: silent,
    longestSilence: longest,
    bands,
    centroid: frames ? centroidNum / total : 0,
    chroma: chromaN,
    inKey,
    dcOffset: dc / count,
  };
}

function kWeight(x: Float32Array, sr: number) {
  // BS.1770 pre-filter and RLB high-pass, designed for the given rate.
  const out = new Float32Array(x.length);
  const shelf = biquadCoefs("highshelf", sr, 1681.97, 0.7072, 3.99984);
  const hp = biquadCoefs("highpass", sr, 38.1355, 0.5003, 0);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = shelf.b0 * v + shelf.b1 * x1 + shelf.b2 * x2 - shelf.a1 * y1 - shelf.a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    const z = hp.b0 * y + hp.b1 * u1 + hp.b2 * u2 - hp.a1 * z1 - hp.a2 * z2;
    u2 = u1;
    u1 = y;
    z2 = z1;
    z1 = z;
    out[i] = z;
  }
  return out;
}

function biquadCoefs(type: "highshelf" | "highpass", sr: number, f: number, q: number, gainDb: number) {
  const w = (2 * Math.PI * f) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === "highshelf") {
    const A = Math.pow(10, gainDb / 40);
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * cos + s);
    b1 = -2 * A * (A - 1 + (A + 1) * cos);
    b2 = A * (A + 1 + (A - 1) * cos - s);
    a0 = A + 1 - (A - 1) * cos + s;
    a1 = 2 * (A - 1 - (A + 1) * cos);
    a2 = A + 1 - (A - 1) * cos - s;
  } else {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = b0;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j],
          ai = im[i + j];
        const br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ar + br;
        im[i + j] = ai + bi;
        re[i + j + len / 2] = ar - br;
        im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** 16-bit stereo WAV, base64, for writing renders to disk from a test page. */
export function wavBase64(buffer: AudioBuffer) {
  const ch = Math.min(2, buffer.numberOfChannels);
  const n = buffer.length;
  const bytes = new Uint8Array(44 + n * ch * 2);
  const v = new DataView(bytes.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n * ch * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ----------------------------------------------------------- score analysis

/**
 * Read the score as a theorist would: every melody note that falls on a
 * strong beat should belong to the chord or be a gentle tension (2/9, 6/13,
 * major seventh over a major chord). Returns the exceptions.
 */
export function auditScore() {
  const report: { cue: string; section: string; bar: number; tick: number; note: string; chord: string; interval: number }[] = [];
  const names = ["title", "0", "1", "2", "3", "4", "5", "ending"];
  let notes = 0;
  for (const name of names) {
    const def = cueDef(name);
    const meter = METERS[def.meter];
    for (const [sec, s] of Object.entries(def.sections)) {
      if (!s.melody) continue;
      const modes: ModeName[] = [def.mode];
      for (const plan of def.loop) for (const e of plan) if (e.sec === sec && e.mode && !modes.includes(e.mode)) modes.push(e.mode);
      for (const mode of modes) {
        const mel = parseMelody(s.melody, mode, meter.barTicks);
        const prog = parseProgression(s.chords, mode, meter.barTicks);
        for (const n of mel) {
          if (n.semis === null) continue;
          notes++;
          const bar = Math.floor(n.start / meter.barTicks);
          const tick = n.start % meter.barTicks;
          if (!meter.strong.includes(tick) && n.dur < 8) continue;
          const span = prog[bar].find((c) => tick >= c.start && tick < c.start + c.dur) ?? prog[bar][0];
          const pcs = chordPcs(span.chord);
          const pc = mod12(n.semis);
          if (pcs.includes(pc)) continue;
          const iv = mod12(pc - span.chord.root);
          const gentle = iv === 2 || iv === 9 || (iv === 11 && !span.chord.minor) || (iv === 5 && span.chord.tones[1].semis === 5);
          if (gentle) continue;
          report.push({ cue: name, section: sec, bar: bar + 1, tick, note: `${n.degree}`, chord: span.chord.sym, interval: iv });
        }
      }
    }
  }
  return { notes, exceptions: report };
}

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const noteName = (m: number) => `${NAMES[mod12(m)]}${Math.floor(m / 12) - 1}`;

/** A readable bar-by-bar transcription of what the composer plays. */
export function transcribe(cue: Cue, bars: number, radiant = false) {
  const c = new Composer(cueDef(String(cue)));
  const lines: string[] = [];
  for (let i = 0; i < bars; i++) {
    const b = c.next(radiant);
    const chords = b.chords.map((ch) => `${NAMES[ch.root]}${ch.bass !== ch.root ? "/" + NAMES[ch.bass] : ""}`).join(" ");
    const part = (role: string) =>
      b.events
        .filter((e) => e.role === role)
        .sort((x, y) => x.tick - y.tick)
        .map((e) => `${noteName(e.midi)}@${e.tick}${role === "lead" ? ":" + e.dur : ""}`)
        .join(" ");
    lines.push(
      `${String(i + 1).padStart(3)} ${b.section.padEnd(6)} e${b.energy.toFixed(2)} [${chords}] lead: ${part("lead")} | bass: ${part("bass")} | counter: ${part("counter")} | pad: ${part("pad")} | sparkle: ${part("sparkle")}`,
    );
  }
  return lines.join("\n");
}

/** Length of each cue's intro, each loop plan, and the full cycle, in seconds. */
export function formReport() {
  const names = ["title", "0", "1", "2", "3", "4", "5", "ending"];
  return names.map((name) => {
    const d = cueDef(name);
    const meter = METERS[d.meter];
    const bar = (meter.barTicks * 60) / d.bpm / meter.beatTicks;
    const bars = (plan: { sec: string }[]) =>
      plan.reduce((a, e) => a + parseProgression(d.sections[e.sec].chords, d.mode, meter.barTicks).length, 0);
    const passes = d.loop.map((p) => bars(p) * bar);
    return {
      cue: name,
      title: d.title,
      key: `${NAMES[d.tonic]} ${d.mode}`,
      bpm: d.bpm,
      meter: d.meter,
      introSeconds: Math.round(bars(d.intro) * bar),
      passSeconds: passes.map((s) => Math.round(s)),
      cycleSeconds: Math.round(passes.reduce((a, b) => a + b, 0)),
    };
  });
}

/**
 * Folding must not move a single note: render the same cue with a constant
 * fold and with the fold swinging back and forth, and compare every onset.
 */
export async function foldContinuity(cue: Cue, seconds = 30) {
  const swing = (t: number) => {
    // Fold every 2.5 s, moving linearly over 0.6 s like the game's transition.
    const k = Math.floor(t / 2.5);
    const into = t - k * 2.5;
    const from = k % 2 ? 1 : 0;
    const to = 1 - from;
    return into < 0.6 ? from + (to - from) * (into / 0.6) : to;
  };
  const still = await render({ cue, seconds, fold: 0, economy: false, log: true });
  const moving = await render({ cue, seconds, fold: swing, economy: false, log: true });
  const key = (n: { t: number; midi: number; role: string; side: number }) => `${n.t.toFixed(6)}|${n.midi}|${n.role}|${n.side}`;
  const a = (still.log ?? []).map(key).sort();
  const b = (moving.log ?? []).map(key).sort();
  let same = a.length === b.length;
  for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false;
  // Short-term level through the swings: no gaps.
  const win = (buf: AudioBuffer) => {
    const d0 = buf.getChannelData(0);
    const d1 = buf.getChannelData(1);
    const w = Math.floor(0.1 * buf.sampleRate);
    let min = Infinity;
    for (let s = Math.floor(2 * buf.sampleRate); s + w <= buf.length; s += w) {
      let z = 0;
      for (let i = s; i < s + w; i++) z += d0[i] * d0[i] + d1[i] * d1[i];
      min = Math.min(min, Math.sqrt(z / (2 * w)));
    }
    return 20 * Math.log10(Math.max(1e-9, min));
  };
  const am = analyze(moving.buffer);
  return {
    onsetsStill: a.length,
    onsetsMoving: b.length,
    identical: same,
    minWindowDbStill: win(still.buffer),
    minWindowDbMoving: win(moving.buffer),
    clicksMoving: am.clicks,
    lufsStill: analyze(still.buffer).lufs,
    lufsMoving: am.lufs,
  };
}

/** A cue change mid-phrase: the new cue must enter on a bar line of the old. */
export async function crossfade(from: Cue, to: Cue, at = 8, seconds = 16) {
  let barLen = 0;
  let firstStart = 0;
  let newStart = 0;
  const out = await render({
    cue: from,
    seconds,
    fold: 0.5,
    actions: [
      {
        at,
        run: (e) => {
          const p = e.music.current!;
          barLen = p.composer.barSeconds;
          firstStart = p.start;
          e.cue(to);
          newStart = e.music.current!.start;
        },
      },
    ],
  });
  const a = analyze(out.buffer);
  const offset = (newStart - firstStart) / barLen;
  return {
    calledAt: at,
    entersAt: newStart,
    waitSeconds: newStart - at,
    barsFromOldDownbeat: offset,
    onBarLine: Math.abs(offset - Math.round(offset)) < 1e-6,
    clicks: a.clicks,
    longestSilence: a.longestSilence,
    peakDb: a.peakDb,
  };
}

/** Spectral centroid and level of a time window of a render. */
export function windowStats(buffer: AudioBuffer, from: number, to: number) {
  const sr = buffer.sampleRate;
  const a = Math.floor(from * sr);
  const b = Math.min(buffer.length, Math.floor(to * sr));
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, b - a, sr);
  const part = ctx.createBuffer(buffer.numberOfChannels, b - a, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) part.copyToChannel(buffer.getChannelData(c).slice(a, b), c);
  const r = analyze(part);
  return { lufs: r.lufs, rmsDb: r.rmsDb, centroid: r.centroid, bands: r.bands };
}

/** The adaptive layers: radiant shimmer, sentinel tension, and the death dip. */
export async function adaptive() {
  const base = await render({ cue: "title", seconds: 40, fold: 0 });
  const radiant = await render({ cue: "title", seconds: 40, fold: 0, radiant: true });
  const k = { tonic: 2, mode: "ionian" as ModeName };
  const b = analyze(base.buffer, k, 14);
  const r = analyze(radiant.buffer, k, 14);
  const tension = await render({
    cue: "title",
    seconds: 16,
    fold: 0,
    music: 0,
    actions: Array.from({ length: 300 }, (_, i) => ({
      at: 0.05 + i * 0.05,
      run: (e: Engine) => e.tension.update(i * 0.05 < 6 ? 0 : i * 0.05 < 11 ? Math.min(1, (i * 0.05 - 6) / 2) : 0, 0.4, e.music.targetKey()),
    })),
  });
  const quiet = windowStats(tension.buffer, 2, 5.5);
  const near = windowStats(tension.buffer, 8.5, 10.8);
  const die = await render({
    cue: 2,
    seconds: 26,
    fold: 0.5,
    actions: [
      { at: 16, run: (e) => e.event({ type: "die", cause: "void", position: { x: 0, y: 0, z: 0 } }, fakeGame() as never, 0) },
      { at: 18.5, run: (e) => e.event({ type: "respawn", position: { x: 0, y: 0, z: 0 } }, fakeGame() as never, 0) },
    ],
  });
  const before = windowStats(die.buffer, 12.5, 15.8);
  const during = windowStats(die.buffer, 16.6, 18.4);
  const after = windowStats(die.buffer, 21.5, 25.5);
  return {
    radiant: { lufsBase: b.lufs, lufsRadiant: r.lufs, centroidBase: b.centroid, centroidRadiant: r.centroid, inKey: r.inKey, clicks: r.clicks },
    tension: { quietDb: quiet.rmsDb, nearDb: near.rmsDb },
    die: { before: before.bands["2000-4000"], during: during.bands["2000-4000"], after: after.bands["2000-4000"], centroidBefore: before.centroid, centroidDuring: during.centroid, centroidAfter: after.centroid },
  };
}
