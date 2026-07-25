/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0f14',
        panel: '#111827',
        line: '#1f2937',
        ink: '#e6edf3',
        muted: '#8b95a1',
        accent: '#7c3aed',
        accent2: '#06b6d4',
        ok: '#22c55e',
        warn: '#f59e0b',
        bad: '#ef4444',
      },
    },
  },
  plugins: [],
};