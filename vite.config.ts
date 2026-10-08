import { defineConfig } from "vite";
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
  server: { host: "0.0.0.0", port: 5186 },
});
