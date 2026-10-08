# Perspective Sol

A keeper carries a small sun through six ruined observatories. The core verb is **fold**: Shift / X changes between a sculpted Three.js world and a separately illustrated Canvas 2D world. These are independent renderers with independent artwork. The 2D renderer draws its own islands, keeper, gardens, architecture, collectibles, hazards, particles, and layered skies; it never uses the 3D scene, rendered images, meshes, or textures. Depth stops separating islands, collectibles, and hazards. Unfold to walk around walls and sentinels. Both renderers read one simulation, one player, the same moving islands, and the same collection/progression state.

During a switch, the outgoing 3D camera aligns with the flat play plane and the two canvases crossfade continuously. The 2D camera uses the same world-space anchor and framing, so the keeper stays in place. Fully folded play hides the WebGL canvas and stops WebGL draw calls; Canvas 2D renders every frame. Unfolding resumes the 3D renderer from the current simulation, without reloading the level or restarting its clocks, audio, collectibles, or momentum. Every fresh fold input can reverse a transition immediately. Gentle motion shortens the transition and reduces illustrated character and scenery animation.

## Complete loop

Walk, jump, fold, collect three sun seeds, and kindle the chapter's observatory. Six distinct chapters introduce depth collapse, bypassing walls, moving islands, sentinels, and combined traversal. Checkpoints keep failure recoverable. Optional light motes and chapter best times support replay. Final restoration has an ending and chapter replay. Progress is saved locally, including collected seeds, chapter unlocks, records, and completion.

## Visual direction

Sculpted limestone suspended above a cloud ocean; patinated bronze celestial instruments, hand-inlaid golden lines, wind-bent gardens, orbiting sun seeds, and a small ivory keeper with a vermilion scarf. Palette: sea glass #9bc9d1, limestone #dde1d4, bronze #b99557, sunlight #f4c774, ink #102f45, scarf #cc6659. Light changes through violet dusk and blue night to a peach dawn. Cinematic silhouettes and deep atmospheric layers carry the scene; compact restrained game UI keeps the world central. Display typography uses a locally hosted serif and controls a locally hosted humanist sans.

The separate 2D treatment is a celestial storybook illustration: inked botanical silhouettes, individually drawn masonry and gold emblems, paper grain, hand-drawn cloud ribbons, parallax observatories, engraved sun rings, and a profile keeper carrying a little sun. The six chapter palettes carry across both art treatments. Static illustrated island artwork is cached in 2D canvases; moving positions, collection visibility, sentinels, checkpoints, the exit instrument, and character animation are drawn from live game state. Landing edges and wall widths remain aligned with the shared collision geometry.

## Sound direction

An original pentatonic score of felt keys, warm sustained harmonics, subtle percussion, and airy textures. The score keeps its transport when folding; the 3D harmonic layer opens and closes with perspective. Wind ambience and filtered spatial effects connect footsteps, jumping, stone contact, seed collection, checkpoints, sentinels, and beacon restoration. Music and effects have independent volume, pause suspends transport, and sound begins only after user interaction.

## Play acceptance

- Actual keyboard, touch, and gamepad input moves the keeper and causes jumps, landings, collection, recovery, and chapter completion.
- Perspective can switch on the ground or in the air without restarting physics, audio, moving platforms, collectibles, or the timer.
- 2D play uses its own Canvas 2D scene and artwork. WebGL frame counts stay fixed while fully folded play continues; returning to 3D resumes rendering the current shared state.
- 2D collapse makes depth-separated islands traversable; 3D bypasses walls that block the flattened path.
- Coyote time, jump buffering, variable-height jumps, motion inheritance, and generous landings support the platforming.
- The complete six-chapter route reaches the ending through ordinary simulated inputs, including required folds and depth detours.
- Pause, focus loss, replay, corrupted saves, reduced motion, mobile layouts, audio output, and deployed loading are verified separately.
