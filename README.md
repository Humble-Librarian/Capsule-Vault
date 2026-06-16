# Context Vault

A Chrome extension that auto-saves and retrieves browsing context from AI chat platforms. All data stays local — no cloud, no accounts.

## Features

- **Auto-capture** conversations from ChatGPT, Claude, Gemini, Perplexity, Mistral, DeepSeek, Copilot, Grok, and Kimi
- **Floating action button (FAB)** appears on AI chat sites for quick save and memory drop
- **Save selected text** via context menu or keyboard shortcut
- **Search, edit, delete, pin** memories from the popup
- **Drop memories into chat** — paste saved context directly into any supported AI input
- **Export/Import** all memories as JSON
- **Keyword extraction** and relevance-based retrieval
- **Dark theme** UI
- **Draggable FAB** — reposition anywhere on the page

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project directory

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Save selected text to Context Vault |
| `Ctrl+Shift+O` | Open Context Vault popup |
| `Ctrl+F` | Focus search (when popup is open) |
| `Ctrl+Enter` | Save (in modal dialogs) |

## How It Works

### Content Script (`src/content.js`)
- Injects a floating vault button on supported AI chat sites
- Extracts page content using platform-specific selectors
- Provides a save modal for captured text
- Allows dropping saved memories into chat inputs

### Background Service Worker (`src/background.js`)
- Handles message routing between popup, content scripts, and storage
- Processes and stores memories
- Manages context menu and keyboard shortcuts

### Processor (`src/processor.js`)
- Normalizes raw input into a standard memory format
- Auto-generates titles from content
- Extracts keywords using frequency analysis

### Retrieval (`src/retrieval.js`)
- Ranks memories by keyword match and recency
- Returns top-N results within a character budget

### Storage (`src/db.js`)
- IndexedDB-backed local storage
- Stores up to 250 memories

## Supported Platforms

| Platform | Domain |
|----------|--------|
| ChatGPT | chatgpt.com, chat.openai.com |
| Claude | claude.ai |
| Gemini | gemini.google.com |
| Perplexity | perplexity.ai |
| Mistral | chat.mistral.ai |
| DeepSeek | chat.deepseek.com, deepseek.com |
| Copilot | copilot.microsoft.com |
| Grok | grok.com, x.ai |
| Kimi | kimi.moonshot.cn, kimi.ai |

## Project Structure

```
Context-Vault/
├── manifest.json        # Extension manifest (Manifest V3)
├── popup.html           # Extension popup UI
├── popup.js             # Popup logic (search, CRUD, export/import)
├── popup.css            # Popup styles (dark theme)
├── icons/               # Extension icons
├── src/
│   ├── background.js    # Service worker (message handling, storage ops)
│   ├── content.js       # Content script (FAB, extraction, chat injection)
│   ├── content.css      # Content script styles
│   ├── db.js            # IndexedDB wrapper
│   ├── processor.js     # Memory normalization and keyword extraction
│   └── retrieval.js     # Ranked context retrieval
└── architecture.md      # Architecture documentation
```

## Permissions

- `storage` — Chrome storage API
- `activeTab` — Access current tab
- `tabs` — Tab management
- `scripting` — Inject content scripts
- `contextMenus` — Right-click save option

## Data

All memories are stored locally in IndexedDB. Nothing is sent to any server. Each memory contains:

- `id` — Unique identifier
- `title` — Auto-generated or manual title
- `content` — Raw saved text (up to 8,000 chars)
- `compressed` — Formatted version with metadata
- `keywords` — Extracted terms for search
- `tags` — User-defined tags
- `source` — Platform name (e.g., "ChatGPT")
- `url` — Page URL where content was captured
- `pinned` — Pin to top flag
- `createdAt` / `updatedAt` — Timestamps

## License

MIT
