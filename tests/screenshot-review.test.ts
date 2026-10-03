import test from 'node:test';
import assert from 'node:assert/strict';
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

test('review screenshot survives restart, deduplicates submissions and is removed on approval', () => {
  const folder = mkdtempSync(join(tmpdir(), 'harbor-image-store-'));
  const path = join(folder, 'review.sqlite');
  let store = openStore(path);
  try {
    const check = unreadable();
    store.recordCheck(check);
    assert.equal(store.pending().length, 0);
    assert.equal(store.submit(check, 'escalation', image).added, true);
    const id = store.pending()[0].id;
    assert.equal(store.submit(check, 'escalation', image).added, false);
    assert.equal(store.pending().length, 1);
    assert.equal(store.pending()[0].hasScreenshot, true);
    assert.deepEqual(store.reviewScreenshot(id)?.bytes, bytes);
    assert.equal(store.reviewScreenshot(id)?.mime, 'image/png');
    assert.doesNotMatch(JSON.stringify([...store.latestChecks(), ...store.pending(), ...store.evals()]), /data:image|iVBORw0KGgo/);
    store.close(); store = openStore(path);
    assert.deepEqual(store.reviewScreenshot(id)?.bytes, bytes);
    store.approve(id, 'unclear');
    assert.equal(store.reviewScreenshot(id), null);
    assert.equal(store.notifications()[0].verdict, 'unclear');
    assert.equal(store.pending().length, 0);
    assert.equal(store.submit(check, 'escalation', image).added, false);
    assert.equal(store.reviewScreenshot(id), null);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('invalid attachments cannot create reviews; sampling and older reviews do not invent images', () => {
  const store = openStore(':memory:');
  try {
    const check = unreadable();
    for (const invalid of ['https://evil.example/file.png', 'data:image/png;base64,bm90YW5pbWFnZQ==']) {
      assert.throws(() => store.submit(check, 'escalation', invalid));
      assert.equal(store.pending().length, 0);
    }
    assert.throws(() => store.submit({ ...check, source: 'text' }, 'escalation', image));
    store.recordCheck(check);
    store.sample();
    const id = store.pending()[0].id;
    assert.equal(store.reviewScreenshot(id), null);
    assert.equal(store.pending()[0].hasScreenshot, undefined);
    store.submit(check, 'escalation', image);
    assert.deepEqual(store.pending()[0].sources, ['random_sample', 'escalation']);
    assert.deepEqual(store.reviewScreenshot(id)?.bytes, bytes);
  } finally { store.close(); }
});

test('unreadable diagnostics retain original images without reporting, survive restart, and preserve labels', () => {
  const folder = mkdtempSync(join(tmpdir(), 'harbor-diagnostic-image-'));
  const path = join(folder, 'checks.sqlite');
  let store = openStore(path);
  try {
    const check = unreadable();
    const originalEvals = store.evals();
    store.recordCheck(check, undefined, image);
    store.recordCheck(check, undefined, image);
    assert.equal(store.historyCount(), 1);
    assert.equal(store.pending().length, 0);
    assert.equal(store.latestChecks()[0].hasScreenshot, true);
    assert.deepEqual(store.diagnosticScreenshot(check.id)?.bytes, bytes);
    assert.doesNotMatch(JSON.stringify(store.latestChecks()), /data:image|iVBORw0KGgo/);
    store.close(); store = openStore(path);
    assert.deepEqual(store.diagnosticScreenshot(check.id)?.bytes, bytes);
    assert.deepEqual(store.evals(), originalEvals);
    store.submit(check, 'escalation', image);
    store.approve(store.pending()[0].id, 'unclear');
    assert.deepEqual(store.diagnosticScreenshot(check.id)?.bytes, bytes);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('diagnostic retention is bounded to latest 50 checks and does not retain readable images', () => {
  const store = openStore(':memory:');
  try {
    const check = unreadable();
    assert.throws(() => store.recordCheck(check, undefined, 'data:image/png;base64,bm90YW5pbWFnZQ=='));
    assert.equal(store.historyCount(), 0);
    store.recordCheck(check, undefined, image);
    for (let i = 0; i < 49; i++) store.recordCheck({ ...unreadable(), redactedText: 'Readable message' }, undefined, image);
    assert.deepEqual(store.diagnosticScreenshot(check.id)?.bytes, bytes);
    assert.equal(store.latestChecks().filter(c => c.hasScreenshot).length, 1);
    const readable = { ...unreadable(), redactedText: 'Readable message' };
    store.recordCheck(readable, undefined, image);
    assert.equal(store.diagnosticScreenshot(check.id), null);
    assert.equal(store.diagnosticScreenshot(readable.id), null);
    assert.equal(store.latestChecks().some(c => c.hasScreenshot), false);
    assert.equal(store.historyCount(), 51);
    assert.equal(store.evals().length, 20);
  } finally { store.close(); }
});

test('existing unreadable review images are backfilled into diagnostics without replacing records', () => {
  const folder = mkdtempSync(join(tmpdir(), 'harbor-diagnostic-backfill-'));
  const path = join(folder, 'checks.sqlite');
  let store = openStore(path);
  try {
    const check = unreadable();
    store.recordCheck(check);
    store.submit(check, 'escalation', image);
    const before = { reviews: store.pending(), evals: store.evals(), notices: store.notifications() };
    assert.equal(store.diagnosticScreenshot(check.id), null);
    store.close(); store = openStore(path);
    assert.deepEqual(store.diagnosticScreenshot(check.id)?.bytes, bytes);
    assert.deepEqual({ reviews: store.pending(), evals: store.evals(), notices: store.notifications() }, before);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('HTTP unreadable screenshot check passes its original bytes into analyst review without another upload', async () => {
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
    assert.equal(beforeReport.recentChecks[0].hasScreenshot, true);
    const diagnosticPath = `/api/checks/${check.id}/screenshot`;
    const diagnosticImage = await fetch(url + diagnosticPath);
    assert.equal(diagnosticImage.headers.get('content-type'), 'image/png');
    assert.equal(diagnosticImage.headers.get('cache-control'), 'no-store');
    assert.equal(diagnosticImage.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await diagnosticImage.arrayBuffer()), bytes);
    assert.equal((await fetch(url + diagnosticPath, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(url + `/api/checks/${randomUUID()}/screenshot`)).status, 404);
    assert.equal((await post('/api/reports', { checkId: check.id, kind: 'escalation' })).status, 200);
    const queue = await (await fetch(url + '/api/reviews')).json();
    assert.equal(queue.items[0].hasScreenshot, true);
    const path = `/api/reviews/${queue.items[0].id}/screenshot`;
    const picture = await fetch(url + path);
    assert.equal(picture.headers.get('content-type'), 'image/png');
    assert.equal(picture.headers.get('cache-control'), 'no-store');
    assert.equal(picture.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await picture.arrayBuffer()), bytes);
    assert.equal((await fetch(url + path, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(url + `/api/reviews/${randomUUID()}/screenshot`)).status, 404);
    assert.equal((await post(`/api/reviews/${queue.items[0].id}/approve`, { label: 'unclear' })).status, 200);
    assert.equal((await fetch(url + path)).status, 404);
    assert.equal((await fetch(url + diagnosticPath)).status, 200);
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    rmSync(folder, { recursive: true, force: true });
  }
});
