import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
        // Precache all static build assets
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
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
