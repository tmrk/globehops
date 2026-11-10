import { test, expect } from './fixtures.ts';

test('the planner hands over a prompt that turns a booking into a link', async ({
  page,
  isMobile,
  browserName,
}, info) => {
  await page.goto('./');
  if (isMobile) await page.getByRole('button', { name: 'Show a flight' }).click();
  await page.getByRole('button', { name: /Map your booking with AI/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Map your booking with AI' });
  await expect(dialog).toBeVisible();
  const prompt = dialog.locator('code');
  await expect(prompt).toHaveText(
    'Turn the flights in my attached booking into a GlobeHops link, following https://globehops.marki.im/llms.txt. Reply with only the link.',
  );
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await dialog.getByRole('button', { name: 'Copy prompt' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  if (browserName === 'chromium')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await prompt.textContent());
  await page.screenshot({ path: `test-results/ai-import-${info.project.name}.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
