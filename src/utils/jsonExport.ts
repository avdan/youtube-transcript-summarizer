export interface ExportInput {
  video: {
    id: string | null;
    title: string;
    url: string;
    publishedAt?: string;
    durationSeconds?: number;
    viewCount?: number;
  };
  channel: {
    name: string;
    handle?: string;
    url?: string;
  };
  summary?: string;
  transcript?: string;
  summaryModel?: string;
  summaryLength?: 'concise' | 'normal' | 'extended';
}

export function buildExportJson(input: ExportInput): string {
  const result: Record<string, unknown> = {
    video: pruneEmpty({
      id: input.video.id || undefined,
      title: input.video.title || undefined,
      url: input.video.url || undefined,
      publishedAt: input.video.publishedAt || undefined,
      durationSeconds: input.video.durationSeconds && input.video.durationSeconds > 0 ? input.video.durationSeconds : undefined,
      viewCount: input.video.viewCount && input.video.viewCount > 0 ? input.video.viewCount : undefined,
    }),
    channel: pruneEmpty({
      name: input.channel.name || undefined,
      handle: input.channel.handle || undefined,
      url: input.channel.url || undefined,
    }),
  };

  if (typeof input.summary === 'string' && input.summary.length > 0) {
    result.summary = input.summary;
  }
  if (typeof input.transcript === 'string' && input.transcript.length > 0) {
    result.transcript = input.transcript;
  }

  const meta: Record<string, unknown> = {
    extractedAt: new Date().toISOString(),
    extension: extensionLabel(),
  };
  if (input.summary && input.summaryModel) meta.summaryModel = input.summaryModel;
  if (input.summary && input.summaryLength) meta.summaryLength = input.summaryLength;
  result.meta = meta;

  return JSON.stringify(result, null, 2);
}

function extensionLabel(): string {
  try {
    const m = chrome.runtime.getManifest();
    return `youtube-transcript-summarizer v${m.version}`;
  } catch {
    return 'youtube-transcript-summarizer';
  }
}

function pruneEmpty<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out as T;
}
