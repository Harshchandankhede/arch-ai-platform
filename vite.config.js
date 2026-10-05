import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Pinned on purpose. Vite's default is to fall forward to 5174, 5175, ... whenever the
    // port is busy, which is how two dev servers ended up running at once: a stale instance
    // held 5173 and a fresh one silently took 5174. With strictPort it refuses to start and
    // says so, instead of leaving you on an origin the backend's CORS list may not allow.
    port: 5173,
    strictPort: true,
  },
})
