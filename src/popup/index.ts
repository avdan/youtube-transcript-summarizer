import { Message } from '../types';
import { StorageService } from '../utils/storage';
import { MODEL_OPTIONS, SUMMARY_LENGTH_OPTIONS, SummaryLength, Theme } from '../constants/models';
import { withCopyHeader } from '../utils/copyHeader';
import { buildExportJson } from '../utils/jsonExport';

interface VideoInfo {
  videoId: string | null;
  title: string;
  channel: string;
  handle?: string;
  channelUrl?: string;
  url?: string;
  publishedAt?: string;
  durationSeconds?: number;
  viewCount?: number;
}

let contentDiv: HTMLElement;
let settingsButton: HTMLButtonElement;
let activeTabId: number | null = null;
let currentVideo: VideoInfo | null = null;
let conversationHistory: Array<{ role: string; content: string }> = [];
let isBusy = false;

document.addEventListener('DOMContentLoaded', async () => {
  contentDiv = document.getElementById('content')!;
  settingsButton = document.getElementById('settingsBtn') as HTMLButtonElement;

  settingsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  await initTheme();
  void renderUpdateBanner();
  await loadPopup();
});

async function initTheme(): Promise<void> {
  const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement | null;
  const prefs = await StorageService.getPreferences();
  applyTheme(prefs.theme);
  if (themeSelect) {
    themeSelect.value = prefs.theme;
    themeSelect.addEventListener('change', async () => {
      const value = themeSelect.value as Theme;
      const current = await StorageService.getPreferences();
      await StorageService.setPreferences({ ...current, theme: value });
      applyTheme(value);
    });
  }

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', async () => {
    const p = await StorageService.getPreferences();
    if (p.theme === 'auto') applyTheme('auto');
  });
}

function applyTheme(theme: Theme): void {
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('dark', isDark);
}

async function renderUpdateBanner(): Promise<void> {
  const banner = document.getElementById('updateBanner');
  const link = document.getElementById('updateLink') as HTMLAnchorElement | null;
  const versionEl = document.getElementById('updateVersion');
  const dismissBtn = document.getElementById('updateDismissBtn');
  if (!banner || !link || !versionEl || !dismissBtn) return;

  let state: { current: string; available: { latestVersion: string; releaseUrl: string } | null; dismissed: string | null };
  try {
    state = await sendMessageToBackground({ action: 'GET_UPDATE_INFO' });
  } catch {
    return;
  }

  if (!state?.available) return;
  if (state.dismissed === state.available.latestVersion) return;

  versionEl.textContent = state.available.latestVersion;
  link.href = state.available.releaseUrl;
  banner.classList.add('visible');

  dismissBtn.addEventListener('click', async () => {
    banner.classList.remove('visible');
    try {
      await sendMessageToBackground({
        action: 'DISMISS_UPDATE',
        payload: { version: state.available!.latestVersion },
      });
    } catch {
      // ignore
    }
  });
}

async function loadPopup(): Promise<void> {
  try {
    showLoading('Checking current tab...');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id || null;

    if (!activeTabId || !tab.url || !isYouTubeWatchUrl(tab.url)) {
      showEmptyState('Open a YouTube video, then click the extension again.');
      return;
    }

    await ensureContentScript(activeTabId);

    currentVideo = await sendMessageToTab<VideoInfo>(activeTabId, { action: 'GET_VIDEO_INFO' });
    if (!currentVideo?.videoId) {
      currentVideo = {
        videoId: new URL(tab.url).searchParams.get('v'),
        title: tab.title?.replace(/\s+-\s+YouTube$/, '') || 'YouTube video',
        channel: 'Unknown channel',
        handle: '',
      };
    }

    if (!currentVideo.videoId) {
      showEmptyState('Open a YouTube video, then click the extension again.');
      return;
    }

    const cached = await sendMessageToBackground({
      action: 'GET_CACHED_SUMMARY',
      payload: { videoId: currentVideo.videoId },
    });

    const currentData = await sendMessageToBackground({ action: 'GET_CURRENT_DATA' });
    conversationHistory = currentData.conversationHistory || [];

    if (cached?.success && cached.summary) {
      showSummary(cached.summary, true);
      return;
    }

    const apiKey = await StorageService.getApiKey();
    if (!apiKey) {
      showSetupState();
      return;
    }

    await summarizeCurrentVideo(false);
  } catch (error) {
    showError(getErrorMessage(error));
  }
}

async function summarizeCurrentVideo(force: boolean): Promise<void> {
  if (!activeTabId || !currentVideo?.videoId || isBusy) {
    return;
  }

  try {
    isBusy = true;
    showLoading(force ? 'Regenerating summary...' : 'Reading transcript...');

    const transcriptResponse = await sendMessageToTab<{ success: boolean; transcript?: string; error?: string }>(
      activeTabId,
      { action: 'GET_TRANSCRIPT' }
    );

    if (!transcriptResponse?.success || !transcriptResponse.transcript) {
      throw new Error(transcriptResponse?.error || 'No transcript was found for this video.');
    }

    showLoading('Summarizing transcript...');

    const response = await sendMessageToBackground({
      action: 'PROCESS_TRANSCRIPT',
      payload: {
        videoId: currentVideo.videoId,
        transcript: transcriptResponse.transcript,
        force,
      },
    });

    if (!response?.success || !response.summary) {
      throw new Error(response?.error || 'Summary generation failed.');
    }

    conversationHistory = [];
    showSummary(response.summary, response.fromCache === true);
  } catch (error) {
    showError(getErrorMessage(error));
  } finally {
    isBusy = false;
  }
}

function showLoading(message: string): void {
  contentDiv.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'state state-loading';

  const spinner = document.createElement('div');
  spinner.className = 'spinner';

  const text = document.createElement('p');
  text.textContent = message;

  wrapper.append(spinner, text);
  contentDiv.appendChild(wrapper);
}

function showEmptyState(message: string): void {
  contentDiv.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'state';

  const text = document.createElement('p');
  text.textContent = message;

  wrapper.appendChild(text);
  contentDiv.appendChild(wrapper);
}

function showSetupState(): void {
  contentDiv.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'state';

  const title = document.createElement('h2');
  title.textContent = 'OpenRouter API key required';

  const text = document.createElement('p');
  text.textContent = 'Add your OpenRouter API key in settings before summarizing videos.';

  const button = document.createElement('button');
  button.className = 'primary-btn';
  button.textContent = 'Open Settings';
  button.addEventListener('click', () => chrome.runtime.openOptionsPage());

  wrapper.append(title, text, button);
  contentDiv.appendChild(wrapper);
}

function showError(message: string): void {
  contentDiv.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'state';

  const error = document.createElement('div');
  error.className = 'error';
  error.textContent = message;

  const retry = document.createElement('button');
  retry.className = 'secondary-btn';
  retry.textContent = 'Try Again';
  retry.addEventListener('click', () => loadPopup());

  wrapper.append(error, retry);
  contentDiv.appendChild(wrapper);
}

function showSummary(summary: string, fromCache: boolean): void {
  contentDiv.innerHTML = '';
  const summaryWithMetadata = formatSummaryWithMetadata(summary);

  const videoBlock = document.createElement('section');
  videoBlock.className = 'video-block';

  const title = document.createElement('h2');
  title.textContent = currentVideo?.title || 'YouTube video';

  const channel = document.createElement('p');
  channel.textContent = formatChannelLine();

  videoBlock.append(title, channel);

  const summarySection = document.createElement('section');
  summarySection.className = 'summary-section';

  const summaryHeader = document.createElement('div');
  summaryHeader.className = 'section-header';

  const summaryTitle = document.createElement('h3');
  summaryTitle.textContent = fromCache ? 'Summary' : 'Summary';

  const actions = document.createElement('div');
  actions.className = 'actions-stack';

  const row1 = document.createElement('div');
  row1.className = 'inline-actions';

  const lengthSelect = document.createElement('select');
  lengthSelect.className = 'length-select';
  lengthSelect.title = 'Summary length';
  for (const opt of SUMMARY_LENGTH_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    lengthSelect.appendChild(o);
  }
  let lastLengthValue: SummaryLength = 'normal';
  void StorageService.getPreferences().then(p => {
    lengthSelect.value = p.summaryLength;
    lastLengthValue = p.summaryLength;
  });
  lengthSelect.addEventListener('change', async () => {
    const next = lengthSelect.value as SummaryLength;
    const labelOf = (id: string) => SUMMARY_LENGTH_OPTIONS.find(o => o.id === id)?.label || id;
    const ok = window.confirm(`Regenerate summary as "${labelOf(next)}"? This will use API credits.`);
    if (!ok) {
      lengthSelect.value = lastLengthValue;
      return;
    }
    lastLengthValue = next;
    await persistSummaryLength(next);
    void summarizeCurrentVideo(true);
  });

  const regenerateButton = document.createElement('button');
  regenerateButton.className = 'icon-btn';
  regenerateButton.textContent = 'Regenerate';
  regenerateButton.addEventListener('click', () => summarizeCurrentVideo(true));

  row1.append(lengthSelect, regenerateButton);

  const row2 = document.createElement('div');
  row2.className = 'inline-actions';

  const copyButton = document.createElement('button');
  copyButton.className = 'icon-btn';
  copyButton.textContent = 'Copy';
  copyButton.addEventListener('click', () => copySummary(summaryWithMetadata, copyButton));

  const copyJsonButton = document.createElement('button');
  copyJsonButton.className = 'icon-btn';
  copyJsonButton.textContent = 'JSON copy';
  copyJsonButton.addEventListener('click', () => void copySummaryJson(copyJsonButton, summary));

  const copyTranscriptButton = document.createElement('button');
  copyTranscriptButton.className = 'icon-btn';
  copyTranscriptButton.textContent = 'Copy transcript';
  copyTranscriptButton.addEventListener('click', () => copyTranscript(copyTranscriptButton));

  const copyTranscriptJsonButton = document.createElement('button');
  copyTranscriptJsonButton.className = 'icon-btn';
  copyTranscriptJsonButton.textContent = 'Copy JSON transcript';
  copyTranscriptJsonButton.addEventListener('click', () => void copyTranscriptJson(copyTranscriptJsonButton));

  row2.append(copyButton, copyJsonButton, copyTranscriptButton, copyTranscriptJsonButton);

  actions.append(row1, row2);
  summaryHeader.append(summaryTitle, actions);

  const summaryContent = document.createElement('pre');
  summaryContent.className = 'summary-content';
  summaryContent.textContent = summaryWithMetadata;

  summarySection.append(summaryHeader, summaryContent);

  const qaSection = createQuestionSection();

  contentDiv.append(videoBlock, summarySection, qaSection);
  renderConversation();
}

function formatSummaryWithMetadata(summary: string): string {
  return withCopyHeader(
    {
      title: currentVideo?.title,
      channel: currentVideo?.channel,
      handle: currentVideo?.handle,
      channelUrl: currentVideo?.channelUrl,
      videoUrl: currentVideo?.url,
      videoId: currentVideo?.videoId,
    },
    summary
  );
}

function formatChannelLine(): string {
  const channel = currentVideo?.channel?.trim();
  const handle = currentVideo?.handle?.trim();

  if (channel && handle && channel !== handle) {
    return `${channel} (${handle})`;
  }

  return channel || handle || '';
}

function createQuestionSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'qa-section';

  const title = document.createElement('h3');
  title.textContent = 'Ask About This Video';

  const chat = document.createElement('div');
  chat.className = 'chat-container';
  chat.id = 'chatContainer';

  const modelRow = document.createElement('div');
  modelRow.className = 'model-row';

  const modelLabel = document.createElement('label');
  modelLabel.className = 'model-label';
  modelLabel.htmlFor = 'qaModelSelect';
  modelLabel.textContent = 'Q&A model';

  const modelSelect = document.createElement('select');
  modelSelect.id = 'qaModelSelect';
  modelSelect.className = 'model-select';
  for (const option of MODEL_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = option.id;
    opt.textContent = option.label;
    modelSelect.appendChild(opt);
  }
  modelSelect.addEventListener('change', () => {
    void persistQaModel(modelSelect.value);
  });

  modelRow.append(modelLabel, modelSelect);

  void StorageService.getPreferences().then(prefs => {
    modelSelect.value = prefs.qaModel;
  });

  const inputRow = document.createElement('div');
  inputRow.className = 'input-row';

  const input = document.createElement('input');
  input.id = 'questionInput';
  input.className = 'question-input';
  input.placeholder = 'Ask a question';
  input.type = 'text';
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void askQuestion();
    }
  });

  const askButton = document.createElement('button');
  askButton.id = 'askBtn';
  askButton.className = 'primary-btn';
  askButton.textContent = 'Ask';
  askButton.addEventListener('click', () => void askQuestion());

  inputRow.append(input, askButton);
  section.append(title, chat, modelRow, inputRow);

  return section;
}

async function persistQaModel(model: string): Promise<void> {
  const prefs = await StorageService.getPreferences();
  if (prefs.qaModel === model) return;
  await StorageService.setPreferences({ ...prefs, qaModel: model });
}

async function persistSummaryLength(length: SummaryLength): Promise<void> {
  const prefs = await StorageService.getPreferences();
  if (prefs.summaryLength === length) return;
  await StorageService.setPreferences({ ...prefs, summaryLength: length });
  await sendMessageToBackground({ action: 'SETTINGS_UPDATED' });
}

async function copySummary(summary: string, button: HTMLButtonElement): Promise<void> {
  const originalText = button.textContent || 'Copy';

  try {
    await navigator.clipboard.writeText(summary);
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = originalText;
    }, 1400);
  } catch (error) {
    showError('Could not copy the summary to the clipboard.');
  }
}

async function copySummaryJson(button: HTMLButtonElement, summary: string): Promise<void> {
  const original = button.textContent || 'JSON copy';
  try {
    const prefs = await StorageService.getPreferences();
    const json = buildExportJson({
      video: {
        id: currentVideo?.videoId || null,
        title: currentVideo?.title || '',
        url: currentVideo?.url || (currentVideo?.videoId ? `https://www.youtube.com/watch?v=${currentVideo.videoId}` : ''),
        publishedAt: currentVideo?.publishedAt,
        durationSeconds: currentVideo?.durationSeconds,
        viewCount: currentVideo?.viewCount,
      },
      channel: {
        name: currentVideo?.channel || '',
        handle: currentVideo?.handle,
        url: currentVideo?.channelUrl,
      },
      summary,
      summaryModel: prefs.summaryModel,
      summaryLength: prefs.summaryLength,
    });
    await navigator.clipboard.writeText(json);
    button.textContent = 'Copied';
    window.setTimeout(() => (button.textContent = original), 1400);
  } catch (error) {
    showError(getErrorMessage(error));
  }
}

async function copyTranscriptJson(button: HTMLButtonElement): Promise<void> {
  const original = button.textContent || 'Copy JSON transcript';
  try {
    const data = await sendMessageToBackground({ action: 'GET_CURRENT_DATA' });
    const transcript = (data?.transcript || '').trim();
    if (!transcript) {
      throw new Error('No transcript loaded yet.');
    }
    const json = buildExportJson({
      video: {
        id: currentVideo?.videoId || null,
        title: currentVideo?.title || '',
        url: currentVideo?.url || (currentVideo?.videoId ? `https://www.youtube.com/watch?v=${currentVideo.videoId}` : ''),
        publishedAt: currentVideo?.publishedAt,
        durationSeconds: currentVideo?.durationSeconds,
        viewCount: currentVideo?.viewCount,
      },
      channel: {
        name: currentVideo?.channel || '',
        handle: currentVideo?.handle,
        url: currentVideo?.channelUrl,
      },
      transcript,
    });
    await navigator.clipboard.writeText(json);
    button.textContent = 'Copied';
    window.setTimeout(() => (button.textContent = original), 1400);
  } catch (error) {
    showError(getErrorMessage(error));
  }
}

async function copyTranscript(button: HTMLButtonElement): Promise<void> {
  const originalText = button.textContent || 'Copy transcript';

  try {
    const data = await sendMessageToBackground({ action: 'GET_CURRENT_DATA' });
    const transcript = (data?.transcript || '').trim();
    if (!transcript) {
      throw new Error('No transcript loaded yet.');
    }

    const transcriptWithHeader = withCopyHeader(
      {
        title: currentVideo?.title,
        channel: currentVideo?.channel,
        handle: currentVideo?.handle,
        channelUrl: currentVideo?.channelUrl,
        videoUrl: currentVideo?.url,
        videoId: currentVideo?.videoId,
      },
      transcript
    );

    await navigator.clipboard.writeText(transcriptWithHeader);
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = originalText;
    }, 1400);
  } catch (error) {
    showError(getErrorMessage(error));
  }
}

async function askQuestion(): Promise<void> {
  const input = document.getElementById('questionInput') as HTMLInputElement | null;
  const askButton = document.getElementById('askBtn') as HTMLButtonElement | null;
  const question = input?.value.trim();

  if (!question || isBusy || !input || !askButton) {
    return;
  }

  try {
    isBusy = true;
    askButton.disabled = true;
    askButton.textContent = '...';

    input.value = '';
    addChatMessage('user', question);

    const response = await sendMessageToBackground({
      action: 'ASK_QUESTION',
      payload: { question },
    });

    if (!response?.answer) {
      throw new Error(response?.error || 'No answer was generated.');
    }

    addChatMessage('assistant', response.answer);
  } catch (error) {
    addChatMessage('assistant', getErrorMessage(error));
  } finally {
    isBusy = false;
    askButton.disabled = false;
    askButton.textContent = 'Ask';
    input.focus();
  }
}

function renderConversation(): void {
  const chat = document.getElementById('chatContainer');
  if (!chat) {
    return;
  }

  chat.innerHTML = '';
  conversationHistory.forEach(({ role, content }) => addChatMessage(role, content, false));
}

function addChatMessage(role: string, message: string, updateHistory = true): void {
  const chat = document.getElementById('chatContainer');
  if (!chat) {
    return;
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}`;
  messageDiv.textContent = message;

  chat.appendChild(messageDiv);
  chat.scrollTop = chat.scrollHeight;

  if (updateHistory) {
    conversationHistory.push({ role, content: message });
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await sendMessageToTab(tabId, { action: 'PING' }, false);
  } catch (error) {
    const contentScriptFile =
      chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0] || 'content.js';

    await (chrome as any).scripting.executeScript({
      target: { tabId },
      files: [contentScriptFile],
    });
    await sendMessageToTab(tabId, { action: 'PING' }, false);
  }
}

function sendMessageToTab<T>(tabId: number, message: Message, throwOnError = true): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) {
        const error = new Error(chrome.runtime.lastError.message);
        if (throwOnError) {
          reject(error);
        } else {
          reject(error);
        }
        return;
      }

      resolve(response as T);
    });
  });
}

function sendMessageToBackground(message: Message): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

function isYouTubeWatchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('youtube.com') && parsed.pathname === '/watch' && parsed.searchParams.has('v');
  } catch (error) {
    return false;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
