import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserLanguage, validPreference } from '../shared/language.ts';

test('browser preferences use supported languages in priority order and fall back to English', () => {
  for (const [preferences, expected] of [
    [['es-MX'], 'es'], [['ar-SA'], 'ar'], [['en-GB'], 'en'],
    [['fr-FR', 'es-ES', 'en'], 'es'], [['de', 'fr'], 'en'], [[], 'en'],
    [['zh-Hant-CN'], 'zh-TW'], [['zh-Hans-HK'], 'zh-CN'],
    [['zh-TW'], 'zh-TW'], [['zh-HK'], 'zh-TW'], [['zh-MO'], 'zh-TW'],
    [['zh'], 'zh-CN'], [['zh-SG'], 'zh-CN'], [['ZH_hant'], 'zh-TW'],
  ] as const) assert.equal(browserLanguage(preferences), expected);
});

test('only supported saved language preferences override the browser', () => {
  for (const language of ['en', 'zh-TW', 'zh-CN', 'es', 'ar']) assert.equal(validPreference(language), language);
  for (const invalid of ['auto', 'fr', '', null, undefined]) assert.equal(validPreference(invalid), 'auto');
});
