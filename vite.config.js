import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Libraries get their own files so a deploy only changes the app's small chunk;
// devices keep the cached React / Supabase / motion files between updates.
const vendor = (name, pkgs) => ({ name, test: new RegExp(`node_modules[\\\\/](${pkgs})[\\\\/]`) })

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            vendor('react', 'react|react-dom|scheduler|react-router'),
            vendor('supabase', '@supabase'),
            vendor('motion', 'motion|motion-dom|motion-utils|framer-motion'),
          ],
        },
      },
    },
  },
})
