import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  server: { port: 5199, host: true },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
} as Parameters<typeof defineConfig>[0]);
