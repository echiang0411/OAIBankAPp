import 'dotenv/config';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { checkMessage } from '../server/checker.ts';
import type { Verdict } from '../shared/schema.ts';

if (!process.env.OPENAI_API_KEY) {
  console.error('Live verification is unavailable: OPENAI_API_KEY is not visible to this process. Set it in the project .env or the terminal environment.');
  process.exit(1);
}
const demos: { id: string; text: string }[] = JSON.parse(readFileSync(new URL('../data/demos.json', import.meta.url), 'utf8'));
const screenshot = 'data:image/png;base64,' + readFileSync(new URL('../public/demo/ups-message.png', import.meta.url)).toString('base64');
const report: Record<string, unknown>[] = [];
let failed = false;
for (const [i, demo] of demos.entries()) {
  const expected: Verdict = i === 1 ? 'likely_legitimate' : 'scam';
  try {
    const result = await checkMessage({ ...(i === 0 ? { image: screenshot } : { text: demo.text }), language: 'en', mode: 'live' });
    const pass = result.result.verdict === expected && (i !== 2 || result.result.injection_detected);
    failed ||= !pass;
    report.push({ id: demo.id, pass, expected, actual: result.result.verdict, injectionDetected: result.result.injection_detected, calls: result.calls, estimatedCost: result.estimatedCost });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${demo.id}: ${result.result.verdict}, estimated cost $${result.estimatedCost.toFixed(6)}`);
  } catch (error) {
    failed = true;
    report.push({ id: demo.id, pass: false, error: error instanceof Error ? error.name : 'UnknownError' });
    console.log(`ERROR ${demo.id}: live API check unavailable. Check credentials, model access, and network.`);
  }
}
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/live-verification.json', JSON.stringify({ verifiedAt: new Date().toISOString(), mode: 'live', passed: !failed, cases: report }, null, 2) + '\n');
if (failed) process.exitCode = 1;
