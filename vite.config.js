import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig(() => {
  // Where the browser sends /api during development and `vite preview`.
  //
  // Overridable so the end-to-end suite, which runs its own backend instance on a
  // different port, can point the proxy at itself without editing this file.
  const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:5000'
  const proxy = { '/api': { target: apiTarget, changeOrigin: true } }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      // Pinned on purpose. Vite's default is to fall forward to 5174, 5175, ... whenever the
      // port is busy, which is how two dev servers ended up running at once: a stale instance
      // held 5173 and a fresh one silently took 5174. With strictPort it refuses to start and
      // says so, instead of leaving you on an origin the backend's CORS list may not allow.
      port: 5173,
      strictPort: true,
      proxy,
    },
    // `vite preview` serves the production build, so it needs the same proxy. Without it a
    // previewed build had no /api route at all, since the build's relative base URL is
    // resolved by the browser against the preview origin.
    preview: {
      port: 4173,
      strictPort: true,
      proxy,
    },
  }
})
