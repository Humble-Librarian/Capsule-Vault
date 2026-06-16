// Context Vault — Content Script
// Floating vault button with memory drop feature.

(function () {
  if (window.__contextVaultInjected) return;
  window.__contextVaultInjected = true;

  const PLATFORMS = {
    "chatgpt.com": { name: "ChatGPT", selectors: ["[data-message-author-role='assistant'] .markdown", ".agent-turn .markdown"] },
    "chat.openai.com": { name: "ChatGPT", selectors: ["[data-message-author-role='assistant'] .markdown", ".agent-turn .markdown"] },
    "claude.ai": { name: "Claude", selectors: ["font-claude-message", "[data-testid*='assistant']", "[class*='font-claude']", "[class*='message-content']"] },
    "gemini.google.com": { name: "Gemini", selectors: ["model-response .response-content", "[class*='model-response'] [class*='markdown']"] },
    "perplexity.ai": { name: "Perplexity", selectors: ["[class*='answer'] [class*='markdown']", ".prose"] },
    "chat.mistral.ai": { name: "Mistral", selectors: ["[class*='assistant'] [class*='prose']"] },
    "chat.deepseek.com": { name: "DeepSeek", selectors: ["[class*='assistant'] [class*='markdown']", "[class*='bot-message']"] },
    "deepseek.com": { name: "DeepSeek", selectors: ["[class*='assistant'] [class*='markdown']"] },
    "copilot.microsoft.com": { name: "Copilot", selectors: ["[class*='assistant'] [class*='prose']", ".response-message"] },
    "grok.com": { name: "Grok", selectors: ["[class*='assistant'] [class*='markdown']"] },
    "x.ai": { name: "Grok", selectors: ["[class*='assistant'] [class*='markdown']"] },
    "kimi.moonshot.cn": { name: "Kimi", selectors: ["[class*='assistant'] [class*='markdown']", "[class*='message-content']"] },
    "kimi.ai": { name: "Kimi", selectors: ["[class*='assistant'] [class*='markdown']", "[class*='message-content']"] }
  };

  const host = location.hostname.replace("www.", "");
  const platform = PLATFORMS[host] || null;
  const AI_SITES = Object.keys(PLATFORMS);
  const isAISite = AI_SITES.some(s => host === s || host.endsWith("." + s));

  // ─── Message handlers ───────────────────────────────────────────────────
  if (isExt()) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === "EXTRACT_PAGE") { sendResponse(extractPage()); return true; }
      if (msg.type === "INJECT_MEMORY") { sendResponse({ ok: pasteIntoChat(msg.content || "") }); return true; }
      if (msg.type === "OPEN_SELECTION_CAPTURE") { openSaveModal(extractSelection()); sendResponse({ ok: true }); return true; }
    });
  }

  // ─── Show FAB only on AI chat sites ─────────────────────────────────────
  if (isAISite && platform) {
    setTimeout(injectFAB, 500);
  }

  // ─── Smart page extraction ──────────────────────────────────────────────
  function extractPage() {
    try {
      const title = document.title || "";
      const candidates = [];

      // Collect from all possible sources
      const selectors = [
        ...(platform?.selectors || []),
        "[data-message-author-role='assistant']",
        "[data-author='assistant']",
        "[role='article']",
        "[class*='assistant']",
        "[class*='model-response']",
        "[class*='message-content']",
        "[class*='prose']"
      ];

      for (const s of selectors) {
        document.querySelectorAll(s).forEach(el => {
          if (el.offsetWidth < 50 || el.offsetHeight < 20) return;
          const t = el.innerText?.trim();
          if (t && t.length > 20) candidates.push(t);
        });
      }

      // Main content area
      const main = document.querySelector("main, [role='main'], article, [id*='chat'], [class*='conversation']");
      if (main) {
        const clone = main.cloneNode(true);
        clone.querySelectorAll("nav, aside, footer, header, button, input, svg, img, [class*='sidebar'], [class*='nav'], [class*='menu']").forEach(el => el.remove());
        const t = clone.innerText?.trim();
        if (t && t.length > 20) candidates.push(t);
      }

      // Pick the longest unique candidate
      candidates.sort((a, b) => b.length - a.length);
      let content = "";
      for (const c of candidates) {
        // Skip if this is a subset of an already-selected candidate
        if (content.includes(c.slice(0, 100))) continue;
        if (c.length > content.length) content = c;
      }

      content = content.slice(0, 8000);
      if (content.length < 20) return { ok: false };

      return { ok: true, content, title, source: platform?.name || "Page", url: location.href };
    } catch { return { ok: false }; }
  }

  function extractSelection() {
    const sel = window.getSelection()?.toString().trim();
    if (sel) return { title: "", content: sel.slice(0, 8000), url: location.href, source: platform?.name || "Page" };
    return extractPage();
  }

  // ─── Chat input injection ────────────────────────────────────────────────
  const INPUTS = [
    "#prompt-textarea", "div[contenteditable='true'][data-id]",
    ".ProseMirror[contenteditable='true']", "div.ql-editor[contenteditable='true']",
    "rich-textarea div[contenteditable='true']", "textarea[placeholder*='Ask']",
    "textarea[data-id]", "div[contenteditable='true'][role='textbox']",
    "textarea.grow", "#chat-input-textbox", "textarea"
  ];

  function findInput() {
    for (const s of INPUTS) {
      const el = document.querySelector(s);
      if (el && vis(el) && !el.closest("#cv-modal-overlay") && !el.closest("#cv-drop-panel")) return el;
    }
    return null;
  }

  function vis(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }

  function pasteIntoChat(text) {
    const input = findInput();
    if (!input) return false;
    input.focus();
    const tag = input.tagName.toLowerCase();
    if (tag === "textarea" || tag === "input") {
      const s = input.selectionStart || 0, e = input.selectionEnd || s;
      const before = input.value.slice(0, s), after = input.value.slice(e);
      const sp = before.length && !before.endsWith("\n") ? "\n" : "";
      input.value = before + sp + text + after;
      input.selectionStart = input.selectionEnd = (before + sp + text).length;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const sel = window.getSelection();
      const range = sel?.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (range && input.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const n = document.createTextNode(text);
        range.insertNode(n);
        range.setStartAfter(n); range.collapse(true);
        sel.removeAllRanges(); sel.addRange(range);
      } else {
        input.appendChild(document.createTextNode((input.innerText.trim() ? "\n" : "") + text));
      }
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    toast("Dropped into chat", "success");
    return true;
  }

  // ─── FAB + Drop Panel ────────────────────────────────────────────────────
  function injectFAB() {
    if (document.getElementById("cv-fab")) return;
    const fab = document.createElement("div");
    fab.id = "cv-fab";
    fab.innerHTML = `
      <button class="cv-fab" title="Context Vault">
        <span class="cv-fab__icon">CV</span>
        <span class="cv-fab__label">Vault</span>
      </button>
      <div class="cv-drop-panel" id="cv-drop-panel">
        <div class="cv-drop__header">
          <span class="cv-drop__title">Drop Memory</span>
          <button class="cv-drop__close" id="cv-drop-close">&times;</button>
        </div>
        <div class="cv-drop__search">
          <input type="text" id="cv-drop-search" placeholder="Search memories..." />
        </div>
        <div class="cv-drop__list" id="cv-drop-list">
          <div class="cv-drop__empty">No memories yet</div>
        </div>
        <div class="cv-drop__footer">
          <button class="cv-drop__btn" id="cv-drop-save">+ Save Current</button>
        </div>
      </div>
    `;
    document.body.appendChild(fab);

    const btn = fab.querySelector(".cv-fab");
    const panel = document.getElementById("cv-drop-panel");
    const closeBtn = document.getElementById("cv-drop-close");
    const searchInput = document.getElementById("cv-drop-search");
    const saveBtn = document.getElementById("cv-drop-save");

    let panelOpen = false;
    let memories = [];

    btn.addEventListener("click", async e => {
      if (e.target.closest(".cv-drop-panel")) return;
      panelOpen = !panelOpen;
      panel.classList.toggle("cv-drop-panel--open", panelOpen);
      if (panelOpen) {
        memories = await loadMemories();
        renderDropList(memories);
        searchInput.value = "";
        searchInput.focus();
      }
    });

    closeBtn.addEventListener("click", () => {
      panelOpen = false;
      panel.classList.remove("cv-drop-panel--open");
    });

    searchInput.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase();
      const filtered = memories.filter(m => {
        const h = [m.title, m.compressed, m.summary, m.content, ...(m.keywords || [])].join(" ").toLowerCase();
        return h.includes(q);
      });
      renderDropList(filtered);
    });

    saveBtn.addEventListener("click", async () => {
      const data = extractPage();
      if (!data.ok) { toast("No conversation content found", "error"); return; }
      const res = await sendMsg("SAVE_MEMORY", { memory: data });
      if (res?.ok) {
        toast("Memory saved");
        memories = await loadMemories();
        renderDropList(memories);
      } else {
        toast("Save failed", "error");
      }
    });

    function renderDropList(list) {
      const container = document.getElementById("cv-drop-list");
      container.innerHTML = "";
      if (!list.length) {
        container.innerHTML = '<div class="cv-drop__empty">No memories found</div>';
        return;
      }
      list.forEach(m => {
        const item = document.createElement("div");
        item.className = "cv-drop__item";
        const colors = { ChatGPT:"#10a37f",Claude:"#cc6633",Gemini:"#4285f4",Perplexity:"#20b2aa",Mistral:"#ff6b35",DeepSeek:"#3b82f6",Copilot:"#0078d4",Grok:"#1da1f2",Kimi:"#8b5cf6" };
        const color = colors[m.source] || "#8b5cf6";
        const preview = (m.content || m.compressed || m.summary || "").slice(0, 120).replace(/\s+/g, " ");
        item.innerHTML = `
          <div class="cv-drop__item-bar" style="background:${color}"></div>
          <div class="cv-drop__item-body">
            <div class="cv-drop__item-title">${esc(m.title || "Untitled")}</div>
            <div class="cv-drop__item-preview">${esc(preview)}</div>
            <div class="cv-drop__item-meta">${esc(m.source || "Page")} · ${age(m.createdAt)}</div>
          </div>
        `;
        item.addEventListener("click", () => {
          const text = m.compressed || m.content || "";
          pasteIntoChat(text);
          panelOpen = false;
          panel.classList.remove("cv-drop-panel--open");
        });
        container.appendChild(item);
      });
    }

    makeDraggable(btn);
  }

  // ─── Save modal ──────────────────────────────────────────────────────────
  function openSaveModal(prefill) {
    const old = document.getElementById("cv-modal-overlay");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "cv-modal-overlay";
    overlay.innerHTML = `
      <div class="cv-modal">
        <div class="cv-modal__header">
          <div class="cv-modal__logo">CV</div>
          <span class="cv-modal__title">Save Memory</span>
          <button class="cv-modal__close" id="cv-modal-close">&times;</button>
        </div>
        <div class="cv-modal__body">
          <label class="cv-label">Title <span class="cv-hint">(optional)</span></label>
          <input class="cv-input" id="cv-title" type="text" placeholder="Auto-generated" value="${escA(prefill.title || "")}" maxlength="120" />
          <label class="cv-label">Content</label>
          <textarea class="cv-textarea" id="cv-content" placeholder="Paste or edit..." maxlength="8000">${escT(prefill.content || "")}</textarea>
          <label class="cv-label">Tags <span class="cv-hint">(comma-separated)</span></label>
          <input class="cv-input" id="cv-tags" type="text" placeholder="code, context, prompt" />
          <div class="cv-modal__source">
            <span class="cv-source-dot" style="background:${platform?.color || '#8b5cf6'}"></span>
            ${escT(platform?.name || "Page")} — stored locally only
          </div>
        </div>
        <div class="cv-modal__footer">
          <button class="cv-btn cv-btn--ghost" id="cv-modal-cancel">Cancel</button>
          <button class="cv-btn cv-btn--primary" id="cv-modal-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById("cv-modal-close").onclick = closeModal;
    document.getElementById("cv-modal-cancel").onclick = closeModal;
    overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });

    let saving = false;
    document.getElementById("cv-modal-save").onclick = () => {
      if (saving) return;
      const title = document.getElementById("cv-title").value.trim();
      const content = document.getElementById("cv-content").value.trim();
      const tags = document.getElementById("cv-tags").value.split(",").map(t => t.trim()).filter(Boolean);
      if (!content) { document.getElementById("cv-content").classList.add("cv-textarea--error"); return; }
      if (!isExt()) { toast("Extension reloaded. Refresh.", "error"); return; }
      saving = true;
      safeSend(() => chrome.runtime.sendMessage({
        type: "SAVE_MEMORY",
        memory: { title, content, tags, source: platform?.name || "Manual", url: location.href }
      }, res => {
        saving = false;
        if (res?.ok) { closeModal(); toast("Saved"); } else { toast("Failed", "error"); }
      }), () => { saving = false; toast("Extension reloaded.", "error"); });
    };

    overlay.addEventListener("keydown", e => {
      if (e.key === "Escape") closeModal();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") document.getElementById("cv-modal-save")?.click();
    });

    const ci = document.getElementById("cv-content"), ti = document.getElementById("cv-title");
    if (ti?.value) { ti.focus(); ti.select(); } else ci?.focus();
  }

  function closeModal() {
    const o = document.getElementById("cv-modal-overlay");
    if (!o || o.dataset.closing) return;
    o.dataset.closing = "1";
    o.classList.add("cv-modal-overlay--closing");
    setTimeout(() => { if (o.isConnected) o.remove(); }, 150);
  }

  // ─── Draggable ───────────────────────────────────────────────────────────
  function makeDraggable(el) {
    let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;
    el.addEventListener("mousedown", e => {
      if (e.button !== 0) return;
      dragging = false; sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect(); sl = r.left; st = r.top;
      const onMove = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) { dragging = true; ev.preventDefault(); document.body.style.userSelect = "none"; }
        if (!dragging) return;
        el.style.left = Math.max(0, Math.min(innerWidth - el.offsetWidth, sl + dx)) + "px";
        el.style.top = Math.max(0, Math.min(innerHeight - el.offsetHeight, st + dy)) + "px";
        el.style.right = "auto"; el.style.bottom = "auto";
      };
      const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); document.body.style.userSelect = ""; };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    el.addEventListener("click", e => { if (dragging) e.stopImmediatePropagation(); });
  }

  // ─── Utilities ───────────────────────────────────────────────────────────
  function loadMemories() {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: "GET_MEMORIES" }, r => {
          if (r && Array.isArray(r.memories)) { resolve(r.memories); return; }
          // Fallback: direct IndexedDB
          readDB().then(resolve);
        });
      } catch { readDB().then(resolve); }
    });
  }

  function readDB() {
    return new Promise(resolve => {
      try {
        const req = indexedDB.open("ContextVaultDB", 1);
        req.onsuccess = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("memories")) { resolve([]); return; }
          const tx = db.transaction("memories", "readonly");
          const all = tx.objectStore("memories").getAll();
          all.onsuccess = () => {
            const items = all.result || [];
            items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            resolve(items);
          };
          all.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
  }

  function sendMsg(type, payload = {}) {
    return new Promise(resolve => {
      try { chrome.runtime.sendMessage({ type, ...payload }, r => resolve(r || null)); }
      catch { resolve(null); }
    });
  }

  function age(ts) {
    if (!ts) return "";
    const d = Date.now() - Number(ts);
    if (d < 60000) return "now";
    if (d < 3600000) return `${Math.floor(d/60000)}m`;
    if (d < 86400000) return `${Math.floor(d/3600000)}h`;
    if (d < 604800000) return `${Math.floor(d/86400000)}d`;
    return new Date(ts).toLocaleDateString();
  }

  function toast(msg, type = "success") {
    document.getElementById("cv-toast")?.remove();
    const t = document.createElement("div");
    t.id = "cv-toast"; t.className = `cv-toast cv-toast--${type}`;
    t.textContent = msg; document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("cv-toast--visible"));
    setTimeout(() => { t.classList.remove("cv-toast--visible"); setTimeout(() => t.remove(), 200); }, 2400);
  }

  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function escA(s) { return esc(s).replace(/"/g,"&quot;"); }
  function escT(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function isExt() { try { return typeof chrome !== "undefined" && !!chrome.runtime?.id; } catch { return false; } }
  function safeSend(fn, err) { try { if (!isExt()) { err?.(); return; } fn(); } catch { err?.(); } }
})();
