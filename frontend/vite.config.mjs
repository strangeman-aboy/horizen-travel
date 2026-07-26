import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const staticDemo = mode === "static-demo";

  return {
    base: staticDemo ? "./" : "/",
    build: {
      outDir: staticDemo ? "dist-static" : "dist/client",
    },
    define: {
      __STATIC_DEMO__: JSON.stringify(staticDemo),
      __TRAVEL_API_ALLOW_ENV_OVERRIDE__: JSON.stringify(command === "serve"),
      __TRAVEL_API_DEFAULT_ORIGIN__: JSON.stringify(
        command === "serve" ? "http://127.0.0.1:8787" : "",
      ),
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [react()],
  };
});
