import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tagColorForName } from '../documents/tags';
import { ReaderTagsPopup } from './ReaderTagsPopup';

const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');

describe('ReaderTagsPopup', () => {
  it('uses a top divider without a visible available-tags label and centers tag creation', async () => {
    expect(stylesheet).not.toMatch(/\.tag-creation-panel,\s*\.tag-selection/);
    expect(stylesheet).toMatch(/\.tag-selection \{[\s\S]*?border: 0;[\s\S]*?border-top: 1px solid var\(--color-border\);[\s\S]*?border-radius: 0;/);
    expect(stylesheet).toMatch(/\.reader-tags-popup__creation \{[\s\S]*?justify-content: center;/);

    render(
      <ReaderTagsPopup
        tags={[]}
        loadCatalog={vi.fn().mockResolvedValue([{ name: 'Gramática', color: '#0F766E' }])}
        onSaveTags={vi.fn().mockResolvedValue(undefined)}
        onCreateTag={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Etiquetas do documento' }));

    expect(await screen.findByLabelText('Etiquetas disponíveis')).toBeInTheDocument();
    expect(screen.queryByText('Etiquetas disponíveis')).not.toBeInTheDocument();
  });

  it('keeps a long tag list inside a viewport-bounded scrolling popup', () => {
    expect(stylesheet).toMatch(/\.reader-tags-popup__panel \{[\s\S]*max-height: calc\(100vh - var\(--space-12\)\);[\s\S]*overflow-y: auto;/);
    expect(stylesheet).toMatch(/\.reader-tags-popup__panel \{[\s\S]*box-sizing: border-box;[\s\S]*max-width: calc\(100vw - 7rem\);[\s\S]*overflow-x: hidden;/);
    expect(stylesheet).toMatch(/\.reader-tags-popup__panel \.metadata-tags \{[\s\S]*min-width: 0;/);
    expect(stylesheet).toMatch(/\.reader-tags-popup__current-tags \{[\s\S]*max-height: [^;]+;[\s\S]*overflow-y: auto;/);
    expect(stylesheet).toMatch(/\.reader-tags-popup__panel \.tag-selection__options \{[\s\S]*max-height: [^;]+;[\s\S]*overflow-y: auto;/);
    expect(stylesheet).toMatch(/\.reader-tags-popup__creation input:focus-visible \{[\s\S]*outline: 0;[\s\S]*box-shadow: 0 0 0 2px color-mix\(in srgb, var\(--color-focus\) 24%, transparent\);/);
  });

  it('uses the rail trigger as the only popup close affordance', () => {
    render(
      <ReaderTagsPopup
        tags={[{ name: 'Clássico', color: '#7C3AED' }]}
        loadCatalog={vi.fn().mockResolvedValue([])}
        onSaveTags={vi.fn().mockResolvedValue(undefined)}
        onCreateTag={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Etiquetas do documento' }));

    expect(screen.queryByRole('button', { name: 'Fechar etiquetas' })).not.toBeInTheDocument();
  });

  it('opens from the rail, exposes its active state, and restores focus after Escape', () => {
    render(
      <ReaderTagsPopup
        tags={[{ name: 'Clássico', color: '#7C3AED' }]}
        loadCatalog={vi.fn().mockResolvedValue([{ name: 'Gramática', color: '#0F766E' }])}
        onSaveTags={vi.fn().mockResolvedValue(undefined)}
        onCreateTag={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Etiquetas do documento' });
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Etiquetas do documento' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes when clicking outside the popup and returns focus to the rail trigger', () => {
    render(
      <ReaderTagsPopup
        tags={[]}
        loadCatalog={vi.fn().mockResolvedValue([])}
        onSaveTags={vi.fn().mockResolvedValue(undefined)}
        onCreateTag={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Etiquetas do documento' });
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('also closes with Escape while the expanded trigger retains focus', () => {
    render(
      <ReaderTagsPopup
        tags={[]}
        loadCatalog={vi.fn().mockResolvedValue([])}
        onSaveTags={vi.fn().mockResolvedValue(undefined)}
        onCreateTag={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Etiquetas do documento' });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('assigns an existing tag using its persisted catalog color', async () => {
    const onSaveTags = vi.fn().mockResolvedValue(undefined);
    render(
      <ReaderTagsPopup
        tags={[{ name: 'Clássico', color: '#7C3AED' }]}
        loadCatalog={vi.fn().mockResolvedValue([{ name: 'Gramática', color: '#0F766E' }])}
        onSaveTags={onSaveTags}
        onCreateTag={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Etiquetas do documento' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Selecionar etiqueta Gramática' }));

    await waitFor(() => expect(onSaveTags).toHaveBeenCalledWith([
      { name: 'Clássico', color: '#7C3AED' },
      { name: 'Gramática', color: '#0F766E' },
    ]));
  });

  it('creates a tag through the shared palette before associating it', async () => {
    const created = { name: 'Literatura', color: '#0F766E' };
    const onCreateTag = vi.fn().mockResolvedValue(created);
    const onSaveTags = vi.fn().mockResolvedValue(undefined);
    render(
      <ReaderTagsPopup
        tags={[]}
        loadCatalog={vi.fn().mockResolvedValue([])}
        onSaveTags={onSaveTags}
        onCreateTag={onCreateTag}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Etiquetas do documento' }));
    fireEvent.change(screen.getByLabelText('Nova etiqueta'), { target: { value: 'Literatura' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar e adicionar' }));

    await waitFor(() => expect(onCreateTag).toHaveBeenCalledWith({
      name: 'Literatura', color: tagColorForName('Literatura'),
    }));
    expect(onSaveTags).toHaveBeenCalledWith([created]);
  });

  it('removes only the selected tag and announces persistence errors', async () => {
    const onSaveTags = vi.fn().mockRejectedValue(new Error('offline'));
    render(
      <ReaderTagsPopup
        tags={[{ name: 'Clássico', color: '#7C3AED' }]}
        loadCatalog={vi.fn().mockResolvedValue([])}
        onSaveTags={onSaveTags}
        onCreateTag={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Etiquetas do documento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover etiqueta Clássico' }));

    await waitFor(() => expect(onSaveTags).toHaveBeenCalledWith([]));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar as etiquetas deste documento.');
  });
});
