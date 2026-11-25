import crypto from 'crypto';
import prisma from '../../lib/prisma';
import ConnectorExecutionLog from '../../models/ConnectorExecutionLog';
import mcpExecutionService from '../mcp/mcp-execution.service';
import customRestConnectorAdapter from '../adapters/rest/custom-rest.adapter';
import gmailSendFallbackAdapter from '../adapters/native/fallback/gmail-send-fallback';
import nativeAdapterRegistry from '../adapters/native/native-adapter.registry';
import authManager from '../connections/auth.manager';
import { AppError, ForbiddenError, NotFoundError } from '../../lib/errors';
import logger from '../../lib/logger';

export interface UnifiedExecutionRequest {
  connectionId: string;
  toolName: string;
  parameters: Record<string, any>;
  workspaceId: string;
  userId?: string;
  orgRole?: string;
  agentId?: string;
  approvalConfirmed?: boolean;
  timeoutMs?: number;
}

export interface UnifiedExecutionResponse {
  success: boolean;
  data?: any;
  error?: string;
  requiresApproval?: boolean;
  approvalToken?: string;
  durationMs: number;
  metadata?: Record<string, any>;
}

export class ExecutionEngineService {
  // Sliding window rate limit tracker: key -> timestamp[]
  private rateLimitWindowMs = 60000;
  private defaultMaxCallsPerMinute = 60;
  private callBuckets = new Map<string, number[]>();
  private pendingApprovalTtlMs = 10 * 60 * 1000;
  private pendingApprovals = new Map<
    string,
    { request: UnifiedExecutionRequest; createdAt: number }
  >();

  /**
   * Secret masking pattern: matches sensitive parameter keys to prevent credential leakage.
   */
  private readonly sensitiveKeyPattern =
    /(token|secret|password|apikey|authorization|key|auth|code_verifier|client_secret|access_token|refresh_token)/i;

  /**
   * Primary entrypoint for executing any connector tool (MCP, Native, Custom REST)
   * with rate limiting, HITL approval gate, and MongoDB audit logging.
   */
  async executeTool(request: UnifiedExecutionRequest): Promise<UnifiedExecutionResponse> {
    const startTime = Date.now();
    const { connectionId, toolName, parameters, workspaceId } = request;

    // 1. Resolve connection and connector metadata
    const connection = await prisma.connectorConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: {
        connectorDefinition: true,
        tools: { where: { name: toolName } },
      },
    });

    if (!connection) {
      throw new NotFoundError(`Connection '${connectionId}' not found in workspace`);
    }

    // 1b. Enforce explicit ConnectorPermission rules when configured for this connection
    if (prisma.connectorPermission?.findMany) {
      const permissions = await prisma.connectorPermission.findMany({
        where: { connectionId, workspaceId },
      });
      if (permissions.length > 0) {
        const isAllowed = permissions.some((p) => {
          if (!p.canExecute) return false;
          const userMatches = !p.userId || p.userId === request.userId;
          const roleMatches = !p.role || p.role === request.orgRole;
          return userMatches && roleMatches;
        });
        if (!isAllowed) {
          throw new ForbiddenError(
            `User does not have permission to execute tools on connection '${connectionId}'`
          );
        }
      }
    }

    const toolRecord = connection.tools[0];

    // 2. Rate limiting check (sliding window)
    const rateLimitKey = `${connectionId}:${toolName}`;
    this.checkRateLimit(rateLimitKey, toolRecord?.rateLimitPerMin || this.defaultMaxCallsPerMinute);

    // 3. Human-in-the-Loop (HITL) approval gate
    if (toolRecord?.requiresApproval && !request.approvalConfirmed) {
      const approvalToken = crypto.randomUUID();
      this.pruneExpiredApprovals();
      this.pendingApprovals.set(approvalToken, {
        request: { ...request },
        createdAt: Date.now(),
      });
      logger.info(
        `[ExecutionEngine] Tool '${toolName}' on connection '${connectionId}' requires human approval. Emitted token: ${approvalToken}`
      );

      return {
        success: false,
        requiresApproval: true,
        approvalToken,
        error: `Tool '${toolName}' is marked sensitive and requires human confirmation before execution.`,
        durationMs: Date.now() - startTime,
      };
    }

    // 4. Determine connector integration type and route
    const defType = connection.connectorDefinition.type;
    const defKey = connection.connectorDefinition.key;
    let connectorType: 'MCP' | 'NATIVE' | 'CUSTOM_REST' = 'MCP';
    let executionResult: { success: boolean; data?: any; error?: string; durationMs: number };

    try {
      if (toolName === 'send_email' && defKey === 'gmail') {
        connectorType = 'NATIVE';
        const res = await gmailSendFallbackAdapter.sendEmail(connectionId, parameters as any);
        executionResult = {
          success: res.success,
          data: res.data,
          error: res.error,
          durationMs: Date.now() - startTime,
        };
      } else if (defType === 'NATIVE') {
        connectorType = 'NATIVE';
        const adapter = nativeAdapterRegistry.getAdapter(defKey);
        if (adapter) {
          const res = await adapter.executeTool(toolName, parameters, {
            connectionId,
            workspaceId,
            userId: request.userId,
            agentId: request.agentId,
            baseUrl: connection.baseUrl,
            config: connection.config as any,
            timeoutMs: request.timeoutMs,
          });
          executionResult = {
            success: res.success,
            data: res.data,
            error: res.error,
            durationMs: res.durationMs,
          };
        } else {
          throw new AppError(`No native adapter implemented for '${defKey}'`, 400);
        }
      } else if (defType === 'CUSTOM_REST' || defKey === 'custom-rest') {
        connectorType = 'CUSTOM_REST';
        const res = await customRestConnectorAdapter.executeTool(toolName, parameters, {
          connectionId,
          workspaceId,
          baseUrl: connection.baseUrl,
          config: connection.config as any,
          timeoutMs: request.timeoutMs,
        });
        executionResult = {
          success: res.success,
          data: res.data,
          error: res.error,
          durationMs: res.durationMs,
        };
      } else {
        connectorType = 'MCP';
        try {
          const res = await mcpExecutionService.executeTool({
            connectionId,
            toolName,
            parameters,
            timeoutMs: request.timeoutMs,
          });
          executionResult = {
            success: res.success,
            data: res.data,
            error: res.error,
            durationMs: res.durationMs,
          };
        } catch (mcpErr: any) {
          if (nativeAdapterRegistry.hasAdapter(defKey)) {
            logger.warn(`[ExecutionEngine] MCP failed for '${toolName}', attempting native fallback...`);
            const adapter = nativeAdapterRegistry.getAdapter(defKey)!;
            const res = await adapter.executeTool(toolName, parameters, {
              connectionId,
              workspaceId,
              userId: request.userId,
              agentId: request.agentId,
              baseUrl: connection.baseUrl,
              config: connection.config as any,
              timeoutMs: request.timeoutMs,
            });
            executionResult = {
              success: res.success,
              data: res.data,
              error: res.error,
              durationMs: res.durationMs,
            };
          } else {
            throw mcpErr;
          }
        }
      }
    } catch (err: any) {
      executionResult = {
        success: false,
        error: err.message,
        durationMs: Date.now() - startTime,
      };
    }

    // 5. Asynchronous Audit Logging in MongoDB (fire-and-forget to avoid blocking)
    const sanitizedParams = this.maskSensitiveData(parameters);
    this.recordAuditLog({
      connectionId,
      workspaceId,
      agentId: request.agentId,
      userId: request.userId,
      toolName,
      connectorType,
      success: executionResult.success,
      durationMs: executionResult.durationMs,
      parameters: sanitizedParams,
      resultSummary: executionResult.success
        ? typeof executionResult.data === 'string'
          ? executionResult.data.slice(0, 300)
          : JSON.stringify(executionResult.data).slice(0, 300)
        : undefined,
      error: executionResult.error,
    }).catch((logErr) => {
      logger.warn(`[ExecutionEngine] Failed to write execution log to MongoDB: ${logErr.message}`);
    });

    return {
      success: executionResult.success,
      data: executionResult.data,
      error: executionResult.error,
      durationMs: executionResult.durationMs,
    };
  }

  /**
   * Enforces sliding window rate limit counter.
   */
  checkRateLimit(key: string, maxPerMin: number): void {
    const now = Date.now();
    const timestamps = this.callBuckets.get(key) || [];

    // Filter out timestamps older than 60s
    const validTimestamps = timestamps.filter((t) => now - t < this.rateLimitWindowMs);

    if (validTimestamps.length >= maxPerMin) {
      throw new AppError(
        `Rate limit exceeded: tool is capped at ${maxPerMin} requests per minute. Please wait.`,
        429
      );
    }

    validTimestamps.push(now);
    this.callBuckets.set(key, validTimestamps);
  }

  /**
   * Recursively masks sensitive tokens and secrets in logged parameters.
   */
  maskSensitiveData(input: any): any {
    if (input === null || input === undefined) return input;

    if (Array.isArray(input)) {
      return input.map((item) => this.maskSensitiveData(item));
    }

    if (typeof input === 'object') {
      const masked: Record<string, any> = {};
      for (const [key, val] of Object.entries(input)) {
        if (typeof val === 'object' && val !== null) {
          masked[key] = this.maskSensitiveData(val);
        } else if (this.sensitiveKeyPattern.test(key)) {
          masked[key] = '[REDACTED]';
        } else {
          masked[key] = val;
        }
      }
      return masked;
    }

    return input;
  }

  /**
   * Checks token expiration and health for proactive refresh warnings.
   */
  async checkConnectionTokenHealth(connectionId: string): Promise<{
    isHealthy: boolean;
    needsRefresh: boolean;
    expiresAt?: Date | null;
  }> {
    const credential = await prisma.connectorCredential.findUnique({
      where: { connectionId },
    });

    if (!credential || !credential.expiresAt) {
      return { isHealthy: true, needsRefresh: false };
    }

    const now = Date.now();
    const expiresAtMs = credential.expiresAt.getTime();
    const fiveMinutesMs = 5 * 60 * 1000;

    const needsRefresh = expiresAtMs - now < fiveMinutesMs;
    const isExpired = expiresAtMs <= now;

    return {
      isHealthy: !isExpired,
      needsRefresh,
      expiresAt: credential.expiresAt,
    };
  }

  private pruneExpiredApprovals(): void {
    const cutoff = Date.now() - this.pendingApprovalTtlMs;
    for (const [token, entry] of this.pendingApprovals.entries()) {
      if (entry.createdAt < cutoff) {
        this.pendingApprovals.delete(token);
      }
    }
  }

  /**
   * Resolves a pending HITL approval token by executing (if approved) or discarding (if rejected).
   */
  async resolveApproval(
    approvalToken: string,
    workspaceId: string,
    approved: boolean
  ): Promise<UnifiedExecutionResponse & { rejected?: boolean }> {
    this.pruneExpiredApprovals();
    const pending = this.pendingApprovals.get(approvalToken);

    if (!pending || pending.request.workspaceId !== workspaceId) {
      throw new NotFoundError('Approval token is invalid, expired, or does not belong to this workspace');
    }

    this.pendingApprovals.delete(approvalToken);

    if (!approved) {
      return {
        success: false,
        rejected: true,
        error: `Execution of '${pending.request.toolName}' was rejected by the user.`,
        durationMs: 0,
      };
    }

    return this.executeTool({
      ...pending.request,
      approvalConfirmed: true,
    });
  }

  /**
   * Persists an execution log record to MongoDB.
   */
  private async recordAuditLog(logData: {
    connectionId: string;
    workspaceId: string;
    agentId?: string;
    userId?: string;
    toolName: string;
    connectorType: 'MCP' | 'NATIVE' | 'CUSTOM_REST';
    success: boolean;
    durationMs: number;
    parameters?: Record<string, any>;
    resultSummary?: string;
    error?: string;
  }): Promise<void> {
    try {
      await ConnectorExecutionLog.create({
        ...logData,
        timestamp: new Date(),
      });
    } catch (err: any) {
      logger.warn(`[ExecutionEngine] Could not write MongoDB audit log: ${err.message}`);
    }
  }
}

export const executionEngineService = new ExecutionEngineService();
export default executionEngineService;
