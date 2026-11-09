import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Analysis,
  type Document,
  type DocumentClient,
  type ReadingException,
} from '../shared/api/client';
import { App } from './App';

const document: Document = {
  id: '00000000-0000-0000-0000-000000000001',
  title: '雪国',
  content: '国境の長いトンネルを抜けると雪国であった。',
  description: null,
  tags: [],
  revision: 1,
  createdAt: '2026-09-26T00:00:00Z',
  updatedAt: '2026-09-26T00:00:00Z',
  lastReadAt: null,
};

const analysis: Analysis = {
  documentId: document.id,
  documentRevision: 1,
  contentHash: 'hash',
  metadata: {
    analyzerName: 'SudachiPy', analyzerVersion: '0.6.11',
    dictionaryName: 'SudachiDict-core', dictionaryVersion: '20250825', splitMode: 'B',
  },
  analysisOptions: { splitMode: 'B' },
  blocks: [{
    startOffset: 0,
    endOffset: 2,
    tokens: [{
      startOffset: 0, endOffset: 2, surface: '国境', lemma: '国境', reading: 'こっきょう',
      dictionaryReading: 'こっきょう', partOfSpeech: ['名詞', '普通名詞', '一般', '*', '*', '*'],
      isOutOfVocabulary: false, isLexical: true, vocabularyKey: '["国境","こっきょう"]',
      furiganaSegments: [{ text: '国境', reading: 'こっきょう' }],
      hasReadingOverride: false,
    }],
  }],
  diagnostics: [],
};

const revisedDocument: Document = {
  ...document,
  title: '雪国 改訂版',
  content: '雪国へ戻った。',
  revision: 2,
  updatedAt: '2026-09-27T00:00:00Z',
};

const revisedAnalysis: Analysis = {
  ...analysis,
  documentRevision: 2,
  contentHash: 'revised-hash',
  blocks: [{
    startOffset: 0,
    endOffset: 2,
    tokens: [{
      startOffset: 0, endOffset: 2, surface: '雪国', lemma: '雪国', reading: 'ゆきぐに',
      dictionaryReading: 'ゆきぐに', partOfSpeech: ['名詞', '普通名詞', '一般', '*', '*', '*'],
      isOutOfVocabulary: false, isLexical: true, vocabularyKey: '["雪国","ゆきぐに"]',
      furiganaSegments: [{ text: '雪国', reading: 'ゆきぐに' }],
      hasReadingOverride: false,
    }],
  }],
};

const readingException: ReadingException = {
  lemma: '今日',
  reading: 'キョウ',
  deletedAt: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function client(overrides: Partial<DocumentClient> = {}): DocumentClient {
  return {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(document),
    get: vi.fn().mockResolvedValue(document),
    update: vi.fn().mockResolvedValue(document),
    delete: vi.fn().mockResolvedValue(undefined),
    analyze: vi.fn().mockResolvedValue(analysis),
    listVocabularySelections: vi.fn().mockResolvedValue([]),
    replaceVocabularySelections: vi.fn().mockResolvedValue(undefined),
    listVocabularyDisplayPreferences: vi.fn().mockResolvedValue([]),
    setVocabularyDisplayPreference: vi.fn().mockResolvedValue(undefined),
    setReadingOverride: vi.fn().mockResolvedValue({
      documentId: document.id,
      documentRevision: 1,
      startOffset: 0,
      endOffset: 2,
      reading: 'こっきょう',
    }),
    deleteReadingOverride: vi.fn().mockResolvedValue(undefined),
    listReadingExceptions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});

it('renders the reading exceptions route with its active primary navigation link', async () => {
  render(<App client={client({
    listReadingExceptions: vi.fn().mockResolvedValue([readingException]),
  })} initialPath="/reading-exceptions" />);

  expect(await screen.findByRole('heading', { name: 'Exceções de leitura', level: 1 }))
    .toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Exceções de leitura' }))
    .toHaveAttribute('href', '/reading-exceptions');
  expect(screen.getByRole('link', { name: 'Exceções de leitura' }))
    .toHaveAttribute('aria-current', 'page');
});

it('migrates a saved legacy theme until settings are changed', () => {
  localStorage.setItem('japanese-reader:theme-preference', 'dark');

  render(<App client={client()} initialPath="/documents/new" />);

  expect(window.document.documentElement).toHaveAttribute('data-theme', 'dark');

  fireEvent.click(screen.getByRole('link', { name: 'Configurações' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Tema claro' }));

  expect(window.document.documentElement).toHaveAttribute('data-theme', 'light');
  expect(localStorage.getItem('japanese-reader:app-settings')).toContain('"theme":"light"');
});

it('uses the system dark preference until the reader has a saved choice', () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });

  render(<App client={client()} initialPath="/documents/new" />);

  expect(window.document.documentElement).toHaveAttribute('data-theme', 'dark');
  expect(localStorage.getItem('japanese-reader:theme-preference')).toBeNull();
});

describe('reader routes', () => {
  it('keeps line-break normalization unavailable when its feature flag explicitly disables it', () => {
    vi.stubEnv('VITE_ENABLE_LINE_BREAK_NORMALIZATION', 'false');
    render(<App client={client()} initialPath="/documents/new" />);

    expect(screen.queryByRole('button', { name: 'Unir quebras de linha' }))
      .not.toBeInTheDocument();
  });

  it('lets the default-enabled line-break normalization action update the draft without saving', () => {
    const api = client();
    render(<App client={api} initialPath="/documents/new" />);

    const contentField = screen.getByLabelText('Texto japonês');
    fireEvent.change(contentField, { target: { value: 'なので\nツナです' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unir quebras de linha' }));

    expect(contentField).toHaveValue('なのでツナです');
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('offers a clear route back to the library when the document is missing', async () => {
    const api = client({
      get: vi.fn().mockRejectedValue(new ApiError(404, {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'Document not found',
      })),
    });
    render(<App client={api} initialPath={`/documents/${document.id}/read`} />);

    expect(await screen.findByRole('heading', { name: 'Documento não encontrado.', level: 1 }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Voltar à biblioteca' }));

    expect(await screen.findByRole('heading', { name: 'Biblioteca', level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('keeps retry available for transient reader loading failures', async () => {
    const get = vi.fn()
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValueOnce(document);
    render(<App client={client({ get })} initialPath={`/documents/${document.id}/read`} />);

    expect(await screen.findByRole('heading', {
      name: 'Não foi possível preparar a leitura.',
      level: 1,
    })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByRole('heading', { name: document.title, level: 1 }))
      .toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('creates, analyzes, and navigates from the editor to semantic reading', async () => {
    const pendingAnalysis = deferred<Analysis>();
    const api = client({ analyze: vi.fn().mockReturnValue(pendingAnalysis.promise) });
    render(<App client={api} initialPath="/documents/new" />);

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: document.title } });
    fireEvent.change(screen.getByLabelText('Texto japonês'), { target: { value: document.content } });
    fireEvent.click(screen.getByRole('button', { name: 'Analisar e ler' }));

    expect(await screen.findByRole('button', { name: 'Analisando…' })).toBeDisabled();
    await act(async () => pendingAnalysis.resolve(analysis));

    expect(await screen.findByRole('heading', { name: document.title, level: 1 })).toBeInTheDocument();
    expect(screen.getByText('こっきょう').parentElement?.tagName).toBe('RUBY');
    expect(window.location.pathname).toBe(`/documents/${document.id}/read`);
  });

  it('preserves the draft after analysis fails and retries the saved document', async () => {
    let attempts = 0;
    const api = client({
      analyze: vi.fn().mockImplementation(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('analyzer unavailable');
        return analysis;
      }),
    });
    render(<App client={api} initialPath="/documents/new" />);

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: document.title } });
    fireEvent.change(screen.getByLabelText('Texto japonês'), { target: { value: document.content } });
    fireEvent.click(screen.getByRole('button', { name: 'Analisar e ler' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível analisar o documento.');
    expect(screen.getByLabelText('Texto japonês')).toHaveValue(document.content);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByRole('heading', { name: document.title, level: 1 })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('loads and updates an existing document from the edit route', async () => {
    const updated = { ...document, title: '雪国 メモ' };
    const api = client({
      get: vi.fn().mockResolvedValue(updated),
      update: vi.fn().mockResolvedValue(updated),
    });
    render(<App client={api} initialPath={`/documents/${document.id}/edit`} />);

    expect(screen.getByText('Carregando documento…')).toBeInTheDocument();
    expect(await screen.findByLabelText('Texto japonês')).toHaveValue(document.content);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: updated.title } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e analisar' }));

    expect(await screen.findByRole('heading', { name: updated.title, level: 1 })).toBeInTheDocument();
  });

  it('asks before discarding reading corrections and preserves the edited form on cancel', async () => {
    const analyze = vi.fn().mockResolvedValue(revisedAnalysis);
    const update = vi.fn().mockRejectedValue(new ApiError(409, {
      type: 'urn:japanese-reader:reading-overrides-confirmation-required',
      title: 'Conflict',
      status: 409,
      detail: 'Editing this content will remove its manual reading corrections',
    }));
    const api = client({ get: vi.fn().mockResolvedValue(document), update, analyze });
    render(<App client={api} initialPath={`/documents/${document.id}/edit`} />);

    const contentField = await screen.findByLabelText('Texto japonês');
    fireEvent.change(contentField, { target: { value: revisedDocument.content } });
    const saveButton = screen.getByRole('button', { name: 'Salvar e analisar' });
    fireEvent.click(saveButton);

    const dialog = await screen.findByRole('dialog', { name: 'Remover correções de leitura?' });
    expect(within(dialog).getByText(/correções manuais de leitura serão removidas/i))
      .toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const cancelButton = within(dialog).getByRole('button', { name: 'Cancelar' });
    const confirmButton = within(dialog).getByRole('button', {
      name: 'Continuar e remover correções',
    });
    expect(cancelButton).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(confirmButton).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(cancelButton).toHaveFocus();
    fireEvent.click(cancelButton);

    expect(screen.queryByRole('dialog', { name: 'Remover correções de leitura?' }))
      .not.toBeInTheDocument();
    expect(contentField).toHaveValue(revisedDocument.content);
    expect(saveButton).toHaveFocus();
    expect(update).toHaveBeenCalledTimes(1);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('repeats an affected content edit only after explicit confirmation', async () => {
    let currentDocument = document;
    const update = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, {
        type: 'urn:japanese-reader:reading-overrides-confirmation-required',
        title: 'Conflict',
        status: 409,
        detail: 'Editing this content will remove its manual reading corrections',
      }))
      .mockImplementationOnce(async () => {
        currentDocument = revisedDocument;
        return revisedDocument;
      });
    const api = client({
      get: vi.fn().mockImplementation(async () => currentDocument),
      update,
      analyze: vi.fn().mockResolvedValue(revisedAnalysis),
    });
    render(<App client={api} initialPath={`/documents/${document.id}/edit`} />);

    await screen.findByLabelText('Texto japonês');
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: revisedDocument.title } });
    fireEvent.change(screen.getByLabelText('Texto japonês'), {
      target: { value: revisedDocument.content },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e analisar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remover correções de leitura?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar e remover correções' }));

    expect(await screen.findByRole('heading', { name: revisedDocument.title, level: 1 }))
      .toBeInTheDocument();
    expect(update).toHaveBeenNthCalledWith(1, document.id, {
      title: revisedDocument.title,
      content: revisedDocument.content,
    });
    expect(update).toHaveBeenNthCalledWith(2, document.id, {
      title: revisedDocument.title,
      content: revisedDocument.content,
      confirmReadingOverrideRemoval: true,
    });
  });

  it('keeps the edited form when the confirmed content update fails', async () => {
    const update = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, {
        type: 'urn:japanese-reader:reading-overrides-confirmation-required',
        title: 'Conflict',
        status: 409,
        detail: 'Editing this content will remove its manual reading corrections',
      }))
      .mockRejectedValueOnce(new Error('server unavailable'));
    const api = client({ get: vi.fn().mockResolvedValue(document), update });
    render(<App client={api} initialPath={`/documents/${document.id}/edit`} />);

    const contentField = await screen.findByLabelText('Texto japonês');
    fireEvent.change(contentField, { target: { value: revisedDocument.content } });
    const saveButton = screen.getByRole('button', { name: 'Salvar e analisar' });
    fireEvent.click(saveButton);
    const dialog = await screen.findByRole('dialog', { name: 'Remover correções de leitura?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar e remover correções' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível salvar o documento. Seu texto continua aqui.',
    );
    expect(contentField).toHaveValue(revisedDocument.content);
    expect(screen.queryByRole('dialog', { name: 'Remover correções de leitura?' }))
      .not.toBeInTheDocument();
    expect(saveButton).toHaveFocus();
  });

  it('discards an analysis from revision 1 after the editor saves revision 2', async () => {
    const staleAnalysis = deferred<Analysis>();
    let currentDocument = document;
    const api = client({
      get: vi.fn().mockImplementation(async () => currentDocument),
      update: vi.fn().mockImplementation(async () => {
        currentDocument = revisedDocument;
        return revisedDocument;
      }),
      analyze: vi.fn().mockReturnValue(staleAnalysis.promise),
    });
    render(<App client={api} initialPath={`/documents/${document.id}/edit`} />);

    expect(await screen.findByLabelText('Texto japonês')).toHaveValue(document.content);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: revisedDocument.title } });
    fireEvent.change(screen.getByLabelText('Texto japonês'), {
      target: { value: revisedDocument.content },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e analisar' }));
    await act(async () => staleAnalysis.resolve(analysis));

    expect(await screen.findByRole('heading', { name: 'Editar documento', level: 1 }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Texto japonês')).toHaveValue(revisedDocument.content);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A análise recebida pertence a uma versão anterior do documento.',
    );
    expect(window.location.pathname).toBe(`/documents/${document.id}/edit`);
  });

  it('revalidates an older reader history entry before keeping its snapshot', async () => {
    let currentDocument = document;
    const api = client({
      get: vi.fn().mockImplementation(async () => currentDocument),
      update: vi.fn().mockImplementation(async () => {
        currentDocument = revisedDocument;
        return revisedDocument;
      }),
      analyze: vi.fn().mockImplementation(async () => (
        currentDocument.revision === 1 ? analysis : revisedAnalysis
      )),
    });
    render(<App client={api} initialPath="/documents/new" />);

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: document.title } });
    fireEvent.change(screen.getByLabelText('Texto japonês'), { target: { value: document.content } });
    fireEvent.click(screen.getByRole('button', { name: 'Analisar e ler' }));
    expect(await screen.findByRole('heading', { name: document.title, level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Editar documento' }));
    expect(await screen.findByLabelText('Texto japonês')).toHaveValue(document.content);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: revisedDocument.title } });
    fireEvent.change(screen.getByLabelText('Texto japonês'), {
      target: { value: revisedDocument.content },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e analisar' }));
    expect(await screen.findByRole('heading', {
      name: revisedDocument.title,
      level: 1,
    })).toBeInTheDocument();

    act(() => window.history.back());
    expect(await screen.findByLabelText('Texto japonês')).toHaveValue(revisedDocument.content);

    act(() => window.history.back());

    expect(await screen.findByRole('heading', {
      name: revisedDocument.title,
      level: 1,
    })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/documents/${document.id}/read`);
    expect(screen.getByText('ゆきぐに').parentElement?.tagName).toBe('RUBY');
  });

  it('ignores an older StrictMode success after a newer reader request wins', async () => {
    const staleDocument = deferred<Document>();
    const api = client({
      get: vi.fn()
        .mockReturnValueOnce(staleDocument.promise)
        .mockResolvedValue(revisedDocument),
      analyze: vi.fn()
        .mockResolvedValueOnce(revisedAnalysis)
        .mockResolvedValue(analysis),
    });
    render(
      <StrictMode>
        <App client={api} initialPath={`/documents/${document.id}/read`} />
      </StrictMode>,
    );

    expect(await screen.findByRole('heading', {
      name: revisedDocument.title,
      level: 1,
    })).toBeInTheDocument();

    await act(async () => {
      staleDocument.resolve(document);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('heading', {
      name: revisedDocument.title,
      level: 1,
    })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: document.title, level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText('ゆきぐに').parentElement?.tagName).toBe('RUBY');
  });

  it('ignores an older StrictMode failure after a newer reader request wins', async () => {
    const staleDocument = deferred<Document>();
    const api = client({
      get: vi.fn()
        .mockReturnValueOnce(staleDocument.promise)
        .mockResolvedValue(revisedDocument),
      analyze: vi.fn().mockResolvedValue(revisedAnalysis),
    });
    render(
      <StrictMode>
        <App client={api} initialPath={`/documents/${document.id}/read`} />
      </StrictMode>,
    );

    expect(await screen.findByRole('heading', {
      name: revisedDocument.title,
      level: 1,
    })).toBeInTheDocument();

    await act(async () => {
      staleDocument.reject(new Error('stale request failed'));
      await Promise.resolve();
    });

    expect(screen.getByRole('heading', {
      name: revisedDocument.title,
      level: 1,
    })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('serializes replacement writes so rapid toggles cannot persist stale state', async () => {
    const firstWrite = deferred<void>();
    const replaceVocabularySelections = vi.fn()
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValue(undefined);
    const api = client({ replaceVocabularySelections });
    render(<App client={api} initialPath={`/documents/${document.id}/read`} />);
    const token = await screen.findByRole('button', { name: '国境（こっきょう）' });

    fireEvent.click(token);
    fireEvent.click(token);

    await waitFor(() => expect(replaceVocabularySelections).toHaveBeenCalledTimes(1));
    expect(replaceVocabularySelections).toHaveBeenNthCalledWith(1, document.id, [
      { lemma: '国境', reading: 'こっきょう' },
    ]);

    await act(async () => firstWrite.resolve());
    await waitFor(() => expect(replaceVocabularySelections).toHaveBeenCalledTimes(2));
    expect(replaceVocabularySelections).toHaveBeenNthCalledWith(2, document.id, []);
  });

  it('does not expose a routed snapshot for vocabulary changes before selections hydrate', async () => {
    const pendingSelections = deferred<{ lemma: string; reading: string | null }[]>();
    const replaceVocabularySelections = vi.fn().mockResolvedValue(undefined);
    const api = client({
      listVocabularySelections: vi.fn().mockReturnValue(pendingSelections.promise),
      replaceVocabularySelections,
    });
    window.history.replaceState({ document, analysis }, '', `/documents/${document.id}/read`);

    render(<App client={api} />);

    const tokenText = await screen.findByText('国境');
    fireEvent.click(tokenText);
    expect(screen.getByRole('button', { name: '国境（こっきょう）' }))
      .not.toHaveAttribute('aria-pressed');
    expect(replaceVocabularySelections).not.toHaveBeenCalled();

    await act(async () => pendingSelections.resolve([{ lemma: '国境', reading: 'こっきょう' }]));

    expect(await screen.findByRole('button', { name: '国境（こっきょう）' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('reconciles with the server when the first queued selection write fails', async () => {
    const firstWrite = deferred<void>();
    const listVocabularySelections = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const replaceVocabularySelections = vi.fn()
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValue(undefined);
    const api = client({ listVocabularySelections, replaceVocabularySelections });
    render(<App client={api} initialPath={`/documents/${document.id}/read`} />);
    const token = await screen.findByRole('button', { name: '国境（こっきょう）' });

    fireEvent.click(token);
    fireEvent.click(token);
    await waitFor(() => expect(replaceVocabularySelections).toHaveBeenCalledTimes(1));
    await act(async () => firstWrite.reject(new Error('network unavailable')));

    await waitFor(() => expect(replaceVocabularySelections).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listVocabularySelections).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: '国境（こっきょう）' }))
      .toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Não foi possível salvar as marcações.')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Não foi possível salvar as marcações.'))
      .toHaveClass('reader-persistence-status--error');
  });

  it('restores the confirmed server selections when the last queued write fails', async () => {
    const secondWrite = deferred<void>();
    const listVocabularySelections = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ lemma: '国境', reading: 'こっきょう' }]);
    const replaceVocabularySelections = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(secondWrite.promise);
    const api = client({ listVocabularySelections, replaceVocabularySelections });
    render(<App client={api} initialPath={`/documents/${document.id}/read`} />);
    const token = await screen.findByRole('button', { name: '国境（こっきょう）' });

    fireEvent.click(token);
    fireEvent.click(token);
    await waitFor(() => expect(replaceVocabularySelections).toHaveBeenCalledTimes(2));
    await act(async () => secondWrite.reject(new Error('network unavailable')));

    await waitFor(() => expect(listVocabularySelections).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: '国境（こっきょう）' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Não foi possível salvar as marcações.')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Não foi possível salvar as marcações.'))
      .toHaveClass('reader-persistence-status--error');
  });

  it('applies a key display preference over the global setting without reanalyzing', async () => {
    const listVocabularyDisplayPreferences = vi.fn().mockResolvedValue([
      { key: { lemma: '国境', reading: 'こっきょう' }, visibility: 'hide' as const },
    ]);
    const setVocabularyDisplayPreference = vi.fn().mockResolvedValue(undefined);
    const api = client({ listVocabularyDisplayPreferences, setVocabularyDisplayPreference });
    render(<App client={api} initialPath={`/documents/${document.id}/read`} />);

    const token = await screen.findByRole('button', { name: '国境（こっきょう）' });
    expect(screen.getByText('こっきょう')).toHaveAttribute('hidden');
    expect(api.analyze).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('document-text')).toHaveStyle({ fontSize: '24px' });

    for (let increment = 0; increment < 4; increment += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Aumentar tamanho da fonte japonesa' }));
    }
    expect(screen.getByTestId('document-text')).toHaveStyle({ fontSize: '28px' });
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar furigana' }));
    expect(api.analyze).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(token);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mostrar furigana' }));
    await waitFor(() => expect(setVocabularyDisplayPreference).toHaveBeenCalledWith(document.id, {
      key: { lemma: '国境', reading: 'こっきょう' },
      visibility: 'show',
    }));
    await waitFor(() => expect(screen.getAllByText('こっきょう').find(
      (element) => element.tagName === 'RT',
    )).not.toHaveAttribute('hidden'));
  });

  it('refreshes only the corrected occurrence after saving a manual reading', async () => {
    const repeatedAnalysis: Analysis = {
      ...analysis,
      blocks: [{
        startOffset: 0,
        endOffset: 5,
        tokens: [
          {
            ...analysis.blocks[0].tokens[0],
            startOffset: 0,
            endOffset: 2,
            surface: '昨日',
            lemma: '昨日',
            reading: 'きのう',
            dictionaryReading: 'きのう',
            vocabularyKey: '["昨日","きのう"]',
            furiganaSegments: [{ text: '昨日', reading: 'きのう' }],
          },
          {
            ...analysis.blocks[0].tokens[0],
            startOffset: 3,
            endOffset: 5,
            surface: '昨日',
            lemma: '昨日',
            reading: 'きのう',
            dictionaryReading: 'きのう',
            vocabularyKey: '["昨日","きのう"]',
            furiganaSegments: [{ text: '昨日', reading: 'きのう' }],
          },
        ],
      }],
    };
    const overriddenAnalysis: Analysis = {
      ...repeatedAnalysis,
      blocks: [{
        ...repeatedAnalysis.blocks[0],
        tokens: [
          repeatedAnalysis.blocks[0].tokens[0],
          {
            ...repeatedAnalysis.blocks[0].tokens[1],
            reading: 'さくじつ',
            hasReadingOverride: true,
            furiganaSegments: [{ text: '昨日', reading: 'さくじつ' }],
          },
        ],
      }],
    };
    const repeatedDocument = { ...document, content: '昨日、昨日' };
    const setReadingOverride = vi.fn().mockResolvedValue({
      documentId: document.id,
      documentRevision: 1,
      startOffset: 3,
      endOffset: 5,
      reading: 'さくじつ',
    });
    const api = client({
      get: vi.fn().mockResolvedValue(repeatedDocument),
      analyze: vi.fn()
        .mockResolvedValueOnce(repeatedAnalysis)
        .mockResolvedValueOnce(overriddenAnalysis),
      setReadingOverride,
    });
    render(<App client={api} initialPath={`/documents/${document.id}/read`} />);

    const occurrences = await screen.findAllByRole('button', { name: '昨日（きのう）' });
    fireEvent.contextMenu(occurrences[1]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Corrigir leitura' }));
    fireEvent.change(screen.getByLabelText('Nova leitura em kana'), {
      target: { value: 'さくじつ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }));

    await waitFor(() => expect(setReadingOverride).toHaveBeenCalledWith(document.id, {
      documentRevision: 1,
      startOffset: 3,
      endOffset: 5,
      scope: 'local',
      reading: 'さくじつ',
    }));
    await waitFor(() => {
      expect(screen.getAllByText('きのう')).toHaveLength(1);
      expect(screen.getByText('さくじつ')).toBeInTheDocument();
    });
  });

  it('refreshes all matching tokens and reports the affected count after a global correction', async () => {
    const repeatedAnalysis: Analysis = {
      ...analysis,
      blocks: [{
        startOffset: 0,
        endOffset: 5,
        tokens: [
          {
            ...analysis.blocks[0].tokens[0], startOffset: 0, endOffset: 2,
            surface: '昨日', lemma: '昨日', reading: 'きのう',
            dictionaryReading: 'きのう', vocabularyKey: '["昨日","きのう"]',
            furiganaSegments: [{ text: '昨日', reading: 'きのう' }],
          },
          {
            ...analysis.blocks[0].tokens[0], startOffset: 3, endOffset: 5,
            surface: '昨日', lemma: '昨日', reading: 'きのう',
            dictionaryReading: 'きのう', vocabularyKey: '["昨日","きのう"]',
            furiganaSegments: [{ text: '昨日', reading: 'きのう' }],
          },
        ],
      }],
    };
    const overriddenAnalysis: Analysis = {
      ...repeatedAnalysis,
      blocks: [{
        ...repeatedAnalysis.blocks[0],
        tokens: repeatedAnalysis.blocks[0].tokens.map((token) => ({
          ...token, reading: 'さくじつ', hasReadingOverride: true,
          furiganaSegments: [{ text: '昨日', reading: 'さくじつ' }],
        })),
      }],
    };
    const setReadingOverride = vi.fn().mockResolvedValue({
      affectedOccurrenceCount: 2,
      overrides: [],
    });
    const api = client({
      get: vi.fn().mockResolvedValue({ ...document, content: '昨日、昨日' }),
      analyze: vi.fn()
        .mockResolvedValueOnce(repeatedAnalysis)
        .mockResolvedValueOnce(overriddenAnalysis),
      setReadingOverride,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App client={api} initialPath={`/documents/${document.id}/read`} />);

    const occurrences = await screen.findAllByRole('button', { name: '昨日（きのう）' });
    fireEvent.contextMenu(occurrences[1]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Corrigir leitura' }));
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Aplicar a todas as ocorrências desta palavra',
    }));
    fireEvent.change(screen.getByLabelText('Nova leitura em kana'), {
      target: { value: 'さくじつ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }));

    await waitFor(() => expect(setReadingOverride).toHaveBeenCalledWith(document.id, {
      documentRevision: 1, startOffset: 3, endOffset: 5, scope: 'vocabulary',
      vocabularyKey: '["昨日","きのう"]', reading: 'さくじつ',
    }));
    const persistenceStatus = await screen.findByText('Correção aplicada em 2 ocorrências.');
    expect(persistenceStatus).toHaveAttribute('role', 'status');
    expect(persistenceStatus).toHaveClass('reader-persistence-status--success');
    expect(persistenceStatus.nextElementSibling).toBe(screen.getByTestId('document-text'));
    expect(screen.getAllByText('さくじつ')).toHaveLength(2);
  });

  it('keeps both occurrences when two reading corrections finish concurrently', async () => {
    const baseAnalysis: Analysis = {
      ...analysis,
      blocks: [{
        startOffset: 0,
        endOffset: 4,
        tokens: [
          {
            ...analysis.blocks[0].tokens[0],
            startOffset: 0,
            endOffset: 2,
            surface: '昨日',
            lemma: '昨日',
            reading: 'きのう',
            dictionaryReading: 'きのう',
            vocabularyKey: '["昨日","きのう"]',
            furiganaSegments: [{ text: '昨日', reading: 'きのう' }],
          },
          {
            ...analysis.blocks[0].tokens[0],
            startOffset: 2,
            endOffset: 4,
            surface: '今日',
            lemma: '今日',
            reading: 'きょう',
            dictionaryReading: 'きょう',
            vocabularyKey: '["今日","きょう"]',
            furiganaSegments: [{ text: '今日', reading: 'きょう' }],
          },
        ],
      }],
    };
    const firstOverride: Analysis = {
      ...baseAnalysis,
      blocks: [{
        ...baseAnalysis.blocks[0],
        tokens: [
          {
            ...baseAnalysis.blocks[0].tokens[0],
            reading: 'さくじつ',
            hasReadingOverride: true,
            furiganaSegments: [{ text: '昨日', reading: 'さくじつ' }],
          },
          baseAnalysis.blocks[0].tokens[1],
        ],
      }],
    };
    const bothOverrides: Analysis = {
      ...firstOverride,
      blocks: [{
        ...firstOverride.blocks[0],
        tokens: [
          firstOverride.blocks[0].tokens[0],
          {
            ...firstOverride.blocks[0].tokens[1],
            reading: 'こんにち',
            hasReadingOverride: true,
            furiganaSegments: [{ text: '今日', reading: 'こんにち' }],
          },
        ],
      }],
    };
    const firstWrite = deferred<Awaited<ReturnType<DocumentClient['setReadingOverride']>>>();
    const secondWrite = deferred<Awaited<ReturnType<DocumentClient['setReadingOverride']>>>();
    const firstRefresh = deferred<Analysis>();
    const secondRefresh = deferred<Analysis>();
    const setReadingOverride = vi.fn((_: string, override) => (
      override.startOffset === 0 ? firstWrite.promise : secondWrite.promise
    ));
    const analyze = vi.fn()
      .mockResolvedValueOnce(baseAnalysis)
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise);
    const api = client({
      get: vi.fn().mockResolvedValue({ ...document, content: '昨日今日' }),
      analyze,
      setReadingOverride,
    });
    render(<App client={api} initialPath={`/documents/${document.id}/read`} />);

    const yesterday = await screen.findByRole('button', { name: '昨日（きのう）' });
    const today = screen.getByRole('button', { name: '今日（きょう）' });
    fireEvent.contextMenu(yesterday);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Corrigir leitura' }));
    const yesterdayDialog = screen.getByRole('dialog', { name: 'Corrigir leitura de 昨日' });
    fireEvent.change(within(yesterdayDialog).getByLabelText('Nova leitura em kana'), {
      target: { value: 'さくじつ' },
    });
    fireEvent.click(within(yesterdayDialog).getByRole('button', { name: 'Salvar correção' }));

    fireEvent.contextMenu(today);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Corrigir leitura' }));
    const todayDialog = screen.getByRole('dialog', { name: 'Corrigir leitura de 今日' });
    fireEvent.change(within(todayDialog).getByLabelText('Nova leitura em kana'), {
      target: { value: 'こんにち' },
    });
    fireEvent.click(within(todayDialog).getByRole('button', { name: 'Salvar correção' }));

    expect(setReadingOverride).toHaveBeenCalledTimes(2);
    await act(async () => firstWrite.resolve({
      affectedOccurrenceCount: 1,
      overrides: [{
        documentId: document.id,
        documentRevision: 1,
        startOffset: 0,
        endOffset: 2,
        reading: 'さくじつ',
      }],
    }));
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
    await act(async () => firstRefresh.resolve(firstOverride));
    expect(await screen.findByText('さくじつ')).toBeInTheDocument();

    await act(async () => secondWrite.resolve({
      affectedOccurrenceCount: 1,
      overrides: [{
        documentId: document.id,
        documentRevision: 1,
        startOffset: 2,
        endOffset: 4,
        reading: 'こんにち',
      }],
    }));
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(3));
    await act(async () => secondRefresh.resolve(bothOverrides));

    expect(await screen.findByText('さくじつ')).toBeInTheDocument();
    expect(screen.getByText('こんにち')).toBeInTheDocument();
  });

  it('disables analysis for empty content and explains how to continue', () => {
    render(<App client={client()} initialPath="/documents/new" />);

    expect(screen.getByRole('button', { name: 'Analisar e ler' })).toBeDisabled();
    expect(screen.getByText('Digite algum texto japonês para analisar.')).toBeInTheDocument();
  });
});
