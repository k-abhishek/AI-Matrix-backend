import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { DEFAULT_CONFIG } from './constants';

// Load .env from current directory or parent directories
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env'),
];

for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(DEFAULT_CONFIG.PORT),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default(DEFAULT_CONFIG.LOG_LEVEL),
  CORS_ORIGIN: z.string().default(''),

  // Clerk Authentication
  CLERK_PUBLISHABLE_KEY: z.string().optional().default(''),
  CLERK_SECRET_KEY: z.string().optional().default(''),

  // Credential Vault
  ENCRYPTION_MASTER_KEY: z.string().optional().default(''),

  // OAuth Providers (Optional)
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  SLACK_CLIENT_ID: z.string().optional().default(''),
  SLACK_CLIENT_SECRET: z.string().optional().default(''),
  OAUTH_REDIRECT_BASE_URL: z.string().optional().default('http://localhost:5000/api/oauth/callback'),
  FRONTEND_REDIRECT_BASE_URL: z.string().optional().default('http://localhost:5173/connector'),

  // MongoDB / Mongoose
  MONGODB_URL: z.string().default('mongodb://localhost:27017/chat'),

  // PostgreSQL / Prisma
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .default(
      process.env.NODE_ENV === 'test'
        ? 'postgresql://postgres:postgres@localhost:5432/website_crawler_test?schema=public'
        : ''
    ),

  // Qdrant
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional().or(z.literal('')),
  QDRANT_COLLECTION: z.string().default(DEFAULT_CONFIG.QDRANT_COLLECTION),
  QDRANT_VECTOR_SIZE: z.coerce.number().int().positive().default(DEFAULT_CONFIG.QDRANT_VECTOR_SIZE),
  QDRANT_DISTANCE: z.enum(['Cosine', 'Euclid', 'Dot']).default('Cosine'),

  // Embeddings
  EMBEDDING_PROVIDER: z.string().default(DEFAULT_CONFIG.EMBEDDING_PROVIDER),
  EMBEDDING_MODEL: z.string().default(DEFAULT_CONFIG.EMBEDDING_MODEL),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().default(DEFAULT_CONFIG.EMBEDDING_BATCH_SIZE),
  GOOGLE_API_KEY: z.string().optional().or(z.literal('')),

  // Agent & LLM
  AGENT_PROVIDER: z.enum(['google', 'groq', 'openai', 'anthropic', 'auto']).default('auto'),
  GEMINI_API_KEY: z.string().optional().or(z.literal('')),
  GROQ_API_KEY: z.string().optional().or(z.literal('')),
  OPENAI_API_KEY: z.string().optional().or(z.literal('')),
  ANTHROPIC_API_KEY: z.string().optional().or(z.literal('')),
  AGENT_MODEL: z.string().default(process.env.GEMINI_MODEL || process.env.GROQ_MODEL || 'gemini-2.5-flash-lite'),

  // Crawler
  CRAWLER_MAX_CONCURRENCY: z.coerce.number().int().positive().default(DEFAULT_CONFIG.CRAWLER_MAX_CONCURRENCY),
  CRAWLER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_CONFIG.CRAWLER_REQUEST_TIMEOUT_MS),
  CRAWLER_MAX_PAGES_PER_RUN: z.coerce.number().int().positive().default(DEFAULT_CONFIG.CRAWLER_MAX_PAGES_PER_RUN),
  CRAWLER_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(DEFAULT_CONFIG.CRAWLER_MAX_RESPONSE_BYTES),
  CRAWLER_MAX_REDIRECTS: z.coerce.number().int().positive().default(DEFAULT_CONFIG.CRAWLER_MAX_REDIRECTS),
  CRAWLER_DEFAULT_DELAY_MS: z.coerce.number().int().min(0).default(DEFAULT_CONFIG.CRAWLER_DEFAULT_DELAY_MS),

  // Storage Budget
  QDRANT_STORAGE_BUDGET_BYTES: z.coerce.number().int().positive().default(DEFAULT_CONFIG.QDRANT_STORAGE_BUDGET_BYTES),
  QDRANT_STORAGE_STOP_THRESHOLD_PERCENT: z.coerce.number().min(1).max(100).default(DEFAULT_CONFIG.QDRANT_STORAGE_STOP_THRESHOLD_PERCENT),

  // Brandfetch API Key (for server-side Brand API)
  BRANDFETCH_API_KEY: z.string().optional().default(''),

  // Chunking
  CHUNK_SIZE: z.coerce.number().int().positive().default(DEFAULT_CONFIG.CHUNK_SIZE),
  CHUNK_OVERLAP: z.coerce.number().int().min(0).default(DEFAULT_CONFIG.CHUNK_OVERLAP),
});

export type Env = z.infer<typeof envSchema>;

let parsedEnv: Env;

try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    const errorDetails = error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`\x1b[31m[CONFIG ERROR] Invalid environment configuration:\x1b[0m\n${errorDetails}`);
  } else {
    console.error('\x1b[31m[CONFIG ERROR] Failed to parse environment variables:\x1b[0m', error);
  }
  process.exit(1);
}

export const env = parsedEnv;
export default env;
