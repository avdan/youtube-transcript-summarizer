import { YouTubeTranscriptAPI } from './youtubeTranscriptAPI';
import { mountInPagePanel, onVideoChanged } from './inPagePanel';

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
  onVideoChanged(currentVideoId, getVideoTitle());

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
    onVideoChanged(currentVideoId, getVideoTitle());
  }).observe(document, { childList: true, subtree: true });
}

function getVideoId(): string | null {
  return new URLSearchParams(window.location.search).get('v');
}

function getVideoInfo() {
  return {
    videoId: getVideoId(),
    title: getVideoTitle(),
    channel: getChannelName(),
    handle: getChannelHandle(),
    url: location.href,
  };
}

function getVideoTitle(): string {
  const selectors = [
    'ytd-watch-metadata h1 yt-formatted-string',
    'h1.ytd-watch-metadata',
    'h1.title',
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) {
      return text;
    }
  }

  return document.title.replace(/\s+-\s+YouTube$/, '').trim() || 'Untitled YouTube video';
}

function getChannelName(): string {
  const selectors = [
    'ytd-watch-metadata ytd-channel-name a',
    '#owner ytd-channel-name a',
    '#channel-name a',
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) {
      return text;
    }
  }

  return 'Unknown channel';
}

function getChannelHandle(): string {
  const selectors = [
    'ytd-watch-metadata #owner-sub-count',
    '#owner #owner-sub-count',
    'ytd-video-owner-renderer #owner-sub-count',
    'ytd-watch-metadata ytd-channel-name a',
    '#owner ytd-channel-name a',
    '#channel-name a',
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    const handle = normalizeChannelHandle(text);
    if (handle) {
      return handle;
    }
  }

  const channelUrl = (document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a') as HTMLAnchorElement | null)?.href;
  return normalizeChannelHandle(channelUrl);
}

function normalizeChannelHandle(value?: string | null): string {
  if (!value) {
    return '';
  }

  const match = value.match(/@[\w.-]+/);
  return match?.[0] || '';
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

  return new YouTubeTranscriptAPI(videoId).getFormattedTranscript(languageCode);
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
