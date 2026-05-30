/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        fi: {
          navy: "#2b245e",
          navySoft: "#393073",
          orange: "#ff4d1a",
          orangeSoft: "#fff0eb",
          paper: "#f8f7ff",
          ink: "#17142f",
        },
      },
      boxShadow: {
        glow: "0 20px 70px rgba(43, 36, 94, 0.18)",
      },
    },
  },
  plugins: [],
};
