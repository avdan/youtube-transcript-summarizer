export interface ExtractedVideoMeta {
  videoId: string | null;
  title: string;
  channel: string;
  handle: string;
  channelUrl: string;
  url: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
}

export function extractVideoMeta(): ExtractedVideoMeta {
  return {
    videoId: getVideoId(),
    title: getVideoTitle(),
    channel: getChannelName(),
    handle: getChannelHandle(),
    channelUrl: getChannelUrl(),
    url: location.href,
    publishedAt: getPublishedAt(),
    durationSeconds: getDurationSeconds(),
    viewCount: getViewCount(),
  };
}

function getVideoId(): string | null {
  return new URLSearchParams(window.location.search).get('v');
}

function getVideoTitle(): string {
  const fromMeta = document.querySelector('meta[itemprop="name"]')?.getAttribute('content');
  if (fromMeta) return fromMeta;

  const selectors = [
    'ytd-watch-metadata h1 yt-formatted-string',
    'h1.ytd-watch-metadata',
    'h1.title',
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }

  const fromScript = extractFromPlayerResponse('title');
  if (fromScript) return fromScript;

  return document.title.replace(/\s+-\s+YouTube$/, '').trim() || 'Untitled YouTube video';
}

export function getChannelName(): string {
  // 1. Microformat (Schema.org)
  const microName =
    document.querySelector('span[itemprop="author"] link[itemprop="name"]')?.getAttribute('content') ||
    document.querySelector('[itemprop="author"] [itemprop="name"]')?.getAttribute('content');
  if (microName) return microName;

  // 2. Modern YouTube DOM
  const selectors = [
    'ytd-video-owner-renderer #channel-name a',
    'ytd-video-owner-renderer ytd-channel-name a',
    'ytd-video-owner-renderer .ytd-channel-name a',
    '#owner #channel-name a',
    '#owner-text a',
    '#upload-info ytd-channel-name a',
    'ytd-watch-metadata ytd-channel-name a',
    '#channel-name a',
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }

  // 3. Inline ytInitialPlayerResponse
  const fromScript = extractFromPlayerResponse('author');
  if (fromScript) return fromScript;

  return '';
}

export function getChannelUrl(): string {
  // 1. Microformat
  const microUrl =
    document.querySelector('span[itemprop="author"] link[itemprop="url"]')?.getAttribute('href') ||
    document.querySelector('[itemprop="author"] [itemprop="url"]')?.getAttribute('href');
  if (microUrl) return microUrl;

  // 2. Modern YouTube DOM
  const selectors = [
    'ytd-video-owner-renderer #channel-name a',
    'ytd-video-owner-renderer ytd-channel-name a',
    '#owner #channel-name a',
    '#owner-text a',
    'ytd-watch-metadata ytd-channel-name a',
    '#channel-name a',
  ];

  for (const selector of selectors) {
    const href = (document.querySelector(selector) as HTMLAnchorElement | null)?.href;
    if (href) return href;
  }

  // 3. Inline ytInitialPlayerResponse: ownerProfileUrl or construct from channelId
  const ownerProfileUrl = extractFromPlayerResponse('ownerProfileUrl');
  if (ownerProfileUrl) return ownerProfileUrl;

  const channelId = extractFromPlayerResponse('channelId');
  if (channelId) return `https://www.youtube.com/channel/${channelId}`;

  return '';
}

export function getChannelHandle(): string {
  // 1. From any URL containing @handle on the page (channel anchor preferred)
  const anchors = document.querySelectorAll<HTMLAnchorElement>(
    'ytd-video-owner-renderer a, #owner a, ytd-watch-metadata ytd-channel-name a, #channel-name a, [itemprop="author"] [itemprop="url"]'
  );
  for (const anchor of anchors) {
    const href = (anchor as HTMLElement).getAttribute('href') || (anchor as HTMLAnchorElement).href || '';
    const match = href.match(/@[\w.-]+/);
    if (match) return match[0];
  }

  // 2. From sub-count text (sometimes contains the handle)
  const subText =
    document.querySelector('ytd-watch-metadata #owner-sub-count')?.textContent ||
    document.querySelector('#owner #owner-sub-count')?.textContent ||
    '';
  const subMatch = subText.match(/@[\w.-]+/);
  if (subMatch) return subMatch[0];

  // 3. From canonical channel URL in microformat
  const microUrl =
    document.querySelector('span[itemprop="author"] link[itemprop="url"]')?.getAttribute('href') || '';
  const microMatch = microUrl.match(/@[\w.-]+/);
  if (microMatch) return microMatch[0];

  return '';
}

function getPublishedAt(): string {
  return (
    document.querySelector('meta[itemprop="datePublished"]')?.getAttribute('content') ||
    document.querySelector('meta[itemprop="uploadDate"]')?.getAttribute('content') ||
    extractFromPlayerResponse('publishDate') ||
    extractFromPlayerResponse('uploadDate') ||
    ''
  );
}

function getDurationSeconds(): number {
  const iso = document.querySelector('meta[itemprop="duration"]')?.getAttribute('content') || '';
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (match) {
    const h = parseInt(match[1] || '0', 10);
    const m = parseInt(match[2] || '0', 10);
    const s = parseInt(match[3] || '0', 10);
    return h * 3600 + m * 60 + s;
  }

  const fromScript = parseInt(extractFromPlayerResponse('lengthSeconds') || '0', 10);
  return Number.isFinite(fromScript) ? fromScript : 0;
}

function getViewCount(): number {
  const raw =
    document.querySelector('meta[itemprop="interactionCount"]')?.getAttribute('content') ||
    document.querySelector('meta[itemprop="userInteractionCount"]')?.getAttribute('content') ||
    extractFromPlayerResponse('viewCount') ||
    '';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract a JSON string-valued key from inline ytInitialPlayerResponse blob.
 * Cheap and works without parsing the full JSON. Walks all <script> tags
 * since the assignment lives in one of them.
 */
function extractFromPlayerResponse(key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stringPattern = new RegExp(`"${escapedKey}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);

  const scripts = document.querySelectorAll('script');
  for (const script of Array.from(scripts)) {
    const content = script.textContent || '';
    if (!content.includes('ytInitialPlayerResponse') && !content.includes('ytInitialData')) continue;
    const m = content.match(stringPattern);
    if (m) {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return m[1];
      }
    }
  }
  return '';
}
