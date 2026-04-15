import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: 'src/loader.ts',
      name: 'RubyCrawl',
      formats: ['iife'],
      fileName: () => 'rubycrawl-loader.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'terser',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})
