const REPO = 'avdan/youtube-transcript-summarizer';
const RELEASE_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const ALARM_NAME = 'updateCheck';
const CHECK_PERIOD_MINUTES = 60 * 24;
const STORAGE_KEY = 'updateInfo';
const DISMISSED_KEY = 'updateDismissedVersion';
const BADGE_TEXT = 'NEW';
const BADGE_COLOR = '#cc1f1a';

export interface UpdateInfo {
  latestVersion: string;
  releaseUrl: string;
  publishedAt: string;
  checkedAt: number;
}

export interface UpdateState {
  current: string;
  available: UpdateInfo | null;
  dismissed: string | null;
}

function parseSemver(v: string): number[] {
  return v
    .replace(/^v/, '')
    .split('.')
    .map(part => parseInt(part, 10) || 0);
}

function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function fetchLatestRelease(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(RELEASE_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      console.warn('Update check: GitHub API returned', res.status);
      return null;
    }
    const data = await res.json();
    if (!data.tag_name || !data.html_url) return null;
    return {
      latestVersion: String(data.tag_name).replace(/^v/, ''),
      releaseUrl: data.html_url,
      publishedAt: data.published_at,
      checkedAt: Date.now(),
    };
  } catch (error) {
    console.warn('Update check failed:', error);
    return null;
  }
}

async function setBadge(show: boolean): Promise<void> {
  try {
    if (show) {
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      await chrome.action.setBadgeText({ text: BADGE_TEXT });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (error) {
    console.warn('Failed to set badge:', error);
  }
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const info = await fetchLatestRelease();
  if (!info) return null;

  const current = chrome.runtime.getManifest().version;
  const stored = await chrome.storage.local.get([DISMISSED_KEY]);
  const dismissed: string | null = stored[DISMISSED_KEY] || null;

  if (!isNewer(info.latestVersion, current)) {
    await chrome.storage.local.remove(STORAGE_KEY);
    await setBadge(false);
    return null;
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: info });
  await setBadge(dismissed !== info.latestVersion);
  return info;
}

export async function getUpdateState(): Promise<UpdateState> {
  const data = await chrome.storage.local.get([STORAGE_KEY, DISMISSED_KEY]);
  return {
    current: chrome.runtime.getManifest().version,
    available: data[STORAGE_KEY] || null,
    dismissed: data[DISMISSED_KEY] || null,
  };
}

export async function dismissUpdate(version: string): Promise<void> {
  await chrome.storage.local.set({ [DISMISSED_KEY]: version });
  await setBadge(false);
}

export function registerUpdateChecker(): void {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: CHECK_PERIOD_MINUTES,
  });

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM_NAME) {
      void checkForUpdate();
    }
  });
}
