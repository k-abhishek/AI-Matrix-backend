export interface SearchQueryInput {
  query: string;
  limit?: number;
  page?: number;
  scoreThreshold?: number;
  collectionName?: string;
  crawlerName?: string;
}

export interface SearchResultItemMetadata {
  crawlerId?: string;
  pageId?: string;
  url?: string;
  title?: string;
  chunkIndex?: number;
  contentHash?: string;
  crawledAt?: string;
  [key: string]: unknown;
}

export interface SearchResultItem {
  id: string;
  score: number;
  content: string;
  metadata: SearchResultItemMetadata;
}

export interface SearchResponseData {
  query: string;
  total: number;
  page: number;
  limit: number;
  results: SearchResultItem[];
}
