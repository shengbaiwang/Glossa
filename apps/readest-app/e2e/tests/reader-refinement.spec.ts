import { expect, test } from '../fixtures/base';

test.describe('Glossa reading controls', () => {
  test('keeps selection preferences in the menu and shows an enabled action in the toolbar', async ({
    page,
    openBook,
  }) => {
    const reader = await openBook();
    await reader.revealHeader();
    await reader.headerBar.getByRole('button', { name: 'View Options' }).click();
    await page.getByRole('button', { name: 'Selection Actions' }).click();
    await page.getByRole('menuitem', { name: 'Instant Highlight', exact: true }).click();
    await reader.revealHeader();
    const activeAction = reader.headerBar.getByRole('button', {
      name: 'Instant Highlight',
      exact: true,
    });
    await expect(activeAction).toBeVisible();
    await activeAction.click();
    await page.getByRole('menuitem', { name: 'Instant Highlight', exact: true }).click();
    await expect(activeAction).toHaveCount(0);
    await reader.revealHeader();
    await reader.headerBar.getByRole('button', { name: 'View Options' }).click();
    await page.getByRole('menuitem', { name: 'Close Book', exact: true }).click();
    await expect(page).toHaveURL(/library/);
  });

  test('places destinations beside their content and supports keyboard switching', async ({
    page,
    openBook,
  }) => {
    const reader = await openBook();
    await reader.openSidebar();
    const tabs = reader.sidebar.getByRole('tablist');
    const panel = reader.sidebar.getByRole('tabpanel');
    expect((await tabs.boundingBox())!.y).toBeLessThan((await panel.boundingBox())!.y);
    const contents = tabs.getByRole('tab', { name: 'Contents', exact: true });
    await contents.focus();
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: 'Bookmarks', exact: true })).toBeFocused();
    await expect(tabs.getByRole('tab', { name: 'Bookmarks', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await panel.getByRole('button', { name: 'Bookmark This Page' }).click();
    await expect(reader.sidebar.locator('.booknote-item')).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await tabs.getByRole('tab', { name: 'Bookmarks', exact: true }).click();
    await expect(reader.sidebar).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test('previews a progress drag before navigating and can cancel it', async ({
    page,
    openBook,
  }) => {
    const reader = await openBook();
    await reader.revealFooter();
    const slider = reader.footerBar.getByRole('slider', { name: 'Reading Progress' });
    const start = await reader.readingProgress();
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2, { steps: 8 });
    expect(await reader.readingProgress()).toBe(start);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await reader.readingProgress()).toBe(start);
    await reader.revealFooter();
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
    expect(await reader.readingProgress()).toBe(start);
    await page.mouse.up();
    await expect.poll(() => reader.readingProgress()).toBeGreaterThan(start + 10);
  });
});

test('keeps the reading surface usable in light, dark and compact layouts', async ({
  page,
  openBook,
}, testInfo) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  const reader = await openBook();
  await reader.openTocChapter(6);
  await reader.waitForFonts();
  await expect.poll(() => reader.readingProgress()).toBeGreaterThan(1);
  await reader.openSidebar();
  await reader.sidebar.getByRole('tab', { name: 'Bookmarks', exact: true }).click();
  await reader.revealHeader();
  await expect(reader.headerBar).toHaveCSS('opacity', '1');
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('reader-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark$/);
  await reader.revealHeader();
  await expect(reader.headerBar).toHaveCSS('opacity', '1');
  await reader.waitForFonts();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('reader-dark.png') });
  for (const width of [760, 640]) {
    await page.setViewportSize({ width, height: 900 });
    const navigation = reader.footerBar.locator('.glossa-reader-navigation');
    const outer = (await navigation.boundingBox())!;
    const controls = await navigation
      .locator('button:visible, .glossa-reader-page-input:visible, input[type=range]:visible')
      .all();
    const boxes = (await Promise.all(controls.map((control) => control.boundingBox())))
      .filter((box) => box !== null)
      .sort((a, b) => a.x - b.x);
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index]!;
      expect(box.x).toBeGreaterThanOrEqual(outer.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
      if (index)
        expect(box.x).toBeGreaterThanOrEqual(boxes[index - 1]!.x + boxes[index - 1]!.width - 1);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(reader.sidebar).toBeVisible();
  const tabs = reader.sidebar.getByRole('tablist');
  const bounds = (await tabs.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('reader-mobile.png') });
  await reader.sidebar.getByRole('tab', { name: 'Contents', exact: true }).click();
  await expect(reader.tocItems.first()).toBeVisible();
});

test('keeps monochrome focus and navigation legible in E-Ink Mode', async ({
  page,
  openBook,
}, testInfo) => {
  const reader = await openBook();
  await reader.revealHeader();
  await reader.headerBar.getByRole('button', { name: 'Font & Layout' }).click();
  await page.locator('[data-tab="Control"]').click();
  await page.locator('[data-setting-id="settings.control.einkMode"] input').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-eink', 'true');
  await reader.openTocChapter(6);
  await reader.waitForFonts();
  await reader.openSidebar();
  await reader.sidebar.getByRole('tab', { name: 'Bookmarks', exact: true }).click();
  const bookmark = reader.sidebar.getByRole('button', { name: 'Bookmark This Page' });
  await expect(bookmark).toHaveCSS('border-top-width', '1px');
  await bookmark.focus();
  // Programmatic focus after a mouse click is intentionally not :focus-visible.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(bookmark).toBeFocused();
  await expect(bookmark).toHaveCSS('outline-style', 'solid');
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('reader-eink.png') });
});
