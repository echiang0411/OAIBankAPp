// Deliberately bounded to synthetic demo data. See README for limitations.
const syntheticNames = ['Alice Chen', 'Robert Miller', 'Maria Garcia', 'David Wong', 'Susan Lee', 'James Smith', '王小明', '陳美玲', '陈美玲', '李大明', '張雅婷', '张雅婷'];
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
