import { describe, expect, it } from 'vitest';
import type { AnalyzedToken } from '../../shared/api/client';
import { encodeFuriganaExclusion, furiganaExclusionFromToken } from './furiganaExclusions';

const token = { lemma: '生', dictionaryReading: 'せい', isLexical: true } as AnalyzedToken;

describe('furigana exclusions', () => {
  it('uses lemma and dictionary reading as distinct identity', () => {
    expect(encodeFuriganaExclusion(furiganaExclusionFromToken(token)!)).not.toBe(
      encodeFuriganaExclusion(furiganaExclusionFromToken({ ...token, dictionaryReading: 'しょう' })!),
    );
  });


  it('falls back to the analyzed reading when dictionary reading is unavailable', () => {
    expect(furiganaExclusionFromToken({
      ...token,
      surface: '作る',
      lemma: '作る',
      reading: 'つく',
      dictionaryReading: null,
    })).toEqual({ lemma: '作る', dictionaryReading: 'つく' });
  });
  it.each([
    { ...token, isLexical: false }, { ...token, lemma: ' ' },
    { ...token, dictionaryReading: null, reading: null },
    { ...token, dictionaryReading: ' ', reading: ' ' },
  ])('rejects an ineligible token', (candidate) => {
    expect(furiganaExclusionFromToken(candidate)).toBeNull();
  });
});
