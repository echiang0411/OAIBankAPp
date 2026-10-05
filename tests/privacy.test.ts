import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractCallbackNumbers, maskPersonalDetails, sanitizeDeep } from '../server/privacy.ts';
import { openStore } from '../server/store.ts';
import { checkMessage } from '../server/checker.ts';
import type { Result } from '../shared/schema.ts';

const cases = [
  ['Dear Zoë O’Neill, your notice.', ['Zoë', 'O’Neill']],
  ['Name: Amina Hassan; Email: amina+bank@example.com', ['Amina', 'Hassan', 'amina+bank@example.com']],
  ['Harbor Bank: Hi, this is Sarah from Card Services. Call us back.', ['Sarah']],
  ['Hi, I am Eve with Web Surveys. Can you answer a poll?', ['Eve']],
  ["I’m Luis from Card Services.", ['Luis']],
  ['陳志明先生您好。姓名：林美華；聯絡 王.小明@郵件.example', ['陳志明', '林美華', '王.小明@郵件.example']],
  ['Hola Lucía Fernández, fecha de nacimiento: 14/03/1988; dirección: Calle Mayor 12, Madrid; contraseña: Secreto123', ['Lucía', 'Fernández', '14/03/1988', 'Calle Mayor', 'Secreto123']],
  ['الاسم: أحمد حسن; تاريخ الميلاد: ١٤/٠٣/١٩٨٨; العنوان: شارع النيل ١٢; كلمة المرور: Secret123', ['أحمد حسن', '1988', 'شارع النيل', 'Secret123']],
  ['Your date of birth (03/14/1988). DOB: March 14, 1988; SSN: 123-45-6789; passport: AB7654321; PIN: 1234', ['03/14/1988', 'March 14, 1988', '123-45-6789', 'AB7654321', '1234']],
  ['Home address: 42 Maple Avenue, Apt 3, Boston MA 02118; account: AB123456789; username: customer.z', ['42 Maple', 'Boston', '02118', 'AB123456789', 'customer.z']],
  ['Your mailing address was updated to 2418 Linden Ave, Apt 3B, Brooklyn, NY 11226.', ['2418', 'Linden', '3B', 'Brooklyn', 'NY', '11226']],
  ['Your address has been changed to 2418 Linden Ave., Apt. 3B, Brooklyn, NY 11226-1234.', ['2418', 'Linden', '3B', 'Brooklyn', '11226', '1234']],
  ['Mail: 2418 Linden Ave Brooklyn NY 11226. Please call us back.', ['2418', 'Linden', 'Brooklyn', '11226']],
  ['Mail: 42 Maple Avenue, Boston MA 02118. Visit the app.', ['42 Maple', 'Boston', '02118']],
  ['Address was updated to [ADDRESS], Apt 3B, Brooklyn, NY 11226. Please call us back.', ['3B', 'Brooklyn', '11226']],
  ['Address was updated to [ADDRESS]., Apt. 3B, Brooklyn, NY [NUMBER]. Please call us back.', ['3B', 'Brooklyn', 'NY']],
  ['Visit 42 Maple Avenue Apt 3. Your IP: 192.0.2.42; IBAN: GB82 WEST 1234 5698 7654 32', ['42 Maple', 'Apt 3', '192.0.2.42', 'GB82', 'WEST', '1234', '7654']],
  ['a\u200blice@example.com +١ (٢٠٢) ٥٥٥-٠١٤٧ ４１１１ １１１１ １１１１ １１１１', ['alice@example.com', '0147', '4111']],
  ['https://name:password@harbor-verify.example/pay?name=Jane#account https://harbor.example/customer/Zo%C3%AB', ['name:password', 'name=Jane', 'account', 'Zo%C3%AB']],
] as const;

test('common personal details in all supported languages are masked idempotently', () => {
  for (const [text, sensitive] of cases) {
    const masked = maskPersonalDetails(text);
    for (const value of sensitive) assert.ok(!masked.includes(value), `Unmasked value ${value}: ${masked}`);
    assert.equal(maskPersonalDetails(masked), masked, `Repeated masking changed: ${masked}`);
  }
});

const accountChangeMessage = 'Harbor National Bank: Hi Michael Torres, this is Sarah from Card Services. We noticed the phone number on your account was changed to 646-555-0147 and your mailing address was updated to 2418 Linden Ave, Apt 3B, Brooklyn, NY 11226. If you did not make these changes, please call us back immediately at 1-800-555-0199 to prevent your card from being locked. Reference #48213. Our hours are 8am to 8pm ET.';

test('account-change message masks the full address and keeps only the explicit callback as analyst evidence', async () => {
  const masked = maskPersonalDetails(accountChangeMessage);
  assert.match(masked, /mailing address was updated to \[ADDRESS\]\. If you did not make these changes, please call us back immediately at \[NUMBER\]/);
  assert.doesNotMatch(masked, /Michael|Torres|Sarah|646-555|2418|Linden|3B|Brooklyn|11226|800-555/);
  const check = await checkMessage({ text: accountChangeMessage, language: 'en', mode: 'mock' }, async ({ text }) => {
    assert.doesNotMatch(text, /Michael|Torres|Sarah|646-555|2418|Linden|3B|Brooklyn|11226|800-555/);
    return { result: { verdict: 'unclear', confidence: 0.5, red_flags: [], impersonated_brand: null, recommended_action: '', explanation_in_user_language: 'The sender cannot be verified.', escalate_to_human: true, injection_detected: false }, usage: { input: 100, output: 30, cachedInput: 0 } };
  });
  assert.deepEqual(check.callback_numbers, ['1-800-555-0199']);
  const store = openStore(':memory:');
  try {
    store.recordCheck(check);
    store.submit(check, 'escalation');
    assert.equal(store.evals().length, 20);
    const review = store.pending()[0];
    assert.deepEqual(review.callback_numbers, ['1-800-555-0199']);
    assert.doesNotMatch(JSON.stringify([review, store.latestChecks()]), /Michael|Torres|Sarah|646-555|2418|Linden|3B|Brooklyn|11226/);
    store.approve(review.id, 'unclear');
    assert.deepEqual(store.evals().find(item => item.origin === 'review')!.callback_numbers, ['1-800-555-0199']);
  } finally { store.close(); }
});

test('urgency permits a callback role but never overrides customer ownership or ambiguity', () => {
  for (const instruction of ['call us back immediately at', 'call us now at', 'call us back right away at', 'dial immediately']) {
    assert.deepEqual(extractCallbackNumbers(`Please ${instruction} 1-800-555-0199.`), ['1-800-555-0199']);
    assert.deepEqual(extractCallbackNumbers(`Please ${instruction} 212-555-0199.`), ['212-555-0199']);
  }
  for (const text of [
    'Phone: 1-800-555-0199.',
    'Your phone number was changed to 1-800-555-0199.',
    'Please call your registered number immediately at 1-800-555-0199.',
    'Please call us back immediately at 1-800-555-0199. Your phone is (800) 555-0199.',
    'Please call us back immediately at 1-800-555-0199 is your phone number.',
  ]) assert.deepEqual(extractCallbackNumbers(text), [], text);
});

test('redaction preserves prices, deadlines, bank brands, domain evidence and safe guidance', () => {
  for (const text of [
    'Harbor National Bank: Pay $1.99 within 24 hours at https://cibc.com.verify-account.example/login',
    'Do not share your password or PIN. Open the bank app.',
    '請勿提供密碼。請自行開啟銀行應用程式。',
    'No compartas tu contraseña. Abre la aplicación oficial.',
    'Your branch appointment is tomorrow at 10 AM.',
    'This is a scam.',
    'This is likely legitimate.',
  ]) assert.equal(maskPersonalDetails(text), text);
});

test('model input, generated prose, history, queue and eval use the same expanded masking', async () => {
  const raw = 'Name: Amina Hassan; DOB: March 14, 1988; address: 42 Maple Avenue; passport: AB7654321; email: amina@example.com';
  const result: Result = { verdict: 'scam', confidence: 0.99, red_flags: [raw], impersonated_brand: 'Harbor National Bank', recommended_action: '', explanation_in_user_language: raw, escalate_to_human: false, injection_detected: false };
  const check = await checkMessage({ text: raw, language: 'en', mode: 'mock' }, async args => {
    assert.equal(args.text, maskPersonalDetails(raw));
    return { result, usage: { input: 100, cachedInput: 0, output: 30 } };
  });
  assert.equal(check.result.red_flags[0], sanitizeDeep(raw));
  const store = openStore(':memory:');
  try {
    store.recordCheck(check);
    assert.equal(store.evals().length, 20);
    store.submit(check, 'escalation');
    assert.equal(store.evals().length, 20);
    const review = store.pending()[0];
    store.approve(review.id, 'likely_scam');
    const evalItem = store.evals().find(item => item.origin === 'review')!;
    assert.equal(evalItem.label, 'likely_scam');
    assert.equal(evalItem.text, maskPersonalDetails(raw));
    const stored = JSON.stringify([store.latestChecks(), evalItem, review]);
    assert.doesNotMatch(stored, /Amina|Hassan|March 14|42 Maple|AB7654321|amina@example/);
  } finally { store.close(); }
});

test('existing stored text is re-masked without losing colliding eval records, labels, dates or IDs', () => {
  const folder = mkdtempSync(join(tmpdir(), 'harbor-privacy-'));
  const path = join(folder, 'test.sqlite');
  try {
    const initial = openStore(path); initial.close();
    const db = new DatabaseSync(path);
    db.exec("DELETE FROM privacy_migrations; INSERT INTO privacy_migrations VALUES ('expanded-text-v2')");
    const addedAt = '2026-09-30T15:23:45.000Z';
    for (const [id, name, label] of [['personal-one', 'Amina Hassan', 'scam'], ['personal-two', 'Zoë Davis', 'unclear']]) {
      const text = `Name: ${name}; DOB: 03/14/1988; Address was updated to [ADDRESS], Apt 3B, Brooklyn, NY 11226. Call us back at [NUMBER].`;
      db.prepare('INSERT INTO evals VALUES (?, ?, ?)').run(id, id, JSON.stringify({ id, text, language: 'en', label, origin: 'review', addedAt }));
      db.prepare('INSERT INTO checks VALUES (?, ?, ?)').run(id, addedAt, JSON.stringify({ id, redactedText: text, calls: [{ input: 123456, output: 99 }], callback_numbers: ['1-800-555-0199'] }));
      db.prepare('INSERT INTO reviews VALUES (?, ?, ?, ?)').run(id, id, JSON.stringify({ id, checkId: id, text, sources: ['escalation'], createdAt: addedAt, callback_numbers: [] }), 'pending');
    }
    db.close();
    for (let restart = 0; restart < 2; restart++) {
      const store = openStore(path);
      try {
        assert.equal(store.evals().length, 22);
        const approved = store.evals().filter(item => item.origin === 'review');
        assert.deepEqual(approved.map(item => [item.id, item.label, item.addedAt]).sort(), [['personal-one', 'scam', addedAt], ['personal-two', 'unclear', addedAt]]);
        assert.equal(approved[0].text, approved[1].text);
        assert.doesNotMatch(JSON.stringify([approved, store.pending(), store.latestChecks()]), /Amina|Hassan|Zoë|Davis|03\/14\/1988|3B|Brooklyn|11226/);
        assert.equal(store.pending().length, 2);
        assert.equal(store.pending()[0].createdAt, addedAt);
        assert.deepEqual(store.pending()[0].callback_numbers, [], 'Already masked callbacks cannot be reconstructed');
        assert.match(store.pending()[0].text, /\[ADDRESS\]\. Call us back at \[NUMBER\]\./);
        assert.equal(store.latestChecks()[0].calls[0].input, 123456);
        assert.deepEqual(store.latestChecks()[0].callback_numbers, ['1-800-555-0199']);
      } finally { store.close(); }
    }
    const persisted = new DatabaseSync(path);
    assert.doesNotMatch(JSON.stringify(persisted.prepare('SELECT payload FROM evals').all()), /Amina|Hassan|Zoë|Davis|03\/14\/1988|3B|Brooklyn|11226/);
    persisted.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
