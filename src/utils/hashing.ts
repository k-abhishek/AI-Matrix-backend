import crypto from 'crypto';

// Fixed namespace UUID for deterministic point IDs in Qdrant
const QDRANT_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Computes a SHA-256 hash of cleaned text content.
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content.trim()).digest('hex');
}

/**
 * Generates an RFC 4122 compliant UUID v5 string using SHA-1 and a namespace.
 * Eliminates ESM external dependencies in CommonJS/Lambda runtimes.
 */
function uuidv5(name: string, namespace: string): string {
  const nsBuffer = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const nameBuffer = Buffer.from(name, 'utf8');
  const hash = crypto.createHash('sha1').update(Buffer.concat([nsBuffer, nameBuffer])).digest();

  // Set version to 5 (0101)
  const b6 = (hash[6] & 0x0f) | 0x50;
  // Set variant to RFC 4122 (10xx)
  const b8 = (hash[8] & 0x3f) | 0x80;

  const hex = Buffer.concat([
    hash.subarray(0, 6),
    Buffer.from([b6]),
    hash.subarray(7, 8),
    Buffer.from([b8]),
    hash.subarray(9, 16),
  ]).toString('hex');

  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join('-');
}

/**
 * Generates a deterministic UUID v5 string for a Qdrant point based on crawlerId, pageId and chunkIndex.
 * Qdrant accepts either standard UUID strings or unsigned 64-bit integers.
 */
export function generatePointId(pageId: string, chunkIndex: number): string {
  const seed = `${pageId}:${chunkIndex}`;
  return uuidv5(seed, QDRANT_NAMESPACE);
}

/**
 * Normalizes a crawler name into a valid Qdrant collection name.
 * Replaces non-alphanumeric characters (except _ and -) with underscores,
 * trims leading/trailing separators, lowercases, and enforces Qdrant's 255-char limit.
 */
export function sanitizeCollectionName(name: string, fallback = 'website_content'): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 255);

  return normalized || fallback;
}

