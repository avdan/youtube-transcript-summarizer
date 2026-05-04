import { YouTubeTranscriptAPI, fetchFormattedTranscriptWithRetry } from './youtubeTranscriptAPI';
import { mountInPagePanel, onVideoChanged } from './inPagePanel';
import { extractVideoMeta } from './videoMetaExtractor';

declare global {
  interface Window {
    __youtubeTranscriptAnalyzerLoaded?: boolean;
  }
}

interface RuntimeRequest {
  action?: string;
  type?: string;
  payload?: {
    languageCode?: string;
  };
}

let currentVideoId: string | null = null;

if (!window.__youtubeTranscriptAnalyzerLoaded) {
  window.__youtubeTranscriptAnalyzerLoaded = true;
  initContentScript();
}

function initContentScript(): void {
  currentVideoId = getVideoId();
  notifyVideoChange();
  mountInPagePanel();
  onVideoChanged(currentVideoId, buildVideoMetaForPanel());

  chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
    const action = message.action || message.type;

    if (action === 'PING') {
      sendResponse({ success: true });
      return false;
    }

    if (action === 'GET_VIDEO_INFO') {
      sendResponse(getVideoInfo());
      return false;
    }

    if (action === 'GET_LANGUAGES') {
      getLanguages()
        .then(languages => sendResponse({ success: true, languages }))
        .catch(error => sendResponse({ success: false, error: getErrorMessage(error), languages: [] }));
      return true;
    }

    if (action === 'GET_TRANSCRIPT') {
      getTranscript(message.payload?.languageCode)
        .then(transcript => sendResponse({ success: true, transcript }))
        .catch(error => sendResponse({ success: false, error: getErrorMessage(error) }));
      return true;
    }

    return false;
  });

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href === lastUrl) {
      return;
    }

    lastUrl = location.href;
    currentVideoId = getVideoId();
    notifyVideoChange();
    onVideoChanged(currentVideoId, buildVideoMetaForPanel());
  }).observe(document, { childList: true, subtree: true });
}

function getVideoId(): string | null {
  return new URLSearchParams(window.location.search).get('v');
}

function getVideoInfo() {
  const meta = extractVideoMeta();
  return {
    videoId: meta.videoId,
    title: meta.title,
    channel: meta.channel || 'Unknown channel',
    handle: meta.handle,
    channelUrl: meta.channelUrl,
    url: meta.url,
    publishedAt: meta.publishedAt,
    durationSeconds: meta.durationSeconds,
    viewCount: meta.viewCount,
  };
}

function buildVideoMetaForPanel() {
  const meta = extractVideoMeta();
  return {
    title: meta.title,
    channel: meta.channel,
    handle: meta.handle,
    channelUrl: meta.channelUrl,
    url: meta.url,
    publishedAt: meta.publishedAt,
    durationSeconds: meta.durationSeconds,
    viewCount: meta.viewCount,
  };
}

async function getLanguages() {
  const videoId = getVideoId();
  if (!videoId) {
    return [];
  }

  return new YouTubeTranscriptAPI(videoId).getAvailableLanguages();
}

async function getTranscript(languageCode?: string): Promise<string> {
  const videoId = getVideoId();
  if (!videoId) {
    throw new Error('Open a YouTube video first.');
  }

  return fetchFormattedTranscriptWithRetry(videoId, languageCode);
}

function notifyVideoChange(): void {
  if (!currentVideoId) {
    return;
  }

  chrome.runtime.sendMessage(
    {
      action: 'VIDEO_CHANGED',
      payload: { videoId: currentVideoId },
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
