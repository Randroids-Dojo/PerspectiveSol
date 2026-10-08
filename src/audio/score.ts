import type { MeterName, ModeName } from "./theory";

/**
 * The score of Perspective Sol. Every cue is built from the Sol leitmotif:
 *
 *     1 . . 5 6 . 5 . | 3 . . . . . 2 .      (a rising fifth, a lift to the
 *                                             sixth, a fall to the third)
 *
 * Its colour changes with each chapter's mode: bright in the morning (Ionian
 * with a Lydian fourth), sunny in the courtyard (Mixolydian), curious in the
 * engine (Dorian sixth), sighing at dusk (Aeolian flat sixth), floating at
 * night (Lydian sharp fourth), and whole again at dawn and in the ending.
 *
 * Melodies are scale degrees in the cue's mode; see theory.ts for notation.
 */

export type ArpStyle =
  | "flow8"
  | "pastoral"
  | "waltzStab"
  | "waltzFlow"
  | "ostinato16"
  | "sparse4"
  | "hymn";
export type PercStyle = "soft44" | "pastoral68" | "dance34" | "clock44" | "waltz34" | "night44" | "march44";
export type BassStyle = "long" | "pulse" | "pastoral" | "oom" | "clock" | "walk";
export type LeadS = "piano" | "strings";
export type LeadI = "flute" | "celesta";

export type SectionDef = { chords: string; melody?: string };

export type FormEntry = {
  sec: string;
  /** 0..1: how many layers play and how strongly. */
  energy: number;
  /** Transposition in semitones and an optional mode for this passage. */
  key?: number;
  mode?: ModeName;
  /** Instruments for the melody in each arrangement. */
  lead?: [LeadS, LeadI];
  /** Melody variation amount, 0 = as written. */
  vary?: number;
  arp?: ArpStyle;
  bass?: BassStyle;
  perc?: PercStyle | "none";
};

export type CueDef = {
  id: string;
  title: string;
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  mode: ModeName;
  bpm: number;
  meter: MeterName;
  /** MIDI note of degree 1 for the melody. */
  melodyBase: number;
  arp: ArpStyle;
  perc: PercStyle;
  bass: BassStyle;
  sections: Record<string, SectionDef>;
  intro: FormEntry[];
  /** Loop plans, alternated pass by pass for a longer cycle. */
  loop: FormEntry[][];
  seed: number;
  /** Level trim so every cue sits at the same loudness. */
  gain?: number;
};

/** The Sol theme as heard in the title and reprised at dawn and in the ending. */
const SOL_A = {
  melody:
    "1:6 5:2 6:4 5:4 | 3:12 2:4 | 1:6 5:2 6:2 7:2 1':4 | 7:8 5:8 | " +
    "1':6 7:2 6:4 5:4 | 3:6 4:2 5:8 | 6:4 5:4 3:6 2:2 | 1:16",
  chords: "1 | 6:12 5/7:4 | 4.9 | 5 | 4.9 | 3:8 6.7:8 | 4:8 1/5:4 5.7:4 | 1",
};
const SOL_B = {
  melody:
    "6,:6 3:2 4:4 3:4 | 1:12 7,:4 | 3:6 7:2 1':4 7:4 | 5:12 4:4 | " +
    "2':6 1':2 7:4 6:4 | 1':8 5:8 | b6:8 5:4 4:4 | 2:8 r:4 5,:4",
  chords: "6:8 4/6:8 | 4:12 5/7:4 | 3:8 6:8 | 4.9 | 2.7 | 4 | 4m | 5.s4:8 5:8",
};

const TITLE: CueDef = {
  gain: 1.06,
  id: "title",
  title: "Sol",
  tonic: 2,
  mode: "ionian",
  bpm: 72,
  meter: "4/4",
  melodyBase: 74,
  arp: "flow8",
  perc: "soft44",
  bass: "long",
  seed: 101,
  sections: {
    intro: { chords: "1 | 4.M7 | 1 | 5.s4:8 5:8" },
    A: SOL_A,
    B: SOL_B,
    I: { chords: "4.M7 | 1/3 | 2.7 | 5.s4:8 5:8" },
  },
  intro: [{ sec: "intro", energy: 0.22 }],
  loop: [
    [
      { sec: "A", energy: 0.42, lead: ["piano", "flute"] },
      { sec: "A", energy: 0.6, lead: ["piano", "flute"], vary: 0.5 },
      { sec: "B", energy: 0.68, lead: ["strings", "flute"] },
      { sec: "A", energy: 0.86, lead: ["piano", "flute"], vary: 0.6, bass: "pulse" },
      { sec: "I", energy: 0.3 },
    ],
    [
      { sec: "A", energy: 0.48, lead: ["piano", "celesta"], vary: 0.4 },
      { sec: "A", energy: 0.64, lead: ["strings", "flute"], vary: 0.7 },
      { sec: "B", energy: 0.74, lead: ["piano", "flute"], vary: 0.5 },
      { sec: "A", energy: 0.92, lead: ["piano", "flute"], vary: 0.8, bass: "pulse" },
      { sec: "I", energy: 0.34 },
      { sec: "I", energy: 0.24 },
    ],
  ],
};

const MORNING: CueDef = {
  gain: 1.02,
  id: "0",
  title: "The waking garden",
  tonic: 7,
  mode: "ionian",
  bpm: 66,
  meter: "6/8",
  melodyBase: 67,
  arp: "pastoral",
  perc: "pastoral68",
  bass: "pastoral",
  seed: 202,
  sections: {
    intro: { chords: "1 | 4/1 | 1 | 4/1" },
    A: {
      melody:
        "1:4 5:2 6:4 5:2 | 3:8 2:4 | 3:4 7:2 1':4 7:2 | 5:8 4:4 | " +
        "3:4 5:2 1':4 2':2 | 3':8 2':4 | 1':4 6:2 5:4 3:2 | 2:12 | " +
        "1:4 5:2 6:4 5:2 | 3:8 2:4 | 3:4 7:2 1':4 7:2 | 1':6 6:6 | " +
        "5:4 6:2 7:4 1':2 | 2':8 1':4 | 6:6 5:4 4:2 | 1:12",
      chords:
        "1 | 6.7 | 4.M7 | 5.7 | 1/3 | 6 | 4.9 | 5.s4:6 5:6 | " +
        "1 | 6.7 | 4.M7 | 2.7 | 5/7 | 2.7 | 5.7 | 1",
    },
    B: {
      melody:
        "1':8 2':2 3':2 | 2':12 | 1':8 7:2 6:2 | 5:12 | " +
        "6:4 1':2 2':4 1':2 | 7:8 6:4 | 1':6 b6:6 | 5:6 4:6",
      chords: "4.M7 | 4.6 | 1/3 | 1/3 | 2.7 | 5/7 | 4m | 5.s4:6 5.7:6",
    },
    I: { chords: "1 | 4/1 | 1 | 4/1 | 6.7 | 4.M7 | 2.7 | 5.s4:6 5:6" },
  },
  intro: [{ sec: "intro", energy: 0.25 }],
  loop: [
    [
      { sec: "A", energy: 0.48, lead: ["piano", "flute"] },
      { sec: "B", energy: 0.58, lead: ["strings", "flute"] },
      { sec: "B", energy: 0.7, lead: ["piano", "celesta"], vary: 0.6 },
      { sec: "A", energy: 0.84, lead: ["piano", "flute"], vary: 0.6 },
      { sec: "I", energy: 0.32 },
    ],
    [
      { sec: "A", energy: 0.55, lead: ["piano", "celesta"], vary: 0.5 },
      { sec: "B", energy: 0.64, lead: ["piano", "flute"], vary: 0.4 },
      { sec: "B", energy: 0.76, lead: ["strings", "flute"], vary: 0.7 },
      { sec: "A", energy: 0.9, lead: ["piano", "flute"], vary: 0.8 },
      { sec: "I", energy: 0.3 },
    ],
  ],
};

const NOON: CueDef = {
  gain: 1.02,
  id: "1",
  title: "The hidden courtyard",
  tonic: 9,
  mode: "mixolydian",
  bpm: 100,
  meter: "3/4",
  melodyBase: 69,
  arp: "waltzStab",
  perc: "dance34",
  bass: "oom",
  seed: 303,
  sections: {
    intro: { chords: "1 | 7/1 | 4/1 | 1" },
    A: {
      melody:
        "1:4 5:2 6:2 5:4 | 2:8 1:4 | 1:4 5:2 6:2 1':4 | 3':8 2':4 | " +
        "1':4 6:2 5:2 6:4 | 4:8 3:4 | 2:4 7,:2 1:2 2:4 | 1:12 | " +
        "1:4 5:2 6:2 5:4 | 2:8 1:4 | 1:4 5:2 6:2 1':4 | 2':8 1':4 | " +
        "4':4 3':2 2':2 1':4 | 2':8 7:4 | 5:4 4:2 3:2 2:4 | 1:12",
      chords: "1 | 7 | 4 | 1 | 6 | 4 | 7 | 1 | 1 | 7 | 4 | 2.7 | 4 | 7 | 5.7 | 1",
    },
    B: {
      melody:
        "6:8 5:2 6:2 | 1':8 6:4 | 5:8 3:4 | 2:12 | " +
        "6:4 1':2 2':2 3':4 | 2':8 1':4 | 6:6 5:2 4:4 | 6:6 2:6",
      chords: "6 | 4 | 1/3 | 7 | 6 | 2.7 | 4 | 4:6 7:6",
    },
    I: { chords: "1 | 7/1 | 4/1 | 1 | 6 | 7 | 4 | 5.7:6 7:6" },
  },
  intro: [{ sec: "intro", energy: 0.3 }],
  loop: [
    [
      { sec: "A", energy: 0.55, lead: ["piano", "flute"] },
      { sec: "B", energy: 0.6, lead: ["strings", "celesta"] },
      { sec: "B", energy: 0.72, lead: ["piano", "flute"], vary: 0.6 },
      { sec: "A", energy: 0.86, lead: ["piano", "flute"], vary: 0.6, bass: "walk" },
      { sec: "I", energy: 0.4 },
    ],
    [
      { sec: "A", energy: 0.6, lead: ["piano", "celesta"], vary: 0.5 },
      { sec: "B", energy: 0.66, lead: ["piano", "flute"], vary: 0.4 },
      { sec: "B", energy: 0.78, lead: ["strings", "flute"], vary: 0.7 },
      { sec: "A", energy: 0.92, lead: ["piano", "flute"], vary: 0.8, bass: "walk" },
      { sec: "I", energy: 0.36 },
    ],
  ],
};

const AFTERNOON: CueDef = {
  gain: 0.93,
  id: "2",
  title: "The tide engine",
  tonic: 4,
  mode: "dorian",
  bpm: 92,
  meter: "4/4",
  melodyBase: 76,
  arp: "ostinato16",
  perc: "clock44",
  bass: "clock",
  seed: 404,
  sections: {
    intro: { chords: "1 | 4/1 | 1 | 4/1" },
    A: {
      melody:
        "1:6 5:2 6:4 5:4 | 3:12 2:4 | 1:6 5:2 6:2 7:2 1':4 | 7:8 4:8 | " +
        "3:6 4:2 5:4 3:4 | 2:8 1:4 7,:4 | 1:8 6,:8 | 2:16",
      chords: "1 | 4.7 | 1 | 7 | 3.7 | 7 | 1:8 4:8 | 5.s4:8 5.7:8",
    },
    B: {
      melody:
        "5:12 3:4 | 4:8 2:8 | 3:6 2:2 1:8 | 5,:16 | " +
        "1':6 7:2 5:8 | 4:8 7:8 | 6:8 5:4 4:4 | 4:8 2:8",
      chords: "b6M.M7 | 7 | 1 | 1 | b6M.M7 | 7 | 4 | 5.7",
    },
    I: { chords: "1 | 4/1 | 1 | 4/1 | 3.7 | 7 | b6M.M7 | 5.7" },
  },
  intro: [{ sec: "intro", energy: 0.3 }],
  loop: [
    [
      { sec: "A", energy: 0.5, lead: ["piano", "flute"] },
      { sec: "A", energy: 0.68, lead: ["piano", "celesta"], vary: 0.5 },
      { sec: "B", energy: 0.6, lead: ["strings", "flute"] },
      { sec: "B", energy: 0.74, lead: ["strings", "flute"], vary: 0.6 },
      { sec: "A", energy: 0.88, lead: ["piano", "flute"], vary: 0.7 },
      { sec: "I", energy: 0.4 },
    ],
    [
      { sec: "A", energy: 0.55, lead: ["piano", "celesta"], vary: 0.4 },
      { sec: "A", energy: 0.72, lead: ["piano", "flute"], vary: 0.6 },
      { sec: "B", energy: 0.64, lead: ["piano", "flute"], vary: 0.4 },
      { sec: "B", energy: 0.78, lead: ["strings", "celesta"], vary: 0.7 },
      { sec: "A", energy: 0.92, lead: ["piano", "flute"], vary: 0.8 },
      { sec: "I", energy: 0.36 },
    ],
  ],
};

const DUSK: CueDef = {
  gain: 1.15,
  id: "3",
  title: "The violet archive",
  tonic: 0,
  mode: "aeolian",
  bpm: 72,
  meter: "3/4",
  melodyBase: 72,
  arp: "waltzFlow",
  perc: "waltz34",
  bass: "oom",
  seed: 505,
  sections: {
    intro: { chords: "1 | 6.M7 | 4.7 | 5M" },
    A: {
      melody:
        "1:4 5:2 6:2 5:4 | 3:8 2:4 | 1:4 5:2 6:2 1':4 | #7:8 5:4 | " +
        "1':6 7:2 6:4 | 5:8 3:4 | 4:4 3:4 2:4 | #7,:12 | " +
        "1:4 5:2 6:2 5:4 | 3:8 2:4 | 1:4 5:2 6:2 1':4 | 6:8 4:4 | " +
        "5:4 1':4 3':4 | 2':6 1':2 #7:4 | 1':6 6:2 5:4 | 1:12",
      chords:
        "1 | 6:8 5M:4 | 4 | 5M | 6.M7 | 3 | 4.7:8 5M:4 | 5M | " +
        "1 | 6:8 5M:4 | 4 | b2M | 1/5 | 5M.7 | 4.7:8 5M.7:4 | 1",
    },
    B: {
      melody:
        "3:4 7:2 1':2 7:4 | 2':8 1':4 | 1':4 6:2 5:2 6:4 | 6:8 4:4 | " +
        "5:4 7:2 1':2 3':4 | 1':8 6:4 | 4:4 3:4 2:4 | 5:12",
      chords: "3 | 7 | 6.M7 | 4.7 | 3/5 | 6 | 4.7:8 5M:4 | 5M.s4:6 5M:6",
    },
    I: { chords: "1 | 6.M7 | 4.7 | 5M | 1 | 6 | b2M | 5M.7" },
  },
  intro: [{ sec: "intro", energy: 0.24 }],
  loop: [
    [
      { sec: "A", energy: 0.5, lead: ["piano", "celesta"] },
      { sec: "B", energy: 0.62, lead: ["strings", "flute"] },
      { sec: "A", energy: 0.8, lead: ["piano", "flute"], vary: 0.6 },
      { sec: "I", energy: 0.34 },
    ],
    [
      { sec: "A", energy: 0.55, lead: ["piano", "flute"], vary: 0.4 },
      { sec: "B", energy: 0.66, lead: ["piano", "celesta"], vary: 0.5 },
      { sec: "A", energy: 0.85, lead: ["strings", "flute"], vary: 0.7 },
      { sec: "I", energy: 0.3 },
    ],
  ],
};

const NIGHT: CueDef = {
  gain: 1.32,
  id: "4",
  title: "The night crossing",
  tonic: 1,
  mode: "lydian",
  bpm: 66,
  meter: "4/4",
  melodyBase: 73,
  arp: "sparse4",
  perc: "night44",
  bass: "long",
  seed: 606,
  sections: {
    intro: { chords: "1.M7 | 2/1 | 1.M7 | 2/1" },
    A: {
      melody:
        "1:6 5:2 6:4 5:4 | 4:12 3:4 | 1:6 5:2 6:2 7:2 1':4 | 7:8 5:8 | " +
        "1':6 7:2 6:4 5:4 | 4:8 2:8 | 3:8 2:4 7,:4 | 1:16",
      chords: "1.M7 | 2/1 | 6.7 | 5 | 6.7 | 2 | 3.7:8 5:8 | 1.9",
    },
    B: {
      melody:
        "5:8 6:4 1':4 | 7:12 6:4 | 6:8 4:8 | 2':16 | " +
        "1':6 7:2 6:8 | 5:8 3:8 | 4:8 2:4 1:4 | 2:16",
      chords: "6.7 | 3 | 2 | 2 | 6 | 3.7 | 2.7 | 5.s4:8 5:8",
    },
    I: { chords: "1.M7 | 2/1 | 1.M7 | 2/1" },
  },
  intro: [{ sec: "intro", energy: 0.2 }],
  loop: [
    [
      { sec: "A", energy: 0.4, lead: ["piano", "flute"] },
      { sec: "A", energy: 0.55, lead: ["strings", "celesta"], vary: 0.4 },
      { sec: "B", energy: 0.5, lead: ["piano", "flute"] },
      { sec: "B", energy: 0.62, lead: ["strings", "flute"], vary: 0.5 },
      { sec: "A", energy: 0.72, lead: ["piano", "flute"], vary: 0.6 },
      { sec: "I", energy: 0.28 },
    ],
    [
      { sec: "A", energy: 0.45, lead: ["piano", "celesta"], vary: 0.3 },
      { sec: "A", energy: 0.6, lead: ["piano", "flute"], vary: 0.6 },
      { sec: "B", energy: 0.55, lead: ["strings", "flute"], vary: 0.4 },
      { sec: "B", energy: 0.66, lead: ["piano", "celesta"], vary: 0.6 },
      { sec: "A", energy: 0.76, lead: ["strings", "flute"], vary: 0.7 },
      { sec: "I", energy: 0.26 },
    ],
  ],
};

const DAWN: CueDef = {
  gain: 0.94,
  id: "5",
  title: "The last observatory",
  tonic: 10,
  mode: "ionian",
  bpm: 80,
  meter: "4/4",
  melodyBase: 70,
  arp: "flow8",
  perc: "march44",
  bass: "pulse",
  seed: 707,
  sections: {
    intro: { chords: "1 | 4.M7 | 1 | 5.s4:8 5:8" },
    A: SOL_A,
    B: {
      melody: "1':8 6:8 | 5:8 3:8 | 4:8 6:8 | 7:8 5:8 | 3':8 1':8 | 5:8 7:8 | 6:8 1':8 | 2':8 7:8",
      chords: "4 | 1/3 | 2.7 | 5 | 6 | 3 | 4 | 5.s4:8 5:8",
    },
    // Memories: the motif in each earlier chapter's colour.
    C1: { melody: "1:6 5:2 6:4 5:4 | 3:12 2:4", chords: "1:8 4:8 | 6:12 5M:4" },
    C2: { melody: "1:6 5:2 6:4 5:4 | 4:12 3:4", chords: "1.M7 | 2/1" },
    C3: { melody: "1:6 5:2 6:4 5:4 | 3:12 2:4", chords: "1 | 4.7" },
    C4: { melody: "1:6 5:2 6:4 5:4 | 2:12 1:4", chords: "1 | 5.7" },
    I: { chords: "2.7 | 5.s4 | 4 | 5.s4:8 5:8" },
  },
  intro: [{ sec: "intro", energy: 0.34 }],
  loop: [
    [
      { sec: "A", energy: 0.6, lead: ["piano", "flute"] },
      { sec: "A", energy: 0.76, lead: ["strings", "flute"], vary: 0.5 },
      { sec: "C1", energy: 0.55, key: 9, mode: "aeolian", lead: ["piano", "celesta"] },
      { sec: "C2", energy: 0.55, key: 5, mode: "lydian", lead: ["piano", "flute"] },
      { sec: "C3", energy: 0.6, key: 2, mode: "dorian", lead: ["piano", "celesta"] },
      { sec: "C4", energy: 0.64, key: 7, mode: "mixolydian", lead: ["piano", "flute"] },
      { sec: "B", energy: 0.8, lead: ["strings", "flute"], bass: "walk" },
      { sec: "A", energy: 1, key: 2, lead: ["piano", "flute"], vary: 0.6, bass: "walk" },
      { sec: "I", energy: 0.5 },
    ],
    [
      { sec: "A", energy: 0.66, lead: ["piano", "celesta"], vary: 0.4 },
      { sec: "A", energy: 0.8, lead: ["piano", "flute"], vary: 0.7 },
      { sec: "C1", energy: 0.6, key: 9, mode: "aeolian", lead: ["strings", "flute"] },
      { sec: "C2", energy: 0.6, key: 5, mode: "lydian", lead: ["piano", "celesta"] },
      { sec: "C3", energy: 0.64, key: 2, mode: "dorian", lead: ["strings", "flute"] },
      { sec: "C4", energy: 0.68, key: 7, mode: "mixolydian", lead: ["piano", "celesta"] },
      { sec: "B", energy: 0.85, lead: ["piano", "flute"], vary: 0.4, bass: "walk" },
      { sec: "A", energy: 1, key: 2, lead: ["strings", "flute"], vary: 0.8, bass: "walk" },
      { sec: "I", energy: 0.46 },
    ],
  ],
};

const ENDING: CueDef = {
  gain: 1.07,
  id: "ending",
  title: "The restored sun",
  tonic: 2,
  mode: "ionian",
  bpm: 70,
  meter: "4/4",
  melodyBase: 74,
  arp: "hymn",
  perc: "soft44",
  bass: "long",
  seed: 808,
  sections: {
    intro: { chords: "1.9 | 4.M7/1 | 1.9 | 5.s4:8 5:8" },
    A: SOL_A,
    B: SOL_B,
    C: {
      melody: "1:8 5:8 | 6:8 5:8 | 3:16 | 2:16 | 1:8 5:8 | 6:8 7:8 | 1':16 | 1':16",
      chords: "1 | 6.7 | 4.M7 | 5.s4:8 5:8 | 1/3 | 4.9:8 5:8 | 6.7 | 4:8 4m:8",
    },
    coda: {
      melody: "5:6 1':2 2':4 1':4 | 1':16 | 1:6 5:2 6:4 5:4 | 3:12 2:4 | 2:16 | r:16 | 1:16 | r:16",
      chords: "4 | 4m | 1/3 | 4.M7 | 2.7 | 5.s4:8 5:8 | 1.9 | 1.9",
    },
  },
  intro: [{ sec: "intro", energy: 0.22 }],
  loop: [
    [
      { sec: "A", energy: 0.36, lead: ["piano", "celesta"], arp: "hymn" },
      { sec: "A", energy: 0.6, lead: ["strings", "flute"], vary: 0.4, arp: "flow8" },
      { sec: "B", energy: 0.7, lead: ["piano", "flute"], arp: "flow8" },
      { sec: "C", energy: 0.8, lead: ["strings", "flute"], arp: "hymn", bass: "pulse" },
      { sec: "A", energy: 0.96, lead: ["piano", "flute"], vary: 0.6, arp: "flow8", bass: "pulse" },
      { sec: "coda", energy: 0.42, lead: ["piano", "celesta"], arp: "hymn" },
    ],
    [
      { sec: "A", energy: 0.4, lead: ["piano", "flute"], vary: 0.3, arp: "hymn" },
      { sec: "A", energy: 0.64, lead: ["piano", "celesta"], vary: 0.6, arp: "flow8" },
      { sec: "B", energy: 0.74, lead: ["strings", "flute"], vary: 0.4, arp: "flow8" },
      { sec: "C", energy: 0.84, lead: ["piano", "flute"], arp: "hymn", bass: "pulse" },
      { sec: "A", energy: 1, lead: ["strings", "flute"], vary: 0.8, arp: "flow8", bass: "pulse" },
      { sec: "coda", energy: 0.4, lead: ["piano", "flute"], arp: "hymn" },
    ],
  ],
};

export const CUES: Record<string, CueDef> = {
  title: TITLE,
  "0": MORNING,
  "1": NOON,
  "2": AFTERNOON,
  "3": DUSK,
  "4": NIGHT,
  "5": DAWN,
  ending: ENDING,
};

export function cueDef(c: string | number): CueDef {
  const key = String(c);
  if (CUES[key]) return CUES[key];
  const n = Number(c);
  if (Number.isFinite(n)) return CUES[String(Math.max(0, Math.min(5, Math.round(n))))];
  return TITLE;
}
