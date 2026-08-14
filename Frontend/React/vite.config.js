import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    // Alias '@' -> ./src (richiesto dagli import shadcn: @/components/ui/*, @/lib/*)
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true, // Permette qualsiasi dominio/IP (es. video.franzpage.it)
    strictPort: true,
    port: 5173,
    // ------------------------------------------------------------------
    // WATCHER — configurazione critica per le prestazioni su Windows/Mac.
    //
    // Le variabili CHOKIDAR_USEPOLLING / WATCHPACK_POLLING attivano il polling
    // in modo GLOBALE, quindi anche su node_modules (~25.000 file). Su un bind
    // mount Docker Desktop (protocollo 9p) quella scansione continua bloccava
    // la risposta del dev server: misurato 1,5-3,4 s di TTFB sull'index.html,
    // contro 0,010 s senza polling. Circa 200x.
    //
    // Qui il polling resta ATTIVO (serve all'hot-reload: su 9p gli eventi
    // inotify non si propagano) ma limitato ai sorgenti veri, escludendo
    // node_modules e le cartelle di build. Cosi' si tiene l'hot-reload senza
    // pagarne il costo.
    //
    // Su host LINUX (ZimaBlade/Raspberry) il polling non serve affatto:
    // impostare VITE_POLLING=false in .env, inotify funziona nativamente.
    // ------------------------------------------------------------------
    watch: {
      usePolling: process.env.VITE_POLLING !== 'false',
      interval: 1000,
      binaryInterval: 3000,
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/android/**',
      ],
    },
  }
})
