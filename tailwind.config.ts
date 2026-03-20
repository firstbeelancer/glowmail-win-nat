import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['"Involve"', '"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        zinc: {
          50: "hsl(var(--zinc-50))",
          100: "hsl(var(--zinc-100))",
          200: "hsl(var(--zinc-200))",
          300: "hsl(var(--zinc-300))",
          400: "hsl(var(--zinc-400))",
          500: "hsl(var(--zinc-500))",
          600: "hsl(var(--zinc-600))",
          700: "hsl(var(--zinc-700))",
          800: "hsl(var(--zinc-800))",
          900: "hsl(var(--zinc-900))",
          950: "hsl(var(--zinc-950))",
        },
        emerald: {
          400: "var(--emerald-400)",
          500: "var(--emerald-500)",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;