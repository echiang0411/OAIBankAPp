// Deterministic demo redaction. Context rules supplement known synthetic names;
// they are not a guarantee of detecting every person or identifier in free text.
const syntheticNames = ['Alice Chen', 'Robert Miller', 'Maria Garcia', 'David Wong', 'Susan Lee', 'James Smith', '王小明', '陳美玲', '陈美玲', '李大明', '張雅婷', '张雅婷'];
const normalizePersonalText = (value: string) => value.normalize('NFKC')
  .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
  .replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)));
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
  const text = normalizePersonalText(value);
  const candidates = new Map<string, string>();
  const hidden = new Set<string>();
  for (const match of text.matchAll(phonePattern)) {
    const number = match[0];
    const key = canonicalPhone(number);
    const before = text.slice(Math.max(0, match.index - 100), match.index);
    const after = text.slice(match.index + number.length, match.index + number.length + 65);
    const callback = /(?:\b(?:call|dial)(?:\s+(?:us|our team|back|immediately|urgently|now|today|right away|at|on))*|\bphone\s+us(?:\s+(?:at|on))?|\bcallback(?:\s+number)?|\bll[aá]m(?:a|e|enos)(?:\s+al)?|(?:請|请)?(?:致電|致电|撥打|拨打|回電|回电)|اتصل\s*(?:بنا|على)?)[\s:#：-]*$/i.test(before);
    const personal = /(?:\b(?:your|my|customer|recipient|registered|personal|mobile|account|card|acct|ending)\b|您的|你的|我的|客戶|客户|帳號|账号|卡號|卡号|tu\s+(?:tel[eé]fono|n[uú]mero)|su\s+(?:tel[eé]fono|n[uú]mero)|هاتفك|رقمك)[^.!?。！？\n]*$/i.test(before)
      || /^\s*(?:is\s+(?:your|my|the customer)|屬於您|属于您|是您的|是你的)/i.test(after);
    if (!callback || personal || !sanitizeCallbackNumbers([number]).length) hidden.add(key);
    else candidates.set(key, number);
  }
  // A number also appearing as a customer/unknown number cannot be released as evidence.
  return sanitizeCallbackNumbers([...candidates].filter(([key]) => !hidden.has(key)).map(([, number]) => number));
}

// Build the analyst's masked display directly from the original transcript. Never
// guess which [NUMBER] in a historical message belongs to a retained callback.
export function maskAnalystText(value: string, callbackNumbers: unknown): string {
  const text = normalizePersonalText(value);
  const retained = new Set(sanitizeCallbackNumbers(callbackNumbers).map(canonicalPhone));
  const eligible = new Set(extractCallbackNumbers(text).map(canonicalPhone).filter(key => retained.has(key)));
  // A deterministic, collision-free marker prevents user-authored placeholder text
  // from gaining a number. All other masking still runs before numbers are restored.
  let prefix = 'HARBORCALLBACKTOKEN';
  while (text.includes(prefix)) prefix += 'X';
  const preserved: [string, string][] = [];
  const tokenized = text.replace(phonePattern, number => {
    if (!eligible.has(canonicalPhone(number))) return number;
    const marker = `${prefix}${'X'.repeat(preserved.length + 1)}END`;
    preserved.push([marker, number]);
    return marker;
  });
  let masked = maskPersonalDetails(tokenized);
  for (const [marker, number] of preserved) masked = masked.replaceAll(marker, number);
  return cleanTypography(masked);
}

function maskAddresses(text: string): string {
  // Consume the whole US address, not just the street. Include an existing marker
  // so the same rule can clean apartment/city/postcode fragments in older records.
  const separator = String.raw`[ \t]*(?:\.[ \t]*)?(?:,[ \t]*)?`;
  const unit = String.raw`(?:${separator}(?:Apt\.?|Apartment|Unit|Suite|Ste\.?|#)[ \t]*[\p{L}\p{N}-]+\b)?`;
  const city = String.raw`[\p{L}][\p{L}'’-]*(?:[ \t]+[\p{L}][\p{L}'’-]*){0,4}`;
  const state = String.raw`(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)`;
  const zip = String.raw`(?:\d{5}(?:-\d{4})?\b|\[NUMBER\])`;
  const locality = String.raw`(?:${separator}(?:${city}[ \t]*,?[ \t]+)?${state}[ \t]+${zip}|${separator}${zip})?`;
  const street = String.raw`\b\d{1,6}[ \t]+(?:[\p{L}\p{N}'’-]+[ \t]+){1,5}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b`;
  text = text.replace(new RegExp(`(?:${street}|\\[ADDRESS\\])${unit}${locality}`, 'giu'), '[ADDRESS]');
  // Labeled addresses can use other formats. Stop before another sentence or field.
  return text.replace(/((?:\b(?:home address|mailing address|postal address|address|direcci[oó]n)|住址|地址|العنوان)\s*(?:(?:(?:was|has been|is)\s+)?(?:updated|changed|set)\s+to\s+|is\s+|[:=]\s*))[^\s\[\]\n;。!?][^\[\]\n;。!?]*/giu, '$1[ADDRESS]');
}

export function maskPersonalDetails(value: string): string {
  let text = normalizePersonalText(value);
  // URLs are checked against domains before redaction. Remove credentials and
  // opaque personal URL values while keeping the destination useful for review.
  text = text.replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, raw => {
    let url = raw.replace(/^(https?:\/\/)[^/\s]*@/i, '$1[REDACTED]@');
    url = url.replace(/[?#].*$/, '/[REDACTED]');
    return url.replace(/%[0-9a-f]{2}(?:[^/\s]*)/gi, '[REDACTED]');
  });
  for (const name of syntheticNames) text = text.replace(new RegExp(name, 'gi'), '[NAME]');
  const person = "[\\p{L}\\p{M}][\\p{L}\\p{M}'’.-]*(?:[ \\t]+[\\p{L}\\p{M}][\\p{L}\\p{M}'’.-]*){0,5}";
  text = text.replace(new RegExp(`(\\b(?:Dear|Hello|Hi|Hola|Estimad[oa])\\s+)${person}(?=[,:!\\n]|$)`, 'giu'), '$1[NAME]');
  text = text.replace(new RegExp(`(\\b(?:my name is|this is|I am|I[’']m|soy|me llamo)\\s+)(${person})(?=\\s+(?:from|with|calling|de)\\b|[,!;\\n]|$)`, 'giu'), (whole, lead: string, candidate: string) => {
    // Ordinary verdict prose is not a personal introduction.
    if (/^(?:a|an|the|your|our|not|likely|unclear|normal|ordinary|safe|legitimate|suspicious|scam|fraud|un|una|el|la|su|tu)\b/i.test(candidate)) return whole;
    return `${lead}[NAME]`;
  });
  text = text.replace(new RegExp(`(\\b(?:customer name|full name|name|nombre(?: completo)?)\\s*[:=]\\s*)${person}`, 'giu'), '$1[NAME]');
  text = text.replace(/([\p{Script=Han}]{2,4})(?=先生|女士|小姐)/gu, '[NAME]');
  text = text.replace(/((?:姓名|名字|客户姓名|客戶姓名)\s*[:=]?\s*)[\p{Script=Han}]{2,4}/gu, '$1[NAME]');
  text = text.replace(/((?:الاسم|اسمي)\s*[:=]?\s*)[\p{Script=Arabic}]+(?:[ \t]+[\p{Script=Arabic}]+){0,4}/gu, '$1[NAME]');
  // Unicode email local parts, plus tags and internationalized domains.
  text = text.replace(/[\p{L}\p{N}\p{M}._%+!#$&'*\/=^`{|}~-]+@[\p{L}\p{N}](?:[\p{L}\p{N}.-]*\.)[\p{L}]{2,}/giu, '[EMAIL]');
  // Explicit field labels let us redact uncommon/alphanumeric values without
  // mistaking every number, price, or business name for customer data.
  text = text.replace(/((?:\b(?:date of birth|birth date|DOB|birthday|fecha de nacimiento)|出生日期|出生年月日|生日|تاريخ الميلاد)\s*(?:is\s*)?[:=(]?\s*)[^\]\n;。!?)]{1,60}(?=[)\n;。!?]|$)/giu, '$1[DATE OF BIRTH]');
  text = text.replace(/\b(?:\d{1,2}[/.]\d{1,2}[/.](?:19|20)\d{2}|(?:19|20)\d{2}[/-]\d{1,2}[/-]\d{1,2})\b/g, '[DATE]');
  text = maskAddresses(text);
  text = text.replace(/\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi, '[ACCOUNT]');
  text = text.replace(/((?:\b(?:SSN|social security(?: number)?|SIN|passport(?: number)?|driver'?s? licen[cs]e(?: number)?|national ID|tax ID|customer ID|reference|ref|IBAN|account(?: number)?|acct|card(?: number)?|username|user ID|password|passcode|PIN|OTP|security code|verification code|c[oó]digo|contrase[nñ]a)|身分證(?:字號)?|身份证(?:号)?|護照(?:號碼)?|护照(?:号码)?|帳號|账号|卡號|卡号|密碼|密码|驗證碼|验证码|رقم الهوية|كلمة المرور|رمز التحقق)\s*(?:is\s+|es\s+|[:=#]\s*))[^\s,;。!?\[\]]+/giu, '$1[REDACTED]');
  text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ID]');
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP ADDRESS]');
  text = text.replace(/(?:\+?\d[\d().\s-]{6,}\d)/g, '[NUMBER]');
  text = text.replace(/((?:ending(?:\s+in)?|last\s+four|card|account|acct\.?|尾號|尾号|帳號|账号|卡號|卡号)\s*[:#*xX-]*\s*)\d{3,}/gi, '$1[NUMBER]');
  text = text.replace(/\b\d{6,}\b/g, '[NUMBER]');
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
