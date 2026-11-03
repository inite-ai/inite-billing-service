import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    // @inite/landing ships ESM with extensionless relative imports, which a
    // bundler resolves (next build does) and bare Node does not: let Vite
    // transform it like source instead of handing it to Node.
    server: { deps: { inline: ['@inite/landing'] } },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
})
