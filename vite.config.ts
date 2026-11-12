import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const repo = fileURLToPath(new URL('.', import.meta.url))

// https://vite.dev/config/
// The app lives in src/web. In development the real Worker (`pnpm dev:api`) answers /api and /songs;
// this dev server only serves the app and forwards those paths to it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repo, '')
  const backend = env.BACKEND_URL || 'http://127.0.0.1:8787'
  type ProxyEvents = { on: (event: 'proxyReq', handler: (req: { setHeader: (k: string, v: string) => void; getHeader: (k: string) => unknown }) => void) => void }
  return {
    root: 'src/web',
    resolve: { alias: { '@': fileURLToPath(new URL('./src/web', import.meta.url)) } },
    envDir: repo,
    build: { outDir: '../../dist', emptyOutDir: true },
    server: {
      proxy: Object.fromEntries(
        ['/api', '/songs'].map((path) => [
          path,
          {
            target: backend,
            // the Worker sees its own host, so its same-origin check on writes matches the origin below
            changeOrigin: true,
            // sign-in only trusts the Worker's own address (APP_URL), so requests say they come from there
            configure: (proxy: ProxyEvents) =>
              proxy.on('proxyReq', (req) => {
                if (req.getHeader('origin')) req.setHeader('origin', backend)
              }),
          },
        ]),
      ),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Worship Hub',
          short_name: 'Worship Hub',
          description: 'Play stems together with mute and solo.',
          theme_color: '#020617',
          background_color: '#020617',
          display: 'standalone',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // never let the service worker cache/intercept song audio or the auth API
          navigateFallbackDenylist: [/^\/songs\//, /^\/api\//],
        },
      }),
    ],
  }
})
