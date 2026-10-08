# Verification receipt

Date: October 7, 2026 (America/Chicago).

## Behavioral checks

`npm run check` passes 16 behavioral tests, strict TypeScript checking, and the production build. The tests cover movement and landing in both modes, variable jumps, coyote time, jump buffering, held and released fold inputs, midair state preservation, projected landings, 3D wall bypasses, moving-island inheritance, checkpoint recovery, sentinel collision, seed-gated kindling, complete campaign progression, save restoration and corruption, replay, and safe checkpoint placement.

The route controller provides ordinary movement, jumping, folding, and kindling inputs. It has no completion or collection shortcut. It completes every chapter with all three sun seeds and zero deaths, including wall detours, sentinel depth bypasses, and midair folds.

## Rendered campaign

The same controller was run through the actual game's input path and render loop, advancing chapters with their real Follow the light buttons. All six chapter result states and the ending were observed. Final result: **18 sun seeds, 11 optional motes, six restored observatories, zero deaths**. Both exact projection endpoints and their interpolated transitions were observed. A complete browser recording and ending screenshot are retained locally under the task's browser artifacts.

| Chapter              | Result   | Seeds | Deaths | Folds |
| -------------------- | -------- | ----- | ------ | ----- |
| The waking garden    | Clear    | 3     | 0      | 1     |
| The hidden courtyard | Clear    | 3     | 0      | 2     |
| The tide engine      | Clear    | 3     | 0      | 2     |
| The violet archive   | Clear    | 3     | 0      | 6     |
| The night crossing   | Clear    | 3     | 0      | 4     |
| The last observatory | Complete | 3     | 0      | 4     |

Final capture of the campaign had no console errors or failed network requests. An earlier geometry-batching error was corrected before this complete run by normalizing indexed geometries before merging.

## Controls, recovery, audio, and layout

- A native quick X press changes perspective. Native touch-button clicks trigger jumps and folds. Keyboard movement advanced the keeper by 1.67 units during a 350 ms input trial; released touch controls left no held buttons.
- A synthetic standard gamepad moved in both axes, jumped, and paused. A physical controller was not attached to this test session.
- Pause freezes player state, simulation time, and the AudioContext transport. Resuming continues the same transport. Perspective changes keep three running audio sources: wind and the two score stems.
- Both bundled stereo stems decode, load successfully in the browser, and have matching 48-second duration. File analysis verifies non-clipping levels. Effects were emitted by actual jumps, landings, collection, folds, checkpoints, and chapter completion.
- Saved seeds, checkpoint position, perspective, elapsed time, records, unlocks, and completion restore after reload. Invalid and future-version saves fall back to a fresh game.
- Portrait 390 × 844 and landscape 844 × 390 layouts were inspected. Portrait has no horizontal overflow; touch controls, fold button, pause, and settings remain usable. Short panels scroll within the available screen.
- Automated browser performance was slower with full postprocessing. Automatic graphics adaptation and a manual override were added, with a reduced render scale and fewer passes in performance mode. The portrait performance-mode control trial reported 56 FPS. These observations apply to the test browser and are not a device-independent benchmark.

## Publication

GitHub: [Randroids-Dojo/PerspectiveSol](https://github.com/Randroids-Dojo/PerspectiveSol). Live game: [perspective-sol.vercel.app](https://perspective-sol.vercel.app). Vercel: perspective-sol in randroid88's projects. Git integration uses main for production and runs `npm run check`.

Release code commit `f3f6a88` produced deployment `dpl_FHUG9MK1MW4rSL2hXLtCp8YPBiJD` automatically from Git, with target production and status READY. Its GitHub Actions run also completed successfully. No manual deployment was used. The production page and audio return HTTP 200 without authentication; its JavaScript and styles match the built release. The public browser loaded the game, decoded both music stems, accepted native keyboard folding and jumping, and reached the exact orthographic projection. Production exposes only the read-only snapshot diagnostic.

A second full rendered run after graphics adaptation changes also completed all six chapters with all seeds and zero deaths. Completion, all chapter unlocks, records, the current checkpoint, collected seeds, and perspective were subsequently verified after a full page reload. Changes to this receipt are deployed through the same Git integration.
