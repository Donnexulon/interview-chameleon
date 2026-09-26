const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');

const port = Number(process.env.INTERVIEW_CHAMELEON_E2E_PORT || 8765);
const baseURL = `http://127.0.0.1:${port}`;
const releasePython = path.join(__dirname, '.release-venv', 'Scripts', 'python.exe');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1366, height: 768 },
      reducedMotion: 'reduce',
    },
  }],
  webServer: {
    command: `"${releasePython}" -m uvicorn main:app --host 127.0.0.1 --port ${port}`,
    cwd: __dirname,
    env: {
      ...process.env,
      INTERVIEW_CHAMELEON_DATA_DIR: path.join(__dirname, 'build', 'e2e-runtime'),
    },
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 45_000,
  },
});
