export interface CopyHeaderInfo {
  title?: string | null;
  channel?: string | null;
  handle?: string | null;
  channelUrl?: string | null;
  videoUrl?: string | null;
  videoId?: string | null;
}

export function withCopyHeader(info: CopyHeaderInfo, body: string): string {
  const header = formatCopyHeader(info);
  if (!header) return body;
  return `${header}\n\n${body}`;
}

export function formatCopyHeader(info: CopyHeaderInfo): string {
  const lines: string[] = [];

  const title = info.title?.trim();
  if (title) lines.push(title);

  const channelLine = formatChannelLine(info);
  if (channelLine) lines.push(channelLine);

  const videoUrl = info.videoUrl?.trim() || (info.videoId ? `https://www.youtube.com/watch?v=${info.videoId}` : '');
  if (videoUrl) lines.push(videoUrl);

  return lines.join('\n');
}

function formatChannelLine(info: CopyHeaderInfo): string {
  const channel = info.channel?.trim();
  const handle = info.handle?.trim();
  const url = info.channelUrl?.trim();

  const label = channel && handle && channel !== handle ? `${channel} (${handle})` : channel || handle || '';
  if (!label && !url) return '';
  if (label && url) return `${label} — ${url}`;
  return label || url || '';
}
