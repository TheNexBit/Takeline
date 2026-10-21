import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Takeline crea alla partenza oggetti globali (connessione a OBS, regia,
 * ascolto di tastiera e pedale). L'aggiornamento a caldo ne lascerebbe in vita
 * una seconda copia invisibile che esegue i comandi: in sviluppo ogni modifica
 * ricarica quindi l'intera pagina, partendo sempre da zero.
 */
const ricaricaCompleta = (): Plugin => ({
  name: 'takeline-ricarica-completa',
  apply: 'serve',
  handleHotUpdate({ server }) {
    server.ws.send({ type: 'full-reload' });
    return [];
  },
});

// Porta fissa: tauri.conf.json punta a http://localhost:1420.
export default defineConfig({
  plugins: [react(), ricaricaCompleta()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/dev-dati/**'] },
  },
  build: { target: 'es2022' },
});
