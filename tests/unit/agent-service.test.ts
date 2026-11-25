import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from '../../src/modules/agents/agent.service';
import prisma from '../../src/lib/prisma';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../src/lib/errors';
import { WorkspaceContext } from '../../src/middleware/auth';

vi.mock('../../src/lib/prisma', () => ({
  default: {
    agent: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    agentVersion: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('AgentService Unit Tests (Step 1)', () => {
  let service: AgentService;

  const ownerCtx: WorkspaceContext = {
    workspaceId: 'org_1',
    userId: 'user_owner',
    orgId: 'org_1',
    orgRole: 'org:admin',
    isOrganization: true,
  };

  const memberCtx: WorkspaceContext = {
    workspaceId: 'org_1',
    userId: 'user_member',
    orgId: 'org_1',
    orgRole: 'org:member',
    isOrganization: true,
  };

  const otherOrgCtx: WorkspaceContext = {
    workspaceId: 'org_2',
    userId: 'user_other',
    orgId: 'org_2',
    orgRole: 'org:admin',
    isOrganization: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentService();
  });

  it('creates an agent with initial DRAFT version v1 inside a transaction', async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        agent: {
          create: vi.fn().mockResolvedValue({
            id: 'agent-1',
            workspaceId: 'org_1',
            ownerUserId: 'user_owner',
            visibility: 'PERSONAL',
            name: 'Support Bot',
            slug: 'support-bot',
          }),
        },
        agentVersion: {
          create: vi.fn().mockResolvedValue({
            id: 'ver-1',
            agentId: 'agent-1',
            versionNumber: 1,
            status: 'DRAFT',
          }),
        },
      };
      return cb(tx);
    });

    const res = await service.createAgent(ownerCtx, {
      name: 'Support Bot',
      systemInstructions: 'Be helpful.',
    });

    expect(res.agent.id).toBe('agent-1');
    expect(res.draftVersion.versionNumber).toBe(1);
    expect(res.draftVersion.status).toBe('DRAFT');
  });

  it('prevents non-owner from reading a PERSONAL agent', async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      id: 'agent-1',
      workspaceId: 'org_1',
      ownerUserId: 'user_owner',
      visibility: 'PERSONAL',
      versions: [],
    } as any);

    await expect(service.getAgentById(memberCtx, 'agent-1')).rejects.toThrow(ForbiddenError);
  });

  it('prevents cross-workspace access', async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      id: 'agent-1',
      workspaceId: 'org_1',
      ownerUserId: 'user_owner',
      visibility: 'WORKSPACE',
      versions: [],
    } as any);

    await expect(service.getAgentById(otherOrgCtx, 'agent-1')).rejects.toThrow(NotFoundError);
  });

  it('prevents org:member from updating or publishing a WORKSPACE agent', async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      id: 'agent-1',
      workspaceId: 'org_1',
      ownerUserId: 'user_owner',
      visibility: 'WORKSPACE',
      versions: [{ id: 'ver-1', versionNumber: 1, status: 'DRAFT', systemInstructions: 'Hi' }],
    } as any);

    await expect(
      service.updateAgent(memberCtx, 'agent-1', { name: 'Hacked' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('prevents rollback to a REVOKED or DRAFT version', async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      id: 'agent-1',
      workspaceId: 'org_1',
      ownerUserId: 'user_owner',
      visibility: 'WORKSPACE',
      versions: [
        { id: 'ver-revoked', versionNumber: 1, status: 'REVOKED' },
        { id: 'ver-draft', versionNumber: 2, status: 'DRAFT' },
      ],
    } as any);

    await expect(service.rollbackAgent(ownerCtx, 'agent-1', 'ver-revoked')).rejects.toThrow(
      BadRequestError
    );
    await expect(service.rollbackAgent(ownerCtx, 'agent-1', 'ver-draft')).rejects.toThrow(
      BadRequestError
    );
  });
});
