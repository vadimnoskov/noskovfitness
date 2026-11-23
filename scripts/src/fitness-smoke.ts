import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Read-only by default. The optional fixture journey refuses to run on family data.
const base = 'http://localhost:80';
const fixtures = process.argv.includes('--fixtures');
const out = new URL('../../generated-artifacts/fitness-checks/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
});
try {
  if (fixtures) {
    const data = await (await page.request.get(`${base}/api/fitness/pages?screen=program`)).json();
    assert.equal(data.group?.name, 'Migration verification (temporary)', 'Refusing to mutate real family data');
    await page.goto(`${base}/program?from=2099-01-05&weeks=1`);
    await page.getByRole('button', { name: 'Propose workouts', exact: true }).click();
    await page.locator('.day.proposed').first().waitFor();
    const first = page.locator('.day.proposed').first();
    const date = await first.locator('header b').innerText();
    await first.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.locator('.day.approved').first().waitFor();
    assert.match(await page.locator('.day.approved header b').first().innerText(), new RegExp(date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Re-plan proposed days', exact: true }).click()]);
    await page.locator('.day.approved').first().waitFor();
    await page.screenshot({ path: new URL('program.jpg', out).pathname });
    const alternate = page.locator('.day.proposed').first();
    if (await alternate.count()) {
      await alternate.locator('summary').click();
      const use = alternate.getByRole('button', { name: 'Use this', exact: true }).first();
      if (await use.count()) {
        await Promise.all([page.waitForEvent('load'), use.click()]);
        await page.getByText('your choice', { exact: false }).first().waitFor();
      }
    }
    await page.goto(`${base}/settings`);
    const days = page.locator('input[name="windowDays"]');
    await days.waitFor();
    const defaultWindow = await days.inputValue();
    await days.fill('53');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByText('Saved. New proposals', { exact: false }).waitFor();
    assert.equal(await days.inputValue(), '53');
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reset targets', exact: false }).click()]);
    await days.waitFor();
    assert.equal(await days.inputValue(), defaultWindow, 'Reset must reinitialize input values');
    await page.screenshot({ path: new URL('settings.jpg', out).pathname });
  }
  await page.goto(`${base}/`);
  await page.locator('.datebar').waitFor(); // home is Today
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.getByRole('heading', { name: 'My history', exact: true }).waitFor();
  await page.goto(`${base}/calendar`);
  await page.getByRole('heading', { name: 'Program calendar', exact: true }).waitFor();
  await page.locator('.yr').waitFor();
  await page.getByRole('link', { name: '8 weeks', exact: true }).click();
  await page.locator('.ew').waitFor();
  await page.getByRole('link', { name: 'Week', exact: true }).click();
  await page.locator('.week').waitFor();
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await page.locator('.week').waitFor();
  await page.getByRole('link', { name: 'Analysis', exact: true }).click();
  await page.getByRole('heading', { name: 'Programming analysis' }).waitFor();
  await page.getByRole('link', { name: 'Last 4 weeks' }).click();
  await page.locator('.heat').waitFor();
  await page.getByRole('link', { name: 'Benchmarks', exact: true }).click();
  await page.getByRole('heading', { name: 'The Girls', exact: false }).waitFor();
  await page.goto(`${base}/login`);
  await page.getByLabel('Your name').fill('nobody');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText("Name or password didn't match.", { exact: false }).waitFor();
  await page.screenshot({ path: new URL('login.jpg', out).pathname });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/calendar?view=week&d=2099-01-05`);
  await page.locator('.week').waitFor();
  assert.equal(await page.evaluate('document.documentElement.scrollWidth > window.innerWidth'), false, 'Page overflow outside scrollable calendar');
  await page.screenshot({ path: new URL('mobile-calendar.jpg', out).pathname });
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: Today, History, navigation, calendar views, analysis filters, benchmarks, sign-in rejection, and mobile layout.');
  if (fixtures) console.log('Fixture checks passed: propose, approve, preserve approval during re-plan, swap, save settings, and reset input values.');
} finally {
  await browser.close();
}
