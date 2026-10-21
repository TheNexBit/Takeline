import { defineConfig } from 'vitest/config';

// Test della logica del frontend: transport, pre-flight, watchdog, nomi.
// Il backend Tauri e' quello simulato dell'anteprima (src/dev/anteprimaBrowser.ts).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
