import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react')) {
            return 'react-vendor'
          }

          if (id.includes('@supabase')) {
            return 'supabase-vendor'
          }

          if (id.includes('zustand')) {
            return 'zustand-vendor'
          }
        }
      }
    }
  }
})
