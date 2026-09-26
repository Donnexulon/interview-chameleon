const { test, expect } = require('@playwright/test');

const MODEL_CATALOG = [
  { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', size_gb: 4.7, badge: 'Most reliable', description: 'Fully tested.', speed: 'Balanced', certified: true, experimental: false },
  { id: 'qwen3.5:4b', name: 'Qwen 3.5 4B', size_gb: 3.4, badge: 'Smaller and faster', description: 'A lighter option.', speed: 'Fast', certified: false, experimental: false },
  { id: 'granite3.3:8b', name: 'Granite 3.3 8B', size_gb: 4.9, badge: 'Structured feedback', description: 'Business interviews.', speed: 'Balanced', certified: false, experimental: false },
  { id: 'phi4-mini-reasoning:3.8b', name: 'Phi-4 Mini Reasoning', size_gb: 3.2, badge: 'Deep reasoning', description: 'Technical questions and analysis.', speed: 'Thoughtful', certified: false, experimental: false },
];

async function mockReadyModelSetup(page) {
  await page.route('**/api/models', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ollama_connected: true,
        ollama_installed: true,
        available: ['qwen2.5:7b'],
        catalog: MODEL_CATALOG.map(model => ({
          ...model,
          installed: model.id === 'qwen2.5:7b',
        })),
        selected_model: 'qwen2.5:7b',
        model_setup_completed: true,
        selected_ready: true,
        has_supported_model: true,
      }),
    });
  });
}

async function mockReadySystemStatus(page, { recommendedHardware = true } = {}) {
  await page.route('**/api/system/status', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ready_for_ai_rehearsal: recommendedHardware,
        capabilities: {
          ollama: { ready: true },
          model: { ready: true },
          speech_input: { ready: false },
        },
        hardware: {
          disk: { free_gib: recommendedHardware ? 100 : 8 },
          memory_bytes: (recommendedHardware ? 16 : 8) * 1024 ** 3,
        },
      }),
    });
  });
}

async function openConditionsStep(page) {
  await page.getByLabel('Target role').fill('Product Designer');
  await page.getByRole('button', { name: /continue to format/i }).click();
  await page.locator('#su-mods-grid .su-mod').first().click();
  await page.getByRole('button', { name: /continue to interviewer/i }).click();
  // The carousel uses cloned cards at each end for infinite wrapping. The
  // central copy is the one guaranteed to be inside the visible track.
  await page.locator('#su-chars-grid .su-char').nth(6).click();
  await page.getByRole('button', { name: /continue to conditions/i }).click();
  await expect(page.getByText('Set the conditions.', { exact: true })).toBeVisible();
}

test('setup uses native labels and keyboard-operable tabs, radios, and switches', async ({ page }) => {
  await mockReadyModelSetup(page);
  await mockReadySystemStatus(page, { recommendedHardware: false });
  await page.goto('/');
  await page.getByRole('button', { name: /begin a session/i }).click();

  await expect(page.getByLabel('Target role')).toBeVisible();
  await expect(page.getByLabel(/job description/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /attach your resume/i })).toBeVisible();

  const uploadTab = page.getByRole('tab', { name: /upload file/i });
  const pasteTab = page.getByRole('tab', { name: /paste text/i });
  await expect(uploadTab).toHaveAttribute('aria-selected', 'true');
  await uploadTab.focus();
  await uploadTab.press('ArrowRight');
  await expect(pasteTab).toBeFocused();
  await expect(pasteTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: /paste text/i })).toBeVisible();
  await pasteTab.press('ArrowLeft');
  await expect(uploadTab).toBeFocused();
  await expect(uploadTab).toHaveAttribute('aria-selected', 'true');

  await openConditionsStep(page);

  const difficulty = page.getByRole('radiogroup', { name: 'Difficulty' });
  const warmUp = difficulty.getByRole('radio', { name: /warm-up/i });
  const medium = difficulty.getByRole('radio', { name: /medium/i });
  const pressure = difficulty.getByRole('radio', { name: /^pressure/i });
  await expect(difficulty.getByRole('radio', { checked: true })).toHaveCount(0);
  await warmUp.focus();
  await warmUp.press('ArrowRight');
  await expect(medium).toBeFocused();
  await expect(medium).toHaveAttribute('aria-checked', 'true');
  await medium.press('ArrowRight');
  await expect(pressure).toBeFocused();
  await expect(pressure).toHaveAttribute('aria-checked', 'true');

  await medium.click();
  const measureSelectionCircle = option => option.locator('.su-option-circle').evaluate(circle => {
    const button = circle.closest('.su-tgl');
    const circleBox = circle.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    return {
      circleWidth: circleBox.width,
      circleHeight: circleBox.height,
      buttonWidth: buttonBox.width,
      buttonHeight: buttonBox.height,
      horizontalInset: circleBox.left - buttonBox.left,
      verticalInset: circleBox.top - buttonBox.top,
    };
  });
  const expectCompactSelectionCircle = shape => {
    expect(shape.circleWidth).toBeLessThanOrEqual(248.5);
    expect(shape.circleWidth).toBeLessThan(shape.buttonWidth * 0.8);
    expect(shape.circleHeight).toBeLessThanOrEqual(64.5);
    expect(shape.horizontalInset).toBeGreaterThan(20);
    expect(shape.verticalInset).toBeGreaterThanOrEqual(3);
  };
  expectCompactSelectionCircle(await measureSelectionCircle(medium));

  const quick = page.getByRole('radiogroup', { name: 'Length' }).getByRole('radio', { name: /quick/i });
  await quick.click();
  expectCompactSelectionCircle(await measureSelectionCircle(quick));

  const focusNote = page.getByLabel('Focus note');
  await focusNote.focus();
  const focusTreatment = await focusNote.evaluate(element => {
    const styles = getComputedStyle(element);
    return {
      outlineStyle: styles.outlineStyle,
      outlineWidth: styles.outlineWidth,
      boxShadow: styles.boxShadow,
    };
  });
  expect(focusTreatment.outlineStyle).toBe('none');
  expect(focusTreatment.outlineWidth).toBe('0px');
  expect(focusTreatment.boxShadow).toContain('inset');
  await pressure.click();

  const advanced = page.locator('.su-runtime-disclosure');
  await advanced.locator('summary').click();
  const pressureMode = page.getByRole('switch', { name: /pressure mode/i });
  const interruptions = page.getByRole('switch', { name: /random interruptions/i });
  await expect(pressureMode).toHaveAttribute('aria-checked', 'false');
  await expect(interruptions).toHaveAttribute('aria-checked', 'false');
  const pressureSwitchShape = await pressureMode.evaluate(element => {
    const styles = getComputedStyle(element);
    const thumb = element.querySelector('.su-sw-th');
    const thumbStyles = getComputedStyle(thumb);
    return {
      height: element.getBoundingClientRect().height,
      radius: parseFloat(styles.borderTopLeftRadius),
      thumbWidth: thumb.getBoundingClientRect().width,
      thumbRadius: parseFloat(thumbStyles.borderTopLeftRadius),
    };
  });
  expect(pressureSwitchShape.radius).toBeGreaterThanOrEqual(pressureSwitchShape.height / 2);
  expect(pressureSwitchShape.thumbRadius).toBeGreaterThanOrEqual(pressureSwitchShape.thumbWidth / 2);

  await pressureMode.focus();
  await pressureMode.press('Space');
  await expect(pressureMode).toHaveAttribute('aria-checked', 'true');
  await expect(pressure).toBeDisabled();
  await expect(interruptions).toBeDisabled();
  await expect(interruptions).toHaveAttribute('aria-checked', 'true');

  await pressureMode.press('Space');
  await expect(pressureMode).toHaveAttribute('aria-checked', 'false');
  await expect(pressure).toBeEnabled();
  await expect(pressure).toHaveAttribute('aria-checked', 'true');
  await expect(interruptions).toBeEnabled();
  await expect(interruptions).toHaveAttribute('aria-checked', 'false');
});

test('model management returns to the same Step 4 draft without downloading an installed model', async ({ page, request }) => {
  let pullRequests = 0;
  const cleared = await request.delete('/api/sessions');
  expect(cleared.ok()).toBeTruthy();
  await mockReadyModelSetup(page);
  await mockReadySystemStatus(page, { recommendedHardware: false });
  await page.route('**/api/setup/pull', async route => {
    pullRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'An installed model must not be downloaded again.' }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /begin a session/i }).click();
  await openConditionsStep(page);
  await page.getByRole('radio', { name: /medium/i }).click();
  await page.getByRole('radio', { name: /standard/i }).click();
  await page.getByLabel('Focus note').fill('Preserve this Step 4 draft');

  const expectRestoredDraft = async () => {
    await expect(page.getByText('Set the conditions.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Target role')).toHaveValue('Product Designer');
    await expect(page.locator('#su-mods-grid .su-mod.sel')).toHaveCount(1);
    await expect(page.locator('#su-chars-grid .su-char.sel')).toHaveCount(3);
    await expect(page.getByRole('radio', { name: /medium/i })).toBeChecked();
    await expect(page.getByRole('radio', { name: /standard/i })).toBeChecked();
    await expect(page.getByLabel('Focus note')).toHaveValue('Preserve this Step 4 draft');
    await expect(page.locator('#su-p4 .su-tgl[class*="on-"] .su-option-circle')).toHaveCount(2);
    await expect(page.locator('#su-p4 .su-tgl.is-drawing')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /begin the rehearsal/i })).toBeEnabled();
  };

  const openModelManager = async () => {
    const advanced = page.locator('.su-runtime-disclosure');
    await advanced.locator('summary').click();
    await advanced.getByRole('button', { name: /manage ai models/i }).click();
    await expect(page.getByRole('heading', { name: /choose your interview coach/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /download .*gb/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /continue with qwen 2\.5 7b/i })).toBeVisible();
  };

  await openModelManager();
  await page.getByRole('button', { name: /back to setup/i }).click();
  await expectRestoredDraft();

  await openModelManager();
  await page.getByRole('button', { name: /continue with qwen 2\.5 7b/i }).click();
  await expectRestoredDraft();
  expect(pullRequests).toBe(0);
});

test('practice library reveals twelve more cards and moves focus to the first new card', async ({ page }) => {
  await mockReadyModelSetup(page);
  const questions = Array.from({ length: 30 }, (_, index) => ({
    id: `regression-question-${index + 1}`,
    category: index % 2 ? 'Technical' : 'Roleplay',
    text: `Regression question ${index + 1}`,
    difficulty: ['Easy', 'Medium', 'Hard'][index % 3],
    tags: ['Regression'],
    answer: `Coach note ${index + 1}`,
    is_seed: true,
  }));
  await page.route('**/api/questions', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ questions }),
    });
  });

  await page.goto('/');
  await page.evaluate(() => window.nav('questions'));
  await expect(page.locator('.qb-card')).toHaveCount(12);
  await expect(page.locator('.qb-count')).toContainText('30 cards filed · showing 12');

  const showMore = page.getByRole('button', { name: /show 12 more/i });
  await showMore.click();
  await expect(page.locator('.qb-card')).toHaveCount(24);
  await expect(page.locator('.qb-count')).toContainText('30 cards filed · showing 24');
  await expect(page.locator('[data-qb-visible-index="12"] .qb-open-note')).toBeFocused();

  await showMore.click();
  await expect(page.locator('.qb-card')).toHaveCount(30);
  await expect(page.locator('[data-qb-visible-index="24"] .qb-open-note')).toBeFocused();
  await expect(showMore).toBeHidden();
});

test('streaming model progress updates in place without stealing pause-button focus', async ({ page }) => {
  let selectedModel = 'qwen2.5:7b';
  await page.route('**/api/models', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ollama_connected: true,
        ollama_installed: true,
        available: [],
        catalog: MODEL_CATALOG.map(model => ({ ...model, installed: false })),
        selected_model: selectedModel,
        model_setup_completed: false,
        selected_ready: false,
        has_supported_model: false,
      }),
    });
  });
  await page.route('**/api/models/select', async route => {
    selectedModel = route.request().postDataJSON().model;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ selected_model: selectedModel }),
    });
  });
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.endsWith('/api/setup/pull')) return nativeFetch(input, init);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const timers = [
            setTimeout(() => controller.enqueue(encoder.encode('data: {"status":"downloading","percent":10,"completed":10,"total":100}\n\n')), 100),
            setTimeout(() => controller.enqueue(encoder.encode('data: {"status":"downloading","percent":55,"completed":55,"total":100}\n\n')), 600),
            setTimeout(() => controller.enqueue(encoder.encode('data: {"status":"complete","percent":100,"completed":100,"total":100}\n\n')), 1800),
            setTimeout(() => controller.close(), 1900),
          ];
          init.signal?.addEventListener('abort', () => {
            timers.forEach(clearTimeout);
            controller.error(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        },
      });
      return Promise.resolve(new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));
    };
  });

  await page.goto('/');
  await page.getByRole('button', { name: /download 4.7 gb/i }).click();
  const pause = page.getByRole('button', { name: /pause download/i });
  await expect(pause).toBeVisible();
  await pause.focus();
  await expect(pause).toBeFocused();
  await expect(page.getByRole('progressbar', { name: /model download/i })).toHaveAttribute('aria-valuenow', '55');
  await expect(pause).toBeFocused();
  await expect(page.locator('.mm-state-progress-copy')).toContainText('55%');
});

test('session archive keeps evaluator calibration inside the Advanced disclosure', async ({ page, request }) => {
  await mockReadyModelSetup(page);
  const cleared = await request.delete('/api/sessions');
  expect(cleared.ok()).toBeTruthy();
  await page.goto('/');
  await page.evaluate(() => window.nav('history'));
  await expect(page.locator('.hist-wrap')).toBeVisible();

  const advanced = page.locator('details.hist-advanced');
  const summary = advanced.locator('summary.hist-advanced-toggle');
  const calibration = advanced.getByRole('button', { name: /evaluator calibration/i });
  await expect(summary).toHaveText(/advanced/i);
  await expect(calibration).toBeHidden();
  await summary.click();
  await expect(calibration).toBeVisible();
  await expect(advanced.locator('.hist-advanced-menu > .hist-advanced-action')).toHaveCount(1);
});

test('opening a saved session resets the report to its masthead', async ({ page, request }) => {
  await mockReadyModelSetup(page);
  const cleared = await request.delete('/api/sessions');
  expect(cleared.ok()).toBeTruthy();

  await page.goto('/');
  await page.evaluate(() => window.loadDemoReport());
  await expect(page.locator('.rpt-wrap')).toBeVisible();
  await page.evaluate(() => window.nav('history'));

  const session = page.locator('.hist-sess').first();
  await expect(session).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await session.click();

  await expect(page.locator('.sr-top')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
});
