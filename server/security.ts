import { config } from './config.ts';
import type { LinkCheck } from '../shared/schema.ts';
import { getDomain } from 'tldts';

export const normalizeMessage = (text: string) => text.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim();
export function detectInjection(text: string): boolean {
  const normalized = normalizeMessage(text).toLowerCase();
  return /ignore\s+(?:all\s+)?(?:your|the|previous|prior|system)|(?:mark|classify|declare).{0,55}(?:safe|legitimate)|(?:system|developer)\s*(?:prompt|message|:)|do not (?:flag|report)|忽略.{0,20}(?:規則|规则|指示|指令)|(?:標記|标记|判定).{0,15}(?:安全|合法)/is.test(normalized);
}
export function extractLinks(text: string): string[] {
  const normalized = normalizeMessage(text).replace(/\[\.\]/g, '.').replace(/hxxps?:\/\//gi, 'https://');
  return [...new Set((normalized.match(/(?:https?:\/\/|www\.)[^\s<>"'\u3000-\u303f\u4e00-\u9fff]+|(?:[a-z0-9\u0080-\u024f-]+\.)+[a-z]{2,}(?:\/[^\s<>"'\u3000-\u303f\u4e00-\u9fff]*)?/gi) ?? []).map(s => s.replace(/[.,;!?)]+$/, '')))];
}
export function checkLinks(text: string, extractedLinks: string[] = []): LinkCheck[] {
  const tokens = [...extractLinks(text), ...extractedLinks];
  const checks = new Map<string, LinkCheck>();
  for (const token of tokens) {
    try {
      const clean = normalizeMessage(token).replace(/[.,;!?)]+$/, '');
      const url = new URL(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`);
      const domain = url.hostname.toLowerCase().replace(/\.$/, '');
      // Bundled Public Suffix List, including private suffixes. No network or DNS requests.
      const registeredDomain = getDomain(domain, { allowPrivateDomains: true });
      const invalid = !registeredDomain || Boolean(url.username || url.password || (url.port && url.port !== '443' && url.port !== '80'));
      const status: LinkCheck['status'] = invalid ? 'invalid' : config.shortenerDomains.includes(registeredDomain!) ? 'unverifiable' : config.allowlistedDomains.includes(registeredDomain!) ? 'allowlisted' : config.demoAllowlistedDomains.includes(registeredDomain!) ? 'demo_allowlisted' : 'unrecognized';
      // A valid occurrence must never hide a malformed occurrence of the same host.
      if (!checks.has(domain) || status === 'invalid') checks.set(domain, { domain, registeredDomain, status });
    } catch { checks.set('[unreadable domain]', { domain: '[unreadable domain]', registeredDomain: null, status: 'invalid' }); }
  }
  return [...checks.values()];
}
