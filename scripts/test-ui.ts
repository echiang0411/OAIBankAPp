import { chromium, type Page } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const folder = mkdtempSync(join(tmpdir(), 'harbor-ui-'));
const env = { ...process.env, APP_MODE: 'mock', PORT: '3033', DATABASE_PATH: join(folder, 'ui.sqlite') };
const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const url = 'http://127.0.0.1:3033';
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;
mkdirSync('artifacts', { recursive: true });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${url}/api/health`)).ok) { ready = true; break; } } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Test server starts');
  browser = await chromium.launch();
  for (const [locale, expected] of [['es-MX', 'es'], ['ar-EG', 'ar'], ['zh-HK', 'zh-TW'], ['zh-CN', 'zh-CN'], ['fr-FR', 'en']]) {
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
    const localePage = await context.newPage();
    await localePage.goto(url);
    await localePage.locator('#language').waitFor();
    assert.equal(await localePage.locator('#language').inputValue(), 'auto');
    assert.equal(await localePage.locator('.customer-view').getAttribute('lang'), expected);
    assert.equal(await localePage.locator('.customer-view').getAttribute('dir'), expected === 'ar' ? 'rtl' : 'ltr');
    assert.equal(await localePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const box = await localePage.locator('#language').boundingBox();
    assert.ok(box && box.y + box.height < 844 && box.height >= 44);
    await localePage.locator('#language').selectOption('es');
    await localePage.reload();
    assert.equal(await localePage.locator('#language').inputValue(), 'es');
    await localePage.locator('#language').selectOption('auto');
    assert.equal(await localePage.locator('.customer-view').getAttribute('lang'), expected);
    if (expected === 'ar') {
      await localePage.locator('.sample-buttons button').first().click();
      await localePage.locator('.image-preview').waitFor();
      await localePage.locator('.check-button').click();
      await localePage.locator('.result-panel.danger').waitFor();
      await localePage.locator('.exposure-options button').nth(1).click();
      await localePage.locator('.freeze-button').first().click();
      await localePage.locator('dialog[open]').waitFor();
      assert.equal(await localePage.locator('dialog').evaluate(el => getComputedStyle(el).direction), 'rtl');
      await localePage.locator('dialog .secondary-button').click();
      await localePage.setViewportSize({ width: 320, height: 844 });
      assert.equal(await localePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await localePage.screenshot({ path: 'artifacts/arabic-mobile.png', fullPage: true });
    }
    await context.close();
  }
  // Locale checks use the shared test database; remove their unreviewed checks before the workflow assertions.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(env.DATABASE_PATH);
  db.exec('DELETE FROM checks');
  db.close();
  console.log('PASS: browser defaults, locale fallback, persistent overrides, visible dropdown, Arabic layout and confirmation.');
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('heading', { name: 'Check a suspicious message' }).waitFor();
  await page.screenshot({ path: 'artifacts/customer-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'UPS delivery fee' }).click();
  await page.getByAltText('Selected message screenshot').waitFor();
  await page.getByRole('button', { name: 'Check this message' }).click();
  await page.getByRole('heading', { name: 'This looks like a scam' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Freeze my card', exact: true }).count(), 0);
  assert.equal(await page.getByText('Was this right?', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'No, just checking', exact: true }).click();
  await page.getByText('Don’t tap the link.', { exact: true }).waitFor();
  await page.getByText('Delete the message.', { exact: true }).waitFor();
  await page.getByText('Block the sender.', { exact: true }).waitFor();
  assert.equal(await page.locator('.recovery-actions').count(), 0);
  await page.getByRole('button', { name: 'I entered card details', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Reset my password', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Freeze my card', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.locator('.action-completed').count(), 0);
  for (const action of ['Freeze my card', 'Order a replacement card']) {
    await page.getByRole('button', { name: action, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByText(`${action}: Completed in this demo only`, { exact: true }).waitFor();
  }
  await page.getByRole('button', { name: 'I entered my password', exact: true }).click();
  for (const action of ['Reset my password', 'Sign out other devices']) {
    await page.getByRole('button', { name: action, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByText(`${action}: Completed in this demo only`, { exact: true }).waitFor();
  }
  assert.equal(await page.locator('.result-cost').count(), 0);
  assert.equal(await page.locator('.result-panel').getByText(/API cost|Model-reported confidence|Model calls|gpt-6-/).count(), 0);
  await page.getByText('How this was checked', { exact: true }).click();
  await page.getByText('https://ups-redelivery-fee.example/pay', { exact: true }).waitFor();
  assert.equal(await page.locator('a[href*="ups-redelivery"]').count(), 0);
  await page.getByRole('button', { name: 'Report this scam', exact: true }).click();
  await page.getByText('A masked copy has been sent to our fraud team for review.', { exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/ups-result.png', fullPage: true });
  // A second distinct check/report contributes to campaign frequency, but not duplicate eval rows.
  await page.getByRole('button', { name: 'Check this message' }).click();
  await page.getByRole('button', { name: 'Report this scam', exact: true }).click();
  await page.getByText('A masked copy has been sent to our fraud team for review.', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Analyst view/ }).click();
  await page.locator('.review-card').first().waitFor();
  assert.equal(await page.getByTestId('eval-count').textContent(), '20');
  const diagnostics = page.locator('.internal-diagnostics');
  await diagnostics.getByRole('heading', { name: 'Developer diagnostics' }).waitFor();
  const diagnostic = diagnostics.locator('.diagnostic-check').first();
  await diagnostic.locator('.diagnostic-summary').getByText('Illustrative API cost', { exact: false }).waitFor();
  await diagnostic.getByText('How this was checked', { exact: true }).click();
  await diagnostic.getByText('Actual mock cost: $0', { exact: true }).waitFor();
  await diagnostic.getByText('Model-reported confidence', { exact: true }).waitFor();
  await diagnostic.locator('.call-row').first().waitFor();
  console.log('PASS: customer result excludes costs and model diagnostics; internal view retains per-check estimates and usage.');
  for (let i = 0; i < 2; i++) {
    const review = page.locator('.review-card').first();
    assert.equal(await review.getByRole('button', { name: 'Approve & add to eval set' }).isDisabled(), true);
    await review.getByLabel("Analyst's expected verdict").selectOption('scam');
    await review.getByRole('button', { name: 'Approve & add to eval set' }).click();
    await page.waitForFunction(count => document.querySelectorAll('.review-card').length === count, 1 - i);
  }
  assert.equal(await page.getByTestId('eval-count').textContent(), '21');
  await page.getByRole('button', { name: /Evaluation set/ }).click();
  const newestEval = page.locator('.eval-panel tbody tr').first();
  await newestEval.getByText('Analyst approved', { exact: true }).waitFor();
  assert.match(await newestEval.locator('time').getAttribute('datetime') ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.match(await newestEval.locator('time').innerText(), /\d{1,2}:\d{2}/);
  assert.equal(await page.locator('.eval-panel th[aria-sort="descending"]').textContent(), 'Added / updated');
  await page.screenshot({ path: 'artifacts/evaluation-newest-first.png', fullPage: true });
  await page.getByRole('button', { name: /Review queue/ }).click();
  console.log('PASS: newest analyst-approved eval is first with a visible local date and time.');
  await page.getByText('2 confirmed reports', { exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/analyst-campaigns.png', fullPage: true });
  console.log('PASS: conditional recovery actions, all four confirmations, report tagging, analyst-only labels, and confirmed campaign count.');

  await page.getByRole('button', { name: 'Customer view' }).click();
  await page.getByRole('button', { name: 'Bank fraud alert' }).click();
  await page.getByRole('button', { name: 'Check this message' }).click();
  await page.getByRole('heading', { name: 'This looks legitimate' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Report this scam', exact: true }).count(), 0);
  await page.getByRole('button', { name: /Analyst view/ }).click();
  await page.getByRole('button', { name: 'Weekly random sample', exact: true }).click();
  await page.getByText('Added 1 randomly selected checks to the review queue.').waitFor();
  await page.locator('.review-card').getByText('Random sample', { exact: true }).waitFor();
  await page.getByLabel("Analyst's expected verdict").selectOption('likely_legitimate');
  await page.getByRole('button', { name: 'Approve & add to eval set' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="eval-count"]')?.textContent === '22');
  await page.getByRole('button', { name: 'Weekly random sample', exact: true }).click();
  await page.getByText('This week’s random sample has already been collected.').waitFor();
  const replay = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/eval.ts', '--mock'], { env, encoding: 'utf8' });
  assert.match(replay, /Accuracy: 22\/22 \(100.0%\)/);
  assert.match(replay, /Analyst-reviewed random_sample examples: 1/);
  console.log('PASS: unreported legitimate checks can be sampled, weekly sampling is idempotent, and eval reads analyst-approved sources.');

  // Resolve an uncertain message in each supported language. The final analyst label differs from the mock verdict.
  for (const [lang, title, dismiss, verdict] of [
    ['en', 'Our fraud team reviewed your message', 'Dismiss notification', 'Final answer: Likely legitimate'],
    ['zh-TW', '防詐團隊已審查您的訊息', '關閉通知', '最終判定: 可能是正常訊息'],
    ['zh-CN', '反诈团队已审核您的消息', '关闭通知', '最终判定: 可能是正常消息'],
    ['es', 'Nuestro equipo de fraude revisó tu mensaje', 'Cerrar notificación', 'Respuesta final: Probablemente legítimo'],
    ['ar', 'راجع فريق مكافحة الاحتيال رسالتك', 'إغلاق الإشعار', 'النتيجة النهائية: سليمة على الأرجح'],
  ]) {
    await page.getByRole('button', { name: 'Customer view' }).click();
    await page.locator('#message').fill('Please call me about your account when you have a chance.');
    await page.locator('#language').selectOption(lang);
    await page.locator('.check-button').click();
    await page.locator('.result-panel.unclear').waitFor();
    assert.equal(await page.locator('.recovery-actions').count(), 0);
    await page.locator('.fraud-help button').click();
    await page.locator('.fraud-help [role="status"]').waitFor();
    await page.getByRole('button', { name: /Analyst view/ }).click();
    await page.locator('.review-card').getByText('Escalation', { exact: true }).waitFor();
    await page.getByLabel("Analyst's expected verdict").selectOption('likely_legitimate');
    await page.getByRole('button', { name: 'Approve & add to eval set' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.review-card').length === 0);
    await page.getByRole('button', { name: 'Customer view' }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.getByText(verdict, { exact: true }).waitFor();
    assert.ok((await page.locator('.resolution-notice').textContent())?.includes(lang === 'en' ? 'official app' : lang === 'zh-TW' ? '官方應用程式' : lang === 'es' ? 'aplicación oficial' : lang === 'ar' ? 'التطبيق الرسمي' : '官方应用'));
    await page.reload();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.screenshot({ path: `artifacts/notification-${lang}.png`, fullPage: true });
    await page.getByRole('button', { name: dismiss, exact: true }).click();
    await page.locator('.resolution-notice').waitFor({ state: 'detached' });
  }
  const report = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/eval.ts', '--mock'], { env, encoding: 'utf8' });
  assert.match(report, /Analyst-reviewed escalation examples: 5/);
  assert.match(report, /FAIL vague-en/);
  console.log('PASS: escalation resolution persists an analyst label and a localized final-answer notification in all five language choices.');

  await page.locator('#language').selectOption('en');
  await page.getByRole('button', { name: 'Hidden instructions', exact: true }).click();
  await page.getByRole('button', { name: 'Check this message' }).click();
  await page.getByRole('heading', { name: 'This looks like a scam' }).waitFor();
  await page.locator('.flags li').filter({ hasText: 'This message contains instructions trying to change the checker’s answer.' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/customer-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(errors, []);
  const forbidden = await fetch(`${url}/api/reports`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(forbidden.status, 403);
  console.log('PASS: injection flags, mobile layout, no browser errors, and cross-origin write rejection.');
} catch (error) {
  await page?.screenshot({ path: 'artifacts/ui-failure.png', fullPage: true });
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 2000); });
  rmSync(folder, { recursive: true, force: true });
}
