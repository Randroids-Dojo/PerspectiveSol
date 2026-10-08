# Verification

How the game is checked, and the results recorded for the 2026-10-08 rebuild.

## Automated checks (`npm run check`, run by Vercel and GitHub Actions)

- `tests/sim.test.ts`: movement tuning (full speed in 0.1 s, a held jump of
  about 2.1 units, a short tap hop), coyote time and jump buffering, folding
  joins depth-separated islands while unfolding restores their distance,
  unfolding places the keeper at the depth of the island underfoot, walls seal
  the folded path but can be walked around, a fold always succeeds and
  overlapped solids stay passable until clear, star bridges and sunglass hold
  only in their perspective, a far lantern lit while folded opens its gate and
  forms its bridge, sentinels at other depths kill only while folded and
  respawn keeps seeds, moving islands carry the keeper, the observatory waits
  for three seeds, determinism and save/resume.
- `tests/campaign.test.ts`: six chapters, three seeds each, consistent ids and
  lantern links, and every chapter finished with all three seeds and no falls
  by its scripted route through ordinary inputs (move, depth, jump, fold).
- TypeScript strict mode and the production build.

Result: 20 of 20 tests passing; type check and build clean.

## The real game in Chrome (`node scripts/e2e.mjs`)

Against the development server, so routes can drive the actual game loop:

| Check | Result |
|---|---|
| Title screen with the live demonstration | passed |
| A Shift press folds; WebGL frames stay fixed (271 → 271) while the illustrated world draws (15 → 51) | passed |
| Unfolding resumes WebGL drawing | passed |
| Keyboard walking and jumping | passed |
| Pause holds the chapter clock | passed |
| Chapters 1–6 played through the real loop to their observatories with all seeds (15.0, 24.5, 36.0, 19.2, 18.2 and 51.4 s of game time; 3, 5, 1, 3, 4 and 8 folds) | passed |
| The ending is reached; progress survives a reload | passed |
| Touch stick and fold button at 390×844 and 844×390 | passed |
| Page errors and failed requests | none |

## Rendering

- The fold: the sculpted camera reaches a side view with depth flattened onto
  the keeper's plane by 60% of the transition; island corners on that plane
  land within 0.3 px of the illustrated framing. The illustrated world then
  opens from the keeper's sun. WebGL draws nothing while fully folded.
- Sculpted world, heaviest chapter: 61–73 draw calls; shaders compile during
  chapter load (no first-frame or first-fold hitch). Light quality halves
  shadow cost and caps pixel ratio at 1.25. Graphics drop to Light
  automatically if frames run slow for 2.5 s.
- Illustrated world: 0.3 ms of renderer time per frame at 1280×720 and dpr 2;
  under 1 ms with 4× CPU throttling on a phone viewport.

## Audio (`node scripts/audio-check.mjs`)

40 objective checks: every cue between −18 and −20 LUFS with the two
arrangements within 0.6 LU, peaks at or below −3 dBFS, no clicks or dropouts,
91–100% of tonal energy in key, identical note onsets with the fold swinging
every 2.5 s, the transport within 5 ms of the wall clock across real folds, a
40-effect stress test without clipping, and 116 ms from unlock to first sound.
Nobody listened during automated testing; listening on headphones and a phone
speaker is the remaining review.

## Not covered automatically

A physical Pixel 8 Pro run, a physical gamepad, and Safari.
