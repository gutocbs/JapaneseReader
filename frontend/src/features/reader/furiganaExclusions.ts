import type { AnalyzedToken, FuriganaExclusion } from '../../shared/api/client';

export function furiganaExclusionFromToken(token: AnalyzedToken): FuriganaExclusion | null {
  const reading = token.dictionaryReading ?? token.reading;
  if (!token.isLexical || !token.lemma.trim() || reading === null || !reading.trim()) return null;
  return { lemma: token.lemma, dictionaryReading: reading };
}

export function encodeFuriganaExclusion(exclusion: FuriganaExclusion): string {
  return JSON.stringify([exclusion.lemma, exclusion.dictionaryReading]);
}
