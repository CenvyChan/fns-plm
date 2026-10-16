import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const nativeBuild = process.env.VITE_NATIVE_APP === 'true'
const devAllowedHost = process.env.CUE_VITE_DEV_ALLOWED_HOST?.trim()

export default defineConfig({
  base: nativeBuild ? './' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    ...(devAllowedHost ? { allowedHosts: [devAllowedHost] } : {}),
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', proxyReq => proxyReq.setHeader('origin', 'http://localhost:4000'))
        },
      },
    },
  },
})
