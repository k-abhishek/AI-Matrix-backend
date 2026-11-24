import {
  BaseConnectorAdapter,
  ConnectorConnectionContext,
  ConnectionHealthResult,
  DiscoveredTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../base.adapter';
import mcpClientManager from '../../mcp/mcp-client.manager';
import mcpDiscoveryService from '../../mcp/mcp-discovery.service';
import mcpExecutionService from '../../mcp/mcp-execution.service';

export class McpConnectorAdapter implements BaseConnectorAdapter {
  readonly connectorType = 'MCP' as const;

  /**
   * Tests reachability and protocol responsiveness by issuing an MCP ping.
   */
  async testConnection(context: ConnectorConnectionContext): Promise<ConnectionHealthResult> {
    const result = await mcpClientManager.pingConnection(context.id);

    return {
      status: result.isHealthy ? 'CONNECTED' : 'ERROR',
      isHealthy: result.isHealthy,
      message: result.isHealthy
        ? `Successfully connected to MCP server (latency: ${result.latencyMs}ms)`
        : `MCP connection failed: ${result.error}`,
      testedAt: new Date(),
      details: {
        latencyMs: result.latencyMs,
        error: result.error,
      },
    };
  }

  /**
   * Discovers and synchronizes tools advertised by the remote MCP server.
   */
  async discoverTools(context: ConnectorConnectionContext): Promise<DiscoveredTool[]> {
    const tools = await mcpDiscoveryService.discoverTools(context.id);

    return tools.map((t) => ({
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      requiresApproval: t.requiresApproval,
      rateLimitPerMin: t.rateLimitPerMin,
    }));
  }

  /**
   * Executes a specific tool through the MCP runtime engine.
   */
  async executeTool(
    toolName: string,
    params: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    return mcpExecutionService.executeTool({
      connectionId: context.connectionId,
      toolName,
      parameters: params,
      timeoutMs: context.timeoutMs,
    });
  }
}

export const mcpConnectorAdapter = new McpConnectorAdapter();
export default mcpConnectorAdapter;
