# Perspective Sol

**A world with two ways through.** Carry a little sun through six floating observatories. Fold the world into a 2D path; unfold it to explore depth and get around obstacles. Perspective changes are playable transitions: motion, moving platforms, collectibles, checkpoints, timers, and the score keep their state.

## Play

https://perspective-sol.vercel.app

| Action                      | Keyboard              | Controller           |
| --------------------------- | --------------------- | -------------------- |
| Walk                        | A / D or left / right | Left stick           |
| Explore depth in 3D         | W / S or up / down    | Left stick           |
| Jump (hold for more height) | Space                 | A                    |
| Fold / unfold               | Shift or X            | X or either shoulder |
| Kindle the observatory      | E or Enter            | B                    |
| Pause                       | Escape or P           | Start                |
| Mute                        | M                     | Sound settings       |

Touch controls are enabled on touch devices and can also be enabled in settings. Music, effects, gentle motion, and performance mode are configurable. Graphics adapt automatically when a device struggles; changing performance mode manually keeps your chosen quality. Golden floor rings are recovery checkpoints. Progress and best chapter times save on the current device. The game can be finished, revisited chapter by chapter, and replayed.

## The journey

- **The waking garden:** connect distant islands by folding their depth.
- **The hidden courtyard:** unfold to walk around the sunwall.
- **The tide engine:** ride moving islands and pass a rose sentinel.
- **The violet archive:** combine depth detours, folds, and climbs.
- **The night crossing:** carry the light across dusk and shifting islands.
- **The last observatory:** restore the sun and reach the ending.

Each chapter requires three sun seeds. Light motes are optional. Failure returns the keeper to a checkpoint and preserves collected light.

## Development

```sh
npm ci
npm run dev       # http://localhost:5186
npm run check     # behavioral tests, TypeScript, production build
```

Vite, TypeScript, and Three.js. The deterministic simulation in `src/core.ts` is shared by both perspectives. `src/world.ts` interpolates normalized camera projection matrices between exact orthographic and perspective endpoints. Static sculpted artwork is batched by material; shadows, atmospheric layers, and bloom have a performance setting. No third-party asset service is needed during play.

The original stereo score is shipped as two phase-aligned 48-second MP3 stems. The same AudioContext transport runs both stems; perspective opens and closes the depth stem without restarting the music. Sound effects are synthesized at runtime. To reproduce the stems, run `python3 scripts/compose.py` with ffmpeg installed. The fonts are bundled with their OFL licenses.

`window.sol.snapshot()` reports the actual simulation, render mode, audio transport, and recent gameplay events. A development-only input source supports rendered end-to-end route tests; it is omitted from production. The route test performs movement, jumps, depth bypasses, midair folds, collection, and kindling through the ordinary input path.

## Deployment

The GitHub repository is connected to the `perspective-sol` Vercel project in the same team as the other Dojo games. Pushes to `main` deploy production automatically; feature branches receive preview deployments. Vercel runs `npm run check` before publishing. GitHub Actions also runs the checks. No secrets or local Vercel metadata are committed.

Design: [docs/DESIGN.md](docs/DESIGN.md). Verification receipt: [docs/VERIFICATION.md](docs/VERIFICATION.md).
