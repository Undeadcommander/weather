import { defineConfig } from "@playwright/test";

const port = 4190;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  testIgnore: "**/pages.spec.js",
  fullyParallel: true,
  workers: 2,
  timeout: 25_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.SKYLENS_BROWSER || undefined },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    env: { PORT: String(port) },
    url: `http://127.0.0.1:${port}/`,
    timeout: 30_000,
  },
});
