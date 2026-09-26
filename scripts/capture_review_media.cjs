const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const baseURL = process.env.INTERVIEW_CHAMELEON_CAPTURE_URL || 'http://127.0.0.1:8771';
const outputDir = path.resolve(__dirname, '..', 'design-review', 'final');
fs.mkdirSync(outputDir, { recursive: true });

const readyModels = {
  ollama_connected: true,
  ollama_installed: true,
  available: ['qwen2.5:7b'],
  catalog: [
    { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', size_gb: 4.7, badge: 'Most reliable', description: 'Fully tested for interviews and feedback.', speed: 'Balanced', certified: true, experimental: false, installed: true },
    { id: 'qwen3.5:4b', name: 'Qwen 3.5 4B', size_gb: 3.4, badge: 'Smaller and faster', description: 'A lighter option for quicker practice.', speed: 'Fast', certified: false, experimental: false, installed: false },
    { id: 'granite3.3:8b', name: 'Granite 3.3 8B', size_gb: 4.9, badge: 'Structured feedback', description: 'A strong fit for business interviews.', speed: 'Balanced', certified: false, experimental: false, installed: false },
    { id: 'phi4-mini-reasoning:3.8b', name: 'Phi-4 Mini Reasoning', size_gb: 3.2, badge: 'Deep reasoning', description: 'Technical questions, analysis, and cases.', speed: 'Thoughtful', certified: false, experimental: false, installed: false },
  ],
  selected_model: 'qwen2.5:7b',
  model_setup_completed: true,
  selected_ready: true,
  has_supported_model: true,
};

async function mockReadyModels(page) {
  await page.route('**/api/models', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(readyModels) });
  });
  await page.route('**/api/system/status', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ready_for_ai_rehearsal: true,
        capabilities: {
          ollama: { ready: true },
          model: { ready: true },
          speech_input: { ready: false },
        },
        hardware: {
          disk: { free_gib: 100 },
          memory_bytes: 16 * 1024 ** 3,
        },
      }),
    });
  });
}

async function decodeVisibleImages(page, selector) {
  await page.locator(selector).evaluateAll(async images => {
    await Promise.all(images.map(image => {
      if (image.complete && image.naturalWidth) return Promise.resolve();
      if (typeof image.decode === 'function') return image.decode().catch(() => null);
      return new Promise(resolve => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
    }));
  });
}

async function capture(page, fileName, readySelector) {
  if (readySelector) await page.locator(readySelector).waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outputDir, fileName), fullPage: false });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const videoContext = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: 'no-preference',
    recordVideo: { dir: outputDir, size: { width: 1366, height: 768 } },
  });
  await videoContext.request.delete(`${baseURL}/api/sessions`);
  const videoPage = await videoContext.newPage();
  await mockReadyModels(videoPage);
  await videoPage.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await videoPage.locator('.mm-opening[data-opening-phase="hold"]').waitFor({ state: 'visible', timeout: 5_000 });
  // This frame is intentionally captured without the general settling delay:
  // the normal-motion hold is finite and the screenshot itself is the settle.
  await videoPage.screenshot({ path: path.join(outputDir, '00-opening-hold.png'), fullPage: false });
  const openingVideo = videoPage.video();
  await videoPage.locator('.mm-opening').waitFor({ state: 'detached', timeout: 10_000 });
  await videoPage.waitForTimeout(700);
  await capture(videoPage, '01-home.png', '.hero-wrap');
  await videoPage.close();
  await openingVideo.saveAs(path.join(outputDir, 'opening-final.webm'));
  await videoContext.close();
  await openingVideo.delete().catch(() => null);

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: 'reduce',
  });
  await context.request.delete(`${baseURL}/api/sessions`);
  const page = await context.newPage();
  await mockReadyModels(page);
  await page.goto(baseURL);
  await page.locator('.mm-opening').waitFor({ state: 'detached', timeout: 4_000 });

  await page.evaluate(() => window.nav('setup'));
  await capture(page, '02-setup-role.png', '#su-p1.active');
  await page.locator('#su-role').fill('Senior Product Designer');
  await page.getByRole('button', { name: /continue to format/i }).click();
  await page.locator('#su-mods-grid .su-mod').first().click();
  await capture(page, '03-setup-format.png', '#su-p2.active');
  await page.getByRole('button', { name: /continue to interviewer/i }).click();
  await page.locator('#su-chars-grid .su-char').nth(6).click();
  await decodeVisibleImages(page, '#su-chars-grid img');
  await capture(page, '04-setup-interviewer.png', '#su-p3.active');
  await page.getByRole('button', { name: /continue to conditions/i }).click();
  await capture(page, '05-setup-conditions.png', '#su-p4.active');
  await page.getByRole('radio', { name: /medium/i }).click();
  await page.getByRole('radio', { name: /standard/i }).click();
  await capture(page, '05b-setup-conditions-selected.png', '#su-p4.active');

  await page.evaluate(() => window.nav('hero'));
  await page.evaluate(() => window.loadDemoReport());
  await capture(page, '07-session-report.png', '.rpt-wrap');
  await page.evaluate(() => window.nav('history'));
  await capture(page, '08-session-history.png', '.hist-wrap');
  await page.locator('.hist-sess').first().click();
  await capture(page, '09-session-detail.png', '.sr-wrap');
  await page.getByRole('button', { name: /practice weak areas/i }).first().click();
  await capture(page, '06-live-rehearsal.png', '.studio-session');

  await page.evaluate(() => window.nav('portfolio'));
  await capture(page, '10-portfolio.png', '.ptf-page');
  await page.evaluate(() => window.nav('questions'));
  await capture(page, '11-practice-library.png', '.qb-catalogue');
  await page.evaluate(() => window.nav('achievements'));
  await capture(page, '12-progress-record.png', '.ach-wrap');
  await page.evaluate(() => window.nav('games'));
  await capture(page, '13-training-floor.png', '.mg-wrap');
  await page.evaluate(() => window.nav_game('blitz'));
  await capture(page, '14-blitz-drill.png', '.bz-wrap');
  await page.evaluate(() => window.nav_game('star'));
  await capture(page, '15-star-builder.png', '.st-wrap');
  await page.evaluate(() => window.nav_game('salary'));
  await capture(page, '16-salary-dare.png', '.sd-wrap');
  await page.evaluate(() => window.nav('models'));
  await capture(page, '17-ai-models.png', '.mm-wrap');

  await context.close();
  await browser.close();
  process.stdout.write(`Captured final review media in ${outputDir}\n`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
