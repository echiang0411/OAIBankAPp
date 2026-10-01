import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { maskPersonalDetails, sanitizeCallbackNumbers, sanitizeDeep } from './privacy.ts';
import { config } from './config.ts';
import { groupCampaigns } from './campaigns.ts';
import type { CheckResponse, CustomerNotification, EvalItem, ReportResponse, ReviewItem, ReviewSource, Verdict } from '../shared/schema.ts';

type Row = { payload: string };
export function openStore(path = process.env.DATABASE_PATH ?? resolve('data/harbor.sqlite')) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, check_id TEXT UNIQUE, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS evals (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checks (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sample_runs (week TEXT PRIMARY KEY, created_at TEXT NOT NULL, count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, review_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0);`);
  const fingerprint = (text: string, language: string) => createHash('sha256').update(text + ':' + language).digest('hex');
  const seeds: EvalItem[] = JSON.parse(readFileSync(new URL('../data/seed-eval.json', import.meta.url), 'utf8'));
  const importedAt = new Date().toISOString();
  for (const seed of seeds) {
    // Keep analyst edits. Refresh authored seed content when the shipped fixtures change.
    const prior = db.prepare('SELECT payload FROM evals WHERE id = ?').get(seed.id) as Row | undefined;
    const saved: EvalItem | undefined = prior ? JSON.parse(prior.payload) : undefined;
    const safe = { ...seed, text: maskPersonalDetails(seed.text), addedAt: saved ? saved.addedAt : importedAt, updatedAt: saved?.updatedAt };
    if (prior && JSON.parse(prior.payload).origin === 'seed') {
      db.prepare('UPDATE OR IGNORE evals SET fingerprint = ?, payload = ? WHERE id = ?').run(fingerprint(safe.text, safe.language), JSON.stringify(safe), safe.id);
    } else db.prepare('INSERT OR IGNORE INTO evals VALUES (?, ?, ?)').run(safe.id, fingerprint(safe.text, safe.language), JSON.stringify(safe));
  }
  // Recover historical approval dates where evidence exists. Never invent dates for older seed rows.
  const approvalDates = new Map<string, string[]>();
  for (const row of db.prepare("SELECT payload FROM reviews WHERE status = 'approved'").all() as Row[]) {
    const review: ReviewItem = JSON.parse(row.payload);
    if (!review.approvedAt || !Number.isFinite(Date.parse(review.approvedAt))) continue;
    const key = fingerprint(review.text, review.language);
    approvalDates.set(key, [...(approvalDates.get(key) ?? []), review.approvedAt].sort());
  }
  for (const row of db.prepare('SELECT payload FROM evals').all() as Row[]) {
    const item: EvalItem = JSON.parse(row.payload);
    if (item.origin !== 'review' || (item.addedAt && item.updatedAt)) continue;
    const dates = approvalDates.get(fingerprint(item.text, item.language));
    if (!dates?.length) continue;
    item.addedAt ??= dates[0];
    item.updatedAt ??= dates.at(-1);
    db.prepare('UPDATE evals SET payload = ? WHERE id = ?').run(JSON.stringify(item), item.id);
  }
  // Preserve older reviews without interpreting a customer's yes/no answer as a label.
  for (const row of db.prepare('SELECT id, check_id, payload FROM reviews').all() as (Row & { id: string; check_id: string })[]) {
    const item = JSON.parse(row.payload);
    if (!item.sources) {
      delete item.answer;
      item.sources = ['legacy_feedback'];
      item.checkId = row.check_id;
      db.prepare('UPDATE reviews SET payload = ? WHERE id = ?').run(JSON.stringify(item), row.id);
    }
  }
  function queue(check: CheckResponse, source: ReviewSource) {
    const existing = db.prepare('SELECT id, payload, status FROM reviews WHERE check_id = ?').get(check.id) as (Row & { id: string; status: string }) | undefined;
    if (existing) {
      const item: ReviewItem = JSON.parse(existing.payload);
      if (!item.sources.includes(source)) {
        item.sources.push(source);
        // A customer escalation after a completed random-sample review still needs a resolution.
        const reopen = existing.status === 'approved';
        if (reopen) { delete item.analystLabel; delete item.approvedAt; }
        db.prepare('UPDATE reviews SET payload = ?, status = ? WHERE id = ?').run(JSON.stringify(item), reopen ? 'pending' : existing.status, item.id);
        return { added: reopen };
      }
      return { added: false };
    }
    const item: ReviewItem = { id: randomUUID(), checkId: check.id, text: maskPersonalDetails(check.redactedText), callback_numbers: sanitizeCallbackNumbers(check.callback_numbers), result: sanitizeDeep(check.result), language: check.language, sources: [source], createdAt: new Date().toISOString(), mode: check.mode, extracted_links: sanitizeDeep(check.extracted_links ?? []) };
    db.prepare('INSERT INTO reviews (id, check_id, payload) VALUES (?, ?, ?)').run(item.id, check.id, JSON.stringify(item));
    return { added: true };
  }
  return {
    close: () => db.close(),
    pending: (): ReviewItem[] => (db.prepare("SELECT payload FROM reviews WHERE status = 'pending' ORDER BY rowid DESC").all() as Row[]).map(row => JSON.parse(row.payload)),
    evals: (): EvalItem[] => (db.prepare("SELECT payload FROM evals ORDER BY COALESCE(json_extract(payload, '$.updatedAt'), json_extract(payload, '$.addedAt')) DESC, rowid DESC").all() as Row[]).map(row => JSON.parse(row.payload)),
    latestChecks: (): CheckResponse[] => (db.prepare('SELECT payload FROM checks ORDER BY rowid DESC LIMIT 50').all() as Row[]).map(row => JSON.parse(row.payload)),
    historyCount: () => Number((db.prepare('SELECT count(*) AS count FROM checks').get() as { count: number }).count),
    notifications: (): CustomerNotification[] => (db.prepare('SELECT payload, is_read FROM notifications ORDER BY rowid DESC').all() as (Row & { is_read: number })[]).map(row => ({ ...JSON.parse(row.payload), read: Boolean(row.is_read) })),
    readNotification: (id: string) => db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id).changes === 1,
    recordCheck(check: CheckResponse, at = new Date().toISOString()) {
      // Construct the stored shape explicitly so images or future raw input fields cannot leak in.
      const safe: CheckResponse = { id: check.id, result: sanitizeDeep(check.result), redactedText: maskPersonalDetails(check.redactedText), callback_numbers: sanitizeCallbackNumbers(check.callback_numbers), links: sanitizeDeep(check.links), extracted_links: sanitizeDeep(check.extracted_links ?? []), language: check.language, mode: check.mode, source: check.source, calls: check.calls, estimatedCost: check.estimatedCost, escalated: check.escalated, escalationReason: check.escalationReason, durationMs: check.durationMs };
      db.prepare('INSERT OR IGNORE INTO checks VALUES (?, ?, ?)').run(check.id, at, JSON.stringify(safe));
    },
    submit(check: CheckResponse, kind: 'report' | 'escalation'): ReportResponse {
      if (kind === 'report' && !['scam', 'likely_scam'].includes(check.result.verdict)) throw new Error('This action is not available for the result verdict.');
      const submission = queue(check, kind);
      // Snapshot after insertion: include this item and all pending review sources.
      const pendingCount = Number((db.prepare("SELECT count(*) AS count FROM reviews WHERE status = 'pending'").get() as { count: number }).count);
      return { ...submission, pendingCount, estimatedWaitMinutes: pendingCount * 2 };
    },
    sample(now = new Date()) {
      const monday = new Date(now);
      monday.setUTCHours(0, 0, 0, 0);
      monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
      const week = monday.toISOString().slice(0, 10);
      const cutoff = new Date(now.getTime() - config.sampleLookbackDays * 86400000).toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior = db.prepare('SELECT count FROM sample_runs WHERE week = ?').get(week);
        if (prior) { db.exec('COMMIT'); return { added: 0, alreadyRun: true, week }; }
        // Every verdict is eligible; neither customer reports nor model risk scores choose the sample.
        const rows = db.prepare(`SELECT payload FROM checks WHERE created_at >= ? AND created_at <= ? AND id NOT IN (SELECT check_id FROM reviews) ORDER BY RANDOM() LIMIT ?`).all(cutoff, now.toISOString(), config.weeklySampleSize) as Row[];
        for (const row of rows) queue(JSON.parse(row.payload), 'random_sample');
        if (rows.length) db.prepare('INSERT INTO sample_runs VALUES (?, ?, ?)').run(week, now.toISOString(), rows.length);
        db.exec('COMMIT');
        return { added: rows.length, alreadyRun: false, week };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    campaigns: () => groupCampaigns((db.prepare("SELECT payload FROM reviews WHERE status = 'approved'").all() as Row[]).map(row => JSON.parse(row.payload))),
    approve(id: string, label: Verdict) {
      const row = db.prepare("SELECT payload FROM reviews WHERE id = ? AND status = 'pending'").get(id) as Row | undefined;
      if (!row) return null;
      const review: ReviewItem = JSON.parse(row.payload);
      review.analystLabel = label;
      review.approvedAt = new Date().toISOString();
      const key = fingerprint(review.text, review.language);
      const existing = db.prepare('SELECT id, payload FROM evals WHERE fingerprint = ?').get(key) as (Row & { id: string }) | undefined;
      const item: EvalItem = { id: existing?.id ?? randomUUID(), addedAt: existing ? (JSON.parse(existing.payload) as EvalItem).addedAt : review.approvedAt, updatedAt: review.approvedAt, text: maskPersonalDetails(review.text), callback_numbers: sanitizeCallbackNumbers(review.callback_numbers), language: review.language, label, origin: 'review', reviewSources: review.sources, extracted_links: sanitizeDeep(review.extracted_links ?? []) };
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO evals VALUES (?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET payload = excluded.payload').run(item.id, key, JSON.stringify(item));
        db.prepare("UPDATE reviews SET status = 'approved', payload = ? WHERE id = ?").run(JSON.stringify(review), id);
        if (review.sources.includes('escalation')) {
          const notification: CustomerNotification = { id: randomUUID(), checkId: review.checkId, reviewId: review.id, language: review.language, verdict: label, createdAt: review.approvedAt, read: false };
          db.prepare('INSERT OR IGNORE INTO notifications (id, review_id, payload) VALUES (?, ?, ?)').run(notification.id, review.id, JSON.stringify(notification));
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { added: !existing, notified: review.sources.includes('escalation') };
    },
  };
}
