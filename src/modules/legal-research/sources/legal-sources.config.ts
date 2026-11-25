import { LegalAuthorityTier } from '@prisma/client';

export interface OfficialLegalSourceSeed {
  sourceKey: string;
  name: string;
  baseUrl: string;
  sourceType: 'LEGISLATION' | 'GAZETTE' | 'JUDICIAL';
  authorityTier: LegalAuthorityTier;
  jurisdiction: string;
  jurisdictionLevel: 'CENTRAL' | 'STATE' | 'UNION_TERRITORY';
  description: string;
  crawlConfig: {
    allowedHosts: string[];
    seedPaths: string[];
    includePatterns: string[];
    excludePatterns: string[];
    maxDepth: number;
    maxPages: number;
    delayMs: number;
    timeoutMs: number;
    maxDownloadBytes: number;
  };
  metadata: {
    category: 'LEGAL';
    domain: 'INDIAN_LAW';
    country: 'INDIA';
    jurisdiction: 'INDIA';
    authorityType: 'OFFICIAL';
    ingestionMethod: 'WEB_CRAWL';
    enabled: boolean;
    initialIngestionStatus: 'PENDING';
  };
}

export const INITIAL_INDIAN_LEGAL_SOURCES: OfficialLegalSourceSeed[] = [
  {
    sourceKey: 'india-code',
    name: 'India Code',
    baseUrl: 'https://www.indiacode.nic.in/',
    sourceType: 'LEGISLATION',
    authorityTier: 'PRIMARY_LEGISLATION',
    jurisdiction: 'INDIA',
    jurisdictionLevel: 'CENTRAL',
    description: 'Official repository of Central and State Acts of India.',
    crawlConfig: {
      allowedHosts: ['www.indiacode.nic.in', 'indiacode.nic.in'],
      seedPaths: ['/', '/handle/123456789/1362/browse', '/bitstream/'],
      includePatterns: ['/handle/', '/bitstream/', '.pdf', 'act', 'constitution', 'sanhita'],
      excludePatterns: ['/login', '/register', '/password-reset', 'logout'],
      maxDepth: 2,
      maxPages: 40,
      delayMs: 1000,
      timeoutMs: 15000,
      maxDownloadBytes: 20 * 1024 * 1024,
    },
    metadata: {
      category: 'LEGAL',
      domain: 'INDIAN_LAW',
      country: 'INDIA',
      jurisdiction: 'INDIA',
      authorityType: 'OFFICIAL',
      ingestionMethod: 'WEB_CRAWL',
      enabled: true,
      initialIngestionStatus: 'PENDING',
    },
  },
  {
    sourceKey: 'egazette-india',
    name: 'e-Gazette of India',
    baseUrl: 'https://egazette.gov.in/',
    sourceType: 'GAZETTE',
    authorityTier: 'OFFICIAL_NOTIFICATION',
    jurisdiction: 'INDIA',
    jurisdictionLevel: 'CENTRAL',
    description: 'Official Gazette of India for Acts, Amendments, Rules, and Notifications.',
    crawlConfig: {
      allowedHosts: ['egazette.gov.in', 'www.egazette.gov.in'],
      seedPaths: ['/'],
      includePatterns: ['.pdf', 'gazette', 'WriteReadData', 'Notification', 'Act'],
      excludePatterns: ['/Login', '/Admin'],
      maxDepth: 2,
      maxPages: 30,
      delayMs: 1000,
      timeoutMs: 15000,
      maxDownloadBytes: 20 * 1024 * 1024,
    },
    metadata: {
      category: 'LEGAL',
      domain: 'INDIAN_LAW',
      country: 'INDIA',
      jurisdiction: 'INDIA',
      authorityType: 'OFFICIAL',
      ingestionMethod: 'WEB_CRAWL',
      enabled: true,
      initialIngestionStatus: 'PENDING',
    },
  },
  {
    sourceKey: 'supreme-court-india',
    name: 'Supreme Court of India',
    baseUrl: 'https://www.sci.gov.in/',
    sourceType: 'JUDICIAL',
    authorityTier: 'BINDING_JUDICIAL',
    jurisdiction: 'INDIA',
    jurisdictionLevel: 'CENTRAL',
    description: 'Official portal of the Supreme Court of India.',
    crawlConfig: {
      allowedHosts: ['www.sci.gov.in', 'sci.gov.in', 'main.sci.gov.in'],
      seedPaths: ['/', '/judgements/', '/daily-order/'],
      includePatterns: ['.pdf', 'judgement', 'judgment', 'order', 'wp-content/uploads'],
      excludePatterns: ['/wp-login', '/wp-admin'],
      maxDepth: 2,
      maxPages: 30,
      delayMs: 1000,
      timeoutMs: 15000,
      maxDownloadBytes: 20 * 1024 * 1024,
    },
    metadata: {
      category: 'LEGAL',
      domain: 'INDIAN_LAW',
      country: 'INDIA',
      jurisdiction: 'INDIA',
      authorityType: 'OFFICIAL',
      ingestionMethod: 'WEB_CRAWL',
      enabled: true,
      initialIngestionStatus: 'PENDING',
    },
  },
  {
    sourceKey: 'supreme-court-reports',
    name: 'Supreme Court Reports',
    baseUrl: 'https://scr.sci.gov.in/scrsearch/',
    sourceType: 'JUDICIAL',
    authorityTier: 'BINDING_JUDICIAL',
    jurisdiction: 'INDIA',
    jurisdictionLevel: 'CENTRAL',
    description: 'Official Digital Supreme Court Reports (e-SCR).',
    crawlConfig: {
      allowedHosts: ['scr.sci.gov.in'],
      seedPaths: ['/scrsearch/'],
      includePatterns: ['.pdf', 'scr', 'judgment'],
      excludePatterns: ['/login'],
      maxDepth: 2,
      maxPages: 25,
      delayMs: 1000,
      timeoutMs: 15000,
      maxDownloadBytes: 20 * 1024 * 1024,
    },
    metadata: {
      category: 'LEGAL',
      domain: 'INDIAN_LAW',
      country: 'INDIA',
      jurisdiction: 'INDIA',
      authorityType: 'OFFICIAL',
      ingestionMethod: 'WEB_CRAWL',
      enabled: true,
      initialIngestionStatus: 'PENDING',
    },
  },
  {
    sourceKey: 'ecourts-india',
    name: 'eCourts',
    baseUrl: 'https://ecourts.gov.in/',
    sourceType: 'JUDICIAL',
    authorityTier: 'PERSUASIVE_JUDICIAL',
    jurisdiction: 'INDIA',
    jurisdictionLevel: 'CENTRAL',
    description: 'Official eCourts Services portal for High Courts and District Courts.',
    crawlConfig: {
      allowedHosts: ['ecourts.gov.in', 'www.ecourts.gov.in', 'judgments.ecourts.gov.in'],
      seedPaths: ['/'],
      includePatterns: ['.pdf', 'judgment', 'order', 'ecourts_home'],
      excludePatterns: ['/login'],
      maxDepth: 2,
      maxPages: 25,
      delayMs: 1000,
      timeoutMs: 15000,
      maxDownloadBytes: 20 * 1024 * 1024,
    },
    metadata: {
      category: 'LEGAL',
      domain: 'INDIAN_LAW',
      country: 'INDIA',
      jurisdiction: 'INDIA',
      authorityType: 'OFFICIAL',
      ingestionMethod: 'WEB_CRAWL',
      enabled: true,
      initialIngestionStatus: 'PENDING',
    },
  },
];
