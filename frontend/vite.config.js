import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    proxy: {
      '/api': {
        target: 'https://dedgatnnc2.execute-api.ap-south-1.amazonaws.com/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },

  test: {
    // Run tests in a browser-like DOM environment (no need for describe/it imports).
    environment: 'jsdom',
    globals: true,
    // Load jest-dom matchers (toBeInTheDocument, etc.) in every test file.
    setupFiles: ['./src/test-setup.js'],
    // Exclude node_modules and dist from test discovery.
    exclude: ['node_modules', 'dist'],
  },
})
