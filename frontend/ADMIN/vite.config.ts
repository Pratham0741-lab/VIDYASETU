import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Vite config — https://vitejs.dev/config/
// The Figma Make runtime plugins (site.json analytics injection, the kit
// story page, preview-only HMR helpers) were removed: this build runs offline
// and serves only the app itself.
export default defineConfig(({ mode }) => {
  const emitSourcemaps = mode === 'development'

  return {
    base: '/',
    build: {
      sourcemap: emitSourcemaps ? 'inline' : false,
      minify: !emitSourcemaps,
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: process.env.FIGMA_DEV_SERVER_HOST || '127.0.0.1',
      port: parseInt(process.env.PORT || '5174'),
      strictPort: true,
    },
    preview: {
      host: process.env.FIGMA_DEV_SERVER_HOST || '127.0.0.1',
      port: parseInt(process.env.PORT || '5174'),
      strictPort: true,
    },
  }
})
