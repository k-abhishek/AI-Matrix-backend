export interface IEmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  embedBatch(texts: string[]): Promise<number[][]>;
}

