import { tool } from '@langchain/core/tools';
import prisma from '../../lib/prisma';
import jsonSchemaToZod from '../../utils/schema-converter';
import executionEngineService from '../execution/execution-engine.service';
import logger from '../../lib/logger';

export type AgentStatusPhase =
  | 'Working'
  | 'Searching'
  | 'Solving'
  | 'Connecting'
  | 'Composing';

export interface ApprovalRequiredEvent {
  approvalToken: string;
  connectionId: string;
  connectionName: string;
  connectorKey: string;
  toolName: string;
  uniqueToolName: string;
  taskName: string;
  parameters: Record<string, any>;
  message: string;
}

export interface ToolDisplayMeta {
  uniqueToolName: string;
  taskName: string;
  statusPhase: AgentStatusPhase;
  connectionId?: string;
  connectionName?: string;
  connectorKey?: string;
}

export interface ActiveConnectionSummary {
  connectionId: string;
  name: string;
  connectorKey: string;
  connectorName: string;
  toolCount: number;
}

export interface ResolveToolsOptions {
  agentId: string;
  workspaceId: string;
  userId?: string;
  connectionIds?: string[];
  onApprovalRequired?: (payload: ApprovalRequiredEvent) => void;
}

export interface ResolvedAgentToolsResult {
  tools: any[];
  toolMetaMap: Map<string, ToolDisplayMeta>;
  activeConnections: ActiveConnectionSummary[];
}

function humanizeToolName(rawName: string): string {
  return rawName
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function inferStatusPhase(toolName: string, isExternalConnection = true): AgentStatusPhase {
  if (
    toolName === 'search_knowledge_base' ||
    /^(search|find|query|list|get|fetch|read|lookup|browse|inspect)/i.test(toolName)
  ) {
    return 'Searching';
  }
  if (/^(create|send|post|draft|write|reply|compose|update|edit|append)/i.test(toolName)) {
    return 'Composing';
  }
  if (/^(solve|analyze|calculate|compute|evaluate|summarize)/i.test(toolName)) {
    return 'Solving';
  }
  return isExternalConnection ? 'Connecting' : 'Working';
}

export class AgentToolResolverService {
  /**
   * Backward-compatible helper returning only the synthesized LangChain tools.
   */
  async resolveToolsForAgent(agentId: string, workspaceId: string) {
    const { tools } = await this.resolveToolsWithMeta({ agentId, workspaceId });
    return tools;
  }

  /**
   * Dynamically loads all permitted connector tools for an agent/workspace
   * (falling back to all CONNECTED workspace connections when no explicit
   * agent bindings exist), routes execution through ExecutionEngineService,
   * and returns LangChain tools alongside UI display metadata (taskName & statusPhase).
   */
  async resolveToolsWithMeta(options: ResolveToolsOptions): Promise<ResolvedAgentToolsResult> {
    const { agentId, workspaceId, userId, connectionIds, onApprovalRequired } = options;
    const connectionFilter =
      connectionIds && connectionIds.length > 0 ? { in: connectionIds } : undefined;

    const explicitBindings = await prisma.agentConnectorBinding.findMany({
      where: {
        agentId,
        workspaceId,
        isEnabled: true,
        ...(connectionFilter ? { connectionId: connectionFilter } : {}),
      },
      include: {
        connection: {
          include: {
            connectorDefinition: true,
            tools: {
              where: { isEnabled: true },
            },
          },
        },
      },
    });

    type ResolvedBinding = {
      allowedToolNames: string[];
      connection: (typeof explicitBindings)[number]['connection'];
    };

    let resolvedBindings: ResolvedBinding[] = explicitBindings.map((b) => ({
      allowedToolNames: b.allowedToolNames,
      connection: b.connection,
    }));

    // Fallback: if no explicit bindings exist for this agent, automatically use
    // all CONNECTED connections in the user's workspace (optionally filtered by connectionIds).
    if (resolvedBindings.length === 0) {
      const workspaceConnections = await prisma.connectorConnection.findMany({
        where: {
          workspaceId,
          status: 'CONNECTED',
          ...(connectionFilter ? { id: connectionFilter } : {}),
        },
        include: {
          connectorDefinition: true,
          tools: {
            where: { isEnabled: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      resolvedBindings = workspaceConnections.map((conn) => ({
        allowedToolNames: [],
        connection: conn,
      }));
    }

    // Count connections per connector key to avoid tool-name collisions when multiple
    // connections of the same type exist in a workspace.
    const keyCounts = new Map<string, number>();
    for (const binding of resolvedBindings) {
      if (binding.connection.status !== 'CONNECTED') continue;
      const key = binding.connection.connectorDefinition.key;
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }

    const dynamicTools: any[] = [];
    const toolMetaMap = new Map<string, ToolDisplayMeta>();
    const activeConnections: ActiveConnectionSummary[] = [];

    for (const binding of resolvedBindings) {
      const { connection } = binding;
      if (connection.status !== 'CONNECTED') continue;

      const defKey = connection.connectorDefinition.key;
      const basePrefix = defKey.replace(/[^a-zA-Z0-9_]/g, '_');
      const hasMultipleSameType = (keyCounts.get(defKey) || 0) > 1;
      const prefix = hasMultipleSameType
        ? `${basePrefix}_${connection.id.slice(0, 6)}`
        : basePrefix;

      let connectionToolCount = 0;

      const buildSynthesizedTool = (
        toolName: string,
        displayName: string | null | undefined,
        description: string,
        schemaObj: Record<string, any>
      ) => {
        const uniqueToolName = `${prefix}_${toolName}`.slice(0, 64);
        const taskName = `${connection.name}: ${displayName || humanizeToolName(toolName)}`;
        const statusPhase = inferStatusPhase(toolName, true);

        toolMetaMap.set(uniqueToolName, {
          uniqueToolName,
          taskName,
          statusPhase,
          connectionId: connection.id,
          connectionName: connection.name,
          connectorKey: defKey,
        });

        const schema = jsonSchemaToZod(schemaObj);
        connectionToolCount += 1;

        return tool(
          async (input: Record<string, any>) => {
            try {
              const result = await executionEngineService.executeTool({
                connectionId: connection.id,
                toolName,
                parameters: input,
                workspaceId,
                userId,
                agentId,
              });

              if (result.requiresApproval && result.approvalToken) {
                const approvalMessage =
                  result.error ||
                  `Action '${taskName}' requires human approval before execution.`;

                onApprovalRequired?.({
                  approvalToken: result.approvalToken,
                  connectionId: connection.id,
                  connectionName: connection.name,
                  connectorKey: defKey,
                  toolName,
                  uniqueToolName,
                  taskName,
                  parameters: input,
                  message: approvalMessage,
                });

                return JSON.stringify({
                  status: 'APPROVAL_REQUIRED',
                  approvalToken: result.approvalToken,
                  taskName,
                  message:
                    'This action requires human approval. An approval prompt has been sent to the user. Tell the user to confirm or reject the action in the UI.',
                });
              }

              if (!result.success) {
                return `Tool error: ${result.error}`;
              }

              return typeof result.data === 'string'
                ? result.data
                : JSON.stringify(result.data);
            } catch (err: any) {
              logger.error(`Error in dynamic tool execution '${uniqueToolName}':`, err);
              return `Execution error: ${err.message}`;
            }
          },
          {
            name: uniqueToolName,
            description,
            schema: schema as any,
          }
        );
      };

      for (const t of connection.tools) {
        if (binding.allowedToolNames.length > 0 && !binding.allowedToolNames.includes(t.name)) {
          continue;
        }

        const synthesizedTool = buildSynthesizedTool(
          t.name,
          t.displayName,
          t.description || `Execute ${t.displayName || t.name} on ${connection.name}`,
          t.inputSchema as Record<string, any>
        );
        dynamicTools.push(synthesizedTool);
      }

      // Native Fallback Tool for Gmail if send_email is not already in discovered tools
      if (
        defKey === 'gmail' &&
        !connection.tools.some((t) => t.name === 'send_email') &&
        (binding.allowedToolNames.length === 0 || binding.allowedToolNames.includes('send_email'))
      ) {
        const gmailSendTool = buildSynthesizedTool(
          'send_email',
          'Send Email',
          'Send an email to one or more recipients via Gmail (Native Fallback Tool)',
          {
            type: 'object',
            required: ['to', 'subject', 'body'],
            properties: {
              to: { type: 'string', description: 'Recipient email address' },
              subject: { type: 'string', description: 'Email subject line' },
              body: { type: 'string', description: 'Email plain text body' },
              cc: { type: 'string', description: 'Optional CC email address' },
            },
          }
        );
        dynamicTools.push(gmailSendTool);
      }

      if (connectionToolCount > 0) {
        activeConnections.push({
          connectionId: connection.id,
          name: connection.name,
          connectorKey: defKey,
          connectorName: connection.connectorDefinition.name,
          toolCount: connectionToolCount,
        });
      }
    }

    return { tools: dynamicTools, toolMetaMap, activeConnections };
  }
}

export const agentToolResolverService = new AgentToolResolverService();
export default agentToolResolverService;
