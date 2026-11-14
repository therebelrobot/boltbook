import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    // `npm run dev:client` serves the client and proxies the API to the running server.
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
})
