import type { components, operations } from './generated';

type GeneratedDocument = components['schemas']['DocumentResponse'];
// Cached documents from contracts predating source remain valid app inputs.
export type Document = Omit<GeneratedDocument, 'source'> & {
  source?: GeneratedDocument['source'];
};
export type DocumentTag = components['schemas']['DocumentTagModel'];
export type CreateDocument = components['schemas']['CreateDocumentRequest'];
export type ImportDocument = components['schemas']['ImportDocumentRequest'];
export type UpdateDocument = components['schemas']['UpdateDocumentRequest'];
export type Analysis = components['schemas']['DocumentAnalysisResponse'];
export type AnalysisBlock = components['schemas']['AnalysisBlockResponse'];
export type AnalyzedToken = components['schemas']['AnalyzedTokenResponse'];
export type VocabularySelection = components['schemas']['VocabularyKeyModel'];
export type FuriganaVisibility = components['schemas']['FuriganaVisibility'];
export type VocabularyDisplayPreference = components['schemas']['VocabularyDisplayPreferenceModel'];
type ReadingOverrideScope = 'local' | 'vocabulary';
export type ReadingOverrideKey = Omit<components['schemas']['ReadingOverrideKeyRequest'], 'scope'> & {
  scope?: ReadingOverrideScope;
};
export type SetReadingOverride = Omit<components['schemas']['SetReadingOverrideRequest'], 'scope'> & {
  scope?: ReadingOverrideScope;
};
export type ReadingOverride = components['schemas']['ReadingOverrideResponse'];
export type ReadingOverrideOperation = components['schemas']['ReadingOverrideOperationResponse'];
export type FuriganaExclusion = components['schemas']['FuriganaExclusionModel'];
export type ReadingException = components['schemas']['ReadingExceptionResponse'];
export type SetReadingException = components['schemas']['SetReadingExceptionRequest'];
export type ProblemDetails = operations['getDocument']['responses'][404]['content']['application/problem+json'];

function isProblemDetails(body: unknown): body is ProblemDetails {
  if (typeof body !== 'object' || body === null) return false;
  const value = body as Record<string, unknown>;
  return typeof value.type === 'string' && typeof value.title === 'string'
    && typeof value.status === 'number' && typeof value.detail === 'string';
}

export class ApiError extends Error {
  readonly problem: ProblemDetails | undefined;

  constructor(readonly status: number, readonly body: unknown) {
    const problem = isProblemDetails(body) ? body : undefined;
    super(problem?.detail ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.problem = problem;
  }
}

export const READING_OVERRIDES_CONFIRMATION_REQUIRED_TYPE =
  'urn:japanese-reader:reading-overrides-confirmation-required';

export function isReadingOverridesConfirmationRequired(error: unknown): boolean {
  return error instanceof ApiError
    && error.status === 409
    && error.problem?.type === READING_OVERRIDES_CONFIRMATION_REQUIRED_TYPE;
}

export function createDocumentClient(fetcher: typeof fetch = globalThis.fetch) {
  async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const response = await fetcher(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      let errorBody: unknown = text;
      try { errorBody = JSON.parse(text); } catch { /* Preserve plain text failures. */ }
      throw new ApiError(response.status, errorBody);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  const documentPath = (id: string) => `/api/documents/${encodeURIComponent(id)}`;
  const vocabularyPath = (id: string) => `${documentPath(id)}/vocabulary-selections`;
  const displayPreferencesPath = (id: string) => `${documentPath(id)}/vocabulary-display-preferences`;
  const readingOverridesPath = (id: string) => `${documentPath(id)}/reading-overrides`;
  const readingExceptionPath = (lemma: string) => `/api/reading-exceptions/${encodeURIComponent(lemma)}`;
  const tagPath = (name: string) => `/api/tags/${encodeURIComponent(name)}`;
  return {
    list: () => request<Document[]>('/api/documents', 'GET'),
    create: (data: CreateDocument) => request<Document>('/api/documents', 'POST', data),
    importDocument: (data: ImportDocument) => request<Document>('/api/imports', 'POST', data),
    get: (id: string) => request<Document>(documentPath(id), 'GET'),
    update: (id: string, data: UpdateDocument) => request<Document>(documentPath(id), 'PUT', data),
    delete: (id: string) => request<void>(documentPath(id), 'DELETE'),
    listTags: () => request<DocumentTag[]>('/api/tags', 'GET'),
    createTag: (tag: DocumentTag) => request<DocumentTag>('/api/tags', 'POST', tag),
    renameTag: (name: string, nextName: string) => request<void>(tagPath(name), 'PUT', { name: nextName }),
    deleteTag: (name: string) => request<void>(tagPath(name), 'DELETE'),
    analyze: (id: string) => request<Analysis>(`${documentPath(id)}/analysis`, 'POST'),
    listVocabularySelections: async (id: string) => (
      await request<{ selections: VocabularySelection[] }>(vocabularyPath(id), 'GET')
    ).selections,
    replaceVocabularySelections: (id: string, selections: VocabularySelection[]) => (
      request<void>(vocabularyPath(id), 'PUT', { selections })
    ),
    listVocabularyDisplayPreferences: async (id: string) => (
      await request<{ preferences: VocabularyDisplayPreference[] }>(displayPreferencesPath(id), 'GET')
    ).preferences,
    setVocabularyDisplayPreference: (id: string, preference: VocabularyDisplayPreference) => (
      request<void>(displayPreferencesPath(id), 'PUT', preference)
    ),
    setReadingOverride: (id: string, override: SetReadingOverride) => (
      request<ReadingOverrideOperation>(readingOverridesPath(id), 'PUT', override)
    ),
    deleteReadingOverride: (id: string, key: ReadingOverrideKey) => (
      request<ReadingOverrideOperation>(readingOverridesPath(id), 'DELETE', key)
    ),
    listFuriganaExclusions: () => request<FuriganaExclusion[]>(furiganaExclusionsPath, 'GET'),
    addFuriganaExclusion: (exclusion: FuriganaExclusion) => request<void>(furiganaExclusionsPath, 'PUT', exclusion),
    removeFuriganaExclusion: (exclusion: FuriganaExclusion) => request<void>(furiganaExclusionsPath, 'DELETE', exclusion),
    listReadingExceptions: () => request<ReadingException[]>('/api/reading-exceptions', 'GET'),
    setReadingException: (lemma: string, payload: SetReadingException) => (
      request<ReadingException>(readingExceptionPath(lemma), 'PUT', { reading: payload.reading })
    ),
    deleteReadingException: (lemma: string) => (
      request<ReadingException>(readingExceptionPath(lemma), 'DELETE')
    ),
  };
}

type OptionalClientMethods =
  | 'importDocument'
  | 'listTags'
  | 'createTag'
  | 'renameTag'
  | 'deleteTag'
  | 'listFuriganaExclusions'
  | 'addFuriganaExclusion'
  | 'removeFuriganaExclusion'
  | 'listReadingExceptions'
  | 'setReadingException'
  | 'deleteReadingException';
export type DocumentClient = Omit<ReturnType<typeof createDocumentClient>, OptionalClientMethods>
  & Partial<Pick<ReturnType<typeof createDocumentClient>, OptionalClientMethods>>;
export const documentClient = createDocumentClient();


