# Context Vault — Browser Extension Architecture Plan

## Core Principle

```
Single pipeline
Single source of truth
Zero hidden logic
Everything replaceable, nothing coupled
```

---

## Immutable Pipeline

```
Controller
  → Extractor (content script)
    → Cleaner
      → Processor
        → Compressor
          → Scorer
            → Guard
              → Storage
                → Indexer

RULES:
  ✓ No module skipping
  ✓ No reordering
  ✓ No shortcuts
```

---

## Hard Interfaces

Every module returns one of two shapes:

```javascript
// Success
{ ok: true, data: <result> }

// Failure
{ ok: false, error: <string> }
```

### Why

- Swap implementations later (AI, WASM, etc.)
- Prevent cascade failures
- Uniform error handling

---

## Storage Abstraction

```javascript
// storage/storage-adapter.js
const StorageAdapter = {
  async get(key) { ... },
  async set(key, value) { ... },
  async remove(key) { ... }
};
```

### Current Implementation

```javascript
// storage/chrome-storage.js
const ChromeStorageAdapter = {
  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  }
};
```

### Future Upgrades (without changing pipeline)

- IndexedDB
- Remote sync
- Vector DB

### Rule

```
NO OTHER MODULE touches storage directly
ONLY StorageAdapter accesses chrome.storage
```

---

## Index Abstraction

```javascript
// index/index-adapter.js
const IndexAdapter = {
  async add(id, text) { ... },
  async search(query) { ... }  // returns string[] of IDs
};
```

### Current Implementation

```javascript
// index/keyword-index.js
const KeywordIndexAdapter = {
  async add(id, text) {
    const tokens = tokenize(text);
    const index = await StorageAdapter.get('vault_index') || {};
    
    for (const token of tokens) {
      if (!index[token]) index[token] = new Set();
      index[token].add(id);
    }
    
    await StorageAdapter.set('vault_index', index);
  },
  
  async search(query) {
    const tokens = tokenize(query);
    const index = await StorageAdapter.get('vault_index') || {};
    const candidates = new Set();
    
    for (const token of tokens) {
      if (index[token]) {
        for (const id of index[token]) {
          candidates.add(id);
        }
      }
    }
    
    return [...candidates].slice(0, 50);
  }
};
```

### Future Upgrades (without changing pipeline)

- Embeddings index
- Semantic search
- Hybrid search

---

## Entity System

### Current (Rule-Based)

```javascript
// processor/entity-detector.js
function detectEntities(text) {
  const words = text.split(/\s+/);
  const entities = [];
  const seen = new Set();
  
  for (const word of words) {
    // Capitalized words > 2 chars
    if (word.length > 2 && word[0] === word[0].toUpperCase()) {
      const normalized = word.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        
        // Count occurrences
        const count = (text.match(new RegExp(word, 'gi')) || []).length;
        
        let criticality;
        if (count > 3) criticality = 1.0;
        else if (count >= 2) criticality = 0.7;
        else criticality = 0.4;
        
        entities.push({
          text: word,
          type: classifyEntity(word),
          score: criticality
        });
      }
    }
  }
  
  return entities;
}
```

### Future Upgrades (no schema change)

- NER model
- LLM extraction
- Custom classifiers

---

## Scoring Engine (Pluggable)

```javascript
// scoring/scoring-engine.js
const ScoringEngine = {
  compute(entities, compressedText, accessCount, timestamp) {
    const entityScore = this.entityScore(entities, compressedText);
    const recencyScore = this.recencyScore(timestamp);
    const frequencyScore = this.frequencyScore(accessCount);
    
    return (
      (entityScore * 0.5) +
      (recencyScore * 0.3) +
      (frequencyScore * 0.2)
    );
  },
  
  entityScore(entities, text) {
    if (entities.length === 0) return 0;
    const matches = entities.filter(e => 
      text.toLowerCase().includes(e.text.toLowerCase())
    ).length;
    return Math.min(matches / entities.length, 1);
  },
  
  recencyScore(timestamp) {
    const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
    return 1 / (1 + ageDays);
  },
  
  frequencyScore(accessCount) {
    return Math.min(accessCount / 10, 1);
  }
};
```

### Future Upgrades (swap compute method)

- ML model
- Personalized ranking
- LLM-based scoring

---

## Config System

### Files

```
config/
├── limits.js      # Hard limits
├── weights.js     # Scoring weights
├── rules.js       # Business rules
└── defaults.js    # Default values
```

### limits.js

```javascript
export const LIMITS = {
  MAX_INPUT_CHARS: 50000,
  MAX_SENTENCES: 10,
  MAX_RETRIEVAL_RESULTS: 5,
  MAX_CANDIDATES: 50,
  TIMEOUT_MS: 5000,
  MIN_COMPRESSED_LENGTH: 50,
  DEBOUNCE_MS: 300
};
```

### weights.js

```javascript
export const WEIGHTS = {
  ENTITY: 0.5,
  RECENCY: 0.3,
  FREQUENCY: 0.2
};
```

### rules.js

```javascript
export const RULES = {
  SKIP_ENTITY_DETECTION: false,
  LANGUAGE_FALLBACK: true,
  DEDUP_ENABLED: true
};
```

---

## Strict Limits

| Limit | Value | Locked |
|-------|-------|--------|
| Max input chars | 50,000 | YES |
| Max output sentences | 10 | YES |
| Max retrieval results | 5 | YES |
| Max candidates | 50 | YES |
| Timeout | 5000ms | YES |

```
NO dynamic expansion unless system upgraded
```

---

## Failure Philosophy

```
IF anything fails:
  → DROP the memory

DO NOT:
  ✗ partially store
  ✗ retry pipeline endlessly
  ✗ keep partial results

System must stay CLEAN over COMPLETE
```

---

## Dedup System

```javascript
function generateContentHash(url, compressedText) {
  return hash(url + compressedText);
}
```

### Rules

| Condition | Action |
|-----------|--------|
| Duplicate contentHash | Skip |
| Same URL | Overwrite |

### Prevents

- Storage explosion
- Noisy retrieval

---

## Concurrency Model

```javascript
const processing = {};
const requestId = {};

async function startProcessing(tabId) {
  if (processing[tabId]) return;
  processing[tabId] = true;
  
  requestId[tabId] = generateUUID();
  
  try {
    await runPipeline(tabId, requestId[tabId]);
  } finally {
    processing[tabId] = false;
    requestId[tabId] = null;
  }
}
```

### Rules

- ONE active pipeline per tab
- Uses `processing[tabId]` + `requestId[tabId]`
- Prevents race conditions & corruption

---

## Message Architecture

### ONLY 3 TYPES

| Message | Direction | Purpose |
|---------|-----------|---------|
| `EXTRACT` | SW → Content Script | Request DOM extraction |
| `PROCESS` | Popup → SW | Process current tab |
| `RETRIEVE` | Popup → SW | Search memories |

### Payload Structures

```javascript
// EXTRACT
{
  type: "EXTRACT",
  payload: { requestId: string }
}

// PROCESS
{
  type: "PROCESS",
  payload: { url: string, tabId: number }
}

// RETRIEVE
{
  type: "RETRIEVE",
  payload: { query: string, limit: number }
}

// RESPONSES
{
  type: "EXTRACT_RESPONSE",
  payload: { requestId: string, url: string, rawText: string }
}

{
  type: "PROCESS_RESPONSE",
  payload: { success: boolean, id?: string, error?: string }
}

{
  type: "RETRIEVE_RESPONSE",
  payload: { results: StoredContext[], count: number }
}
```

### Rule

```
NO custom/random messages later
ONLY these 3 types
```

---

## Clean Data Only Rule

### Store ONLY

- Clean text
- Compressed text
- Entities

### NEVER Store

- Raw HTML
- DOM structure
- Scripts
- Styles
- Boilerplate

---

## Retrieval Model

```
query
  → tokenize
  → index lookup
  → candidate set (max 50)
  → scoring
  → top 5

NO full scan ever
```

---

## Extension Points

### Allowed to Upgrade

| Module | Future Options |
|--------|----------------|
| Cleaner | Better parsing, ML cleaning |
| Processor | Better NLP, custom extractors |
| Compressor | Better summarization, LLM |
| Scorer | ML model, personalization |
| Index | Semantic search, embeddings |

### NOT Allowed to Change

- Pipeline order
- Storage structure
- Module contracts ({ok, data/error})

---

## Debug + Observability

### Mandatory Tracking

| Metric | Description |
|--------|-------------|
| Per-stage timing | Duration of each module |
| Error logs | All failures with context |
| Total pipeline time | End-to-end duration |

### Logger Implementation

```javascript
// utils/logger.js
const Logger = {
  stage(name, { ok, timeMs, error }) {
    console.log(`[${name}] ok=${ok} time=${timeMs}ms${error ? ` error=${error}` : ''}`);
  },
  
  pipeline(totalTimeMs) {
    console.log(`[Pipeline] total=${totalTimeMs}ms`);
  }
};
```

---

## Memory Quality Filter

### DO NOT Store If

| Condition | Reason |
|-----------|--------|
| compressedText < 50 chars | Too short to be useful |
| No meaningful entities | No critical information |
| Duplicate contentHash | Already stored |
| Score < threshold | Low value |

### Keeps System Valuable

```
Only store memories worth retrieving
```

---

## Future Features (Design Support, Don't Build)

| Feature | Architecture Support |
|---------|---------------------|
| Semantic search | IndexAdapter swap |
| Cloud sync | StorageAdapter swap |
| Personalization | ScoringEngine upgrade |
| AI summarization | Compressor upgrade |
| Cross-device memory | StorageAdapter + sync |

```
Your architecture already supports them
DO NOT build now
```

---

## Build Order

| Step | Module | Complexity |
|------|--------|------------|
| 1 | Extractor (content script) | Low |
| 2 | Messaging | Low |
| 3 | Controller | Medium |
| 4 | Cleaner | Low |
| 5 | Basic Storage | Low |
| 6 | Processor (simple) | Medium |
| 7 | Compressor (simple) | Low |
| 8 | Indexer | Medium |
| 9 | Retrieval | Medium |

```
DO NOT overengineer early
```

---

## Final Rule

```
If you feel like:
  "maybe I should change the architecture"

  → DON'T

Upgrade modules, not structure
```

---

## Data Schema (Locked)

```javascript
{
  id: string,
  url: string,
  rawText: string,
  compressedText: string,
  entities: [
    {
      text: string,
      type: string,
      score: number
    }
  ],
  score: number,
  timestamp: number,
  schemaVersion: 1,
  contentHash: string,
  accessCount: number
}
```

---

## Storage Structure (Locked)

```javascript
vault_memories: {
  [id]: StoredContext
}

vault_index: {
  [word]: Set<string>
}

vault_meta: {
  totalEntries: number
}
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONTEXT VAULT EXTENSION                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐                                                            │
│  │   POPUP     │────► PROCESS ────────────────────────────────────────┐     │
│  │             │                                                      │     │
│  │ • Search    │◄─── RETRIEVE_RESPONSE ──────────────────────────┐    │     │
│  │ • View      │                                                │    │     │
│  │ • Delete    │                                                │    │     │
│  └─────────────┘                                                │    │     │
│                                                                 │    │     │
│  ┌──────────────────────────────────────────────────────────────┼────┼───┐ │
│  │                    BACKGROUND (SERVICE WORKER)               │    │   │ │
│  │                                                             │    │   │ │
│  │  ┌──────────────────────────────────────────────────────────┴────┘   │ │
│  │  │                     CONTROLLER                                   │ │
│  │  │  startProcessing(tabId) • cancelProcessing(tabId) • timeout()    │ │
│  │  └───────────┬──────────────────────────────────────────────────────┘ │
│  │              │                                                        │
│  │              ▼                                                        │
│  │  ┌───────────────────────────────────────────────────────────────┐   │ │
│  │  │                    PIPELINE (locked order)                     │   │ │
│  │  │                                                               │   │ │
│  │  │  Cleaner → Processor → Compressor → Scorer → Guard           │   │ │
│  │  │     │          │            │           │        │            │   │ │
│  │  │     ▼          ▼            ▼           ▼        ▼            │   │ │
│  │  │  clean      entities    compressed   score    validate       │   │ │
│  │  │  text       + tokens    text         (0-1)    (≥50 chars)    │   │ │
│  │  │                                                               │   │ │
│  │  │  ┌─────────────────────────────────────────────────────┐     │   │ │
│  │  │  │                 STORAGE LAYER                        │     │   │ │
│  │  │  │  StorageAdapter → IndexAdapter                       │     │   │ │
│  │  │  └─────────────────────────────────────────────────────┘     │   │ │
│  │  └───────────────────────────────────────────────────────────────┘   │ │
│  │                                                                     │ │
│  │  ┌───────────────────────┐  ┌──────────────────────────────────┐   │ │
│  │  │     ScoringEngine     │  │         Config (no hardcoding)    │   │ │
│  │  │  entity + recency +   │  │  limits.js • weights.js          │   │ │
│  │  │  frequency            │  │  rules.js • defaults.js          │   │ │
│  │  └───────────────────────┘  └──────────────────────────────────┘   │ │
│  │                                                                     │ │
│  │  ┌───────────────────────┐  ┌──────────────────────────────────┐   │ │
│  │  │    IndexAdapter       │  │         Logger (observability)    │   │ │
│  │  │  keyword index        │  │  per-stage timing • errors       │   │ │
│  │  │  (future: semantic)   │  │  pipeline total time             │   │ │
│  │  └───────────────────────┘  └──────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                       CONTENT SCRIPT (per tab)                        │  │
│  │                                                                      │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │                     EXTRACTOR (only allowed module)            │  │  │
│  │  │  • DOM text extraction                                         │  │  │
│  │  │  • Clean data only (no HTML, scripts, styles)                  │  │  │
│  │  │  • Returns: { ok, data: { url, rawText } }                     │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                      │  │
│  │  ✗ NO processing  ✗ NO storage  ✗ NO scoring                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    STORAGE (chrome.storage.local)                     │  │
│  │                                                                      │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │  │
│  │  │  vault_memories  │  │   vault_index    │  │   vault_meta     │  │  │
│  │  │  {[id]: context} │  │  {word: Set<ids>}│  │  {totalEntries}  │  │  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │  │
│  │                                                                      │  │
│  │  FUTURE: IndexedDB → Remote sync → Vector DB                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    CONTROLS (locked)                                  │  │
│  │                                                                      │  │
│  │  • Concurrency: one pipeline per tab                                 │  │
│  │  • Timeout: 5000ms hard                                              │  │
│  │  • Input: 50k chars max                                              │  │
│  │  • Output: 10 sentences max                                          │  │
│  │  • Retrieval: 5 results max                                          │  │
│  │  • Candidates: 50 max                                                │  │
│  │  • Write guard: ≥50 chars compressed                                 │  │
│  │  • Storage: debounce 300ms                                           │  │
│  │  • Dedup: contentHash check                                          │  │
│  │  • Same URL: overwrite                                               │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    CONTRACTS (hard interfaces)                        │  │
│  │                                                                      │  │
│  │  Every module returns:                                               │  │
│  │    { ok: true, data: <result> }                                      │  │
│  │    { ok: false, error: <string> }                                    │  │
│  │                                                                      │  │
│  │  Future-proof: swap implementations without changing pipeline        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
