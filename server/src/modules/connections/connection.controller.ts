import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import connectionService from './connection.service';
import { AuthenticatedRequest } from '../../middleware/auth';

export const createConnectionSchema = z.object({
  connectorDefinitionId: z.string().uuid().optional(),
  connectorKey: z.string().min(1).optional(),
  name: z.string().min(1, 'Connection name is required'),
  authType: z.enum([
    'NONE',
    'API_KEY',
    'BEARER_TOKEN',
    'BASIC_AUTH',
    'OAUTH2_AUTHORIZATION_CODE',
    'OAUTH2_CLIENT_CREDENTIALS',
    'CUSTOM_HEADERS',
  ]),
  baseUrl: z.string().url().optional(),
  mcpTransport: z.enum(['STREAMABLE_HTTP', 'STDIO_ISOLATED']).optional(),
  config: z.record(z.string(), z.any()).optional(),
  credentials: z.record(z.string(), z.any()).optional(),
});

export const updateConnectionSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  mcpTransport: z.enum(['STREAMABLE_HTTP', 'STDIO_ISOLATED']).optional(),
  config: z.record(z.string(), z.any()).optional(),
  status: z.enum(['INITIALIZING', 'CONNECTED', 'DISCONNECTED', 'ERROR', 'EXPIRED', 'REVOKED']).optional(),
  credentials: z.record(z.string(), z.any()).optional(),
});

export class ConnectionController {
  private getWorkspaceId(req: FastifyRequest): string {
    const authReq = req as AuthenticatedRequest;
    // Prefer Clerk organizationId, fallback to userId
    const orgId = authReq.auth?.orgId;
    const userId = authReq.userId || 'default_user';
    return orgId || userId;
  }

  async create(req: FastifyRequest, reply: FastifyReply) {
    const parsed = createConnectionSchema.parse(req.body);
    const workspaceId = this.getWorkspaceId(req);
    const userId = (req as AuthenticatedRequest).userId || 'default_user';

    const connection = await connectionService.createConnection(workspaceId, userId, parsed);
    return reply.status(201).send({
      success: true,
      data: connection,
    });
  }

  async list(req: FastifyRequest, reply: FastifyReply) {
    const workspaceId = this.getWorkspaceId(req);
    const connections = await connectionService.listConnections(workspaceId);
    return reply.status(200).send({
      success: true,
      data: connections,
    });
  }

  async getById(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const workspaceId = this.getWorkspaceId(req);
    const connection = await connectionService.getConnectionById(id, workspaceId);
    return reply.status(200).send({
      success: true,
      data: connection,
    });
  }

  async update(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const parsed = updateConnectionSchema.parse(req.body);
    const workspaceId = this.getWorkspaceId(req);

    const updated = await connectionService.updateConnection(id, workspaceId, parsed);
    return reply.status(200).send({
      success: true,
      data: updated,
    });
  }

  async delete(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const workspaceId = this.getWorkspaceId(req);

    await connectionService.deleteConnection(id, workspaceId);
    return reply.status(200).send({
      success: true,
      message: 'Connection deleted successfully',
      id,
    });
  }

  async discover(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const workspaceId = this.getWorkspaceId(req);
    const result = await connectionService.discoverConnection(id, workspaceId);
    return reply.status(200).send({
      success: true,
      data: result,
    });
  }

  async getTools(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const workspaceId = this.getWorkspaceId(req);
    const tools = await connectionService.getConnectionTools(id, workspaceId);
    return reply.status(200).send({
      success: true,
      data: tools,
    });
  }

  async getResources(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const workspaceId = this.getWorkspaceId(req);
    const resources = await connectionService.getConnectionResources(id, workspaceId);
    return reply.status(200).send({
      success: true,
      data: resources,
    });
  }

  async getPrompts(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const workspaceId = this.getWorkspaceId(req);
    const prompts = await connectionService.getConnectionPrompts(id, workspaceId);
    return reply.status(200).send({
      success: true,
      data: prompts,
    });
  }

  async test(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const workspaceId = this.getWorkspaceId(req);
    const result = await connectionService.testConnection(id, workspaceId);
    return reply.status(200).send({
      success: true,
      data: result,
    });
  }

  async execute(
    req: FastifyRequest<{ Params: { id: string }; Body: { toolName: string; parameters?: Record<string, any> } }>,
    reply: FastifyReply
  ) {
    const { id } = req.params;
    const workspaceId = this.getWorkspaceId(req);
    const { toolName, parameters = {} } = req.body || {};

    if (!toolName) {
      return reply.status(400).send({
        success: false,
        message: 'toolName is required',
      });
    }

    const result = await connectionService.executeTool(id, workspaceId, toolName, parameters);
    return reply.status(200).send({
      success: result.success,
      data: result,
    });
  }
}

export const connectionController = new ConnectionController();
export default connectionController;
