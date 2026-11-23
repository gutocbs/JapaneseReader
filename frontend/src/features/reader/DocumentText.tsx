import { Fragment, type ReactNode } from 'react';
import type {
  Analysis,
  FuriganaExclusion,
  ReadingOverrideKey,
  ReadingOverrideOperation,
  SetReadingOverride,
} from '../../shared/api/client';
import { Token } from './Token';
import { encodeFuriganaExclusion, furiganaExclusionFromToken } from './furiganaExclusions';
import { resolveFuriganaVisibility, type FuriganaVisibility } from './preferences';

interface DocumentTextProps {
  content: string;
  analysis: Analysis;
  selectedKeys?: ReadonlySet<string>;
  onToggleVocabulary?: (key: string) => void;
  showFurigana?: boolean;
  fontSizePx?: number;
  furiganaVisibilityByKey?: ReadonlyMap<string, FuriganaVisibility>;
  appliedFuriganaExclusionKeys?: ReadonlySet<string>;
  currentFuriganaExclusionKeys?: ReadonlySet<string>;
  pendingFuriganaExclusionKeys?: ReadonlySet<string>;
  onSetFuriganaVisibility?: (key: string, visibility: FuriganaVisibility) => void;
  onSaveReadingOverride?: (override: SetReadingOverride) => Promise<ReadingOverrideOperation>;
  onRemoveReadingOverride?: (key: ReadingOverrideKey) => Promise<ReadingOverrideOperation>;
  onSetFuriganaExcluded?: (exclusion: FuriganaExclusion, excluded: boolean) => Promise<void>;
}

export function DocumentText({
  content,
  analysis,
  selectedKeys = new Set(),
  onToggleVocabulary,
  showFurigana = true,
  fontSizePx,
  furiganaVisibilityByKey = new Map(),
  appliedFuriganaExclusionKeys = new Set(),
  currentFuriganaExclusionKeys = new Set(),
  pendingFuriganaExclusionKeys = new Set(),
  onSetFuriganaVisibility,
  onSaveReadingOverride,
  onRemoveReadingOverride,
  onSetFuriganaExcluded,
}: DocumentTextProps) {
  const codePoints = [...content];
  const rendered: ReactNode[] = [];
  let cursor = 0;

  const appendGap = (end: number, key: string) => {
    if (end > cursor) {
      rendered.push(<Fragment key={key}>{codePoints.slice(cursor, end).join('')}</Fragment>);
    }
    cursor = end;
  };

  analysis.blocks.forEach((block, blockIndex) => {
    appendGap(block.startOffset, `before-block:${blockIndex}`);
    block.tokens.forEach((token, tokenIndex) => {
      appendGap(token.startOffset, `before-token:${blockIndex}:${tokenIndex}`);
      const furiganaVisibility = token.vocabularyKey === null
        ? 'inherit'
        : furiganaVisibilityByKey.get(token.vocabularyKey) ?? 'inherit';
      const exclusion = furiganaExclusionFromToken(token);
      const excludedByDefault = exclusion !== null
        && appliedFuriganaExclusionKeys.has(encodeFuriganaExclusion(exclusion));
      rendered.push(
        <Token
          key={`token:${blockIndex}:${tokenIndex}:${token.startOffset}`}
          token={token}
          selected={token.vocabularyKey !== null && selectedKeys.has(token.vocabularyKey)}
          onToggleVocabulary={onToggleVocabulary}
          furiganaVisible={resolveFuriganaVisibility(furiganaVisibility, showFurigana, excludedByDefault)}
          furiganaVisibility={furiganaVisibility}
          onSetFuriganaVisibility={onSetFuriganaVisibility}
          documentRevision={analysis.documentRevision}
          onSaveReadingOverride={onSaveReadingOverride}
          onRemoveReadingOverride={onRemoveReadingOverride}
          furiganaExclusion={exclusion}
          furiganaExcluded={exclusion !== null && currentFuriganaExclusionKeys.has(encodeFuriganaExclusion(exclusion))}
          furiganaExclusionPending={exclusion !== null && pendingFuriganaExclusionKeys.has(encodeFuriganaExclusion(exclusion))}
          onSetFuriganaExcluded={onSetFuriganaExcluded}
        />,
      );
      cursor = token.endOffset;
    });
    appendGap(block.endOffset, `after-block:${blockIndex}`);
  });

  appendGap(codePoints.length, 'after-document');
  return (
    <div className="document-text" data-testid="document-text" style={fontSizePx === undefined ? undefined : { fontSize: `${fontSizePx}px` }}>
      {rendered}
    </div>
  );
}
