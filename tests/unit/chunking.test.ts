import { describe, it, expect } from 'vitest';
import { chunkingService } from '../../src/services/chunking.service';

describe('ChunkingService', () => {
  const meta = {
    crawlerId: 'crawler-1',
    pageId: 'page-1',
    url: 'https://example.com/docs',
    title: 'Documentation Overview',
  };

  it('creates single chunk for short content', () => {
    const text = 'This is a brief piece of documentation text that easily fits in one chunk.';
    const chunks = chunkingService.chunkText(text, meta, { chunkSize: 700 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].crawlerId).toBe('crawler-1');
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].contentHash).toBeDefined();
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it('splits long content across multiple chunks with overlap', () => {
    // Generate text with 10 sentences
    const sentences = Array.from(
      { length: 25 },
      (_, i) => `This is sentence number ${i + 1} explaining backend architecture and vector indexing in detail.`
    );
    const longText = sentences.join(' ');

    const chunks = chunkingService.chunkText(longText, meta, {
      chunkSize: 50, // Small token limit to force multiple chunks
      chunkOverlap: 15,
      minChunkLength: 30,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[1].chunkIndex).toBe(1);

    // Each chunk should have unique ID and hash
    const ids = new Set(chunks.map((c) => c.id));
    expect(ids.size).toBe(chunks.length);
  });

  it('returns empty array when content is empty or pure whitespace', () => {
    const chunks = chunkingService.chunkText('   \n\n  ', meta);
    expect(chunks).toHaveLength(0);
  });
});

