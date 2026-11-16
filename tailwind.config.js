/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: '#0b1110',
          900: '#111a18',
          800: '#17241f',
          700: '#1f322d',
          600: '#2b433a',
        },
        lime: {
          400: '#b7ff5a',
          500: '#a7f32c',
          600: '#8edb14',
        },
      },
      boxShadow: {
        soft: '0 12px 28px rgba(10, 16, 13, 0.44)',
      },
    },
  },
  plugins: [],
}

