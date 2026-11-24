export interface ChunkItem {
  id: string;
  crawlerId: string;
  pageId: string;
  url: string;
  title: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenCount: number;
}

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  minChunkLength?: number;
}

