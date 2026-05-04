import { Message } from '../types';
import { OpenRouterService } from '../api/openrouter';
import { StorageService } from '../utils/storage';
import { fetchTranscriptFromBackground, fetchTranscriptDirect } from './transcriptFetcher';
import {
  registerUpdateChecker,
  checkForUpdate,
  getUpdateState,
  dismissUpdate,
} from './updateChecker';

console.log('Background service worker started');

// State management
let openRouterService: OpenRouterService | null = null;
let currentTranscript: string | null = null;
let currentVideoId: string | null = null;
let currentSummary: string | null = null;
let conversationHistory: Array<{ role: string; content: string }> = [];

// Initialize OpenRouter service
async function initializeOpenRouter() {
  try {
    const apiKey = await StorageService.getApiKey();
    const preferences = await StorageService.getPreferences();
    
    if (!apiKey) {
      console.log('No API key found');
      return false;
    }

    openRouterService = new OpenRouterService({
      apiKey,
      model: preferences.summaryModel,
      maxTokens: preferences.summaryLength === 'short' ? 1000 :
                 preferences.summaryLength === 'long' ? 2600 : 1800,
    });
    
    return true;
  } catch (error) {
    console.error('Failed to initialize OpenRouter:', error);
    return false;
  }
}

registerUpdateChecker();

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
  void checkForUpdate();
});

// Listen for messages
chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse) => {
    console.log('Background received message:', message);

    handleMessage(message)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ error: error.message }));

    return true; // Indicates async response
  }
);

// Message handler
async function handleMessage(message: Message) {
  switch (message.action) {
    case 'PROCESS_TRANSCRIPT': {
      const { videoId, transcript, force } = message.payload || {};
      
      console.log('Processing transcript request:', { videoId, transcriptLength: transcript?.length });
      
      if (!videoId) {
        throw new Error('Missing video ID');
      }

      // Check cache first
      const cached = force ? null : await StorageService.getCachedData(videoId);
      if (cached?.summary) {
        currentTranscript = cached.transcript;
        currentVideoId = videoId;
        currentSummary = cached.summary;
        conversationHistory = [];
        return { 
          success: true, 
          summary: cached.summary,
          fromCache: true 
        };
      }

      // Initialize OpenRouter if needed
      const initialized = await initializeOpenRouter();
      if (!initialized) {
        throw new Error('Please set your OpenRouter API key in the extension settings');
      }

      const transcriptToProcess =
        typeof transcript === 'string' && transcript.trim().length > 0
          ? transcript
          : currentVideoId === videoId
            ? currentTranscript
            : null;

      if (!transcriptToProcess || transcriptToProcess.trim().length === 0) {
        throw new Error('Transcript is empty or not available for this video');
      }

      // Generate summary
      const summary = await openRouterService!.generateSummary(transcriptToProcess);
      
      // Save to cache
      try {
        await StorageService.setCachedData(videoId, transcriptToProcess, summary);
      } catch (error) {
        console.warn('Could not cache transcript summary:', error);
      }
      
      // Update current state
      currentTranscript = transcriptToProcess;
      currentVideoId = videoId;
      currentSummary = summary;
      conversationHistory = [];
      
      return { success: true, summary };
    }

    case 'ASK_QUESTION': {
      const { question } = message.payload || {};
      
      if (!question) {
        throw new Error('No question provided');
      }

      if (!currentTranscript) {
        throw new Error('No transcript loaded. Please analyze a video first.');
      }

      if (!openRouterService) {
        const initialized = await initializeOpenRouter();
        if (!initialized) {
          throw new Error('OpenRouter not initialized');
        }
      }

      // Get answer (uses qaModel from preferences, falls back to summary model)
      const preferences = await StorageService.getPreferences();
      const answer = await openRouterService!.answerQuestion(
        currentTranscript,
        question,
        conversationHistory,
        preferences.qaModel
      );

      // Update conversation history
      conversationHistory.push(
        { role: 'user', content: question },
        { role: 'assistant', content: answer }
      );

      // Keep only last 10 messages to avoid token limits
      if (conversationHistory.length > 10) {
        conversationHistory = conversationHistory.slice(-10);
      }

      return { success: true, answer };
    }

    case 'GET_CURRENT_DATA': {
      return {
        videoId: currentVideoId,
        hasTranscript: !!currentTranscript,
        summary: currentSummary,
        conversationHistory,
      };
    }

    case 'GET_CACHED_SUMMARY': {
      const { videoId } = message.payload || {};
      if (!videoId) {
        throw new Error('Missing video ID');
      }

      const cached = await StorageService.getCachedData(videoId);
      if (!cached) {
        return { success: false };
      }

      currentTranscript = cached.transcript;
      currentVideoId = videoId;
      currentSummary = cached.summary;
      conversationHistory = [];

      return {
        success: true,
        transcript: cached.transcript,
        summary: cached.summary,
      };
    }

    case 'CLEAR_CONVERSATION': {
      conversationHistory = [];
      return { success: true };
    }

    case 'VIDEO_CHANGED': {
      const { videoId } = message.payload || {};
      
      // Check if we have cached data for this video
      if (videoId && videoId !== currentVideoId) {
        const cached = await StorageService.getCachedData(videoId);
        if (cached) {
          // Auto-load cached data
          currentTranscript = cached.transcript;
          currentVideoId = videoId;
          currentSummary = cached.summary;
          conversationHistory = [];
        } else {
          currentTranscript = null;
          currentVideoId = videoId;
          currentSummary = null;
          conversationHistory = [];
        }
      }
      
      return { success: true };
    }

    case 'SETTINGS_UPDATED': {
      openRouterService = null;
      await initializeOpenRouter();
      return { success: true };
    }

    case 'ESTIMATE_COST': {
      const { text } = message.payload || {};
      
      if (!text || !openRouterService) {
        return { tokens: 0, cost: { estimated: 0 } };
      }

      const tokens = openRouterService.estimateTokens(text);
      const cost = openRouterService.estimateCost(tokens);
      
      return { tokens, cost };
    }

    case 'FETCH_TRANSCRIPT_BACKGROUND': {
      const { videoId } = message.payload || {};
      
      if (!videoId) {
        throw new Error('No video ID provided');
      }

      try {
        // Try primary method first
        const transcript = await fetchTranscriptFromBackground(videoId);
        return { success: true, transcript };
      } catch (error) {
        console.error('Primary fetch failed, trying direct API:', error);
        
        try {
          // Try direct API as fallback
          const transcript = await fetchTranscriptDirect(videoId);
          return { success: true, transcript };
        } catch (fallbackError) {
          console.error('All methods failed:', fallbackError);
          throw new Error('Failed to fetch transcript from all methods');
        }
      }
    }

    case 'GET_UPDATE_INFO': {
      return await getUpdateState();
    }

    case 'DISMISS_UPDATE': {
      const { version } = message.payload || {};
      if (typeof version === 'string' && version.length > 0) {
        await dismissUpdate(version);
      }
      return { success: true };
    }

    default:
      throw new Error(`Unknown action: ${message.action}`);
  }
}

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  initializeOpenRouter();
  void checkForUpdate();
});
