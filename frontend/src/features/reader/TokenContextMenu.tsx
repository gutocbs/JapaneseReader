import { useLayoutEffect, useRef } from 'react';
import type { FuriganaVisibility } from './preferences';

interface TokenContextMenuProps {
  onClose: () => void;
  onSetVisibility?: (visibility: FuriganaVisibility) => void;
  furiganaVisible?: boolean;
  furiganaVisibility?: FuriganaVisibility;
  onEditReading?: () => void;
  onRemoveReading?: () => void;
  furiganaExcluded?: boolean;
  furiganaExclusionPending?: boolean;
  onSetFuriganaExcluded?: (excluded: boolean) => void;
}

export function TokenContextMenu({
  onClose,
  onSetVisibility,
  furiganaVisible = true,
  furiganaVisibility = 'inherit',
  onEditReading,
  onRemoveReading,
  furiganaExcluded = false,
  furiganaExclusionPending = false,
  onSetFuriganaExcluded,
}: TokenContextMenuProps) {
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const toggleAction = furiganaVisible
    ? { label: 'Ocultar furigana', visibility: 'hide' as const }
    : { label: 'Mostrar furigana', visibility: 'show' as const };
  const selectVisibility = (visibility: FuriganaVisibility) => {
    onSetVisibility?.(visibility);
    onClose();
  };
  const hasEarlierItem = onEditReading !== undefined || onRemoveReading !== undefined || onSetFuriganaExcluded !== undefined;

  useLayoutEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  return (
    <span className="reader-context-menu" role="menu" aria-label="Opções da palavra">
      {onEditReading && (
        <button ref={firstItemRef} type="button" role="menuitem" onClick={(event) => {
          event.stopPropagation();
          onEditReading();
        }}>
          Corrigir leitura
        </button>
      )}
      {onRemoveReading && (
        <button ref={!onEditReading ? firstItemRef : undefined} type="button" role="menuitem" onClick={(event) => {
          event.stopPropagation();
          onRemoveReading();
        }}>
          Remover correção
        </button>
      )}
      {onSetFuriganaExcluded && (
        <button
          ref={!onEditReading && !onRemoveReading ? firstItemRef : undefined}
          type="button"
          role="menuitem"
          disabled={furiganaExclusionPending}
          onClick={(event) => {
            event.stopPropagation();
            onSetFuriganaExcluded(!furiganaExcluded);
          }}
        >
          {furiganaExcluded ? 'Remover leitura da lista de exclusão' : 'Adicionar leitura à lista de exclusão'}
        </button>
      )}
      {onSetVisibility && (
        <button
          ref={!hasEarlierItem ? firstItemRef : undefined}
          type="button"
          role="menuitem"
          onClick={(event) => {
            event.stopPropagation();
            selectVisibility(toggleAction.visibility);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            selectVisibility(toggleAction.visibility);
          }}
        >
          {toggleAction.label}
        </button>
      )}
      {onSetVisibility && furiganaVisibility !== 'inherit' && (
        <button type="button" role="menuitem" onClick={(event) => {
          event.stopPropagation();
          selectVisibility('inherit');
        }} onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          selectVisibility('inherit');
        }}>
          Seguir configuração geral
        </button>
      )}
    </span>
  );
}
