import { defineConfig } from "vite"
import basicSsl from "@vitejs/plugin-basic-ssl"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode }) => {
  const useHttps = mode === "https-dev"

  return {
    plugins: [
      react(),
      useHttps && basicSsl(),
    ].filter(Boolean),
    server: {
      host: "0.0.0.0",
      port: useHttps ? 5174 : 5173,
      ...(useHttps ? { https: {} } : {}),
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
      },
    },
    assetsInclude: ["**/*.glb"],
  }
})
