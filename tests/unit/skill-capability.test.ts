import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillService } from '../../src/modules/skills/skill.service';
import { CapabilityResolverService } from '../../src/modules/capabilities/capability-resolver.service';
import prisma from '../../src/lib/prisma';
import { ForbiddenError } from '../../src/lib/errors';

vi.mock('../../src/lib/prisma', () => ({
  default: {
    skill: {
      findUnique: vi.fn(),
    },
    agentToolGrant: {
      findMany: vi.fn(),
    },
    connectorConnection: {
      findFirst: vi.fn(),
    },
  },
}));

describe('Skill Registry & Dual OAuth Scope Tests (Steps 5-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks workspace users from modifying PLATFORM skills', async () => {
    const skillSvc = new SkillService();
    vi.mocked(prisma.skill.findUnique).mockResolvedValue({
      id: 'skill-plat',
      scope: 'PLATFORM',
      workspaceId: null,
      ownerUserId: 'system',
      versions: [],
    } as any);

    await expect(
      skillSvc.updateSkill(
        {
          workspaceId: 'org_1',
          userId: 'user_1',
          orgId: 'org_1',
          orgRole: 'org:admin',
          isOrganization: true,
        },
        'skill-plat',
        { name: 'Tampered' }
      )
    ).rejects.toThrow(ForbiddenError);
  });

  it('returns CONNECTION_REQUIRED when USER_DELEGATED connection is missing for invoking user', async () => {
    const resolver = new CapabilityResolverService();
    vi.mocked(prisma.agentToolGrant.findMany).mockResolvedValue([
      {
        id: 'grant-1',
        agentId: 'agent-1',
        workspaceId: 'org_1',
        capabilityType: 'CONNECTOR',
        toolKey: 'gmail',
        connectionScope: 'USER_DELEGATED',
        connectionId: null,
        allowedToolNames: ['send_email'],
        requiresApproval: true,
        isEnabled: true,
      },
    ] as any);
    vi.mocked(prisma.connectorConnection.findFirst).mockResolvedValue(null);

    const res = await resolver.resolveAgentGrants(
      {
        workspaceId: 'org_1',
        userId: 'user_invoker',
        orgId: 'org_1',
        orgRole: 'org:member',
        isOrganization: true,
      },
      'agent-1',
      null
    );

    expect(res.tools).toHaveLength(0);
    expect(res.connectionErrors).toHaveLength(1);
    expect(res.connectionErrors[0].code).toBe('CONNECTION_REQUIRED');
    expect(res.connectionErrors[0].connectionScope).toBe('USER_DELEGATED');
  });
});
