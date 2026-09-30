import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.ts';
import { checkMessage } from '../server/checker.ts';

const demos = JSON.parse(readFileSync(new URL('../data/demos.json', import.meta.url), 'utf8')) as { text: string }[];

test('eval dates survive restarts and the latest approval moves an existing example to the top', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'harbor-eval-dates-'));
  const path = join(folder, 'test.sqlite');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-29T12:00:00Z') });
  let store = openStore(path);
  try {
    const seedDate = store.evals()[0].addedAt;
    assert.equal(seedDate, '2026-09-29T12:00:00.000Z');
    const first = await checkMessage({ text: demos[0].text, language: 'en', mode: 'mock' });
    t.mock.timers.tick(1000);
    store.submit(first, 'report');
    store.approve(store.pending()[0].id, 'scam');
    const firstEntry = store.evals()[0];
    assert.equal(firstEntry.addedAt, '2026-09-29T12:00:01.000Z');
    t.mock.timers.tick(1000);
    const second = await checkMessage({ text: demos[2].text, language: 'en', mode: 'mock' });
    store.submit(second, 'report');
    store.approve(store.pending()[0].id, 'scam');
    assert.equal(store.evals()[0].text, second.redactedText);
    t.mock.timers.tick(1000);
    store.submit({ ...first, id: randomUUID() }, 'report');
    store.approve(store.pending()[0].id, 'likely_scam');
    const updated = store.evals()[0];
    assert.equal(updated.id, firstEntry.id);
    assert.equal(updated.addedAt, firstEntry.addedAt);
    assert.equal(updated.updatedAt, '2026-09-29T12:00:03.000Z');
    assert.equal(store.evals().length, 22);
    t.mock.timers.tick(86400000);
    store.close(); store = openStore(path);
    assert.deepEqual(store.evals()[0], updated);
    assert.ok(store.evals().filter(item => item.origin === 'seed').every(item => item.addedAt === seedDate));
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('legacy evals recover saved approval dates without inventing historical seed dates', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'harbor-eval-migration-'));
  const path = join(folder, 'test.sqlite');
  let store = openStore(path);
  try {
    const check = await checkMessage({ text: demos[0].text, language: 'en', mode: 'mock' });
    store.submit(check, 'report');
    store.approve(store.pending()[0].id, 'scam');
    const approvedAt = store.evals()[0].updatedAt;
    const db = new DatabaseSync(path);
    db.exec("UPDATE evals SET payload = json_remove(payload, '$.addedAt', '$.updatedAt')");
    db.close();
    store.close(); store = openStore(path);
    assert.equal(store.evals()[0].text, check.redactedText);
    assert.equal(store.evals()[0].updatedAt, approvedAt);
    assert.ok(store.evals().filter(item => item.origin === 'seed').every(item => item.addedAt === undefined));
    store.close(); store = openStore(path);
    assert.equal(store.evals()[0].updatedAt, approvedAt);
    assert.ok(store.evals().filter(item => item.origin === 'seed').every(item => item.addedAt === undefined));
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});
