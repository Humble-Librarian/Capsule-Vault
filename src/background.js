// Context Vault — Service Worker

import { dbPut, dbGet, dbGetAll, dbGetRecent, dbDelete, dbBulkPut, dbCount, dbClear } from "./db.js";
import { processMemory } from "./processor.js";
import { retrieveRankedContext } from "./retrieval.js";
import { getApiKey, setApiKey, chat, analyzeCode, explainCode, planTask } from "./groq.js";

const MAX = 250;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "save-ctx", title: "Save to Context Vault", contexts: ["selection"] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-ctx" || !info.selectionText) return;
  try { await doSave({ content: info.selectionText, source: getDomain(tab?.url), url: tab?.url || "" }); } catch {}
});

chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== "save-selection") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await inject(tab.id);
    chrome.tabs.sendMessage(tab.id, { type: "OPEN_SELECTION_CAPTURE" });
  } catch {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
  return true;
});

async function handle(msg) {
  switch (msg.type) {
    case "SAVE_MEMORY": return { ok: true, memory: await doSave(msg.memory || {}) };
    case "GET_MEMORIES": return { ok: true, memories: await dbGetRecent(MAX) };
    case "RETRIEVE_CONTEXT": {
      const m = await dbGetRecent(MAX);
      return { ok: true, ...retrieveRankedContext(m, { query: msg.query || "", limit: Number(msg.limit) || 5 }) };
    }
    case "DELETE_MEMORY": await dbDelete(msg.id); return { ok: true };
    case "UPDATE_MEMORY": {
      const e = await dbGet(msg.id);
      if (!e) return { ok: false, error: "Not found" };
      const u = { ...(msg.updates || {}) };
      delete u.id; delete u.created_at; delete u.createdAt; delete u.version;
      await dbPut(processMemory({ ...e, ...u }));
      return { ok: true };
    }
    case "EXPORT_ALL": return { ok: true, data: { version: "2.0", exportedAt: Date.now(), memories: await dbGetAll() } };
    case "IMPORT_ALL": {
      const inc = msg.data?.memories;
      if (!Array.isArray(inc)) return { ok: false, error: "Invalid" };
      const ex = await dbGetAll();
      const ids = new Set(ex.map(m => m.id));
      const norm = inc.filter(m => m?.id && !ids.has(m.id)).map(processMemory);
      await dbBulkPut(norm);
      return { ok: true, imported: norm.length };
    }
    case "GET_STATS": return { ok: true, count: await dbCount(), max: MAX };
    case "ENSURE_CONTENT_SCRIPT": return inject(msg.tabId);
    case "CLEAR_ALL": await dbClear(); return { ok: true };

    // Groq API
    case "GET_API_KEY": return { ok: true, key: await getApiKey() };
    case "SET_API_KEY": await setApiKey(msg.key); return { ok: true };
    case "CHAT": {
      const answer = await chat(msg.messages, msg.options);
      return { ok: true, answer };
    }
    case "ANALYZE_CODE": {
      const answer = await analyzeCode(msg.code, msg.question, { language: msg.language, fileName: msg.fileName });
      return { ok: true, answer };
    }
    case "EXPLAIN_CODE": {
      const answer = await explainCode(msg.code, { language: msg.language, fileName: msg.fileName });
      return { ok: true, answer };
    }
    case "PLAN_TASK": {
      const answer = await planTask(msg.task, msg.codeContext);
      return { ok: true, answer };
    }

    default: return { ok: false, error: "Unknown" };
  }
}

async function doSave(raw) {
  const mem = processMemory(raw);
  await dbPut(mem);
  return mem;
}

async function inject(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url?.startsWith("http")) return { ok: false, error: "Cannot inject" };
  try { await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content.css"] }); } catch {}
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content.js"] }); return { ok: true }; }
  catch { return { ok: false, error: "Blocked" }; }
}

function getDomain(url) {
  try {
    const h = new URL(url).hostname.replace("www.", "");
    const m = { "chatgpt.com":"ChatGPT","chat.openai.com":"ChatGPT","claude.ai":"Claude","gemini.google.com":"Gemini","perplexity.ai":"Perplexity","chat.mistral.ai":"Mistral","chat.deepseek.com":"DeepSeek","deepseek.com":"DeepSeek","copilot.microsoft.com":"Copilot","grok.com":"Grok","x.ai":"Grok","kimi.moonshot.cn":"Kimi","kimi.ai":"Kimi" };
    return m[h] || h;
  } catch { return "Unknown"; }
}
