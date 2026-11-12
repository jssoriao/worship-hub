import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { songsPlugin } from './dev/songs-plugin.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // `pnpm dev:app`: the real Worker (`pnpm cf:api`) answers /api and /songs, with sign-in on
  const backend = env.VITE_REQUIRE_AUTH === '1' ? env.BACKEND_URL || 'http://127.0.0.1:8787' : null
  type ProxyEvents = { on: (event: 'proxyReq', handler: (req: { setHeader: (k: string, v: string) => void; getHeader: (k: string) => unknown }) => void) => void }
  return {
    server: backend
      ? {
          proxy: Object.fromEntries(
            ['/api', '/songs'].map((path) => [
              path,
              {
                target: backend,
                // sign-in only trusts the Worker's own address (APP_URL), so requests say they come from there
                configure: (proxy: ProxyEvents) =>
                  proxy.on('proxyReq', (req) => {
                    if (req.getHeader('origin')) req.setHeader('origin', backend)
                  }),
              },
            ]),
          ),
        }
      : undefined,
    plugins: [
      react(),
      tailwindcss(),
      // dev only: serves SONGS_DIR (default ./songs) at /songs, mimicking S3/CloudFront (not used with the real Worker)
      ...(backend ? [] : [songsPlugin(env.SONGS_DIR || 'songs')]),
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
