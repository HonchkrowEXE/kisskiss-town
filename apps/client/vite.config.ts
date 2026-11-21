import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1', // cloudflared 連 localhost 會走 IPv4，Vite 預設在 Windows 只聽 IPv6
    proxy: {
      /**
       * For convenience, forward "/colyseus" requests to the local Colyseus server.
       */
      '/colyseus': {
        target: 'http://localhost:2567',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ''),
      },
    },

    allowedHosts: [
      'localhost',
      '.trycloudflare.com',
      '.ngrok-free.app',
    ],
  },
})
