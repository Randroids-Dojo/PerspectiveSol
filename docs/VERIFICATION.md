# Verification receipt

## Independent 2D renderer correction

Date: October 7, 2026 (America/Chicago). This supersedes the original release's camera-only 2D implementation.

The folded world now uses a separate Canvas 2D context and original illustrated artwork. Source inspection confirms that `src/illustrated-world.ts` imports no Three.js code and draws no 3D output. Fully folded play hides the WebGL canvas and skips its render pass. During an observed 1.2-second trial, WebGL frames stayed at 91 while illustrated frames advanced from 1,222 to 1,242; simulation time and the existing three-source music transport continued. A second headless native-input trial independently confirmed that WebGL frames stayed at 14, Canvas 2D frames advanced, and WebGL draw calls remained zero.

The complete rendered six-chapter campaign passed with **18 sun seeds, 11 optional motes, six restored observatories, and zero deaths**. Chapters advanced through their actual Follow the light buttons, using the ordinary route controller's movement, jump, depth, fold, and kindle inputs. The route exercised illustrated landings and moving islands, 3D wall and sentinel bypasses, midair transitions, seed collection, checkpoints, exit kindling, and the ending. All six result states used the independent Canvas 2D renderer. The campaign trace is retained locally in `evidence/independent-2d-campaign.json`, and a full browser recording is retained in the task attachments.

`npm run check` now passes **18 behavioral tests**, strict TypeScript checking, and the production build. A regression test covers fresh fold events when a slow frame misses the key-release sample: each fresh event changes mode once, while held input does not repeat. Native browser trials exercised movement, an airborne fold, four successive reversals, touch jumping and folding, and gentle motion. The fold input queue preserves every fresh keyboard or UI press until the simulation consumes it.

Pause froze the keeper, elapsed time, and audio transport in the illustrated mode. Touch controls released without leaving held buttons. Portrait 390 × 844 and landscape 844 × 390 canvases resized correctly and had no horizontal overflow. Landscape touch mode hides keyboard guidance to keep the directional controls clear. A deliberately missed jump returned the keeper to the active checkpoint while preserving two collected sun seeds; a full reload restored those seeds, the checkpoint, and 2D mode. A separate reload after campaign completion restored all six records and unlocks, completion, collected seeds, and the final checkpoint.

The shared preview became unavailable after the full rendered campaign and portrait inspection. The remaining control, pause, recovery, and layout checks used local headless Chrome with software WebGL. No page errors or failed requests were observed in the passing run. These are browser verification results, not a physical phone, controller, listening, or human enjoyment assessment. Local receipts and screenshots are under the ignored `evidence/` directory.

## Original release history

Date: October 7, 2026 (America/Chicago). The following receipts describe the original orthographic-camera release and are retained as history.

## Behavioral checks

`npm run check` passes 17 behavioral tests, strict TypeScript checking, and the production build. The tests cover movement and landing in both modes, variable jumps, coyote time, jump buffering, held and released fold inputs, immediate rapid reversals, midair state preservation, projected landings, 3D wall bypasses, moving-island inheritance, checkpoint recovery, sentinel collision, seed-gated kindling, complete campaign progression, save restoration and corruption, replay, and safe checkpoint placement.

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
