import { Fragment, useEffect, useRef, useState } from 'react';
import type {
  AnalyzedToken,
  FuriganaExclusion,
  ReadingOverrideKey,
  ReadingOverrideOperation,
  SetReadingOverride,
} from '../../shared/api/client';
import type { FuriganaVisibility } from './preferences';
import { ReadingOverrideDialog } from './ReadingOverrideDialog';
import { TokenContextMenu } from './TokenContextMenu';
import { furiganaExclusionFromToken } from './furiganaExclusions';

interface TokenProps {
  token: AnalyzedToken;
  selected?: boolean;
  onToggleVocabulary?: (key: string) => void;
  furiganaVisible?: boolean;
  furiganaVisibility?: FuriganaVisibility;
  onSetFuriganaVisibility?: (key: string, visibility: FuriganaVisibility) => void;
  documentRevision?: number;
  onSaveReadingOverride?: (override: SetReadingOverride) => Promise<ReadingOverrideOperation>;
  onRemoveReadingOverride?: (key: ReadingOverrideKey) => Promise<ReadingOverrideOperation>;
  furiganaExclusion?: FuriganaExclusion | null;
  furiganaExcluded?: boolean;
  furiganaExclusionPending?: boolean;
  onSetFuriganaExcluded?: (exclusion: FuriganaExclusion, excluded: boolean) => Promise<void>;
}

export function Token({
  token,
  selected = false,
  onToggleVocabulary,
  furiganaVisible = true,
  furiganaVisibility = 'inherit',
  onSetFuriganaVisibility,
  documentRevision,
  onSaveReadingOverride,
  onRemoveReadingOverride,
  furiganaExclusion = null,
  furiganaExcluded = false,
  furiganaExclusionPending = false,
  onSetFuriganaExcluded,
}: TokenProps) {
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [isReadingDialogOpen, setIsReadingDialogOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const isInteractive = token.vocabularyKey !== null && onToggleVocabulary !== undefined;
  const supportsReadingOverride = token.isLexical
    && documentRevision !== undefined
    && onSaveReadingOverride !== undefined
    && onRemoveReadingOverride !== undefined;
  const resolvedFuriganaExclusion = furiganaExclusion ?? furiganaExclusionFromToken(token);
  const supportsFuriganaExclusion = resolvedFuriganaExclusion !== null && onSetFuriganaExcluded !== undefined;
  const supportsContextMenu = token.isLexical && (
    (token.vocabularyKey !== null && onSetFuriganaVisibility !== undefined)
    || supportsReadingOverride
    || supportsFuriganaExclusion
  );
  const isFocusable = isInteractive || supportsContextMenu;
  const accessibleReading = token.reading ?? token.dictionaryReading ?? 'sem leitura';
  const toggle = () => {
    if (token.vocabularyKey !== null) onToggleVocabulary?.(token.vocabularyKey);
  };

  const closeContextMenu = (restoreFocus = true) => {
    setIsContextMenuOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isContextMenuOpen) return undefined;
    const closeWhenOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeContextMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };
    document.addEventListener('pointerdown', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  });

  return (
    <span ref={containerRef} className="reader-token-container">
      <span
        ref={triggerRef}
        className="reader-token"
        data-lexical={token.isLexical || undefined}
        data-selected={selected || undefined}
        role={isFocusable ? 'button' : undefined}
        tabIndex={isFocusable ? 0 : undefined}
        aria-label={isFocusable ? `${token.surface}（${accessibleReading}）` : undefined}
        aria-pressed={isInteractive ? selected : undefined}
        aria-haspopup={supportsContextMenu ? 'menu' : undefined}
        aria-expanded={supportsContextMenu ? isContextMenuOpen : undefined}
        onClick={isInteractive ? toggle : undefined}
        onKeyDown={isFocusable ? (event) => {
          if (isInteractive && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggle();
          }
          if (supportsContextMenu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
            event.preventDefault();
            setIsContextMenuOpen(true);
          }
          if (supportsContextMenu && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeContextMenu();
          }
        } : undefined}
        onContextMenu={supportsContextMenu ? (event) => {
          event.preventDefault();
          event.currentTarget.focus();
          setIsContextMenuOpen(true);
        } : undefined}
      >
        {token.furiganaSegments.length === 0
          ? token.surface
          : token.furiganaSegments.map((segment, index) => (
              <Fragment key={`${index}:${segment.text}`}>
                {segment.reading === null ? segment.text : (
                  <ruby>
                    {segment.text}
                    <rt hidden={!furiganaVisible}>{segment.reading}</rt>
                  </ruby>
                )}
              </Fragment>
        ))}
      </span>
      {isContextMenuOpen && (
        <TokenContextMenu
          onClose={closeContextMenu}
          onSetVisibility={
            token.vocabularyKey !== null && onSetFuriganaVisibility
              ? (visibility) => onSetFuriganaVisibility(token.vocabularyKey!, visibility)
              : undefined
          }
          furiganaVisible={furiganaVisible}
          furiganaVisibility={furiganaVisibility}
          onEditReading={supportsReadingOverride ? () => {
            setIsContextMenuOpen(false);
            setIsReadingDialogOpen(true);
          } : undefined}
          onRemoveReading={
            supportsReadingOverride && token.hasReadingOverride
              ? () => {
                  closeContextMenu();
                  void onRemoveReadingOverride({
                    documentRevision,
                    startOffset: token.startOffset,
                    endOffset: token.endOffset,
                  }).catch(() => undefined);
                }
              : undefined
          }
          furiganaExcluded={furiganaExcluded}
          furiganaExclusionPending={furiganaExclusionPending}
          onSetFuriganaExcluded={supportsFuriganaExclusion
            ? (excluded) => {
                closeContextMenu();
                void onSetFuriganaExcluded(resolvedFuriganaExclusion, excluded);
              }
            : undefined}
        />
      )}
      {isReadingDialogOpen && supportsReadingOverride && (
        <ReadingOverrideDialog
          token={token}
          documentRevision={documentRevision}
          returnFocusRef={triggerRef}
          onClose={() => setIsReadingDialogOpen(false)}
          onSave={onSaveReadingOverride}
          onRemove={onRemoveReadingOverride}
        />
      )}
    </span>
  );
}
