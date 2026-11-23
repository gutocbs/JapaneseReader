import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnalyzedToken } from '../../shared/api/client';
import { Token } from './Token';

const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const globalCss = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');

const lexicalToken: AnalyzedToken = {
  startOffset: 0,
  endOffset: 2,
  surface: '昨日',
  lemma: '昨日',
  reading: 'きのう',
  dictionaryReading: 'きのう',
  partOfSpeech: ['名詞', '普通名詞', '副詞可能', '*', '*', '*'],
  isOutOfVocabulary: false,
  isLexical: true,
  vocabularyKey: '["昨日","きのう"]',
  furiganaSegments: [{ text: '昨日', reading: 'きのう' }],
  hasReadingOverride: false,
};

const readerStyles = document.createElement('style');

beforeAll(() => {
  readerStyles.textContent = `${tokensCss}\n${globalCss.replace("@import './tokens.css';", '')}`;
  document.head.append(readerStyles);
});

afterAll(() => readerStyles.remove());

describe('Token', () => {
  it('uses the approved neutral translucent surface for lexical hover and keyboard focus', () => {
    const hoverRule = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .find((rule): rule is CSSStyleRule => (
        rule instanceof CSSStyleRule
        && rule.selectorText.replace(/\s+/g, ' ').trim()
          === '.reader-token[data-lexical]:hover, .reader-token[data-lexical]:focus-visible'
      ));

    expect(getComputedStyle(document.documentElement)
      .getPropertyValue('--color-reader-token-hover').trim()).toBe('rgb(243 243 247/14%)');
    expect(hoverRule?.style.getPropertyValue('background')).toBe('var(--color-reader-token-hover)');
  });

  it('uses the same translucent surface for a selected token with one dotted underline', () => {
    const selectedRule = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .find((rule): rule is CSSStyleRule => (
        rule instanceof CSSStyleRule && rule.selectorText === '.reader-token[data-selected]'
      ));
    const { container } = render(<Token token={lexicalToken} selected />);

    expect(getComputedStyle(document.documentElement)
      .getPropertyValue('--color-reader-token-selected').trim()).toBe('rgb(243 243 247/14%)');
    expect(selectedRule?.style.getPropertyValue('background')).toBe('var(--color-reader-token-selected)');
    expect(selectedRule?.style.textDecoration).toContain('dotted');
    expect(selectedRule?.style.textDecoration).not.toContain('double');
    expect(container.querySelector('.reader-token')).toHaveAttribute('data-selected');
    expect(container.querySelector('ruby > rt')).toHaveTextContent('きのう');
  });

  it('keeps ruby bases while hiding only rt according to the resolved preference', () => {
    const { container } = render(<Token token={lexicalToken} furiganaVisible={false} />);

    const ruby = container.querySelector('ruby');
    expect(ruby?.firstChild?.textContent).toBe('昨日');
    expect(ruby?.querySelector('rt')).toHaveAttribute('hidden');
  });

  it('announces the effective override reading instead of the dictionary reading', () => {
    render(
      <Token
        token={{
          ...lexicalToken,
          reading: 'さくじつ',
          hasReadingOverride: true,
          furiganaSegments: [{ text: '昨日', reading: 'さくじつ' }],
        }}
        documentRevision={1}
        onSaveReadingOverride={vi.fn().mockResolvedValue(undefined)}
        onRemoveReadingOverride={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('button', { name: '昨日（さくじつ）' })).toBeInTheDocument();
  });

  it('opens the lexical context menu with pointer or keyboard and returns focus on Escape', () => {
    const onSetFuriganaVisibility = vi.fn();
    render(
      <Token
        token={lexicalToken}
        onToggleVocabulary={vi.fn()}
        onSetFuriganaVisibility={onSetFuriganaVisibility}
      />,
    );

    const token = screen.getByRole('button', { name: '昨日（きのう）' });
    fireEvent.contextMenu(token);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ocultar furigana' }));
    expect(onSetFuriganaVisibility).toHaveBeenCalledWith('["昨日","きのう"]', 'hide');

    fireEvent.keyDown(token, { key: 'ContextMenu' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(token, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(token).toHaveFocus();
  });

  it('does not replace the browser context menu for non-lexical tokens', () => {
    const punctuation: AnalyzedToken = {
      ...lexicalToken,
      surface: '。',
      isLexical: false,
      vocabularyKey: null,
      furiganaSegments: [{ text: '。', reading: null }],
    };
    render(<Token token={punctuation} />);

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    screen.getByText('。').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps a lexical token keyboard-accessible for its context menu without selection wiring', () => {
    render(<Token token={lexicalToken} onSetFuriganaVisibility={vi.fn()} />);

    const token = screen.getByText('昨日').closest('.reader-token')!;
    expect(token).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(token, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes the context menu on an outside click without stealing external focus', () => {
    render(
      <>
        <button type="button">Fora do menu</button>
        <Token token={lexicalToken} onSetFuriganaVisibility={vi.fn()} />
      </>,
    );

    const token = screen.getByRole('button', { name: '昨日（きのう）' });
    const outside = screen.getByRole('button', { name: 'Fora do menu' });
    fireEvent.contextMenu(token);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    outside.focus();
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
  });

  it.each([
    ['Ocultar furigana', 'hide'],
    ['Mostrar furigana', 'show'],
  ] as const)('does not toggle vocabulary when selecting %s', (label, visibility) => {
    const onToggleVocabulary = vi.fn();
    const onSetFuriganaVisibility = vi.fn();
    render(
      <Token
        token={lexicalToken}
        onToggleVocabulary={onToggleVocabulary}
        onSetFuriganaVisibility={onSetFuriganaVisibility}
        furiganaVisible={visibility === 'hide'}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: '昨日（きのう）' }));
    fireEvent.click(screen.getByRole('menuitem', { name: label }));

    expect(onSetFuriganaVisibility).toHaveBeenCalledWith('["昨日","きのう"]', visibility);
    expect(onToggleVocabulary).not.toHaveBeenCalled();
  });

  it('focuses the first menu item for Shift+F10 and Enter does not toggle vocabulary', () => {
    const onToggleVocabulary = vi.fn();
    const onSetFuriganaVisibility = vi.fn();
    render(
      <Token
        token={lexicalToken}
        onToggleVocabulary={onToggleVocabulary}
        onSetFuriganaVisibility={onSetFuriganaVisibility}
      />,
    );

    const token = screen.getByRole('button', { name: '昨日（きのう）' });
    token.focus();
    fireEvent.keyDown(token, { key: 'F10', shiftKey: true });
    const firstItem = screen.getByRole('menuitem', { name: 'Ocultar furigana' });
    expect(firstItem).toHaveFocus();

    fireEvent.keyDown(firstItem, { key: 'Enter' });
    expect(onSetFuriganaVisibility).toHaveBeenCalledWith('["昨日","きのう"]', 'hide');
    expect(onToggleVocabulary).not.toHaveBeenCalled();
    expect(token).toHaveFocus();
  });

  it('opens reading correction outside ruby and conditionally exposes removal', () => {
    const onSaveReadingOverride = vi.fn().mockResolvedValue(undefined);
    const onRemoveReadingOverride = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <Token
        token={lexicalToken}
        documentRevision={1}
        onSaveReadingOverride={onSaveReadingOverride}
        onRemoveReadingOverride={onRemoveReadingOverride}
      />,
    );

    const token = screen.getByRole('button', { name: '昨日（きのう）' });
    fireEvent.contextMenu(token);
    expect(screen.queryByRole('menuitem', { name: 'Remover correção' }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Corrigir leitura' }));

    const dialog = screen.getByRole('dialog', { name: 'Corrigir leitura de 昨日' });
    expect(dialog.closest('ruby')).toBeNull();
    expect(token.querySelector('button, input, form')).toBeNull();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    rerender(
      <Token
        token={{ ...lexicalToken, hasReadingOverride: true }}
        documentRevision={1}
        onSaveReadingOverride={onSaveReadingOverride}
        onRemoveReadingOverride={onRemoveReadingOverride}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: '昨日（きのう）' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remover correção' }));
    expect(onRemoveReadingOverride).toHaveBeenCalledWith({
      documentRevision: 1,
      startOffset: 0,
      endOffset: 2,
    });
  });
});

  it('offers an exclusion action only for a lexical token with dictionary reading', () => {
    const onSetFuriganaExcluded = vi.fn().mockResolvedValue(undefined);
    render(<Token token={lexicalToken} onSetFuriganaExcluded={onSetFuriganaExcluded} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: '昨日（きのう）' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Adicionar leitura à lista de exclusão' }));
    expect(onSetFuriganaExcluded).toHaveBeenCalledWith({ lemma: '昨日', dictionaryReading: 'きのう' }, true);
  });
  it('places the exclusion action after the furigana actions', () => {
    render(
      <Token
        token={lexicalToken}
        onSetFuriganaVisibility={vi.fn()}
        onSetFuriganaExcluded={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: '昨日（きのう）' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Ocultar furigana',
      'Adicionar leitura à lista de exclusão',
    ]);
  });
