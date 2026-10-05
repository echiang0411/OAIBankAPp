import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { openStore } from '../server/store.ts';
import type { CheckResponse } from '../shared/schema.ts';

const bytes = readFileSync(new URL('../public/demo/ups-message.png', import.meta.url));
const image = `data:image/png;base64,${bytes.toString('base64')}`;
function unreadable(): CheckResponse {
  return { id: randomUUID(), source: 'image', language: 'en', mode: 'live', redactedText: '[Unreadable screenshot]', links: [], extracted_links: [], calls: [], estimatedCost: 0, escalated: false, escalationReason: null, durationMs: 0,
    result: { verdict: 'unclear', confidence: 0, red_flags: [], impersonated_brand: null, recommended_action: 'Ask the bank.', explanation_in_user_language: 'Could not read this image.', escalate_to_human: true, injection_detected: false } };
}

test('readable and unreadable screenshots are withheld through storage, sampling and review', () => {
  const folder = mkdtempSync(join(tmpdir(), 'harbor-image-store-'));
  const path = join(folder, 'review.sqlite');
  let store = openStore(path);
  try {
    const evals = store.evals();
    for (const text of ['[Unreadable screenshot]', 'Name: Amina Hassan; harmless notice']) {
      const check = { ...unreadable(), redactedText: text };
      store.recordCheck(check, undefined, image);
      store.submit(check, 'escalation', image);
      assert.equal(store.diagnosticScreenshot(check.id), null);
    }
    assert.equal(store.historyCount(), 2);
    assert.equal(store.pending().length, 2);
    assert.ok(store.pending().every(item => item.hasScreenshot === false));
    for (const item of store.pending()) assert.equal(store.reviewScreenshot(item.id), null);
    assert.deepEqual(store.evals(), evals);
    store.close(); store = openStore(path);
    assert.ok(store.latestChecks().every(item => !item.hasScreenshot));
    assert.doesNotMatch(JSON.stringify(store.latestChecks()), /Amina|Hassan|data:image|iVBOR/);
    const db = new DatabaseSync(path);
    for (const table of ['review_screenshots', 'diagnostic_screenshots']) assert.equal((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
    db.close();
    const item = store.pending()[0];
    store.approve(item.id, 'unclear');
    assert.equal(store.notifications().length, 1);
    assert.equal(store.evals().length, 21);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('legacy image attachments are removed without replacing reviews, labels or notification history', () => {
  const folder = mkdtempSync(join(tmpdir(), 'harbor-image-migration-'));
  const path = join(folder, 'test.sqlite');
  let store = openStore(path);
  try {
    const check = unreadable();
    store.recordCheck(check); store.submit(check, 'escalation');
    const id = store.pending()[0].id;
    const before = { reviews: store.pending(), evals: store.evals(), notices: store.notifications() };
    store.close();
    const db = new DatabaseSync(path);
    db.prepare('INSERT INTO review_screenshots VALUES (?, ?, ?)').run(id, 'image/png', bytes);
    db.prepare('INSERT INTO diagnostic_screenshots VALUES (?, ?, ?)').run(check.id, 'image/png', bytes);
    db.close();
    store = openStore(path);
    assert.equal(store.reviewScreenshot(id), null);
    assert.equal(store.diagnosticScreenshot(check.id), null);
    assert.deepEqual({ reviews: store.pending(), evals: store.evals(), notices: store.notifications() }, before);
    const migrated = new DatabaseSync(path);
    for (const table of ['review_screenshots', 'diagnostic_screenshots']) assert.equal((migrated.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
    migrated.close();
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('HTTP screenshot checks queue masked results and never serve original pixels', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'harbor-image-http-'));
  const stub = join(folder, 'stub.mjs');
  // Intercept the provider in this isolated child only. Never sends a live API request.
  writeFileSync(stub, `globalThis.fetch = async (input) => {
    if (String(input) !== 'https://api.openai.com/v1/responses') throw new Error('Unexpected external request');
    return new Response(JSON.stringify({ id: 'resp_test', object: 'response', created_at: 1, status: 'completed', model: 'gpt-6-luna', output: [{ id: 'msg_test', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ text: '', extracted_links: [], readable: false, injection_detected: false }), annotations: [] }] }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }), { headers: { 'Content-Type': 'application/json' } });
  };`);
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(stub).href, 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', APP_MODE: 'live', NODE_ENV: 'production', OPENAI_API_KEY: 'local-test-only', DATABASE_PATH: join(folder, 'review.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 10000);
      child.stdout.on('data', data => { if (String(data).includes('Harbor demo running')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited: ${code}`)); });
    });
    const post = (path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const response = await post('/api/check', { image, language: 'en' });
    assert.equal(response.status, 200);
    const check = await response.json() as CheckResponse;
    assert.equal(check.redactedText, '[Unreadable screenshot]');
    assert.equal(check.result.verdict, 'unclear');
    const beforeReport = await (await fetch(url + '/api/reviews')).json();
    assert.equal(beforeReport.items.length, 0);
    assert.equal(beforeReport.recentChecks[0].hasScreenshot, false);
    const diagnosticPath = `/api/checks/${check.id}/screenshot`;
    const diagnosticImage = await fetch(url + diagnosticPath);
    assert.equal(diagnosticImage.status, 410);
    assert.equal(diagnosticImage.headers.get('cache-control'), 'no-store');
    assert.equal(diagnosticImage.headers.get('x-content-type-options'), 'nosniff');
    assert.match((await diagnosticImage.json()).error, /withheld/);
    assert.equal((await fetch(url + diagnosticPath, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(url + `/api/checks/${randomUUID()}/screenshot`)).status, 410);
    assert.equal((await post('/api/reports', { checkId: check.id, kind: 'escalation' })).status, 200);
    const queue = await (await fetch(url + '/api/reviews')).json();
    assert.equal(queue.items[0].hasScreenshot, false);
    const path = `/api/reviews/${queue.items[0].id}/screenshot`;
    const picture = await fetch(url + path);
    assert.equal(picture.status, 410);
    assert.equal(picture.headers.get('cache-control'), 'no-store');
    assert.equal(picture.headers.get('x-content-type-options'), 'nosniff');
    assert.match((await picture.json()).error, /withheld/);
    assert.equal((await fetch(url + path, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(url + `/api/reviews/${randomUUID()}/screenshot`)).status, 410);
    assert.equal((await post(`/api/reviews/${queue.items[0].id}/approve`, { label: 'unclear' })).status, 200);
    assert.equal((await fetch(url + path)).status, 410);
    assert.equal((await fetch(url + diagnosticPath)).status, 410);
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    rmSync(folder, { recursive: true, force: true });
  }
});
