import { defineConfig } from "vite"
import basicSsl from "@vitejs/plugin-basic-ssl"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig(({ mode }) => {
  const useHttps = mode === "https-dev"

  return {
    plugins: [
      tailwindcss(),
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
    build: {
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined

            if (id.includes("three/examples")) {
              return "three-extras"
            }

            if (id.includes("three/tsl")) {
              return "three-tsl"
            }

            if (id.includes("three/webgpu")) {
              return "three-webgpu"
            }

            if (id.includes("/node_modules/three/")) {
              return "three-runtime"
            }

            if (id.includes("react-markdown") || id.includes("remark-gfm")) {
              return "markdown-vendor"
            }

            if (id.includes("react-dom") || id.includes("/react/")) {
              return "react-vendor"
            }

            return "vendor"
          },
        },
      },
    },
  }
})
