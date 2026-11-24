import { tool } from '@langchain/core/tools';
import prisma from '../../lib/prisma';
import jsonSchemaToZod from '../../utils/schema-converter';
import mcpExecutionService from '../mcp/mcp-execution.service';
import customRestConnectorAdapter from '../adapters/rest/custom-rest.adapter';
import gmailSendFallbackAdapter from '../adapters/native/fallback/gmail-send-fallback';
import nativeAdapterRegistry from '../adapters/native/native-adapter.registry';
import logger from '../../lib/logger';

export class AgentToolResolverService {
  /**
   * Dynamically loads all permitted connector tools for an agent in a workspace
   * and synthesizes them into LangChain-compatible StructuredTool instances.
   */
  async resolveToolsForAgent(agentId: string, workspaceId: string) {
    const bindings = await prisma.agentConnectorBinding.findMany({
      where: {
        agentId,
        workspaceId,
        isEnabled: true,
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

    const dynamicTools: any[] = [];

    for (const binding of bindings) {
      const { connection } = binding;
      if (connection.status !== 'CONNECTED') continue;

      const prefix = connection.connectorDefinition.key.replace(/[^a-zA-Z0-9_]/g, '_');

      for (const t of connection.tools) {
        // Filter by allowedToolNames if specified
        if (binding.allowedToolNames.length > 0 && !binding.allowedToolNames.includes(t.name)) {
          continue;
        }

        // Namespace the tool name to avoid collisions
        const uniqueToolName = `${prefix}_${t.name}`.slice(0, 64);
        const schema = jsonSchemaToZod(t.inputSchema as Record<string, any>);

        const synthesizedTool = tool(
          async (input: Record<string, any>) => {
            try {
              // Special-case native fallback for Gmail email sending
              if (t.name === 'send_email' && connection.connectorDefinition.key === 'gmail') {
                const sendResult = await gmailSendFallbackAdapter.sendEmail(
                  connection.id,
                  input as any
                );
                return JSON.stringify(sendResult.data || { success: sendResult.success });
              }

              // Native adapter routing for NATIVE connector type
              if (connection.connectorDefinition.type === 'NATIVE') {
                const adapter = nativeAdapterRegistry.getAdapter(connection.connectorDefinition.key);
                if (adapter) {
                  const nativeResult = await adapter.executeTool(t.name, input, {
                    connectionId: connection.id,
                    workspaceId,
                    baseUrl: connection.baseUrl,
                    config: connection.config as any,
                  });
                  if (!nativeResult.success) {
                    return `Tool error: ${nativeResult.error}`;
                  }
                  return typeof nativeResult.data === 'string'
                    ? nativeResult.data
                    : JSON.stringify(nativeResult.data);
                }
              }

              // Custom REST connector routing
              if (
                connection.connectorDefinition.type === 'CUSTOM_REST' ||
                connection.connectorDefinition.key === 'custom-rest'
              ) {
                const restResult = await customRestConnectorAdapter.executeTool(
                  t.name,
                  input,
                  {
                    connectionId: connection.id,
                    workspaceId,
                    baseUrl: connection.baseUrl,
                    config: connection.config as any,
                  }
                );
                if (!restResult.success) {
                  return `Tool error: ${restResult.error}`;
                }
                return typeof restResult.data === 'string'
                  ? restResult.data
                  : JSON.stringify(restResult.data);
              }

              const result = await mcpExecutionService.executeTool({
                connectionId: connection.id,
                toolName: t.name,
                parameters: input,
              });

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
            description: t.description || `Execute ${t.displayName || t.name} on ${connection.name}`,
            schema: schema as any,
          }
        );

        dynamicTools.push(synthesizedTool);
      }

      // If this is a connected Gmail connection and doesn't already have send_email in tools,
      // provide the Native Fallback Tool automatically!
      if (
        connection.connectorDefinition.key === 'gmail' &&
        !connection.tools.some((t) => t.name === 'send_email') &&
        (binding.allowedToolNames.length === 0 || binding.allowedToolNames.includes('send_email'))
      ) {
        const gmailSendTool = tool(
          async (input: any) => {
            const res = await gmailSendFallbackAdapter.sendEmail(connection.id, input);
            if (!res.success) return `Error sending email: ${res.error}`;
            return JSON.stringify(res.data);
          },
          {
            name: `${prefix}_send_email`,
            description: 'Send an email to one or more recipients via Gmail (Native Fallback Tool)',
            schema: jsonSchemaToZod({
              type: 'object',
              required: ['to', 'subject', 'body'],
              properties: {
                to: { type: 'string', description: 'Recipient email address' },
                subject: { type: 'string', description: 'Email subject line' },
                body: { type: 'string', description: 'Email plain text body' },
                cc: { type: 'string', description: 'Optional CC email address' },
              },
            }) as any,
          }
        );
        dynamicTools.push(gmailSendTool);
      }
    }

    return dynamicTools;
  }
}

export const agentToolResolverService = new AgentToolResolverService();
export default agentToolResolverService;
