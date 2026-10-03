import { z } from 'zod';

export const verdicts = ['scam', 'likely_scam', 'unclear', 'likely_legitimate'] as const;
export const languages = ['en', 'zh-TW', 'zh-CN', 'es', 'ar'] as const;
export type Language = typeof languages[number];
export const ResultSchema = z.object({
  verdict: z.enum(verdicts),
  confidence: z.number().min(0).max(1),
  red_flags: z.array(z.string()),
  impersonated_brand: z.string().nullable(),
  recommended_action: z.string(),
  explanation_in_user_language: z.string(),
  escalate_to_human: z.boolean(),
  injection_detected: z.boolean(),
}).strict();
export type Result = z.infer<typeof ResultSchema>;
export type Verdict = Result['verdict'];
export type LinkCheck = { domain: string; registeredDomain: string | null; status: 'allowlisted' | 'demo_allowlisted' | 'unrecognized' | 'invalid' | 'unverifiable' };
export type CallUsage = { model: string; purpose: 'transcription' | 'initial' | 'escalation'; input: number; cachedInput: number; output: number; estimatedCost: number; simulated: boolean };
export type CheckResponse = {
  id: string; result: Result; links: LinkCheck[]; mode: 'mock' | 'live';
  redactedText: string; calls: CallUsage[]; estimatedCost: number;
  escalated: boolean; escalationReason: string | null; durationMs: number;
  source: 'text' | 'image'; language: Language; extracted_links: string[]; callback_numbers?: string[];
};
export type ReportResponse = { added: boolean; pendingCount: number; estimatedWaitMinutes: number };
export type ReviewSource = 'report' | 'escalation' | 'random_sample' | 'legacy_feedback';
export type ReviewItem = { id: string; checkId: string; text: string; result: Result; language: Language; sources: ReviewSource[]; createdAt: string; mode: string; hasScreenshot?: boolean; source?: 'text' | 'image'; analystLabel?: Verdict; approvedAt?: string; callback_numbers?: string[]; extracted_links?: string[] };
export type EvalItem = { id: string; text: string; language: Language; label: Verdict; origin: 'seed' | 'review'; addedAt?: string; updatedAt?: string; reviewSources?: ReviewSource[]; callback_numbers?: string[]; extracted_links?: string[]; expectedLinkStatuses?: LinkCheck['status'][] };
export type Campaign = { id: string; text: string; count: number; lastConfirmedAt: string };
export type CustomerNotification = { id: string; checkId: string; reviewId: string; language: Language; verdict: Verdict; createdAt: string; read: boolean };
