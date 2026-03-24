import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["GlowMail_icon.png", "fonts/Involve-VF.ttf"],
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,ttf}"],
      },
      manifest: {
        name: "GlowMail AI",
        short_name: "GlowMail",
        description: "AI-powered email client",
        theme_color: "#09090b",
        background_color: "#09090b",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          {
            src: "/GlowMail_icon.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/GlowMail_icon.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
