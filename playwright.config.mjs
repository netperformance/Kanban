// Copyright (c) 2026 Aaron Kreis (https://aaron.de). Licensed under the MIT License, see LICENSE.
import { defineConfig, devices } from '@playwright/test';

// Starten mit "npm test". Vorher einmalig: "npm install" und "npx playwright install chromium".
// Die Tests öffnen board.html direkt von der Festplatte (file://), so wie das Board benutzt wird.
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.mjs',
  fullyParallel: true,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}
  }
});
