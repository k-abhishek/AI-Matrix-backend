-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('NATIVE', 'MCP', 'CUSTOM_REST');

-- CreateEnum
CREATE TYPE "ConnectionAuthType" AS ENUM ('NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC_AUTH', 'OAUTH2_AUTHORIZATION_CODE', 'OAUTH2_CLIENT_CREDENTIALS', 'CUSTOM_HEADERS');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('INITIALIZING', 'CONNECTED', 'DISCONNECTED', 'ERROR', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "McpTransportType" AS ENUM ('STREAMABLE_HTTP', 'LEGACY_HTTP_SSE', 'STDIO_ISOLATED');

-- CreateEnum
CREATE TYPE "ToolExecutionStatus" AS ENUM ('SUCCESS', 'FAILED', 'TIMED_OUT', 'PERMISSION_DENIED', 'APPROVAL_REQUIRED');

-- CreateTable
CREATE TABLE "connector_definitions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "supportedAuth" "ConnectionAuthType"[],
    "iconUrl" TEXT,
    "docUrl" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "defaultConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_connections" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectorDefinitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'INITIALIZING',
    "authType" "ConnectionAuthType" NOT NULL,
    "baseUrl" TEXT,
    "mcpTransport" "McpTransportType",
    "config" JSONB,
    "lastConnectedAt" TIMESTAMP(3),
    "lastTestedAt" TIMESTAMP(3),
    "lastDiscoveredAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_credentials" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyId" TEXT NOT NULL DEFAULT 'v1',
    "expiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "tokenType" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_tools" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB,
    "schemaHash" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "rateLimitPerMin" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_resources" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mimeType" TEXT,
    "isIndexed" BOOLEAN NOT NULL DEFAULT false,
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_prompts" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "arguments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_permissions" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT,
    "userId" TEXT,
    "canExecute" BOOLEAN NOT NULL DEFAULT true,
    "canManage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_connector_bindings" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "allowedToolNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_connector_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_transactions" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT,
    "redirectUri" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_audit_logs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connector_definitions_key_key" ON "connector_definitions"("key");

-- CreateIndex
CREATE INDEX "connector_connections_workspaceId_idx" ON "connector_connections"("workspaceId");

-- CreateIndex
CREATE INDEX "connector_connections_userId_idx" ON "connector_connections"("userId");

-- CreateIndex
CREATE INDEX "connector_connections_connectorDefinitionId_idx" ON "connector_connections"("connectorDefinitionId");

-- CreateIndex
CREATE INDEX "connector_connections_status_idx" ON "connector_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "connector_credentials_connectionId_key" ON "connector_credentials"("connectionId");

-- CreateIndex
CREATE INDEX "connector_credentials_expiresAt_idx" ON "connector_credentials"("expiresAt");

-- CreateIndex
CREATE INDEX "connector_tools_connectionId_idx" ON "connector_tools"("connectionId");

-- CreateIndex
CREATE INDEX "connector_tools_isEnabled_idx" ON "connector_tools"("isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "connector_tools_connectionId_name_key" ON "connector_tools"("connectionId", "name");

-- CreateIndex
CREATE INDEX "connector_resources_connectionId_idx" ON "connector_resources"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "connector_resources_connectionId_uri_key" ON "connector_resources"("connectionId", "uri");

-- CreateIndex
CREATE INDEX "connector_prompts_connectionId_idx" ON "connector_prompts"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "connector_prompts_connectionId_name_key" ON "connector_prompts"("connectionId", "name");

-- CreateIndex
CREATE INDEX "connector_permissions_workspaceId_idx" ON "connector_permissions"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "connector_permissions_connectionId_workspaceId_userId_key" ON "connector_permissions"("connectionId", "workspaceId", "userId");

-- CreateIndex
CREATE INDEX "agent_connector_bindings_agentId_idx" ON "agent_connector_bindings"("agentId");

-- CreateIndex
CREATE INDEX "agent_connector_bindings_workspaceId_idx" ON "agent_connector_bindings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_connector_bindings_agentId_connectionId_key" ON "agent_connector_bindings"("agentId", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_transactions_state_key" ON "oauth_transactions"("state");

-- CreateIndex
CREATE INDEX "oauth_transactions_state_idx" ON "oauth_transactions"("state");

-- CreateIndex
CREATE INDEX "oauth_transactions_expiresAt_idx" ON "oauth_transactions"("expiresAt");

-- CreateIndex
CREATE INDEX "connector_audit_logs_workspaceId_idx" ON "connector_audit_logs"("workspaceId");

-- CreateIndex
CREATE INDEX "connector_audit_logs_connectionId_idx" ON "connector_audit_logs"("connectionId");

-- CreateIndex
CREATE INDEX "connector_audit_logs_createdAt_idx" ON "connector_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "connector_connections" ADD CONSTRAINT "connector_connections_connectorDefinitionId_fkey" FOREIGN KEY ("connectorDefinitionId") REFERENCES "connector_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_credentials" ADD CONSTRAINT "connector_credentials_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connector_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_tools" ADD CONSTRAINT "connector_tools_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connector_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_resources" ADD CONSTRAINT "connector_resources_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connector_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_prompts" ADD CONSTRAINT "connector_prompts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connector_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_permissions" ADD CONSTRAINT "connector_permissions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connector_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connector_bindings" ADD CONSTRAINT "agent_connector_bindings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connector_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_transactions" ADD CONSTRAINT "oauth_transactions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connector_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
