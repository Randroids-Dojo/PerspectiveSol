#!/usr/bin/env node
/**
 * Objective checks for Perspective Sol's music and sound.
 *
 *   node scripts/audio-check.mjs [--quick] [--no-live] [--no-wav] [--seconds=90]
 *                                [--out=/tmp/sol-audio] [--url=http://localhost:5186]
 *
 * Needs the Vite dev server (npm run dev). Renders run in headless Chrome
 * through the game's own audio engine in an OfflineAudioContext, so they are
 * exactly what the game plays. Checks:
 *   score     strong-beat notes belong to their chords; form lengths
 *   bank      synthesis time and memory of every pre-rendered sample
 *   cues      each cue in both arrangements: loudness (LUFS), peak, clipping,
 *             clicks, dropouts, spectrum, pitch content in key; WAVs written
 *   fold      every onset identical with the fold swinging; no level gaps
 *   cue change  new cue enters on a bar line or beat, without clicks or gaps
 *   effects   every event and stinger: level, clicks, in key where pitched
 *   ambience  each chapter bed sits well under the music
 *   stress    music plus a storm of effects never clips
 *   live      the harness: unlock latency, transport across real folds,
 *             scheduler cost, voices, pause, volumes, mute, suspend
 * Exit code 1 if any check fails.
 */
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const URL_BASE = args.url ?? "http://localhost:5186";
const OUT = args.out ?? "/tmp/sol-audio";
const QUICK = !!args.quick;
const SECONDS = Number(args.seconds ?? (QUICK ? 40 : 90));
const PLAYWRIGHT = process.env.PLAYWRIGHT ?? "/Users/randroid/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CUES = ["title", "0", "1", "2", "3", "4", "5", "ending"];

const { chromium } = await import(PLAYWRIGHT);
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x));

// Vite's HMR client would reload the page whenever anyone edits the game;
// a stub keeps long renders stable.
const HMR_STUB = `
export function createHotContext() { return { accept() {}, acceptExports() {}, dispose() {}, prune() {}, invalidate() {}, on() {}, off() {}, send() {}, decline() {}, data: {} }; }
export function updateStyle(id, css) { let s = document.querySelector('style[data-vite-dev-id="' + id + '"]'); if (!s) { s = document.createElement('style'); s.setAttribute('data-vite-dev-id', id); document.head.appendChild(s); } s.textContent = css; }
export function removeStyle() {}
export function injectQuery(u) { return u; }
export class ErrorOverlay {}
`;

const browser = await chromium.launch({ executablePath: CHROME, args: ["--autoplay-policy=no-user-gesture-required"] });
const newPage = async (url) => {
  const page = await browser.newPage();
  await page.route("**/@vite/client", (r) => r.fulfill({ contentType: "application/javascript", body: HMR_STUB }));
  page.on("pageerror", (e) => console.log("  page error:", e.message));
  await page.goto(url);
  return page;
};
// A plain same-origin document: the audio modules load without the game.
const page = await newPage(`${URL_BASE}/fonts/DMSans-OFL.txt`);
const run = (fn, arg) => page.evaluate(fn, arg);

// ------------------------------------------------------------------ score
console.log("\n== score");
const score = await run(async () => {
  const m = await import("/src/audio/offline.ts");
  return { audit: m.auditScore(), form: m.formReport() };
});
check("strong-beat melody notes are chord tones or gentle tensions", score.audit.exceptions.length === 0, `${score.audit.notes} notes, ${score.audit.exceptions.length} exceptions ${JSON.stringify(score.audit.exceptions.slice(0, 4))}`);
for (const f of score.form)
  console.log(`  ${f.cue.padEnd(7)} ${f.title.padEnd(22)} ${f.key.padEnd(14)} ${String(f.bpm).padStart(3)} bpm ${f.meter}  intro ${f.introSeconds}s  passes ${f.passSeconds.join("s + ")}s  cycle ${f.cycleSeconds}s`);
check("every cue runs 2-4+ minutes before its structure repeats", score.form.every((f) => f.cycleSeconds >= 120), score.form.map((f) => `${f.cue}:${f.cycleSeconds}s`).join(" "));

// ------------------------------------------------------------------- bank
console.log("\n== sample bank");
const bank = await run(async () => {
  const { bank } = await import("/src/audio/bank.ts");
  const t0 = performance.now();
  bank.start();
  await bank.ready;
  return { ms: performance.now() - t0, firstMs: bank.firstAt - bank.startedAt, mb: bank.megabytes, count: bank.loaded, errors: bank.errors };
});
check("every sample synthesises without error", bank.errors.length === 0, `${bank.count} samples, ${f1(bank.mb)} MB, first after ${bank.firstMs.toFixed(0)} ms, all after ${bank.ms.toFixed(0)} ms (two workers)`);

// ------------------------------------------------------------------- cues
console.log(`\n== cues (${SECONDS}s each, both arrangements)`);
const cueRows = [];
for (const cue of CUES)
  for (const fold of [0, 1]) {
    const r = await run(
      async ([cue, fold, seconds, wav]) => {
        const m = await import("/src/audio/offline.ts");
        const { cueDef } = await import("/src/audio/score.ts");
        const d = cueDef(cue);
        const out = await m.render({ cue, seconds, fold });
        const a = m.analyze(out.buffer, { tonic: d.tonic, mode: d.mode });
        return { a, rt: out.realtimeFactor, stats: out.stats, wav: wav ? m.wavBase64(out.buffer) : null };
      },
      [cue, fold, SECONDS, !args["no-wav"]],
    );
    const arrangement = fold ? "illustrated" : "sculpted";
    if (r.wav) fs.writeFileSync(path.join(OUT, `cue-${cue}-${arrangement}.wav`), Buffer.from(r.wav, "base64"));
    cueRows.push({ cue, arrangement, ...r.a, rt: r.rt, peakVoices: r.stats.peakVoices });
    const a = r.a;
    console.log(
      `  ${cue.padEnd(7)} ${arrangement.padEnd(11)} LUFS ${f1(a.lufs)}  peak ${f1(a.peakDb)} dBFS  clicks ${a.clicks}  clipped ${a.clipped}  gap ${a.longestSilence}s  centroid ${a.centroid.toFixed(0)} Hz  in key ${(a.inKey * 100).toFixed(0)}%  voices ${r.stats.peakVoices}  render ${r.rt.toFixed(1)}x realtime`,
    );
    console.log(`          bands dB: ${Object.entries(a.bands).map(([k, v]) => `${k}:${v}`).join(" ")}`);
  }
check("no cue clips or exceeds -1 dBFS", cueRows.every((r) => r.clipped === 0 && r.peakDb < -1), `max peak ${f1(Math.max(...cueRows.map((r) => r.peakDb)))} dBFS`);
check("no clicks at note boundaries", cueRows.every((r) => r.clicks === 0), cueRows.filter((r) => r.clicks).map((r) => `${r.cue}/${r.arrangement}:${r.clicks}@${r.clickTimes.map((t) => t.toFixed(3)).join(",")}`).join(" "));
check("no dropouts (no 0.5 s below -60 dBFS)", cueRows.every((r) => r.longestSilence < 0.5), `longest ${Math.max(...cueRows.map((r) => r.longestSilence))}s`);
check("pitch content stays in each cue's mode (>= 85% of tonal energy)", cueRows.every((r) => r.inKey >= 0.85), `min ${(Math.min(...cueRows.map((r) => r.inKey)) * 100).toFixed(0)}%`);
const lufs = cueRows.map((r) => r.lufs);
// Loudness needs windows that reach past each cue's quiet intro.
const loud = QUICK ? (name, _ok, detail = "") => console.log(`INFO  ${name}  ${detail} (quick mode: windows too short to judge loudness)`) : check;
loud("cue loudness consistent (spread <= 3 LU)", Math.max(...lufs) - Math.min(...lufs) <= 3, `${f1(Math.min(...lufs))} .. ${f1(Math.max(...lufs))} LUFS`);
const diffs = CUES.map((c) => {
  const [s, i] = ["sculpted", "illustrated"].map((a) => cueRows.find((r) => r.cue === c && r.arrangement === a).lufs);
  return { c, d: i - s };
});
loud("arrangements match in loudness (<= 1.5 LU per cue)", diffs.every((x) => Math.abs(x.d) <= 1.5), diffs.map((x) => `${x.c}:${x.d > 0 ? "+" : ""}${f1(x.d)}`).join(" "));
loud("comfortable level at default volumes (-21 .. -15 LUFS)", lufs.every((l) => l >= -21 && l <= -15), `${f1(Math.min(...lufs))} .. ${f1(Math.max(...lufs))} LUFS`);
check("music renders far faster than real time", cueRows.every((r) => r.rt > 6), `slowest ${f1(Math.min(...cueRows.map((r) => r.rt)))}x`);

// ------------------------------------------------------------------- fold
console.log("\n== fold continuity");
for (const cue of QUICK ? ["title"] : ["title", "2", "4"]) {
  const r = await run(async (cue) => (await import("/src/audio/offline.ts")).foldContinuity(cue, 30), cue);
  check(
    `cue ${cue}: folding moves no notes and leaves no gap`,
    r.identical && r.clicksMoving === 0 && r.minWindowDbMoving > r.minWindowDbStill - 6,
    `${r.onsetsStill} onsets still vs ${r.onsetsMoving} folding, identical ${r.identical}; quietest 100 ms ${f1(r.minWindowDbStill)} vs ${f1(r.minWindowDbMoving)} dB; LUFS ${f1(r.lufsStill)} vs ${f1(r.lufsMoving)}; clicks ${r.clicksMoving}`,
  );
}

// -------------------------------------------------------------- cue change
console.log("\n== cue changes");
for (const [from, to] of QUICK ? [["title", 0]] : [["title", 0], [2, 3], [5, "ending"]]) {
  const r = await run(async ([a, b]) => (await import("/src/audio/offline.ts")).crossfade(a, b), [from, to]);
  check(
    `${from} -> ${to}: enters musically, no clicks or gaps`,
    r.clicks === 0 && r.longestSilence < 0.5 && r.waitSeconds < 2.5,
    `called ${r.calledAt}s, enters ${r.entersAt.toFixed(2)}s (${r.barsFromOldDownbeat.toFixed(2)} bars from the old downbeat, on bar line ${r.onBarLine}), clicks ${r.clicks}, peak ${f1(r.peakDb)} dBFS`,
  );
}

// ----------------------------------------------------------------- effects
console.log("\n== effects (in D major unless noted)");
const EFFECTS = [
  "jump", "land", "land-heavy", "step-grass", "step-stone", "step-bronze", "bump", "fold", "unfold", "seed", "seed-final",
  "mote", "checkpoint", "lantern", "gate", "bridge", "die-sentinel", "die-void", "respawn", "locked", "exit", "hint",
  "ui-move", "ui-select", "ui-back", "chapter-start", "clear", "ending", "pause", "resume",
];
const PITCHED = new Set(["seed", "seed-final", "mote", "checkpoint", "lantern", "bridge", "respawn", "locked", "exit", "hint", "ui-select", "ui-back", "chapter-start", "clear", "ending", "fold", "unfold"]);
const fxRows = [];
for (const name of EFFECTS) {
  const r = await run(
    async ([name, wav]) => {
      const m = await import("/src/audio/offline.ts");
      const out = await m.renderEffect(name, "title", 0);
      const a = m.analyze(out.buffer, { tonic: 2, mode: "ionian" }, 0.45);
      // How long it rings above -50 dBFS.
      const d = out.buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.003) last = i;
      return { a, ring: last / out.buffer.sampleRate - 0.5, layers: out.effectsPlayed, wav: wav ? m.wavBase64(out.buffer) : null };
    },
    [name, !args["no-wav"]],
  );
  if (r.wav) fs.writeFileSync(path.join(OUT, `fx-${name}.wav`), Buffer.from(r.wav, "base64"));
  fxRows.push({ name, ...r.a, ring: r.ring, layers: r.layers });
  console.log(
    `  ${name.padEnd(14)} layers ${String(r.layers).padStart(2)}  peak ${f1(r.a.peakDb).padStart(6)} dBFS  LUFS ${f1(r.a.lufs).padStart(6)}  rings ${r.ring.toFixed(2)}s  clicks ${r.a.clicks}  ${PITCHED.has(name) ? `in key ${(r.a.inKey * 100).toFixed(0)}%` : ""}`,
  );
}
check("every effect is layered (2+ sources) and audible", fxRows.every((r) => r.layers >= 2 && r.peakDb > -40), fxRows.filter((r) => r.layers < 2 || r.peakDb <= -40).map((r) => r.name).join(" "));
check("no effect clicks or clips", fxRows.every((r) => r.clicks === 0 && r.clipped === 0), fxRows.filter((r) => r.clicks || r.clipped).map((r) => `${r.name}:${r.clicks}`).join(" "));
check("pitched effects are in key (>= 80% of tonal energy)", fxRows.filter((r) => PITCHED.has(r.name) && r.name !== "die-sentinel").every((r) => r.inKey >= 0.8), fxRows.filter((r) => PITCHED.has(r.name) && r.inKey < 0.8).map((r) => `${r.name}:${(r.inKey * 100).toFixed(0)}%`).join(" "));
const seedRow = fxRows.find((r) => r.name === "seed-final");
check("the final seed is among the most prominent rewards", seedRow.lufs >= Math.max(...fxRows.filter((r) => !["exit", "ending", "clear", "gate", "land-heavy"].includes(r.name)).map((r) => r.lufs)) - 2, `seed-final ${f1(seedRow.lufs)} LUFS`);

// Key tracking: the same reward in another chapter's key.
const keyed = await run(async () => {
  const m = await import("/src/audio/offline.ts");
  const out = [];
  for (const [cue, tonic, mode] of [["3", 0, "aeolian"], ["4", 1, "lydian"], ["2", 4, "dorian"]]) {
    const r = await m.renderEffect("seed", cue, 1);
    out.push({ cue, inKey: m.analyze(r.buffer, { tonic, mode }, 0.45).inKey });
  }
  return out;
});
check("rewards retune to each chapter's key", keyed.every((k) => k.inKey >= 0.8), keyed.map((k) => `cue ${k.cue}: ${(k.inKey * 100).toFixed(0)}%`).join(" "));

// ---------------------------------------------------------------- adaptive
console.log("\n== adaptive layers");
const ad = await run(async () => (await import("/src/audio/offline.ts")).adaptive());
check("radiant shimmer adds a bright, in-key layer once every seed is held", ad.radiant.centroidRadiant > ad.radiant.centroidBase && ad.radiant.inKey >= 0.85 && ad.radiant.clicks === 0, `centroid ${ad.radiant.centroidBase.toFixed(0)} -> ${ad.radiant.centroidRadiant.toFixed(0)} Hz, LUFS ${f1(ad.radiant.lufsBase)} -> ${f1(ad.radiant.lufsRadiant)}, in key ${(ad.radiant.inKey * 100).toFixed(0)}%`);
check("tension drone swells near a sentinel", ad.tension.nearDb > ad.tension.quietDb + 12, `${f1(ad.tension.quietDb)} -> ${f1(ad.tension.nearDb)} dB rms`);
check("death dips the music behind a low-pass and respawn restores it", ad.die.centroidDuring < ad.die.centroidBefore * 0.75 && ad.die.centroidAfter > ad.die.centroidBefore * 0.8, `centroid ${ad.die.centroidBefore.toFixed(0)} -> ${ad.die.centroidDuring.toFixed(0)} -> ${ad.die.centroidAfter.toFixed(0)} Hz`);

// ---------------------------------------------------------------- ambience
console.log("\n== ambience (no music)");
const amb = await run(async () => {
  const m = await import("/src/audio/offline.ts");
  const out = [];
  for (const time of ["morning", "noon", "afternoon", "dusk", "night", "dawn"]) {
    const r = await m.render({ seconds: 24, music: 0, ambience: time, actions: [{ at: 0.05, run: (e) => e.music.cue("title") }] });
    const a = m.analyze(r.buffer, undefined, 3);
    out.push({ time, lufs: a.lufs, peak: a.peakDb, clicks: a.clicks, centroid: a.centroid });
  }
  return out;
});
for (const a of amb) console.log(`  ${a.time.padEnd(10)} LUFS ${f1(a.lufs)}  peak ${f1(a.peak)}  centroid ${a.centroid.toFixed(0)} Hz  clicks ${a.clicks}`);
const quietestMusic = Math.min(...lufs);
check("ambience sits at least 8 LU under the music", amb.every((a) => a.lufs <= quietestMusic - 8), `loudest bed ${f1(Math.max(...amb.map((a) => a.lufs)))} LUFS vs quietest music ${f1(quietestMusic)}`);
check("ambience is present and click free", amb.every((a) => a.lufs > -60 && a.clicks === 0));

// ------------------------------------------------------------------ stress
console.log("\n== stress");
const stress = await run(async () => {
  const m = await import("/src/audio/offline.ts");
  const names = ["seed-final", "exit", "land-heavy", "lantern", "gate", "die-sentinel", "checkpoint", "bridge", "clear"];
  const actions = [];
  for (let i = 0; i < 40; i++) {
    const at = 1 + i * 0.25;
    const name = names[i % names.length];
    actions.push({
      at,
      run: (e) => {
        const game = { player: { x: 0, y: 0, z: 0, support: "s" }, seeds: 3, seedTotal: 3, motes: 2, island: () => ({ style: "stone" }), level: { walls: [], sentinels: [] } };
        if (name === "clear") e.stinger("clear");
        else
          e.event(
            { type: name.split("-")[0] === "land" ? "land" : name.startsWith("die") ? "die" : name.startsWith("seed") ? "seed" : name, value: name === "land-heavy" ? 24 : 3, cause: "sentinel", position: { x: 0, y: 0, z: 0 } },
            game,
            (i % 5) / 2 - 1,
          );
      },
    });
  }
  const r = await m.render({ cue: "5", seconds: 14, fold: 0.5, radiant: true, music: 1, effects: 1, actions });
  const a = m.analyze(r.buffer);
  return { peak: a.peakDb, clipped: a.clipped, clicks: a.clicks, lufs: a.lufs, voices: r.stats.peakVoices };
});
check("40 big effects over full-volume music never clip", stress.clipped === 0 && stress.peak < -0.3, `peak ${f1(stress.peak)} dBFS, LUFS ${f1(stress.lufs)}, clicks ${stress.clicks}, peak music voices ${stress.voices}`);

await page.close();

// -------------------------------------------------------------------- live
if (!args["no-live"]) {
  console.log("\n== live harness");
  const live = await newPage(`${URL_BASE}/harness.html?level=gallery&audio=1&time=night&info=0`);
  await live.waitForFunction(() => window.harness && window.harness.audio, null, { timeout: 30000 });
  await live.waitForTimeout(2500);
  await live.mouse.click(400, 300);
  const first = await live.evaluate(async () => {
    const a = window.harness.audio;
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) {
      const e = a.internals.engine;
      if (e && e.mixer.meter().peak > 0.001) return performance.now() - t0;
      await new Promise((r) => setTimeout(r, 10));
    }
    return -1;
  });
  check("sound within a second of the unlocking gesture", first >= 0 && first < 1000, `${first.toFixed(0)} ms`);
  await live.waitForTimeout(2000);
  const samples = [];
  for (let i = 0; i < 12; i++) {
    await live.keyboard.press("KeyX");
    for (let k = 0; k < 4; k++) {
      await live.waitForTimeout(120);
      samples.push(
        await live.evaluate(() => {
          const s = window.harness.audio.snapshot();
          const m = window.harness.audio.internals.engine.mixer.meter();
          return { t: s.transport, fold: s.fold, notes: s.noteOns, rms: m.rms, wall: performance.now() };
        }),
      );
    }
  }
  let monotonic = true;
  let drift = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt <= 0) monotonic = false;
    drift = Math.max(drift, Math.abs(dt - (samples[i].wall - samples[i - 1].wall) / 1000));
  }
  const folds = new Set(samples.map((s) => s.fold.toFixed(1)));
  check("transport runs continuously through 12 real folds", monotonic && drift < 0.05 && folds.size > 3, `max deviation from the wall clock ${(drift * 1000).toFixed(0)} ms, fold values ${[...folds].join(",")}`);
  check("no dropouts while folding", Math.min(...samples.map((s) => s.rms)) > 0.003, `quietest ${Math.min(...samples.map((s) => s.rms)).toFixed(4)} rms`);
  // Play: run and jump for a few seconds.
  await live.keyboard.down("KeyD");
  for (let i = 0; i < 6; i++) {
    await live.keyboard.press("Space");
    await live.waitForTimeout(350);
  }
  await live.keyboard.up("KeyD");
  const snap = await live.evaluate(() => window.harness.audio.snapshot());
  console.log("  snapshot:", JSON.stringify(snap));
  check("effects fire in play and the scheduler is cheap", snap.effectsPlayed > 0 && snap.schedulerMsPerCall < 1, `${snap.effectsPlayed} effect layers, ${snap.schedulerMsPerCall.toFixed(3)} ms per scheduler call, peak voices ${snap.peakVoices}`);
  check("voice count stays bounded", snap.peakVoices <= 90, `peak ${snap.peakVoices}`);
  check("no audio errors", snap.errors.length === 0, JSON.stringify(snap.errors));
  const adaptiveLive = await live.evaluate(async () => {
    const h = window.harness;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const s = h.game.level.sentinels[0];
    const at = h.game.sentinelPosition(s);
    h.setMode("3d", true);
    h.teleport(at.x - 1.2, at.z);
    await wait(400);
    const near = h.audio.snapshot().tension;
    h.teleport(-3, 0);
    await wait(900);
    const far = h.audio.snapshot().tension;
    for (const p of h.game.level.pickups) if (p.kind === "seed") h.game.collected.add(p.id);
    await wait(300);
    const radiant = h.audio.snapshot().radiant;
    return { near, far, radiant, ambience: h.audio.snapshot().ambience };
  });
  check("tension follows sentinel proximity in play", adaptiveLive.near > 0.3 && adaptiveLive.far < 0.05, `near ${adaptiveLive.near.toFixed(2)}, far ${adaptiveLive.far.toFixed(2)}`);
  check("radiant layer engages once every seed is held", adaptiveLive.radiant === 1);
  check("chapter ambience runs in play", adaptiveLive.ambience === "night", `profile ${adaptiveLive.ambience}`);
  const ctl = await live.evaluate(async () => {
    const a = window.harness.audio;
    const e = a.internals.engine;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const level = async () => {
      let s = 0;
      for (let i = 0; i < 12; i++) {
        s += e.mixer.meter().rms;
        await wait(50);
      }
      return s / 12;
    };
    const out = {};
    out.normal = await level();
    a.setPaused(true);
    await wait(800);
    out.paused = await level();
    a.setPaused(false);
    await wait(1000);
    a.setVolumes(0.15, 0.8);
    await wait(400);
    out.quiet = await level();
    a.setVolumes(0.6, 0.8);
    a.setMuted(true);
    await wait(300);
    out.muted = await level();
    a.setMuted(false);
    const t0 = a.snapshot().contextTime;
    a.suspend(true);
    await wait(600);
    out.suspended = a.snapshot().state;
    out.clockWhileSuspended = a.snapshot().contextTime - t0;
    a.suspend(false);
    await wait(400);
    out.resumed = a.snapshot().state;
    return out;
  });
  const dB = (x) => 20 * Math.log10(Math.max(1e-9, x));
  check("pause ducks the music behind a filter", ctl.paused < ctl.normal * 0.6, `${f1(dB(ctl.normal))} -> ${f1(dB(ctl.paused))} dB rms`);
  check("music volume and mute are honoured", ctl.quiet < ctl.normal * 0.5 && ctl.muted < 0.0005, `quiet ${f1(dB(ctl.quiet))} dB, muted ${f1(dB(ctl.muted))} dB`);
  check("suspend stops the context and resume restarts it", ctl.suspended === "suspended" && ctl.clockWhileSuspended < 0.05 && ctl.resumed === "running");
  await live.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? "; failed: " + failed.map((f) => f.name).join("; ") : ""}`);
console.log(`WAVs in ${OUT}`);
process.exit(failed.length ? 1 : 0);
