import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/pages.spec.js",
  fullyParallel: true,
  workers: 2,
  timeout: 25_000,
  use: {
    baseURL: "http://127.0.0.1:4191",
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.SKYLENS_BROWSER || undefined },
    trace: "retain-on-failure",
  },
});
