import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityResolverService } from '../../src/modules/capabilities/capability-resolver.service';
import prisma from '../../src/lib/prisma';
import { WorkspaceContext } from '../../src/middleware/auth';

vi.mock('../../src/lib/prisma', () => ({
  default: {
    agentToolGrant: {
      findMany: vi.fn(),
    },
    connectorConnection: {
      findFirst: vi.fn(),
    },
  },
}));

describe('CapabilityResolverService (Dual OAuth Scopes)', () => {
  let resolver: CapabilityResolverService;

  const ctx: WorkspaceContext = {
    workspaceId: 'org_1',
    userId: 'user_alice',
    orgId: 'org_1',
    orgRole: 'org:member',
    isOrganization: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resolver = new CapabilityResolverService();
  });

  it('returns CONNECTION_REQUIRED for USER_DELEGATED when invoking user has no personal connection', async () => {
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

    const res = await resolver.resolveAgentGrants(ctx, 'agent-1', null);
    expect(res.tools).toEqual([]);
    expect(res.connectionErrors).toHaveLength(1);
    expect(res.connectionErrors[0].code).toBe('CONNECTION_REQUIRED');
    expect(res.connectionErrors[0].connectionScope).toBe('USER_DELEGATED');
    expect(prisma.connectorConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'org_1',
          userId: 'user_alice',
        }),
      })
    );
  });

  it('resolves WORKSPACE_SHARED tools and marks approval requirement', async () => {
    vi.mocked(prisma.agentToolGrant.findMany).mockResolvedValue([
      {
        id: 'grant-2',
        agentId: 'agent-1',
        workspaceId: 'org_1',
        capabilityType: 'CONNECTOR',
        toolKey: 'slack',
        connectionScope: 'WORKSPACE_SHARED',
        connectionId: 'conn-ws-slack',
        allowedToolNames: ['post_message'],
        requiresApproval: true,
        isEnabled: true,
      },
    ] as any);

    vi.mocked(prisma.connectorConnection.findFirst).mockResolvedValue({
      id: 'conn-ws-slack',
      name: 'Workspace Slack',
      status: 'CONNECTED',
      tools: [
        {
          name: 'post_message',
          displayName: 'Post Message',
          description: 'Post to Slack',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          requiresApproval: false,
        },
      ],
    } as any);

    const res = await resolver.resolveAgentGrants(ctx, 'agent-1', null);
    expect(res.connectionErrors).toEqual([]);
    expect(res.tools).toHaveLength(1);
    expect(res.tools[0].toolKey).toBe('slack_post_message');
    expect(res.tools[0].requiresApproval).toBe(true);
    expect(res.tools[0].connectionScope).toBe('WORKSPACE_SHARED');
  });
});
