const MAX_WORDS_FOR_CLASSIFICATION = 800;

/**
 * Classification doesn't need the whole document — this caps what ever
 * reaches the OpenAI call, which is what actually controls per-document
 * AI cost.
 */
export function truncateToWordLimit(
  text: string,
  maxWords: number = MAX_WORDS_FOR_CLASSIFICATION,
): string {
  const words = text.trim().split(/\s+/).filter(Boolean);

  if (words.length <= maxWords) {
    return words.join(' ');
  }

  return words.slice(0, maxWords).join(' ');
}
