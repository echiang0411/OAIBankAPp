import { createHash } from 'node:crypto';
import { config } from './config.ts';
import { normalizeMessage } from './security.ts';
import type { Campaign, ReviewItem } from '../shared/schema.ts';

function normalized(text: string): string {
  return normalizeMessage(text).toLowerCase().replace(/\d+(?:[.,]\d+)*/g, 'NUMBER').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function grams(text: string): Set<string> {
  return new Set(Array.from({ length: Math.max(1, text.length - 2) }, (_, i) => text.slice(i, i + 3)));
}
export function similarity(a: string, b: string): number {
  const x = grams(normalized(a)), y = grams(normalized(b));
  const intersection = [...x].filter(g => y.has(g)).length;
  return intersection / new Set([...x, ...y]).size;
}
export function groupCampaigns(reviews: ReviewItem[], now = new Date()): Campaign[] {
  const cutoff = new Date(now.getTime() - config.campaignWindowDays * 86400000).toISOString();
  const confirmed = reviews.filter(r => r.sources.includes('report') && ['scam', 'likely_scam'].includes(r.analystLabel ?? '') && r.approvedAt && r.approvedAt >= cutoff && r.approvedAt <= now.toISOString());
  confirmed.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const groups: Campaign[] = [];
  for (const report of confirmed) {
    const group = groups.find(g => similarity(g.text, report.text) >= config.campaignSimilarityThreshold);
    if (group) { group.count++; if (report.approvedAt! > group.lastConfirmedAt) group.lastConfirmedAt = report.approvedAt!; }
    else groups.push({ id: createHash('sha256').update(normalized(report.text)).digest('hex').slice(0, 12), text: report.text, count: 1, lastConfirmedAt: report.approvedAt! });
  }
  return groups.sort((a, b) => b.count - a.count || b.lastConfirmedAt.localeCompare(a.lastConfirmedAt));
}
