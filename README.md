# Perspective Sol

**Fold the world flat. Unfold it into depth.** Carry a little sun home through
six floating observatories in a platformer with two separately made worlds: a
sculpted three.js sky and an illustrated Canvas 2D storybook. Switch between
them at any moment, even in midair. Folded, depth disappears: islands far apart
become one path, and everything at every depth is in your way. Unfolded, depth
is real: walk around walls and sentinels, ride ferries across the distance, and
climb sunglass that only exists there.

## Play

https://perspective-sol.vercel.app

| Action | Keyboard | Controller | Touch |
|---|---|---|---|
| Walk | A D or ← → | Left stick or d-pad | Floating stick |
| Depth (3D) | W S or ↑ ↓ | Left stick or d-pad | Stick up and down |
| Jump (hold for height) | Space | A | Jump |
| Fold or unfold | Shift or X | X, Y or a shoulder | Fold |
| Pause | Esc or P | Start | II |
| Mute | M | | |

Six chapters, each with three sun seeds to bring to its observatory, optional
light motes, sundial checkpoints, best times and an ending. Settings cover
music and effect volume, graphics quality, touch controls, gentle motion,
screen shake and teaching hints. Progress saves on the device.

## Development

```sh
npm ci
npm run dev                 # http://localhost:5186
npm run check               # simulation and campaign tests, TypeScript, production build
node scripts/e2e.mjs        # the real game in Chrome: every chapter, folds, pause, saves, touch
npx tsx scripts/routes.ts   # play every chapter's scripted solution in the simulation
npx tsx scripts/map.ts      # blueprints of every chapter layout
node scripts/audio-check.mjs  # objective music and sound checks (levels, clicks, key, continuity)
```

- `src/sim`: the one deterministic simulation both worlds share (`game.ts`),
  the chapters (`chapters.ts`) and their scripted solutions (`routes.ts`).
- `src/render3d`: the sculpted world. `src/render2d`: the illustrated world.
  Neither reads the other; both draw the same instant from the simulation.
- `src/audio`: the adaptive score and sound, all synthesised in code.
- `src/main.ts`: the director (clock, shared camera, fold transition, events).
  `src/ui`, `src/input.ts`, `src/save.ts`: interface, controls, progress.
- `harness.html`: a development page for working on one renderer at a time.

Design: [docs/DESIGN.md](docs/DESIGN.md). Art, sound and interface direction:
[docs/WORLD.md](docs/WORLD.md). Verification: [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Deployment

The repository is connected to the `perspective-sol` Vercel project. Pushes to
`main` deploy production; other branches get preview deployments. Vercel runs
`npm run check` before publishing, and GitHub Actions runs it on every push.
