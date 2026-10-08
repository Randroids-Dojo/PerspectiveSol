import type { Bank } from "./bank";
import type { InstrumentName } from "./catalog";
import { Composer, type Bar, type InstName, type NoteEvent, type PercHit } from "./composer";
import type { Mixer, Side } from "./mixer";
import { cueDef, type CueDef } from "./score";
import { hash, rng, type Key } from "./theory";

/**
 * Plays the score. One performance per cue; a cue change lets the old
 * performance finish its bar while the new one enters on the bar line. Every
 * note is scheduled for both arrangements from the same event, so the fold
 * only moves gains: it never restarts, retriggers or shifts anything.
 */

type Env = { attack: number; release: number; level: number; loop?: boolean; natural?: boolean };

const ENV: Record<Exclude<InstName, "kit">, Env> = {
  piano: { attack: 0.003, release: 0.38, level: 1, natural: true },
  harp: { attack: 0.002, release: 0.7, level: 1.05, natural: true },
  celesta: { attack: 0.002, release: 0.5, level: 1.1, natural: true },
  pizz: { attack: 0.002, release: 0.14, level: 1, natural: true },
  bass: { attack: 0.008, release: 0.2, level: 1, natural: true },
  glass: { attack: 0.004, release: 0.9, level: 0.8, natural: true },
  pad: { attack: 0.45, release: 1.1, level: 0.95, loop: true },
  strings: { attack: 0.22, release: 0.55, level: 0.9, loop: true },
  harmonium: { attack: 0.12, release: 0.35, level: 0.85, loop: true },
  flute: { attack: 0.02, release: 0.14, level: 0.62, loop: true },
};

const KIT: Record<PercHit, [string, string, number, number]> = {
  // hit: sculpted sample, illustrated sample, sculpted gain, illustrated gain
  low: ["perc:kick", "perc:doum", 1, 1],
  mid: ["perc:brush", "perc:tek", 1, 0.9],
  high: ["perc:tick", "perc:shaker", 0.9, 0.9],
  swish: ["perc:swish", "perc:shaker2", 1, 0.9],
  ghost: ["perc:tick", "perc:tek", 0.55, 0.45],
  roll: ["perc:cymroll", "perc:shakeroll", 0.9, 0.9],
};

const LOOKAHEAD = 0.14;
const MAX_VOICES = 90;

type Voice = { src: AudioBufferSourceNode; gain: GainNode; end: number; perf: number; side: Side; sustained: boolean };

type Queued = { time: number; ev: NoteEvent; secPerTick: number };

class Performance {
  readonly id: number;
  readonly def: CueDef;
  readonly composer: Composer;
  readonly start: number;
  nextBar: number;
  queue: Queued[] = [];
  stopAt = Infinity;
  bars: { time: number; bar: Bar }[] = [];
  constructor(id: number, def: CueDef, start: number) {
    this.id = id;
    this.def = def;
    this.composer = new Composer(def);
    this.start = start;
    this.nextBar = start;
  }
  /** The bar sounding at a time, for keys, beats and diagnostics. */
  barAt(t: number) {
    let found = this.bars[0];
    for (const b of this.bars) if (b.time <= t + 1e-6) found = b;
    return found;
  }
}

export type MusicStats = { noteOns: number; skipped: number; voices: number; peakVoices: number };

export class Music {
  private ctx: BaseAudioContext;
  private mixer: Mixer;
  private bank: Bank;
  private perfs: Performance[] = [];
  private voices: Voice[] = [];
  private nextId = 1;
  private sideLevel: [number, number] = [1, 0];
  private sideQuietSince: [number, number] = [-Infinity, 0];
  cueName: string | null = null;
  firstStart = -1;
  radiant = false;
  /** Skip short notes on an arrangement that has been silent for a while. */
  economy = true;
  stats: MusicStats = { noteOns: 0, skipped: 0, voices: 0, peakVoices: 0 };
  /** Every scheduled note onset, for tests (bounded). */
  log: { t: number; midi: number; role: string; side: number }[] | null = null;

  constructor(ctx: BaseAudioContext, mixer: Mixer, bank: Bank) {
    this.ctx = ctx;
    this.mixer = mixer;
    this.bank = bank;
  }

  get current(): Performance | null {
    return this.perfs.length ? this.perfs[this.perfs.length - 1] : null;
  }

  /** Begin a cue on the next bar line of whatever is playing. */
  cue(name: string, now = this.ctx.currentTime) {
    const def = cueDef(name);
    if (this.cueName === def.id && this.current && this.current.stopAt === Infinity) return;
    this.cueName = def.id;
    const old = this.current;
    let start = now + 0.08;
    if (old && old.stopAt === Infinity) {
      const barLen = old.composer.barSeconds;
      const beat = old.composer.secPerTick * old.composer.meter.beatTicks;
      // The next bar line if it is close, otherwise the next beat.
      let t = old.nextBar;
      while (t - barLen > now + 0.2) t -= barLen;
      while (t < now + 0.2) t += barLen;
      if (t - now > 2.2) {
        let b = t - barLen;
        while (b < now + 0.2) b += beat;
        t = b;
      }
      start = t;
      old.stopAt = start;
      // Sustained notes of the old cue that cross the change fade out.
      for (const v of this.voices) if (v.perf === old.id && v.end > start) this.fadeVoice(v, start, v.sustained ? 0.5 : 1.2);
      old.queue = old.queue.filter((q) => q.time < start);
    }
    const perf = new Performance(this.nextId++, def, start);
    this.perfs.push(perf);
    if (this.firstStart < 0) this.firstStart = start;
    // Forget performances that have finished.
    this.perfs = this.perfs.filter((p) => p === perf || p.stopAt > now - 4);
  }

  stop(now = this.ctx.currentTime) {
    for (const p of this.perfs) p.stopAt = Math.min(p.stopAt, now);
    for (const v of this.voices) this.fadeVoice(v, now, 0.3);
    this.cueName = null;
  }

  setFold(f: number, now = this.ctx.currentTime) {
    const s = Math.cos((f * Math.PI) / 2);
    const i = Math.sin((f * Math.PI) / 2);
    const levels: [number, number] = [s, i];
    for (const side of [0, 1] as Side[]) {
      if (levels[side] < 0.002) {
        if (this.sideLevel[side] >= 0.002) this.sideQuietSince[side] = now;
      } else this.sideQuietSince[side] = Infinity;
    }
    this.sideLevel = levels;
  }

  /** Current key (for tuning effects) and position. */
  position(now = this.ctx.currentTime) {
    const p = this.current;
    if (!p) return null;
    const entry = p.barAt(now);
    if (!entry) return { cue: p.def.id, key: { tonic: p.def.tonic, mode: p.def.mode } as Key, bar: 0, beat: 0, section: "", bpm: p.def.bpm, beatPeriod: 60 / p.def.bpm, barStart: p.start, pass: 0 };
    const beatPeriod = entry.bar.secPerTick * p.composer.meter.beatTicks;
    const beat = Math.max(0, (now - entry.time) / beatPeriod);
    return {
      cue: p.def.id,
      key: entry.bar.key,
      bar: entry.bar.index,
      beat,
      section: entry.bar.section,
      bpm: p.def.bpm,
      beatPeriod,
      barStart: entry.time,
      pass: entry.bar.pass,
      chord: entry.bar.chords.reduce((a, c) => ((now - entry.time) / entry.bar.secPerTick >= c.tick ? c : a), entry.bar.chords[0]),
    };
  }

  /** Key of the newest cue, even before its first bar sounds. */
  targetKey(): Key {
    const p = this.current;
    if (!p) return { tonic: 2, mode: "ionian" };
    if (p.bars.length) return p.bars[p.bars.length - 1].bar.key;
    return { tonic: p.def.tonic, mode: p.def.mode };
  }

  /** Schedule everything that starts before `until`. */
  pump(now: number, until = now + LOOKAHEAD) {
    for (const p of this.perfs) {
      while (p.nextBar < until + 0.25 && p.nextBar < p.stopAt) {
        const bar = p.composer.next(this.radiant);
        const t0 = p.nextBar;
        p.bars.push({ time: t0, bar });
        if (p.bars.length > 6) p.bars.shift();
        for (const ev of bar.events) {
          const time = t0 + ev.tick * bar.secPerTick + (ev.shift ?? 0);
          if (time >= p.stopAt) continue;
          p.queue.push({ time, ev, secPerTick: bar.secPerTick });
        }
        p.queue.sort((a, b) => a.time - b.time);
        p.nextBar = t0 + bar.barTicks * bar.secPerTick;
      }
      let k = 0;
      while (k < p.queue.length && p.queue[k].time < until) {
        const q = p.queue[k++];
        this.play(p, q, now);
      }
      if (k) p.queue.splice(0, k);
    }
    // Retire voices that have ended.
    this.voices = this.voices.filter((v) => v.end > now - 0.05);
    this.stats.voices = this.voices.length;
  }

  private play(p: Performance, q: Queued, now: number) {
    let t = q.time;
    const late = now - t;
    if (late > 0) {
      // A late timer: play short notes only if barely late.
      if (late > 0.08 && q.ev.dur * q.secPerTick < 0.6) {
        this.stats.skipped++;
        return;
      }
      t = now + 0.005;
    }
    const durSec = q.ev.dur * q.secPerTick;
    for (const side of [0, 1] as Side[]) {
      const inst = side === 0 ? q.ev.s : q.ev.i;
      const sustained = inst === "pad" || inst === "strings" || inst === "harmonium" || (inst === "flute" && durSec > 0.8);
      if (this.economy && !sustained && this.sideLevel[side] < 0.002 && now - this.sideQuietSince[side] > 0.4) {
        this.stats.skipped++;
        continue;
      }
      if (this.voices.length > MAX_VOICES) {
        this.voices = this.voices.filter((v) => v.end > now);
        if (this.voices.length > MAX_VOICES && (q.ev.role === "arp" || q.ev.role === "sparkle" || q.ev.role === "shimmer")) {
          this.stats.skipped++;
          continue;
        }
      }
      this.voice(p, q.ev, inst, side, t, durSec);
    }
  }

  private voice(p: Performance, ev: NoteEvent, inst: InstName, side: Side, t: number, durSec: number) {
    const ctx = this.ctx;
    const dest = this.mixer.role(side, ev.role);
    let buffer: AudioBuffer;
    let rate = 1;
    let env: Env;
    let loopStart: number | undefined;
    let loopEnd: number | undefined;
    if (inst === "kit") {
      const [ks, ki, gs, gi] = KIT[ev.hit ?? "mid"];
      const s = this.bank.get(side === 0 ? ks : ki);
      if (!s) return;
      buffer = s.buffer;
      const r = rng(hash(p.id, t.toFixed(3), side));
      rate = 1 + (r() - 0.5) * 0.05;
      env = { attack: 0.001, release: 0.05, level: side === 0 ? gs : gi, natural: true };
      durSec = buffer.duration / rate;
    } else {
      const picked = this.bank.pick(inst as InstrumentName, ev.midi);
      if (!picked) return;
      buffer = picked.buffer;
      rate = picked.rate;
      loopStart = picked.loopStart;
      loopEnd = picked.loopEnd;
      env = ENV[inst];
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const sampleLen = buffer.duration / rate;
    let attack = env.attack;
    let release = env.release;
    if (inst === "pad") attack = Math.min(0.6, Math.max(0.12, durSec * 0.22));
    if (inst === "strings" && ev.role !== "lead") attack = Math.min(0.5, Math.max(0.15, durSec * 0.18));
    if (inst === "flute" && durSec < 0.25) release = 0.08;
    let end = t + durSec + release;
    let looping = false;
    if (env.loop && loopEnd !== undefined && loopStart !== undefined && end - t > (loopEnd - 0.02) / rate) {
      src.loop = true;
      src.loopStart = loopStart;
      src.loopEnd = loopEnd;
      looping = true;
    }
    if (!looping) end = Math.min(end, t + sampleLen);
    const peak = Math.pow(Math.max(0, Math.min(1, ev.vel)), 1.4) * env.level * (p.def.gain ?? 1);
    const g = ctx.createGain();
    g.gain.value = 0;
    const gp = g.gain;
    gp.setValueAtTime(0, t);
    if (ev.swell) {
      const crest = t + Math.max(0.2, durSec * 0.5);
      gp.linearRampToValueAtTime(peak * 0.15, t + 0.05);
      gp.linearRampToValueAtTime(peak, crest);
      gp.linearRampToValueAtTime(peak * 0.3, t + durSec);
      gp.linearRampToValueAtTime(0, end);
    } else {
      const hold = t + Math.max(attack + 0.005, durSec);
      gp.linearRampToValueAtTime(peak, t + attack);
      // Natural decays get a damper at the note's end; sustained notes a release.
      if (hold < end) gp.setValueAtTime(peak, hold);
      gp.linearRampToValueAtTime(0, end);
    }
    src.connect(g).connect(dest);
    src.start(t);
    src.stop(end + 0.02);
    const voice: Voice = { src, gain: g, end, perf: p.id, side, sustained: !!env.loop };
    src.onended = () => {
      g.disconnect();
    };
    this.voices.push(voice);
    this.stats.noteOns++;
    if (this.log && this.log.length < 20000) this.log.push({ t, midi: ev.midi, role: ev.role, side });
    const live = this.voices.length;
    if (live > this.stats.peakVoices) this.stats.peakVoices = live;
  }

  private fadeVoice(v: Voice, at: number, seconds: number) {
    const p = v.gain.gain;
    const t = Math.max(at, this.ctx.currentTime);
    if (typeof p.cancelAndHoldAtTime === "function") p.cancelAndHoldAtTime(t);
    else {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
    }
    p.setTargetAtTime(0, t, seconds / 4);
    const end = t + seconds + 0.05;
    if (end < v.end) {
      try {
        v.src.stop(end);
      } catch {
        /* already stopped */
      }
      v.end = end;
    }
  }

  /** Stop every voice now (used when an offline render ends or on teardown). */
  silence() {
    const now = this.ctx.currentTime;
    for (const v of this.voices) this.fadeVoice(v, now, 0.05);
  }
}
