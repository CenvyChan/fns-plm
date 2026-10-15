import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const nativeBuild = process.env.VITE_NATIVE_APP === 'true'

export default defineConfig({
  base: nativeBuild ? './' : '/',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
})
