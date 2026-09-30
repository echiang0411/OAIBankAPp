import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { z } from 'zod';
import { checkMessage, CheckError } from './checker.ts';
import { config } from './config.ts';
import { openStore } from './store.ts';
import { hostingConfig } from './hosting.ts';
import { languages, verdicts, type CheckResponse } from '../shared/schema.ts';

const mode = process.env.APP_MODE ?? 'mock';
if (mode !== 'mock' && mode !== 'live') throw new Error('APP_MODE must be mock or live.');
const port = Number(process.env.PORT ?? 3000);
const hosting = hostingConfig(process.env, port);
const store = openStore();
const recentChecks = new Map<string, { value: CheckResponse; expires: number }>();
const app = express();
const server = createServer(app);
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (!hosting.allowed(req.headers.host, req.headers.origin, req.method, req.path)) return res.status(403).json({ error: 'Use the configured app address. Cross-origin requests are not allowed.' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '6mb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, mode }));
app.get('/api/meta', (_req, res) => res.json({ mode, liveReady: Boolean(process.env.OPENAI_API_KEY), config, evalCount: store.evals().length, pendingCount: store.pending().length }));
app.get('/api/demos', (_req, res) => res.json(JSON.parse(readFileSync(new URL('../data/demos.json', import.meta.url), 'utf8'))));
const CheckInput = z.object({ text: z.string().max(6000).optional(), image: z.string().max(5_600_000).optional(), language: z.enum(languages) }).strict()
  .refine(v => Boolean(v.text?.trim()) !== Boolean(v.image), 'Provide either a message or a screenshot.');
let active = 0;
app.post('/api/check', async (req, res, next) => {
  try {
    const input = CheckInput.parse(req.body);
    if (active >= 3) throw new CheckError('BUSY', 'The checker is busy. Please try again in a moment.', 429);
    active++;
    let result: CheckResponse;
    try { result = await checkMessage({ ...input, mode }); } finally { active--; }
    for (const [id, item] of recentChecks) if (item.expires < Date.now()) recentChecks.delete(id);
    if (recentChecks.size >= 100) recentChecks.delete(recentChecks.keys().next().value!);
    recentChecks.set(result.id, { value: result, expires: Date.now() + 30 * 60_000 });
    store.recordCheck(result);
    res.json(result);
  } catch (error) { next(error); }
});
app.post('/api/reports', (req, res) => {
  const { checkId, kind } = z.object({ checkId: z.string().uuid(), kind: z.enum(['report', 'escalation']) }).strict().parse(req.body);
  const check = recentChecks.get(checkId);
  if (!check || check.expires < Date.now()) return res.status(410).json({ error: 'This result has expired. Check the message again before sending it to the fraud team.' });
  const verdict = check.value.result.verdict;
  if ((kind === 'report' && !['scam', 'likely_scam'].includes(verdict)) || (kind === 'escalation' && verdict !== 'unclear')) return res.status(400).json({ error: 'This action is not available for this verdict.' });
  res.json(store.submit(check.value, kind));
});
app.get('/api/reviews', (_req, res) => res.json({ items: store.pending(), recentChecks: store.latestChecks(), evalCount: store.evals().length, historyCount: store.historyCount(), sampleSize: config.weeklySampleSize, lookbackDays: config.sampleLookbackDays, campaigns: store.campaigns(), campaignWindowDays: config.campaignWindowDays }));
app.post('/api/reviews/sample', (req, res) => { z.object({}).strict().parse(req.body); res.json(store.sample()); });
app.get('/api/evals', (_req, res) => res.json({ items: store.evals() }));
app.get('/api/notifications', (_req, res) => res.json({ items: store.notifications() }));
app.post('/api/notifications/:id/read', (req, res) => { const id = z.string().uuid().parse(req.params.id); z.object({}).strict().parse(req.body); res.json({ updated: store.readNotification(id) }); });
app.post('/api/reviews/:id/approve', (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { label } = z.object({ label: z.enum(verdicts) }).strict().parse(req.body);
  const out = store.approve(id, label);
  if (!out) return res.status(404).json({ error: 'This item has already been reviewed or is unavailable.' });
  res.json({ ...out, evalCount: store.evals().length });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof CheckError) return res.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'The request is invalid. Check the message, file size, and selected language.' });
  if ((error as { type?: string })?.type === 'entity.too.large') return res.status(413).json({ error: 'This upload is too large. Use a PNG or JPEG smaller than 4 MB.' });
  console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
  res.status(502).json({ error: mode === 'live' ? 'The live API could not complete this request. Check the API key, model access, and network, then retry. No mock result was substituted.' : 'This check could not be completed. Please try again.' });
});
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}
server.listen(port, hosting.bindHost, () => {
  console.log(`Harbor demo running at http://localhost:${port} (${mode} mode)`);
  if (mode === 'live' && !process.env.OPENAI_API_KEY) console.log('Set OPENAI_API_KEY in .env and restart to enable live checks.');
});
process.on('SIGTERM', () => server.close(() => { store.close(); process.exit(0); }));
