# My Full-Stack App

A modern full-stack application built with React, TypeScript, Tailwind CSS, and Fastify — running on a **single port** in both development and production.

## Architecture

- **Single-port architecture**: Fastify + Vite both run on port **5000**
- **Frontend**: React + TypeScript + Tailwind CSS + React Router
- **Backend**: Fastify + TypeScript
- **Development**: Vite runs as Fastify middleware (no separate Vite port, no proxy needed)
- **Production**: Fastify serves the compiled Vite static build

```
Browser → http://localhost:5000
              │
              ▼
        Fastify (port 5000)
         /api/*  → Fastify API routes
         /*      → Vite middleware (dev) or static files (prod)
```

## Project Structure

```
my-fullstack-app/
├── client/                      # React frontend (Vite)
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── vite.config.ts
├── server/                      # Fastify backend
│   ├── src/
│   │   ├── config/
│   │   │   └── index.ts         # App configuration
│   │   ├── controllers/
│   │   │   └── healthController.ts
│   │   ├── middleware/
│   │   │   ├── errorHandler.ts
│   │   │   ├── notFound.ts
│   │   │   └── requestLogger.ts
│   │   ├── routes/
│   │   │   ├── healthRoutes.ts
│   │   │   └── index.ts
│   │   ├── services/
│   │   │   └── healthService.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── utils/
│   │   │   ├── apiResponse.ts
│   │   │   └── logger.ts
│   │   ├── app.ts               # Fastify app setup
│   │   └── server.ts            # Entry point (Vite middleware / static)
│   ├── dist/                    # Compiled server output (generated)
│   ├── package.json
│   └── tsconfig.json
├── .env                         # Local environment variables (not committed)
├── .env.example                 # Environment variable template
├── .gitignore
├── package.json                 # Root scripts
├── tsconfig.json                # Root TypeScript config
└── README.md
```

## Getting Started

### Prerequisites

- **Node.js** 18+
- **npm** 9+

### Installation

```bash
cd my-fullstack-app
npm run install:all
```

This installs dependencies for the root, client, and server in one command.

### Development

```bash
npm run dev
```

Starts a **single development server** on port 5000:

| URL | Description |
|-----|-------------|
| `http://localhost:5000` | React app (served by Vite middleware via Fastify) |
| `http://localhost:5000/api/health` | Fastify health check API |

> Hot Module Replacement (HMR) is fully functional — Vite handles it through the middleware connection.

### Build

```bash
npm run build
```

Builds both the client (Vite) and server (TypeScript → JavaScript):

- Client output: `client/dist/`
- Server output: `server/dist/`

### Production

```bash
npm start
```

Runs the compiled server (`server/dist/server.js`), which serves the static client build from `client/dist/`.

## API Endpoints & Documentation

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/documentation` (or `/docs`) | Swagger / OpenAPI Interactive Documentation UI |
| `GET` | `/documentation/json` | OpenAPI Specification (JSON) |
| `GET` | `/api/health` | Health check — returns server status, uptime, and environment |
| `GET` | `/api/` | Welcome message |
| `GET` | `/api/chat/openai` | OpenRouter / OpenAI chat endpoint |

### Example Response: `/api/health`

```json
{
  "success": true,
  "message": "Fastify API is running",
  "data": {
    "status": "healthy",
    "uptime": 42.3,
    "timestamp": "2024-01-01T00:00:00.000Z",
    "environment": "development"
  }
}
```

## How It Works

### Single-Port Design

Traditional full-stack setups run a frontend dev server (e.g., Vite on port 5173) alongside a backend (e.g., Fastify on port 3000), requiring CORS configuration and a proxy. This project eliminates that complexity:

1. **Fastify is the only HTTP server** — it always starts on port 5000.
2. **API routes (`/api/*`)** are registered first on Fastify and handled exclusively by the backend.
3. **In development**, `@fastify/middie` attaches Vite's dev middleware to Fastify. All non-API requests are forwarded to Vite, which serves the React app with full HMR support.
4. **In production**, Fastify uses `@fastify/static` to serve the compiled files from `client/dist/`, and falls back to `index.html` for client-side routing.

### Request Flow

```
                 ┌──────────────────────────────────┐
Request          │          Fastify (port 5000)     │
──────────────►  │                                  │
                 │  /api/*  ──► API route handlers  │
                 │                                  │
                 │  /*  (dev)  ──► Vite middleware  │
                 │  /*  (prod) ──► static files     │
                 └──────────────────────────────────┘
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Port the Fastify server listens on |
| `NODE_ENV` | `development` | Environment mode (`development` \| `production`) |
| `CORS_ORIGIN` | `http://localhost:5000` | Allowed CORS origin (informational in single-port mode) |

Copy `.env.example` to `.env` and adjust values as needed:

```bash
cp .env.example .env
```

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server (Fastify + Vite middleware) on port 5000 |
| `npm run build` | Build client and server for production |
| `npm run build:client` | Build only the React frontend |
| `npm run build:server` | Compile only the Fastify backend |
| `npm start` | Run the compiled production server |
| `npm run install:all` | Install all dependencies (root + client + server) |

## License

MIT
