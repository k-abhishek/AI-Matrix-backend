-- CreateEnum
CREATE TYPE "AgentVisibility" AS ENUM ('PERSONAL', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AgentVersionStatus" AS ENUM ('DRAFT', 'VALIDATED', 'PUBLISHED', 'DEPRECATED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AgentApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KnowledgeScope" AS ENUM ('PLATFORM', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "KnowledgeBaseStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('CRAWLER_PAGE', 'FILE', 'TEXT');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('INDEXING', 'ACTIVE', 'FAILED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "SkillScope" AS ENUM ('PLATFORM', 'WORKSPACE', 'PERSONAL');

-- CreateEnum
CREATE TYPE "SkillCategory" AS ENUM ('INSTRUCTION', 'TOOL', 'WORKFLOW');

-- CreateEnum
CREATE TYPE "SkillStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SkillVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CapabilityType" AS ENUM ('BUILTIN', 'CONNECTOR', 'MCP');

-- CreateEnum
CREATE TYPE "ConnectionScope" AS ENUM ('WORKSPACE_SHARED', 'USER_DELEGATED');

-- AlterTable
ALTER TABLE "crawlers" ADD COLUMN     "knowledgeBaseId" TEXT,
ADD COLUMN     "scope" "KnowledgeScope" NOT NULL DEFAULT 'WORKSPACE',
ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "visibility" "AgentVisibility" NOT NULL DEFAULT 'PERSONAL',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeVersionId" TEXT,
    "draftConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_versions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "AgentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "configHash" TEXT NOT NULL,
    "systemInstructions" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER,
    "maxIterations" INTEGER NOT NULL DEFAULT 15,
    "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "memoryConfig" JSONB,
    "executionPolicy" JSONB,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_approvals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "agentVersionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "connectionId" TEXT,
    "interruptId" TEXT,
    "parameters" JSONB,
    "status" "AgentApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" TEXT NOT NULL,
    "scope" "KnowledgeScope" NOT NULL DEFAULT 'WORKSPACE',
    "workspaceId" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "qdrantCollection" TEXT NOT NULL,
    "retrievalDefaults" JSONB,
    "status" "KnowledgeBaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "sourceRefId" TEXT,
    "title" TEXT NOT NULL,
    "uri" TEXT,
    "contentHash" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_knowledge_bases" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersionId" TEXT,
    "knowledgeBaseId" TEXT NOT NULL,
    "retrievalConfig" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "scope" "SkillScope" NOT NULL DEFAULT 'PERSONAL',
    "workspaceId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "SkillCategory" NOT NULL DEFAULT 'INSTRUCTION',
    "activeVersionId" TEXT,
    "status" "SkillStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_versions" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "SkillVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "inputSchema" JSONB,
    "requiredCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "permittedToolKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workflowDefinition" JSONB,
    "settingsSchema" JSONB,
    "configHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_skills" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersionId" TEXT,
    "skillId" TEXT NOT NULL,
    "skillVersionId" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "settingsOverride" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tool_grants" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersionId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "capabilityType" "CapabilityType" NOT NULL,
    "toolKey" TEXT NOT NULL,
    "connectionScope" "ConnectionScope" NOT NULL DEFAULT 'WORKSPACE_SHARED',
    "connectionId" TEXT,
    "allowedToolNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "constraints" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tool_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agents_workspaceId_status_idx" ON "agents"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "agents_workspaceId_visibility_ownerUserId_idx" ON "agents"("workspaceId", "visibility", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_workspaceId_slug_key" ON "agents"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "agent_versions_agentId_status_idx" ON "agent_versions"("agentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_versions_agentId_versionNumber_key" ON "agent_versions"("agentId", "versionNumber");

-- CreateIndex
CREATE INDEX "agent_approvals_workspaceId_status_idx" ON "agent_approvals"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "agent_approvals_runId_idx" ON "agent_approvals"("runId");

-- CreateIndex
CREATE INDEX "agent_approvals_conversationId_idx" ON "agent_approvals"("conversationId");

-- CreateIndex
CREATE INDEX "knowledge_bases_scope_status_idx" ON "knowledge_bases"("scope", "status");

-- CreateIndex
CREATE INDEX "knowledge_bases_workspaceId_status_idx" ON "knowledge_bases"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "knowledge_documents_knowledgeBaseId_status_idx" ON "knowledge_documents"("knowledgeBaseId", "status");

-- CreateIndex
CREATE INDEX "knowledge_documents_workspaceId_idx" ON "knowledge_documents"("workspaceId");

-- CreateIndex
CREATE INDEX "agent_knowledge_bases_agentId_idx" ON "agent_knowledge_bases"("agentId");

-- CreateIndex
CREATE INDEX "agent_knowledge_bases_agentVersionId_idx" ON "agent_knowledge_bases"("agentVersionId");

-- CreateIndex
CREATE INDEX "agent_knowledge_bases_knowledgeBaseId_idx" ON "agent_knowledge_bases"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "skills_scope_workspaceId_status_idx" ON "skills"("scope", "workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "skills_scope_workspaceId_key_key" ON "skills"("scope", "workspaceId", "key");

-- CreateIndex
CREATE INDEX "skill_versions_skillId_status_idx" ON "skill_versions"("skillId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "skill_versions_skillId_versionNumber_key" ON "skill_versions"("skillId", "versionNumber");

-- CreateIndex
CREATE INDEX "agent_skills_agentId_idx" ON "agent_skills"("agentId");

-- CreateIndex
CREATE INDEX "agent_skills_agentVersionId_idx" ON "agent_skills"("agentVersionId");

-- CreateIndex
CREATE INDEX "agent_skills_skillId_idx" ON "agent_skills"("skillId");

-- CreateIndex
CREATE INDEX "agent_tool_grants_agentId_workspaceId_idx" ON "agent_tool_grants"("agentId", "workspaceId");

-- CreateIndex
CREATE INDEX "agent_tool_grants_agentVersionId_idx" ON "agent_tool_grants"("agentVersionId");

-- CreateIndex
CREATE INDEX "crawlers_workspaceId_idx" ON "crawlers"("workspaceId");

-- CreateIndex
CREATE INDEX "crawlers_knowledgeBaseId_idx" ON "crawlers"("knowledgeBaseId");

-- AddForeignKey
ALTER TABLE "crawlers" ADD CONSTRAINT "crawlers_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "agent_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "agent_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "agent_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_grants" ADD CONSTRAINT "agent_tool_grants_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_grants" ADD CONSTRAINT "agent_tool_grants_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "agent_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
