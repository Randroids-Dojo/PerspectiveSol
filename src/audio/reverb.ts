import { random } from "./dsp";

/**
 * Procedural stereo impulse responses: decorrelated noise with an exponential
 * decay that darkens over time, a pre-delay, and a cluster of early
 * reflections. The hall is large and warm; the room is small and wooden.
 */

export type RoomShape = {
  seconds: number;
  rt60: number;
  preDelay: number;
  /** Low-pass cutoff at the start and end of the tail (Hz). */
  brightStart: number;
  brightEnd: number;
  early: number;
  earlySpread: number;
  seed: number;
};

export const HALL: RoomShape = {
  seconds: 3.4,
  rt60: 2.9,
  preDelay: 0.024,
  brightStart: 8500,
  brightEnd: 1300,
  early: 12,
  earlySpread: 0.09,
  seed: 3,
};

export const ROOM: RoomShape = {
  seconds: 1.1,
  rt60: 0.8,
  preDelay: 0.006,
  brightStart: 6500,
  brightEnd: 2400,
  early: 18,
  earlySpread: 0.035,
  seed: 5,
};

export function impulse(ctx: BaseAudioContext, shape: RoomShape): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(shape.seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const R = random(shape.seed * 17 + ch * 101);
    const pre = Math.floor(shape.preDelay * sr);
    const fade = Math.floor(0.006 * sr);
    let lp = 0;
    let a = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      if ((i & 63) === 0) {
        const f = shape.brightStart * Math.pow(shape.brightEnd / shape.brightStart, Math.min(1, t / shape.rt60));
        a = Math.exp((-2 * Math.PI * f) / sr);
      }
      const x = R() * 2 - 1;
      lp = x + (lp - x) * a;
      const env = Math.exp((-6.9 * t) / shape.rt60) * Math.min(1, (i - pre) / fade);
      // End the tail smoothly.
      const tail = Math.min(1, (n - i) / (0.05 * sr));
      data[i] = lp * env * tail;
    }
    for (let k = 0; k < shape.early; k++) {
      const t = shape.preDelay * 0.4 + R() * shape.earlySpread;
      const at = Math.floor(t * sr);
      const g = (0.5 + R() * 0.5) * (1 - k / (shape.early + 2)) * (R() < 0.5 ? -1 : 1) * 0.9;
      for (let j = 0; j < 24 && at + j < n; j++) data[at + j] += g * Math.exp(-j / 4) * (j === 0 ? 0.5 : 0.25);
    }
  }
  return buf;
}
