export interface QdrantPointPayload {
  crawlerId: string;
  pageId: string;
  url: string;
  title: string;
  content: string;
  chunkIndex: number;
  contentHash: string;
  crawledAt: string;
  knowledgeBaseId?: string;
  scope?: 'PLATFORM' | 'WORKSPACE';
  workspaceId?: string | null;
  documentId?: string;
  status?: string;
  [key: string]: unknown;
}

export interface CollectionStats {
  pointsCount: number;
  vectorsCount: number;
  status: string;
}
