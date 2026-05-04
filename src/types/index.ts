// Extension message types
export interface Message {
  action: string;
  payload?: any;
  videoId?: string;
  transcript?: string;
}

export interface TranscriptMessage extends Message {
  action: 'GET_TRANSCRIPT' | 'TRANSCRIPT_READY' | 'TRANSCRIPT_ERROR';
  transcript?: string;
  error?: string;
}

export interface SummaryMessage extends Message {
  action: 'GENERATE_SUMMARY' | 'SUMMARY_READY' | 'SUMMARY_ERROR';
  summary?: string;
  error?: string;
}

// OpenRouter types
export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  summaryLength?: 'concise' | 'normal' | 'extended';
}

// Storage types
export interface StorageData {
  openRouterApiKey?: string;
  preferences?: UserPreferences;
  cache?: CacheData;
}

export interface UserPreferences {
  autoSummarize: boolean;
  summaryLength: 'concise' | 'normal' | 'extended';
  language: string;
  summaryModel: string;
  qaModel: string;
  /** @deprecated kept for migration from < 1.1.0 */
  model?: string;
}

export interface CacheData {
  [videoId: string]: {
    transcript: string;
    summary: string;
    timestamp: number;
  };
}
