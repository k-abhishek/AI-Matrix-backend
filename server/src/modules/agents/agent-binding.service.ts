import prisma from '../../lib/prisma';
import { NotFoundError, BadRequestError } from '../../lib/errors';

export interface CreateBindingDTO {
  connectionId: string;
  allowedToolNames?: string[];
  isEnabled?: boolean;
}

export interface UpdateBindingDTO {
  allowedToolNames?: string[];
  isEnabled?: boolean;
}

export class AgentBindingService {
  /**
   * Lists all connector connections bound to a specific agent in a workspace.
   */
  async listBindings(agentId: string, workspaceId: string) {
    return prisma.agentConnectorBinding.findMany({
      where: { agentId, workspaceId },
      include: {
        connection: {
          include: {
            connectorDefinition: true,
            _count: { select: { tools: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Binds a connector connection to an agent, optionally restricting to a subset of tool names.
   */
  async createBinding(agentId: string, workspaceId: string, input: CreateBindingDTO) {
    if (!input.connectionId) {
      throw new BadRequestError('connectionId is required');
    }

    const connection = await prisma.connectorConnection.findFirst({
      where: { id: input.connectionId, workspaceId },
    });

    if (!connection) {
      throw new NotFoundError(`Connection '${input.connectionId}' not found in workspace`);
    }

    return prisma.agentConnectorBinding.upsert({
      where: {
        agentId_connectionId: {
          agentId,
          connectionId: input.connectionId,
        },
      },
      update: {
        allowedToolNames: input.allowedToolNames ?? undefined,
        isEnabled: input.isEnabled ?? undefined,
        updatedAt: new Date(),
      },
      create: {
        agentId,
        workspaceId,
        connectionId: input.connectionId,
        allowedToolNames: input.allowedToolNames || [],
        isEnabled: input.isEnabled ?? true,
      },
      include: {
        connection: {
          include: { connectorDefinition: true },
        },
      },
    });
  }

  /**
   * Updates an existing binding's allowed tool names or enabled status.
   */
  async updateBinding(
    agentId: string,
    connectionId: string,
    workspaceId: string,
    input: UpdateBindingDTO
  ) {
    const existing = await prisma.agentConnectorBinding.findFirst({
      where: { agentId, connectionId, workspaceId },
    });

    if (!existing) {
      throw new NotFoundError(`Binding between agent '${agentId}' and connection '${connectionId}' not found`);
    }

    return prisma.agentConnectorBinding.update({
      where: { id: existing.id },
      data: {
        allowedToolNames: input.allowedToolNames ?? undefined,
        isEnabled: input.isEnabled ?? undefined,
        updatedAt: new Date(),
      },
      include: {
        connection: {
          include: { connectorDefinition: true },
        },
      },
    });
  }

  /**
   * Removes a connection binding from an agent.
   */
  async deleteBinding(agentId: string, connectionId: string, workspaceId: string) {
    const existing = await prisma.agentConnectorBinding.findFirst({
      where: { agentId, connectionId, workspaceId },
    });

    if (!existing) {
      throw new NotFoundError(`Binding between agent '${agentId}' and connection '${connectionId}' not found`);
    }

    await prisma.agentConnectorBinding.delete({
      where: { id: existing.id },
    });

    return true;
  }
}

export const agentBindingService = new AgentBindingService();
export default agentBindingService;
