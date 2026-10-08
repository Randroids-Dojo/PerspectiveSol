# Perspective Sol: world bible

The shared reference for both renderers, the audio, and the interface. The
simulation in `src/sim` is the single source of truth for where everything is;
this document describes how it should look, move, and sound.

## Premise

The sun broke into seeds and fell into a sea of clouds. The floating limestone
observatories that once tended it went dark. The last **Keeper**, a small
figure in an ivory hooded cloak with a long vermilion scarf, carries a little
sun that hovers at their shoulder. Six chapters, six observatories, three sun
seeds each. Time of day advances through the journey until the restored sun
rises in the final chapter.

The Keeper can **fold** the world flat (2D) or **unfold** it into depth (3D) at
any moment. The two are separate art worlds, drawn by independent renderers,
over one simulation:

- **Sculpted (3D)**: three.js. Carved limestone, patinated bronze, glass,
  gardens, real light and shadow, atmospheric depth above a cloud sea.
- **Illustrated (2D)**: Canvas 2D. A celestial storybook: painted flat shapes,
  ink linework, paper grain, gold leaf, hatching, layered parallax skies.

The palettes match per chapter so a fold feels like turning the same place into
a different medium, not teleporting.

## Chapters

| # | Name | Time | Mood and set dressing |
|---|------|------|-----------------------|
| 0 | The waking garden | morning | Overgrown terrace gardens, cypress and olive trees, wildflowers, broken pergolas, birdsong. Teaches walking, jumping, folding, unfolding. |
| 1 | The hidden courtyard | noon | White courtyards, tall engraved sunwalls, arcades, fountains, potted citrus. Teaches walking around walls in depth. |
| 2 | The tide engine | afternoon | Bronze clockwork, gears, chains, pistons and brass pipes; islands that drift on a clockwork tide. Teaches moving islands and star bridges. |
| 3 | The violet archive | dusk | Library ruins, stone shelves of books, scroll banners, hanging lanterns, violet and rose light. Teaches sentinels, lanterns and gates. |
| 4 | The night crossing | night | Moon, stars and constellations, glowing star bridges, sunglass prisms catching moonlight; lanterns and seeds are the main light. Teaches sunglass and midair folding. |
| 5 | The last observatory | dawn | The grand observatory: domes, telescopes, armillary spheres, gold; the sun returns. Everything combined. |

`level.theme.time` identifies the chapter's set dressing and `level.theme.palette`
holds its colours (see `src/sim/build.ts`). `level.theme.seed` seeds procedural
decoration so it is identical on every visit and in both renderers' layouts.

## Rules that the art must make readable

Coordinates: x left to right, y up, z depth (positive toward the camera).

- **Folded (2D)** ignores depth: anything overlapping in x and y touches. Islands
  far apart in depth become one path. Walls, rocks, sentinels and islands at
  *other* depths now block the way.
- **Unfolded (3D)** needs real overlap in all three axes. Walk around walls and
  sentinels; depth gaps are real.
- Switching always succeeds, even midair. If the Keeper overlaps something at
  the moment of a switch, that thing is passable until the Keeper is clear
  (`game.ghosts`). Draw ghosted solids normally; the Keeper may appear in front.
- Unfolding mid-air or on the ground puts the Keeper at the depth of the island
  they are standing on or above.

Everything that is solid in the current perspective must look solid, and
everything that is not must look clearly not solid.

## Elements

All positions come from `Game` queries every frame (`islandPosition`,
`islandPresence`, `islandSolid`, `wallHeight`, `pickupPosition`,
`sentinelPosition`, `lanternProgress`, `collected`, `lit`, `checkpointId`).

- **Islands** (`level.islands`): the walkable top face is the box top at
  `y`; the solid box extends `h` downward. Styles:
  - `garden`: grass top edge, flowers, shrubs, the occasional tree.
  - `stone`: paved limestone with engraved gold lines.
  - `ruin`: cracked paving, broken columns, moss.
  - `bridge`: a narrow walkway with balusters or rails.
  - `plinth`: a machined bronze-rimmed platform, used for moving islands.
  Below the solid slab, islands float on a tapering, stratified rock underside
  with hanging roots or vines. The underside is decoration, not collision, so it
  must read as background mass (darker, receding) and never as a ledge.
- **Moving islands** (`motion`): plinth style with bronze trim and a gentle glow
  or small gear detail so the player expects motion. Lantern-bound movers wait
  at rest until lit.
- **Star bridges** (`only: "2d"`): solid only folded. Illustrated: a luminous
  constellation plank of star points and gold lines, clearly walkable. Sculpted:
  a faint, shimmering dotted outline, obviously not solid, with a small square
  "fold" glyph.
- **Sunglass prisms** (`only: "3d"`): solid only unfolded. Sculpted: warm
  translucent crystal with a bright rim and inner glow. Illustrated: a dashed
  ghost outline with light hatching and a small cube "unfold" glyph.
- **Lantern bridges** (still island with `lantern`): before the lantern is lit,
  a faint dotted promise of the shape; when lit, it assembles over
  `islandPresence` 0 → 1.
- **Walls** (`level.walls`, `y` is the base):
  - `sunwall`: a tall carved limestone slab with a gold sun-disc inlay and small
    buttresses.
  - `gate`: a bronze and stone door with a sun-lock emblem that sinks into its
    island (`wallHeight` shrinks) once its lantern is lit, shedding dust.
  - `rock`: a natural sea-stack spire, stratified, mossy.
- **Lanterns**: bronze lantern posts about 1.6 tall with a glass cage. Unlit:
  cold with a faint ember. Lit: a warm flame and real light. On lighting, a
  thread of light travels from the lantern to each gate or bridge bound to it.
- **Sentinels**: rose and crimson faceted crystal eyes inside rotating rings,
  floating, glowing, with a faint trail. They must read as danger at a glance;
  rose and crimson are reserved for danger.
- **Sun seeds** (3 per chapter): the brightest things in the world. Golden
  faceted seed crystals with an orbiting ring and rays, bobbing and spinning.
- **Light motes** (optional): small soft pale-gold orbs with sparkle.
- **Checkpoints**: a sundial ring inlaid in the floor. Dull bronze until
  touched, then glowing gold with rising motes.
- **Observatory** (`level.exit`): a small domed observatory with an armillary
  sphere on the final island and three seed sockets that light as seeds are
  found. Dormant until all three are held, then awake (glow, spinning rings).
  On `exit`, a beam of light rises into the sky.

## The Keeper

About 1.2 units tall and 0.6 wide (`HEIGHT`, `RADIUS * 2` in
`src/sim/constants.ts`): round hooded head, ivory cloak, dark face shadow with
two small bright eyes, long vermilion scarf with secondary motion, short legs.
The little sun hovers just above and behind one shoulder, trailing light, and
is a real light source in 3D.

Animation from `game.player` and events:
- idle: breathing, scarf drift, sun bob
- run: leg and arm cycle locked to `player.stride` (one stride = `STRIDE` units)
- jump: stretch; fall: arms up, scarf streaming; land: squash scaled by impact
- fold or unfold: a small flourish of the sun
- `die`: dissolve into sparks (or, illustrated, into paper confetti and ink)
- `respawn`: reform from light at the checkpoint
- clearing (`status === "clearing"`): raise the sun toward the observatory

## The fold transition

See `src/view.ts`. `view.fold` runs 0 (sculpted) → 1 (illustrated), linear in
time over `FOLD_SECONDS`; renderers apply their own easing.

- 0 .. `CROSS`: the sculpted camera swings from its three-quarter view to a
  straight side view and the world's depth flattens onto the plane
  `z = view.focus.z`. By `CROSS` the sculpted picture must match the flat
  framing: a world point (x, y) on that plane lands on `flatToScreen(view, x, y)`.
- `CROSS` .. 1: the illustrated world opens from the Keeper's sun as an
  expanding circle with a soft golden rim, over the folded sculpted world.
- At 1, only the illustrated canvas is visible and WebGL draws nothing.
- Unfolding plays the same timeline backwards and can reverse at any instant.

## Audio direction

An original adaptive score with one transport across both perspectives. Each
chapter has its own key, tempo and theme built on a shared "Sol" leitmotif. Two
arrangements of the same music:

- **Sculpted (3D)**: warm and spacious. Felt piano, warm pads, soft bass,
  string-like swells, brushed percussion, a large hall.
- **Illustrated (2D)**: intimate storybook. Music box or celesta, harp and
  pizzicato, a breathy wooden flute lead, a soft hand drum, a small warm room.

Folding crossfades the arrangements without restarting anything. Sound
effects are designed, layered and in key; ambience changes per chapter.

## Interface direction

Restrained and elegant: the world is the star. Serif display type (Cormorant)
for names and headings, humanist sans (DM Sans) for controls and numbers.
Ivory, ink and gold. Three seed sockets always visible. Contextual teaching
prompts in the world rather than walls of text.
