import crypto from 'crypto';
import prisma from '../src/lib/prisma';
import { connectMongoDB, disconnectMongoDB } from '../src/lib/mongoose';
import logger from '../src/lib/logger';
import legalIngestionService from '../src/modules/legal-research/ingestion/legal-ingestion.service';
import { INDIAN_LEGAL_BOOTSTRAP_DOCUMENTS } from '../src/modules/legal-research/ingestion/legal-bootstrap.data';

const SYSTEM_LEGAL_AGENT_ID = '00000000-0000-4000-8000-000000000101';
const PLATFORM_LEGAL_KB_ID = '00000000-0000-4000-8000-000000000201';

const LEGAL_BUILTIN_TOOLS: Array<{ toolKey: string; description: string }> = [
  {
    toolKey: 'indian_legal_research',
    description:
      'Specialized Indian Legal Research Agent workflow (classification, hybrid retrieval, canonical hydration, temporal/jurisdictional analysis, and citation validation).',
  },
  {
    toolKey: 'search_legal_knowledge',
    description: 'Hybrid search across the Indian Legal Knowledge Base returning canonical identifiers and metadata.',
  },
  {
    toolKey: 'get_legal_provision',
    description: 'Retrieve exact canonical statutory text and version metadata from PostgreSQL.',
  },
  {
    toolKey: 'get_legal_document',
    description: 'Retrieve canonical legal document metadata and version structure.',
  },
  {
    toolKey: 'get_provision_history',
    description: 'Retrieve historical versions and amendment history for a statutory provision.',
  },
  {
    toolKey: 'get_related_legal_authorities',
    description: 'Retrieve related provisions, judgments, regulatory documents, and cross-references.',
  },
  {
    toolKey: 'search_case_law',
    description: 'Search indexed Supreme Court, High Court, and Tribunal judgments.',
  },
  {
    toolKey: 'verify_legal_citation',
    description: 'Verify that a cited statutory provision or judicial decision exists in canonical storage.',
  },
  {
    toolKey: 'assess_legal_applicability',
    description: 'Assess temporal and jurisdictional applicability of canonical evidence against stated facts.',
  },
];

async function ensureLegalKnowledgeBaseAndToolGrants(agentId: string) {
  const kb = await prisma.knowledgeBase.upsert({
    where: { id: PLATFORM_LEGAL_KB_ID },
    update: {
      name: 'Indian Legal Knowledge Base',
      description:
        'Canonical Indian statutory, constitutional, regulatory, and judicial knowledge base (PostgreSQL + MongoDB canonical storage, Qdrant retrieval index).',
      qdrantCollection: 'legal_knowledge_base',
      retrievalDefaults: { topK: 10, scoreThreshold: 0.35 },
      status: 'ACTIVE',
    },
    create: {
      id: PLATFORM_LEGAL_KB_ID,
      scope: 'PLATFORM',
      workspaceId: null,
      ownerUserId: 'system',
      name: 'Indian Legal Knowledge Base',
      description:
        'Canonical Indian statutory, constitutional, regulatory, and judicial knowledge base (PostgreSQL + MongoDB canonical storage, Qdrant retrieval index).',
      qdrantCollection: 'legal_knowledge_base',
      retrievalDefaults: { topK: 10, scoreThreshold: 0.35 },
      status: 'ACTIVE',
    },
  });

  const existingLink = await prisma.agentKnowledgeBase.findFirst({
    where: {
      agentId,
      agentVersionId: null,
      knowledgeBaseId: kb.id,
    },
  });

  if (!existingLink) {
    await prisma.agentKnowledgeBase.create({
      data: {
        agentId,
        knowledgeBaseId: kb.id,
        retrievalConfig: { topK: 10, scoreThreshold: 0.35 },
        isEnabled: true,
      },
    });
  } else {
    await prisma.agentKnowledgeBase.update({
      where: { id: existingLink.id },
      data: {
        retrievalConfig: { topK: 10, scoreThreshold: 0.35 },
        isEnabled: true,
      },
    });
  }

  for (const t of LEGAL_BUILTIN_TOOLS) {
    const existingGrant = await prisma.agentToolGrant.findFirst({
      where: {
        agentId,
        toolKey: t.toolKey,
      },
    });

    if (existingGrant) {
      await prisma.agentToolGrant.update({
        where: { id: existingGrant.id },
        data: {
          isEnabled: true,
          allowedToolNames: [t.toolKey],
          constraints: { description: t.description, category: 'INDIAN_LEGAL_RESEARCH' },
        },
      });
    } else {
      await prisma.agentToolGrant.create({
        data: {
          agentId,
          workspaceId: 'platform',
          capabilityType: 'BUILTIN',
          toolKey: t.toolKey,
          connectionScope: 'WORKSPACE_SHARED',
          allowedToolNames: [t.toolKey],
          requiresApproval: false,
          isEnabled: true,
          constraints: { description: t.description, category: 'INDIAN_LEGAL_RESEARCH' },
        },
      });
    }
  }

  logger.info(
    `[KB & TOOLS] Linked KnowledgeBase '${kb.name}' (${kb.id}) and ${LEGAL_BUILTIN_TOOLS.length} BUILTIN tool grants to agent ${agentId}`
  );

  const legalSkills = [
    {
      key: 'indian-statutory-research',
      name: 'Indian Statutory Research',
      description: 'Canonical lookup and hybrid retrieval across Indian Constitution, Central/State Acts, Rules, and Regulations.',
      category: 'TOOL' as const,
      summary: 'Search and retrieve exact canonical Indian statutory provisions from PostgreSQL.',
      instructions:
        'Use indian_legal_research, search_legal_knowledge, get_legal_provision, and get_legal_document to retrieve verified statutory text from canonical storage. Never invent or paraphrase statutory wording.',
      permittedToolKeys: [
        'indian_legal_research',
        'search_legal_knowledge',
        'get_legal_provision',
        'get_legal_document',
      ],
      priority: 1,
    },
    {
      key: 'temporal-jurisdictional-analysis',
      name: 'Temporal & Jurisdictional Analysis',
      description: 'Determine IPC vs BNS, CrPC vs BNSS, IEA vs BSA cutoffs (1 July 2024) and Central vs State applicability.',
      category: 'INSTRUCTION' as const,
      summary: 'Assess event-date statutory regime and state-level jurisdiction.',
      instructions:
        'Always check eventDate before applying criminal or amended statutes (pre-1 July 2024: IPC/CrPC/IEA; on/after 1 July 2024: BNS/BNSS/BSA). Identify Central vs State laws and flag missing state/date facts.',
      permittedToolKeys: ['get_provision_history', 'assess_legal_applicability'],
      priority: 2,
    },
    {
      key: 'legal-citation-verification',
      name: 'Legal Citation & Precedent Verification',
      description: 'Verify statutory and judicial citations against canonical records before presenting findings.',
      category: 'INSTRUCTION' as const,
      summary: 'Validate all statutory and case law citations against canonical database records.',
      instructions:
        'Use verify_legal_citation, search_case_law, and get_related_legal_authorities to confirm every cited Act, Section, Article, and judgment exists in canonical storage.',
      permittedToolKeys: [
        'verify_legal_citation',
        'search_case_law',
        'get_related_legal_authorities',
      ],
      priority: 3,
    },
  ];

  for (const sk of legalSkills) {
    const configHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ key: sk.key, instructions: sk.instructions }))
      .digest('hex');

    let skill = await prisma.skill.findFirst({
      where: {
        scope: 'PLATFORM',
        workspaceId: null,
        key: sk.key,
      },
    });

    if (!skill) {
      skill = await prisma.skill.create({
        data: {
          scope: 'PLATFORM',
          workspaceId: null,
          createdByUserId: 'system',
          ownerUserId: 'system',
          key: sk.key,
          name: sk.name,
          description: sk.description,
          category: sk.category,
          status: 'ACTIVE',
        },
      });
    }

    let skillVersion = await prisma.skillVersion.findFirst({
      where: { skillId: skill.id, versionNumber: 1 },
    });

    if (!skillVersion) {
      skillVersion = await prisma.skillVersion.create({
        data: {
          skillId: skill.id,
          versionNumber: 1,
          status: 'PUBLISHED',
          summary: sk.summary,
          instructions: sk.instructions,
          requiredCapabilities: sk.permittedToolKeys,
          permittedToolKeys: sk.permittedToolKeys,
          configHash,
          publishedAt: new Date(),
          publishedByUserId: 'system',
        },
      });
    } else {
      skillVersion = await prisma.skillVersion.update({
        where: { id: skillVersion.id },
        data: {
          status: 'PUBLISHED',
          summary: sk.summary,
          instructions: sk.instructions,
          requiredCapabilities: sk.permittedToolKeys,
          permittedToolKeys: sk.permittedToolKeys,
          configHash,
        },
      });
    }

    await prisma.skill.update({
      where: { id: skill.id },
      data: { activeVersionId: skillVersion.id },
    });

    const existingAgentSkill = await prisma.agentSkill.findFirst({
      where: { agentId, agentVersionId: null, skillId: skill.id },
    });

    if (!existingAgentSkill) {
      await prisma.agentSkill.create({
        data: {
          agentId,
          skillId: skill.id,
          skillVersionId: skillVersion.id,
          isEnabled: true,
          priority: sk.priority,
        },
      });
    } else {
      await prisma.agentSkill.update({
        where: { id: existingAgentSkill.id },
        data: {
          skillVersionId: skillVersion.id,
          isEnabled: true,
          priority: sk.priority,
        },
      });
    }
  }

  logger.info(`[SKILLS] Linked ${legalSkills.length} PLATFORM skills to agent ${agentId}`);
}

async function ensureSystemLegalAgent() {
  const systemInstructions =
    'You are the Indian Legal Research Agent. Use the indian_legal_research tool to query the canonical Indian Legal Knowledge Base, verify statutory provisions, assess temporal applicability (e.g., IPC vs BNS before/after 1 July 2024) and state jurisdiction, and validate citations. Always present your final response to the user in clear, conversational Markdown with headings, bullet points, verified citations, and a clean "**Disclaimer:** ..." note (do not wrap paragraphs in "***" or add trailing asterisks). NEVER output raw JSON or wrap your answer in a ```json code block. Never fabricate citations or legal text.';

  const configHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ slug: 'indian-legal-research', systemInstructions }))
    .digest('hex');

  const existing = await prisma.agent.findUnique({
    where: {
      workspaceId_slug: {
        workspaceId: 'platform',
        slug: 'indian-legal-research',
      },
    },
    include: { versions: { orderBy: { versionNumber: 'desc' } } },
  });

  if (existing) {
    await prisma.agent.update({
      where: { id: existing.id },
      data: {
        isSystem: true,
        visibility: 'WORKSPACE',
        status: 'ACTIVE',
      },
    });

    if (existing.activeVersionId) {
      await prisma.agentVersion.update({
        where: { id: existing.activeVersionId },
        data: { systemInstructions, configHash },
      });
    }

    const existingGrant = await prisma.agentToolGrant.findFirst({
      where: {
        agentId: existing.id,
        toolKey: 'indian_legal_research',
      },
    });
    if (!existingGrant) {
      await prisma.agentToolGrant.create({
        data: {
          agentId: existing.id,
          workspaceId: 'platform',
          capabilityType: 'BUILTIN',
          toolKey: 'indian_legal_research',
          connectionScope: 'WORKSPACE_SHARED',
          isEnabled: true,
        },
      });
    }

    logger.info(`[AGENT] System agent 'Indian Legal Research Agent' verified (id=${existing.id})`);
    await ensureLegalKnowledgeBaseAndToolGrants(existing.id);
    return existing.id;
  }

  const created = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        id: SYSTEM_LEGAL_AGENT_ID,
        workspaceId: 'platform',
        createdByUserId: 'system',
        ownerUserId: 'system',
        visibility: 'WORKSPACE',
        name: 'Indian Legal Research Agent',
        description:
          'Specialized Indian legal research agent backed by canonical statutory provisions, temporal/jurisdictional analysis, and citation validation.',
        slug: 'indian-legal-research',
        isSystem: true,
        status: 'ACTIVE',
      },
    });

    const version = await tx.agentVersion.create({
      data: {
        agentId: agent.id,
        versionNumber: 1,
        status: 'PUBLISHED',
        configHash,
        systemInstructions,
        temperature: 0.1,
        maxIterations: 15,
        timeoutMs: 60000,
        publishedAt: new Date(),
        publishedByUserId: 'system',
      },
    });

    await tx.agent.update({
      where: { id: agent.id },
      data: { activeVersionId: version.id },
    });

    await tx.agentToolGrant.create({
      data: {
        agentId: agent.id,
        workspaceId: 'platform',
        capabilityType: 'BUILTIN',
        toolKey: 'indian_legal_research',
        connectionScope: 'WORKSPACE_SHARED',
        isEnabled: true,
      },
    });

    return agent;
  });

  logger.info(`[AGENT] Created system agent 'Indian Legal Research Agent' (id=${created.id})`);
  await ensureLegalKnowledgeBaseAndToolGrants(created.id);
  return created.id;
}

async function main() {
  logger.info('Starting Indian Legal Knowledge Base bootstrap ingestion...');
  await connectMongoDB().catch((err: any) => {
    logger.warn(`MongoDB unavailable during CLI ingestion, continuing with PostgreSQL/Qdrant: ${err.message}`);
  });

  await ensureSystemLegalAgent();

  let ingested = 0;
  let skipped = 0;

  for (const doc of INDIAN_LEGAL_BOOTSTRAP_DOCUMENTS) {
    const res = await legalIngestionService.ingestDocument(doc);
    if (res.skipped) {
      skipped += 1;
      logger.info(`[SKIPPED] ${doc.title} (unchanged)`);
    } else {
      ingested += 1;
      logger.info(
        `[INGESTED] ${doc.title} -> docId=${res.documentId}, provisions=${res.provisionsCount}, chunks=${res.indexedChunksCount}`
      );
    }
  }

  logger.info(`Legal KB bootstrap complete. Ingested=${ingested}, Skipped=${skipped}`);
}

main()
  .catch((err) => {
    logger.error('Legal KB bootstrap failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await disconnectMongoDB().catch(() => {});
  });
