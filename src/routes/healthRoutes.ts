import { FastifyPluginAsync } from 'fastify';
import mongoose from 'mongoose';
import prisma from '../lib/prisma';
import qdrantService from '../services/qdrant.service';

/**
 * Fastify routes plugin for Health & Readiness monitoring.
 *
 * Base Prefix: /api/health (with alias at /api/ready)
 *
 * Responsibilities:
 * - Liveness probe: returns basic process uptime and status.
 * - Readiness probe: verifies live connectivity to both PostgreSQL and Qdrant.
 */
const healthRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/health
   * Liveness probe: confirms the Fastify web server process is alive and accepting connections.
   *
   * Response: 200 OK with { status: "ok", uptime, timestamp }
   */
  fastify.get(
    '/',
    {
      schema: {
        tags: ['Health'],
        summary: 'Liveness probe',
        description: 'Confirms the Fastify web server process is alive and accepting connections.',
        response: {
          200: {
            description: 'Server process is alive',
            type: 'object',
            required: ['status', 'uptime', 'timestamp'],
            properties: {
              status: { type: 'string', example: 'ok' },
              uptime: { type: 'number', example: 42.15 },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      return reply.status(200).send({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    }
  );

  /**
   * GET /api/health/ready (also aliased at /api/ready)
   * Readiness probe: checks if dependent persistence layers are reachable and healthy:
   * 1. PostgreSQL: executes a lightweight `SELECT 1` via Prisma.
   * 2. MongoDB: verifies connection readyState === 1 via Mongoose.
   * 3. Qdrant: queries collection status via QdrantClient.
   *
   * Response:
   * - 200 OK if PostgreSQL, MongoDB, and Qdrant are up ({ status: "ready" }).
   * - 503 Service Unavailable if any service is down ({ status: "not_ready", checks: { database, mongodb, qdrant } }).
   */
  fastify.get(
    '/ready',
    {
      schema: {
        tags: ['Health'],
        summary: 'Readiness probe',
        description: 'Verifies live connectivity to PostgreSQL, MongoDB, and Qdrant.',
        response: {
          200: {
            description: 'All backing services are connected and ready',
            type: 'object',
            required: ['status', 'checks', 'timestamp'],
            properties: {
              status: { type: 'string', example: 'ready' },
              checks: {
                type: 'object',
                required: ['database', 'mongodb', 'qdrant'],
                properties: {
                  database: { type: 'string', example: 'up' },
                  mongodb: { type: 'string', example: 'up' },
                  qdrant: { type: 'string', example: 'up' },
                },
              },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
          503: {
            description: 'One or more backing services are unreachable',
            type: 'object',
            required: ['status', 'checks', 'timestamp'],
            properties: {
              status: { type: 'string', example: 'not_ready' },
              checks: {
                type: 'object',
                required: ['database', 'mongodb', 'qdrant'],
                properties: {
                  database: { type: 'string', example: 'down' },
                  mongodb: { type: 'string', example: 'down' },
                  qdrant: { type: 'string', example: 'down' },
                },
              },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (_req, reply) => {
    const checks: Record<string, string> = {
      database: 'down',
      mongodb: 'down',
      qdrant: 'down',
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = 'up';
    } catch {
      checks.database = 'down';
    }

    try {
      checks.mongodb = mongoose.connection.readyState === 1 ? 'up' : 'down';
    } catch {
      checks.mongodb = 'down';
    }

    try {
      const qdrantOk = await qdrantService.checkHealth();
      checks.qdrant = qdrantOk ? 'up' : 'down';
    } catch {
      checks.qdrant = 'down';
    }

    const isReady = checks.database === 'up' && checks.mongodb === 'up' && checks.qdrant === 'up';
    const statusCode = isReady ? 200 : 503;

    return reply.status(statusCode).send({
      status: isReady ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    });
  });
};

export default healthRoutes;
