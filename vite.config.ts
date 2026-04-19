import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer'

export default defineConfig(({ command }) => {
  const plugins = [basicSsl()]

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
