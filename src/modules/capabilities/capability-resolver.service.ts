import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { WorkspaceContext } from '../../middleware/auth';
import executionEngineService from '../execution/execution-engine.service';
import jsonSchemaToZod from '../../utils/schema-converter';
import { tool } from '@langchain/core/tools';
import { indianLegalResearchTool, vectorKnowledgeBaseTool, webSearchTool } from '../../tools';
import {
  searchLegalKnowledgeTool,
  getLegalProvisionTool,
  getLegalDocumentTool,
  getProvisionHistoryTool,
  getRelatedAuthoritiesTool,
  searchCaseLawTool,
  verifyLegalCitationTool,
  assessLegalApplicabilityTool,
} from '../legal-research/agents/tools';

const BUILTIN_TOOL_MAP: Record<string, any> = {
  indian_legal_research: indianLegalResearchTool,
  search_knowledge_base: vectorKnowledgeBaseTool,
  web_search: webSearchTool,
  search_legal_knowledge: searchLegalKnowledgeTool,
  get_legal_provision: getLegalProvisionTool,
  get_legal_document: getLegalDocumentTool,
  get_provision_history: getProvisionHistoryTool,
  get_related_legal_authorities: getRelatedAuthoritiesTool,
  search_case_law: searchCaseLawTool,
  verify_legal_citation: verifyLegalCitationTool,
  assess_legal_applicability: assessLegalApplicabilityTool,
};

export interface ConnectionResolutionError {
  code: 'CONNECTION_REQUIRED' | 'CONNECTION_EXPIRED' | 'PERMISSION_DENIED';
  connectorKey: string;
  connectionScope: 'WORKSPACE_SHARED' | 'USER_DELEGATED';
  message: string;
}

export interface ResolvedCapabilityTool {
  toolKey: string;
  langchainTool: any;
  requiresApproval: boolean;
  connectionScope: 'WORKSPACE_SHARED' | 'USER_DELEGATED';
  connectionId?: string;
}

export class CapabilityResolverService {
  /**
   * Resolves permitted tools for an agent grant list, enforcing dual OAuth scopes:
   * - WORKSPACE_SHARED: uses authorized workspace connection
   * - USER_DELEGATED: dynamically resolves invoking user's own connection (never falls back to another user's)
   */
  async resolveAgentGrants(
    ctx: WorkspaceContext,
    agentId: string,
    agentVersionId: string | null,
    skillPermittedToolKeys?: Set<string>
  ): Promise<{
    tools: ResolvedCapabilityTool[];
    connectionErrors: ConnectionResolutionError[];
  }> {
    const grants = await prisma.agentToolGrant.findMany({
      where: {
        agentId,
        isEnabled: true,
        ...(agentVersionId ? { agentVersionId } : { agentVersionId: null }),
        OR: [
          { workspaceId: ctx.workspaceId },
          { workspaceId: 'platform', capabilityType: 'BUILTIN' },
        ],
      },
    });

    const tools: ResolvedCapabilityTool[] = [];
    const connectionErrors: ConnectionResolutionError[] = [];

    for (const grant of grants) {
      if (skillPermittedToolKeys && skillPermittedToolKeys.size > 0 && !skillPermittedToolKeys.has(grant.toolKey)) {
        continue;
      }

      if (grant.capabilityType === 'BUILTIN') {
        const builtinTool = BUILTIN_TOOL_MAP[grant.toolKey];
        if (builtinTool) {
          tools.push({
            toolKey: grant.toolKey,
            langchainTool: builtinTool,
            requiresApproval: grant.requiresApproval,
            connectionScope: grant.connectionScope,
          });
        }
        continue;
      }

      let connection: any = null;

      if (grant.connectionScope === 'USER_DELEGATED') {
        connection = await prisma.connectorConnection.findFirst({
          where: {
            workspaceId: ctx.workspaceId,
            userId: ctx.userId,
            connectorDefinition: { key: grant.toolKey },
          },
          include: {
            connectorDefinition: true,
            tools: { where: { isEnabled: true } },
          },
        });
      } else {
        connection = await prisma.connectorConnection.findFirst({
          where: {
            workspaceId: ctx.workspaceId,
            ...(grant.connectionId
              ? { id: grant.connectionId }
              : { connectorDefinition: { key: grant.toolKey } }),
          },
          include: {
            connectorDefinition: true,
            tools: { where: { isEnabled: true } },
          },
        });
      }

      if (!connection) {
        connectionErrors.push({
          code: 'CONNECTION_REQUIRED',
          connectorKey: grant.toolKey,
          connectionScope: grant.connectionScope,
          message:
            grant.connectionScope === 'USER_DELEGATED'
              ? `Personal authorization required for '${grant.toolKey}'. Please connect your account.`
              : `Workspace connection '${grant.toolKey}' is not configured.`,
        });
        continue;
      }

      if (connection.status === 'EXPIRED' || connection.status === 'REVOKED' || connection.status === 'DISCONNECTED') {
        connectionErrors.push({
          code: 'CONNECTION_EXPIRED',
          connectorKey: grant.toolKey,
          connectionScope: grant.connectionScope,
          message: `Connection '${connection.name}' (${grant.toolKey}) is ${connection.status.toLowerCase()}. Please reconnect.`,
        });
        continue;
      }

      for (const t of connection.tools || []) {
        if (grant.allowedToolNames.length > 0 && !grant.allowedToolNames.includes(t.name)) {
          continue;
        }

        const uniqueToolName = `${grant.toolKey}_${t.name}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
        const schema = jsonSchemaToZod((t.inputSchema || { type: 'object', properties: {} }) as Record<string, any>);
        const requiresApproval = Boolean(grant.requiresApproval || t.requiresApproval);

        const lcTool = tool(
          async (input: Record<string, any>) => {
            const res = await executionEngineService.executeTool({
              connectionId: connection.id,
              toolName: t.name,
              parameters: input,
              workspaceId: ctx.workspaceId,
              userId: ctx.userId,
              orgRole: ctx.orgRole,
              agentId,
              approvalConfirmed: true,
            });
            if (!res.success) {
              throw new AppError(res.error || 'Tool execution failed', 500);
            }
            return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          },
          {
            name: uniqueToolName,
            description: t.description || t.displayName || t.name,
            schema: schema as any,
          }
        );

        tools.push({
          toolKey: uniqueToolName,
          langchainTool: lcTool,
          requiresApproval,
          connectionScope: grant.connectionScope,
          connectionId: connection.id,
        });
      }
    }

    return { tools, connectionErrors };
  }
}

export const capabilityResolverService = new CapabilityResolverService();
export default capabilityResolverService;
