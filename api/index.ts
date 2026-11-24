import { FastifyInstance } from "fastify";
import buildApp from "../src/app";
import notFoundHandler from "../src/middleware/notFound";
import { connectMongoDB } from "../src/lib/mongoose";

let app: FastifyInstance | null = null;
let initPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (app) return app;

  if (!initPromise) {
    initPromise = (async () => {
      try {
        await connectMongoDB();
      } catch (err) {
        console.error("MongoDB connection warning on cold start:", err);
      }

      const instance = await buildApp();
      instance.setNotFoundHandler(notFoundHandler);
      await instance.ready();
      app = instance;
      return instance;
    })();
  }

  return initPromise;
}

export default async function handler(req: any, res: any) {
  const fastifyApp = await getApp();
  fastifyApp.server.emit("request", req, res);
}
