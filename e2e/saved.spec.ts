import type { Locator } from '@playwright/test';
import { test, expect, airportField, expectRoute, startEditing, stopButtons } from './fixtures.ts';

async function paste(field: Locator, text: string) {
  await field.evaluate((target, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', value);
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
}

test.describe('saved trips', () => {
  test('save, reopen, keep edits, remove and undo', async ({ page }) => {
    await page.goto('./?route=CPH-LHR-JFK&dep1=2026-11-20T08:15');
    const save = page.getByRole('button', { name: 'Save trip', exact: true });
    const savedButton = page.getByRole('banner').getByRole('button', { name: 'Saved trips', exact: true });
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await expect(savedButton).toBeVisible();

    await page.getByRole('button', { name: 'Reset journey', exact: true }).click();
    await page
      .getByRole('group', { name: /^Reset the journey\?/ })
      .getByRole('button', { name: 'Reset', exact: true })
      .click();
    await expect(airportField(page)).toBeVisible();
    await airportField(page).press('Escape');
    const inline = page.getByRole('list', { name: 'Saved trips', exact: true });
    await expect(inline).toContainText('CPH → LHR → JFK');
    await inline.getByRole('button', { name: /CPH → LHR → JFK/ }).click();
    await expect(stopButtons(page)).toHaveCount(3);
    await expect(page).toHaveURL(/route=CPH-LHR-JFK&dep1=2026-11-20T08:15/);
    await expect(save).toHaveAttribute('aria-pressed', 'true');

    await startEditing(page);
    await page.getByRole('button', { name: 'Remove London', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(stopButtons(page)).toHaveCount(2);
    await expect(page).toHaveURL(/route=CPH-JFK&dep1=2026-11-20T08:15/);
    await page.screenshot({ path: 'test-results/saved-edited-desktop.png', animations: 'disabled' });
    await savedButton.click();
    const dialog = page.getByRole('dialog', { name: 'Saved trips', exact: true });
    const row = dialog.getByRole('list', { name: 'Saved trips', exact: true });
    await expect(row).toContainText('CPH → JFK');
    await expect(row).not.toContainText('LHR');
    await expect(row.getByRole('button', { name: /CPH → JFK/ }).first()).toHaveAttribute('aria-current', 'true');
    await page.screenshot({ path: 'test-results/saved-dialog-desktop.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/saved-dialog-phone.png', animations: 'disabled' });

    await dialog.getByRole('button', { name: 'Remove CPH → JFK', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Remove CPH → JFK', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Remove CPH → JFK', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
  });

  test('paste links in saved trips, import, airport search and the page; receive shares', async ({ page }) => {
    await page.goto('./?route=CPH-LHR');
    await page.getByRole('button', { name: 'Save trip', exact: true }).click();
    await page.getByRole('banner').getByRole('button', { name: 'Saved trips', exact: true }).click();
    const saved = page.getByRole('dialog', { name: 'Saved trips', exact: true });
    await paste(
      saved.getByLabel('Open a GlobeHops link', { exact: true }),
      'https://globehops.marki.im/?route=JFK-LAX',
    );
    await expect(saved).toBeHidden();
    await expectRoute(page, ['JFK', 'LAX']);
    await expect(page.getByRole('button', { name: 'Save trip', exact: true })).toHaveAttribute('aria-pressed', 'false');

    await page.getByRole('button', { name: 'Import a flight path', exact: true }).click();
    const importer = page.getByRole('dialog', { name: 'Import a flight path', exact: true });
    await importer
      .getByLabel('Or paste a path, a route or a GlobeHops link', { exact: true })
      .fill('https://globehops.marki.im/?route=BUD-ARN');
    await importer.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(importer).toBeHidden();
    await expectRoute(page, ['BUD', 'ARN']);

    await stopButtons(page).first().click();
    await expect(airportField(page)).toBeFocused();
    await page.screenshot({ path: 'test-results/saved-picker-desktop.png', animations: 'disabled' });
    await paste(airportField(page), 'https://globehops.marki.im/?route=CPH-JFK');
    await expect(airportField(page)).toHaveCount(0);
    await expectRoute(page, ['CPH', 'JFK']);

    await page.setViewportSize({ width: 390, height: 844 });
    await stopButtons(page).first().click();
    await expect(airportField(page)).toBeFocused();
    await page.screenshot({ path: 'test-results/saved-picker-phone.png', animations: 'disabled' });
    await paste(airportField(page), 'https://globehops.marki.im/?route=LHR-SIN');
    await expect(airportField(page)).toHaveCount(0);
    await expectRoute(page, ['LHR', 'SIN']);
    await page.screenshot({ path: 'test-results/saved-edited-phone.png', animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await paste(page.locator('body'), 'https://globehops.marki.im/?route=ARN-CPH');
    await expectRoute(page, ['ARN', 'CPH']);

    // The installed-app handoff reads non-link text once import context is ready.
    await page.goto('./?share-text=EGLL%20DCT%20KJFK');
    await expect(importer.getByRole('list', { name: 'Flights found' })).toContainText('LHR → JFK');
    await importer.getByRole('button', { name: 'Close', exact: true }).click();
    await page.goto('./?share-text=');
    await expect(page.getByText('Nothing to show from what was shared.', { exact: true })).toBeVisible();
  });

  test('keeps the saved bookmark and trip after reload', async ({ page }) => {
    await page.goto('./?route=CPH-LHR-JFK&dep1=2026-11-20T08:15');
    const save = page.getByRole('button', { name: 'Save trip', exact: true });
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('banner').getByRole('button', { name: 'Saved trips', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Saved trips', exact: true });
    await expect(dialog.getByRole('list', { name: 'Saved trips', exact: true })).toContainText('CPH → LHR → JFK');
    await expect(dialog.getByRole('button', { name: /CPH → LHR → JFK/ }).first()).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});
