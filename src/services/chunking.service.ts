import crypto from 'crypto';
import { hashContent } from '../utils/hashing';
import { ChunkItem, ChunkOptions } from '../types';

export class ChunkingService {
  /**
   * Splits cleaned content into semantically coherent overlapping chunks.
   */
  chunkText(
    text: string,
    meta: { crawlerId: string; pageId: string; url: string; title: string },
    options: ChunkOptions = {}
  ): ChunkItem[] {
    const {
      chunkSize = 700,
      chunkOverlap = 100,
      minChunkLength = 50,
    } = options;

    const trimmed = text.trim();
    if (!trimmed || trimmed.length < minChunkLength) {
      if (trimmed.length > 0) {
        return [
          {
            id: crypto.randomUUID(),
            crawlerId: meta.crawlerId,
            pageId: meta.pageId,
            url: meta.url,
            title: meta.title,
            chunkIndex: 0,
            content: trimmed,
            contentHash: hashContent(trimmed),
            tokenCount: this.estimateTokenCount(trimmed),
          },
        ];
      }
      return [];
    }

    const targetCharSize = chunkSize * 4;
    const targetOverlapCharSize = chunkOverlap * 4;

    const sentences = this.splitIntoSentences(trimmed);
    const chunks: string[] = [];
    let currentChunkSentences: string[] = [];
    let currentLength = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceLen = sentence.length;

      if (currentLength + sentenceLen > targetCharSize && currentChunkSentences.length > 0) {
        const chunkContent = currentChunkSentences.join(' ').trim();
        if (chunkContent.length >= minChunkLength) {
          chunks.push(chunkContent);
        }

        let overlapLen = 0;
        const overlapSentences: string[] = [];
        for (let j = currentChunkSentences.length - 1; j >= 0; j--) {
          const s = currentChunkSentences[j];
          if (overlapLen + s.length <= targetOverlapCharSize) {
            overlapSentences.unshift(s);
            overlapLen += s.length;
          } else {
            break;
          }
        }

        currentChunkSentences = [...overlapSentences, sentence];
        currentLength = currentChunkSentences.reduce((acc, s) => acc + s.length + 1, 0);
      } else {
        currentChunkSentences.push(sentence);
        currentLength += sentenceLen + 1;
      }
    }

    if (currentChunkSentences.length > 0) {
      const remainingContent = currentChunkSentences.join(' ').trim();
      if (remainingContent.length >= minChunkLength || chunks.length === 0) {
        chunks.push(remainingContent);
      }
    }

    return chunks.map((content, idx) => ({
      id: crypto.randomUUID(),
      crawlerId: meta.crawlerId,
      pageId: meta.pageId,
      url: meta.url,
      title: meta.title,
      chunkIndex: idx,
      content,
      contentHash: hashContent(content),
      tokenCount: this.estimateTokenCount(content),
    }));
  }

  private splitIntoSentences(text: string): string[] {
    const rawPieces = text.split(/(?<=[.?!])\s+|\n+/);
    return rawPieces
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export const chunkingService = new ChunkingService();
export default chunkingService;
export { ChunkItem, ChunkOptions };
