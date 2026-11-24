import "dotenv/config";
import buildApp from "./app";
import env from "./config/env";
import logger from "./lib/logger";
import notFoundHandler from "./middleware/notFound";
import crawlService from "./services/crawl.service";
import prisma from "./lib/prisma";
import { connectMongoDB, disconnectMongoDB } from "./lib/mongoose";

(async () => {
  // Connect to MongoDB
  await connectMongoDB();

  const app = await buildApp();

  // Startup recovery: mark previously RUNNING crawl runs as INTERRUPTED
  await crawlService.recoverDanglingRuns();

  // 404 handler for unmatched routes
  app.setNotFoundHandler(notFoundHandler);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    try {
      await app.close();
      await prisma.$disconnect();
      await disconnectMongoDB();
      logger.info("Server closed. Process terminated cleanly.");
      process.exit(0);
    } catch (err: any) {
      logger.error("Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(
    `Matrix Backend running on port ${env.PORT} in ${env.NODE_ENV} mode`,
  );
  logger.info(`API Base URL: http://localhost:${env.PORT}/api`);
  logger.info(`Swagger UI: http://localhost:${env.PORT}/documentation`);
})().catch((err) => {
  logger.error("Failed to start server:", err);
  process.exit(1);
});
