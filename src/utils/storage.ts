import { UserPreferences, CacheData } from '../types';
import { DEFAULT_QA_MODEL, DEFAULT_SUMMARY_MODEL, MODEL_OPTIONS } from '../constants/models';

const VALID_MODEL_IDS = new Set(MODEL_OPTIONS.map(m => m.id));

export class StorageService {
  private static readonly defaultPreferences: UserPreferences = {
    autoSummarize: false,
    summaryLength: 'medium',
    language: 'en',
    summaryModel: DEFAULT_SUMMARY_MODEL,
    qaModel: DEFAULT_QA_MODEL,
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

  /**
   * Save data to cache
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
