export type FuriganaVisibility = 'inherit' | 'show' | 'hide';

export interface ReaderPreferences {
  fontSizePx: number;
  showFurigana: boolean;
}

export const READER_FONT_SIZE_RANGE = { min: 18, max: 32, step: 1 } as const;
export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontSizePx: 24,
  showFurigana: true,
};

const STORAGE_KEY = 'japanese-reader:reader-preferences';
const STORAGE_VERSION = 1;

function isFontSize(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= READER_FONT_SIZE_RANGE.min
    && value <= READER_FONT_SIZE_RANGE.max;
}

export function loadReaderPreferences(defaultFontSizePx = DEFAULT_READER_PREFERENCES.fontSizePx): ReaderPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return { ...DEFAULT_READER_PREFERENCES, fontSizePx: defaultFontSizePx };
    const value: unknown = JSON.parse(stored);
    if (typeof value !== 'object' || value === null) return DEFAULT_READER_PREFERENCES;
    const record = value as Record<string, unknown>;
    if (record.version !== STORAGE_VERSION || !isFontSize(record.fontSizePx)
      || typeof record.showFurigana !== 'boolean') {
      return DEFAULT_READER_PREFERENCES;
    }
    return { fontSizePx: record.fontSizePx, showFurigana: record.showFurigana };
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
}

export function saveReaderPreferences(preferences: ReaderPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...preferences }));
}

export function resolveFuriganaVisibility(
  visibility: FuriganaVisibility,
  showFurigana: boolean,
  excludedByDefault = false,
): boolean {
  if (visibility === 'show') return true;
  if (visibility === 'hide') return false;
  return excludedByDefault ? false : showFurigana;
}




