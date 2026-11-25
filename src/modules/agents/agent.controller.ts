import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getWorkspaceContext } from '../../middleware/auth';
import agentService from './agent.service';

const createAgentSchema = z.object({
  name: z.string().min(1, 'Agent name is required').max(120),
  description: z.string().max(1000).optional(),
  visibility: z.enum(['PERSONAL', 'WORKSPACE']).optional(),
  systemInstructions: z.string().min(1, 'System instructions are required'),
  provider: z.enum(['google', 'groq', 'openai', 'anthropic', 'ollama']).nullable().optional(),
  model: z.string().min(1).nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  maxIterations: z.number().int().min(1).max(100).optional(),
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
  memoryConfig: z.record(z.string(), z.any()).nullable().optional(),
  executionPolicy: z.record(z.string(), z.any()).nullable().optional(),
});

const updateAgentSchema = createAgentSchema.partial();

const rollbackSchema = z.object({
  targetVersionId: z.string().uuid('targetVersionId must be a valid UUID'),
});

const revokeSchema = z.object({
  reason: z.string().max(500).optional(),
});

export class AgentController {
  async create(req: FastifyRequest, reply: FastifyReply) {
    const body = createAgentSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const result = await agentService.createAgent(ctx, body);
    return reply.status(201).send({ success: true, data: result });
  }

  async list(
    req: FastifyRequest<{ Querystring: { status?: 'ACTIVE' | 'ARCHIVED'; visibility?: 'PERSONAL' | 'WORKSPACE' } }>,
    reply: FastifyReply
  ) {
    const ctx = getWorkspaceContext(req);
    const agents = await agentService.listAgents(ctx, req.query || {});
    return reply.status(200).send({ success: true, data: agents });
  }

  async getById(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const agent = await agentService.getAgentById(ctx, req.params.agentId);
    return reply.status(200).send({ success: true, data: agent });
  }

  async update(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const body = updateAgentSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const result = await agentService.updateAgent(ctx, req.params.agentId, body);
    return reply.status(200).send({ success: true, data: result });
  }

  async archive(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const agent = await agentService.archiveAgent(ctx, req.params.agentId);
    return reply.status(200).send({ success: true, data: agent });
  }

  async duplicate(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const result = await agentService.duplicateAgent(ctx, req.params.agentId);
    return reply.status(201).send({ success: true, data: result });
  }

  async validate(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const result = await agentService.validateAgent(ctx, req.params.agentId);
    return reply.status(200).send({ success: true, data: result });
  }

  async publish(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const result = await agentService.publishAgent(ctx, req.params.agentId);
    return reply.status(200).send({ success: true, data: result });
  }

  async rollback(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const body = rollbackSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const result = await agentService.rollbackAgent(ctx, req.params.agentId, body.targetVersionId);
    return reply.status(200).send({ success: true, data: result });
  }

  async revokeVersion(
    req: FastifyRequest<{ Params: { agentId: string; versionId: string } }>,
    reply: FastifyReply
  ) {
    const body = revokeSchema.parse(req.body || {});
    const ctx = getWorkspaceContext(req);
    const result = await agentService.revokeVersion(
      ctx,
      req.params.agentId,
      req.params.versionId,
      body.reason
    );
    return reply.status(200).send({ success: true, data: result });
  }

  async listVersions(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const versions = await agentService.listVersions(ctx, req.params.agentId);
    return reply.status(200).send({ success: true, data: versions });
  }
}

export const agentController = new AgentController();
export default agentController;
