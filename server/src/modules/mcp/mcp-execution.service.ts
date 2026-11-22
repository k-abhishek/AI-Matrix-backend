import prisma from '../../lib/prisma';
import mcpClientManager from './mcp-client.manager';
import { McpCallToolParams } from './mcp.types';
import { ToolExecutionResult } from '../adapters/base.adapter';
import { BadRequestError } from '../../lib/errors';
import logger from '../../lib/logger';

export class McpExecutionService {
  /**
   * Dispatches a tool call to the connected MCP server, enforcing schema checks,
   * execution timeouts, and error normalization.
   */
  async executeTool(params: McpCallToolParams): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const { connectionId, toolName, parameters = {}, timeoutMs = 30000 } = params;

    logger.info(`[McpExecutionService] Executing tool '${toolName}' on connection '${connectionId}'`);

    // 1. Optional schema validation against registered tool schema
    try {
      await this.validateToolInput(connectionId, toolName, parameters);
    } catch (validationErr: any) {
      return {
        success: false,
        error: `Validation error: ${validationErr.message}`,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Set up timeout signal
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      const client = await mcpClientManager.getClient(connectionId);

      const response = await client.callTool(
        {
          name: toolName,
          arguments: parameters,
        },
        undefined,
        {
          signal: abortController.signal,
        }
      );

      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startTime;

      // Extract normalized data from MCP content array
      const normalizedData = this.normalizeMcpToolOutput(response);
      const isError = Boolean((response as any).isError);

      if (isError) {
        return {
          success: false,
          error: typeof normalizedData === 'string' ? normalizedData : JSON.stringify(normalizedData),
          durationMs,
        };
      }

      return {
        success: true,
        data: normalizedData,
        durationMs,
        metadata: {
          contentCount: Array.isArray((response as any).content) ? (response as any).content.length : 1,
        },
      };
    } catch (err: any) {
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startTime;

      if (abortController.signal.aborted || err.name === 'AbortError') {
        logger.warn(`[McpExecutionService] Tool '${toolName}' timed out after ${timeoutMs}ms`);
        return {
          success: false,
          error: `Execution timed out after ${timeoutMs}ms`,
          durationMs,
        };
      }

      logger.error(`[McpExecutionService] Error executing tool '${toolName}':`, err);
      return {
        success: false,
        error: err.message || 'MCP tool execution failed',
        durationMs,
      };
    }
  }

  /**
   * Validates parameters against declared JSON Schema.
   */
  private async validateToolInput(connectionId: string, toolName: string, params: Record<string, any>): Promise<void> {
    const tool = await prisma.connectorTool.findUnique({
      where: {
        connectionId_name: {
          connectionId,
          name: toolName,
        },
      },
    }).catch(() => null);

    if (!tool || !tool.inputSchema) return;

    const schema = tool.inputSchema as Record<string, any>;
    if (schema.type === 'object' && Array.isArray(schema.required)) {
      for (const requiredProp of schema.required) {
        if (params[requiredProp] === undefined || params[requiredProp] === null) {
          throw new BadRequestError(`Missing required parameter '${requiredProp}' for tool '${toolName}'`);
        }
      }
    }
  }

  /**
   * Normalizes MCP tool response into strings, JSON objects, or formatted outputs.
   */
  private normalizeMcpToolOutput(raw: any): any {
    if (!raw) return null;

    if (Array.isArray(raw.content)) {
      if (raw.content.length === 1 && raw.content[0].type === 'text') {
        const text = raw.content[0].text;
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }

      return raw.content.map((item: any) => {
        if (item.type === 'text') {
          try {
            return JSON.parse(item.text);
          } catch {
            return item.text;
          }
        }
        return item;
      });
    }

    return raw;
  }
}

export const mcpExecutionService = new McpExecutionService();
export default mcpExecutionService;
