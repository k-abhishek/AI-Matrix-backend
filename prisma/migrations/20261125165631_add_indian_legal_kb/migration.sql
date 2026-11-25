-- CreateEnum
CREATE TYPE "LegalDomain" AS ENUM ('CONSTITUTIONAL', 'CRIMINAL', 'CIVIL', 'CORPORATE_COMMERCIAL', 'LABOUR_EMPLOYMENT', 'FAMILY', 'TAXATION', 'CONSUMER_PROTECTION', 'PROPERTY_REAL_ESTATE', 'CYBER_TECHNOLOGY', 'BANKING_FINANCIAL', 'ADMINISTRATIVE_REGULATORY', 'INTELLECTUAL_PROPERTY', 'ENVIRONMENTAL', 'STATE_LEGISLATION');

-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('CONSTITUTION', 'CENTRAL_ACT', 'STATE_ACT', 'AMENDMENT_ACT', 'RULE', 'REGULATION', 'NOTIFICATION', 'CIRCULAR', 'ORDINANCE', 'SUPREME_COURT_JUDGMENT', 'HIGH_COURT_JUDGMENT', 'TRIBUNAL_DECISION');

-- CreateEnum
CREATE TYPE "LegalAuthorityTier" AS ENUM ('PRIMARY_LEGISLATION', 'OFFICIAL_AMENDMENT', 'OFFICIAL_NOTIFICATION', 'BINDING_JUDICIAL', 'PERSUASIVE_JUDICIAL', 'SECONDARY_COMMENTARY', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "LegalVerificationStatus" AS ENUM ('VERIFIED', 'PENDING_REVIEW', 'DISPUTED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "LegalProvisionType" AS ENUM ('PART', 'CHAPTER', 'SECTION', 'ARTICLE', 'REGULATION', 'RULE', 'SUBSECTION', 'CLAUSE', 'SUB_CLAUSE', 'PROVISO', 'EXPLANATION', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "LegalProvisionStatus" AS ENUM ('ACTIVE', 'AMENDED', 'REPEALED', 'SUPERSEDED', 'PARTIAL_COMMENCEMENT');

-- CreateEnum
CREATE TYPE "LegalPrecedentWeight" AS ENUM ('BINDING', 'PERSUASIVE', 'OVERRULED', 'DISTINGUISHED');

-- CreateEnum
CREATE TYPE "LegalRelationshipType" AS ENUM ('AMENDS', 'REPEALS', 'SAVES', 'INTERPRETS', 'OVERRULES', 'DISTINGUISHES', 'CROSS_REFERENCES', 'SUPPLEMENTS');

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "legal_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authorityTier" "LegalAuthorityTier" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "description" TEXT,
    "verificationStatus" "LegalVerificationStatus" NOT NULL DEFAULT 'VERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortTitle" TEXT,
    "documentType" "LegalDocumentType" NOT NULL,
    "legalDomain" "LegalDomain" NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'IN',
    "state" TEXT,
    "actNumber" TEXT,
    "enactmentDate" TIMESTAMP(3),
    "commencementDate" TIMESTAMP(3),
    "repealedDate" TIMESTAMP(3),
    "status" "LegalProvisionStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "verificationStatus" "LegalVerificationStatus" NOT NULL DEFAULT 'VERIFIED',
    "contentHash" TEXT NOT NULL,
    "rawMongoId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_document_versions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "amendmentNote" TEXT,
    "contentHash" TEXT NOT NULL,
    "rawMongoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_provisions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "parentId" TEXT,
    "provisionType" "LegalProvisionType" NOT NULL,
    "provisionNumber" TEXT NOT NULL,
    "heading" TEXT,
    "hierarchyPath" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_provisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_provision_versions" (
    "id" TEXT NOT NULL,
    "provisionId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "exactText" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" "LegalProvisionStatus" NOT NULL DEFAULT 'ACTIVE',
    "commencementUncertain" BOOLEAN NOT NULL DEFAULT false,
    "uncertaintyNote" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_provision_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_provision_chunks" (
    "id" TEXT NOT NULL,
    "provisionVersionId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "qdrantPointId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_provision_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_amendments" (
    "id" TEXT NOT NULL,
    "amendingDocumentId" TEXT NOT NULL,
    "targetDocumentId" TEXT NOT NULL,
    "targetProvisionId" TEXT,
    "amendmentType" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_judgments" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "caseName" TEXT NOT NULL,
    "court" TEXT NOT NULL,
    "caseNumber" TEXT,
    "judgmentDate" TIMESTAMP(3) NOT NULL,
    "citation" TEXT,
    "bench" TEXT,
    "precedentWeight" "LegalPrecedentWeight" NOT NULL DEFAULT 'BINDING',
    "paragraphCount" INTEGER,
    "sourceUrl" TEXT NOT NULL,
    "verificationStatus" "LegalVerificationStatus" NOT NULL DEFAULT 'VERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_judgments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_citations" (
    "id" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "targetDocumentId" TEXT,
    "targetProvisionId" TEXT,
    "targetJudgmentId" TEXT,
    "paragraphRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "citationText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_relationships" (
    "id" TEXT NOT NULL,
    "fromDocumentId" TEXT NOT NULL,
    "toDocumentId" TEXT NOT NULL,
    "fromProvisionId" TEXT,
    "toProvisionId" TEXT,
    "relationshipType" "LegalRelationshipType" NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_sources_name_key" ON "legal_sources"("name");

-- CreateIndex
CREATE INDEX "legal_sources_authorityTier_idx" ON "legal_sources"("authorityTier");

-- CreateIndex
CREATE INDEX "legal_documents_legalDomain_jurisdiction_state_idx" ON "legal_documents"("legalDomain", "jurisdiction", "state");

-- CreateIndex
CREATE INDEX "legal_documents_documentType_status_idx" ON "legal_documents"("documentType", "status");

-- CreateIndex
CREATE INDEX "legal_documents_shortTitle_idx" ON "legal_documents"("shortTitle");

-- CreateIndex
CREATE INDEX "legal_documents_actNumber_idx" ON "legal_documents"("actNumber");

-- CreateIndex
CREATE INDEX "legal_document_versions_documentId_isCurrent_idx" ON "legal_document_versions"("documentId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_versions_documentId_versionNumber_key" ON "legal_document_versions"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "legal_provisions_documentId_provisionNumber_idx" ON "legal_provisions"("documentId", "provisionNumber");

-- CreateIndex
CREATE INDEX "legal_provisions_parentId_idx" ON "legal_provisions"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "legal_provisions_documentId_hierarchyPath_key" ON "legal_provisions"("documentId", "hierarchyPath");

-- CreateIndex
CREATE INDEX "legal_provision_versions_provisionId_isCurrent_idx" ON "legal_provision_versions"("provisionId", "isCurrent");

-- CreateIndex
CREATE INDEX "legal_provision_versions_effectiveFrom_effectiveUntil_idx" ON "legal_provision_versions"("effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE INDEX "legal_provision_versions_status_idx" ON "legal_provision_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_provision_versions_provisionId_documentVersionId_key" ON "legal_provision_versions"("provisionId", "documentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "legal_provision_chunks_qdrantPointId_key" ON "legal_provision_chunks"("qdrantPointId");

-- CreateIndex
CREATE INDEX "legal_provision_chunks_provisionVersionId_idx" ON "legal_provision_chunks"("provisionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "legal_provision_chunks_provisionVersionId_chunkIndex_key" ON "legal_provision_chunks"("provisionVersionId", "chunkIndex");

-- CreateIndex
CREATE INDEX "legal_amendments_targetDocumentId_idx" ON "legal_amendments"("targetDocumentId");

-- CreateIndex
CREATE INDEX "legal_amendments_targetProvisionId_idx" ON "legal_amendments"("targetProvisionId");

-- CreateIndex
CREATE UNIQUE INDEX "legal_judgments_documentId_key" ON "legal_judgments"("documentId");

-- CreateIndex
CREATE INDEX "legal_judgments_court_judgmentDate_idx" ON "legal_judgments"("court", "judgmentDate");

-- CreateIndex
CREATE INDEX "legal_judgments_citation_idx" ON "legal_judgments"("citation");

-- CreateIndex
CREATE INDEX "legal_judgments_caseName_idx" ON "legal_judgments"("caseName");

-- CreateIndex
CREATE INDEX "legal_citations_sourceDocumentId_idx" ON "legal_citations"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "legal_citations_targetProvisionId_idx" ON "legal_citations"("targetProvisionId");

-- CreateIndex
CREATE INDEX "legal_citations_targetJudgmentId_idx" ON "legal_citations"("targetJudgmentId");

-- CreateIndex
CREATE INDEX "legal_relationships_fromDocumentId_relationshipType_idx" ON "legal_relationships"("fromDocumentId", "relationshipType");

-- CreateIndex
CREATE INDEX "legal_relationships_toDocumentId_relationshipType_idx" ON "legal_relationships"("toDocumentId", "relationshipType");

-- CreateIndex
CREATE INDEX "legal_relationships_fromProvisionId_idx" ON "legal_relationships"("fromProvisionId");

-- CreateIndex
CREATE INDEX "legal_relationships_toProvisionId_idx" ON "legal_relationships"("toProvisionId");

-- AddForeignKey
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "legal_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_provisions" ADD CONSTRAINT "legal_provisions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_provisions" ADD CONSTRAINT "legal_provisions_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "legal_provisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_provision_versions" ADD CONSTRAINT "legal_provision_versions_provisionId_fkey" FOREIGN KEY ("provisionId") REFERENCES "legal_provisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_provision_versions" ADD CONSTRAINT "legal_provision_versions_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "legal_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_provision_chunks" ADD CONSTRAINT "legal_provision_chunks_provisionVersionId_fkey" FOREIGN KEY ("provisionVersionId") REFERENCES "legal_provision_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_amendments" ADD CONSTRAINT "legal_amendments_amendingDocumentId_fkey" FOREIGN KEY ("amendingDocumentId") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_amendments" ADD CONSTRAINT "legal_amendments_targetDocumentId_fkey" FOREIGN KEY ("targetDocumentId") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_amendments" ADD CONSTRAINT "legal_amendments_targetProvisionId_fkey" FOREIGN KEY ("targetProvisionId") REFERENCES "legal_provisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_judgments" ADD CONSTRAINT "legal_judgments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_citations" ADD CONSTRAINT "legal_citations_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_citations" ADD CONSTRAINT "legal_citations_targetDocumentId_fkey" FOREIGN KEY ("targetDocumentId") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_citations" ADD CONSTRAINT "legal_citations_targetProvisionId_fkey" FOREIGN KEY ("targetProvisionId") REFERENCES "legal_provisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_citations" ADD CONSTRAINT "legal_citations_targetJudgmentId_fkey" FOREIGN KEY ("targetJudgmentId") REFERENCES "legal_judgments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_relationships" ADD CONSTRAINT "legal_relationships_fromDocumentId_fkey" FOREIGN KEY ("fromDocumentId") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_relationships" ADD CONSTRAINT "legal_relationships_toDocumentId_fkey" FOREIGN KEY ("toDocumentId") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_relationships" ADD CONSTRAINT "legal_relationships_fromProvisionId_fkey" FOREIGN KEY ("fromProvisionId") REFERENCES "legal_provisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_relationships" ADD CONSTRAINT "legal_relationships_toProvisionId_fkey" FOREIGN KEY ("toProvisionId") REFERENCES "legal_provisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
