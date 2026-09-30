import { languages, type Language } from './schema.ts';

export type LanguagePreference = Language | 'auto';
export const languageNames: Record<Language, string> = {
  en: 'English', 'zh-TW': '繁體中文', 'zh-CN': '简体中文', es: 'Español', ar: 'العربية',
};
export const automaticLabels: Record<Language, string> = {
  en: 'Automatic (browser)', 'zh-TW': '自動（瀏覽器）', 'zh-CN': '自动（浏览器）',
  es: 'Automático (navegador)', ar: 'تلقائي (المتصفح)',
};
export function validPreference(value: unknown): LanguagePreference {
  return languages.includes(value as Language) ? value as Language : 'auto';
}
export function browserLanguage(preferences: readonly string[]): Language {
  for (const preference of preferences) {
    const [base, ...parts] = preference.toLowerCase().replaceAll('_', '-').split('-');
    if (base === 'zh') {
      if (parts.includes('hant')) return 'zh-TW';
      if (parts.includes('hans')) return 'zh-CN';
      return parts.some(part => ['tw', 'hk', 'mo'].includes(part)) ? 'zh-TW' : 'zh-CN';
    }
    if (base === 'en' || base === 'es' || base === 'ar') return base;
  }
  return 'en';
}
