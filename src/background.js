// Capsule Vault service worker. All data stays local in IndexedDB.

import {
  dbPut,
  dbGet,
  dbGetAll,
  dbDelete,
  dbBulkPut,
  dbCount,
  dbClear,
  dbEstimateSize
} from "./db.js";

const MAX_CAPSULES = 250;
const DEFAULT_SETTINGS = {
  floatingCapture: false
};

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "save-as-capsule",
      title: "Save to Capsule",
      contexts: ["selection"]
    });
  });

  const { settings } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: { ...DEFAULT_SETTINGS, ...(settings || {}) }
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-as-capsule" || !info.selectionText) return;
  await saveCapsule({
    content: info.selectionText,
    source: getDomain(tab?.url),
    url: tab?.url || ""
  });
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== "save-selection") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await ensureContentScript(tab.id);
    chrome.tabs.sendMessage(tab.id, { type: "OPEN_SELECTION_CAPTURE" });
  } catch (err) {
    console.error("[CapsuleVault] shortcut failed", err);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(err => {
    console.error("[CapsuleVault]", err);
    sendResponse({ ok: false, error: err.message });
  });
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case "SAVE_CAPSULE": {
      const saved = await saveCapsule(msg.capsule || {});
      return { ok: true, capsule: saved };
    }

    case "GET_CAPSULES": {
      return dbGetAll();
    }

    case "DELETE_CAPSULE": {
      await dbDelete(msg.id);
      return { ok: true };
    }

    case "UPDATE_CAPSULE": {
      const existing = await dbGet(msg.id);
      if (!existing) return { ok: false, error: "Not found" };
      const updated = normalizeCapsule({ ...existing, ...msg.updates, updatedAt: Date.now() });
      await dbPut(updated);
      return { ok: true, capsule: updated };
    }

    case "EXPORT_ALL": {
      const capsules = await dbGetAll();
      return {
        ok: true,
        data: { version: "1.2", exportedAt: Date.now(), capsules }
      };
    }

    case "IMPORT_ALL": {
      const incoming = msg.data?.capsules;
      if (!Array.isArray(incoming)) return { ok: false, error: "Invalid format" };
      const existing = await dbGetAll();
      const existingIds = new Set(existing.map(c => c.id));
      const normalized = incoming
        .filter(c => c && c.id && !existingIds.has(c.id))
        .map(normalizeCapsule);
      await dbBulkPut(normalized);
      await pruneCapsules();
      return { ok: true, imported: normalized.length };
    }

    case "GET_STATS": {
      const [count, size, settings] = await Promise.all([
        dbCount(),
        dbEstimateSize(),
        getSettings()
      ]);
      return {
        count,
        max: MAX_CAPSULES,
        usageKB: size.usageKB,
        quotaMB: size.quotaMB,
        settings
      };
    }

    case "GET_SETTINGS": {
      return { ok: true, settings: await getSettings() };
    }

    case "UPDATE_SETTINGS": {
      const current = await getSettings();
      const settings = { ...current, ...(msg.settings || {}) };
      await chrome.storage.local.set({ settings });
      return { ok: true, settings };
    }

    case "ENSURE_CONTENT_SCRIPT": {
      const tabId = msg.tabId || sender.tab?.id;
      if (!tabId) return { ok: false, error: "No active tab" };
      await ensureContentScript(tabId);
      return { ok: true };
    }

    case "CLEAR_ALL": {
      await dbClear();
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}

async function saveCapsule(raw) {
  const capsule = normalizeCapsule(raw);
  await dbPut(capsule);
  await pruneCapsules();
  return capsule;
}

function normalizeCapsule(raw) {
  const now = Date.now();
  const content = String(raw.content || "").trim().slice(0, 8000);
  const title = String(raw.title || smartTitle(content)).trim().slice(0, 120);
  return {
    id: raw.id || generateId(),
    title: title || "Untitled capsule",
    content,
    tags: normalizeTags(raw.tags, content),
    source: String(raw.source || "Manual"),
    url: String(raw.url || ""),
    pinned: Boolean(raw.pinned),
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
    version: 1
  };
}

function smartTitle(content) {
  const line = content
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(part => part.length > 0) || "";
  return line
    .replace(/^[-*#>\s]+/, "")
    .split(/[.!?]/)[0]
    .slice(0, 64)
    .trim() || "New capsule";
}

function normalizeTags(tags, content) {
  const explicit = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? tags.split(",")
      : [];
  const cleaned = explicit
    .map(tag => String(tag).trim().toLowerCase())
    .filter(Boolean);
  const auto = autoTags(content);
  return [...new Set([...cleaned, ...auto])].slice(0, 8);
}

function autoTags(content) {
  const text = content.toLowerCase();
  const rules = [
    ["code", /\b(function|const|let|class|return|import|export|api|bug|error)\b/],
    ["todo", /\b(todo|fix|follow up|next step|action item)\b/],
    ["prompt", /\b(prompt|system message|instructions|persona)\b/],
    ["meeting", /\b(meeting|agenda|notes|decision|stakeholder)\b/]
  ];
  return rules.filter(([, rx]) => rx.test(text)).map(([tag]) => tag);
}

async function pruneCapsules() {
  const capsules = await dbGetAll();
  if (capsules.length <= MAX_CAPSULES) return;
  const removable = capsules
    .filter(c => !c.pinned)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const overflow = capsules.length - MAX_CAPSULES;
  for (const capsule of removable.slice(0, overflow)) {
    await dbDelete(capsule.id);
  }
}

async function ensureContentScript(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content.css"] }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content.js"] });
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

function generateId() {
  return "cv_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function getDomain(url) {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    const map = {
      "chatgpt.com": "ChatGPT",
      "chat.openai.com": "ChatGPT",
      "claude.ai": "Claude",
      "gemini.google.com": "Gemini",
      "perplexity.ai": "Perplexity",
      "chat.mistral.ai": "Mistral",
      "chat.deepseek.com": "DeepSeek",
      "deepseek.com": "DeepSeek",
      "copilot.microsoft.com": "Copilot",
      "grok.com": "Grok",
      "x.ai": "Grok"
    };
    return map[host] || host;
  } catch {
    return "Unknown";
  }
}
