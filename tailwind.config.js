/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors');

// Brand design tokens. Every component must use these names instead of raw hex values.
//   gold / gold-light / gold-dark  -> brand accent scale
//   surface-*                      -> page and panel backgrounds (dark theme)
//   ink                            -> primary foreground text
//   danger / success / warning     -> semantic state colors (full Tailwind shade scales)
export default {
  content: ['./index.html', './index.tsx', './App.tsx', './constants.tsx', './components/**/*.{ts,tsx}', './services/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: '#BF953F',
          light: '#FCF6BA',
          dark: '#AA771C',
        },
        surface: {
          DEFAULT: '#000000',
          0: '#080808',
          1: '#0a0a0a',
          2: '#111111',
          gold: '#12100A',
        },
        ink: '#f1f1f1',
        danger: colors.red,
        success: colors.emerald,
        warning: colors.amber,
        info: colors.sky,
      },
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
