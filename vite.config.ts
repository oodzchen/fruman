import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer'
import { VitePWA } from 'vite-plugin-pwa'

import { mapDataPlugin } from './build/mapDataPlugin'

export default defineConfig(({ command }) => {
  const plugins = [
    mapDataPlugin(),
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.ico',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'apple-touch-icon.png',
      ],
      manifest: {
        name: 'Fruman Game',
        short_name: 'Fruman',
        description: 'Fruman Game',
        theme_color: '#0d0b18',
        background_color: '#0d0b18',
        display: 'standalone',
        icons: [
          {
            src: 'android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,json,webmanifest,wasm,wav,ogg}',
        ],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ]

  if (command === 'build') {
    plugins.push(
      ViteImageOptimizer({
        test: /\.(png|jpe?g|webp|avif|gif|svg)$/i,
        includePublic: true,
        logStats: true,
        cache: true,
        cacheLocation: 'node_modules/.cache/vite-image-optimizer',
        png: {
          quality: 90,
          compressionLevel: 9,
          adaptiveFiltering: true,
          palette: true,
        },
        jpeg: {
          quality: 82,
          mozjpeg: true,
          progressive: true,
        },
        jpg: {
          quality: 82,
          mozjpeg: true,
          progressive: true,
        },
        webp: {
          quality: 82,
          alphaQuality: 82,
        },
        avif: {
          quality: 62,
        },
        svg: {
          multipass: true,
        },
      })
    )
  }

  return {
    plugins,
    worker: {
      format: 'es',
    },
    build: {
      target: 'esnext',
    },
    optimizeDeps: {
      exclude: ['box2d3-wasm'],
    },
    server: {
      host: true,
      https: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    preview: {
      host: true,
      https: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  }
})
