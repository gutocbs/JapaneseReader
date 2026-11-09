import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppSettings, useDocumentClient, useRouter } from '../../app/providers';
import { ApiError } from '../../shared/api/client';
import type {
  Analysis,
  Document,
  ReadingOverrideKey,
  ReadingOverrideOperation,
  SetReadingOverride,
} from '../../shared/api/client';
import {
  decodeVocabularyKey,
  encodeVocabularyKey,
  orderedVocabularyEntries,
  ReviewList,
} from '../vocabulary/ReviewList';
import { DocumentText } from './DocumentText';
import { ReaderMenu } from './ReaderMenu';
import { ReaderTagsPopup } from './ReaderTagsPopup';
import {
  loadReaderPreferences,
  saveReaderPreferences,
  type FuriganaVisibility,
  type ReaderPreferences,
} from './preferences';

interface ReaderPageProps {
  documentId: string;
}

interface ReaderSnapshot {
  document: Document;
  analysis: Analysis;
}

interface ReaderPersistenceNotice {
  kind: 'success' | 'error';
  message: string;
}

function isReaderSnapshot(value: unknown, documentId: string): value is ReaderSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<ReaderSnapshot>;
  return snapshot.document?.id === documentId
    && snapshot.analysis?.documentId === documentId
    && snapshot.analysis.documentRevision === snapshot.document.revision;
}

function replaceAnalysisOccurrence(
  current: Analysis,
  refreshed: Analysis,
  key: ReadingOverrideKey,
): Analysis {
  if (refreshed.documentRevision !== key.documentRevision) {
    throw new Error('Reading override analysis revision changed');
  }
  const replacement = refreshed.blocks
    .flatMap((block) => block.tokens)
    .find((token) => (
      token.startOffset === key.startOffset && token.endOffset === key.endOffset
    ));
  if (replacement === undefined) throw new Error('Reading override token disappeared');
  let replaced = false;
  const blocks = current.blocks.map((block) => ({
    ...block,
    tokens: block.tokens.map((token) => {
      if (token.startOffset !== key.startOffset || token.endOffset !== key.endOffset) return token;
      replaced = true;
      return replacement;
    }),
  }));
  if (!replaced) throw new Error('Reading override token is not in the current reader');
  return { ...current, blocks, diagnostics: refreshed.diagnostics };
}

export function ReaderPage({ documentId }: ReaderPageProps) {
  const client = useDocumentClient();
  const { settings } = useAppSettings();
  const { location, navigate } = useRouter();
  const routedSnapshot = isReaderSnapshot(location.state, documentId) ? location.state : null;
  const [snapshot, setSnapshot] = useState<ReaderSnapshot | null>(routedSnapshot);
  const [isLoading, setIsLoading] = useState(routedSnapshot === null);
  const [hasError, setHasError] = useState(false);
  const [loadErrorStatus, setLoadErrorStatus] = useState<number | null>(null);
  const [areSelectionsHydrated, setAreSelectionsHydrated] = useState(false);
  const [persistenceNotice, setPersistenceNotice] = useState<ReaderPersistenceNotice | null>(null);
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(
    () => loadReaderPreferences(settings.defaultReaderFontSizePx),
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [displayPreferences, setDisplayPreferences] = useState<
    ReadonlyMap<string, FuriganaVisibility>
  >(() => new Map());
  const [areDisplayPreferencesHydrated, setAreDisplayPreferencesHydrated] = useState(false);
  const selectedKeysRef = useRef(selectedKeys);
  const desiredSelectionKeysRef = useRef(selectedKeys);
  const selectionWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const selectionIntentVersionRef = useRef(0);
  const requestGeneration = useRef(0);

  const loadReader = useCallback(async (candidate: ReaderSnapshot | null) => {
    const generation = ++requestGeneration.current;
    const ownsState = () => requestGeneration.current === generation;
    if (candidate !== null) setSnapshot(candidate);
    setIsLoading(candidate === null);
    setHasError(false);
    setLoadErrorStatus(null);
    setAreSelectionsHydrated(false);
    setAreDisplayPreferencesHydrated(false);
    setPersistenceNotice(null);
    try {
      const [document, selections, loadedDisplayPreferences] = await Promise.all([
        client.get(documentId),
        client.listVocabularySelections(documentId),
        client.listVocabularyDisplayPreferences(documentId),
      ]);
      if (!ownsState()) return;
      const analysis = candidate?.analysis.documentRevision === document.revision
        ? candidate.analysis
        : await client.analyze(documentId);
      if (!ownsState()) return;
      if (analysis.documentRevision !== document.revision) {
        throw new Error('Analysis revision does not match the document');
      }
      const loadedKeys = new Set(selections.map(encodeVocabularyKey));
      selectedKeysRef.current = loadedKeys;
      desiredSelectionKeysRef.current = loadedKeys;
      setSelectedKeys(loadedKeys);
      setDisplayPreferences(new Map(loadedDisplayPreferences.map((preference) => [
        encodeVocabularyKey(preference.key), preference.visibility,
      ])));
      setSnapshot({ document, analysis });
      setAreSelectionsHydrated(true);
      setAreDisplayPreferencesHydrated(true);
    } catch (error) {
      if (ownsState()) {
        setHasError(true);
        setLoadErrorStatus(error instanceof ApiError ? error.status : null);
      }
    } finally {
      if (ownsState()) setIsLoading(false);
    }
  }, [client, documentId]);

  useEffect(() => {
    void loadReader(routedSnapshot);
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadReader, routedSnapshot]);

  const toggleVocabulary = useCallback((key: string) => {
    if (!areSelectionsHydrated) return;
    const decoded = decodeVocabularyKey(key);
    if (decoded === null) return;
    const next = new Set(desiredSelectionKeysRef.current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    desiredSelectionKeysRef.current = next;
    setPersistenceNotice(null);
    const intentVersion = ++selectionIntentVersionRef.current;

    const selections = [...next]
      .map(decodeVocabularyKey)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const write = selectionWriteChainRef.current.then(async () => {
      try {
        await client.replaceVocabularySelections(documentId, selections);
        selectedKeysRef.current = next;
        setSelectedKeys(next);
      } catch {
        try {
          const serverSelections = await client.listVocabularySelections(documentId);
          const confirmedKeys = new Set(serverSelections.map(encodeVocabularyKey));
          selectedKeysRef.current = confirmedKeys;
          setSelectedKeys(confirmedKeys);
          if (selectionIntentVersionRef.current === intentVersion) {
            desiredSelectionKeysRef.current = confirmedKeys;
          }
        } catch {
          if (selectionIntentVersionRef.current === intentVersion) {
            desiredSelectionKeysRef.current = selectedKeysRef.current;
          }
        }
        setPersistenceNotice({
          kind: 'error',
          message: 'Não foi possível salvar as marcações.',
        });
      }
    });
    selectionWriteChainRef.current = write;
  }, [areSelectionsHydrated, client, documentId]);

  const updateReaderPreferences = useCallback((nextPreferences: ReaderPreferences) => {
    saveReaderPreferences(nextPreferences);
    setReaderPreferences(nextPreferences);
  }, []);

  const setFuriganaVisibility = useCallback(async (
    key: string,
    visibility: FuriganaVisibility,
  ) => {
    if (!areDisplayPreferencesHydrated) return;
    const decoded = decodeVocabularyKey(key);
    if (decoded === null) return;
    try {
      await client.setVocabularyDisplayPreference(documentId, {
        key: decoded,
        visibility,
      });
      setDisplayPreferences((current) => {
        const next = new Map(current);
        next.set(key, visibility);
        return next;
      });
    } catch {
      setPersistenceNotice({
        kind: 'error',
        message: 'Não foi possível salvar a preferência de furigana.',
      });
    }
  }, [areDisplayPreferencesHydrated, client, documentId]);

  const refreshReadingOccurrence = useCallback(async (
    key: ReadingOverrideKey,
    mutation: () => Promise<ReadingOverrideOperation>,
    operationLabel: 'aplicada' | 'removida',
  ) => {
    setPersistenceNotice(null);
    try {
      if (snapshot === null || snapshot.analysis.documentRevision !== key.documentRevision) {
        throw new Error('Reading override is no longer on the displayed revision');
      }
      const operation = await mutation();
      const refreshed = await client.analyze(documentId);
      setSnapshot((current) => {
        if (current === null || current.analysis.documentRevision !== key.documentRevision) {
          return current;
        }
        return {
          ...current,
          analysis: operation.affectedOccurrenceCount > 1
            ? refreshed
            : replaceAnalysisOccurrence(current.analysis, refreshed, key),
        };
      });
      if (key.scope === 'vocabulary' && operation.affectedOccurrenceCount > 1) {
        setPersistenceNotice({
          kind: 'success',
          message: `Correção ${operationLabel} em ${operation.affectedOccurrenceCount} ocorrências.`,
        });
      }
      return operation;
    } catch (error) {
      setPersistenceNotice({
        kind: 'error',
        message: 'Não foi possível salvar a correção de leitura.',
      });
      throw error;
    }
  }, [client, documentId, snapshot]);

  const saveReadingOverride = useCallback(async (override: SetReadingOverride) => {
    const key: ReadingOverrideKey = {
      documentRevision: override.documentRevision,
      startOffset: override.startOffset,
      endOffset: override.endOffset,
      scope: override.scope,
      vocabularyKey: override.vocabularyKey,
    };
    return refreshReadingOccurrence(
      key,
      () => client.setReadingOverride(documentId, override),
      'aplicada',
    );
  }, [client, documentId, refreshReadingOccurrence]);

  const removeReadingOverride = useCallback(async (key: ReadingOverrideKey) => {
    return refreshReadingOccurrence(
      key,
      () => client.deleteReadingOverride(documentId, key),
      'removida',
    );
  }, [client, documentId, refreshReadingOccurrence]);

  const saveDocumentTags = useCallback(async (tags: Document['tags']) => {
    const updated = await client.update(documentId, { tags });
    setSnapshot((current) => current === null ? current : { ...current, document: updated });
  }, [client, documentId]);

  const createDocumentTag = useCallback(async (tag: Document['tags'][number]) => {
    if (client.createTag === undefined) throw new Error('Tag API unavailable');
    return client.createTag(tag);
  }, [client]);

  const loadTagCatalog = useCallback(async () => {
    if (client.listTags === undefined) throw new Error('Tag API unavailable');
    return client.listTags();
  }, [client]);

  if (isLoading) {
    return <p className="page-state" role="status">Preparando leitura…</p>;
  }

  if (hasError || snapshot === null) {
    if (loadErrorStatus === 404) {
      return (
        <section className="page-state" aria-labelledby="reader-error-title">
          <p className="eyebrow">Leitura indisponível</p>
          <h1 id="reader-error-title">Documento não encontrado.</h1>
          <p>Ele pode ter sido excluído da biblioteca.</p>
          <a
            className="button button--primary button-link"
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate('/');
            }}
          >
            Voltar à biblioteca
          </a>
        </section>
      );
    }
    return (
      <section className="page-state" aria-labelledby="reader-error-title">
        <p className="eyebrow">Leitura indisponível</p>
        <h1 id="reader-error-title">Não foi possível preparar a leitura.</h1>
        <p>Você pode tentar novamente sem alterar o documento.</p>
        <button className="button button--primary" type="button" onClick={() => void loadReader(null)}>
          Tentar novamente
        </button>
      </section>
    );
  }

  return (
    <div className="reader-layout">
      <aside className="reader-rail" aria-label="Ações do leitor">
        <a
          className="reader-rail__button"
          href="/"
          aria-label="Voltar à biblioteca"
          title="Voltar à biblioteca"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          <span aria-hidden="true">←</span>
        </a>
        <a
          className="reader-rail__button"
          href={`/documents/${encodeURIComponent(documentId)}/edit`}
          aria-label="Editar documento"
          title="Editar documento"
          onClick={(event) => {
            event.preventDefault();
            navigate(`/documents/${encodeURIComponent(documentId)}/edit`);
          }}
        >
          <span aria-hidden="true">✎</span>
        </a>
        <ReaderTagsPopup
          tags={snapshot.document.tags}
          loadCatalog={loadTagCatalog}
          onSaveTags={saveDocumentTags}
          onCreateTag={createDocumentTag}
        />
        <ReaderMenu
          preferences={readerPreferences}
          onPreferencesChange={updateReaderPreferences}
        />
      </aside>
      <article className="reader-page" aria-labelledby="reader-title">
        <header className="reader-heading">
          <h1 id="reader-title">{snapshot.document.title || 'Sem título'}</h1>
        </header>
        {persistenceNotice && (
          <div
            className={`reader-persistence-status reader-persistence-status--${persistenceNotice.kind}`}
            role={persistenceNotice.kind === 'error' ? 'alert' : 'status'}
            aria-live={persistenceNotice.kind === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            {persistenceNotice.message}
          </div>
        )}
        <DocumentText
          content={snapshot.document.content}
          analysis={snapshot.analysis}
          selectedKeys={selectedKeys}
          onToggleVocabulary={areSelectionsHydrated ? toggleVocabulary : undefined}
          showFurigana={readerPreferences.showFurigana}
          fontSizePx={readerPreferences.fontSizePx}
          furiganaVisibilityByKey={displayPreferences}
          onSetFuriganaVisibility={
            areDisplayPreferencesHydrated ? setFuriganaVisibility : undefined
          }
          onSaveReadingOverride={saveReadingOverride}
          onRemoveReadingOverride={removeReadingOverride}
        />
        <ReviewList
          entries={orderedVocabularyEntries(snapshot.analysis, selectedKeys)}
          onRemove={areSelectionsHydrated ? toggleVocabulary : () => undefined}
        />
      </article>
    </div>
  );
}
