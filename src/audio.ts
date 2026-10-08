import type { Event } from "./core";
export class Sound {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  music: GainNode | null = null;
  fx: GainNode | null = null;
  depth: GainNode | null = null;
  wind: GainNode | null = null;
  musicVolume = 0.55;
  effectsVolume = 0.7;
  started = false;
  loaded = false;
  buffers: AudioBuffer[] = [];
  sources: AudioBufferSourceNode[] = [];
  notes = 0;
  lastStep = 0;
  async start() {
    if (this.context) {
      await this.context.resume();
      return;
    }
    this.context = new AudioContext();
    const a = this.context;
    this.master = a.createGain();
    this.master.gain.value = 0.8;
    const compressor = a.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    this.master.connect(compressor).connect(a.destination);
    this.music = a.createGain();
    this.music.gain.value = this.musicVolume;
    this.music.connect(this.master);
    this.fx = a.createGain();
    this.fx.gain.value = this.effectsVolume;
    this.fx.connect(this.master);
    this.depth = a.createGain();
    this.depth.gain.value = 0.65;
    this.depth.connect(this.music);
    this.wind = a.createGain();
    this.wind.gain.value = 0.035;
    this.wind.connect(this.fx);
    const noise = a.createBuffer(1, a.sampleRate * 4, a.sampleRate),
      data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] =
        (Math.random() * 2 - 1) *
        (0.6 + 0.4 * Math.sin((i / a.sampleRate) * 0.8));
    const n = a.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    const filter = a.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 550;
    n.connect(filter).connect(this.wind);
    n.start();
    this.sources.push(n);
    this.started = true;
    try {
      this.buffers = await Promise.all(
        ["/audio/sol-keys.mp3", "/audio/sol-depth.mp3"].map(async (url) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error("Audio unavailable");
          return a.decodeAudioData(await response.arrayBuffer());
        }),
      );
      const when = a.currentTime + 0.05;
      this.buffers.forEach((buffer, i) => {
        const source = a.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(i === 0 ? this.music! : this.depth!);
        source.start(when);
        this.sources.push(source);
      });
      this.loaded = true;
    } catch {
      this.loaded = false;
    }
  }
  setVolumes(music: number, fx: number) {
    this.musicVolume = music;
    this.effectsVolume = fx;
    if (this.context) {
      this.music?.gain.setTargetAtTime(music, this.context.currentTime, 0.08);
      this.fx?.gain.setTargetAtTime(fx, this.context.currentTime, 0.08);
    }
  }
  perspective(amount: number) {
    if (this.context)
      this.depth?.gain.setTargetAtTime(
        amount * 0.7,
        this.context.currentTime,
        0.08,
      );
  }
  async pause(paused: boolean) {
    if (!this.context) return;
    if (paused) await this.context.suspend();
    else await this.context.resume();
  }
  tone(
    freq: number,
    duration: number,
    volume: number,
    type: OscillatorType = "sine",
    pan = 0,
    delay = 0,
    slide?: number,
  ) {
    const a = this.context;
    if (!a || !this.fx) return;
    const t = a.currentTime + delay;
    const oscillator = a.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, t);
    if (slide)
      oscillator.frequency.exponentialRampToValueAtTime(slide, t + duration);
    const envelope = a.createGain();
    envelope.gain.setValueAtTime(0, t);
    envelope.gain.linearRampToValueAtTime(volume, t + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    const stereo = a.createStereoPanner();
    stereo.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    oscillator.connect(envelope).connect(stereo).connect(this.fx);
    oscillator.start(t);
    oscillator.stop(t + duration + 0.02);
    this.notes++;
  }
  event(e: Event, pan: number) {
    switch (e.type) {
      case "jump":
        this.tone(210, 0.22, 0.065, "sine", pan, 0, 540);
        this.tone(90, 0.08, 0.04, "triangle", pan);
        break;
      case "land":
        this.tone(75, 0.12, 0.07, "triangle", pan, 0, 35);
        this.tone(650, 0.05, 0.016, "sine", pan);
        break;
      case "shift":
        [261.63, 392, 523.25].forEach((f, i) =>
          this.tone(f, 0.48, 0.045, "sine", pan, i * 0.035, f * 1.5),
        );
        break;
      case "shard":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.tone(f, 1.1, 0.06, "sine", pan, i * 0.075),
        );
        break;
      case "mote":
        this.tone(1174.66, 0.55, 0.04, "sine", pan);
        this.tone(1567.98, 0.7, 0.022, "sine", pan, 0.06);
        break;
      case "checkpoint":
        [392, 523.25, 659.25].forEach((f, i) =>
          this.tone(f, 0.65, 0.045, "sine", pan, i * 0.09),
        );
        break;
      case "fall":
        this.tone(310, 0.45, 0.04, "sine", pan, 0, 80);
        break;
      case "clear":
        [261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.tone(f, 2, 0.06, "sine", pan, i * 0.11),
        );
        break;
      case "locked":
        this.tone(180, 0.12, 0.035, "triangle", pan);
        break;
    }
  }
  footstep(t: number, stone: boolean) {
    if (t - this.lastStep < 0.29) return;
    this.lastStep = t;
    this.tone(stone ? 125 : 95, 0.075, 0.027, "triangle", 0, 0, 45);
  }
  snapshot() {
    return {
      state: this.context?.state ?? "not-started",
      loaded: this.loaded,
      music: this.musicVolume,
      effects: this.effectsVolume,
      notes: this.notes,
      transport: this.context?.currentTime ?? 0,
      sources: this.sources.length,
      depth: this.depth?.gain.value ?? 0,
    };
  }
}
