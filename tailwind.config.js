/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Mono"', 'Consolas', 'monospace'],
      },
      colors: {
        fondo: '#0b0d10',
        pannello: '#12151a',
        rilievo: '#1a1e25',
        bordo: '#262b34',
      },
    },
  },
  plugins: [],
};
