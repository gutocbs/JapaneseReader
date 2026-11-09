const JAPANESE_CHARACTER = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

function isJapaneseCharacter(value: string | undefined): boolean {
  return value !== undefined && JAPANESE_CHARACTER.test(value);
}

/**
 * Experimental, opt-in normalization for pasted text.
 *
 * It joins only a single LF or CRLF directly bounded by Japanese characters.
 * Runs of multiple blank lines collapse to one blank paragraph boundary.
 * Every other boundary remains byte-for-byte unchanged.
 */
export function joinSimpleJapaneseLineBreaks(content: string): string {
  const contentWithCollapsedBlankLines = content.replace(
    /(?:\r\n|\n){3,}/g,
    (newlines) => (newlines.startsWith('\r\n') ? '\r\n\r\n' : '\n\n'),
  );
  let normalized = '';

  for (let index = 0; index < contentWithCollapsedBlankLines.length; index += 1) {
    const character = contentWithCollapsedBlankLines[index];
    const isCrLf = character === '\r' && contentWithCollapsedBlankLines[index + 1] === '\n';
    const isLf = character === '\n';

    if (!isCrLf && !isLf) {
      normalized += character;
      continue;
    }

    const newlineLength = isCrLf ? 2 : 1;
    const precedingCharacter = contentWithCollapsedBlankLines[index - 1];
    const followingCharacter = contentWithCollapsedBlankLines[index + newlineLength];

    if (isJapaneseCharacter(precedingCharacter) && isJapaneseCharacter(followingCharacter)) {
      index += newlineLength - 1;
      continue;
    }

    normalized += contentWithCollapsedBlankLines.slice(index, index + newlineLength);
    index += newlineLength - 1;
  }

  return normalized;
}
