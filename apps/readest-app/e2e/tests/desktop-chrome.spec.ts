import { expect, test } from '../fixtures/base';
import { LibraryPage } from '../pages/LibraryPage';
import { SAMPLE_EPUB } from '../fixtures/books';

test.describe('Desktop library chrome', () => {
  test('navigates categories and collapses the sidebar without losing the book', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1180, height: 780 });
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(SAMPLE_EPUB);
    await expect(library.bookCards()).toHaveCount(1);
    const navigation = page.getByRole('navigation', { name: 'Library', exact: true });
    await navigation.getByRole('button', { name: 'Authors', exact: true }).click();
    await expect(page).toHaveURL(/groupBy=author/);
    await expect(navigation.getByRole('button', { name: 'Authors' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await navigation.getByRole('button', { name: 'Books', exact: true }).click();
    await expect(library.bookCards()).toHaveCount(1);
    const toggle = page.getByRole('button', { name: 'Toggle Sidebar', exact: true });
    await toggle.click();
    await expect(navigation).not.toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(navigation).toBeVisible();
    await expect(library.bookCards()).toHaveCount(1);
    await library.openFirstBook();
    await expect(page).toHaveURL(/reader/);
  });

  test('focuses library search with the standard find shortcut', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await page.keyboard.press('ControlOrMeta+f');
    await expect(library.searchInput).toBeFocused();
    await page.keyboard.type('quiet');
    await expect(library.searchInput).toHaveValue('quiet');
    await library.clearSearchButton.click();
    await expect(library.searchInput).toHaveValue('');
  });

  test('keeps the toolbar usable in compact, desktop and RTL layouts', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    for (const width of [390, 899, 900, 1180]) {
      await page.setViewportSize({ width, height: 780 });
      await expect(library.searchInput).toBeVisible();
      const navigation = page.getByRole('navigation', { name: 'Library', exact: true });
      if (width < 900) await expect(navigation).not.toBeVisible();
      else await expect(navigation).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const search = await library.searchInput.boundingBox();
      expect(search!.width).toBeGreaterThan(70);
      expect(search!.x + search!.width).toBeLessThanOrEqual(width);
    }
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
    });
    const sidebar = await page.locator('#library-navigation').boundingBox();
    expect(sidebar!.x).toBeGreaterThan(800);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
});
