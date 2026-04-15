import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: 'src/widget.tsx',
      name: 'RubyCrawlWidget',
      formats: ['iife'],
      fileName: () => 'rubycrawl-widget.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: 'terser',
    cssCodeSplit: false,
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})
