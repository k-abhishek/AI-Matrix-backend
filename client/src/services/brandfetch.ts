export interface BrandSearchResult {
  name: string;
  domain: string;
  icon?: string;
  brandId?: string;
  claimed?: boolean;
}

export const BRANDFETCH_CLIENT_ID =
  (import.meta.env.VITE_BRAND_FETCH as string) || '';

/**
 * Searches Brandfetch for company names to resolve domains (autocomplete).
 * Uses Brand Search API: https://api.brandfetch.io/v2/search/{name}?c={CLIENT_ID}
 * The client ID is public and safe in frontend code.
 */
export async function searchBrands(query: string): Promise<BrandSearchResult[]> {
  if (!query || query.trim().length < 2) return [];
  if (!BRANDFETCH_CLIENT_ID) return [];

  try {
    const url = `https://api.brandfetch.io/v2/search/${encodeURIComponent(
      query.trim()
    )}?c=${BRANDFETCH_CLIENT_ID}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[Brandfetch] Autocomplete search failed:', err);
    return [];
  }
}

/**
 * Generates Brandfetch Logo API URL for an HTML <img> tag.
 * https://cdn.brandfetch.io/domain/{domain}?c={CLIENT_ID}
 */
export function getBrandfetchLogoUrl(domain: string): string | null {
  if (!domain || !BRANDFETCH_CLIENT_ID) return null;
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return `https://cdn.brandfetch.io/domain/${clean}?c=${BRANDFETCH_CLIENT_ID}`;
}
