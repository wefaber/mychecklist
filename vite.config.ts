import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  root: 'web',
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  resolve: {
    alias: { '@': at('./web'), '@shared': at('./shared') },
    // @wefaber/ui and the app share one React.
    dedupe: ['react', 'react-dom'],
  },
  // Tauri wants a fixed port and must not see Vite hide Rust errors.
  clearScreen: false,
  server: {
    host: host || 'localhost',
    port: 5191,
    strictPort: true,
    allowedHosts: ['.ts.net'],
    proxy: {
      '/graphql': 'http://127.0.0.1:4151',
      '/auth': 'http://127.0.0.1:4151',
      '/events': 'http://127.0.0.1:4151',
      '/health': 'http://127.0.0.1:4151',
      '/ready': 'http://127.0.0.1:4151',
    },
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { outDir: '../dist/web', emptyOutDir: true },
})
