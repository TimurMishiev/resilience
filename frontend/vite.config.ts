import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import cesium from 'vite-plugin-cesium'

const ON_DEMAND_EXPERIENCE_ASSET_GLOBS = [
  '**/assets/MapPage-*.js',
  '**/assets/GlobePage-*.js',
  '**/assets/maplibre-gl-*.js',
  '**/assets/maplibre-gl-*.css',
]

const ON_DEMAND_EXPERIENCE_ASSET_REGEX = /\/assets\/(?:MapPage|GlobePage|maplibre-gl)-.*\.(?:js|css)$/i

export default defineConfig({
  plugins: [
    react(),
    cesium(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Resilience — Mission Operations Console',
        short_name: 'RESILIENCE',
        description: 'Mission operations console for field command and control',
        theme_color: '#1c2127',
        background_color: '#1c2127',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Precache the common application shell; keep map/globe route assets
        // on-demand so non-map sessions do not pay their install-time cost.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        globIgnores: ['**/Cesium.js', '**/cesium/**', ...ON_DEMAND_EXPERIENCE_ASSET_GLOBS],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, // 6 MB
        // Promote the new service worker immediately so old chunk manifests are
        // replaced as soon as a new deploy is fetched.
        skipWaiting: true,
        clientsClaim: true,
        // Remove stale precache entries from old deploys so old chunk URLs
        // are never served after a new SW activates.
        cleanupOutdatedCaches: true,
        // Network-first for API — serve cached data when offline
        runtimeCaching: [
          {
            urlPattern: /^\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: ON_DEMAND_EXPERIENCE_ASSET_REGEX,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'experience-asset-cache',
              expiration: {
                maxEntries: 16,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    // Forward /api/* to the Rails backend in development.
    // Override the target by setting VITE_API_TARGET in .env.local.
    proxy: {
      '/api': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
