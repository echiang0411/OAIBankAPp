import { readFileSync } from 'node:fs';
import { z } from 'zod';
const schema = z.object({
  smallModel: z.string(), strongModel: z.string(), confidenceThreshold: z.number().min(0).max(1),
  maxOutputTokens: z.number().int().positive(), pricesVerifiedOn: z.string(),
  pricesPerMillion: z.record(z.string(), z.object({ input: z.number().nonnegative(), cachedInput: z.number().nonnegative(), cacheWrite: z.number().nonnegative(), output: z.number().nonnegative() })),
  allowlistedDomains: z.array(z.string()), demoAllowlistedDomains: z.array(z.string()), sources: z.array(z.string()),
  shortenerDomains: z.array(z.string()), weeklySampleSize: z.number().int().min(1).max(100),
  sampleLookbackDays: z.number().int().min(1).max(365), campaignWindowDays: z.number().int().min(1).max(365),
  campaignSimilarityThreshold: z.number().min(0.5).max(1),
});
export const config = schema.parse(JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8')));
for (const model of [config.smallModel, config.strongModel]) {
  if (!config.pricesPerMillion[model]) throw new Error(`Missing configured prices for ${model}`);
}
