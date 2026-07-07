/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Analytical palette (spec §5): charcoal/slate neutrals, blue/teal accents.
        surface: { DEFAULT: "#0f172a", light: "#f8fafc" },
      },
    },
  },
  plugins: [],
};
