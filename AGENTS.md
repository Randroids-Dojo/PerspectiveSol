# Perspective Sol

Start user-facing answers with 🤖️. Never include tool or AI attribution in commits or PR descriptions.

Read docs/DESIGN.md before changing game mechanics. Preserve one deterministic simulation for both render modes. No reload, state reset, timer reset, or audio restart on perspective change. Run `npm run check` before pushing. Exercise the actual rendered game after changes to controls, collision, camera, or art. Preserve recovery checkpoints and local progress. Deployment uses the Vercel Git connection: main is production; branches receive previews.
