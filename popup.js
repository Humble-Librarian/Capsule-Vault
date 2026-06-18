const SOURCE_COLORS = {
  ChatGPT: "#10a37f", Claude: "#cc6633", Gemini: "#4285f4",
  Perplexity: "#20b2aa", Mistral: "#ff6b35", DeepSeek: "#3b82f6",
  Copilot: "#0078d4", Grok: "#1da1f2", Manual: "#8b5cf6"
};

let allMemories = [];
let currentSearch = "";
let editingId = null;
let searchTimer = null;
let saving = false;
let cbMode = "ask";
let lastCbResponse = "";

// ─── Extension messaging ──────────────────────────────────────────────
function msg(type, payload = {}) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, r => resolve(r || null));
    } catch { resolve(null); }
  });
}

function readDBDirect() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open("ContextVaultDB", 1);
      req.onsuccess = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("memories")) { resolve([]); return; }
        const all = db.transaction("memories", "readonly").objectStore("memories").getAll();
        all.onsuccess = () => resolve((all.result || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
        all.onerror = () => resolve([]);
      };
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  bindTabs();
  bindCodebase();
  await loadMemories();
  await loadStats();
  renderList();
  checkApiKey();
});

// ─── Tabs ─────────────────────────────────────────────────────────────
function bindTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    });
  });
}

// ─── Codebase tab ─────────────────────────────────────────────────────
function bindCodebase() {
  const input = document.getElementById("cb-query");
  const askBtn = document.getElementById("cb-ask-btn");

  askBtn.addEventListener("click", () => runCodeQuery());
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runCodeQuery(); }
  });

  document.querySelectorAll(".cb-quick").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cb-quick").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      cbMode = btn.dataset.action;
      const placeholders = {
        ask: "Ask about code on this page...",
        explain: "Paste or select code to explain...",
        plan: "Describe what you want to build..."
      };
      input.placeholder = placeholders[cbMode] || placeholders.ask;
      input.focus();
    });
  });

  document.getElementById("cb-copy-btn").addEventListener("click", () => {
    if (lastCbResponse) navigator.clipboard.writeText(lastCbResponse).then(() => toast("Copied"));
  });

  document.getElementById("cb-settings-btn").addEventListener("click", openSettings);

  document.querySelector('.cb-quick[data-action="ask"]')?.classList.add("active");
}

async function checkApiKey() {
  const r = await msg("GET_API_KEY");
  const indicator = document.getElementById("cb-key-indicator");
  if (r?.key) {
    indicator.style.background = "#22c55e";
    indicator.title = "API key set";
  } else {
    indicator.style.background = "#ef4444";
    indicator.title = "No API key — click settings";
  }
}

async function openSettings() {
  const overlay = document.createElement("div");
  overlay.className = "init-overlay";
  overlay.innerHTML = `
    <div class="init-modal">
      <div class="init-modal__title">Groq API Key</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px">
        Get a free key at <a href="https://console.groq.com/keys" target="_blank" style="color:var(--accent-light)">console.groq.com/keys</a>
      </p>
      <input class="init-modal__input" id="settings-key" type="password" placeholder="gsk_..." />
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn--ghost" id="settings-cancel">Cancel</button>
        <button class="btn btn--primary" id="settings-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const keyInput = document.getElementById("settings-key");
  const r = await msg("GET_API_KEY");
  if (r?.key) keyInput.value = r.key;

  document.getElementById("settings-cancel").onclick = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById("settings-save").onclick = async () => {
    const key = keyInput.value.trim();
    if (!key) { toast("Enter an API key", "error"); return; }
    await msg("SET_API_KEY", { key });
    overlay.remove();
    checkApiKey();
    toast("Key saved");
  };

  keyInput.focus();
}

async function runCodeQuery() {
  const input = document.getElementById("cb-query");
  const query = input.value.trim();
  if (!query) return;

  const r = await msg("GET_API_KEY");
  if (!r?.key) { openSettings(); return; }

  const response = document.getElementById("cb-response");
  response.innerHTML = loadingHtml();

  let result;
  if (cbMode === "explain") {
    const code = await getActiveTabCode();
    result = await msg("EXPLAIN_CODE", { code: code || query, language: "", fileName: "" });
  } else if (cbMode === "plan") {
    result = await msg("PLAN_TASK", { task: query });
  } else {
    const code = await getActiveTabCode();
    result = await msg("ANALYZE_CODE", { code: code || "", question: query, language: "", fileName: "" });
  }

  if (result?.ok) {
    lastCbResponse = result.answer;
    response.innerHTML = `<div class="cb-answer">${formatAnswer(result.answer)}</div>`;
  } else {
    lastCbResponse = "";
    response.innerHTML = `<div class="cb-answer" style="color:var(--danger)">${esc(result?.error || "Request failed")}</div>`;
  }
}

async function getActiveTabCode() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return "";
    const r = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_PAGE" });
    return r?.content || "";
  } catch { return ""; }
}

function loadingHtml() {
  return `<div class="cb-loading">
    <div class="cb-loading__dots">
      <div class="cb-loading__dot"></div>
      <div class="cb-loading__dot"></div>
      <div class="cb-loading__dot"></div>
    </div>
    <span>Thinking...</span>
  </div>`;
}

function formatAnswer(text) {
  if (!text) return "";
  return esc(text)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/#{3}\s(.+)/g, '<strong style="font-size:12px">$1</strong>')
    .replace(/#{2}\s(.+)/g, '<strong style="font-size:13px">$1</strong>');
}

// ─── Memories tab ─────────────────────────────────────────────────────
async function loadMemories() {
  const r = await msg("GET_MEMORIES");
  if (r && Array.isArray(r.memories) && r.memories.length > 0) {
    allMemories = r.memories;
    return;
  }
  allMemories = await readDBDirect();
}

async function loadStats() {
  const r = await msg("GET_STATS");
  if (r?.ok) document.getElementById("stats-label").textContent = `${r.count} / ${r.max} memories`;
}

function getFiltered() {
  let m = [...allMemories];
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    m = m.filter(x => {
      const h = [x.title, x.summary, x.compressed, x.content, ...(x.keywords || []), ...(x.tags || [])].join(" ").toLowerCase();
      return h.includes(q);
    });
  }
  return m.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function renderList() {
  const c = document.getElementById("memory-list");
  const e = document.getElementById("empty-state");
  if (!c) return;
  c.querySelectorAll(".card, .no-results").forEach(el => el.remove());
  if (!allMemories.length) { if (e) e.style.display = "flex"; return; }
  if (e) e.style.display = "none";
  const filtered = getFiltered();
  if (!filtered.length) {
    const d = document.createElement("div"); d.className = "no-results"; d.textContent = "No memories match your search."; c.appendChild(d);
    return;
  }
  filtered.forEach(mem => c.appendChild(buildCard(mem)));
}

function buildCard(mem) {
  const card = document.createElement("div");
  card.className = `card${mem.pinned ? " card--pinned" : ""}`;
  const color = SOURCE_COLORS[mem.source] || "#8b5cf6";
  const preview = (mem.compressed || mem.summary || mem.content || "").slice(0, 120).replace(/\s+/g, " ");
  const tags = (mem.keywords || mem.tags || []).slice(0, 3);
  card.innerHTML = `
    <div class="card__bar" style="background:${color}"></div>
    <div class="card__body">
      <div class="card__header">
        <span class="card__source" style="color:${color}">${esc(mem.source || "Page")}</span>
        <span class="card__age">${age(mem.createdAt)}</span>
      </div>
      <div class="card__title">${esc(mem.title || "Untitled")}</div>
      <div class="card__preview">${esc(preview)}</div>
      <div class="card__footer">
        <div class="card__tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        <div class="card__actions">
          <button class="card__btn" data-a="copy">Copy</button>
          <button class="card__btn" data-a="edit">Edit</button>
          <button class="card__btn card__btn--danger" data-a="del">Del</button>
        </div>
      </div>
    </div>`;
  card.querySelector(".card__title").onclick = () => openEdit(mem.id);
  card.querySelectorAll(".card__btn").forEach(b => b.onclick = e => {
    e.stopPropagation();
    if (b.dataset.a === "copy") cp(mem.content);
    else if (b.dataset.a === "edit") openEdit(mem.id);
    else if (b.dataset.a === "del") delMem(mem.id);
  });
  return card;
}

async function delMem(id) {
  await msg("DELETE_MEMORY", { id });
  allMemories = allMemories.filter(m => m.id !== id);
  renderList(); await loadStats(); toast("Deleted");
}

function openEdit(id) {
  const m = allMemories.find(x => x.id === id);
  if (!m) return;
  editingId = id;
  document.getElementById("edit-title").value = m.title || "";
  document.getElementById("edit-content").value = m.content || "";
  document.getElementById("edit-tags").value = (m.keywords || m.tags || []).join(", ");
  document.getElementById("edit-pinned").checked = !!m.pinned;
  document.getElementById("view-modal").classList.remove("hidden");
}

function closeEdit() { document.getElementById("view-modal").classList.add("hidden"); editingId = null; }
function openNew() {
  document.getElementById("new-title").value = "";
  document.getElementById("new-content").value = "";
  document.getElementById("new-content").style.borderColor = "";
  document.getElementById("new-tags").value = "";
  document.getElementById("create-modal").classList.remove("hidden");
}
function closeNew() { document.getElementById("create-modal").classList.add("hidden"); }

function bindEvents() {
  const si = document.getElementById("search-input");
  const cb = document.getElementById("btn-search-clear");
  si?.addEventListener("input", () => {
    currentSearch = si.value.trim();
    cb?.classList.toggle("visible", !!currentSearch);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 150);
  });
  cb?.addEventListener("click", () => { si.value = ""; currentSearch = ""; cb.classList.remove("visible"); renderList(); si.focus(); });
  document.getElementById("btn-new")?.addEventListener("click", openNew);
  document.getElementById("btn-export")?.addEventListener("click", async () => {
    const r = await msg("EXPORT_ALL"); if (!r?.ok) return;
    const b = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = `cv-${new Date().toISOString().slice(0,10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 5000); toast(`Exported ${r.data.memories.length}`);
  });
  document.getElementById("btn-import")?.addEventListener("click", () => document.getElementById("import-file")?.click());
  document.getElementById("btn-clear")?.addEventListener("click", async () => {
    if (!confirm("Clear all?")) return;
    await msg("CLEAR_ALL"); allMemories = []; renderList(); await loadStats(); toast("Cleared");
  });
  document.getElementById("create-modal-close")?.addEventListener("click", closeNew);
  document.getElementById("create-modal-cancel")?.addEventListener("click", closeNew);
  document.getElementById("create-modal")?.addEventListener("click", e => { if (e.target === e.currentTarget) closeNew(); });
  document.getElementById("create-modal-save")?.addEventListener("click", saveNew);
  document.getElementById("view-modal-close")?.addEventListener("click", closeEdit);
  document.getElementById("view-modal-cancel")?.addEventListener("click", closeEdit);
  document.getElementById("view-modal")?.addEventListener("click", e => { if (e.target === e.currentTarget) closeEdit(); });
  document.getElementById("edit-save")?.addEventListener("click", saveEdit);
  document.getElementById("edit-delete")?.addEventListener("click", () => { if (editingId) { const id = editingId; closeEdit(); delMem(id); } });
  document.getElementById("import-file")?.addEventListener("change", async e => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      const r = await msg("IMPORT_ALL", { data: d });
      if (!r?.ok) { toast(r?.error || "Import failed", "error"); return; }
      await loadMemories(); renderList(); await loadStats(); toast(`Imported ${r.imported}`);
    } catch { toast("Invalid JSON", "error"); }
    e.target.value = "";
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeEdit(); closeNew(); }
  });
}

async function saveNew() {
  if (saving) return;
  const t = document.getElementById("new-title").value.trim();
  const c = document.getElementById("new-content").value.trim();
  const g = document.getElementById("new-tags").value.split(",").map(s => s.trim()).filter(Boolean);
  if (!c) { document.getElementById("new-content").style.borderColor = "#ef4444"; return; }
  saving = true;
  const r = await msg("SAVE_MEMORY", { memory: { title: t, content: c, tags: g, keywords: g, source: "Manual", url: "" } });
  saving = false;
  if (!r?.ok) { toast("Failed", "error"); return; }
  await loadMemories(); renderList(); await loadStats(); closeNew(); toast("Saved");
}

async function saveEdit() {
  if (saving || !editingId) return;
  const t = document.getElementById("edit-title").value.trim();
  const c = document.getElementById("edit-content").value.trim();
  if (!c) { toast("Content required", "error"); return; }
  saving = true;
  const r = await msg("UPDATE_MEMORY", { id: editingId, updates: { title: t, content: c, tags: parseTags(document.getElementById("edit-tags").value), keywords: parseTags(document.getElementById("edit-tags").value), pinned: document.getElementById("edit-pinned").checked } });
  saving = false;
  if (!r?.ok) { toast("Failed", "error"); return; }
  await loadMemories(); renderList(); closeEdit(); toast("Updated");
}

async function cp(t) { try { await navigator.clipboard.writeText(t || ""); toast("Copied"); } catch { toast("Failed", "error"); } }
function parseTags(v) { return v.split(",").map(s => s.trim()).filter(Boolean); }
function age(ts) {
  if (!ts) return "";
  const d = Date.now() - Number(ts);
  if (d < 60000) return "now"; if (d < 3600000) return `${Math.floor(d/60000)}m`;
  if (d < 86400000) return `${Math.floor(d/3600000)}h`; if (d < 604800000) return `${Math.floor(d/86400000)}d`;
  return new Date(ts).toLocaleDateString();
}
function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
let tt;
function toast(m, t="success") {
  let e = document.getElementById("popup-toast");
  if (!e) { e = document.createElement("div"); e.id = "popup-toast"; document.body.appendChild(e); }
  e.textContent = m; e.className = `visible ${t}`;
  clearTimeout(tt); tt = setTimeout(() => e.classList.remove("visible"), 2400);
}
