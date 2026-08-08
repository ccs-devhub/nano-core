import { beforeEach, describe, expect, it } from 'vitest';

import {
  chromeDictionaries,
  locale,
  localized,
  moduleLocale,
  setLocale,
  setModuleLocale,
  t
} from './i18n';

describe('i18n', (): void => {
  beforeEach((): void => {
    setLocale('en');
    setModuleLocale('mod', '');
  });

  it('passes plain strings through untouched', (): void => {
    expect(localized('hello')).toBe('hello');
    expect(localized(undefined)).toBe('');
  });

  it('resolves pick, then global, then module default, then any',
    (): void => {
      const TEXT = { en: 'hello', es: 'hola', pt: 'ola' };

      /* The reader's pick wins over everything. */
      expect(localized(TEXT, ['pt', 'en', 'es'])).toBe('ola');
      /* No pick: the global locale. */
      setLocale('es');
      expect(localized(TEXT, ['', 'es', 'pt'])).toBe('hola');
      /* Global not shipped: the module default. */
      expect(localized({ pt: 'ola', fr: 'salut' }, ['', 'es', 'pt']))
        .toBe('ola');
      /* Nothing matches: the first entry present. */
      expect(localized({ fr: 'salut' })).toBe('salut');
    });

  it('falls back to english before the first entry', (): void => {
    setLocale('es');
    expect(localized({ en: 'hello', fr: 'salut' })).toBe('hello');
  });

  it('serves chrome text per locale with interpolation', ():
  void => {
    expect(t('back_to', { name: 'roles' })).toBe('back to roles');
    setLocale('es');
    expect(t('back_to', { name: 'roles' })).toBe('volver a roles');
    expect(locale.value).toBe('es');
    /* Unknown keys echo back instead of crashing. */
    expect(t('no_such_key')).toBe('no_such_key');
  });

  it('keeps EXACT key parity between every chrome dictionary', ():
  void => {
    const DICTIONARIES = chromeDictionaries();
    const EN_KEYS = Object.keys(DICTIONARIES.en).sort();

    for (const _code of Object.keys(DICTIONARIES)) {
      expect(
        Object.keys(DICTIONARIES[_code]).sort(),
        `dictionary '${_code}' must mirror en`
      ).toEqual(EN_KEYS);
    }
  });

  it('keeps the global and per-module picks readable', (): void => {
    /* Storage is best-effort (try/catch) — the reactive picks are
       the source of truth this asserts. */
    setLocale('es');
    expect(locale.value).toBe('es');
    /* Only chrome languages are accepted globally. */
    setLocale('pt');
    expect(locale.value).toBe('es');

    setModuleLocale('mod', 'en');
    expect(moduleLocale('mod')).toBe('en');

    /* Clearing the pick returns the module to follow-global. */
    setModuleLocale('mod', '');
    expect(moduleLocale('mod')).toBe('');
  });
});
