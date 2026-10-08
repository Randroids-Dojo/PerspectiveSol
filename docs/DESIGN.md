# Perspective Sol: game design

Art, sound and interface direction live in [WORLD.md](WORLD.md). This file is
the rules, the controls and the campaign.

## The verb

**Fold** (Shift, X, F or J; X or a shoulder on a controller; the Fold button on
touch) switches between two independently rendered worlds over one
deterministic simulation (`src/sim/game.ts`):

| | Folded · flat (2D) | Unfolded · depth (3D) |
|---|---|---|
| Renderer | Canvas 2D storybook (`src/render2d`) | three.js sculpture (`src/render3d`) |
| Depth | Ignored: anything overlapping in x and y touches | Real: overlap needs all three axes |
| Islands far apart in depth | One path | Out of reach |
| Walls, rocks, sentinels at other depths | Block or kill | Walk around or past |
| Star bridges | Solid | A faint outline |
| Sunglass | An outline | Solid |
| Distant lanterns | Within reach | Out of reach |
| Moving in depth | Invisible | Ferries you across |

The switch always succeeds, on the ground or in midair, and never resets
motion, clocks, collectibles or music. Rules change at the instant of the
press; the pictures follow over 0.6 s (0.26 s with gentle motion). Anything the
keeper overlaps at that instant becomes passable until they are clear of it
(`game.ghosts`), so a switch can never trap or kill. Unfolding places the
keeper at the depth of the island they stand on, or are above.

## Movement

Tuned in `src/sim/constants.ts`: 6.2 u/s run reached in 0.1 s, a held jump of
about 2.1 units (0.78 s airtime, roughly 4.8 units across), a tap hop of about
0.5, softer gravity near the apex of a held jump, faster falls, coyote time
(0.1 s), jump buffering (0.13 s), corner nudges on head bumps, and small ledges
climbed while walking. Moving islands carry the keeper. Falling, a sentinel or
being crushed returns the keeper to the last sundial checkpoint, keeping every
seed, mote and lantern.

## Elements

Islands (five art styles, one collision box), moving plinths (x, y or depth),
star bridges (2D only), sunglass (3D only), lanterns (touch to light), gates
(sink when their lantern is lit), lantern bridges (form when lit), sunwalls and
rock spires (full solids), sentinels (patrolling hazards), three sun seeds per
chapter, optional light motes, sundial checkpoints, and the observatory, which
wakes only when it holds three seeds.

## Campaign

Each chapter introduces one idea and combines it with the ones before. The
intended solution of every chapter is a scripted route in `src/sim/routes.ts`
that the tests play to the end through ordinary inputs. `npx tsx scripts/map.ts`
draws blueprints of every layout.

1. **The waking garden** (morning): walk and jump; fold to reach islands far
   behind; unfold to walk past a rock spire that blocks the flat path.
2. **The hidden courtyard** (noon): sunwalls seal the flat path but can be
   walked around with depth; a stair of islands that only lines up folded.
3. **The tide engine** (afternoon): ferries and lifts; a depth ferry that only
   moves anything when unfolded; a star bridge that only exists folded.
4. **The violet archive** (dusk): sentinels guard one depth; a far lantern lit
   from the flat world opens a gate; a lantern behind a sunwall, reached with
   depth, raises a bridge.
5. **The night crossing** (night): sunglass stairs; walking from glass onto
   starlight by folding on the seam; jumping off glass and folding in midair.
6. **The last observatory** (dawn): everything together, up to the grand
   observatory and the ending.

Teaching happens in the world: short contextual prompts appear when the keeper
reaches the place they apply (`level.hints`), worded for the active control
scheme and dismissed by doing the thing.

## Controls

| Action | Keyboard | Controller | Touch |
|---|---|---|---|
| Walk | A D or ← → | Left stick or d-pad | Floating stick (left half) |
| Depth (3D) | W S or ↑ ↓ | Left stick or d-pad | Stick up and down |
| Jump (hold for height) | Space, K or Z | A | Jump |
| Fold or unfold | Shift, X, F or J | X, Y or any shoulder | Fold |
| Pause | Esc or P | Start | II |
| Mute | M | | |

Menus work with the mouse, touch, arrows and Enter, or a controller.

## Progress

Saved locally (`src/save.ts`): unlocked chapters, best times, motes found, the
chapter in progress (checkpoint, seeds, lanterns, timer, perspective) and
settings. Continue resumes at the last checkpoint. Corrupt saves are ignored.
