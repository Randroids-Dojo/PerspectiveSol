# Perspective Sol

Start user-facing answers with 🤖️. Never include tool or AI attribution in commits or PR descriptions.

Read docs/DESIGN.md before changing mechanics and docs/WORLD.md before changing art, sound or interface. There is one deterministic simulation (`src/sim/game.ts`) for both perspectives. No reload, state reset, timer reset or audio restart on a perspective change, and a switch must always succeed.

2D must remain an independent Canvas 2D render with its own artwork (`src/render2d`). Never replace it with an orthographic camera, a 3D screenshot or flattened 3D meshes. Fully folded gameplay must draw zero WebGL frames. Renderers read the simulation and never change it.

Chapter changes must keep every scripted route in `src/sim/routes.ts` passing (`npx tsx scripts/routes.ts`); a route is the documented intended solution. Use `npx tsx scripts/map.ts` to review layouts.

Run `npm run check` before pushing. After changes to controls, collision, camera, art, audio or UI, exercise the real game: `node scripts/e2e.mjs` against `npm run dev` plays every chapter through the real loop and checks folds, pause, saves and touch. Preserve checkpoints and local progress (saves are migrated, never trusted).

Deployment uses the Vercel Git connection: main is production; branches receive previews.
