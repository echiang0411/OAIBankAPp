import 'dotenv/config';
import { checkMessage } from '../server/checker.ts';
import { openStore } from '../server/store.ts';
import { verdicts } from '../shared/schema.ts';

const live = process.argv.includes('--live') || (!process.argv.includes('--mock') && process.env.APP_MODE === 'live');
const mode = live ? 'live' : 'mock';
if (live && !process.env.OPENAI_API_KEY) { console.error('Live eval needs OPENAI_API_KEY. Set it in .env or the environment.'); process.exit(1); }
const store = openStore();
const cases = store.evals();
store.close();
const matrix: Record<string, Record<string, number>> = Object.fromEntries(verdicts.map(v => [v, Object.fromEntries(verdicts.map(p => [p, 0]))]));
let correct = 0, errors = 0, unsafeFalseNegatives = 0, escalationCount = 0, cost = 0, linkPassed = 0, linkTotal = 0;
console.log(`\nHarbor evaluation | ${mode.toUpperCase()} | ${cases.length} labeled examples`);
console.log(mode === 'mock' ? 'Replay check only. This score does not measure live model quality.' : 'Live model performance on a small synthetic set, not production accuracy.');
console.log(`Labels: ${cases.filter(c => c.origin === 'seed').length} authored seeds; ${cases.filter(c => c.origin === 'review').length} analyst-approved. Customer reports never assign labels.`);
for (const source of ['report', 'escalation', 'random_sample'] as const) console.log(`Analyst-reviewed ${source} examples: ${cases.filter(c => c.reviewSources?.includes(source)).length}`);
for (const item of cases) {
  try {
    const check = await checkMessage({ text: item.text, language: item.language, mode, extractedLinks: item.extracted_links });
    if (item.expectedLinkStatuses) {
      linkTotal++;
      const pass = JSON.stringify(check.links.map(l => l.status).sort()) === JSON.stringify([...item.expectedLinkStatuses].sort());
      if (pass) linkPassed++;
      console.log(`${pass ? 'PASS' : 'FAIL'} link policy ${item.id}`);
    }
    const predicted = check.result.verdict;
    matrix[item.label][predicted]++;
    const pass = predicted === item.label;
    if (pass) correct++;
    if (['scam', 'likely_scam'].includes(item.label) && predicted === 'likely_legitimate') unsafeFalseNegatives++;
    if (check.escalated) escalationCount++;
    cost += check.estimatedCost;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${item.id} [${item.language}] expected=${item.label} predicted=${predicted}`);
  } catch (error) {
    errors++;
    console.log(`ERROR ${item.id}: ${error instanceof Error && 'code' in error ? String(error.code) : 'Check unavailable'}`);
  }
}
console.log(`\nAccuracy: ${correct}/${cases.length} (${cases.length ? (100 * correct / cases.length).toFixed(1) : '0.0'}%)`);
console.log(`Errors counted as incorrect: ${errors}`);
console.log(`Scams incorrectly called likely legitimate: ${unsafeFalseNegatives}`);
console.log(`Escalated checks: ${escalationCount}`);
console.log(`Link-policy checks: ${linkPassed}/${linkTotal}`);
console.log(`${mode === 'mock' ? 'Illustrative' : 'Estimated'} API cost: $${cost.toFixed(6)}${mode === 'mock' ? ' (actual spend: $0)' : ''}`);
console.log('Confusion matrix: rows are expected labels, columns are predictions.');
console.table(matrix);
if (errors || linkPassed !== linkTotal) process.exitCode = 1;
