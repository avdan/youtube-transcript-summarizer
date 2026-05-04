import { MODEL_OPTIONS, SUMMARY_LENGTH_OPTIONS, SummaryLength, THEME_OPTIONS, Theme } from '../constants/models';
import { fetchFormattedTranscriptWithRetry } from './youtubeTranscriptAPI';
import { withCopyHeader } from '../utils/copyHeader';
import { buildExportJson } from '../utils/jsonExport';

export interface VideoMeta {
  title: string;
  channel: string;
  handle: string;
  channelUrl: string;
  url: string;
  publishedAt?: string;
  durationSeconds?: number;
  viewCount?: number;
}

const HOST_ID = 'yts-summarizer-host';
const SESSION_HIDDEN_KEY = '__ytsHiddenInSession';

interface PanelState {
  videoId: string | null;
  videoTitle: string;
  channel: string;
  handle: string;
  channelUrl: string;
  videoUrl: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  transcript: string | null;
  summary: string | null;
  conversationHistory: Array<{ role: string; content: string }>;
  collapsed: boolean;
  busy: boolean;
}

const state: PanelState = {
  videoId: null,
  videoTitle: '',
  channel: '',
  handle: '',
  channelUrl: '',
  videoUrl: '',
  publishedAt: '',
  durationSeconds: 0,
  viewCount: 0,
  transcript: null,
  summary: null,
  conversationHistory: [],
  collapsed: false,
  busy: false,
};

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let mountObserver: MutationObserver | null = null;

export function mountInPagePanel(): void {
  ensureMounted();
  observeMountPoint();
}

export function onVideoChanged(videoId: string | null, meta: VideoMeta): void {
  state.videoId = videoId;
  state.videoTitle = meta.title;
  state.channel = meta.channel;
  state.handle = meta.handle;
  state.channelUrl = meta.channelUrl;
  state.videoUrl = meta.url;
  state.publishedAt = meta.publishedAt || '';
  state.durationSeconds = meta.durationSeconds || 0;
  state.viewCount = meta.viewCount || 0;
  state.transcript = null;
  state.summary = null;
  state.conversationHistory = [];
  state.busy = false;
  renderBody();
  if (videoId && host && shadow) {
    void loadOrSummarize(false);
  }
}

function observeMountPoint(): void {
  if (mountObserver) return;
  mountObserver = new MutationObserver(() => {
    ensureMounted();
  });
  mountObserver.observe(document.body, { childList: true, subtree: true });
}

function findMountPoint(): HTMLElement | null {
  return (
    document.querySelector('#secondary-inner') as HTMLElement | null
  ) || (document.querySelector('#secondary') as HTMLElement | null);
}

function ensureMounted(): void {
  if ((window as any)[SESSION_HIDDEN_KEY]) return;
  if (host && document.body.contains(host)) return;

  const mountPoint = findMountPoint();
  if (!mountPoint) return;

  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.display = 'block';
  host.style.marginBottom = '12px';
  shadow = host.attachShadow({ mode: 'open' });
  renderShell();
  mountPoint.insertBefore(host, mountPoint.firstChild);

  if (state.videoId) {
    void loadOrSummarize(false);
  }
}

function renderShell(): void {
  if (!shadow) return;
  while (shadow.firstChild) shadow.removeChild(shadow.firstChild);

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.className = 'panel';

  const header = document.createElement('header');
  header.className = 'panel-header';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'Video Summary';

  const headerActions = document.createElement('div');
  headerActions.className = 'panel-actions';

  const themeSelect = document.createElement('select');
  themeSelect.className = 'theme-select';
  themeSelect.title = 'Theme';
  for (const opt of THEME_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    themeSelect.appendChild(o);
  }
  void getPreferences().then(p => {
    const t: Theme = p?.theme || 'auto';
    themeSelect.value = t;
    applyPanelTheme(t);
  });
  themeSelect.addEventListener('change', async () => {
    const value = themeSelect.value as Theme;
    const prefs = (await getPreferences()) || {};
    await chrome.storage.sync.set({ preferences: { ...prefs, theme: value } });
    applyPanelTheme(value);
  });
  headerActions.appendChild(themeSelect);

  const minimizeBtn = document.createElement('button');
  minimizeBtn.className = 'icon-btn';
  minimizeBtn.type = 'button';
  minimizeBtn.title = state.collapsed ? 'Expand' : 'Minimize';
  minimizeBtn.setAttribute('aria-label', state.collapsed ? 'Expand' : 'Minimize');
  minimizeBtn.textContent = state.collapsed ? '+' : '–';
  minimizeBtn.addEventListener('click', () => {
    state.collapsed = !state.collapsed;
    renderShell();
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn';
  closeBtn.type = 'button';
  closeBtn.title = 'Close for this page';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    (window as any)[SESSION_HIDDEN_KEY] = true;
    if (host && host.parentElement) {
      host.parentElement.removeChild(host);
    }
    host = null;
    shadow = null;
  });

  headerActions.append(minimizeBtn, closeBtn);
  header.append(title, headerActions);
  wrapper.appendChild(header);

  const body = document.createElement('div');
  body.className = 'panel-body';
  body.id = 'panel-body';
  if (state.collapsed) {
    body.classList.add('hidden');
  }
  wrapper.appendChild(body);

  shadow.appendChild(wrapper);
  renderBody();
}

function renderBody(): void {
  if (!shadow) return;
  const body = shadow.getElementById('panel-body');
  if (!body) return;
  while (body.firstChild) body.removeChild(body.firstChild);

  if (!state.videoId) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Open a YouTube video to see a summary here.';
    body.appendChild(empty);
    return;
  }

  if (state.busy && !state.summary) {
    const spinner = document.createElement('div');
    spinner.className = 'spinner-row';
    const sp = document.createElement('div');
    sp.className = 'spinner';
    const txt = document.createElement('span');
    txt.textContent = 'Generating summary…';
    spinner.append(sp, txt);
    body.appendChild(spinner);
    return;
  }

  if (state.summary) {
    const summaryBlock = document.createElement('section');
    summaryBlock.className = 'summary-block';

    const summaryHeader = document.createElement('div');
    summaryHeader.className = 'sub-header';
    const sLabel = document.createElement('h3');
    sLabel.textContent = 'Summary';
    const sActions = document.createElement('div');
    sActions.className = 'actions-stack';

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
    let lastLength: SummaryLength = 'normal';
    void getStoredPrefs().then(p => {
      if (p?.summaryLength) {
        lengthSelect.value = p.summaryLength;
        lastLength = p.summaryLength;
      }
    });
    lengthSelect.addEventListener('change', async () => {
      const next = lengthSelect.value as SummaryLength;
      const labelOf = (id: string) => SUMMARY_LENGTH_OPTIONS.find(o => o.id === id)?.label || id;
      const ok = window.confirm(`Regenerate summary as "${labelOf(next)}"? This will use API credits.`);
      if (!ok) {
        lengthSelect.value = lastLength;
        return;
      }
      lastLength = next;
      await persistSummaryLength(next);
      void loadOrSummarize(true);
    });

    const regenBtn = document.createElement('button');
    regenBtn.className = 'tiny-btn';
    regenBtn.type = 'button';
    regenBtn.textContent = 'Regenerate';
    regenBtn.addEventListener('click', () => void loadOrSummarize(true));

    row1.append(lengthSelect, regenBtn);

    const row2 = document.createElement('div');
    row2.className = 'inline-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'tiny-btn';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      const payload = withCopyHeader(buildHeaderInfo(), state.summary || '');
      void navigator.clipboard.writeText(payload).then(() => {
        copyBtn.textContent = 'Copied';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
      });
    });

    const copyJsonBtn = document.createElement('button');
    copyJsonBtn.className = 'tiny-btn';
    copyJsonBtn.type = 'button';
    copyJsonBtn.textContent = 'JSON copy';
    copyJsonBtn.addEventListener('click', () => void copySummaryAsJson(copyJsonBtn));

    const copyTranscriptBtn = document.createElement('button');
    copyTranscriptBtn.className = 'tiny-btn';
    copyTranscriptBtn.type = 'button';
    copyTranscriptBtn.textContent = 'Copy transcript';
    copyTranscriptBtn.addEventListener('click', () => void copyTranscript(copyTranscriptBtn));

    const copyTranscriptJsonBtn = document.createElement('button');
    copyTranscriptJsonBtn.className = 'tiny-btn';
    copyTranscriptJsonBtn.type = 'button';
    copyTranscriptJsonBtn.textContent = 'Copy JSON transcript';
    copyTranscriptJsonBtn.addEventListener('click', () => void copyTranscriptAsJson(copyTranscriptJsonBtn));

    row2.append(copyBtn, copyJsonBtn, copyTranscriptBtn, copyTranscriptJsonBtn);

    sActions.append(row1, row2);
    summaryHeader.append(sLabel, sActions);

    const summaryText = document.createElement('pre');
    summaryText.className = 'summary-content';
    summaryText.textContent = state.summary;

    summaryBlock.append(summaryHeader, summaryText);
    body.appendChild(summaryBlock);

    body.appendChild(buildQaSection());
  } else {
    const generate = document.createElement('button');
    generate.className = 'primary-btn';
    generate.type = 'button';
    generate.textContent = state.busy ? 'Working…' : 'Generate summary';
    generate.disabled = state.busy;
    generate.addEventListener('click', () => void loadOrSummarize(true));
    body.appendChild(generate);
  }
}

function buildQaSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'qa-section';

  const title = document.createElement('h3');
  title.textContent = 'Ask about this video';
  section.appendChild(title);

  const chat = document.createElement('div');
  chat.className = 'chat-container';
  chat.id = 'chat-container';
  for (const msg of state.conversationHistory) {
    chat.appendChild(buildChatMessage(msg.role, msg.content));
  }
  section.appendChild(chat);

  const modelRow = document.createElement('div');
  modelRow.className = 'model-row';

  const modelLabel = document.createElement('label');
  modelLabel.className = 'model-label';
  modelLabel.htmlFor = 'qa-model-select';
  modelLabel.textContent = 'Q&A model';

  const modelSelect = document.createElement('select');
  modelSelect.id = 'qa-model-select';
  modelSelect.className = 'model-select';
  for (const opt of MODEL_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    modelSelect.appendChild(o);
  }
  modelSelect.addEventListener('change', () => {
    void persistQaModel(modelSelect.value);
  });

  void getPreferences().then(prefs => {
    if (prefs?.qaModel) modelSelect.value = prefs.qaModel;
  });

  modelRow.append(modelLabel, modelSelect);
  section.appendChild(modelRow);

  const inputRow = document.createElement('div');
  inputRow.className = 'input-row';

  const input = document.createElement('input');
  input.id = 'qa-input';
  input.className = 'question-input';
  input.type = 'text';
  input.placeholder = 'Ask a question';
  // YouTube binds global keyboard shortcuts (space = play/pause, j/k/l = seek, etc.)
  // on document. Stop propagation so they don't fire while typing in our input.
  const stopKey = (event: Event) => event.stopPropagation();
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      void askQuestion();
    }
  });
  input.addEventListener('keyup', stopKey);
  input.addEventListener('keypress', stopKey);

  const askBtn = document.createElement('button');
  askBtn.id = 'qa-ask';
  askBtn.className = 'primary-btn';
  askBtn.type = 'button';
  askBtn.textContent = 'Ask';
  askBtn.addEventListener('click', () => void askQuestion());

  inputRow.append(input, askBtn);
  section.appendChild(inputRow);

  return section;
}

function buildChatMessage(role: string, content: string): HTMLElement {
  const div = document.createElement('div');
  div.className = role === 'assistant' ? 'message assistant' : 'message user';
  div.textContent = content;
  return div;
}

async function loadOrSummarize(force: boolean): Promise<void> {
  if (!state.videoId || state.busy) return;
  state.busy = true;
  renderBody();

  try {
    if (!force) {
      const cached = await sendBackground({
        action: 'GET_CACHED_SUMMARY',
        payload: { videoId: state.videoId },
      });
      if (cached?.success && cached.summary) {
        state.summary = cached.summary;
        state.transcript = cached.transcript || null;
        state.busy = false;
        renderBody();
        return;
      }
    }

    if (!state.transcript) {
      state.transcript = await fetchFormattedTranscriptWithRetry(state.videoId);
    }

    const response = await sendBackground({
      action: 'PROCESS_TRANSCRIPT',
      payload: { videoId: state.videoId, transcript: state.transcript, force },
    });

    if (!response?.success || !response.summary) {
      throw new Error(response?.error || 'Failed to generate summary');
    }

    state.summary = response.summary;
    state.conversationHistory = [];
  } catch (error) {
    state.summary = `Could not generate a summary: ${getErrorMessage(error)}`;
  } finally {
    state.busy = false;
    renderBody();
  }
}

function buildHeaderInfo() {
  return {
    title: state.videoTitle,
    channel: state.channel,
    handle: state.handle,
    channelUrl: state.channelUrl,
    videoUrl: state.videoUrl,
    videoId: state.videoId,
  };
}

function buildExportPayload(includeSummary: boolean, includeTranscript: boolean, prefs: any): string {
  return buildExportJson({
    video: {
      id: state.videoId,
      title: state.videoTitle,
      url: state.videoUrl || (state.videoId ? `https://www.youtube.com/watch?v=${state.videoId}` : ''),
      publishedAt: state.publishedAt,
      durationSeconds: state.durationSeconds,
      viewCount: state.viewCount,
    },
    channel: {
      name: state.channel,
      handle: state.handle,
      url: state.channelUrl,
    },
    summary: includeSummary ? state.summary || '' : undefined,
    transcript: includeTranscript ? state.transcript || '' : undefined,
    summaryModel: prefs?.summaryModel,
    summaryLength: prefs?.summaryLength,
  });
}

async function copySummaryAsJson(button: HTMLButtonElement): Promise<void> {
  const original = button.textContent || 'JSON copy';
  try {
    if (!state.summary) throw new Error('No summary loaded.');
    const prefs = (await getPreferences()) || {};
    const json = buildExportPayload(true, false, prefs);
    await navigator.clipboard.writeText(json);
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = original), 1200);
  } catch (error) {
    button.textContent = 'Failed';
    setTimeout(() => (button.textContent = original), 1500);
    console.warn('Copy summary JSON failed:', error);
  }
}

async function copyTranscriptAsJson(button: HTMLButtonElement): Promise<void> {
  const original = button.textContent || 'Copy JSON transcript';
  try {
    let transcript = (state.transcript || '').trim();
    if (!transcript && state.videoId) {
      transcript = (await fetchFormattedTranscriptWithRetry(state.videoId)).trim();
      state.transcript = transcript;
    }
    if (!transcript) throw new Error('No transcript available.');
    const prefs = (await getPreferences()) || {};
    const json = buildExportPayload(false, true, prefs);
    await navigator.clipboard.writeText(json);
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = original), 1200);
  } catch (error) {
    button.textContent = 'Failed';
    setTimeout(() => (button.textContent = original), 1500);
    console.warn('Copy transcript JSON failed:', error);
  }
}

async function copyTranscript(button: HTMLButtonElement): Promise<void> {
  const original = button.textContent || 'Copy transcript';
  try {
    let transcript = (state.transcript || '').trim();
    if (!transcript && state.videoId) {
      transcript = (await fetchFormattedTranscriptWithRetry(state.videoId)).trim();
      state.transcript = transcript;
    }
    if (!transcript) {
      throw new Error('No transcript available.');
    }
    const payload = withCopyHeader(buildHeaderInfo(), transcript);
    await navigator.clipboard.writeText(payload);
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = original), 1200);
  } catch (error) {
    button.textContent = 'Failed';
    setTimeout(() => (button.textContent = original), 1500);
    console.warn('Copy transcript failed:', error);
  }
}

async function askQuestion(): Promise<void> {
  if (!shadow || state.busy) return;
  const input = shadow.getElementById('qa-input') as HTMLInputElement | null;
  const askBtn = shadow.getElementById('qa-ask') as HTMLButtonElement | null;
  const chat = shadow.getElementById('chat-container');
  if (!input || !askBtn || !chat) return;

  const question = input.value.trim();
  if (!question) return;

  state.busy = true;
  askBtn.disabled = true;
  askBtn.textContent = '…';
  input.value = '';

  state.conversationHistory.push({ role: 'user', content: question });
  chat.appendChild(buildChatMessage('user', question));

  try {
    const response = await sendBackground({
      action: 'ASK_QUESTION',
      payload: { question },
    });

    if (!response?.answer) {
      throw new Error(response?.error || 'No answer was generated.');
    }

    state.conversationHistory.push({ role: 'assistant', content: response.answer });
    chat.appendChild(buildChatMessage('assistant', response.answer));
  } catch (error) {
    chat.appendChild(buildChatMessage('assistant', getErrorMessage(error)));
  } finally {
    state.busy = false;
    askBtn.disabled = false;
    askBtn.textContent = 'Ask';
    input.focus();
  }
}

async function persistQaModel(model: string): Promise<void> {
  const prefs = await getPreferences();
  if (!prefs || prefs.qaModel === model) return;
  await chrome.storage.sync.set({ preferences: { ...prefs, qaModel: model } });
}

function applyPanelTheme(theme: Theme): void {
  if (!shadow) return;
  const panel = shadow.querySelector('.panel');
  if (!panel) return;
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  panel.classList.toggle('dark', isDark);
}

async function persistSummaryLength(length: SummaryLength): Promise<void> {
  const prefs = await getPreferences();
  const current = prefs || {};
  if (current.summaryLength === length) return;
  await chrome.storage.sync.set({ preferences: { ...current, summaryLength: length } });
  try {
    await sendBackground({ action: 'SETTINGS_UPDATED' });
  } catch {
    // background not ready / no-op
  }
}

async function getStoredPrefs(): Promise<any> {
  return getPreferences();
}

async function getPreferences(): Promise<any> {
  const data = await chrome.storage.sync.get('preferences');
  return data.preferences || null;
}

function sendBackground(message: any): Promise<any> {
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; }

  .panel {
    margin: 0;
    color: #202124;
    background: #ffffff;
    border: 1px solid #e7e9ee;
    border-radius: 12px;
    overflow: hidden;
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: #f7f8fa;
    border-bottom: 1px solid #e7e9ee;
  }

  .panel-title {
    font-weight: 700;
    font-size: 14px;
  }

  .panel-actions {
    display: flex;
    gap: 4px;
  }

  .icon-btn {
    width: 26px;
    height: 26px;
    color: #2f343d;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .icon-btn:hover { background: #eceff4; }

  .panel-body { padding: 12px; }
  .panel-body.hidden { display: none; }

  .muted { color: #687080; margin: 0; }

  .spinner-row { display: flex; align-items: center; gap: 10px; color: #525967; }
  .spinner {
    width: 18px; height: 18px;
    border: 3px solid #eceff4;
    border-top-color: #cc1f1a;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .summary-block { margin-bottom: 14px; }

  .sub-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .sub-header h3 { margin: 0; font-size: 13px; font-weight: 700; }

  .inline-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .actions-stack { display: flex; flex-direction: column; gap: 6px; }
  .sub-header { flex-wrap: wrap; gap: 8px; }

  .tiny-btn {
    padding: 4px 7px;
    color: #2f343d;
    background: #ffffff;
    border: 1px solid #d5d9e2;
    border-radius: 6px;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .tiny-btn:hover { background: #f4f5f7; }

  .length-select {
    padding: 3px 5px;
    color: #2f343d;
    background: #ffffff;
    border: 1px solid #d5d9e2;
    border-radius: 6px;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .summary-content {
    margin: 0;
    padding: 10px;
    color: #202124;
    background: #f7f8fa;
    border: 1px solid #e7e9ee;
    border-radius: 6px;
    font-family: inherit;
    font-size: 12.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 360px;
    overflow-y: auto;
  }

  .qa-section h3 {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 700;
  }

  .chat-container {
    max-height: 200px;
    margin-bottom: 8px;
    overflow-y: auto;
  }
  .chat-container:empty { display: none; }

  .message {
    margin-bottom: 6px;
    padding: 7px 9px;
    border-radius: 6px;
    font-size: 12.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .message.user { margin-left: 32px; background: #eef4ff; }
  .message.assistant { margin-right: 32px; background: #f4f5f7; }

  .model-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .model-label {
    flex-shrink: 0;
    color: #525967;
    font-size: 11px;
    font-weight: 600;
  }
  .model-select {
    flex: 1;
    min-width: 0;
    padding: 5px 6px;
    color: #202124;
    background: #ffffff;
    border: 1px solid #d5d9e2;
    border-radius: 6px;
    font: inherit;
    font-size: 12px;
  }

  .input-row { display: flex; gap: 6px; }

  .question-input {
    min-width: 0;
    flex: 1;
    padding: 7px 9px;
    color: #202124;
    background: #ffffff;
    border: 1px solid #d5d9e2;
    border-radius: 6px;
    font: inherit;
    font-size: 12.5px;
  }
  .question-input:focus {
    border-color: #cc1f1a;
    outline: none;
    box-shadow: 0 0 0 2px rgba(204, 31, 26, 0.12);
  }

  .panel.dark { color: #f1f3f5; background: #000000; border-color: #2a2d31; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
  .panel.dark .panel-header { background: #0d0f12; border-bottom-color: #2a2d31; }
  .panel.dark .icon-btn { color: #f1f3f5; }
  .panel.dark .icon-btn:hover { background: #1a1c20; }
  .panel.dark .muted { color: #b0b6bf; }
  .panel.dark .spinner-row { color: #b0b6bf; }
  .panel.dark .spinner { border-color: #2a2d31; border-top-color: #ff5b55; }
  .panel.dark .summary-content { color: #f1f3f5; background: #0d0f12; border-color: #2a2d31; }
  .panel.dark .tiny-btn,
  .panel.dark .question-input,
  .panel.dark .model-select,
  .panel.dark .length-select,
  .panel.dark .theme-select {
    color: #f1f3f5;
    background: #111317;
    border-color: #2a2d31;
  }
  .panel.dark .tiny-btn:hover { background: #1a1c20; }
  .panel.dark .message.user { background: #16243d; color: #f1f3f5; }
  .panel.dark .message.assistant { background: #1a1c20; color: #f1f3f5; }
  .panel.dark .model-label { color: #b0b6bf; }
  .panel.dark .question-input:focus {
    border-color: #ff5b55;
    box-shadow: 0 0 0 2px rgba(255, 91, 85, 0.18);
  }

  .theme-select {
    padding: 3px 5px;
    color: #2f343d;
    background: #ffffff;
    border: 1px solid #d5d9e2;
    border-radius: 6px;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .primary-btn {
    padding: 7px 12px;
    color: #ffffff;
    background: #cc1f1a;
    border: 1px solid #cc1f1a;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary-btn:hover:not(:disabled) { background: #b51b16; }
  .primary-btn:disabled { opacity: 0.65; cursor: not-allowed; }
`;
