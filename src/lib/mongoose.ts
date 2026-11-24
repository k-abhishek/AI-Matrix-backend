import mongoose from "mongoose";
import env from "../config/env";
import logger from "./logger";
import dns from "node:dns";

// Override local DNS resolver for Node.js in development if needed
if (process.env.NODE_ENV !== "production") {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

export const connectMongoDB = async (): Promise<void> => {
  // Avoid re-connecting if already connected or connecting in serverless warm invocations
  if (mongoose.connection.readyState >= 1) {
    return;
  }

  try {
    mongoose.connection.on("connected", () => {
      logger.info("MongoDB connection is successful");
    });

    mongoose.connection.on("error", (err) => {
      logger.error("MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected");
    });

    await mongoose.connect(env.MONGODB_URL);
  } catch (error) {
    logger.error("MongoDB connection failed:", error);
    throw error;
  }
};

export const disconnectMongoDB = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    logger.info("MongoDB disconnected cleanly");
  } catch (error) {
    logger.error("Error disconnecting MongoDB:", error);
  }
};

export default mongoose;
