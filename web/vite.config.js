import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const webDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: webDir,
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3088',
    },
  },
  build: {
    outDir: path.join(webDir, 'dist'),
    emptyOutDir: true,
  },
})
