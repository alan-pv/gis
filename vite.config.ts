/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import type { ServerResponse } from 'node:http'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const sidecarPort = process.env['GIS_SIDECAR_PORT'] ?? '8731'
const sidecarUrl = `http://127.0.0.1:${sidecarPort}`

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // The Python sidecar (speech-to-structure model) runs next to the dev server.
    proxy: {
      '/api/sidecar': {
        target: sidecarUrl,
        rewrite: (path) => path.replace(/^\/api\/sidecar/, ''),
        configure: (proxy) => {
          // Sidecar down: answer with a JSON error the client can show, instead of an empty 500.
          proxy.on('error', (err, _req, res) => {
            const out = res as ServerResponse
            if (out.headersSent || typeof out.writeHead !== 'function') return
            out.writeHead(503, { 'content-type': 'application/json' })
            out.end(JSON.stringify({ error: `Sidecar not available at ${sidecarUrl}: ${err.message}. Start it with "npm start".` }))
          })
        },
      },
    },
    // Only the app code is watched: the sidecar folder holds virtual environments and
    // model weights (tens of thousands of files would exhaust the inotify limit).
    watch: {
      ignored: ['**/sidecar/**', '**/tools/**', '**/models/**', '**/.venv/**'],
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
