import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Analysis } from '../../shared/api/client';
import { DocumentText } from './DocumentText';

const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const globalCss = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
const readerStyles = document.createElement('style');

beforeAll(() => {
  readerStyles.textContent = `${tokensCss}\n${globalCss.replace("@import './tokens.css';", '')}`;
  document.head.append(readerStyles);
});

afterAll(() => readerStyles.remove());

const analysis: Analysis = {
  documentId: '00000000-0000-0000-0000-000000000001',
  documentRevision: 1,
  contentHash: 'hash',
  metadata: {
    analyzerName: 'SudachiPy',
    analyzerVersion: '0.6.11',
    dictionaryName: 'SudachiDict-core',
    dictionaryVersion: '20250825',
    splitMode: 'B',
  },
  analysisOptions: { splitMode: 'B' },
  blocks: [
    {
      startOffset: 2,
      endOffset: 8,
      tokens: [
        {
          startOffset: 2,
          endOffset: 5,
          surface: '食べた',
          lemma: '食べる',
          reading: 'たべた',
          dictionaryReading: 'たべる',
          partOfSpeech: ['動詞', '一般', '*', '*', '下一段-バ行', '連用形-一般'],
          isOutOfVocabulary: false,
          isLexical: true,
          vocabularyKey: '食べる\u0000たべる',
          furiganaSegments: [
            { text: '食', reading: 'た' },
            { text: 'べた', reading: null },
          ],
          hasReadingOverride: false,
        },
        {
          startOffset: 5,
          endOffset: 6,
          surface: '。',
          lemma: '。',
          reading: null,
          dictionaryReading: null,
          partOfSpeech: ['補助記号', '句点', '*', '*', '*', '*'],
          isOutOfVocabulary: false,
          isLexical: false,
          vocabularyKey: null,
          furiganaSegments: [{ text: '。', reading: null }],
          hasReadingOverride: false,
        },
      ],
    },
    {
      startOffset: 8,
      endOffset: 10,
      tokens: [
        {
          startOffset: 8,
          endOffset: 10,
          surface: '昨日',
          lemma: '昨日',
          reading: 'きのう',
          dictionaryReading: 'きのう',
          partOfSpeech: ['名詞', '普通名詞', '副詞可能', '*', '*', '*'],
          isOutOfVocabulary: false,
          isLexical: true,
          vocabularyKey: '昨日\u0000きのう',
          furiganaSegments: [{ text: '昨日', reading: 'きのう' }],
          hasReadingOverride: false,
        },
      ],
    },
  ],
  diagnostics: [{ code: 'furigana_fallback', startOffset: 8, endOffset: 10 }],
};

describe('DocumentText', () => {
  it('uses the approved dark-theme contrast tokens and reading typeface', () => {
    const darkThemeRule = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .find((rule): rule is CSSStyleRule => (
        rule instanceof CSSStyleRule && rule.selectorText === ":root[data-theme='dark']"
      ));

    expect(darkThemeRule?.style.getPropertyValue('--color-page').trim()).toBe('#1f2022');
    expect(darkThemeRule?.style.getPropertyValue('--color-text').trim()).toBe('#f3f3f7');
    expect(getComputedStyle(document.documentElement)
      .getPropertyValue('--font-reader').trim()
      .replace(/\s*,\s*/g, ','))
      .toBe('"ヒラギノ角ゴ Pro W3","Hiragino Kaku Gothic Pro","Yu Gothic",Osaka,メイリオ,Meiryo,"ＭＳ Ｐゴシック","MS PGothic",sans-serif');
  });

  it('uses the wider but bounded reader text measure', () => {
    const textRule = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .find((rule): rule is CSSStyleRule => (
        rule instanceof CSSStyleRule && rule.selectorText === '.document-text'
      ));

    expect(getComputedStyle(document.documentElement)
      .getPropertyValue('--reader-text-width').trim()).toBe('54rem');
    expect(textRule?.style.maxWidth).toBe('var(--reader-text-width)');
  });

  it('centers the reader column while keeping its text start-aligned', () => {
    const textRule = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .find((rule): rule is CSSStyleRule => (
        rule instanceof CSSStyleRule && rule.selectorText === '.document-text'
      ));

    expect(textRule?.style.marginLeft).toBe('auto');
    expect(textRule?.style.marginRight).toBe('auto');
    expect(textRule?.style.textAlign).toBe('start');
  });

  it('keeps canonical text selectable in semantic HTML and preserves every gap', () => {
    const content = '𠮷 食べた。 \n昨日!';
    const { container } = render(<DocumentText content={content} analysis={analysis} />);

    const reader = screen.getByTestId('document-text');
    expect(reader.querySelector('canvas, svg, img')).toBeNull();
    expect(reader.tagName).toBe('DIV');
    expect(reader).not.toHaveAttribute('aria-hidden');

    const base = reader.cloneNode(true) as HTMLElement;
    base.querySelectorAll('rt').forEach((reading) => reading.remove());
    expect(base.textContent).toBe(content);
    expect(container.querySelectorAll('ruby > rt')).toHaveLength(2);
    expect(screen.getByText('。').tagName).toBe('SPAN');
  });

  it('renders a whole-token fallback as one ruby base', () => {
    render(<DocumentText content={'𠮷 食べた。 \n昨日!'} analysis={analysis} />);

    const reading = screen.getByText('きのう');
    const ruby = reading.parentElement;
    expect(ruby?.tagName).toBe('RUBY');
    expect(ruby?.childNodes[0]?.textContent).toBe('昨日');
    expect(ruby?.querySelectorAll('rt')).toHaveLength(1);
  });

  it('offers one furigana action and exposes inheritance only for a word override', () => {
    const onSetFuriganaVisibility = vi.fn();
    const firstKey = analysis.blocks[0].tokens[0].vocabularyKey!;
    const { rerender } = render(
      <DocumentText
        content={'𠮷 食べた。 \n昨日!'}
        analysis={analysis}
        showFurigana={false}
        onSetFuriganaVisibility={onSetFuriganaVisibility}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: '食べた（たべた）' }));
    expect(screen.queryByRole('menuitem', { name: 'Seguir configuração geral' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mostrar furigana' }));
    expect(onSetFuriganaVisibility).toHaveBeenCalledWith(firstKey, 'show');

    rerender(
      <DocumentText
        content={'𠮷 食べた。 \n昨日!'}
        analysis={analysis}
        showFurigana={false}
        furiganaVisibilityByKey={new Map([[firstKey, 'hide']])}
        onSetFuriganaVisibility={onSetFuriganaVisibility}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: '食べた（たべた）' }));
    expect(screen.getByRole('menuitem', { name: 'Seguir configuração geral' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seguir configuração geral' }));
    expect(onSetFuriganaVisibility).toHaveBeenLastCalledWith(firstKey, 'inherit');
  });

  it('toggles every occurrence with the same key but keeps a different reading separate', () => {
    const firstKey = '["生","せい"]';
    const secondKey = '["生","しょう"]';
    const selectionAnalysis: Analysis = {
      ...analysis,
      blocks: [{
        startOffset: 0,
        endOffset: 3,
        tokens: [
          { ...analysis.blocks[1].tokens[0], startOffset: 0, endOffset: 1, surface: '生', lemma: '生', reading: 'せい', dictionaryReading: 'せい', vocabularyKey: firstKey, furiganaSegments: [{ text: '生', reading: 'せい' }] },
          { ...analysis.blocks[1].tokens[0], startOffset: 1, endOffset: 2, surface: '生', lemma: '生', reading: 'せい', dictionaryReading: 'せい', vocabularyKey: firstKey, furiganaSegments: [{ text: '生', reading: 'せい' }] },
          { ...analysis.blocks[1].tokens[0], startOffset: 2, endOffset: 3, surface: '生', lemma: '生', reading: 'しょう', dictionaryReading: 'しょう', vocabularyKey: secondKey, furiganaSegments: [{ text: '生', reading: 'しょう' }] },
        ],
      }],
    };

    function SelectionHarness() {
      const [selectedKeys, setSelectedKeys] = useState(() => new Set<string>());
      const toggle = (key: string) => {
        setSelectedKeys((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      };
      return (
        <DocumentText
          content="生生生"
          analysis={selectionAnalysis}
          selectedKeys={selectedKeys}
          onToggleVocabulary={toggle}
        />
      );
    }

    render(<SelectionHarness />);
    const firstReadingOccurrences = screen.getAllByRole('button', { name: '生（せい）' });
    const secondReadingOccurrence = screen.getByRole('button', { name: '生（しょう）' });

    fireEvent.click(firstReadingOccurrences[0]);
    expect(firstReadingOccurrences[0]).toHaveAttribute('aria-pressed', 'true');
    expect(firstReadingOccurrences[1]).toHaveAttribute('aria-pressed', 'true');
    expect(secondReadingOccurrence).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(firstReadingOccurrences[1]);
    expect(firstReadingOccurrences[0]).toHaveAttribute('aria-pressed', 'false');
    expect(firstReadingOccurrences[1]).toHaveAttribute('aria-pressed', 'false');
    expect(secondReadingOccurrence).toHaveAttribute('aria-pressed', 'false');
  });
});

  it('hides an inherited matching dictionary reading from the applied exclusions', () => {
    render(
      <DocumentText
        content={'𠮷 食べた。 \n昨日!'}
        analysis={analysis}
        appliedFuriganaExclusionKeys={new Set(['["昨日","きのう"]'])}
      />,
    );

    expect(screen.getByText('きのう')).toHaveAttribute('hidden');
    expect(screen.getByText('た')).not.toHaveAttribute('hidden');
  });
