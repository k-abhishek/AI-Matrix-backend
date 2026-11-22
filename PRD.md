# AI-Matrix — Product Requirements Document (PRD)

> **Version:** 1.0  
> **Author:** Abhishek Kumar

---

## 1. Project Overview

**AI-Matrix** is a full-stack AI-powered knowledge management platform that enables users to crawl websites, ingest documentation into a vector database, and interact with the indexed knowledge through **semantic search** and an **AI conversational agent (RAG)**. It combines web crawling, document chunking, vector embeddings, and LLM-powered chat into a single, cohesive application.

### Vision

Build an intelligent, self-hosted knowledge assistant that can ingest any website's documentation, understand it semantically, and answer user queries grounded in real source material — bridging the gap between static documentation and interactive AI-driven information retrieval.

### Key Value Proposition

- **Crawl Once, Query Forever** — Automatically ingest entire websites via sitemap parsing, store content as vector embeddings, and make it instantly searchable.
- **RAG-Powered Chat** — Go beyond keyword search with an AI agent that retrieves relevant knowledge chunks and synthesizes grounded, citation-backed answers.

---

## 2. Architecture

```
Browser → http://localhost:5000
              │
              ▼
        Fastify (port 5000)
         /api/*  → Fastify API routes
              │
     ┌────────┼─────────┐
     ▼        ▼         ▼
  MongoDB  PostgreSQL  Qdrant
  (Chat)   (Crawlers)  (Vectors)
```

| Layer         | Technology                                                              |
| ------------- | ----------------------------------------------------------------------- |
| **Frontend**  | React 18, TypeScript, Tailwind CSS, Zustand, TanStack Query, Framer Motion |
| **Backend**   | Fastify 5, TypeScript, Prisma ORM, Mongoose                            |
| **AI / LLM**  | LangChain, ChatGroq (Groq API), Google Generative AI Embeddings        |
| **Vector DB** | Qdrant (via `@langchain/qdrant`)                                       |
| **Databases** | PostgreSQL (crawlers, pages, chunks), MongoDB (chat threads)            |
| **Dev Tools** | Vite, ts-node-dev, Vitest, Swagger/OpenAPI                             |

---

## 3. Goals

### 3.1 Primary Goals

| # | Goal                                      | Description                                                                                                       |
|---|-------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| 1 | **Knowledge Ingestion Pipeline**          | Provide a robust, configurable web crawler that parses sitemaps, fetches pages, extracts content, chunks text, generates embeddings, and stores vectors in Qdrant. |
| 2 | **Semantic Search**                       | Enable users to perform natural-language similarity search over the entire crawled knowledge base, returning scored and paginated results. |
| 3 | **RAG Conversational Agent**              | Deliver a chat interface powered by an LLM agent that autonomously retrieves relevant knowledge base chunks to ground its responses with citations. |
| 4 | **Crawler Management Dashboard**          | Allow users to create, configure, monitor, and manage multiple crawlers — each targeting different websites — with full CRUD and live run metrics. |
| 5 | **Single-Port Full-Stack DX**             | Maintain a single-port architecture where Fastify serves both the API and the React frontend, with HMR in dev and static serving in production. |

### 3.2 Secondary Goals

| # | Goal                                      | Description                                                                                                       |
|---|-------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| 6 | **Multi-Thread Chat History**             | Persist conversation threads in MongoDB with full message history, tool call metadata, and citation tracking.      |
| 7 | **Storage Budget Enforcement**            | Enforce configurable storage budgets on the Qdrant vector database to prevent runaway ingestion costs.             |
| 8 | **Incremental / Delta Crawls**            | Support content-hash-based deduplication so re-crawls skip unchanged pages, minimizing redundant embedding computation. |
| 9 | **Production Readiness**                  | Include health checks, readiness probes (PostgreSQL + Qdrant), structured logging (Pino), and Swagger API docs.   |
| 10 | **Dark/Light Theming & Polished UI**      | Provide a modern, responsive UI with theme support, skeleton loading states, and smooth animations.                |

---

## 4. Features

### 4.1 Web Crawler & Knowledge Ingestion

| Feature                       | Details                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sitemap-Based Discovery**   | Parses XML sitemaps to discover all eligible URLs for a given website. Supports `allowedHosts`, `includePatterns`, and `excludePatterns` filtering.      |
| **Concurrent Page Fetching**  | Fetches pages with configurable concurrency (up to 10 workers), request timeouts, delays, and max response byte limits.                                 |
| **Content Extraction**        | Uses Cheerio-based HTML parsing to extract clean text content, page title, description, and canonical URL from raw HTML.                                 |
| **Text Chunking**             | Splits extracted content into overlapping chunks with configurable `CHUNK_SIZE` and `CHUNK_OVERLAP` for optimal embedding granularity.                   |
| **Embedding Generation**      | Generates vector embeddings via Google Generative AI (`gemini-embedding-001`) with validated 768-dimension output. Includes mock provider for testing.     |
| **Qdrant Vector Upsert**      | Upserts chunk vectors into a Qdrant collection with rich metadata payloads (crawlerId, pageId, URL, title, content hash, timestamps).                   |
| **Content Deduplication**     | Hashes extracted content and skips re-indexing for unchanged pages during incremental crawls.                                                            |
| **Obsolete Chunk Cleanup**    | Automatically deletes orphaned Qdrant points when page content changes and produces fewer chunks than previously indexed.                                |
| **Crawl Run Lifecycle**       | Full status lifecycle: `PENDING → RUNNING → COMPLETED / PARTIALLY_COMPLETED / FAILED / CANCELLED / INTERRUPTED`.                                       |
| **Cooperative Cancellation**  | Users can cancel a running crawl via API; uses `AbortController` for cooperative signal propagation to all workers.                                      |
| **Dangling Run Recovery**     | On server startup, automatically detects and marks any runs left in `RUNNING` state as `INTERRUPTED` from prior crashes.                                 |
| **Storage Budget Enforcement**| Configurable byte-level budget on Qdrant storage. Crawls halt gracefully with `PARTIALLY_COMPLETED` when the budget is exceeded.                         |
| **Live Progress Metrics**     | Real-time per-run counters: discovered, queued, processing, fetched, cleaned, skipped, failed pages, plus chunk and storage metrics.                     |

### 4.2 Semantic Vector Search

| Feature                        | Details                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Natural Language Search**    | Users submit free-text queries; the system generates a query embedding and performs cosine similarity search. |
| **Score Threshold Filtering**  | Results below a configurable score threshold (default 0.5) are excluded to maintain relevance quality.       |
| **Paginated Results**          | Supports `page` and `limit` parameters for navigating large result sets.                                     |
| **Rich Result Metadata**       | Each result returns: similarity score, matched content chunk, source URL, page title, chunk index, and IDs.  |
| **Dual-Mode Prompt Input**     | The search page prompt input supports toggling between `search` mode and `chat` mode.                        |

### 4.3 AI Chat Agent (RAG)

| Feature                        | Details                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **LangChain Agent Framework**  | Built on LangChain's `createAgent` with ChatGroq (Groq API) as the LLM backbone.                            |
| **Knowledge Base Tool**        | The agent has access to a `search_knowledge_base` tool that queries Qdrant for relevant indexed documentation. |
| **Conversation History**       | Full multi-turn conversation support with message history re-hydrated from MongoDB on each turn.             |
| **Tool Call Transparency**     | Tool invocations and their raw outputs are captured and stored alongside assistant messages.                  |
| **Citation Extraction**        | Source URLs, page titles, scores, and content snippets are extracted from tool outputs and deduplicated.      |
| **Thread Management**          | Create, list, load, and delete conversation threads. Thread titles auto-generated from the first prompt.     |
| **Markdown Rendering**         | Assistant responses render full Markdown including code blocks (syntax-highlighted), math (KaTeX), and Mermaid diagrams via Streamdown. |

### 4.4 Frontend & UI

| Feature                        | Details                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Dashboard Home Page**        | Personalized greeting, central prompt input, priority task cards, calendar widget, and event cards.           |
| **Chat Interface**             | Full-screen chat view with auto-scroll, loading indicators (bouncing dots), error states, and skeleton loaders. |
| **Knowledge Base Manager**     | Grid of crawler cards showing name, base URL, status badge, page/chunk/storage metrics, and last crawl date. |
| **Crawler Detail Page**        | Detailed view per crawler with configuration, metrics grid, and crawl run history.                           |
| **Search Results Page**        | Staggered animation of scored search result cards with retry and empty-state handling.                       |
| **Org Chart Page**             | Organization hierarchy visualization using `d3-org-chart`.                                                   |
| **Sidebar Navigation**         | Collapsible sidebar with nav links, chat thread list section, and user profile area.                         |
| **Shared Prompt Input**        | Animated `layoutId`-based prompt input that smoothly transitions between Home, Chat, and Search pages.       |
| **Theme System**               | Dark/light mode toggle via React Context, with CSS variables and Tailwind integration.                       |
| **Responsive Design**          | Mobile-first layout with breakpoint-aware grid, mobile nav, and adaptive spacing.                            |
| **Lazy Loading**               | Route-level code splitting with `React.lazy()` for About, Org, Knowledge Base, Crawler Detail, Chat, and Search pages. |

#### 4.4.1 Frontend Route Map

| Route                          | Page Component        | Description                                                                                           |
| ------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `/`                            | `HomePage`            | Landing dashboard with personalized greeting, shared prompt input, and dashboard widget cards.         |
| `/chat`                        | `ChatPage`            | New conversation view — empty state with prompt input to start a fresh AI chat session.               |
| `/chat/:chatId`                | `ChatPage`            | Existing conversation — loads and displays the full message thread for the given chat ID.             |
| `/search`                      | `SearchPage`          | Semantic search interface — accepts queries via URL param `?q=` and displays vector search results.   |
| `/knowledge-base`              | `KnowledgeBasePage`   | Crawler management dashboard — lists all registered crawlers with metrics and a "Create Crawler" modal. |
| `/knowledge-base/:crawlerId`   | `CrawlerDetailPage`   | Detailed view for a single crawler — config, live metrics, data breakdown, and crawl run history.     |
| `/org`                         | `OrgPage`             | Interactive organization chart — full-screen D3-based tree visualization with zoom controls.          |
| `/org/:id`                     | `OrgPage`             | Org chart focused on a specific employee — highlights the path from root to the selected person.      |
| `/about`                       | `AboutPage`           | Project information page — architecture overview and tech stack cards with descriptions.               |
| `/not-found`                   | `NotFoundPage`        | 404 error page displayed for unrecognized routes.                                                     |

> All routes are wrapped inside `MainLayout`, which provides the sidebar, header, and content canvas.
> Pages other than `HomePage` are **lazy-loaded** with `React.lazy()` and wrapped in `<Suspense>` with a loading spinner fallback.

#### 4.4.2 Page Details — What Each Screen Shows

**🏠 Home Page (`/`)**

- **Personalized Hero Greeting** — "Good Evening, Abhishek — How can I help you today?" with gradient text accent
- **Shared Prompt Input** — Central text area with Chat/Search mode toggle; submitting navigates to `/chat` or `/search`
- **Notification Bar** — Slim bar above the input for alerts and action items
- **Dashboard Widget Grid** (2-column layout):
  - **Priority Card** — Task list showing top 5 priority items with status
  - **Calendar Card** — Compact calendar widget showing the current month
  - **Event Card** — Upcoming events/schedule summary
- **Background Overlay** — Decorative themed background image (only on home page)

**💬 Chat Page (`/chat`, `/chat/:chatId`)**

- **Message Thread** — Scrollable list of user and assistant messages with role labels
  - User messages: right-aligned, primary-colored bubbles
  - Assistant messages: left-aligned, full-width with **Markdown rendering** (code blocks, math via KaTeX, Mermaid diagrams via Streamdown)
- **Loading Indicator** — Animated bouncing dots while waiting for AI response
- **Skeleton Loader** — Placeholder UI while fetching an existing conversation thread
- **Error Banner** — Destructive-styled alert for failed message sends
- **Empty State** — Prompt text: "Start a new conversation by sending a prompt below"
- **Sticky Prompt Input** — Bottom-pinned input bar with Chat/Search mode toggle, attach file button (placeholder), agent selector dropdown, voice input button, and send button
- **Auto-Scroll** — Smooth scroll-to-bottom on new messages via `requestAnimationFrame`
- **Initial Prompt Handling** — Accepts `initialPrompt` from navigation state (from Home or Search page)

**🔍 Search Page (`/search`)**

- **Sticky Search Bar** — Top-pinned shared prompt input with Chat/Search mode toggle
  - In **Search mode**: navigates with `?q=` query parameter
  - In **Chat mode**: redirects to `/chat` with the query as initial prompt
- **Search Results** — Staggered-animated list of `SearchResultCard` components, each showing:
  - Relevance score (sorted highest first)
  - Matched content chunk
  - Source metadata (URL, title, chunk index)
- **Loading Skeletons** — 4 animated placeholder cards during search execution
- **Empty State** — "No matches found" with contextual message when query returns zero results
- **Initial State** — "Semantic Search" hero with Sparkles icon and description when no query is active
- **Error State** — Destructive alert banner with Retry button

**📚 Knowledge Base Page (`/knowledge-base`)**

- **Page Header** — "Knowledge Base" title with BookOpen icon and description about managing crawlers for RAG
- **Search & Actions Bar** — Filter input to search crawlers by name/URL + "Add Crawler" button
- **Crawler Grid** — Responsive 1–3 column card grid, each `CrawlerCardItem` showing:
  - Base URL with Globe icon
  - Status badge: `RUNNING` / `ACTIVE` / `IDLE`
  - Crawler name and sitemap URL
  - Metrics summary: Pages count, Chunks count, Storage usage (formatted bytes)
  - Last crawled timestamp
  - "View Details →" link
- **Empty State** — Dashed-border card with "No Crawlers Configured" message and "Add Your First Crawler" CTA
- **Guides & Reference Section** — 3 static article cards (Getting Started, Prompt Engineering, RAG Architecture) with category badges and "Read Guide" links
- **Create Crawler Modal** — Dialog form to configure a new crawler (name, sitemap URL, settings) — navigates to detail page on success

**🕷️ Crawler Detail Page (`/knowledge-base/:crawlerId`)**

- **Back Navigation** — "Back to Knowledge Base" breadcrumb link
- **Crawler Header** — Name, ID, creation date, enabled status badge, and action buttons:
  - "Start Crawl" / "Full Re-Crawl" trigger buttons
  - "Cancel Crawl" button (visible during active runs)
  - Action feedback message (success/error toast)
- **Metrics Grid** — Key performance counters (pages, chunks, storage, etc.) with auto-polling:
  - **3-second polling** when a crawl is actively running (live progress)
  - **10-second polling** when idle (background refresh)
- **Configuration Card** — Read-only display of sitemap URL, base URL, allowed hosts, and advanced settings
- **Data Breakdown Card** — Visual breakdown of page statuses (completed, failed, skipped, etc.)
- **Crawl Runs Section** — Paginated history table of all crawl executions with status, timing, and page counts. Includes manual refresh button
- **Skeleton Loader** — Full-page skeleton layout to prevent CLS during initial data fetch

**👥 Org Chart Page (`/org`, `/org/:id`)**

- **Full-Screen D3 Canvas** — Interactive `d3-org-chart` tree visualization rendered in a flex container
- **Employee Node Cards** — Each node shows:
  - Avatar image with fallback
  - Full name and position/title
  - Department badge
  - Numeric ID
- **Zoom Toolbar** — Floating control bar with:
  - Zoom In / Zoom Out buttons
  - Current zoom level display (clickable to reset to 75%)
  - "Fit" button to fit the entire chart to the viewport
  - "Show Whole Org" button (when a specific employee is highlighted)
- **Path Highlighting** — When navigating to `/org/:id`, highlights the path from root to the selected employee with primary-colored links
- **Pan & Zoom** — Full drag-to-pan and scroll-to-zoom with grab cursor feedback
- **Expand/Collapse** — Chevron buttons on nodes to toggle subtree visibility

**ℹ️ About Page (`/about`)**

- **Hero Banner** — Gradient section with project title "About AI Platform" and architectural overview tagline
- **Architecture Card** — Explains the single-port design with a visual request flow diagram:
  - `/api/*` → Fastify API routes
  - `/documentation` → Swagger UI
  - `/*` → Vite (dev) or static files (prod)
- **Tech Stack Grid** — 6 technology cards in responsive 1–3 column layout, each with:
  - Emoji icon, technology name, and category badge (Frontend, Backend, Language, Styling, Tooling, Routing)
  - Description of what each technology contributes
  - Technologies featured: React 18, TypeScript 5, Fastify 5, Tailwind CSS, Vite 5, React Router 6

#### 4.4.3 Layout & Shell Components

**📐 Main Layout (`MainLayout`)**

The root layout wrapper that every page renders inside:

- **Desktop Sidebar** (≥ md breakpoint) — Collapsible sidebar (260px expanded / 64px collapsed):
  - **Brand Header** — "Matrix Workspace" logo/text (expanded) or Grip icon (collapsed)
  - **Collapse Toggle** — PanelLeft icon button to toggle sidebar width
  - **Navigation Items** — Home, Knowledge Base, People, About — with active-state highlighting
  - **Chat Section** — Collapsible list of recent chat threads with:
    - "New Chat" button
    - "Search Conversations" modal trigger
    - Individual chat items with delete option
  - **User Profile** — Compact profile block at sidebar footer
- **Mobile Navigation** (< md breakpoint) — Slide-out sheet drawer with same nav items
- **Header Bar** — Sticky top bar (56px) with:
  - Mobile hamburger menu button
  - Sidebar expand button (when collapsed on desktop)
  - Notification bell icon (with active indicator dot)
  - Dark/Light theme toggle (Sun/Moon icons with rotation animation)
- **Content Canvas** — Scrollable `<main>` area with rounded corners, `<Suspense>` boundary, and `<LayoutGroup>` for shared layout animations

**🔤 Shared Prompt Input (`PromptInput`)**

A reusable, animated prompt component used across Home, Chat, and Search pages:

- **Auto-Resizing Textarea** — Grows with content up to 200px max height, then scrolls
- **Mode Toggle** — Animated pill switch between "Chat" and "Search" modes with spring-animated indicator
- **Action Buttons**:
  - Attach file (Plus icon — placeholder for future file upload)
  - Agent selector dropdown (Globe icon — placeholder for multi-agent selection)
  - Voice input button (Mic icon)
  - Send/Search button (ArrowUp or Search icon, depending on mode)
- **Keyboard Shortcut** — Enter to submit; Shift+Enter for newline
- **Shared `layoutId`** — `"shared-prompt-input"` enables smooth Framer Motion layout transitions when navigating between pages

### 4.5 Backend & API

| Feature                        | Details                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **RESTful API**                | Clean resource-oriented endpoints under `/api` prefix with consistent JSON response format.                  |
| **Swagger / OpenAPI Docs**     | Auto-generated interactive API documentation at `/documentation` with full schema definitions.               |
| **Health & Readiness Probes**  | `/api/health` for liveness; `/api/ready` checks PostgreSQL and Qdrant connectivity.                          |
| **Zod Config Validation**      | All environment variables validated at startup with Zod schemas, failing fast on misconfiguration.           |
| **Structured Logging**         | Pino-based logger with configurable log levels (`debug`, `info`, `warn`, `error`).                           |
| **Modular Architecture**       | Backend organized into modules (`chat`, `crawlers`, `crawl-runs`, `search`) each with controller → service → repository layers. |
| **Dual Database Strategy**     | PostgreSQL/Prisma for structured crawler data; MongoDB/Mongoose for flexible chat thread documents.           |

---

## 5. Data Model

### 5.1 PostgreSQL (Prisma) — Crawler Domain

```
Crawler  ──1:N──▶  CrawlRun  ──1:N──▶  CrawlRunPage
   │
   └──1:N──▶  CrawledPage  ──1:N──▶  CrawledChunk
```

| Model           | Purpose                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| `Crawler`       | Crawler configuration: name, sitemap URL, base URL, host/pattern filters, settings |
| `CrawlRun`      | A single execution of a crawler with status, counters, timing, and storage metrics |
| `CrawlRunPage`  | Per-page log within a run: URL, status, HTTP code, fetch duration, chunks, errors |
| `CrawledPage`   | Canonical crawled page with content hash, metadata, and chunk count            |
| `CrawledChunk`  | Maps a text chunk to its Qdrant point ID with index and token count            |

### 5.2 MongoDB (Mongoose) — Chat Domain

| Collection     | Purpose                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `ChatThread`   | A conversation thread with `chatId`, `title`, and an array of messages         |
| `ChatMessage`  | Individual message: `role` (user/assistant/system), `content`, tool calls, citations |

### 5.3 Qdrant — Vector Domain

| Collection                | Vector Size | Distance | Payload Fields                                                       |
| ------------------------- | ----------- | -------- | -------------------------------------------------------------------- |
| `website_crawler_vectors` | 768         | Cosine   | `crawlerId`, `pageId`, `url`, `title`, `content`, `chunkIndex`, `contentHash`, `crawledAt` |

---

## 6. API Endpoints

| Method   | Path                              | Description                                           |
| -------- | --------------------------------- | ----------------------------------------------------- |
| `GET`    | `/documentation`                  | Swagger / OpenAPI interactive docs                    |
| `GET`    | `/api/`                           | API welcome and version info                          |
| `GET`    | `/api/health`                     | Health check (server status, uptime, environment)     |
| `GET`    | `/api/ready`                      | Readiness probe (PostgreSQL + Qdrant connectivity)    |
| `CRUD`  | `/api/crawlers`                   | Crawler configuration management                     |
| `POST`   | `/api/crawlers/:id/crawl`         | Trigger a crawl run for a specific crawler            |
| `POST`   | `/api/crawlers/:id/cancel`        | Cancel a running crawl                                |
| `GET`    | `/api/crawl-runs`                 | List and inspect crawl run history and progress       |
| `POST`   | `/api/chat`                       | Send a message to the AI agent (RAG)                  |
| `GET`    | `/api/chat/:chatId`               | Retrieve a conversation thread                        |
| `GET`    | `/api/chat`                       | List conversation threads                             |
| `DELETE` | `/api/chat/:chatId`               | Delete a conversation thread                          |
| `GET`    | `/api/search`                     | Semantic vector search over indexed knowledge          |

---

## 7. Tech Stack Summary

| Category        | Technologies                                                                |
| --------------- | --------------------------------------------------------------------------- |
| **Language**     | TypeScript (end-to-end)                                                     |
| **Frontend**     | React 18, Vite, Tailwind CSS 3, Zustand, TanStack Query, React Router 6, Framer Motion, Lucide Icons, react-markdown, Streamdown, KaTeX, Mermaid |
| **Backend**      | Fastify 5, Prisma 6, Mongoose 9, Pino, Zod 4                               |
| **AI**           | LangChain, @langchain/groq, @langchain/google-genai, @langchain/qdrant, OpenAI SDK |
| **Databases**    | PostgreSQL, MongoDB, Qdrant                                                 |
| **Testing**      | Vitest                                                                      |
| **API Docs**     | @fastify/swagger, @fastify/swagger-ui                                       |
| **Build**        | Vite (client), tsc (server)                                                 |

---

## 8. Environment Configuration

| Variable                               | Default                           | Purpose                                    |
| -------------------------------------- | --------------------------------- | ------------------------------------------ |
| `PORT`                                 | `5000`                            | Server port                                |
| `NODE_ENV`                             | `development`                     | Environment mode                           |
| `DATABASE_URL`                         | —                                 | PostgreSQL connection string               |
| `MONGODB_URL`                          | `mongodb://localhost:27017/chat`  | MongoDB connection string                  |
| `QDRANT_URL`                           | `http://localhost:6333`           | Qdrant server URL                          |
| `QDRANT_COLLECTION`                    | `website_crawler_vectors`         | Qdrant collection name                     |
| `QDRANT_VECTOR_SIZE`                   | `768`                             | Embedding vector dimension                 |
| `GOOGLE_API_KEY`                       | —                                 | Google AI API key (for embeddings)         |
| `GROQ_API_KEY`                         | —                                 | Groq API key (for chat LLM)               |
| `AGENT_MODEL`                          | `openai/gpt-oss-20b`             | LLM model identifier                      |
| `EMBEDDING_MODEL`                      | `text-embedding-004`             | Embedding model name                       |
| `CHUNK_SIZE` / `CHUNK_OVERLAP`         | Configurable                      | Text chunking parameters                   |
| `CRAWLER_MAX_CONCURRENCY`              | Configurable                      | Max concurrent page fetch workers          |
| `CRAWLER_MAX_PAGES_PER_RUN`            | Configurable                      | Max pages per crawl run                    |
| `QDRANT_STORAGE_BUDGET_BYTES`          | Configurable                      | Vector storage budget cap                  |

---

## 9. Project Structure

```
AI-Matrix/
├── client/                          # React frontend (Vite)
│   ├── src/
│   │   ├── api/                     # API client modules (chat, search, knowledgeBase)
│   │   ├── components/              # UI components (chat, crawler, home, search, ui)
│   │   ├── context/                 # React contexts (ThemeContext)
│   │   ├── hooks/                   # Custom hooks (useHealth, useKnowledgeBase)
│   │   ├── layouts/                 # Layout components (MainLayout, Sidebar, Header)
│   │   ├── pages/                   # Route pages (Home, Chat, Search, KnowledgeBase, Org)
│   │   ├── routes/                  # React Router configuration
│   │   ├── store/                   # Zustand state stores (chatStore)
│   │   ├── types/                   # TypeScript type definitions
│   │   └── utils/                   # Utility functions (cn, helpers)
│   ├── index.html
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── server/                          # Fastify backend
│   ├── prisma/
│   │   └── schema.prisma            # PostgreSQL schema (Crawler, CrawlRun, Pages, Chunks)
│   ├── src/
│   │   ├── config/                  # Environment config (Zod-validated)
│   │   ├── lib/                     # Core libs (Prisma client, Mongoose, Logger, Errors)
│   │   ├── middleware/              # Fastify middleware (notFound)
│   │   ├── models/                  # Mongoose models (ChatThread)
│   │   ├── modules/                 # Feature modules (chat, crawlers, crawl-runs, search)
│   │   ├── routes/                  # Fastify route registrations
│   │   ├── services/               # Core services (crawl, embedding, qdrant, chunking, etc.)
│   │   ├── tools/                   # LangChain tools (vectorKnowledgeBaseTool)
│   │   ├── types/                   # Shared TypeScript types
│   │   └── utils/                   # Utilities (hashing, URL normalization, progress)
│   └── tests/                       # Unit and integration tests
│
├── README.md
├── PRD.md                           # This document
└── LICENSE                          # MIT License
```

---

## 10. Roadmap & Future Considerations

| Priority | Feature                                     | Description                                                                 |
| -------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| 🔴 High  | **Streaming Chat Responses**                | Implement SSE/WebSocket streaming for real-time token-by-token AI responses |
| 🔴 High  | **Authentication & Multi-User Support**     | Add user authentication (OAuth/JWT) and per-user data isolation             |
| 🟡 Mid   | **Scheduled / Automatic Re-Crawls**         | Cron-based automatic re-crawling to keep knowledge base fresh               |
| 🟡 Mid   | **File Upload & PDF Ingestion**             | Extend ingestion beyond websites to support uploaded PDFs, docs, and CSVs   |
| 🟡 Mid   | **Citation UI in Chat**                     | Display inline source citations and links within assistant chat messages    |
| 🟢 Low   | **Multi-LLM Provider Support**             | Allow switching between Groq, OpenAI, Anthropic, and local models           |
| 🟢 Low   | **Analytics Dashboard**                     | Visualize search query patterns, popular topics, and crawler performance     |
| 🟢 Low   | **Webhook Notifications**                   | Notify external services when crawl runs complete or fail                   |

---

## 11. License

MIT
