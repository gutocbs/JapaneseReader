import type { AnalyzedToken, FuriganaExclusion } from '../../shared/api/client';

export function furiganaExclusionFromToken(token: AnalyzedToken): FuriganaExclusion | null {
  if (!token.isLexical || !token.lemma.trim() || token.dictionaryReading === null || !token.dictionaryReading.trim()) return null;
  return { lemma: token.lemma, dictionaryReading: token.dictionaryReading };
}

export function encodeFuriganaExclusion(exclusion: FuriganaExclusion): string {
  return JSON.stringify([exclusion.lemma, exclusion.dictionaryReading]);
}
