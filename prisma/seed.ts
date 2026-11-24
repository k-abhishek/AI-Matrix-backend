import { PrismaClient } from '@prisma/client';
import { SYSTEM_CONNECTOR_SEEDS, STABLE_UUID_MAP } from '../src/modules/connectors/connector.registry';

const prisma = new PrismaClient();

async function main() {
  console.log('1. Clearing all existing connector tables in dependency order...');

  await prisma.$transaction(async (tx) => {
    // Delete child records first to respect foreign keys
    await tx.oAuthTransaction.deleteMany();
    await tx.connectorCredential.deleteMany();
    await tx.connectorTool.deleteMany();
    await tx.connectorResource.deleteMany();
    await tx.connectorPrompt.deleteMany();
    await tx.connectorPermission.deleteMany();
    await tx.agentConnectorBinding.deleteMany();
    await tx.connectorConnection.deleteMany();
    await tx.connectorDefinition.deleteMany();
  });

  console.log('2. Successfully cleared all connector data.');
  console.log(`3. Seeding ${SYSTEM_CONNECTOR_SEEDS.length} current SYSTEM_CONNECTOR_SEEDS into PostgreSQL...`);

  for (const seed of SYSTEM_CONNECTOR_SEEDS) {
    const stableId = STABLE_UUID_MAP[seed.key] || undefined;
    await prisma.connectorDefinition.create({
      data: {
        id: stableId,
        key: seed.key,
        name: seed.name,
        description: seed.description,
        type: seed.type,
        supportedAuth: seed.supportedAuth,
        iconUrl: null,
        docUrl: seed.docUrl || null,
        isSystem: true,
        defaultConfig: seed.defaultConfig || {},
      },
    });
    console.log(`[CREATED] ${seed.key.padEnd(18)} -> ${seed.name} (${seed.type}, ID: ${stableId || 'generated'})`);
  }

  const all = await prisma.connectorDefinition.findMany({
    select: {
      id: true,
      key: true,
      name: true,
      type: true,
      supportedAuth: true,
    },
    orderBy: { key: 'asc' },
  });

  console.log(`\nSuccessfully seeded database with current ${all.length} catalog items:`);
  console.table(all);
}

main()
  .catch((e) => {
    console.error('Error during connector database reset and seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
