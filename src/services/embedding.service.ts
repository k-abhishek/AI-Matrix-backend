import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { Embeddings } from '@langchain/core/embeddings';
import env from '../config/env';
import logger from '../lib/logger';
import { IEmbeddingProvider } from '../types';

export class ValidatedGoogleGenerativeAIEmbeddings extends GoogleGenerativeAIEmbeddings {
  readonly dimension: number;

  constructor(fields: ConstructorParameters<typeof GoogleGenerativeAIEmbeddings>[0], dimension = 768) {
    super({
      ...fields,
      outputDimensionality: dimension,
    });
    this.dimension = dimension;
  }

  override async embedDocuments(documents: string[]): Promise<number[][]> {
    const embeddings = await super.embedDocuments(documents);
    for (const vec of embeddings) {
      if (!vec || vec.length === 0) {
        throw new Error(
          `Embedding generation failed: Google Generative AI returned an empty vector for model '${this.model}'. ` +
            `Ensure your GOOGLE_API_KEY is valid and the model is supported.`
        );
      }
      if (vec.length !== this.dimension) {
        logger.warn(
          `Embedding vector dimension (${vec.length}) does not match expected dimension (${this.dimension})`
        );
      }
    }
    return embeddings;
  }

  override async embedQuery(document: string): Promise<number[]> {
    const vec = await super.embedQuery(document);
    if (!vec || vec.length === 0) {
      throw new Error(
        `Embedding generation failed: Google Generative AI returned an empty vector for model '${this.model}'. ` +
          `Ensure your GOOGLE_API_KEY is valid and the model is supported.`
      );
    }
    return vec;
  }
}

export class MockEmbeddings extends Embeddings {
  readonly dimension: number;

  constructor(dimension = 768) {
    super({});
    this.dimension = dimension;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const vec = new Array(this.dimension).fill(0);
      let hash = 0;
      for (let i = 0; i < t.length; i++) {
        hash = (hash << 5) - hash + t.charCodeAt(i);
        hash |= 0;
      }
      for (let i = 0; i < this.dimension; i++) {
        vec[i] = Math.sin(hash + i);
      }
      const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
      return vec.map((v) => v / norm);
    });
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vec] = await this.embedDocuments([text]);
    return vec;
  }
}

export class GoogleGenAIEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'google-genai';
  readonly dimension: number;
  readonly embeddings: ValidatedGoogleGenerativeAIEmbeddings;

  constructor(apiKey?: string, model = env.EMBEDDING_MODEL, dimension = env.QDRANT_VECTOR_SIZE) {
    this.dimension = dimension;
    const key = apiKey || env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        'GOOGLE_API_KEY is not configured. Please set GOOGLE_API_KEY in your environment to generate embeddings with GoogleGenerativeAIEmbeddings.'
      );
    }
    this.embeddings = new ValidatedGoogleGenerativeAIEmbeddings(
      {
        apiKey: key,
        model,
      },
      dimension
    );
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.embeddings.embedDocuments(texts);
  }
}

/**
 * Mock provider for testing without requiring a live Google API key.
 */
export class MockEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'mock';
  readonly dimension: number;
  readonly embeddings: MockEmbeddings;

  constructor(dimension = env.QDRANT_VECTOR_SIZE) {
    this.dimension = dimension;
    this.embeddings = new MockEmbeddings(dimension);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }
}

export class EmbeddingService {
  private provider: IEmbeddingProvider;
  private batchSize: number;

  constructor(provider?: IEmbeddingProvider, batchSize = env.EMBEDDING_BATCH_SIZE) {
    this.batchSize = batchSize;
    if (provider) {
      this.provider = provider;
    } else {
      const apiKey = env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (apiKey) {
        this.provider = new GoogleGenAIEmbeddingProvider(
          apiKey,
          env.EMBEDDING_MODEL,
          env.QDRANT_VECTOR_SIZE
        );
      } else if (env.NODE_ENV === 'test') {
        this.provider = new MockEmbeddingProvider(env.QDRANT_VECTOR_SIZE);
      } else {
        this.provider = {
          name: 'uninitialized',
          dimension: env.QDRANT_VECTOR_SIZE,
          embedBatch: async () => {
            throw new Error(
              'Embedding provider uninitialized: Please set GOOGLE_API_KEY in your environment.'
            );
          },
        };
      }
    }
  }

  get dimension(): number {
    return this.provider.dimension;
  }

  setProvider(provider: IEmbeddingProvider) {
    this.provider = provider;
  }

  getEmbeddings(): Embeddings {
    if ('embeddings' in this.provider && (this.provider as any).embeddings instanceof Embeddings) {
      return (this.provider as any).embeddings;
    }

    // Fallback adapter for custom IEmbeddingProvider implementations
    const self = this;
    class CustomAdapterEmbeddings extends Embeddings {
      constructor() {
        super({});
      }
      async embedDocuments(documents: string[]): Promise<number[][]> {
        return self.generateEmbeddings(documents);
      }
      async embedQuery(document: string): Promise<number[]> {
        const [vec] = await self.generateEmbeddings([document]);
        return vec;
      }
    }
    return new CustomAdapterEmbeddings();
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      logger.debug(
        `Generating embeddings for batch of ${batch.length} chunks (${i + 1}-${i + batch.length} of ${texts.length})`
      );

      try {
        const batchEmbeddings = await this.provider.embedBatch(batch);
        allEmbeddings.push(...batchEmbeddings);
      } catch (err: any) {
        logger.error(`Failed to generate embeddings batch: ${err.message}`);
        throw err;
      }
    }

    return allEmbeddings;
  }
}

export const embeddingService = new EmbeddingService();
export default embeddingService;
export { IEmbeddingProvider };
