import { UserPreferences, CacheData } from '../types';
import {
  DEFAULT_QA_MODEL,
  DEFAULT_SUMMARY_LENGTH,
  DEFAULT_SUMMARY_MODEL,
  DEFAULT_THEME,
  MODEL_OPTIONS,
  normalizeSummaryLength,
  normalizeTheme,
} from '../constants/models';

const VALID_MODEL_IDS = new Set(MODEL_OPTIONS.map(m => m.id));

export class StorageService {
  private static readonly defaultPreferences: UserPreferences = {
    autoSummarize: false,
    summaryLength: DEFAULT_SUMMARY_LENGTH,
    language: 'en',
    summaryModel: DEFAULT_SUMMARY_MODEL,
    qaModel: DEFAULT_QA_MODEL,
    theme: DEFAULT_THEME,
  };

  /**
   * Get OpenRouter API key from storage
   */
  static async getApiKey(): Promise<string | null> {
    const data = await chrome.storage.local.get('openRouterApiKey');
    return data.openRouterApiKey || null;
  }

  /**
   * Save OpenRouter API key to storage
   */
  static async setApiKey(apiKey: string): Promise<void> {
    await chrome.storage.local.set({ openRouterApiKey: apiKey });
  }

  /**
   * Get user preferences
   */
  static async getPreferences(): Promise<UserPreferences> {
    const data = await chrome.storage.sync.get('preferences');
    const stored = (data.preferences || {}) as Partial<UserPreferences>;
    const preferences: UserPreferences = {
      ...this.defaultPreferences,
      ...stored,
    };

    // Migrate legacy `model` field into `summaryModel` + `qaModel`
    if (stored.model && (!stored.summaryModel || !stored.qaModel)) {
      preferences.summaryModel = stored.summaryModel || stored.model;
      preferences.qaModel = stored.qaModel || stored.model;
    }
    delete preferences.model;

    if (!VALID_MODEL_IDS.has(preferences.summaryModel)) {
      preferences.summaryModel = DEFAULT_SUMMARY_MODEL;
    }
    if (!VALID_MODEL_IDS.has(preferences.qaModel)) {
      preferences.qaModel = DEFAULT_QA_MODEL;
    }

    preferences.summaryLength = normalizeSummaryLength(preferences.summaryLength);
    preferences.theme = normalizeTheme(preferences.theme);

    return preferences;
  }

  /**
   * Save user preferences
   */
  static async setPreferences(preferences: UserPreferences): Promise<void> {
    await chrome.storage.sync.set({ preferences });
  }

  /**
   * Get cached data for a video
   */
  static async getCachedData(videoId: string): Promise<CacheData[string] | null> {
    const data = await chrome.storage.local.get(`cache_${videoId}`);
    const cached = data[`cache_${videoId}`];
    
    if (!cached) return null;
    
    // Check if cache is still valid (24 hours)
    const isExpired = Date.now() - cached.timestamp > 24 * 60 * 60 * 1000;
    if (isExpired) {
      await this.removeCachedData(videoId);
      return null;
    }
    
    return cached;
  }

  private static readonly CACHE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB

  /**
   * Save data to cache, evicting oldest cache entries if total cache size
   * exceeds CACHE_LIMIT_BYTES.
   */
  static async setCachedData(
    videoId: string,
    transcript: string,
    summary: string
  ): Promise<void> {
    const cacheData = {
      transcript,
      summary,
      timestamp: Date.now(),
    };

    await chrome.storage.local.set({ [`cache_${videoId}`]: cacheData });
    await this.enforceCacheLimit();
  }

  /**
   * Evict oldest cache_* entries until total cache size is under the limit.
   */
  static async enforceCacheLimit(): Promise<void> {
    const all = await chrome.storage.local.get();
    const cacheEntries = Object.entries(all)
      .filter(([key]) => key.startsWith('cache_'))
      .map(([key, value]) => ({
        key,
        timestamp: (value as any)?.timestamp || 0,
        size: this.byteSize(key) + this.byteSize(value),
      }));

    let totalBytes = cacheEntries.reduce((sum, entry) => sum + entry.size, 0);
    if (totalBytes <= this.CACHE_LIMIT_BYTES) return;

    cacheEntries.sort((a, b) => a.timestamp - b.timestamp);

    const toRemove: string[] = [];
    for (const entry of cacheEntries) {
      if (totalBytes <= this.CACHE_LIMIT_BYTES) break;
      toRemove.push(entry.key);
      totalBytes -= entry.size;
    }

    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
      console.log(`Cache cleanup: removed ${toRemove.length} entries to stay under 10MB`);
    }
  }

  private static byteSize(value: unknown): number {
    if (typeof value === 'string') {
      return new Blob([value]).size;
    }
    return new Blob([JSON.stringify(value ?? null)]).size;
  }

  /**
   * Remove cached data
   */
  static async removeCachedData(videoId: string): Promise<void> {
    await chrome.storage.local.remove(`cache_${videoId}`);
  }

  /**
   * Clear all cache
   */
  static async clearAllCache(): Promise<void> {
    const allData = await chrome.storage.local.get();
    const cacheKeys = Object.keys(allData).filter(key => key.startsWith('cache_'));
    await chrome.storage.local.remove(cacheKeys);
  }

  /**
   * Get storage usage info
   */
  static async getStorageInfo(): Promise<{
    bytesUsed: number;
    quota: number;
    percentage: number;
  }> {
    const bytesUsed = await chrome.storage.local.getBytesInUse();
    const quota = chrome.storage.local.QUOTA_BYTES;
    
    return {
      bytesUsed,
      quota,
      percentage: (bytesUsed / quota) * 100,
    };
  }
}
