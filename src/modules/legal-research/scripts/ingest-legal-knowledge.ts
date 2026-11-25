import prisma from '../../../lib/prisma';
import { connectMongoDB, disconnectMongoDB } from '../../../lib/mongoose';
import logger from '../../../lib/logger';
import legalOneTimeIngestionService from '../ingestion/legal-one-time-ingestion.service';

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  let limit: number | undefined;

  const limitIdx = argv.indexOf('--limit');
  if (limitIdx !== -1 && argv[limitIdx + 1]) {
    const parsed = Number.parseInt(argv[limitIdx + 1], 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = parsed;
    }
  }

  return { dryRun, force, limit };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  logger.info(`Running one-time Indian Legal KB ingestion (dryRun=${args.dryRun}, force=${args.force}, limit=${args.limit ?? 'none'})`);

  await connectMongoDB().catch((err: any) => {
    logger.warn(`MongoDB connection warning: ${err.message}`);
  });

  const report = await legalOneTimeIngestionService.execute(args);

  console.log('\nINDIAN LEGAL KNOWLEDGE BASE INITIAL INGESTION');
  console.log(`Execution ID: ${report.runId}`);
  console.log('\nSources:');
  for (const s of report.sources) {
    console.log(
      `  ${s.name}: ${s.status} (discovered=${s.discovered}, downloaded=${s.downloaded}, persisted=${s.persisted}, indexed=${s.indexed}, failed=${s.failed})`
    );
    if (s.restrictions.length > 0) {
      console.log(`    Restrictions: ${s.restrictions[0]}`);
    }
  }
  console.log('\nDocuments:');
  console.log(`  Discovered: ${report.documents.discovered}`);
  console.log(`  Downloaded: ${report.documents.downloaded}`);
  console.log(`  Extracted: ${report.documents.extracted}`);
  console.log(`  Persisted: ${report.documents.persisted}`);
  console.log(`  Indexed chunks: ${report.documents.indexed}`);
  console.log(`  Failed: ${report.documents.failed}`);
  console.log(`  Pending review: ${report.documents.pendingReview}`);
  console.log(`  Duplicates skipped: ${report.documents.duplicatesSkipped}`);
  console.log('\nQdrant:');
  console.log(`  Collection: ${report.qdrant.collection}`);
  console.log(`  Indexed points: ${report.qdrant.pointsCount}`);
  console.log('\nCanonical Database:');
  console.log(`  Legal documents: ${report.canonicalDatabase.legalDocuments}`);
  console.log(`  Provisions: ${report.canonicalDatabase.provisions}`);
  console.log(`  Versions: ${report.canonicalDatabase.versions}`);
  console.log(`\nStatus: ${report.status}\n`);
}

main()
  .catch((err) => {
    logger.error('One-time legal ingestion failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await disconnectMongoDB().catch(() => {});
  });
