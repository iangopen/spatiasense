/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Production is served from https://iangopen.github.io/spatiasense/,
// so built asset URLs need the /spatiasense/ prefix. `vite preview` serves that
// same build, so it uses the prefix too; the dev server (and Vitest) stay at "/".
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/spatiasense/" : "/",
  plugins: [react()],
  test: {
    include: ["src/**/*.test.ts"],
  },
}));
