# AI-Matrix Backend — Product Requirements Document (PRD)

> **Document Version:** 2.0  
> **Scope:** AI-Matrix Backend Services & Autonomous RAG Engine  
> **Author:** Abhishek Kumar  

---

## 1. Project Overview

**AI-Matrix Backend** is a high-throughput, enterprise-ready backend service that provides automated website crawling, vector embedding ingestion, semantic search, an autonomous conversational RAG (Retrieval-Augmented Generation) agent, and an extensible **Model Context Protocol (MCP)** and **Connector Platform**.

Following the decoupling of the AI-Matrix platform into dedicated frontend and backend services, this repository serves exclusively as the **authoritative backend API gateway, vector ingestion pipeline, and agent tool execution engine**.

### Vision

Deliver a resilient, modular, and self-hosted AI backend that seamlessly indexes enterprise documentation into vector stores, grounds conversational LLM reasoning in verified knowledge, and securely connects agents to external tools and services via modern standards like MCP and OAuth 2.0.

### Key Value Propositions

- **Autonomous Knowledge Ingestion** — Ingest entire websites via recursive sitemap discovery, clean HTML boilerplate via Cheerio, generate 768-dimensional embeddings, and maintain vector parity in Qdrant with delta deduplication.
- **Multi-Model Conversational RAG** — Power interactive AI chat with automatic fallback across Google Gemini, Groq, OpenAI, and Anthropic Claude, grounded by similarity search citations and persistent multi-turn history.
- **Unified Connector & MCP Subsystem** — Connect AI agents to third-party APIs (Slack, Gmail, GitHub) and remote MCP servers (stdio, SSE, Streamable HTTP) backed by an AES-256-GCM encrypted Credential Vault.
- **Enterprise Multi-Tenancy & Security** — Enforce Clerk-based authentication and workspace isolation, comprehensive SSRF network guards, and granular tool approval policies.

---

## 2. System Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │ External Frontends (Web / Next.js / Mobile)  │
                    └──────────────────────┬───────────────────────┘
                                           │ HTTP / JSON (CORS Enabled)
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                Fastify 5 API Gateway                                   │
│  - Clerk Authentication Middleware (@clerk/fastify) & Multi-Tenant Workspace Context   │
│  - Outbound SSRF Guard (Private IP & Cloud Metadata Protection)                        │
│  - Zod Request Schema Validation & Pino Structured Logging                             │
│  - Swagger / OpenAPI 3.0 Interactive Documentation (/documentation)                    │
└──────┬───────────────────────────┬──────────────────────────┬──────────────────────────┘
       │                           │                          │                          │
       ▼                           ▼                          ▼                          ▼
┌──────────────┐            ┌──────────────┐           ┌──────────────┐           ┌──────────────┐
│  PostgreSQL  │            │   MongoDB    │           │    Qdrant    │           │ External     │
│  (Prisma)    │            │  (Mongoose)  │           │  Vector DB   │           │ Services     │
├──────────────┤            ├──────────────┤           ├──────────────┤           ├──────────────┤
│ - Crawlers   │            │ - Multi-turn │           │ - 768-dim    │           │ - Google AI  │
│ - Crawl Runs │            │   Chat       │           │   Embeddings │           │ - Groq / LLMs│
│ - Pages &    │            │   Threads    │           │ - Cosine     │           │ - MCP Servers│
│   Chunks     │            │ - Connector  │           │   Distance   │           │ - OAuth APIs │
│ - Connectors │            │   Execution  │           │ - 4 GiB Hard │           │ - Brandfetch │
│ - Vault Keys │            │   Logs       │           │   Budget     │           │ - Clerk      │
│ - Tool Bindings           └──────────────┘           └──────────────┘           └──────────────┘
└──────────────┘
```

### Layered Architecture

| Layer | Responsibility | Key Technologies |
|---|---|---|
| **API Gateway & Routing** | HTTP routing, request parsing, authentication, CORS, rate limiting, and OpenAPI schemas | Fastify 5, `@fastify/cors`, `@fastify/swagger`, `@clerk/fastify` |
| **Ingestion Pipeline** | Sitemap parsing, SSRF-safe page fetching, Cheerio HTML extraction, chunking, and embedding generation | Cheerio, fast-xml-parser, `@langchain/google-genai`, `ssrf-guard` |
| **Vector Engine** | Vector upserting, indexing, payload filtering, storage budget tracking, and similarity search | Qdrant, `@langchain/qdrant` |
| **Agent & RAG Engine** | Dynamic LLM orchestration, sliding context window pruning, tool loops, and knowledge citation extraction | LangChain, `@langchain/groq`, `@langchain/openai`, `@langchain/anthropic` |
| **Connector & MCP Platform**| MCP server lifecycle, stdio/SSE/Streamable HTTP transports, OAuth 2.0 PKCE, and tool execution engine | `@modelcontextprotocol/sdk`, AES-256-GCM Vault, OAuth Manager |
| **Relational Persistence** | Authoritative relational data for crawlers, pages, chunks, connectors, credentials, and bindings | PostgreSQL, Prisma 6.4.1 |
| **Document Persistence** | Flexible multi-turn chat threads, message histories, and execution trace logs | MongoDB, Mongoose 9.12.1 |

---

## 3. Product Goals

### 3.1 Primary Goals

| # | Goal | Description |
|---|---|---|
| 1 | **Autonomous Knowledge Ingestion** | In-process, highly concurrent crawler capable of parsing sitemaps, extracting semantic content, chunking with sentence preservation, and generating 768-dim vector embeddings in Qdrant. |
| 2 | **Low-Latency Semantic Search** | Sub-second cosine similarity search across indexed documentation with configurable score thresholds, payload filtering, and pagination. |
| 3 | **Conversational RAG Runtime** | Multi-turn AI agent runtime supporting dynamic LLM provider failover (Gemini, Groq, OpenAI, Claude), citation extraction, and persistent conversation threads. |
| 4 | **Extensible Connector & MCP Subsystem** | Standards-compliant Model Context Protocol (MCP) host with stdio, SSE, and HTTP transports, alongside native integrations and an AES-256-GCM credential vault. |
| 5 | **Secure Multi-Tenancy** | Granular workspace and user tenancy enforced via Clerk authentication, workspace-scoped connections, and strict SSRF defenses on all outbound HTTP calls. |
| 6 | **Production-Ready Observability** | Centralized error handling, Pino structured logging, health probes (`/api/health`), and readiness probes (`/api/ready`) validating backing datastores. |

### 3.2 Secondary Goals

| # | Goal | Description |
|---|---|---|
| 7 | **Delta / Incremental Crawling** | Content-hash (SHA-256) deduplication that skips re-embedding unchanged documents and purges orphaned vector points when content shrinks. |
| 8 | **Vector Storage Budget Enforcement** | Automatic monitoring of Qdrant collection byte size, halting crawl runs gracefully when reaching 85% of the 4 GiB allocation. |
| 9 | **Crash Recovery & Cooperative Cancellation** | Startup reconciliation marking abandoned crawls as `INTERRUPTED`, paired with `AbortController` signal propagation for instantaneous user cancellations. |
| 10 | **Tool Execution Governance** | Granular permission gates including per-tool rate limiting, user approval flags (`requiresApproval`), and audit logging. |

---

## 4. Backend Functional Capabilities

### 4.1 Web Crawler & Knowledge Ingestion Engine

- **Sitemap Discovery (`SitemapService`)**:
  - Recursively navigates XML sitemaps and `<sitemapindex>` roots.
  - Normalizes URLs, strips tracking query parameters (`utm_*`, `ref`), and deduplicates endpoints.
  - Enforces `allowedHosts` boundaries, regex/glob include and exclude patterns, and maximum page limits.
- **SSRF Hardening (`FetcherService` & `ssrf-guard`)**:
  - Validates protocols (HTTP/HTTPS only).
  - Validates resolved DNS IP addresses against RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`), link-local (`169.254.0.0/16`), and cloud metadata services.
  - Inspects redirect chains to prevent DNS rebinding or redirect-based SSRF bypasses.
  - Enforces streaming byte limits (default 5 MB per response) and request timeouts.
- **Content Extraction (`ContentExtractorService`)**:
  - Removes boilerplate elements: `script`, `style`, `noscript`, `iframe`, `svg`, `nav`, `footer`, `header`, `aside`, `form`, `button`, ads, and modal overlays.
  - Prioritizes semantic main content: `main` > `article` > `[role="main"]` > `body`.
  - Extracts canonical URL, page title, meta description, H1–H6 header hierarchies, and clean readable text.
- **Sentence-Preserving Chunking (`ChunkingService`)**:
  - Chunks text into ~700-token blocks with 100-token overlap, preserving sentence boundaries to maintain semantic context.
- **Incremental Ingestion & Deduplication**:
  - Computes SHA-256 hashes of extracted text. Unmodified pages are skipped during delta crawls.
  - Cleans up orphaned Qdrant vector points when page revisions yield fewer chunks.
- **Qdrant Storage Budget Enforcement (`StorageService`)**:
  - Calculates vector float footprint + payload bytes + HNSW index overhead.
  - Halts ingestion when estimated storage exceeds 85% of the 4 GiB budget, updating the run status to `PARTIALLY_COMPLETED`.
- **In-Process Run Lifecycle & Recovery (`CrawlService`)**:
  - Asynchronous execution: `POST /api/crawlers/:id/crawl` responds immediately with `202 Accepted` and `crawlRunId`.
  - Cooperative cancellation via `AbortController` (`POST /api/crawlers/:id/cancel`).
  - Startup crash recovery: Automatically marks lingering `RUNNING` crawl runs as `INTERRUPTED` on server reboot.

### 4.2 Semantic Vector Search

- **Cosine Similarity Retrieval**:
  - Transforms user search queries into 768-dimensional embeddings via Google `text-embedding-004`.
  - Performs nearest-neighbor vector search in Qdrant with score threshold filtering (default 0.5) to discard irrelevant matches.
- **Rich Payload Metadata**:
  - Returns relevance scores, matched content chunks, source URLs, page titles, chunk indices, and crawler IDs.
  - Supports query pagination (`page`, `limit`).

### 4.3 Conversational RAG Agent

- **Autonomous Tool-Calling Agent**:
  - Built with LangChain's agent runtime, using dynamic tool calling.
  - LLM Provider Factory supporting **Google Gemini** (`gemini-2.5-flash-lite`), **Groq**, **OpenAI**, and **Anthropic Claude**.
- **Vector Knowledge Base Tool (`vectorKnowledgeBaseTool`)**:
  - Exposes indexed Qdrant vectors to the agent as a first-class tool (`search_knowledge_base`).
  - Extracts source citations (URL, page title, match score, chunk snippet) and returns them to the caller.
- **Multi-Turn Chat Persistence in MongoDB**:
  - Stores conversations in `ChatThread` documents with user/assistant messages, tool call inputs, outputs, and citations.
- **Sliding Context Window Service (`ContextWindowService`)**:
  - Dynamically calculates message token counts, pruning oldest conversational turns when approaching model context limits while preserving system instructions.

### 4.4 Unified Connector & MCP Platform

- **Connector Definitions Catalog (`ConnectorDefinition`)**:
  - System and custom connector definitions supporting **Native** (Slack, Gmail, GitHub), **Model Context Protocol (MCP)**, and **Custom REST** types.
  - Supports varied authentication schemes: `NONE`, `API_KEY`, `BEARER_TOKEN`, `BASIC_AUTH`, `OAUTH2_AUTHORIZATION_CODE`, `OAUTH2_CLIENT_CREDENTIALS`, and `CUSTOM_HEADERS`.
- **Workspace Connections (`ConnectorConnection`)**:
  - Multi-tenant connection instances scoped to Clerk `workspaceId` and creator `userId`.
  - Connection lifecycle states: `INITIALIZING`, `CONNECTED`, `DISCONNECTED`, `ERROR`, `EXPIRED`, `REVOKED`.
- **Model Context Protocol (MCP) Runtime (`@modelcontextprotocol/sdk`)**:
  - Supports **Streamable HTTP**, **Legacy HTTP SSE**, and **stdio** server transports.
  - Dynamic capability discovery: queries remote MCP servers for tools, resource URIs, and prompt templates, syncing them with PostgreSQL.
  - Server health probing (`POST /api/mcp/probe`) and direct tool execution (`POST /api/mcp/execute`).
- **AES-256-GCM Credential Vault (`CredentialVaultService`)**:
  - Encrypts sensitive secrets (API keys, OAuth tokens) using AES-256-GCM with distinct initialization vectors (IV) and authentication tags.
  - Supports key identifier tags (`keyId`) for seamless secret rotation.
- **OAuth 2.0 PKCE Engine**:
  - Manages authorization code grant with PKCE (Proof Key for Code Exchange) code verifiers and state verification (`OAuthTransaction`).
  - Automated token exchange, expiration tracking, and refresh token rotation.
- **Tool Execution Engine (`ExecutionEngineService`)**:
  - Validates tool input parameters against registered JSON Schemas.
  - Enforces per-tool user approval policies (`requiresApproval`) and rate limits.
  - Emits audit trails in PostgreSQL (`ConnectorAuditLog`) and detailed execution logs in MongoDB (`ConnectorExecutionLog`).
- **Agent Connector Bindings (`AgentConnectorBinding`)**:
  - Scopes which workspace connections and specific tools an AI agent is authorized to invoke.

### 4.5 Security, Authentication & Multi-Tenancy

- **Clerk Authentication (`@clerk/fastify`)**:
  - Intercepts requests, validates Clerk JWT session cookies/bearer headers, and populates `req.auth`.
  - Automatically isolates workspace data using Clerk `orgId` (falling back to `userId`).
- **SSRF Protection**:
  - Centralized `ssrf-guard` blocks unauthorized outbound network traffic from web crawlers, MCP clients, and webhook fetchers.
- **CORS Configuration**:
  - Strict origin validation supporting production frontends (`ai-matrix-dun.vercel.app`, `ai-matrix-k6qw.vercel.app`) and local development ports.

### 4.6 Brand & Metadata Enrichment

- **Brandfetch Integration (`BrandfetchService`)**:
  - Server-side caching and retrieval of corporate brand logos, color schemes, and domain metadata via the Brandfetch API (`/api/brands/:domain`).

### 4.7 API Documentation & Observability

- **OpenAPI 3.0 Documentation**:
  - Fully typed Swagger documentation served at `/documentation` (with redirect from `/docs`).
- **Health & Readiness Endpoints**:
  - `/api/health`: Immediate liveness check (uptime, environment, status).
  - `/api/ready`: Readiness probe verifying PostgreSQL query execution and Qdrant collection connectivity.
- **Structured Logging**:
  - High-performance Pino logger with standard request/response logging middleware.

---

## 5. Data Models

### 5.1 PostgreSQL (Prisma) — Crawler Domain

```
Crawler ──1:N──▶ CrawlRun ──1:N──▶ CrawlRunPage
   │
   └──1:N──▶ CrawledPage ──1:N──▶ CrawledChunk
```

- **`Crawler`**: Configuration entity (sitemap URL, base URL, allowed hosts, include/exclude patterns, crawl settings, enabled status).
- **`CrawlRun`**: An individual execution of a crawler tracking status (`PENDING`, `RUNNING`, `COMPLETED`, `PARTIALLY_COMPLETED`, `FAILED`, `CANCELLED`, `INTERRUPTED`), page counters, chunk counters, timing, and storage bytes.
- **`CrawledPage`**: Authoritative page record with canonical URL, content hash (SHA-256), title, HTTP status, and chunk count.
- **`CrawledChunk`**: Mapping between text chunk indices and Qdrant point UUIDs with token counts.
- **`CrawlRunPage`**: Per-page audit log within a specific run (fetch duration, HTTP status code, errors).

### 5.2 PostgreSQL (Prisma) — Connector Platform Domain

```
ConnectorDefinition ──1:N──▶ ConnectorConnection
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
ConnectorCredential         ConnectorTool (1:N)            ConnectorResource (1:N)
                                    ▼                               ▼
                            ConnectorPrompt (1:N)          AgentConnectorBinding (1:N)
                                    ▼                               ▼
                            OAuthTransaction (1:N)         ConnectorPermission (1:N)
```

- **`ConnectorDefinition`**: Catalog of available connectors (`key`, `name`, `type`, `supportedAuth`, `iconUrl`).
- **`ConnectorConnection`**: Active workspace instance of a connector (`workspaceId`, `userId`, `status`, `authType`, `baseUrl`, `mcpTransport`, `config`).
- **`ConnectorCredential`**: Encrypted secrets vault record (`encryptedData`, `iv`, `authTag`, `keyId`, `expiresAt`, `scopes`).
- **`ConnectorTool`**: Registered tool metadata (`name`, `displayName`, `inputSchema`, `outputSchema`, `isEnabled`, `requiresApproval`, `rateLimitPerMin`).
- **`ConnectorResource`**: MCP resource metadata (`uri`, `name`, `mimeType`, `isIndexed`).
- **`ConnectorPrompt`**: MCP prompt template metadata (`name`, `description`, `arguments`).
- **`ConnectorPermission`**: Workspace access control for tool execution and management.
- **`AgentConnectorBinding`**: Mappings linking AI agents to authorized connection tools.
- **`OAuthTransaction`**: Active OAuth 2.0 PKCE state records (`state`, `codeVerifier`, `redirectUri`, `scopes`, `expiresAt`).
- **`ConnectorAuditLog`**: System audit log recording connection changes, credential updates, and administrative actions.

### 5.3 MongoDB (Mongoose) — Chat & Execution Domain

- **`ChatThread`**:
  - `chatId`: Unique thread identifier.
  - `workspaceId`: Workspace isolation tag.
  - `userId`: Owner user identifier.
  - `title`: Auto-generated conversation title.
  - `messages`: Array of messages containing:
    - `role`: `user` | `assistant` | `system`
    - `content`: Message markdown text.
    - `toolCalls`: Input arguments and outputs from invoked tools.
    - `citations`: Deduplicated citations (URL, title, snippet, score).
  - `createdAt`, `updatedAt`: Timestamps.
- **`ConnectorExecutionLog`**:
  - Detailed operational trace of individual tool executions (connection ID, tool name, execution duration, payload parameters, error messages, and response statuses).

### 5.4 Qdrant — Vector Domain

- **Collection**: `website_content`
- **Vector Dimension**: 768 (Float32)
- **Distance Metric**: Cosine
- **Payload Schema**:
  ```json
  {
    "crawlerId": "UUID",
    "pageId": "UUID",
    "url": "https://example.com/docs/intro",
    "title": "Introduction to Example",
    "content": "Text chunk content...",
    "chunkIndex": 0,
    "contentHash": "sha256-hash",
    "crawledAt": "2026-11-24T18:00:00.000Z"
  }
  ```

---

## 6. API Route Reference

| Method | Endpoint | Description |
|---|---|---|
| **System & Health** | | |
| `GET` | `/api` | Service welcome message and documentation link |
| `GET` | `/documentation` | Interactive OpenAPI / Swagger UI |
| `GET` | `/api/health` | Liveness probe (uptime, status, timestamp) |
| `GET` | `/api/ready` | Readiness check (validates PostgreSQL and Qdrant connectivity) |
| **Crawler Management** | | |
| `POST` | `/api/crawlers` | Create a crawler configuration |
| `GET` | `/api/crawlers` | List all crawler configurations |
| `GET` | `/api/crawlers/:id` | Get crawler configuration and summary metrics |
| `PATCH` | `/api/crawlers/:id` | Update crawler configuration |
| `DELETE` | `/api/crawlers/:id` | Delete crawler and purge Qdrant vectors |
| `POST` | `/api/crawlers/:id/crawl` | Trigger an incremental crawl run |
| `POST` | `/api/crawlers/:id/crawl/full` | Trigger a full re-crawl (forces re-embedding) |
| `POST` | `/api/crawlers/:id/cancel` | Cancel an active crawl run |
| `GET` | `/api/crawlers/:crawlerId/metrics` | Retrieve storage and crawl metrics |
| **Crawl Run Monitoring** | | |
| `GET` | `/api/crawl-runs` | List crawl runs with pagination (`?page=1&limit=20`) |
| `GET` | `/api/crawl-runs/:runId` | Get crawl run status and storage counters |
| `GET` | `/api/crawl-runs/:runId/progress` | Real-time progress polling endpoint |
| `GET` | `/api/crawl-runs/:runId/pages` | Paginated page-level crawl logs |
| **Semantic Search** | | |
| `GET` | `/api/search` | Execute natural language vector search (`?q=...&threshold=0.5`) |
| **Conversational RAG Chat** | | |
| `POST` | `/api/chat` | Send prompt to AI agent (starts or continues thread) |
| `GET` | `/api/chat` | List conversation threads |
| `GET` | `/api/chat/:chatId` | Get full conversation thread and citations |
| `DELETE` | `/api/chat/:chatId` | Delete conversation thread |
| **Connector Catalog & Connections** | | |
| `GET` | `/api/connectors` | List available connector definitions |
| `GET` | `/api/connectors/:id` | Get connector definition schema and metadata |
| `GET` | `/api/connections` | List workspace connections |
| `POST` | `/api/connections` | Create a new connection |
| `GET` | `/api/connections/:id` | Get connection details and discovered tools |
| `PATCH` | `/api/connections/:id` | Update connection configuration |
| `DELETE` | `/api/connections/:id` | Delete connection and purge credentials |
| `POST` | `/api/connections/:id/test` | Test remote service connectivity |
| `POST` | `/api/connections/:id/discover` | Trigger tool/resource discovery |
| `POST` | `/api/connections/:id/execute` | Execute a tool provided by this connection |
| **Model Context Protocol (MCP)** | | |
| `POST` | `/api/mcp/probe` | Probe an MCP server endpoint for capabilities |
| `POST` | `/api/mcp/discover` | Discover tools and prompts from an MCP URL |
| `POST` | `/api/mcp/execute` | Invoke an MCP tool with schema validation |
| **OAuth 2.0 Flow** | | |
| `GET` | `/api/connections/:id/auth/start` | Start OAuth 2.0 PKCE flow |
| `GET` | `/api/oauth/callback` | OAuth 2.0 authorization code callback |
| **Agent Bindings & Brands** | | |
| `GET` | `/api/agents/:agentId/connectors` | List connectors bound to an agent |
| `POST` | `/api/agents/:agentId/connectors` | Bind a connector to an agent |
| `DELETE` | `/api/agents/:agentId/connectors/:connectionId` | Remove a connector binding |
| `GET` | `/api/brands/:domain` | Query brand information via Brandfetch |

---

## 7. Technology Stack Summary

| Component | Technology | Version | Purpose |
|---|---|---|---|
| **Runtime** | Node.js | 22 LTS | High-performance async JavaScript runtime |
| **Language** | TypeScript | 5.4.x | Static typing across domain models and controllers |
| **Web Framework** | Fastify | 5.12.x | High-throughput HTTP API gateway |
| **Relational ORM** | Prisma | 6.4.x | PostgreSQL schema migrations and query builder |
| **Document Store** | Mongoose / MongoDB | 9.12.x | MongoDB object modeling for chat and execution logs |
| **Vector Database** | Qdrant | Latest | Vector indexing and cosine similarity search |
| **Embeddings** | `@langchain/google-genai` | 2.3.x | Google `text-embedding-004` (768 dimensions) |
| **LLM Framework** | LangChain Core | 1.4.x | Agent runtime and tool abstraction |
| **LLM Providers** | Google GenAI, Groq, OpenAI, Anthropic | Latest | Multi-model agent reasoning with auto-selection |
| **MCP Integration** | `@modelcontextprotocol/sdk` | 1.32.x | Model Context Protocol client implementation |
| **Authentication** | `@clerk/fastify` | 3.1.x | Clerk session verification and tenancy injection |
| **HTML Parser** | Cheerio | 1.2.x | Fast, headless HTML DOM parsing and cleaning |
| **XML Parser** | fast-xml-parser | 5.12.x | High-speed recursive XML sitemap parser |
| **Validation** | Zod | 4.6.x | Runtime schema validation for requests and environment |
| **Documentation** | `@fastify/swagger` & UI | 9.9.x / 6.1.x | OpenAPI 3.0 specification generator and UI |
| **Testing** | Vitest | 4.1.x | Fast unit and integration testing harness |

---

## 8. Environment Configuration Schema

Configuration is validated at startup via `src/config/env.ts`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Environment mode (`development`, `production`, `test`) |
| `PORT` | No | `4000` | HTTP port |
| `LOG_LEVEL` | No | `info` | Pino logging level (`debug`, `info`, `warn`, `error`) |
| `CORS_ORIGIN` | No | `""` | Comma-separated list of allowed origins |
| `CLERK_PUBLISHABLE_KEY` | No | `""` | Clerk frontend publishable key |
| `CLERK_SECRET_KEY` | No | `""` | Clerk backend API key |
| `ENCRYPTION_MASTER_KEY` | No | `""` | 32-byte hex master key for AES-256-GCM Credential Vault |
| `DATABASE_URL` | Yes | — | PostgreSQL connection URL |
| `MONGODB_URL` | No | `mongodb://localhost:27017/chat` | MongoDB connection URL |
| `QDRANT_URL` | No | `http://localhost:6333` | Qdrant service URL |
| `QDRANT_API_KEY` | No | `""` | Optional Qdrant API key |
| `QDRANT_COLLECTION` | No | `website_content` | Vector collection name |
| `QDRANT_VECTOR_SIZE` | No | `768` | Vector dimension size |
| `QDRANT_DISTANCE` | No | `Cosine` | Vector distance metric (`Cosine`, `Euclid`, `Dot`) |
| `EMBEDDING_PROVIDER` | No | `google` | Embeddings provider (`google`) |
| `EMBEDDING_MODEL` | No | `text-embedding-004` | Google embedding model name |
| `GOOGLE_API_KEY` | Conditional | — | Required for embedding generation |
| `AGENT_PROVIDER` | No | `auto` | Agent provider (`google`, `groq`, `openai`, `anthropic`, `auto`) |
| `AGENT_MODEL` | No | `gemini-2.5-flash-lite` | Chat LLM model identifier |
| `GEMINI_API_KEY` | No | `""` | Gemini API key |
| `GROQ_API_KEY` | No | `""` | Groq API key |
| `OPENAI_API_KEY` | No | `""` | OpenAI API key |
| `ANTHROPIC_API_KEY` | No | `""` | Anthropic Claude API key |
| `CRAWLER_MAX_CONCURRENCY`| No | `3` | Max concurrent worker fetches per crawl |
| `CRAWLER_REQUEST_TIMEOUT_MS`| No | `15000` | HTTP fetch timeout in milliseconds |
| `CRAWLER_MAX_PAGES_PER_RUN` | No | `1000` | Max pages per crawl run |
| `CRAWLER_MAX_RESPONSE_BYTES`| No | `5242880` | Max response body size (5 MB) |
| `CRAWLER_MAX_REDIRECTS` | No | `5` | Maximum redirects allowed |
| `CRAWLER_DEFAULT_DELAY_MS` | No | `500` | Courtesy delay between successive requests |
| `CHUNK_SIZE` | No | `700` | Tokens per chunk |
| `CHUNK_OVERLAP` | No | `100` | Overlap tokens between chunks |
| `QDRANT_STORAGE_BUDGET_BYTES` | No | `4294967296` | 4 GiB storage limit |
| `QDRANT_STORAGE_STOP_THRESHOLD_PERCENT` | No | `85` | Ingestion halt threshold (85% of budget) |
| `BRANDFETCH_API_KEY` | No | `""` | Optional Brandfetch API key for logo enrichment |
| `OAUTH_REDIRECT_BASE_URL` | No | `http://localhost:3000/api/oauth/callback` | OAuth redirect endpoint |
| `FRONTEND_REDIRECT_BASE_URL` | No | `http://localhost:5173/connector` | Frontend landing URL after OAuth completion |

---

## 9. Project Directory Structure

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
├── README.md                     # Technical README & quickstart guide
└── PRD.md                        # This document
```

---

## 10. Roadmap & Future Enhancements

| Priority | Feature | Description |
|---|---|---|
| 🔴 High | **Server-Sent Events (SSE) Chat Streaming** | Enable token-by-token streaming responses for `/api/chat` using standard SSE streams. |
| 🔴 High | **Distributed Background Crawling** | Transition crawl execution from in-process concurrency to Redis/BullMQ workers for horizontal scaling. |
| 🟡 Medium | **Webhook Notifications** | Dispatch webhook events on crawl completion, crawl failure, or connector auth token expiry. |
| 🟡 Medium | **Scheduled / Automated Re-Crawling** | Add cron-based scheduling to automatically re-crawl active websites and keep vector embeddings fresh. |
| 🟡 Medium | **Multi-Modal Document Ingestion** | Extend the ingestion pipeline beyond HTML to support PDFs, Office documents, and markdown files. |
| 🟢 Low | **Fine-Grained Connector RBAC** | Support custom organization roles in Clerk with granular tool execution permissions. |
| 🟢 Low | **Vector Re-Ranking** | Incorporate a cross-encoder re-ranking stage (e.g. Cohere / BGE-reranker) to elevate search precision. |

---

## 11. License

MIT
