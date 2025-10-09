/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./admin.html",
    "./App.tsx",
    "./index.tsx",
    "./admin.tsx",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./components/admin/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0D47A1', // A deep blue
        secondary: '#1565C0', // A lighter, vibrant blue
        accent: '#FFC107', // A warm amber/yellow
        neutral: {
          'light': '#F5F5F5',
          'DEFAULT': '#424242',
          'dark': '#212121',
        },
      },
    },
  },
  plugins: [],
}