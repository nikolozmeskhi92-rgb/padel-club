import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx,mdx}",
    "./components/**/*.{ts,tsx}",
    "./content/**/*.{md,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0066CC", // Electric Ocean Blue — primary CTAs, active slots, focus states
          hover: "#0052A3",   // Deep Ocean Blue — primary hover
          accent: "#00BFA5",  // Luminous Mint/Teal — success, available slots, highlights
          dark: "#001A33",    // Deep Midnight Blue — heading text
        },
        surface: {
          base: "#FFFFFF",   // card backgrounds
          muted: "#F5F7FA",  // page background, dividers
        },
        ink: {
          DEFAULT: "#001A33", // heading text
          muted: "#4A5568",   // body / secondary text
        },
        line: "#E2E8F0",      // borders, dividers
        peak: "#F59E0B",      // peak-hour indicator (amber) — not in brief but needed for pricing UI
      },
      fontFamily: {
        heading: ["var(--font-heading)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
      borderRadius: {
        court: "10px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,26,51,0.04), 0 1px 3px rgba(0,26,51,0.06)",
        glow: "0 0 40px -10px rgba(0,102,204,0.25)",
      },
      keyframes: {
        "slide-check": {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
      },
      animation: {
        "slide-check": "slide-check 0.6s cubic-bezier(.22,1,.36,1) forwards",
      },
    },
  },
  plugins: [],
};
export default config;
