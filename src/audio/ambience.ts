import type { TimeOfDay } from "../sim/types";
import type { Bank } from "./bank";
import { BIRDS } from "./catalog";
import type { Mixer } from "./mixer";
import { degreeSemis, mod12, rng, type Key } from "./theory";

/**
 * Per-chapter ambience under the music: a wind bed for every chapter plus the
 * chapter's own character (birds, water, insects, clockwork, chimes, choir).
 */

type Loop = { key: string; gain: number; pan?: number; offset?: number; rate?: number; tune?: "tonic" | "fifth" };
type Calls = { keys: string[]; every: [number, number]; gain: [number, number]; rate?: [number, number] };
type Profile = {
  wind: { gain: number; cutoff: number; q?: number };
  loops: Loop[];
  calls: Calls[];
  chimes?: boolean;
  ticks?: boolean;
};

const birds = (kind: "morning" | "dawn") => Array.from({ length: BIRDS[kind] }, (_, i) => `bird:${kind}:${i}`);

export const PROFILES: Record<TimeOfDay, Profile> = {
  morning: {
    wind: { gain: 0.1, cutoff: 900 },
    loops: [],
    calls: [{ keys: birds("morning"), every: [2.2, 6.5], gain: [0.05, 0.11], rate: [0.9, 1.12] }],
  },
  noon: {
    wind: { gain: 0.07, cutoff: 600 },
    loops: [{ key: "amb:water", gain: 0.11, pan: 0.3 }],
    calls: [{ keys: ["amb:cicada"], every: [8, 18], gain: [0.03, 0.06], rate: [0.95, 1.06] }],
  },
  afternoon: {
    wind: { gain: 0.08, cutoff: 1000 },
    loops: [{ key: "amb:surf", gain: 0.11, pan: -0.15 }],
    calls: [{ keys: ["amb:gear"], every: [7, 15], gain: [0.04, 0.07], rate: [0.9, 1.1] }],
    ticks: true,
  },
  dusk: {
    wind: { gain: 0.08, cutoff: 650 },
    loops: [],
    calls: [{ keys: ["amb:rustle"], every: [6, 14], gain: [0.05, 0.09], rate: [0.9, 1.15] }],
    chimes: true,
  },
  night: {
    wind: { gain: 0.11, cutoff: 1500, q: 2.2 },
    loops: [
      { key: "amb:crickets", gain: 0.07, pan: -0.5 },
      { key: "amb:crickets", gain: 0.05, pan: 0.55, offset: 2.1, rate: 1.06 },
    ],
    calls: [],
  },
  dawn: {
    wind: { gain: 0.08, cutoff: 850 },
    loops: [
      { key: "amb:choir", gain: 0.05, tune: "tonic" },
      { key: "amb:choir", gain: 0.035, tune: "fifth", offset: 1.3 },
    ],
    calls: [{ keys: birds("dawn"), every: [3.5, 9], gain: [0.05, 0.1], rate: [0.94, 1.06] }],
  },
};

type Live = { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode; loop: Loop };

export type Beat = { period: number; anchor: number } | null;

export class Ambience {
  private ctx: BaseAudioContext;
  private mixer: Mixer;
  private bank: Bank;
  private out: GainNode;
  private windSrc: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode;
  private windGain: GainNode;
  private loops: Live[] = [];
  private nextCall: number[] = [];
  private nextChime = 0;
  private nextTick = 0;
  private tickFlip = 0;
  private gust = 0;
  private gustTarget = 0;
  private sinceGust = 0;
  private r = rng(4242);
  profile: TimeOfDay | null = null;
  active = false;
  oneShots = 0;

  constructor(ctx: BaseAudioContext, mixer: Mixer, bank: Bank) {
    this.ctx = ctx;
    this.mixer = mixer;
    this.bank = bank;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(mixer.amb);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 800;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter.connect(this.windGain).connect(this.out);
  }

  private startWind() {
    if (this.windSrc) return;
    const s = this.bank.get("amb:wind");
    if (!s) return;
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffer;
    src.loop = true;
    src.loopStart = s.loopStart ?? 0;
    src.loopEnd = s.loopEnd ?? s.buffer.duration;
    src.connect(this.windFilter);
    src.start(this.ctx.currentTime, this.r() * 5);
    this.windSrc = src;
  }

  /** Per frame: profile changes, gusts, calls and clock ticks. */
  update(time: TimeOfDay | null, dt: number, key: Key, beat: Beat) {
    const now = this.ctx.currentTime;
    const want = time !== null;
    if (want !== this.active) {
      this.active = want;
      this.out.gain.cancelScheduledValues(now);
      this.out.gain.setTargetAtTime(want ? 1 : 0, now, want ? 0.8 : 0.5);
    }
    if (!want) return;
    this.startWind();
    if (time !== this.profile) this.setProfile(time as TimeOfDay, key);
    // A loop that is still rendering leaves the profile unset; try next frame.
    if (!this.profile) return;
    const p = PROFILES[this.profile];

    // Gusts: a slow random walk on the wind's level and brightness.
    this.sinceGust += dt;
    if (this.sinceGust > 0.35) {
      this.sinceGust = 0;
      if (this.r() < 0.12) this.gustTarget = this.r();
      this.gust += (this.gustTarget - this.gust) * 0.25;
      this.windFilter.frequency.setTargetAtTime(p.wind.cutoff * (0.7 + 0.7 * this.gust), now, 0.6);
      this.windGain.gain.setTargetAtTime(p.wind.gain * (0.7 + 0.6 * this.gust), now, 0.6);
    }

    // Random calls.
    p.calls.forEach((c, i) => {
      if (this.nextCall[i] === undefined) this.nextCall[i] = now + this.range(c.every) * 0.5;
      if (now >= this.nextCall[i]) {
        this.nextCall[i] = now + this.range(c.every);
        this.oneShot(this.r.pick(c.keys), this.range(c.gain), c.rate ? this.range(c.rate) : 1, this.r() * 1.4 - 0.7);
      }
    });

    // Distant wind chimes in the music's key.
    if (p.chimes && now >= this.nextChime) {
      this.nextChime = now + 6 + this.r() * 8;
      const pent = key.mode === "aeolian" || key.mode === "dorian" ? [1, 3, 4, 5, 7] : [1, 2, 3, 5, 6];
      const base = 84 + mod12(key.tonic - 84);
      const count = 2 + this.r.int(0, 3);
      let at = now + 0.05;
      const pan = this.r() * 1.2 - 0.6;
      for (let i = 0; i < count; i++) {
        const m = base + degreeSemis(key.mode, this.r.pick(pent)) - (this.r() < 0.3 ? 12 : 0);
        this.chime(m, at, 0.02 + this.r() * 0.025, pan + this.r() * 0.2 - 0.1);
        at += 0.12 + this.r() * 0.3;
      }
    }

    // Clockwork ticks, locked to the music's beat when there is one.
    if (p.ticks) {
      const period = beat ? beat.period : 0.65;
      if (this.nextTick < now) {
        this.nextTick = beat ? beat.anchor + Math.ceil((now - beat.anchor) / period) * period : now + 0.05;
      }
      while (this.nextTick < now + 0.15) {
        this.oneShot(this.tickFlip++ % 2 ? "amb:clocktock" : "amb:clocktick", 0.035, 1, 0.35, this.nextTick);
        this.nextTick += period;
      }
    }
  }

  private range([a, b]: [number, number]) {
    return a + (b - a) * this.r();
  }

  private setProfile(time: TimeOfDay, key: Key) {
    const now = this.ctx.currentTime;
    for (const l of this.loops) {
      l.gain.gain.cancelScheduledValues(now);
      l.gain.gain.setTargetAtTime(0, now, 0.6);
      l.src.stop(now + 3);
      l.src.onended = () => {
        l.gain.disconnect();
        l.pan.disconnect();
      };
    }
    this.loops = [];
    this.profile = time;
    this.nextCall = [];
    this.nextChime = now + 3;
    const p = PROFILES[time];
    for (const loop of p.loops) {
      const s = this.bank.get(loop.key);
      if (!s) {
        // Not rendered yet: try again shortly.
        this.profile = null;
        continue;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = s.buffer;
      src.loop = true;
      src.loopStart = s.loopStart ?? 0;
      src.loopEnd = s.loopEnd ?? s.buffer.duration;
      src.playbackRate.value = this.tuning(loop, key);
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(loop.gain, now, 1.2);
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = loop.pan ?? 0;
      src.connect(gain).connect(pan).connect(this.out);
      src.start(now, (loop.offset ?? 0) + this.r() * 0.5);
      this.loops.push({ src, gain, pan, loop });
    }
    if (this.profile === null) {
      for (const l of this.loops) l.src.stop();
      this.loops = [];
    }
  }

  /** Keep tuned loops (the dawn choir) in the music's key. */
  retune(key: Key) {
    const now = this.ctx.currentTime;
    for (const l of this.loops) if (l.loop.tune) l.src.playbackRate.setTargetAtTime(this.tuning(l.loop, key), now, 0.8);
  }

  private tuning(loop: Loop, key: Key) {
    if (!loop.tune) return loop.rate ?? 1;
    // The choir is voiced on A3; move to the nearest tonic or fifth.
    let semis = mod12(key.tonic + (loop.tune === "fifth" ? 7 : 0) - 9);
    if (semis > 6) semis -= 12;
    return Math.pow(2, semis / 12);
  }

  private oneShot(key: string, gain: number, rate: number, pan: number, at = this.ctx.currentTime) {
    const s = this.bank.get(key);
    if (!s) return;
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(this.out);
    src.start(at);
    this.oneShots++;
    src.onended = () => {
      g.disconnect();
      p.disconnect();
    };
  }

  private chime(midi: number, at: number, gain: number, pan: number) {
    const pick = this.bank.pick("glass", midi) ?? this.bank.pick("celesta", midi);
    if (!pick) return;
    const src = this.ctx.createBufferSource();
    src.buffer = pick.buffer;
    src.playbackRate.value = pick.rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
    src.connect(g).connect(p).connect(this.out);
    src.start(at);
    this.oneShots++;
    src.onended = () => {
      g.disconnect();
      p.disconnect();
    };
  }

  get loopCount() {
    return this.loops.length + (this.windSrc ? 1 : 0);
  }
}

/** The low drone that swells as the keeper nears a sentinel. */
export class Tension {
  private ctx: BaseAudioContext;
  private bank: Bank;
  private src: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode;
  private gain: GainNode;
  private pan: StereoPannerNode;
  private tonic = -1;
  level = 0;

  constructor(ctx: BaseAudioContext, mixer: Mixer, bank: Bank) {
    this.ctx = ctx;
    this.bank = bank;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 200;
    this.filter.Q.value = 0.9;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.filter.connect(this.gain).connect(this.pan).connect(mixer.sfx);
  }

  /** level 0..1 by proximity; pan toward the nearest sentinel. */
  update(level: number, pan: number, key: Key) {
    const now = this.ctx.currentTime;
    if (!this.src && level > 0.001) {
      const s = this.bank.get("amb:drone");
      if (!s) return;
      const src = this.ctx.createBufferSource();
      src.buffer = s.buffer;
      src.loop = true;
      src.loopStart = s.loopStart ?? 0;
      src.loopEnd = s.loopEnd ?? s.buffer.duration;
      src.connect(this.filter);
      src.start(now);
      this.src = src;
    }
    if (!this.src) return;
    if (key.tonic !== this.tonic) {
      this.tonic = key.tonic;
      let semis = mod12(key.tonic - 9);
      if (semis > 6) semis -= 12;
      this.src.playbackRate.setTargetAtTime(Math.pow(2, semis / 12), now, 0.5);
    }
    this.level = level;
    this.gain.gain.setTargetAtTime(Math.pow(level, 1.5) * 0.24, now, 0.25);
    this.filter.frequency.setTargetAtTime(160 + 2400 * level * level, now, 0.25);
    this.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, pan)), now, 0.2);
  }
}
