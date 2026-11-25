import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../lib/errors';
import { WorkspaceContext, WORKSPACE_EDITOR_ROLES } from '../../middleware/auth';
import modelFactoryService from '../../services/modelFactory.service';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface CreateSkillDTO {
  key: string;
  name: string;
  description?: string;
  scope?: 'PLATFORM' | 'WORKSPACE' | 'PERSONAL';
  category?: 'INSTRUCTION' | 'TOOL' | 'WORKFLOW';
  summary: string;
  instructions: string;
  inputSchema?: Record<string, any>;
  requiredCapabilities?: string[];
  permittedToolKeys?: string[];
  workflowDefinition?: Record<string, any>;
  settingsSchema?: Record<string, any>;
}

export interface UpdateSkillDTO {
  name?: string;
  description?: string | null;
  summary?: string;
  instructions?: string;
  inputSchema?: Record<string, any> | null;
  requiredCapabilities?: string[];
  permittedToolKeys?: string[];
  workflowDefinition?: Record<string, any> | null;
  settingsSchema?: Record<string, any> | null;
}

function hashSkillConfig(payload: Record<string, any>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function toJson(val: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (val === undefined) return undefined;
  if (val === null) return Prisma.JsonNull;
  return val as Prisma.InputJsonValue;
}

export class SkillService {
  private assertCanRead(ctx: WorkspaceContext, skill: { scope: string; workspaceId: string | null; ownerUserId: string }) {
    if (skill.scope === 'PLATFORM') return;
    if (skill.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError('Skill not found in this workspace');
    }
    if (skill.scope === 'PERSONAL' && skill.ownerUserId !== ctx.userId) {
      throw new ForbiddenError('You do not have access to this personal skill');
    }
  }

  private assertCanManage(ctx: WorkspaceContext, skill: { scope: string; workspaceId: string | null; ownerUserId: string }) {
    this.assertCanRead(ctx, skill);
    if (skill.scope === 'PLATFORM') {
      throw new ForbiddenError('Platform skills cannot be modified by workspace users');
    }
    if (skill.scope === 'PERSONAL' && skill.ownerUserId !== ctx.userId) {
      throw new ForbiddenError('Only the owner can manage a personal skill');
    }
    if (
      skill.scope === 'WORKSPACE' &&
      ctx.isOrganization &&
      (!ctx.orgRole || !WORKSPACE_EDITOR_ROLES.includes(ctx.orgRole as any))
    ) {
      throw new ForbiddenError('Workspace admin or editor role is required to manage workspace skills');
    }
  }

  async createSkill(ctx: WorkspaceContext, input: CreateSkillDTO) {
    const scope = input.scope ?? 'PERSONAL';
    if (scope === 'PLATFORM') {
      throw new ForbiddenError('Workspace users cannot create platform-scoped skills');
    }
    if (
      scope === 'WORKSPACE' &&
      ctx.isOrganization &&
      (!ctx.orgRole || !WORKSPACE_EDITOR_ROLES.includes(ctx.orgRole as any))
    ) {
      throw new ForbiddenError('Workspace admin or editor role is required to create workspace skills');
    }

    const versionData = {
      summary: input.summary.trim(),
      instructions: input.instructions,
      inputSchema: toJson(input.inputSchema ?? null),
      requiredCapabilities: input.requiredCapabilities ?? [],
      permittedToolKeys: input.permittedToolKeys ?? [],
      workflowDefinition: toJson(input.workflowDefinition ?? null),
      settingsSchema: toJson(input.settingsSchema ?? null),
    };
    const configHash = hashSkillConfig(versionData as any);

    return prisma.$transaction(async (tx) => {
      const skill = await tx.skill.create({
        data: {
          scope,
          workspaceId: ctx.workspaceId,
          createdByUserId: ctx.userId,
          ownerUserId: ctx.userId,
          key: input.key.trim().toLowerCase(),
          name: input.name.trim(),
          description: input.description?.trim() || null,
          category: input.category ?? 'INSTRUCTION',
          status: 'ACTIVE',
        },
      });

      const draftVersion = await tx.skillVersion.create({
        data: {
          skillId: skill.id,
          versionNumber: 1,
          status: 'DRAFT',
          configHash,
          ...versionData,
        },
      });

      return { skill, draftVersion };
    });
  }

  async listSkills(ctx: WorkspaceContext, filter?: { scope?: 'PLATFORM' | 'WORKSPACE' | 'PERSONAL'; category?: 'INSTRUCTION' | 'TOOL' | 'WORKFLOW' }) {
    return prisma.skill.findMany({
      where: {
        status: 'ACTIVE',
        ...(filter?.scope ? { scope: filter.scope } : {}),
        ...(filter?.category ? { category: filter.category } : {}),
        OR: [
          { scope: 'PLATFORM' },
          { scope: 'WORKSPACE', workspaceId: ctx.workspaceId },
          { scope: 'PERSONAL', workspaceId: ctx.workspaceId, ownerUserId: ctx.userId },
        ],
      },
      include: {
        versions: { orderBy: { versionNumber: 'desc' }, take: 2 },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getSkillById(ctx: WorkspaceContext, skillId: string) {
    const skill = await prisma.skill.findUnique({
      where: { id: skillId },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    });
    if (!skill) {
      throw new NotFoundError(`Skill '${skillId}' not found`);
    }
    this.assertCanRead(ctx, skill);
    return skill;
  }

  async updateSkill(ctx: WorkspaceContext, skillId: string, input: UpdateSkillDTO) {
    const skill = await this.getSkillById(ctx, skillId);
    this.assertCanManage(ctx, skill);

    const latest = skill.versions[0];
    const hasVersionChanges =
      input.summary !== undefined ||
      input.instructions !== undefined ||
      input.inputSchema !== undefined ||
      input.requiredCapabilities !== undefined ||
      input.permittedToolKeys !== undefined ||
      input.workflowDefinition !== undefined ||
      input.settingsSchema !== undefined;

    return prisma.$transaction(async (tx) => {
      let draftVersion = latest && latest.status === 'DRAFT' ? latest : null;

      if (hasVersionChanges) {
        const merged = {
          summary: (input.summary ?? latest?.summary ?? '').trim(),
          instructions: input.instructions ?? latest?.instructions ?? '',
          inputSchema: toJson(input.inputSchema !== undefined ? input.inputSchema : latest?.inputSchema),
          requiredCapabilities: input.requiredCapabilities ?? latest?.requiredCapabilities ?? [],
          permittedToolKeys: input.permittedToolKeys ?? latest?.permittedToolKeys ?? [],
          workflowDefinition: toJson(input.workflowDefinition !== undefined ? input.workflowDefinition : latest?.workflowDefinition),
          settingsSchema: toJson(input.settingsSchema !== undefined ? input.settingsSchema : latest?.settingsSchema),
        };
        const configHash = hashSkillConfig(merged as any);

        if (draftVersion) {
          draftVersion = await tx.skillVersion.update({
            where: { id: draftVersion.id },
            data: { ...merged, configHash },
          });
        } else {
          draftVersion = await tx.skillVersion.create({
            data: {
              skillId: skill.id,
              versionNumber: (latest?.versionNumber ?? 0) + 1,
              status: 'DRAFT',
              configHash,
              ...merged,
            },
          });
        }
      }

      const updatedSkill = await tx.skill.update({
        where: { id: skill.id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        },
      });

      return { skill: updatedSkill, draftVersion };
    });
  }

  async validateSkill(ctx: WorkspaceContext, skillId: string) {
    const skill = await this.getSkillById(ctx, skillId);
    this.assertCanManage(ctx, skill);

    const target = skill.versions.find((v) => v.status === 'DRAFT') || skill.versions[0];
    if (!target) {
      throw new BadRequestError('No skill version found to validate');
    }

    const errors: string[] = [];
    if (!target.summary || target.summary.trim().length === 0) {
      errors.push('Skill summary is required for progressive loading');
    }
    if (!target.instructions || target.instructions.trim().length === 0) {
      errors.push('Skill instructions cannot be empty');
    }
    if (skill.category === 'WORKFLOW' && !target.workflowDefinition) {
      errors.push('WORKFLOW skill requires a workflowDefinition JSON DAG');
    }

    return {
      valid: errors.length === 0,
      versionId: target.id,
      errors,
    };
  }

  async publishSkill(ctx: WorkspaceContext, skillId: string) {
    const skill = await this.getSkillById(ctx, skillId);
    this.assertCanManage(ctx, skill);

    const validation = await this.validateSkill(ctx, skillId);
    if (!validation.valid) {
      throw new BadRequestError('Skill validation failed', { errors: validation.errors });
    }

    return prisma.$transaction(async (tx) => {
      if (skill.activeVersionId) {
        await tx.skillVersion.updateMany({
          where: { id: skill.activeVersionId, status: 'PUBLISHED' },
          data: { status: 'DEPRECATED' },
        });
      }

      const publishedVersion = await tx.skillVersion.update({
        where: { id: validation.versionId },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          publishedByUserId: ctx.userId,
        },
      });

      const updatedSkill = await tx.skill.update({
        where: { id: skill.id },
        data: { activeVersionId: publishedVersion.id },
      });

      return { skill: updatedSkill, publishedVersion };
    });
  }

  /**
   * Isolated dry-run test of a skill's instructions with no database or external tool side effects.
   */
  async testSkill(ctx: WorkspaceContext, skillId: string, testPrompt: string) {
    const skill = await this.getSkillById(ctx, skillId);
    const version = skill.versions.find((v) => v.id === skill.activeVersionId) || skill.versions[0];
    if (!version) {
      throw new BadRequestError('Skill has no version to test');
    }

    const { model, provider, modelName } = modelFactoryService.createModel({
      temperature: 0.4,
      streaming: false,
    });

    const response = await model.invoke([
      new SystemMessage(`<skill_instructions name="${skill.name}">\n${version.instructions}\n</skill_instructions>`),
      new HumanMessage(testPrompt),
    ]);

    return {
      skillId: skill.id,
      versionId: version.id,
      provider,
      model: modelName,
      output: typeof response.content === 'string' ? response.content : JSON.stringify(response.content),
    };
  }

  async attachToAgent(
    ctx: WorkspaceContext,
    agentId: string,
    skillId: string,
    options?: { priority?: number; settingsOverride?: Record<string, any> }
  ) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError(`Agent '${agentId}' not found in this workspace`);
    }

    const skill = await this.getSkillById(ctx, skillId);
    const pinnedVersionId = skill.activeVersionId || skill.versions[0]?.id || null;

    const existing = await prisma.agentSkill.findFirst({
      where: { agentId, agentVersionId: null, skillId },
    });

    if (existing) {
      return prisma.agentSkill.update({
        where: { id: existing.id },
        data: {
          isEnabled: true,
          skillVersionId: pinnedVersionId,
          ...(options?.priority !== undefined ? { priority: options.priority } : {}),
          ...(options?.settingsOverride !== undefined
            ? { settingsOverride: toJson(options.settingsOverride) }
            : {}),
        },
        include: { skill: true, skillVersion: true },
      });
    }

    return prisma.agentSkill.create({
      data: {
        agentId,
        skillId,
        skillVersionId: pinnedVersionId,
        isEnabled: true,
        priority: options?.priority ?? 0,
        settingsOverride: toJson(options?.settingsOverride ?? null),
      },
      include: { skill: true, skillVersion: true },
    });
  }

  async detachFromAgent(ctx: WorkspaceContext, agentId: string, skillId: string) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError(`Agent '${agentId}' not found in this workspace`);
    }

    await prisma.agentSkill.deleteMany({
      where: { agentId, agentVersionId: null, skillId },
    });

    return { detached: true };
  }
}

export const skillService = new SkillService();
export default skillService;
