import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración de Playwright para los 3 flujos End-to-End obligatorios:
 * 1. Flujo de Autenticación
 * 2. Flujo de Lobbies
 * 3. Flujo de Canvas
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false, // Ejecución secuencial para no colisionar en puertos/salas
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.js',
    port: 3100,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: '3100',
    },
    timeout: 15_000,
  },
  projects: [
    {
      name: 'Desktop Chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile-.*\.spec\.js/,
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: /mobile-.*\.spec\.js/,
    },
  ],
});
