import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getWorkspaceContext } from '../../middleware/auth';
import agentRuntimeService from './agent-runtime.service';
import { AgentRun, AgentExecutionEvent } from '../../models/AgentRun';
import ConnectorExecutionLog from '../../models/ConnectorExecutionLog';
import mongoBaseStore from '../memory/mongo-base-store.service';
import { NotFoundError } from '../../lib/errors';

const executeSchema = z.object({
  prompt: z.string().min(1),
  chatId: z.string().optional(),
  versionId: z.string().uuid().optional(),
});

const approvalResolveSchema = z.object({
  approved: z.boolean(),
});

export class RuntimeController {
  async execute(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const body = executeSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const result = await agentRuntimeService.execute(ctx, {
      agentId: req.params.agentId,
      prompt: body.prompt,
      chatId: body.chatId,
      versionId: body.versionId,
    });
    return reply.status(200).send({ success: true, data: result });
  }

  async listConversationRuns(
    req: FastifyRequest<{ Params: { agentId: string }; Querystring: { chatId?: string } }>,
    reply: FastifyReply
  ) {
    const ctx = getWorkspaceContext(req);
    const runs = await AgentRun.find({
      workspaceId: ctx.workspaceId,
      agentId: req.params.agentId,
      ...(req.query?.chatId ? { chatId: req.query.chatId } : {}),
    })
      .sort({ startedAt: -1 })
      .limit(50)
      .lean();
    return reply.status(200).send({ success: true, data: runs });
  }

  async inspectRun(req: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const run = await AgentRun.findOne({ runId: req.params.runId, workspaceId: ctx.workspaceId }).lean();
    if (!run) {
      throw new NotFoundError(`Run '${req.params.runId}' not found`);
    }
    const [events, toolLogs] = await Promise.all([
      AgentExecutionEvent.find({ runId: req.params.runId, workspaceId: ctx.workspaceId })
        .sort({ seq: 1 })
        .lean(),
      ConnectorExecutionLog.find({ runId: req.params.runId, workspaceId: ctx.workspaceId })
        .sort({ timestamp: 1 })
        .lean(),
    ]);
    return reply.status(200).send({ success: true, data: { run, events, toolLogs } });
  }

  async resolveApproval(
    req: FastifyRequest<{ Params: { approvalId: string } }>,
    reply: FastifyReply
  ) {
    const body = approvalResolveSchema.parse(req.body);
    const ctx = getWorkspaceContext(req);
    const result = await agentRuntimeService.resolveApproval(ctx, req.params.approvalId, body.approved);
    return reply.status(200).send({ success: true, data: result.approval });
  }

  async listMemories(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const items = await mongoBaseStore.search([ctx.workspaceId, ctx.userId, req.params.agentId], {
      limit: 50,
    });
    return reply.status(200).send({ success: true, data: items });
  }

  async clearMemories(req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) {
    const ctx = getWorkspaceContext(req);
    const deletedCount = await mongoBaseStore.clearAgentUserMemory(
      ctx.workspaceId,
      ctx.userId,
      req.params.agentId
    );
    return reply.status(200).send({ success: true, data: { deletedCount } });
  }
}

export const runtimeController = new RuntimeController();
export default runtimeController;
