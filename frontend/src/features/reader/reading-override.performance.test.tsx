import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { Profiler } from 'react';
import { describe, expect, it, vi } from 'vitest';
import scenarios from '../../../../tests/fixtures/reading_override_cases.json';
import { AppProviders } from '../../app/providers';
import type {
  Analysis,
  AnalyzedToken,
  Document,
  DocumentClient,
  ReadingOverrideOperation,
  SetReadingOverride,
} from '../../shared/api/client';
import { ReaderPage } from './ReaderPage';

const RUNS = 3;
const DOCUMENT_ID = '00000000-0000-0000-0000-000000000019';
const VOCABULARY_KEY = '["昨日","きのう"]';
const scopes = ['local', 'vocabulary'] as const;
const operations = ['set', 'replace', 'delete'] as const;
type Scope = (typeof scopes)[number];
type Operation = (typeof operations)[number];
type CorpusCase = (typeof scenarios.cases)[number];

interface Fixture {
  document: Document;
  analysis: Analysis;
  targetOffsets: number[];
}

interface Measurement {
  codePoints: number;
  case: string;
  scope: Scope;
  operation: Operation;
  runs: number;
  renderedTokenCount: number;
  changedTokenCount: number;
  rawSamples: Array<{
    submit_to_client_call_ms: number;
    client_resolution_to_visible_update_ms: number;
    submit_to_visible_update_ms: number;
    react_profiler_commit_durations_ms: number[];
  }>;
  medians: {
    submit_to_client_call_ms: number;
    client_resolution_to_visible_update_ms: number;
    submit_to_visible_update_ms: number;
    react_profiler_commit_durations_ms: number;
  };
}

function corpus(caseDefinition: CorpusCase): string {
  return Array.from(
    scenarios.seed.repeat(Math.ceil(caseDefinition.codePoints / Array.from(scenarios.seed).length)),
  ).slice(0, caseDefinition.codePoints).join('');
}

function createFixture(caseDefinition: CorpusCase, operation: Operation): Fixture {
  const content = corpus(caseDefinition);
  const codePoints = Array.from(content);
  const targetOffsets: number[] = [];
  for (let index = 0; index < codePoints.length - 1; index += 1) {
    if (codePoints[index] === '昨' && codePoints[index + 1] === '日') targetOffsets.push(index);
  }
  const initiallyOverridden = operation !== 'set';
  const tokens: AnalyzedToken[] = targetOffsets.map((startOffset) => ({
    startOffset,
    endOffset: startOffset + scenarios.target.length,
    surface: scenarios.target,
    lemma: scenarios.target,
    reading: initiallyOverridden ? scenarios.replacementReading : scenarios.dictionaryReading,
    dictionaryReading: scenarios.dictionaryReading,
    partOfSpeech: ['名詞', '普通名詞', '副詞可能', '*', '*', '*'],
    isOutOfVocabulary: false,
    isLexical: true,
    vocabularyKey: VOCABULARY_KEY,
    furiganaSegments: [{
      text: scenarios.target,
      reading: initiallyOverridden ? scenarios.replacementReading : scenarios.dictionaryReading,
    }],
    hasReadingOverride: initiallyOverridden,
  }));
  return {
    document: {
      id: DOCUMENT_ID,
      title: 'Reading override performance fixture',
      content,
      description: null,
      tags: [],
      revision: 1,
      createdAt: '2026-11-07T00:00:00Z',
      updatedAt: '2026-11-07T00:00:00Z',
      lastReadAt: null,
    },
    analysis: {
      documentId: DOCUMENT_ID,
      documentRevision: 1,
      contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
      metadata: {
        analyzerName: 'performance-fixture', analyzerVersion: '1',
        dictionaryName: 'performance-fixture', dictionaryVersion: '1', splitMode: 'B',
      },
      analysisOptions: { splitMode: 'B' },
      blocks: [{ startOffset: 0, endOffset: codePoints.length, tokens }],
      diagnostics: [],
    },
    targetOffsets,
  };
}

function refreshedAnalysis(fixture: Fixture, scope: Scope, operation: Operation): Analysis {
  const changedOffsets = scope === 'vocabulary'
    ? new Set(fixture.targetOffsets)
    : new Set([fixture.targetOffsets[0]]);
  const reading = operation === 'delete' ? scenarios.dictionaryReading : (
    operation === 'replace' ? scenarios.dictionaryReading : scenarios.replacementReading
  );
  const initialOverride = operation !== 'set';
  return {
    ...fixture.analysis,
    blocks: fixture.analysis.blocks.map((block) => ({
      ...block,
      tokens: block.tokens.map((token) => {
        if (!changedOffsets.has(token.startOffset)) return token;
        return {
          ...token,
          reading,
          furiganaSegments: [{ text: scenarios.target, reading }],
          hasReadingOverride: operation === 'delete' ? false : true,
        };
      }),
    })),
  };
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return Number(ordered[Math.floor(ordered.length / 2)].toFixed(3));
}

function readingFor(operation: Operation): string {
  return operation === 'replace' ? scenarios.dictionaryReading : scenarios.replacementReading;
}

function expectedChangedCount(fixture: Fixture, scope: Scope): number {
  return scope === 'vocabulary' ? fixture.targetOffsets.length : 1;
}

function makeClient(fixture: Fixture, scope: Scope, operation: Operation, pending = false) {
  let mutationFinished = false;
  let releaseMutation: (() => void) | undefined;
  let clientCalledAt = 0;
  let clientResolutionAt = 0;
  const operationResult: ReadingOverrideOperation = {
    affectedOccurrenceCount: expectedChangedCount(fixture, scope),
    overrides: [],
  };
  const mutate = () => {
    clientCalledAt = performance.now();
    const complete = () => {
      mutationFinished = true;
      clientResolutionAt = performance.now();
      return operationResult;
    };
    if (!pending) return Promise.resolve(complete());
    return new Promise<ReadingOverrideOperation>((resolve) => {
      releaseMutation = () => resolve(complete());
    });
  };
  const setReadingOverride = vi.fn((_id: string, _override: SetReadingOverride) => mutate());
  const deleteReadingOverride = vi.fn(() => mutate());
  const client: DocumentClient = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(fixture.document),
    get: vi.fn().mockResolvedValue(fixture.document),
    update: vi.fn().mockResolvedValue(fixture.document),
    delete: vi.fn().mockResolvedValue(undefined),
    analyze: vi.fn(() => Promise.resolve(
      mutationFinished ? refreshedAnalysis(fixture, scope, operation) : fixture.analysis,
    )),
    listVocabularySelections: vi.fn().mockResolvedValue([]),
    replaceVocabularySelections: vi.fn().mockResolvedValue(undefined),
    listVocabularyDisplayPreferences: vi.fn().mockResolvedValue([]),
    setVocabularyDisplayPreference: vi.fn().mockResolvedValue(undefined),
    setReadingOverride,
    deleteReadingOverride,
  };
  return {
    client,
    setReadingOverride,
    deleteReadingOverride,
    release: () => releaseMutation?.(),
    clientCalledAt: () => clientCalledAt,
    clientResolutionAt: () => clientResolutionAt,
  };
}

function renderReader(client: DocumentClient, profilerDurations: number[] = []) {
  return render(
    <Profiler
      id="reading-override-reconciliation"
      onRender={(_id, _phase, actualDuration) => profilerDurations.push(Number(actualDuration.toFixed(3)))}
    >
      <AppProviders client={client} initialPath={`/documents/${DOCUMENT_ID}/read`}>
        <ReaderPage documentId={DOCUMENT_ID} />
      </AppProviders>
    </Profiler>,
  );
}

async function openDialog(reading: string) {
  const occurrences = await screen.findAllByRole('button', { name: `昨日（${reading}）` });
  fireEvent.contextMenu(occurrences[0]);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Corrigir leitura' }));
}

function assertCanonicalText(content: string) {
  const reader = screen.getByTestId('document-text').cloneNode(true) as HTMLElement;
  reader.querySelectorAll('rt').forEach((node) => node.remove());
  expect(reader.textContent).toBe(content);
}

async function submit(scope: Scope, operation: Operation) {
  if (scope === 'vocabulary') {
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Aplicar a todas as ocorrências desta palavra',
    }));
  }
  if (operation === 'delete') {
    fireEvent.click(screen.getByRole('button', { name: 'Remover correção' }));
    return;
  }
  fireEvent.change(screen.getByLabelText('Nova leitura em kana'), {
    target: { value: readingFor(operation) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }));
}

async function assertVisibleUpdate(
  fixture: Fixture,
  scope: Scope,
  operation: Operation,
) {
  const expectedReading = operation === 'delete' ? scenarios.dictionaryReading : readingFor(operation);
  await waitFor(() => {
    const readings = Array.from(screen.getByTestId('document-text').querySelectorAll('rt'))
      .map((node) => node.textContent);
    const changedCount = readings.filter((reading) => reading === expectedReading).length;
    expect(changedCount).toBe(expectedChangedCount(fixture, scope));
    expect(readings).toEqual(fixture.targetOffsets.map((offset) => (
      scope === 'vocabulary' || offset === fixture.targetOffsets[0]
        ? expectedReading
        : (operation === 'set' ? scenarios.dictionaryReading : scenarios.replacementReading)
    )));
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  assertCanonicalText(fixture.document.content);
}

describe('reading override UI performance', () => {
  it('binds every frontend corpus to the shared Unicode manifest before rendering', () => {
    for (const caseDefinition of scenarios.cases) {
      const fixture = createFixture(caseDefinition, 'set');
      expect(Array.from(fixture.document.content)).toHaveLength(caseDefinition.codePoints);
      expect(fixture.analysis.contentHash).toBe(caseDefinition.sha256);
      expect(fixture.targetOffsets).toHaveLength(caseDefinition.targetOccurrences);
    }
  });

  for (const operation of operations) {
    for (const scope of scopes) {
      it(`submits ${operation} in ${scope} scope through the real reader dialog`, async () => {
        const fixture = createFixture(scenarios.cases[0], operation);
        const harness = makeClient(fixture, scope, operation, true);
        const view = renderReader(harness.client);
        const initialReading = operation === 'set'
          ? scenarios.dictionaryReading
          : scenarios.replacementReading;
        await openDialog(initialReading);
        await submit(scope, operation);

        expect(screen.getByRole('button', { name: operation === 'delete' ? 'Salvando…' : 'Salvando…' }))
          .toBeDisabled();
        if (operation === 'delete') {
          expect(harness.deleteReadingOverride).toHaveBeenCalledWith(DOCUMENT_ID, {
            documentRevision: 1,
            startOffset: fixture.targetOffsets[0],
            endOffset: fixture.targetOffsets[0] + scenarios.target.length,
            scope,
            ...(scope === 'vocabulary' ? { vocabularyKey: VOCABULARY_KEY } : {}),
          });
        } else {
          expect(harness.setReadingOverride).toHaveBeenCalledWith(DOCUMENT_ID, {
            documentRevision: 1,
            startOffset: fixture.targetOffsets[0],
            endOffset: fixture.targetOffsets[0] + scenarios.target.length,
            scope,
            ...(scope === 'vocabulary' ? { vocabularyKey: VOCABULARY_KEY } : {}),
            reading: readingFor(operation),
          });
        }

        harness.release();
        await assertVisibleUpdate(fixture, scope, operation);
        if (scope === 'vocabulary') {
          const label = operation === 'delete' ? 'removida' : 'aplicada';
          expect(screen.getByRole('status')).toHaveTextContent(
            `Correção ${label} em ${fixture.targetOffsets.length} ocorrências.`,
          );
        }
        view.unmount();
      });
    }
  }

  it('emits raw frontend submission and reconciliation measurements without timing thresholds', async () => {
    const measurements: Measurement[] = [];
    for (const caseDefinition of scenarios.cases) {
      for (const scope of scopes) {
        for (const operation of operations) {
          const rawSamples: Measurement['rawSamples'] = [];
          let renderedTokenCount = 0;
          let changedTokenCount = 0;
          for (let run = 0; run < RUNS; run += 1) {
            const fixture = createFixture(caseDefinition, operation);
            const harness = makeClient(fixture, scope, operation);
            const profilerDurations: number[] = [];
            const view = renderReader(harness.client, profilerDurations);
            const initialReading = operation === 'set'
              ? scenarios.dictionaryReading
              : scenarios.replacementReading;
            await openDialog(initialReading);
            renderedTokenCount = screen.getByTestId('document-text')
              .querySelectorAll('.reader-token').length;
            profilerDurations.length = 0;
            const submittedAt = performance.now();
            await submit(scope, operation);
            await assertVisibleUpdate(fixture, scope, operation);
            const visibleAt = performance.now();
            changedTokenCount = expectedChangedCount(fixture, scope);
            rawSamples.push({
              submit_to_client_call_ms: Number((harness.clientCalledAt() - submittedAt).toFixed(3)),
              client_resolution_to_visible_update_ms: Number((visibleAt - harness.clientResolutionAt()).toFixed(3)),
              submit_to_visible_update_ms: Number((visibleAt - submittedAt).toFixed(3)),
              react_profiler_commit_durations_ms: profilerDurations,
            });
            view.unmount();
          }
          const allCommitDurations = rawSamples.flatMap((sample) => sample.react_profiler_commit_durations_ms);
          measurements.push({
            codePoints: caseDefinition.codePoints,
            case: caseDefinition.name,
            scope,
            operation,
            runs: RUNS,
            renderedTokenCount,
            changedTokenCount,
            rawSamples,
            medians: {
              submit_to_client_call_ms: median(rawSamples.map((sample) => sample.submit_to_client_call_ms)),
              client_resolution_to_visible_update_ms: median(
                rawSamples.map((sample) => sample.client_resolution_to_visible_update_ms),
              ),
              submit_to_visible_update_ms: median(rawSamples.map((sample) => sample.submit_to_visible_update_ms)),
              react_profiler_commit_durations_ms: median(allCommitDurations),
            },
          });
        }
      }
    }
    process.stdout.write(`READING_OVERRIDE_PERFORMANCE ${JSON.stringify({
      manifest: scenarios.name,
      runsPerSizeScopeOperation: RUNS,
      measurements,
    })}\n`);
  }, 360_000);
});
