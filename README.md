# AI Matrix — Backend Service & Autonomous RAG Engine

A production-grade, high-throughput backend for the **AI Matrix** platform. Built with **Fastify 5**, **TypeScript**, **Prisma ORM**, **PostgreSQL**, **MongoDB (Mongoose)**, and **Qdrant Vector Database**, this service orchestrates automated website crawling, token-preserving content chunking, vector embedding generation, conversational RAG agents, and an extensible **Model Context Protocol (MCP)** and **Connector Platform**.

---

## Architecture Overview

```
                      ┌───────────────────────────────────────┐
                      │ Frontend Clients (Web / Next.js / API)│
                      └──────────────────┬────────────────────┘
                                         │ HTTP / JSON (REST & OpenAPI)
                                         ▼
                      ┌───────────────────────────────────────┐
                      │        Fastify 5 API Gateway          │
                      │  - Clerk Auth & Workspace Tenancy     │
                      │  - SSRF Hardening & Schema Validation │
                      │  - Swagger / OpenAPI Documentation    │
                      └───────┬──────────────┬─────────────┬──┘
                              │              │             │
              ┌───────────────┘              │             └────────────────┐
              ▼                              ▼                              ▼
┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
│     PostgreSQL / Prisma   │  │    MongoDB / Mongoose     │  │       Qdrant Vector DB    │
│ - Crawlers & Crawl Runs   │  │ - Multi-Turn Chat Threads │  │ - 768-dim Embeddings      │
│ - Crawled Pages & Chunks  │  │ - Chat Messages & History │  │ - Vector Similarity Index │
│ - Connector Definitions   │  │ - Execution Logs & Traces │  │ - 4 GiB Budget Enforcement│
│ - Connections & Tools     │  └───────────────────────────┘  └───────────────────────────┘
│ - AES-256-GCM Vault       │
│ - Agent Bindings & Audits │
└───────────────────────────┘
              │                              │                              │
              ▼                              ▼                              ▼
┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
│ Ingestion & Crawl Engine  │  │  Autonomous RAG Agent     │  │ Unified Connector / MCP   │
│ - Sitemap XML Discovery   │  │ - LangChain Integration   │  │ - Model Context Protocol  │
│ - Cheerio Content Parser  │  │ - Multi-Provider Fallback │  │ - Streamable HTTP & SSE   │
│ - Google GenAI Embeddings │  │   (Gemini, Groq, Claude)  │  │ - Native (Slack, Gmail)   │
│ - Incremental Delta Crawl │  │ - Dynamic Tool Binding    │  │ - OAuth 2.0 PKCE Flow     │
└───────────────────────────┘  └───────────────────────────┘  └───────────────────────────┘
```

### Technology Stack

| Layer | Technology | Description |
|---|---|---|
| **Runtime & Language** | Node.js 22 LTS, TypeScript (ES2020) | Type-safe domain models, DTOs, and runtime validation |
| **HTTP Framework** | Fastify 5 | High-throughput async web framework with encapsulated plugins |
| **Relational Database** | PostgreSQL via Prisma 6.4.1 | Schema, relational integrity, foreign keys, cascades, and migrations |
| **Document Store** | MongoDB via Mongoose 9.12.1 | Multi-turn chat persistence, citation tracking, execution traces |
| **Vector Database** | Qdrant (via `@langchain/qdrant`) | HNSW vector indexing, cosine similarity, payload filtering |
| **Embeddings** | Google Generative AI (`text-embedding-004`) | 768-dimension semantic embeddings via `@langchain/google-genai` |
| **LLM Orchestration** | LangChain (`@langchain/core`) | Agent tool loops with support for Gemini, Groq, OpenAI, and Anthropic |
| **Tool Integration** | `@modelcontextprotocol/sdk` (MCP) | Model Context Protocol client for stdio, HTTP-SSE, and Streamable HTTP |
| **Authentication** | Clerk (`@clerk/fastify`) | Multi-tenant authentication, organization/workspace tenancy, and JWT verification |
| **Data Scraping** | Cheerio, fast-xml-parser | Fast server-side HTML content extraction and recursive sitemap parsing |
| **Security & Cryptography**| Node.js `crypto` (AES-256-GCM) | Encrypted credential vault with unique IVs, auth tags, and key rotation |
| **API Documentation** | `@fastify/swagger`, `@fastify/swagger-ui` | Auto-generated OpenAPI 3.0 specs and interactive UI at `/documentation` |
| **Testing** | Vitest | Fast unit and integration tests |

---

## Key Backend Capabilities

### 1. Web Crawler & Vector Ingestion Engine
- **Recursive Sitemap Discovery**: Automatically parses XML sitemaps and nested `<sitemapindex>` files, sanitizes tracking parameters, and filters by host and glob patterns (`includePatterns` / `excludePatterns`).
- **SSRF Hardening**: Custom `FetcherService` and `ssrf-guard` strictly block private network ranges (`127.0.0.0/8`, `10.0.0.0/8`, `192.168.0.0/16`, `172.16-31.x.x`), cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`), and redirect loops.
- **Content Cleaning & Boilerplate Removal**: Strips navigation, headers, footers, forms, scripts, ads, and modals using Cheerio, focusing on semantic content containers (`main`, `article`, `[role="main"]`).
- **Token-Aware Chunking**: Splits extracted text into ~700-token blocks with 100-token overlaps while respecting sentence boundaries.
- **Incremental Crawling & Deduplication**: Computes SHA-256 hashes of page content. Re-crawls skip unchanged pages, avoiding redundant embedding generation, and clean up orphaned vectors when content shrinks.
- **Qdrant Storage Budget Enforcement**: Tracks vector collection sizes against a configurable ceiling (default 4 GiB). Automatically halts ingestion at 85% capacity with a `PARTIALLY_COMPLETED` status.
- **In-Process Lifecycle & Crash Recovery**: Manages runs with `PENDING`, `RUNNING`, `COMPLETED`, `CANCELLED`, and `INTERRUPTED` states. In-flight crawls can be aborted cooperatively via `AbortController`, and uncompleted runs from server crashes are marked `INTERRUPTED` on startup.

### 2. Semantic Vector Search
- **Cosine Similarity Search**: Performs high-speed nearest-neighbor queries against Qdrant collections.
- **Score Filtering & Pagination**: Discards weak matches below configurable relevance thresholds (default 0.5) and supports paginated retrieval.
- **Detailed Payload Metadata**: Returns match score, chunk text, canonical URL, page title, chunk index, and crawler metadata.

### 3. Conversational RAG Agent
- **Autonomous Tool-Calling Agent**: Leverages LangChain agent loops with dynamic model selection (`gemini-2.5-flash-lite`, Groq Llama, OpenAI, Claude).
- **Knowledge Base Grounding**: Equips the agent with a `search_knowledge_base` tool to query Qdrant and cite indexed documentation.
- **Conversation State in MongoDB**: Preserves full multi-turn chat threads, tool call inputs/outputs, citations, and metadata in `ChatThread`.
- **Sliding Context Window Management**: Automatically trims conversation history to prevent context overflow while preserving essential instructions.

### 4. Unified Connector & MCP Platform
- **Model Context Protocol (MCP)**: Native integration with `@modelcontextprotocol/sdk` supporting **Streamable HTTP**, **Legacy HTTP SSE**, and **stdio** server transports.
- **Multi-Tenant Workspace Connections**: Users connect services either at the personal user level or organization workspace level.
- **Native & Custom Connectors**: Out-of-the-box definitions for Slack, Gmail, GitHub, custom REST endpoints, and arbitrary MCP servers.
- **AES-256-GCM Credential Vault**: Secures API keys, bearer tokens, and OAuth credentials with authenticated symmetric encryption, storing IVs and auth tags.
- **OAuth 2.0 PKCE Engine**: Manages the end-to-end authorization code grant with code verifiers, state validation, token exchanges, and token refreshes.
- **Tool Execution Engine**: Dynamically executes MCP and native tools with input schema validation, approval workflows (`requiresApproval`), per-minute rate limits, and audit logging.
- **Agent Bindings**: Allows specific AI agents to be bound to a subset of enabled tools from configured connections.

### 5. Multi-Tenant Security & Observability
- **Clerk Authentication**: Validates session tokens and injects `auth.userId` and `auth.orgId` into request contexts.
- **CORS Protection**: Whitelists configured production frontends (`ai-matrix-dun.vercel.app`, `ai-matrix-k6qw.vercel.app`) and local development ports (`3000`, `5173`).
- **Interactive OpenAPI Documentation**: Full documentation served at `/documentation` (with `/docs` convenience redirect).
- **Health & Readiness Checks**: Liveness probe at `/api/health` and multi-service readiness check at `/api/ready` verifying PostgreSQL and Qdrant connectivity.

---

## REST API Reference

All API routes are prefixed under `/api`.

### General & Health
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api` | API status and documentation link |
| `GET` | `/api/health` | Service liveness probe (uptime, status, timestamp) |
| `GET` | `/api/ready` | Readiness check (tests PostgreSQL and Qdrant connectivity) |
| `GET` | `/documentation` | Interactive Swagger / OpenAPI documentation UI |

### Crawlers & Crawl Operations
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/crawlers` | Create a new crawler configuration |
| `GET` | `/api/crawlers` | List all crawler configurations |
| `GET` | `/api/crawlers/:id` | Get crawler configuration and summary stats |
| `PATCH` | `/api/crawlers/:id` | Update crawler configuration |
| `DELETE` | `/api/crawlers/:id` | Delete crawler and purge associated Qdrant vectors |
| `POST` | `/api/crawlers/:id/crawl` | Trigger an incremental crawl run (`202 Accepted`) |
| `POST` | `/api/crawlers/:id/crawl/full` | Trigger a full re-crawl (forces re-embedding) |
| `POST` | `/api/crawlers/:id/cancel` | Cooperatively abort an active crawl run |
| `GET` | `/api/crawlers/:crawlerId/metrics` | Get detailed storage and page metrics |

### Crawl Runs & Progress Monitoring
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/crawl-runs` | List crawl runs with pagination (`?page=1&limit=20`) |
| `GET` | `/api/crawl-runs/:runId` | Get crawl run status, timing, and storage metrics |
| `GET` | `/api/crawl-runs/:runId/progress` | Real-time progress polling endpoint for active runs |
| `GET` | `/api/crawl-runs/:runId/pages` | Paginated page-level crawl logs (`?status=COMPLETED`) |

### Semantic Vector Search
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/search` | Execute semantic vector search (`?q=...&limit=10&threshold=0.5`) |

### Conversational RAG Chat
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat` | Send a message to the AI agent (creates or continues thread) |
| `GET` | `/api/chat` | List all chat threads for the current workspace/user |
| `GET` | `/api/chat/:chatId` | Get full message history and citations for a thread |
| `DELETE` | `/api/chat/:chatId` | Delete a conversation thread |

### Connector Platform Catalog & Connections
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/connectors` | List available connector definitions (native, MCP, custom) |
| `GET` | `/api/connectors/:id` | Get details and configuration schema for a connector |
| `GET` | `/api/connections` | List active connections in the workspace |
| `POST` | `/api/connections` | Create a new connection instance |
| `GET` | `/api/connections/:id` | Get connection details, tools, and discovery status |
| `PATCH` | `/api/connections/:id` | Update connection configuration or enabled tools |
| `DELETE` | `/api/connections/:id` | Delete a connection and revoke credentials |
| `POST` | `/api/connections/:id/test` | Test connectivity to the remote service / MCP server |
| `POST` | `/api/connections/:id/discover` | Discover tools, resources, and prompts from the connector |
| `POST` | `/api/connections/:id/execute` | Execute a tool provided by this connection |

### Model Context Protocol (MCP) Management
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/mcp/probe` | Probe an MCP server endpoint for capabilities and health |
| `POST` | `/api/mcp/discover` | Inspect and discover tools/prompts from a remote MCP URL |
| `POST` | `/api/mcp/execute` | Invoke an MCP tool with schema validation |

### OAuth 2.0 & Authentication
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/connections/:id/auth/start` | Initiate OAuth 2.0 PKCE flow (returns redirect URL) |
| `GET` | `/api/oauth/callback` | OAuth 2.0 callback endpoint for token exchange |

### Agent Connector Bindings & Brandfetch
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/agents/:agentId/connectors` | List connectors bound to a specific agent |
| `POST` | `/api/agents/:agentId/connectors` | Bind a connector and allowed tools to an agent |
| `DELETE` | `/api/agents/:agentId/connectors/:connectionId` | Remove a connector binding from an agent |
| `GET` | `/api/brands/:domain` | Retrieve brand metadata and logos via Brandfetch |

---

## Environment Configuration

Configuration is validated on startup via **Zod** (`src/config/env.ts`). Create a `.env` file in the project root:

```bash
cp .env.example .env
```

| Variable | Type | Description |
|---|---|---|
| `NODE_ENV` | String | `development` | Environment mode (`development`, `production`, `test`) |
| `PORT` | Number | `4000` | Application server port |
| `LOG_LEVEL` | String | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `CORS_ORIGIN` | String | `""` | Comma-separated list of allowed origins |
| **Authentication & Vault** | | | |
| `CLERK_PUBLISHABLE_KEY` | String | `""` | Clerk publishable key |
| `CLERK_SECRET_KEY` | String | `""` | Clerk backend secret key |
| `ENCRYPTION_MASTER_KEY` | String | `""` | 32-byte hex key for AES-256-GCM Credential Vault |
| **Databases** | | | |
| `DATABASE_URL` | String | *(Required)* | PostgreSQL connection string |
| `MONGODB_URL` | String | `mongodb://localhost:27017/chat` | MongoDB connection string |
| `QDRANT_URL` | String | `http://localhost:6333` | Qdrant vector database URL |
| `QDRANT_API_KEY` | String | `""` | Optional Qdrant API key |
| `QDRANT_COLLECTION` | String | `website_content` | Qdrant vector collection name |
| `QDRANT_VECTOR_SIZE` | Number | `768` | Embedding dimension (768 for `text-embedding-004`) |
| `QDRANT_DISTANCE` | String | `Cosine` | Vector distance metric (`Cosine`, `Euclid`, `Dot`) |
| **Embeddings & LLMs** | | | |
| `EMBEDDING_PROVIDER` | String | `google` | Embeddings provider (`google`) |
| `EMBEDDING_MODEL` | String | `text-embedding-004` | Google embedding model |
| `GOOGLE_API_KEY` | String | *(Required for crawl)* | Google Generative AI API key |
| `AGENT_PROVIDER` | String | `auto` | LLM provider (`google`, `groq`, `openai`, `anthropic`, `auto`) |
| `AGENT_MODEL` | String | `gemini-2.5-flash-lite` | Chat LLM model identifier |
| `GEMINI_API_KEY` | String | `""` | Google Gemini API key |
| `GROQ_API_KEY` | String | `""` | Groq API key |
| `OPENAI_API_KEY` | String | `""` | OpenAI API key |
| `ANTHROPIC_API_KEY` | String | `""` | Anthropic Claude API key |
| **Crawler Engine** | | | |
| `CRAWLER_MAX_CONCURRENCY` | Number | `3` | Max concurrent worker fetches per crawl |
| `CRAWLER_REQUEST_TIMEOUT_MS`| Number | `15000` | HTTP fetch timeout in milliseconds |
| `CRAWLER_MAX_PAGES_PER_RUN` | Number | `1000` | Hard cap on pages per crawl run |
| `CRAWLER_MAX_RESPONSE_BYTES`| Number | `5242880` | Max response body size (5 MB) |
| `CRAWLER_MAX_REDIRECTS` | Number | `5` | Maximum redirects allowed |
| `CRAWLER_DEFAULT_DELAY_MS` | Number | `500` | Courtesy delay between HTTP requests |
| `CHUNK_SIZE` | Number | `700` | Target tokens per text chunk |
| `CHUNK_OVERLAP` | Number | `100` | Overlap tokens between consecutive chunks |
| **Storage & Integrations** | | | |
| `QDRANT_STORAGE_BUDGET_BYTES` | Number | `4294967296` | 4 GiB storage ceiling |
| `QDRANT_STORAGE_STOP_THRESHOLD_PERCENT` | Number | `85` | Ingestion halt threshold (85% of budget) |
| `BRANDFETCH_API_KEY` | String | `""` | Optional Brandfetch API key for logo enrichment |
| `OAUTH_REDIRECT_BASE_URL` | String | `http://localhost:3000/api/oauth/callback` | OAuth redirect endpoint |
| `FRONTEND_REDIRECT_BASE_URL` | String | `http://localhost:5173/connector` | Frontend landing URL after OAuth flow |

---

## Getting Started

### Prerequisites
- **Node.js**: v20 or v22 LTS
- **Docker**: For running PostgreSQL, MongoDB, and Qdrant locally

### 1. Start Infrastructure (Docker Compose)
Launch PostgreSQL, MongoDB, and Qdrant in the background:

```bash
docker compose up -d
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Database & Prisma
Run Prisma migrations and generate the Prisma Client:

```bash
# Run database migrations
npm run prisma:migrate

# Generate Prisma Client
npm run prisma:generate

# (Optional) Open Prisma Studio database GUI
npm run prisma:studio
```

### 4. Start Development Server
```bash
npm run dev
```

The server starts at `http://localhost:4000`. You can explore the interactive API documentation at:
- **Swagger UI**: [http://localhost:4000/documentation](http://localhost:4000/documentation)

---

## Build, Test & Scripts

```bash
# Typecheck TypeScript codebase without emitting JS
npm run typecheck

# Run test suite via Vitest
npm run test

# Build production distribution (runs prisma generate + tsc)
npm run build

# Start production server
npm run start
```

---

## Project Structure

```
AI-Matrix-backend/
├── prisma/
│   ├── migrations/               # PostgreSQL schema migrations
│   └── schema.prisma             # Authoritative Prisma schema (Crawlers & Connectors)
├── src/
│   ├── app.ts                    # Fastify application factory, plugins, CORS & Swagger
│   ├── server.ts                 # Server entry point & graceful shutdown hooks
│   ├── config/
│   │   ├── constants.ts          # Default configuration parameters
│   │   └── env.ts                # Zod environment schema & runtime parser
│   ├── lib/
│   │   ├── errors.ts             # Centralized application error classes & error handler
│   │   ├── logger.ts             # Pino logger instance & Fastify request logger
│   │   ├── mongoose.ts           # MongoDB connection lifecycle manager
│   │   ├── prisma.ts             # Singleton Prisma client instance
│   │   ├── network/              # SSRF guard & IP verification
│   │   └── vault/                # AES-256-GCM Credential Vault service
│   ├── middleware/
│   │   ├── auth.ts               # Clerk authentication & workspace verification
│   │   └── notFound.ts           # 404 handler
│   ├── models/                   # Mongoose models (ChatThread, ConnectorExecutionLog)
│   ├── modules/                  # Feature domain modules
│   │   ├── adapters/             # Native (Gmail, Slack, GitHub) & MCP adapters
│   │   ├── agents/               # Agent connector bindings & tool resolution
│   │   ├── chat/                 # Conversational RAG agent, LangChain & context window
│   │   ├── connections/          # Workspace connections lifecycle & operations
│   │   ├── connectors/           # Connector catalog registry & metadata
│   │   ├── crawl-runs/           # Crawl run progress tracking & page logs
│   │   ├── crawlers/             # Crawler CRUD & execution triggers
│   │   ├── execution/            # Unified tool execution engine & rate limiter
│   │   ├── mcp/                  # MCP discovery, transport manager & runtime
│   │   └── search/               # Semantic vector search service & controller
│   ├── routes/                   # Fastify route registrations (mounted under /api)
│   ├── services/                 # Core ingestion & vector services (Sitemap, Fetcher,
│   │                             # ContentExtractor, Chunking, Embedding, Qdrant, Storage)
│   ├── tools/                    # LangChain tools (vectorKnowledgeBaseTool)
│   ├── types/                    # Shared TypeScript interfaces & DTOs
│   └── utils/                    # Utility functions (hashing, progress, schema converter)
├── tests/
│   ├── integration/              # API and subsystem integration tests
│   └── unit/                     # Unit tests for services, vault, and utilities
├── docker-compose.yml            # Local PostgreSQL, MongoDB, and Qdrant containers
├── package.json                  # Dependencies, scripts, and package metadata
├── tsconfig.json                 # TypeScript compiler configuration
└── PRD.md                        # Product Requirements Document for AI Matrix Backend
```

---

## License

MIT
