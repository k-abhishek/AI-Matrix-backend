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
  knowledgeBaseId?: string;
  scope?: 'PLATFORM' | 'WORKSPACE';
  workspaceId?: string | null;
  documentId?: string;
  status?: 'ACTIVE' | 'ARCHIVED' | 'QUARANTINED';
}

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  minChunkLength?: number;
}

