const { test, expect } = require('@playwright/test');

const readyModels = {
  ollama_connected: true,
  ollama_installed: true,
  available: ['qwen2.5:7b'],
  catalog: [{
    id: 'qwen2.5:7b',
    name: 'Qwen 2.5 7B',
    size_gb: 4.7,
    badge: 'Most reliable',
    description: 'Fully tested.',
    speed: 'Balanced',
    certified: true,
    experimental: false,
    installed: true,
  }],
  selected_model: 'qwen2.5:7b',
  model_setup_completed: true,
  selected_ready: true,
  has_supported_model: true,
};

async function mockReadyModelSetup(page, delayMs = 0) {
  await page.route('**/api/models', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(readyModels),
    });
  });
}

test.describe('normal-motion opening', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('reveals the ready app through one complete shared C-stroke lockup', async ({ page }) => {
    await mockReadyModelSetup(page);
    await page.goto('/');

    const opening = page.locator('.mm-opening');
    await expect(opening).toBeVisible();
    await expect(opening.locator('#mm-opening-lockup-geometry')).toHaveCount(1);
    await expect(opening.locator('.mm-opening-visible-lockup')).toHaveCount(1);
    await expect(opening.locator('.mm-opening-visible-mark-details')).toHaveCount(1);
    await expect(opening.locator('.mm-opening-visible-mark-details')).toHaveAttribute(
      'href',
      '/static/assets/brand/interview-chameleon-mark.png',
    );
    await expect(opening.locator('.mm-opening-mask-reference')).toHaveCount(1);
    await expect(opening.locator('.mm-opening-geometry-wordmark')).toHaveCount(1);
    await expect(opening.locator('circle')).toHaveCount(0);
    await expect(opening.locator('[class*="tunnel-solid"], [class*="tunnel-cutout"]')).toHaveCount(0);

    await expect(opening).toHaveAttribute('data-opening-phase', 'hold', { timeout: 3_000 });
    await expect(opening).toHaveAttribute('data-opening-phase', 'tunnel', { timeout: 3_000 });

    const tunnel = await opening.evaluate(element => {
      const effects = element.getAnimations({ subtree: true })
        .map(animation => ({
          target: animation.effect?.target?.getAttribute?.('class') || '',
          duration: animation.effect?.getTiming?.().duration || 0,
          frames: animation.effect?.getKeyframes?.().length || 0,
          keyframes: animation.effect?.getKeyframes?.() || [],
        }))
        .filter(effect => effect.duration === 3000);
      const visible = element.querySelector('.mm-opening-visible-lockup');
      const mask = element.querySelector('.mm-opening-mask-reference');
      const markDetails = element.querySelector('.mm-opening-visible-mark-details');
      const markAlpha = element.querySelector('.mm-opening-mark-alpha-image');
      return {
        effects,
        finalScale: Number(element.dataset.openingFinalScale),
        visibleOrigin: visible.style.transformOrigin,
        maskOrigin: mask.style.transformOrigin,
        markDetails: {
          width: Number(markDetails.getAttribute('width')),
          height: Number(markDetails.getAttribute('height')),
          x: Number(markDetails.getAttribute('x')),
          y: Number(markDetails.getAttribute('y')),
        },
        markAlpha: {
          width: Number(markAlpha.getAttribute('width')),
          height: Number(markAlpha.getAttribute('height')),
          x: Number(markAlpha.getAttribute('x')),
          y: Number(markAlpha.getAttribute('y')),
        },
        destinationChildren: document.querySelector('#main-content')?.childElementCount || 0,
      };
    });
    expect(tunnel.effects).toHaveLength(3);
    expect(tunnel.effects.map(effect => effect.target).sort()).toEqual([
      'mm-opening-mask-reference',
      'mm-opening-tunnel-surface',
      'mm-opening-visible-lockup',
    ]);
    const visibleEffect = tunnel.effects.find(effect => effect.target === 'mm-opening-visible-lockup');
    const maskEffect = tunnel.effects.find(effect => effect.target === 'mm-opening-mask-reference');
    const surfaceEffect = tunnel.effects.find(effect => effect.target === 'mm-opening-tunnel-surface');
    expect(visibleEffect.frames).toBeGreaterThanOrEqual(61);
    expect(maskEffect.frames).toBeGreaterThanOrEqual(61);
    expect(surfaceEffect.frames).toBe(4);
    expect(visibleEffect.keyframes.find(frame => frame.offset >= .14)?.opacity).toBe('0');
    expect(maskEffect.keyframes.find(frame => frame.offset >= .14)?.opacity).toBe('1');
    expect(surfaceEffect.keyframes.at(-1)?.opacity).toBe('0');
    expect(tunnel.finalScale).toBeGreaterThan(50);
    expect(tunnel.visibleOrigin).toBe(tunnel.maskOrigin);
    expect(tunnel.markDetails).toEqual(tunnel.markAlpha);
    expect(tunnel.markDetails.width).toBeGreaterThan(100);
    expect(tunnel.markDetails.height).toBe(tunnel.markDetails.width);
    expect(tunnel.destinationChildren).toBeGreaterThan(0);

    await expect(opening).toHaveCount(0, { timeout: 4_000 });
    await expect(page.locator('#main-content')).not.toHaveAttribute('inert', '');
    await expect(page.locator('html')).not.toHaveClass(/ic-opening/);
    await expect(page.getByRole('heading', { name: /walk into your next interview ready/i })).toBeVisible();
  });

  test('waits for the chameleon mask before revealing the lockup', async ({ page }) => {
    await mockReadyModelSetup(page);
    let releaseMark;
    const markReleased = new Promise(resolve => { releaseMark = resolve; });
    await page.route('**/static/assets/brand/interview-chameleon-mark.png', async route => {
      await markReleased;
      await route.continue();
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const opening = page.locator('.mm-opening');
    await expect(opening).toHaveAttribute('data-opening-phase', 'preparing');
    await page.waitForTimeout(200);
    await expect(opening).toHaveAttribute('data-opening-phase', 'preparing');

    releaseMark();
    await expect(opening).toHaveAttribute('data-opening-phase', 'reveal', { timeout: 2_000 });
    await expect(opening).toHaveCount(0, { timeout: 7_000 });
  });
});

test.describe('reduced-motion opening', () => {
  test.use({ reducedMotion: 'reduce' });

  test('keeps the brand static and exits with a short fade', async ({ page }) => {
    await mockReadyModelSetup(page, 450);
    await page.goto('/');

    const opening = page.locator('.mm-opening');
    await expect(opening).toBeVisible();
    await expect(opening).toHaveAttribute('data-opening-phase', 'reduced-motion');
    await expect(opening.locator('.mm-opening-visible-lockup')).toHaveCSS('opacity', '1');
    await expect(opening.locator('circle')).toHaveCount(0);

    await expect(opening).toHaveCount(0, { timeout: 1_500 });
    await expect(page.getByRole('heading', { name: /walk into your next interview ready/i })).toBeVisible();
  });
});
