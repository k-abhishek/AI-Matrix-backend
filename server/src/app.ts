import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { clerkPlugin } from "@clerk/fastify";
import env from "./config/env";
import { requestLogger } from "./lib/logger";
import { errorHandler } from "./lib/errors";
import apiRoutes from "./routes";

export const buildApp = async (
  opts: FastifyServerOptions = {},
): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false, // Using our lightweight console logger
    ...opts,
  });

  // Global error handler (must be registered before encapsulated plugins/routes)
  app.setErrorHandler(errorHandler);

  // Body parsers
  await app.register(formbody);

  // CORS
  const configuredOrigins = env.CORS_ORIGIN.split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  const allowedOrigins = new Set([
    ...configuredOrigins,
    "https://ai-matrix-dun.vercel.app",
    "https://ai-matrix-k6qw.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
  ]);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) {
        return cb(null, true);
      }
      const normalizedOrigin = origin.replace(/\/+$/, "");
      if (
        allowedOrigins.has("*") ||
        allowedOrigins.has(normalizedOrigin) ||
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin)
      ) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    preflightContinue: false,
    strictPreflight: false,
  });

  // Clerk Authentication Plugin
  if (env.CLERK_PUBLISHABLE_KEY || env.CLERK_SECRET_KEY) {
    await app.register(clerkPlugin, {
      publishableKey: env.CLERK_PUBLISHABLE_KEY || undefined,
      secretKey: env.CLERK_SECRET_KEY || undefined,
    });
  } else {
    // Clerk keys not yet set in environment
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "\x1b[33m[AUTH WARNING] Clerk publishable/secret keys are missing from environment. Authentication will reject requests.\x1b[0m",
      );
    }
  }

  // Swagger (OpenAPI) specification
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Website Crawler & Vector Indexer API",
        description:
          "Fastify backend for crawling sitemaps, extracting content via Cheerio, generating embeddings, and storing in Qdrant & PostgreSQL",
        version: "1.0.0",
      },
      servers: [
        {
          url: `http://localhost:${env.PORT}`,
          description: "Local server",
        },
      ],
      tags: [
        {
          name: "General",
          description: "General API information and discovery",
        },
        {
          name: "Crawlers",
          description: "Crawler management and manual triggering",
        },
        {
          name: "Crawl Runs",
          description: "Crawl execution monitoring and progress",
        },
        {
          name: "Search",
          description:
            "Semantic vector similarity search across crawled content",
        },
        {
          name: "Chat",
          description: "AI conversational agent with crawled content",
        },
        {
          name: "Connectors",
          description: "Unified Connector Platform catalog and definitions",
        },
        {
          name: "Connections",
          description: "Workspace connector connections and lifecycle management",
        },
        {
          name: "MCP",
          description: "Model Context Protocol (MCP) diagnostics, probing, and discovery",
        },
        { name: "Health", description: "Liveness and readiness checks" },
      ],
    },
  });

  // Swagger UI
  await app.register(swaggerUi, {
    routePrefix: "/documentation",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
    staticCSP: true,
  });

  // Convenient redirect from /docs to /documentation
  app.get("/docs", { schema: { hide: true } }, async (_req, reply) => {
    return reply.redirect("/documentation");
  });

  // Request logger
  await app.register(requestLogger);

  // API routes
  await app.register(apiRoutes, { prefix: "/api" });

  return app;
};

export default buildApp;
