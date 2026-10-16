export interface ChunkOptions {
  /** Target maximum characters per chunk. */
  maxChars?: number;
  /** Characters carried over from the previous chunk to preserve context. */
  overlapChars?: number;
}

export interface TextChunk {
  index: number;
  content: string;
  tokenEstimate: number;
}

/** Rough token estimate (about 4 characters per token for English). Good enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > maxChars && current) {
      parts.push(current.trim());
      current = "";
    }
    if (sentence.length > maxChars) {
      for (let i = 0; i < sentence.length; i += maxChars)
        parts.push(sentence.slice(i, i + maxChars).trim());
      continue;
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Paragraph-aware chunker: keeps paragraphs together when possible, splits long ones by
 * sentence, and prefixes each chunk with the tail of the previous one for context.
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const maxChars = options.maxChars ?? 1200;
  const overlapChars = Math.min(options.overlapChars ?? 150, Math.floor(maxChars / 4));

  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .flatMap((p) => (p.length > maxChars ? splitLongParagraph(p, maxChars) : [p]));

  const bodies: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && current) {
      bodies.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) bodies.push(current);

  return bodies.map((body, index) => {
    const prev = index > 0 ? bodies[index - 1]! : "";
    const overlap = overlapChars > 0 && prev ? prev.slice(-overlapChars).replace(/^\S*\s/, "") : "";
    const content = overlap ? `…${overlap}\n\n${body}` : body;
    return { index, content, tokenEstimate: estimateTokens(content) };
  });
}
