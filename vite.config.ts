import { defineConfig } from 'vite';

// SQLite WASM requires Cross-Origin isolation for SharedArrayBuffer.
// These headers are required both in dev (plugin) and in preview/prod (server option).
const crossOriginHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  optimizeDeps: {
    // Prevent Vite from pre-bundling the WASM package — it handles its own loading
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  server: {
    headers: crossOriginHeaders,
  },
  preview: {
    headers: crossOriginHeaders,
  },
  plugins: [
    {
      // Inject headers for every response during dev server
      name: 'cross-origin-isolation',
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          next();
        });
      },
    },
  ],
});
