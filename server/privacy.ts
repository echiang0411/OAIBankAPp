// Deliberately bounded to synthetic demo data. See README for limitations.
const syntheticNames = ['Alice Chen', 'Robert Miller', 'Maria Garcia', 'David Wong', 'Susan Lee', 'James Smith', '王小明', '陳美玲', '陈美玲', '李大明', '張雅婷', '张雅婷'];
// Retain only explicit callback destinations as analyst evidence, never as trusted contacts.
// Unknown roles stay masked. This is a bounded demo heuristic, not identity verification.
const phonePattern = /(?<![\w\d])\+?\d(?:[\d ()-]*\d)?(?![\w\d])/g;
const canonicalPhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
};
export function sanitizeCallbackNumbers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && /^\+?\d[\d ()-]*\d$/.test(v) && v.length <= 32 && v.replace(/\D/g, '').length >= 10 && v.replace(/\D/g, '').length <= 15))].slice(0, 10);
}
export function extractCallbackNumbers(value: string): string[] {
  const text = value.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '');
  const candidates = new Map<string, string>();
  const hidden = new Set<string>();
  for (const match of text.matchAll(phonePattern)) {
    const number = match[0];
    const key = canonicalPhone(number);
    const before = text.slice(Math.max(0, match.index - 100), match.index);
    const after = text.slice(match.index + number.length, match.index + number.length + 65);
    const callback = /(?:\b(?:call|dial)(?:\s+(?:us|our team|back|at|on))*|\bphone\s+us(?:\s+(?:at|on))?|\bcallback(?:\s+number)?|\bll[aá]m(?:a|e|enos)(?:\s+al)?|(?:請|请)?(?:致電|致电|撥打|拨打|回電|回电)|اتصل\s*(?:بنا|على)?)[\s:#：-]*$/i.test(before);
    const personal = /(?:\b(?:your|my|customer|recipient|registered|personal|mobile|account|card|acct|ending)\b|您的|你的|我的|客戶|客户|帳號|账号|卡號|卡号|tu\s+(?:tel[eé]fono|n[uú]mero)|su\s+(?:tel[eé]fono|n[uú]mero)|هاتفك|رقمك)[^.!?。！？\n]*$/i.test(before)
      || /^\s*(?:is\s+(?:your|my|the customer)|屬於您|属于您|是您的|是你的)/i.test(after);
    if (!callback || personal || !sanitizeCallbackNumbers([number]).length) hidden.add(key);
    else candidates.set(key, number);
  }
  // A number also appearing as a customer/unknown number cannot be released as evidence.
  return sanitizeCallbackNumbers([...candidates].filter(([key]) => !hidden.has(key)).map(([, number]) => number));
}
export function maskPersonalDetails(value: string): string {
  let text = value.normalize('NFKC');
  for (const name of syntheticNames) text = text.replace(new RegExp(name, 'gi'), '[NAME]');
  text = text.replace(/\b(?:Dear|Hello|Hi)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?=[,:!])/g, 'Hello [NAME]');
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');
  text = text.replace(/(?:\+?\d[\d().\s-]{6,}\d)/g, '[NUMBER]');
  text = text.replace(/((?:ending(?:\s+in)?|last\s+four|card|account|acct\.?|尾號|尾号|帳號|账号|卡號|卡号)\s*[:#*xX-]*\s*)\d{3,}/gi, '$1[NUMBER]');
  text = text.replace(/\b\d{6,}\b/g, '[NUMBER]');
  // Query strings and fragments can contain identifiers even when they do not resemble PII.
  text = text.replace(/((?:https?:\/\/|www\.)[^\s?<>#]+)[?#][^\s<>]*/gi, '$1/[REDACTED]');
  return text;
}
export function cleanTypography(value: string): string {
  return value.replace(/[\u2013\u2014]/g, '-').replace(/[\u2190-\u21ff\u27f0-\u27ff]/g, '/');
}
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') return cleanTypography(maskPersonalDetails(value)) as T;
  if (Array.isArray(value)) return value.map(sanitizeDeep) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeDeep(v)])) as T;
  return value;
}
