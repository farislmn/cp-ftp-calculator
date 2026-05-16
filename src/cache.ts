const CACHE_VERSION = 'v1';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export const TTL = {
  MMP_EFFORTS:  1  * 60 * 60 * 1000,  // 1 hour
  RACE_LIST:    24 * 60 * 60 * 1000,  // 24 hours
  ORCHESTRATOR:  4 * 60 * 60 * 1000,  // 4 hours
} as const;

export function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`ppe_${CACHE_VERSION}_${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(`ppe_${CACHE_VERSION}_${key}`);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function setCached<T>(key: string, data: T, ttlMs: number): void {
  try {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };
    localStorage.setItem(`ppe_${CACHE_VERSION}_${key}`, JSON.stringify(entry));
  } catch {
    // localStorage quota exceeded or unavailable — fail silently
  }
}

export function clearCached(key: string): void {
  try {
    localStorage.removeItem(`ppe_${CACHE_VERSION}_${key}`);
  } catch { /* ignore */ }
}

/** Wipe every cache entry written by this app. */
export function clearAllCache(): void {
  try {
    const prefix = `ppe_${CACHE_VERSION}_`;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
