import type { Role } from "./composer";
import { HALL, ROOM, impulse } from "./reverb";

/**
 * The fixed mixing graph (about seventy nodes, created once):
 *
 *   role channels (gain, pan) ─▶ side S: fold ▶ filter ▶ duck ▶ sting ▶ vol ─┬▶ master
 *                              └▶ side I: fold ▶ filter ▶ duck ▶ sting ▶ vol ─┤
 *                                   S sends to the hall, I sends to the room   │
 *   effects ─▶ world hold ─┐                                                   │
 *   ambience ─▶ world hold ┼▶ fx volume ─┬────────────────────────────────────┤
 *   interface ────────────┘              └▶ hall and room by fold              │
 *   hall, room ───────────────────────────────────────────────────────────────┤
 *   master: mute ▶ high-pass ▶ glue compressor ▶ limiter ▶ soft clip ▶ output ◀┘
 */

export const SIDES = [0, 1] as const;
export type Side = 0 | 1;

const ROLE_MIX: Record<Role, { gain: [number, number]; pan: [number, number] }> = {
  lead: { gain: [1, 1], pan: [0.04, -0.04] },
  double: { gain: [0.6, 0.55], pan: [-0.1, 0.12] },
  counter: { gain: [0.7, 0.78], pan: [0.26, 0.3] },
  arp: { gain: [0.8, 0.78], pan: [-0.22, -0.28] },
  pad: { gain: [0.42, 0.32], pan: [0, 0] },
  bass: { gain: [0.72, 0.88], pan: [0, 0.04] },
  swell: { gain: [0.5, 0.36], pan: [-0.1, 0.1] },
  sparkle: { gain: [0.55, 0.6], pan: [0.35, 0.38] },
  perc: { gain: [0.7, 0.8], pan: [0.08, -0.1] },
  shimmer: { gain: [0.78, 0.82], pan: [-0.3, 0.3] },
  halo: { gain: [0.55, 0.42], pan: [0.2, -0.2] },
};

/** Per-arrangement level trims so both arrangements sit at the same loudness. */
export const ARRANGEMENT_TRIM: [number, number] = [1, 1.15];
/** Reverb send per arrangement: the hall is generous, the room intimate. */
const SEND: [number, number] = [0.5, 0.3];

export class Mixer {
  readonly ctx: BaseAudioContext;
  readonly output: AudioNode;
  readonly master: GainNode;
  readonly compressor: DynamicsCompressorNode;
  readonly limiter: DynamicsCompressorNode;
  readonly hall: ConvolverNode;
  readonly room: ConvolverNode;
  readonly fold: GainNode[] = [];
  readonly filter: BiquadFilterNode[] = [];
  readonly duck: GainNode[] = [];
  readonly sting: GainNode[] = [];
  readonly vol: GainNode[] = [];
  readonly sideIn: GainNode[] = [];
  readonly roles = new Map<string, GainNode>();
  readonly world: GainNode;
  readonly fx: GainNode;
  readonly sfx: GainNode;
  readonly ui: GainNode;
  readonly amb: GainNode;
  readonly fxHall: GainNode;
  readonly fxRoom: GainNode;
  /** Analyser on the final output, created on demand for diagnostics. */
  analyser: AnalyserNode | null = null;
  readonly tap: GainNode;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const g = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    // Master chain.
    this.master = g(1);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 30;
    hp.Q.value = 0.6;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -20;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 2.2;
    this.compressor.attack.value = 0.015;
    this.compressor.release.value = 0.3;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    this.tap = g(1);
    this.master.connect(hp).connect(this.compressor).connect(this.limiter).connect(clip).connect(this.tap);
    this.tap.connect(ctx.destination);
    this.output = this.tap;

    // Reverbs.
    this.hall = ctx.createConvolver();
    this.room = ctx.createConvolver();
    const hallRet = g(0.9);
    const roomRet = g(0.85);
    this.hall.connect(hallRet).connect(this.master);
    this.room.connect(roomRet).connect(this.master);
    // Impulses are generated after construction so unlock returns at once.
    const fill = () => {
      this.hall.buffer = impulse(ctx, HALL);
      this.room.buffer = impulse(ctx, ROOM);
    };
    if (typeof OfflineAudioContext !== "undefined" && ctx instanceof OfflineAudioContext) fill();
    else setTimeout(fill, 0);

    // Music: two arrangements.
    for (const side of SIDES) {
      const inn = g(1);
      const fold = g(side === 0 ? 1 : 0);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 20000;
      filter.Q.value = 0.5;
      const duck = g(1);
      const sting = g(1);
      const vol = g(1);
      inn.connect(fold).connect(filter).connect(duck).connect(sting).connect(vol);
      vol.connect(this.master);
      // Reverb sends are high-passed so the tails stay clear of the bass.
      const send = g(SEND[side]);
      const sendHp = ctx.createBiquadFilter();
      sendHp.type = "highpass";
      sendHp.frequency.value = side === 0 ? 180 : 150;
      vol.connect(send).connect(sendHp).connect(side === 0 ? this.hall : this.room);
      this.sideIn.push(inn);
      this.fold.push(fold);
      this.filter.push(filter);
      this.duck.push(duck);
      this.sting.push(sting);
      this.vol.push(vol);
    }
    for (const role of Object.keys(ROLE_MIX) as Role[])
      for (const side of SIDES) {
        const m = ROLE_MIX[role];
        const gain = g(m.gain[side]);
        const pan = ctx.createStereoPanner();
        pan.pan.value = m.pan[side];
        gain.connect(pan).connect(this.sideIn[side]);
        this.roles.set(`${side}:${role}`, gain);
      }

    // Effects, ambience and interface.
    this.fx = g(0.64);
    this.world = g(1);
    this.sfx = g(1);
    this.amb = g(1);
    this.ui = g(1);
    this.sfx.connect(this.world);
    this.amb.connect(this.world);
    this.world.connect(this.fx);
    this.ui.connect(this.fx);
    this.fx.connect(this.master);
    this.fxHall = g(0.22);
    this.fxRoom = g(0);
    const fxHp = ctx.createBiquadFilter();
    fxHp.type = "highpass";
    fxHp.frequency.value = 220;
    this.fx.connect(fxHp);
    fxHp.connect(this.fxHall).connect(this.hall);
    fxHp.connect(this.fxRoom).connect(this.room);
  }

  role(side: Side, role: Role) {
    return this.roles.get(`${side}:${role}`)!;
  }

  /** A role channel's mix level. */
  roleLevel(side: Side, role: Role) {
    return ROLE_MIX[role].gain[side];
  }

  private set(p: AudioParam, v: number, tc: number, at = this.ctx.currentTime) {
    p.cancelScheduledValues(at);
    p.setTargetAtTime(v, at, tc);
  }

  /** Equal-power crossfade between the arrangements; reverb sends follow. */
  setFold(f: number, at = this.ctx.currentTime) {
    const x = Math.max(0, Math.min(1, f));
    const s = Math.cos((x * Math.PI) / 2) * ARRANGEMENT_TRIM[0];
    const i = Math.sin((x * Math.PI) / 2) * ARRANGEMENT_TRIM[1];
    this.set(this.fold[0].gain, s, 0.02, at);
    this.set(this.fold[1].gain, i, 0.02, at);
    this.set(this.fxHall.gain, 0.22 * Math.cos((x * Math.PI) / 2), 0.03, at);
    this.set(this.fxRoom.gain, 0.2 * Math.sin((x * Math.PI) / 2), 0.03, at);
  }

  /** Music shaping for pause and death: a low-pass and a level dip. */
  shapeMusic(cutoff: number, duck: number, tc: number) {
    for (const side of SIDES) {
      this.set(this.filter[side].frequency, cutoff, tc);
      this.set(this.duck[side].gain, duck, tc);
    }
  }

  /** Briefly lower the music under a stinger or a big reward. */
  stingDuck(amount: number, hold: number, release = 0.6) {
    const now = this.ctx.currentTime;
    for (const side of SIDES) {
      const p = this.sting[side].gain;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(amount, now, 0.06);
      p.setTargetAtTime(1, now + hold, release);
    }
  }

  setVolumes(music: number, effects: number, muted: boolean) {
    const curve = (v: number) => Math.pow(Math.max(0, Math.min(1, v)), 1.6);
    for (const side of SIDES) this.set(this.vol[side].gain, curve(music) * 1.6, 0.05);
    this.set(this.fx.gain, curve(effects) * 1.12, 0.05);
    this.set(this.master.gain, muted ? 0 : 1, 0.04);
  }

  setWorldHeld(held: boolean) {
    this.set(this.world.gain, held ? 0 : 1, held ? 0.12 : 0.25);
  }

  /** Peak and RMS of the final output over the analyser window. */
  meter() {
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.tap.connect(this.analyser);
    }
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let p = 0,
      s = 0;
    for (const v of buf) {
      p = Math.max(p, Math.abs(v));
      s += v * v;
    }
    return { peak: p, rms: Math.sqrt(s / buf.length) };
  }
}

function softClipCurve() {
  const n = 4096;
  const c = new Float32Array(n);
  const knee = 0.86;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a < knee ? a : knee + (0.985 - knee) * Math.tanh((a - knee) / (0.985 - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}
