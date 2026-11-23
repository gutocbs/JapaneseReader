import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READER_PREFERENCES,
  loadReaderPreferences,
  resolveFuriganaVisibility,
  saveReaderPreferences,
} from './preferences';

describe('reader preferences', () => {
  it('gives a key visibility precedence over the global setting and default', () => {
    expect(resolveFuriganaVisibility('show', false)).toBe(true);
    expect(resolveFuriganaVisibility('hide', true)).toBe(false);
    expect(resolveFuriganaVisibility('inherit', true, true)).toBe(false);
    expect(resolveFuriganaVisibility('inherit', false)).toBe(false);
    expect(resolveFuriganaVisibility('inherit', true)).toBe(true);
  });

  it('persists versioned browser preferences and rejects an incompatible value', () => {
    saveReaderPreferences({ fontSizePx: 28, showFurigana: false });
    expect(loadReaderPreferences()).toEqual({ fontSizePx: 28, showFurigana: false });

    localStorage.setItem('japanese-reader:reader-preferences', JSON.stringify({
      version: 0,
      fontSizePx: 28,
      showFurigana: false,
    }));
    expect(loadReaderPreferences()).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it('uses the configured default only before reader preferences have been saved', () => {
    localStorage.clear();
    expect(loadReaderPreferences(28)).toEqual({ fontSizePx: 28, showFurigana: true });

    saveReaderPreferences({ fontSizePx: 26, showFurigana: false });

    expect(loadReaderPreferences(28)).toEqual({ fontSizePx: 26, showFurigana: false });
  });
});

