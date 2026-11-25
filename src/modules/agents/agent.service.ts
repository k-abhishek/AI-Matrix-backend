import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import graphCacheService from '../runtime/graph-cache.service';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../lib/errors';
import {
  WorkspaceContext,
  WORKSPACE_ADMIN_ROLES,
  WORKSPACE_EDITOR_ROLES,
} from '../../middleware/auth';
import {
  AgentValidationResult,
  CreateAgentDTO,
  ListAgentsFilter,
  UpdateAgentDTO,
} from './agent.types';

const SUPPORTED_PROVIDERS = new Set(['google', 'groq', 'openai', 'anthropic', 'ollama']);

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'agent';
}

function computeConfigHash(config: Record<string, any>): string {
  const canonical = JSON.stringify(config, Object.keys(config).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function toPrismaJson(
  value: unknown
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export class AgentService {
  private assertCanRead(ctx: WorkspaceContext, agent: { workspaceId: string; visibility: string; ownerUserId: string; isSystem?: boolean }) {
    if (agent.isSystem) return;
    if (agent.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError('Agent not found in this workspace');
    }
    if (agent.visibility === 'PERSONAL' && agent.ownerUserId !== ctx.userId) {
      throw new ForbiddenError('You do not have access to this personal agent');
    }
  }

  private assertCanManage(ctx: WorkspaceContext, agent: { workspaceId: string; visibility: string; ownerUserId: string; isSystem?: boolean }) {
    this.assertCanRead(ctx, agent);

    if (agent.isSystem) {
      throw new ForbiddenError('System agents cannot be modified or deleted');
    }

    if (agent.visibility === 'PERSONAL') {
      if (agent.ownerUserId !== ctx.userId) {
        throw new ForbiddenError('Only the owner can manage a personal agent');
      }
      return;
    }

    if (
      ctx.isOrganization &&
      (!ctx.orgRole || !WORKSPACE_EDITOR_ROLES.includes(ctx.orgRole as any))
    ) {
      throw new ForbiddenError('Workspace admin or editor role is required to manage workspace agents');
    }
  }

  private assertCanAdmin(ctx: WorkspaceContext, agent: { workspaceId: string; visibility: string; ownerUserId: string }) {
    this.assertCanRead(ctx, agent);

    if (agent.visibility === 'PERSONAL') {
      if (agent.ownerUserId !== ctx.userId) {
        throw new ForbiddenError('Only the owner can administer a personal agent');
      }
      return;
    }

    if (
      ctx.isOrganization &&
      (!ctx.orgRole || !WORKSPACE_ADMIN_ROLES.includes(ctx.orgRole as any))
    ) {
      throw new ForbiddenError('Workspace admin role is required for this action');
    }
  }

  private async generateUniqueSlug(workspaceId: string, name: string): Promise<string> {
    const base = slugify(name);
    const existing = await prisma.agent.findUnique({
      where: { workspaceId_slug: { workspaceId, slug: base } },
      select: { id: true },
    });
    if (!existing) return base;
    return `${base}-${crypto.randomUUID().slice(0, 6)}`;
  }

  async createAgent(ctx: WorkspaceContext, input: CreateAgentDTO) {
    const visibility = input.visibility ?? 'PERSONAL';
    if (
      visibility === 'WORKSPACE' &&
      ctx.isOrganization &&
      (!ctx.orgRole || !WORKSPACE_EDITOR_ROLES.includes(ctx.orgRole as any))
    ) {
      throw new ForbiddenError('Workspace admin or editor role is required to create workspace-visible agents');
    }

    const slug = await this.generateUniqueSlug(ctx.workspaceId, input.name);
    const versionPayload = {
      systemInstructions: input.systemInstructions,
      provider: input.provider ?? null,
      model: input.model ?? null,
      temperature: input.temperature ?? 0.7,
      maxTokens: input.maxTokens ?? null,
      maxIterations: input.maxIterations ?? 15,
      timeoutMs: input.timeoutMs ?? 60000,
      memoryConfig: input.memoryConfig ?? { withinThreadEnabled: true, longTermMemoryEnabled: false },
      executionPolicy: input.executionPolicy ?? null,
    };
    const configHash = computeConfigHash(versionPayload);

    return prisma.$transaction(async (tx) => {
      const agent = await tx.agent.create({
        data: {
          workspaceId: ctx.workspaceId,
          createdByUserId: ctx.userId,
          ownerUserId: ctx.userId,
          visibility,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          slug,
          status: 'ACTIVE',
          draftConfig: versionPayload,
        },
      });

      const draftVersion = await tx.agentVersion.create({
        data: {
          agentId: agent.id,
          versionNumber: 1,
          status: 'DRAFT',
          configHash,
          systemInstructions: versionPayload.systemInstructions,
          provider: versionPayload.provider,
          model: versionPayload.model,
          temperature: versionPayload.temperature,
          maxTokens: versionPayload.maxTokens,
          maxIterations: versionPayload.maxIterations,
          timeoutMs: versionPayload.timeoutMs,
          memoryConfig: toPrismaJson(versionPayload.memoryConfig),
          executionPolicy: toPrismaJson(versionPayload.executionPolicy),
        },
      });

      return { agent, draftVersion };
    });
  }

  async listAgents(ctx: WorkspaceContext, filter: ListAgentsFilter = {}) {
    const status = filter.status ?? 'ACTIVE';

    return prisma.agent.findMany({
      where: {
        status,
        ...(filter.visibility ? { visibility: filter.visibility } : {}),
        OR: [
          { isSystem: true },
          { workspaceId: ctx.workspaceId, visibility: 'WORKSPACE' },
          { workspaceId: ctx.workspaceId, visibility: 'PERSONAL', ownerUserId: ctx.userId },
        ],
      },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 2,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getAgentById(ctx: WorkspaceContext, agentId: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
        },
        knowledgeBases: {
          where: { isEnabled: true },
          include: { knowledgeBase: true },
        },
        skills: {
          where: { isEnabled: true },
          include: { skill: true, skillVersion: true },
          orderBy: { priority: 'asc' },
        },
        toolGrants: {
          where: { isEnabled: true },
        },
      },
    });

    if (!agent) {
      throw new NotFoundError(`Agent '${agentId}' not found`);
    }

    this.assertCanRead(ctx, agent);
    return agent;
  }

  async updateAgent(ctx: WorkspaceContext, agentId: string, input: UpdateAgentDTO) {
    const agent = await this.getAgentById(ctx, agentId);
    this.assertCanManage(ctx, agent);

    if (
      input.visibility === 'WORKSPACE' &&
      agent.visibility === 'PERSONAL' &&
      ctx.isOrganization &&
      (!ctx.orgRole || !WORKSPACE_EDITOR_ROLES.includes(ctx.orgRole as any))
    ) {
      throw new ForbiddenError('Workspace admin or editor role is required to promote an agent to workspace visibility');
    }

    const latestVersion = agent.versions[0];
    const hasConfigChanges =
      input.systemInstructions !== undefined ||
      input.provider !== undefined ||
      input.model !== undefined ||
      input.temperature !== undefined ||
      input.maxTokens !== undefined ||
      input.maxIterations !== undefined ||
      input.timeoutMs !== undefined ||
      input.memoryConfig !== undefined ||
      input.executionPolicy !== undefined;

    return prisma.$transaction(async (tx) => {
      let draftVersion =
        latestVersion && (latestVersion.status === 'DRAFT' || latestVersion.status === 'VALIDATED')
          ? latestVersion
          : null;

      if (hasConfigChanges) {
        const base = latestVersion || (agent.draftConfig as any) || {};
        const mergedConfig = {
          systemInstructions: input.systemInstructions ?? base.systemInstructions ?? '',
          provider: input.provider !== undefined ? input.provider : (base.provider ?? null),
          model: input.model !== undefined ? input.model : (base.model ?? null),
          temperature: input.temperature ?? base.temperature ?? 0.7,
          maxTokens: input.maxTokens !== undefined ? input.maxTokens : (base.maxTokens ?? null),
          maxIterations: input.maxIterations ?? base.maxIterations ?? 15,
          timeoutMs: input.timeoutMs ?? base.timeoutMs ?? 60000,
          memoryConfig: input.memoryConfig !== undefined ? input.memoryConfig : (base.memoryConfig ?? null),
          executionPolicy: input.executionPolicy !== undefined ? input.executionPolicy : (base.executionPolicy ?? null),
        };
        const configHash = computeConfigHash(mergedConfig);

        const prismaData = {
          systemInstructions: mergedConfig.systemInstructions,
          provider: mergedConfig.provider,
          model: mergedConfig.model,
          temperature: mergedConfig.temperature,
          maxTokens: mergedConfig.maxTokens,
          maxIterations: mergedConfig.maxIterations,
          timeoutMs: mergedConfig.timeoutMs,
          memoryConfig: toPrismaJson(mergedConfig.memoryConfig),
          executionPolicy: toPrismaJson(mergedConfig.executionPolicy),
        };

        if (draftVersion) {
          draftVersion = await tx.agentVersion.update({
            where: { id: draftVersion.id },
            data: {
              ...prismaData,
              status: 'DRAFT',
              configHash,
            },
          });
        } else {
          const nextNumber = (latestVersion?.versionNumber ?? 0) + 1;
          draftVersion = await tx.agentVersion.create({
            data: {
              agentId: agent.id,
              versionNumber: nextNumber,
              status: 'DRAFT',
              configHash,
              ...prismaData,
            },
          });
        }
      }

      const updatedAgent = await tx.agent.update({
        where: { id: agent.id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
          ...(draftVersion ? { draftConfig: { systemInstructions: draftVersion.systemInstructions, provider: draftVersion.provider, model: draftVersion.model, temperature: draftVersion.temperature, maxTokens: draftVersion.maxTokens, maxIterations: draftVersion.maxIterations, timeoutMs: draftVersion.timeoutMs, memoryConfig: draftVersion.memoryConfig, executionPolicy: draftVersion.executionPolicy } } : {}),
        },
      });

      return { agent: updatedAgent, draftVersion };
    });
  }

  async archiveAgent(ctx: WorkspaceContext, agentId: string) {
    const agent = await this.getAgentById(ctx, agentId);
    if (agent.isSystem || agent.slug === 'indian-legal-research') {
      throw new ForbiddenError('System agents cannot be deleted or archived');
    }
    this.assertCanManage(ctx, agent);

    return prisma.agent.update({
      where: { id: agent.id },
      data: { status: 'ARCHIVED' },
    });
  }

  async duplicateAgent(ctx: WorkspaceContext, agentId: string) {
    const source = await this.getAgentById(ctx, agentId);
    const activeOrLatest =
      source.versions.find((v) => v.id === source.activeVersionId) || source.versions[0];

    if (!activeOrLatest) {
      throw new BadRequestError('Source agent has no configuration version to duplicate');
    }

    return this.createAgent(ctx, {
      name: `${source.name} (Copy)`,
      description: source.description ?? undefined,
      visibility: 'PERSONAL',
      systemInstructions: activeOrLatest.systemInstructions,
      provider: (activeOrLatest.provider as any) ?? undefined,
      model: activeOrLatest.model ?? undefined,
      temperature: activeOrLatest.temperature,
      maxTokens: activeOrLatest.maxTokens ?? undefined,
      maxIterations: activeOrLatest.maxIterations,
      timeoutMs: activeOrLatest.timeoutMs,
      memoryConfig: (activeOrLatest.memoryConfig as any) ?? undefined,
      executionPolicy: (activeOrLatest.executionPolicy as any) ?? undefined,
    });
  }

  async validateAgent(ctx: WorkspaceContext, agentId: string): Promise<AgentValidationResult> {
    const agent = await this.getAgentById(ctx, agentId);
    this.assertCanManage(ctx, agent);

    const targetVersion =
      agent.versions.find((v) => v.status === 'DRAFT' || v.status === 'VALIDATED') ||
      agent.versions[0];

    if (!targetVersion) {
      throw new BadRequestError('No draft version found to validate');
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!targetVersion.systemInstructions || targetVersion.systemInstructions.trim().length === 0) {
      errors.push('systemInstructions cannot be empty');
    }
    if (targetVersion.provider && !SUPPORTED_PROVIDERS.has(targetVersion.provider)) {
      errors.push(`Unsupported provider '${targetVersion.provider}'`);
    }
    if (targetVersion.temperature < 0 || targetVersion.temperature > 2) {
      errors.push('temperature must be between 0 and 2');
    }
    if (targetVersion.maxIterations < 1 || targetVersion.maxIterations > 100) {
      errors.push('maxIterations must be between 1 and 100');
    }
    if (targetVersion.timeoutMs < 1000 || targetVersion.timeoutMs > 300000) {
      errors.push('timeoutMs must be between 1000 and 300000');
    }
    if (!targetVersion.model) {
      warnings.push('No explicit model configured; runtime will use platform default model');
    }

    const valid = errors.length === 0;
    if (valid && targetVersion.status === 'DRAFT') {
      await prisma.agentVersion.update({
        where: { id: targetVersion.id },
        data: { status: 'VALIDATED' },
      });
    }

    return {
      valid,
      versionId: targetVersion.id,
      errors,
      warnings,
    };
  }

  async publishAgent(ctx: WorkspaceContext, agentId: string) {
    const agent = await this.getAgentById(ctx, agentId);
    this.assertCanManage(ctx, agent);

    const validation = await this.validateAgent(ctx, agentId);
    if (!validation.valid) {
      throw new BadRequestError('Agent validation failed', { errors: validation.errors });
    }

    const versionToPublish = await prisma.agentVersion.findUnique({
      where: { id: validation.versionId },
    });

    if (!versionToPublish || versionToPublish.status === 'PUBLISHED') {
      throw new BadRequestError('No unpublished draft or validated version available to publish');
    }

    if (versionToPublish.status === 'REVOKED') {
      throw new BadRequestError('Cannot publish a revoked version');
    }

    return prisma.$transaction(async (tx) => {
      if (agent.activeVersionId) {
        await tx.agentVersion.updateMany({
          where: { id: agent.activeVersionId, status: 'PUBLISHED' },
          data: { status: 'DEPRECATED' },
        });
      }

      const publishedVersion = await tx.agentVersion.update({
        where: { id: versionToPublish.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          publishedByUserId: ctx.userId,
        },
      });

      const updatedAgent = await tx.agent.update({
        where: { id: agent.id },
        data: { activeVersionId: publishedVersion.id },
      });

      // Pin draft KB, Skill, and ToolGrant associations to the published version
      if ((tx as any).agentKnowledgeBase?.findMany) {
        const draftKbs = await tx.agentKnowledgeBase.findMany({
          where: { agentId: agent.id, agentVersionId: null, isEnabled: true },
        });
        for (const kb of draftKbs) {
          await tx.agentKnowledgeBase.create({
            data: {
              agentId: agent.id,
              agentVersionId: publishedVersion.id,
              knowledgeBaseId: kb.knowledgeBaseId,
              retrievalConfig: toPrismaJson(kb.retrievalConfig),
              isEnabled: kb.isEnabled,
            },
          });
        }
      }

      if ((tx as any).agentSkill?.findMany) {
        const draftSkills = await tx.agentSkill.findMany({
          where: { agentId: agent.id, agentVersionId: null, isEnabled: true },
          include: { skill: true },
        });
        for (const s of draftSkills) {
          await tx.agentSkill.create({
            data: {
              agentId: agent.id,
              agentVersionId: publishedVersion.id,
              skillId: s.skillId,
              skillVersionId: s.skillVersionId || s.skill.activeVersionId,
              isEnabled: s.isEnabled,
              priority: s.priority,
              settingsOverride: toPrismaJson(s.settingsOverride),
            },
          });
        }
      }

      graphCacheService.invalidateByVersion(publishedVersion.id);

      return { agent: updatedAgent, publishedVersion };
    });
  }

  async rollbackAgent(ctx: WorkspaceContext, agentId: string, targetVersionId: string) {
    const agent = await this.getAgentById(ctx, agentId);
    this.assertCanManage(ctx, agent);

    const targetVersion = agent.versions.find((v) => v.id === targetVersionId);
    if (!targetVersion) {
      throw new NotFoundError(`Version '${targetVersionId}' not found for agent '${agentId}'`);
    }
    if (targetVersion.status === 'REVOKED') {
      throw new BadRequestError('Cannot roll back to a revoked version');
    }
    if (targetVersion.status === 'DRAFT' || targetVersion.status === 'VALIDATED') {
      throw new BadRequestError('Cannot roll back to an unpublished draft version');
    }

    return prisma.$transaction(async (tx) => {
      if (agent.activeVersionId && agent.activeVersionId !== targetVersionId) {
        await tx.agentVersion.updateMany({
          where: { id: agent.activeVersionId, status: 'PUBLISHED' },
          data: { status: 'DEPRECATED' },
        });
      }

      const restoredVersion = await tx.agentVersion.update({
        where: { id: targetVersionId },
        data: { status: 'PUBLISHED' },
      });

      const updatedAgent = await tx.agent.update({
        where: { id: agent.id },
        data: { activeVersionId: restoredVersion.id },
      });

      return { agent: updatedAgent, activeVersion: restoredVersion };
    });
  }

  async revokeVersion(
    ctx: WorkspaceContext,
    agentId: string,
    versionId: string,
    reason?: string
  ) {
    const agent = await this.getAgentById(ctx, agentId);
    this.assertCanAdmin(ctx, agent);

    const version = agent.versions.find((v) => v.id === versionId);
    if (!version) {
      throw new NotFoundError(`Version '${versionId}' not found for agent '${agentId}'`);
    }

    return prisma.$transaction(async (tx) => {
      const revoked = await tx.agentVersion.update({
        where: { id: versionId },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedByUserId: ctx.userId,
          revokedReason: reason?.trim() || 'Administratively revoked',
        },
      });

      if (agent.activeVersionId === versionId) {
        await tx.agent.update({
          where: { id: agent.id },
          data: { activeVersionId: null },
        });
      }

      return revoked;
    });
  }

  async listVersions(ctx: WorkspaceContext, agentId: string) {
    const agent = await this.getAgentById(ctx, agentId);
    return agent.versions;
  }
}

export const agentService = new AgentService();
export default agentService;
