# YouTube Transcript Summarizer

Chrome extension that summarizes the current YouTube video from its transcript using OpenRouter.

## Features

### Two surfaces, one workflow
- **Popup** — click the extension icon for a focused summary + Q&A panel.
- **In-page panel** — a Shadow-DOM-isolated panel injected into the YouTube sidebar (`#secondary-inner`). Mounts automatically on watch pages, follows SPA navigation, with a per-page minimize and close button.

### Summarization
- Three summary lengths: **Concise** (3–5 one-line bullets), **Normal** (balanced overview), **Extended** (8–14 bullets, sub-points, and caveats). Each length uses its own system prompt and token budget.
- Length selector lives directly in the summary header on both surfaces.
- Switching length prompts a yes/no confirmation before regenerating (since it spends API credits).
- Per-video summary caching keyed by video id.

### Q&A about the video
- Ask follow-up questions in the popup or the in-page panel — answers are streamed from a separate **Q&A model** (independent from the summary model).
- Q&A model selector sits right above the question input on both surfaces; switching persists immediately.
- The assistant uses the transcript as primary context but can also handle interpretation, opinion, and background questions, calling out when it goes beyond what's in the transcript.

### Transcript extraction
- Falls back through several strategies: YouTube DOM transcript panel → transcript-panel endpoint → caption tracks (json3, srv3, srv1, ttml, vtt, original).
- Up to **10 retry attempts** with linear backoff (500ms → 3s) before giving up; each attempt builds a fresh extractor so cached failures don't poison the next try.

### Copy / export
- Two-row action header: **Length | Regenerate** on row 1, **Copy | Copy as JSON | Copy transcript | Copy transcript as JSON** on row 2.
- Plain-text copies prepend a metadata header (title, channel + handle + channel URL, video URL).
- JSON exports produce a structured object suitable for memory systems / pipelines:
  ```json
  {
    "video": { "id", "title", "url", "publishedAt", "durationSeconds", "viewCount" },
    "channel": { "name", "handle", "url" },
    "summary" or "transcript": "...",
    "meta": { "extractedAt", "extension", "summaryModel", "summaryLength" }
  }
  ```
- `extractedAt` is the ISO timestamp of the copy; `publishedAt` is the video's upload date (read from YouTube's microformat tags).

### Theme
- Manual theme switcher in popup, in-page panel, and options page: **Auto** (follows OS), **Light**, **Dark**. Dark mode uses a black background with white text.

### Update notifier
- Background `chrome.alarms` checks GitHub Releases daily, sets a `NEW` badge on the extension icon, and shows a dismissible banner in the popup with a link to the latest release.

### Storage hygiene
- Cache auto-evicts the oldest entries once total cache exceeds **10 MB**.
- Settings panel shows current usage and a manual **Clear cache** button.

### Models
- Configurable per-role: `summaryModel` and `qaModel` are independent. Built-in options include Gemini 2.5 Flash Lite, Claude Sonnet 4.5, Llama 3.3 70B, Mistral Small 3.2 24B, and OpenRouter Auto. Legacy single-model configs migrate automatically.

## Requirements

- Chrome or another Chromium browser with extension developer mode
- OpenRouter API key
- Node.js and npm (only required if building from source)

## Install (recommended)

1. Download the latest `youtube-transcript-summarizer-vX.Y.Z.zip` from the [Releases page](https://github.com/avdan/youtube-transcript-summarizer/releases/latest).
2. Unzip it anywhere on your machine.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the unzipped folder.
6. Confirm the extension card shows the expected version.

## Install from source

Use this path if you want to modify the extension or run an unreleased version.

Install dependencies:

```bash
npm install
```

Create local env reference from the example if needed:

```bash
cp .env.example .env
```

The extension does not read `.env` directly at runtime. Add the OpenRouter key in the extension Settings page after loading the extension.

Build the extension:

```bash
npm run build
```

Then load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `dist/` folder.

After every code change, run `npm run build`, then click the reload button on the extension card.

## Use

1. Open a YouTube watch page.
2. Click the extension icon.
3. If prompted, open Settings and save your OpenRouter API key.
4. Click the extension icon again.
5. The popup extracts the transcript, summarizes the video, and shows a question box for follow-up questions.

## Releasing

Tag and push a new version to trigger the GitHub Actions release workflow, which builds `dist/`, zips it, and attaches the zip to a new GitHub Release:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

Some YouTube videos only expose transcript text through the visible transcript panel. In that case, the extension may scroll to the description, click **Show transcript**, and read the rendered panel.

## Scripts

```bash
npm run type-check
npm run build
npm run dev
npm run clean
```

## Project Structure

- `src/content/index.ts` — content script entry; mounts the in-page panel and handles transcript message requests.
- `src/content/inPagePanel.ts` — Shadow-DOM-isolated panel rendered on YouTube watch pages.
- `src/content/youtubeTranscriptAPI.ts` — multi-strategy transcript extraction with retry helper.
- `src/popup/index.ts`, `src/popup/popup.html` — popup workflow and UI state.
- `src/options/index.ts`, `src/options/options.html` — Settings page.
- `src/background/index.ts` — caching, extension messages, OpenRouter calls, update checker.
- `src/background/updateChecker.ts` — daily GitHub Releases check with badge + banner.
- `src/api/openrouter.ts` — OpenRouter Chat Completions wrapper with per-call model override.
- `src/constants/models.ts` — shared model list, summary lengths, theme options.
- `src/utils/storage.ts` — preferences storage and cache eviction.
- `src/utils/copyHeader.ts` — plain-text copy header (title / channel / URL).
- `src/utils/jsonExport.ts` — JSON export builder for summaries and transcripts.
- `public/manifest.json` — source manifest, version-synced to `package.json` on `npm version`.
- `scripts/sync-manifest-version.js` — keeps `public/manifest.json` aligned with `package.json`.
- `scripts/generate-icons.js` — generates extension PNG icons.
- `.github/workflows/release.yml` — on `v*` tag push, builds `dist/`, zips, and attaches to a GitHub Release.

## Notes

- `.env` is intentionally ignored because it can contain API keys.
- `dist/` is ignored because it is generated by `npm run build`.
- Load `dist/` in Chrome for normal testing.

## License

MIT. See [LICENSE](LICENSE).
