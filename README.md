# Context Vault

A context-aware coding assistant — Chrome extension + Python CLI. Saves browsing context from AI chats, answers codebase questions, and remembers past decisions. All data stays local.

---

## Quick Start

### Chrome Extension

1. Clone this repo
2. Open `chrome://extensions/` → Enable **Developer mode**
3. Click **Load unpacked** → select the project folder
4. Click the extension icon → **Codebase** tab → gear icon → paste your [Groq API key](https://console.groq.com/keys)

### Python CLI

```bash
pip install tree-sitter-languages sentence-transformers numpy faiss-cpu openai fastapi uvicorn
python cli/main.py init .
python cli/main.py ask "how does authentication work"
```

---

## Chrome Extension

### Features

- **Auto-capture** conversations from ChatGPT, Claude, Gemini, Perplexity, Mistral, DeepSeek, Copilot, Grok, Kimi
- **Floating vault button** on AI chat sites for quick save
- **Save selected text** via right-click menu or `Ctrl+Shift+S`
- **Codebase tab** — ask questions about code on any page using Groq
- **Ask / Explain / Plan** modes for code analysis
- **Search, edit, delete, pin** memories
- **Drop memories into chat** — paste saved context into any AI input
- **Export/Import** all memories as JSON

### Installation

```
1. Clone or download this repository
2. Open chrome://extensions/ in Chrome
3. Enable Developer mode (top right)
4. Click Load unpacked and select the project directory
```

### Setting Up Groq API

The Codebase tab uses Groq for code analysis (free tier available).

1. Get an API key at [console.groq.com/keys](https://console.groq.com/keys)
2. Open the extension popup → **Codebase** tab
3. Click the gear icon (⚙) → paste your key → Save

Your key is stored locally in Chrome storage — never sent anywhere except Groq's API.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Save selected text |
| `Ctrl+Shift+O` | Open popup |
| `Ctrl+F` | Focus search (popup open) |
| `Ctrl+Enter` | Save (in modals) |

### Codebase Tab

Three modes for interacting with code on the current page:

**Ask** — Ask any question about the visible code
```
Input: "why is this function async?"
→ Captures page content, sends to Groq, returns answer
```

**Explain** — Get a full explanation of the page's code
```
Input: "explain this code"
→ Extracts code from page, generates explanation
```

**Plan** — Describe a task, get an action plan
```
Input: "add rate limiting to the API endpoints"
→ Returns numbered steps, files to modify, risks
```

### Supported Platforms

| Platform | Domains |
|----------|---------|
| ChatGPT | chatgpt.com, chat.openai.com |
| Claude | claude.ai |
| Gemini | gemini.google.com |
| Perplexity | perplexity.ai |
| Mistral | chat.mistral.ai |
| DeepSeek | chat.deepseek.com, deepseek.com |
| Copilot | copilot.microsoft.com |
| Grok | grok.com, x.ai |
| Kimi | kimi.moonshot.cn, kimi.ai |

---

## Python CLI

A standalone coding agent with full codebase intelligence. Indexes your project, builds dependency graphs, and answers questions using retrieval-augmented generation.

### Commands

| Command | Description |
|---------|-------------|
| `init` | Index the codebase (AST parsing, embeddings, dependency graph) |
| `ask` | Ask a question about the codebase |
| `do` | Get a plan for a task |
| `why` | Explain a past decision |
| `undo` | Revert the last file change |
| `status` | Show system overview |

### Usage

```bash
# Index your project
python cli/main.py init .

# Ask a question
python cli/main.py ask "how does the login flow work"

# Ask with verbose output (shows reasoning steps)
python cli/main.py ask "why is this function slow" --verbose

# Plan a task
python cli/main.py do "add input validation to the user API"

# Explain a past decision
python cli/main.py why "switched from JWT to sessions"

# Revert last file change
python cli/main.py undo

# Check system status
python cli/main.py status
```

### How It Works

```
Query → Rewrite → Retrieve → Rerank → Context → Reason → Answer
         ↓           ↓          ↓         ↓
     Expand      BM25 +     Cross-    Structured
     keywords    Semantic    encoder   code blocks
                 + Graph     rerank    + Memory
```

1. **Query Rewriting** — expands abbreviations, adds synonyms
2. **Hybrid Retrieval** — BM25 keyword + FAISS semantic + dependency graph
3. **Reranking** — cross-encoder picks the top 5-8 most relevant chunks
4. **Context Building** — structures code blocks with file references
5. **Multi-step Reasoning** — analyze → gap analysis → self-critique → answer

### Pipeline Components

| Module | Purpose |
|--------|---------|
| `core/ingestion/ast_chunker.py` | AST-based code chunking (tree-sitter) |
| `core/ingestion/dependency_graph.py` | Function/file/class dependency tracking |
| `core/ingestion/summarizer.py` | Code summarization (rule-based + LLM) |
| `core/ingestion/embedder.py` | Sentence-transformers embeddings |
| `core/retrieval/query_rewriter.py` | Query expansion and intent detection |
| `core/retrieval/semantic_search.py` | FAISS vector store |
| `core/retrieval/keyword_search.py` | BM25 index |
| `core/retrieval/graph_search.py` | Dependency-graph context expansion |
| `core/retrieval/merger.py` | Weighted score fusion |
| `core/ranking/reranker.py` | Cross-encoder reranking |
| `core/context_builder/builder.py` | Structured context with token budget |
| `core/agent/reasoner.py` | Multi-step reasoning with self-critique |
| `core/agent/prompts.py` | System prompts for all tasks |
| `core/agent/llm.py` | Groq / OpenAI / Ollama providers |
| `core/actions/file_editor.py` | Diff-based editing with undo |
| `core/actions/command_runner.py` | Safe command execution |
| `core/memory/store.py` | Importance-scored persistent memory |

### Configuration

The CLI uses `.env` for API keys:

```bash
# .env
GROQ_API_KEY=gsk_your-key-here
```

Default settings in `config/settings.py`:

```python
LLM_PROVIDER = "groq"
LLM_MODEL = "llama-3.3-70b-versatile"
EMBEDDING_MODEL = "sentence-transformers/allMiniLM-L6-v2"
RERANKER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
```

### Project Structure

```
├── manifest.json              # Chrome extension manifest
├── popup.html / popup.js      # Extension popup UI
├── popup.css                  # Dark theme styles
├── src/
│   ├── background.js          # Service worker (Groq + storage)
│   ├── content.js             # Content script (FAB, extraction)
│   ├── groq.js                # Groq API client
│   ├── db.js                  # IndexedDB wrapper
│   ├── processor.js           # Memory normalization
│   └── retrieval.js           # Ranked context retrieval
├── cli/
│   └── main.py                # CLI entry point
├── core/
│   ├── ingestion/             # AST chunking, graph, embeddings
│   ├── retrieval/             # Search (semantic, keyword, graph)
│   ├── ranking/               # Reranking
│   ├── context_builder/       # Context structuring
│   ├── agent/                 # LLM, reasoning, prompts
│   ├── actions/               # File editing, commands
│   └── memory/                # Persistent memory store
├── config/
│   └── settings.py            # All configuration
├── models/
│   └── schemas.py             # Data models
├── .env                       # API keys (git-ignored)
├── .gitignore
└── pyproject.toml             # Python package config
```

---

## Data

### Chrome Extension

All memories stored in IndexedDB (local only). Each memory contains:

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `title` | Auto-generated or manual title |
| `content` | Raw saved text (up to 8,000 chars) |
| `keywords` | Extracted search terms |
| `tags` | User-defined tags |
| `source` | Platform name (e.g., "ChatGPT") |
| `url` | Page URL |
| `pinned` | Pin to top |
| `createdAt` | Timestamp |

### Python CLI

Indexed data stored in `.contextvault/`:

| File | Contents |
|------|----------|
| `chunks.json` | All code chunks with metadata |
| `vectors/` | FAISS index + embeddings |
| `graph.json` | Dependency graph |
| `memory/entries.json` | Past decisions and context |
| `config.json` | User settings |

---

## License

MIT
