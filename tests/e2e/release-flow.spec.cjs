const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function expectNoSeriousAccessibilityViolations(page, label) {
  const results = await new AxeBuilder({ page })
    .include('#main-content')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(item => ['serious', 'critical'].includes(item.impact));
  expect(blocking, `${label} accessibility violations:\n${blocking.map(item => (
    `${item.id}: ${item.help} (${item.nodes.length} node${item.nodes.length === 1 ? '' : 's'})`
  )).join('\n')}`).toEqual([]);
}

async function mockReadyModelSetup(page) {
  await page.route('**/api/models', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ollama_connected: true,
        ollama_installed: true,
        available: ['qwen2.5:7b'],
        catalog: [
          { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', size_gb: 4.7, badge: 'Most reliable', description: 'Fully tested.', speed: 'Balanced', certified: true, experimental: false, installed: true },
          { id: 'qwen3.5:4b', name: 'Qwen 3.5 4B', size_gb: 3.4, badge: 'Smaller and faster', description: 'A lighter option.', speed: 'Fast', certified: false, experimental: false, installed: false },
          { id: 'granite3.3:8b', name: 'Granite 3.3 8B', size_gb: 4.9, badge: 'Structured feedback', description: 'Business interviews.', speed: 'Balanced', certified: false, experimental: false, installed: false },
          { id: 'phi4-mini-reasoning:3.8b', name: 'Phi-4 Mini Reasoning', size_gb: 3.2, badge: 'Deep reasoning', description: 'Technical questions and analysis.', speed: 'Thoughtful', certified: false, experimental: false, installed: false },
        ],
        selected_model: 'qwen2.5:7b',
        model_setup_completed: true,
        selected_ready: true,
        has_supported_model: true,
      }),
    });
  });
}

test('setup to saved report to history to focused rehearsal stays connected', async ({ page, request }) => {
  await mockReadyModelSetup(page);
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  const cleared = await request.delete('/api/sessions');
  expect(cleared.ok()).toBeTruthy();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /walk into your next interview ready/i })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, 'Home');

  await page.getByRole('button', { name: /begin a session/i }).click();
  await expect(page.locator('.su-wrap')).toBeVisible();
  await expect(page.getByText('Build the brief.', { exact: true })).toBeVisible();
  await page.locator('#su-role').fill('Product Manager');
  await expectNoSeriousAccessibilityViolations(page, 'Setup');

  await page.evaluate(() => window.nav('hero'));
  await page.evaluate(() => window.loadDemoReport());
  await expect(page.locator('.rpt-wrap')).toBeVisible();
  await expect(page.locator('.rpt-score-title')).toHaveText('Product Manager, AI Collaboration Tools');
  await expect(page.locator('.rpt-score-pct')).toHaveText('87%');
  await expectNoSeriousAccessibilityViolations(page, 'Report');

  await page.getByRole('button', { name: /session history/i }).click();
  await expect(page.locator('.hist-wrap')).toBeVisible();
  await expect(page.locator('.hist-role')).toContainText('Product Manager, AI Collaboration Tools');
  await expectNoSeriousAccessibilityViolations(page, 'History');

  await page.locator('.hist-sess').first().click();
  await expect(page.locator('.sr-wrap')).toBeVisible();
  await expect(page.locator('.sr-hero-role')).toHaveText('Product Manager, AI Collaboration Tools');
  await expect(page.locator('.sr-qa-item')).toHaveCount(5);
  await expectNoSeriousAccessibilityViolations(page, 'Saved session review');

  await page.getByRole('button', { name: /practice weak areas/i }).first().click();
  await expect(page.locator('.studio-session')).toBeVisible();
  await expect(page.locator('.studio-session__focus')).toBeVisible();
  await expect(page.locator('.studio-stage__corner-label')).toContainText(/adaptive practice/i);
  await expect(page.locator('.studio-session__focus')).toHaveAttribute(
    'title',
    /specificity|communication|evidence|structure/i,
  );
  await expectNoSeriousAccessibilityViolations(page, 'Focused rehearsal');

  const sessionsResponse = await request.get('/api/sessions');
  expect(sessionsResponse.ok()).toBeTruthy();
  const sessions = (await sessionsResponse.json()).sessions;
  expect(sessions.some(item => item.id === 'demo-v3-product-manager' && item.status === 'completed')).toBeTruthy();
  expect(sessions.some(item => item.status === 'in_progress' && (
    item.settings?.focus_context?.source_session_id === 'demo-v3-product-manager'
    || item.interview_plan?.adaptive_focus?.source_session_id === 'demo-v3-product-manager'
  ))).toBeTruthy();

  const expectedHeadlessCameraErrors = [
    /^Camera access denied: NotSupportedError: Not supported$/,
  ];
  const unexpectedConsoleErrors = consoleErrors.filter(message => (
    !expectedHeadlessCameraErrors.some(pattern => pattern.test(message))
  ));
  expect(unexpectedConsoleErrors).toEqual([]);
});

test('setup draws only the format and explicit Step 4 choices', async ({ page }) => {
  await mockReadyModelSetup(page);
  await page.goto('/');
  await page.getByRole('button', { name: /begin a session/i }).click();

  await page.locator('#su-role').fill('Product Designer');
  await page.getByRole('button', { name: /continue to format/i }).click();
  await page.locator('#su-mods-grid .su-mod').first().click();
  await expect(page.locator('.su-mod.sel .su-mod-circle')).toBeVisible();

  await page.getByRole('button', { name: /continue to interviewer/i }).click();
  await page.locator('#su-chars-grid .su-char').nth(6).click();
  await expect(page.locator('#su-chars-grid .su-char.sel')).toHaveCount(3);
  await expect(page.locator('#su-p3 .su-selection-circle')).toHaveCount(0);
  await expect(page.locator('.su-char-circle')).toHaveCount(0);
  await expect(page.locator('.su-char-ink')).toHaveCount(0);

  await page.getByRole('button', { name: /continue to conditions/i }).click();
  await expect(page.getByText('Set the conditions.', { exact: true })).toBeVisible();
  await expect(page.locator('#su-p4 [role="radio"][aria-checked="true"]')).toHaveCount(0);
  await expect(page.locator('#su-p4 .su-tgl[class*="on-"]')).toHaveCount(0);
  await expect(page.locator('#su-p4 .su-tgl[class*="on-"] .su-option-circle')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /begin the rehearsal/i })).toBeDisabled();
  await expect(page.locator('.su-option-check')).toHaveCount(0);

  await page.getByRole('radio', { name: /warm-up/i }).click();
  await expect(page.locator('#su-diff-grp .su-tgl.on-easy.is-drawing .su-option-circle')).toBeVisible();
  await expect(page.locator('#su-p4 [role="radio"][aria-checked="true"]')).toHaveCount(1);
  await expect(page.locator('#su-p4 .su-tgl[class*="on-"] .su-option-circle')).toHaveCount(1);

  await page.getByRole('radio', { name: /standard/i }).click();
  await expect(page.locator('#su-dur-grp .su-tgl.on-amb.is-drawing .su-option-circle')).toBeVisible();
  await expect(page.locator('#su-p4 [role="radio"][aria-checked="true"]')).toHaveCount(2);
  await expect(page.locator('#su-p4 .su-tgl[class*="on-"] .su-option-circle')).toHaveCount(2);
  await expectNoSeriousAccessibilityViolations(page, 'Unified setup selections');
});

test('question library, progress, portfolio, and training floor meet the accessibility gate', async ({ page, request }) => {
  await mockReadyModelSetup(page);
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  const cleared = await request.delete('/api/sessions');
  expect(cleared.ok()).toBeTruthy();
  await page.goto('/');
  const views = [
    { route: 'questions', selector: '.qb-wrap', ready: '.qb-open-note', label: 'Question library' },
    { route: 'achievements', selector: '.ach-wrap', label: 'Progress' },
    { route: 'portfolio', selector: '.ptf-wrap', label: 'Portfolio' },
    { route: 'games', selector: '.mg-wrap', label: 'Training floor' },
    { route: 'calibration', selector: '.calibration-page', label: 'Evaluator calibration' },
  ];
  for (const view of views) {
    await page.evaluate(route => window.nav(route), view.route);
    await expect(page.locator(view.selector)).toBeVisible();
    if (view.ready) await expect(page.locator(view.ready).first()).toHaveText(/\S/);
    await expectNoSeriousAccessibilityViolations(page, view.label);
  }

  expect(consoleErrors).toEqual([]);
});

test('filed practice cards survive loss of browser-origin storage', async ({ page, request }) => {
  await mockReadyModelSetup(page);
  const cleared = await request.put('/api/preferences', {
    data: { question_favorites: [] },
  });
  expect(cleared.ok()).toBeTruthy();

  await page.goto('/');
  await page.evaluate(() => window.nav('questions'));
  const firstCard = page.locator('.qb-card').first();
  const keepButton = firstCard.locator('.qb-fav');
  await expect(keepButton).toContainText('Keep');
  await keepButton.click();
  await expect(keepButton).toContainText('Filed');

  await expect.poll(async () => {
    const response = await request.get('/api/preferences');
    const payload = await response.json();
    return payload.preferences.question_favorites.length;
  }).toBe(1);

  // The desktop host selects a new loopback port at each launch, which gives
  // WebView2 a new origin. Clearing origin-local state reproduces that boundary
  // while keeping the same isolated test backend alive.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => window.nav('questions'));
  await expect(page.locator('.qb-card').first().locator('.qb-fav')).toContainText('Filed');
});

test('first launch activates a preinstalled coach without downloading it again', async ({ page }) => {
  let setupCompleted = false;
  let selectRequests = 0;
  let pullRequests = 0;
  const installedModel = {
    id: 'qwen2.5:7b',
    name: 'Qwen 2.5 7B',
    size_gb: 4.7,
    badge: 'Most reliable',
    description: 'Fully tested for interviews and feedback.',
    speed: 'Balanced',
    certified: true,
    experimental: false,
    installed: true,
  };

  await page.route('**/api/models', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ollama_connected: true,
        ollama_installed: true,
        available: [installedModel.id],
        catalog: [installedModel],
        selected_model: installedModel.id,
        model_setup_completed: setupCompleted,
        selected_ready: setupCompleted,
        has_supported_model: true,
      }),
    });
  });
  await page.route('**/api/models/select', async route => {
    selectRequests += 1;
    setupCompleted = true;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        selected_model: installedModel.id,
        preferences: { selected_model: installedModel.id, model_setup_completed: true },
      }),
    });
  });
  await page.route('**/api/setup/pull', async route => {
    pullRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Preinstalled models must not be pulled.' }),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /choose your interview coach/i })).toBeVisible();
  await expect(page.getByText('Installed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /use this model/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /download .*gb/i })).toHaveCount(0);

  await page.getByRole('button', { name: /use this model/i }).click();
  await expect(page.getByRole('heading', { name: /your coach is ready/i })).toBeVisible();
  expect(selectRequests).toBe(1);
  expect(pullRequests).toBe(0);

  await page.getByRole('button', { name: /continue to practice/i }).click();
  await expect(page.getByRole('heading', { name: /walk into your next interview ready/i })).toBeVisible();
});

test('first launch supports downloading another coach after the first becomes ready', async ({ page }) => {
  let installed = false;
  let setupCompleted = false;
  let selectedModel = 'qwen2.5:7b';
  let finishDownload;
  const downloadMayFinish = new Promise(resolve => { finishDownload = resolve; });
  const catalog = [
    { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', size_gb: 4.7, badge: 'Most reliable', description: 'Fully tested for interviews and feedback.', speed: 'Balanced', certified: true, experimental: false },
    { id: 'qwen3.5:4b', name: 'Qwen 3.5 4B', size_gb: 3.4, badge: 'Smaller and faster', description: 'A lighter option.', speed: 'Fast', certified: false, experimental: false },
    { id: 'granite3.3:8b', name: 'Granite 3.3 8B', size_gb: 4.9, badge: 'Structured feedback', description: 'Business interviews.', speed: 'Balanced', certified: false, experimental: false },
    { id: 'phi4-mini-reasoning:3.8b', name: 'Phi-4 Mini Reasoning', size_gb: 3.2, badge: 'Deep reasoning', description: 'Technical questions and analysis.', speed: 'Thoughtful', certified: false, experimental: false },
  ];

  await page.route('**/api/models', async route => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ollama_connected: true,
          ollama_installed: true,
          available: installed ? [selectedModel] : [],
          catalog: catalog.map(model => ({ ...model, installed: installed && model.id === selectedModel })),
          selected_model: selectedModel,
          model_setup_completed: setupCompleted,
          selected_ready: installed && setupCompleted,
          has_supported_model: installed,
        }),
      });
    }
    return route.continue();
  });
  await page.route('**/api/models/select', async route => {
    selectedModel = route.request().postDataJSON().model;
    setupCompleted = true;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ selected_model: selectedModel, preferences: { selected_model: selectedModel, model_setup_completed: true } }),
    });
  });
  await page.route('**/api/setup/pull', async route => {
    selectedModel = route.request().postDataJSON().model;
    await downloadMayFinish;
    installed = true;
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ status: 'downloading', percent: 60, model: selectedModel })}\n\ndata: ${JSON.stringify({ status: 'complete', percent: 100, model: selectedModel })}\n\n`,
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /choose your interview coach/i }).first()).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await expect(page.getByRole('button', { name: /back to home/i })).toBeHidden();
  await expectNoSeriousAccessibilityViolations(page, 'First-run model choice');

  await page.getByRole('radio', { name: /qwen 3.5 4b/i }).click();
  await page.getByRole('button', { name: /download 3.4 gb/i }).click();
  await expect(page.getByRole('heading', { name: /downloading qwen 3.5 4b/i })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  finishDownload();
  await expect(page.getByRole('heading', { name: /your coach is ready/i })).toBeVisible();
  await expect(page.getByText('Qwen 3.5 4B is installed and ready to use.')).toBeVisible();
  await page.getByRole('button', { name: /choose a different coach/i }).click();
  await expect(page.getByRole('heading', { name: /choose your interview coach/i })).toBeVisible();
  await page.getByRole('radio', { name: /qwen 2.5 7b/i }).click();
  await page.getByRole('button', { name: /download 4.7 gb/i }).click();
  await expect(page.getByRole('heading', { name: /downloading qwen 2.5 7b/i })).toBeVisible();
  await expect(page.locator('.mm-step').nth(2)).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('heading', { name: /your coach is ready/i })).toBeVisible();
  await expect(page.getByText('Qwen 2.5 7B is installed and ready to use.')).toBeVisible();
  await page.getByRole('button', { name: /^continue/i }).click();
  await expect(page.getByRole('heading', { name: /walk into your next interview ready/i })).toBeVisible();
});

test('first launch offers the official download before Ollama is installed', async ({ page }) => {
  const catalog = [
    { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', size_gb: 4.7, badge: 'Most reliable', description: 'Fully tested for interviews and feedback.', speed: 'Balanced', certified: true, experimental: false },
    { id: 'qwen3.5:4b', name: 'Qwen 3.5 4B', size_gb: 3.4, badge: 'Smaller and faster', description: 'A lighter option.', speed: 'Fast', certified: false, experimental: false },
    { id: 'granite3.3:8b', name: 'Granite 3.3 8B', size_gb: 4.9, badge: 'Structured feedback', description: 'Business interviews.', speed: 'Balanced', certified: false, experimental: false },
    { id: 'phi4-mini-reasoning:3.8b', name: 'Phi-4 Mini Reasoning', size_gb: 3.2, badge: 'Deep reasoning', description: 'Technical questions and analysis.', speed: 'Thoughtful', certified: false, experimental: false },
  ];
  await page.route('**/api/models', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ollama_connected: false,
      ollama_installed: false,
      available: [],
      catalog: catalog.map(model => ({ ...model, installed: false })),
      selected_model: 'qwen2.5:7b',
      model_setup_completed: false,
      selected_ready: false,
      has_supported_model: false,
    }),
  }));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /install ollama/i })).toBeVisible();
  const setupSurface = await page.locator('.mm-window').boundingBox();
  const viewport = page.viewportSize();
  expect(setupSurface).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(setupSurface.x).toBe(0);
  expect(setupSurface.y).toBe(0);
  expect(setupSurface.width).toBe(viewport.width);
  expect(setupSurface.height).toBeGreaterThanOrEqual(viewport.height);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /choose your interview coach/i })).toHaveCount(0);
  await page.evaluate(() => {
    window.__ollamaDownloadUrl = '';
    window.open = url => { window.__ollamaDownloadUrl = url; return null; };
  });
  await page.getByRole('button', { name: /download ollama/i }).click();
  await expect.poll(() => page.evaluate(() => window.__ollamaDownloadUrl)).toBe('https://ollama.com/download/windows');
  await expect(page.getByText(/official ollama download page is opening/i)).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, 'Ollama installation setup');
});

test('first launch offers to open Ollama when it is installed but stopped', async ({ page }) => {
  await page.route('**/api/models', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ollama_connected: false,
      ollama_installed: true,
      available: [],
      catalog: [],
      selected_model: 'qwen2.5:7b',
      model_setup_completed: false,
      selected_ready: false,
      has_supported_model: false,
    }),
  }));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /open ollama/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /download ollama/i })).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByRole('button', { name: /open ollama/i }).click();
  await expect(page.getByText(/open ollama from the windows start menu/i)).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, 'Ollama installed but stopped setup');
});

test('an interrupted model download gets its own recovery screen', async ({ page }) => {
  const catalog = [
    { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', size_gb: 4.7, badge: 'Most reliable', description: 'Fully tested for interviews and feedback.', speed: 'Balanced', certified: true, experimental: false },
    { id: 'qwen3.5:4b', name: 'Qwen 3.5 4B', size_gb: 3.4, badge: 'Smaller and faster', description: 'A lighter option.', speed: 'Fast', certified: false, experimental: false },
    { id: 'granite3.3:8b', name: 'Granite 3.3 8B', size_gb: 4.9, badge: 'Structured feedback', description: 'Business interviews.', speed: 'Balanced', certified: false, experimental: false },
    { id: 'phi4-mini-reasoning:3.8b', name: 'Phi-4 Mini Reasoning', size_gb: 3.2, badge: 'Deep reasoning', description: 'Technical questions and analysis.', speed: 'Thoughtful', certified: false, experimental: false },
  ];
  await page.route('**/api/models', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ollama_connected: true,
      ollama_installed: true,
      available: [],
      catalog: catalog.map(model => ({ ...model, installed: false })),
      selected_model: 'qwen2.5:7b',
      model_setup_completed: false,
      selected_ready: false,
      has_supported_model: false,
    }),
  }));
  await page.route('**/api/setup/pull', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'The download connection stopped.' }),
  }));

  await page.goto('/');
  await page.getByRole('button', { name: /download 4.7 gb/i }).click();
  await expect(page.getByRole('heading', { name: /download paused/i })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^retry$/i })).toBeVisible();
  await page.getByRole('button', { name: /choose another coach/i }).click();
  await expect(page.getByRole('heading', { name: /choose your interview coach/i })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await expectNoSeriousAccessibilityViolations(page, 'Interrupted download recovery');
});
