import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillService } from '../../src/modules/skills/skill.service';
import { WorkflowSubgraphBuilder } from '../../src/modules/skills/workflow-subgraph.builder';
import prisma from '../../src/lib/prisma';
import { BadRequestError, ForbiddenError } from '../../src/lib/errors';
import { WorkspaceContext } from '../../src/middleware/auth';
import { FakeListChatModel } from '@langchain/core/utils/testing';

vi.mock('../../src/lib/prisma', () => ({
  default: {
    skill: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe('SkillService & WorkflowSubgraphBuilder', () => {
  const userCtx: WorkspaceContext = {
    workspaceId: 'org_1',
    userId: 'user_1',
    orgId: 'org_1',
    orgRole: 'org:member',
    isOrganization: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prevents workspace users from creating or modifying PLATFORM skills', async () => {
    const skillService = new SkillService();

    await expect(
      skillService.createSkill(userCtx, {
        key: 'sys-skill',
        name: 'System',
        scope: 'PLATFORM',
        summary: 's',
        instructions: 'i',
      })
    ).rejects.toThrow(ForbiddenError);

    vi.mocked(prisma.skill.findUnique).mockResolvedValue({
      id: 'skill-plat',
      scope: 'PLATFORM',
      workspaceId: null,
      ownerUserId: 'system',
      versions: [],
    } as any);

    await expect(
      skillService.updateSkill(userCtx, 'skill-plat', { name: 'Tampered' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('validates and compiles declarative JSON DAG workflow into a LangGraph subgraph', async () => {
    const builder = new WorkflowSubgraphBuilder();
    const fakeModel = new FakeListChatModel({ responses: ['Drafted report'] });

    const compiled = builder.compile(
      {
        entryNodeId: 'fetch',
        maxSteps: 5,
        timeoutMs: 30000,
        nodes: [
          { id: 'fetch', type: 'tool', toolKey: 'web_fetch', next: 'summarize' },
          { id: 'summarize', type: 'llm', promptTemplate: 'Summarize: {{input}}', next: 'END' },
        ],
      },
      {
        model: fakeModel as any,
        toolsByKey: new Map([['web_fetch', async () => 'raw article text']]),
      }
    );

    const result = await compiled.invoke({ input: 'AI agents' });
    expect(result.output).toBe('Drafted report');
    expect(result.stepsExecuted).toBe(2);
  });

  it('rejects workflow DAG with unknown edge target', () => {
    const builder = new WorkflowSubgraphBuilder();
    expect(() =>
      builder.validate({
        entryNodeId: 'step1',
        nodes: [{ id: 'step1', type: 'llm', next: 'missing_node' }],
      })
    ).toThrow(BadRequestError);
  });
});
