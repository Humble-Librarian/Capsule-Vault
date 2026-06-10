// Capsule Vault content helper. Injected only after a user action.

(function () {
  if (window.__capsuleVaultInjected) return;
  window.__capsuleVaultInjected = true;

  const PLATFORMS = {
    "chatgpt.com": { name: "ChatGPT", color: "#10a37f" },
    "chat.openai.com": { name: "ChatGPT", color: "#10a37f" },
    "claude.ai": { name: "Claude", color: "#cc6633" },
    "gemini.google.com": { name: "Gemini", color: "#4285f4" },
    "perplexity.ai": { name: "Perplexity", color: "#20b2aa" },
    "chat.mistral.ai": { name: "Mistral", color: "#ff6b35" },
    "chat.deepseek.com": { name: "DeepSeek", color: "#3b82f6" },
    "deepseek.com": { name: "DeepSeek", color: "#3b82f6" },
    "copilot.microsoft.com": { name: "Copilot", color: "#0078d4" },
    "grok.com": { name: "Grok", color: "#1da1f2" },
    "x.ai": { name: "Grok", color: "#1da1f2" }
  };

  const host = location.hostname.replace("www.", "");
  const platform = PLATFORMS[host] || { name: host || "Page", color: "#6c63ff" };

  const INPUT_SELECTORS = [
    "#prompt-textarea",
    "div[contenteditable='true'][data-id]",
    ".ProseMirror[contenteditable='true']",
    "div[contenteditable='true'].ProseMirror",
    "div.ql-editor[contenteditable='true']",
    "rich-textarea div[contenteditable='true']",
    "textarea[placeholder*='Ask']",
    "textarea[placeholder*='ask']",
    "textarea[data-id]",
    "div[contenteditable='true'][role='textbox']",
    "textarea.grow",
    "#chat-input-textbox",
    "textarea"
  ];

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "INJECT_CAPSULE") {
      sendResponse({ ok: pasteIntoChatInput(msg.content || "") });
      return true;
    }
    if (msg.type === "SHOW_FAB") {
      injectFAB();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "HIDE_FAB") {
      removeFAB();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "OPEN_SELECTION_CAPTURE") {
      openSaveModal(extractSelectionOrConversation());
      sendResponse({ ok: true });
      return true;
    }
  });

  chrome.storage.local.get("settings", ({ settings }) => {
    if (settings?.floatingCapture) injectFAB();
  });

  function findChatInput() {
    for (const selector of INPUT_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function extractSelectionOrConversation() {
    const selected = window.getSelection()?.toString().trim();
    if (selected) {
      return {
        title: "",
        content: selected.slice(0, 8000),
        url: location.href,
        source: platform.name
      };
    }
    return extractConversation();
  }

  function extractConversation() {
    const assistantSelectors = [
      "[data-message-author-role='assistant'] .markdown",
      ".agent-turn .markdown",
      "div[data-testid*='conversation-turn']:last-child",
      ".model-response .response-content",
      "[class*='assistant'] [class*='prose']",
      "[class*='bot-message']:last-child",
      ".response-content:last-child"
    ];

    let content = "";
    for (const selector of assistantSelectors) {
      const els = document.querySelectorAll(selector);
      if (els.length > 0) {
        content = els[els.length - 1].innerText?.trim() || "";
        if (content.length > 30) break;
      }
    }

    if (!content) {
      const main = document.querySelector("main, [role='main'], #main-content");
      content = main?.innerText?.slice(0, 4000).trim() || "";
    }

    return {
      title: document.title.replace(/ [-|].+$/, "").trim(),
      content: content.slice(0, 8000),
      url: location.href,
      source: platform.name
    };
  }

  function pasteIntoChatInput(text) {
    const input = findChatInput();
    if (!input) {
      showToast("Could not find an input. Copied text is still available from the popup.", "error");
      return false;
    }

    input.focus();
    const tag = input.tagName.toLowerCase();

    if (tag === "textarea" || tag === "input") {
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || start;
      const before = input.value.slice(0, start);
      const after = input.value.slice(end);
      const spacer = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
      input.value = before + spacer + text + after;
      input.selectionStart = input.selectionEnd = (before + spacer + text).length;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      const selection = window.getSelection();
      const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : null;

      if (range && input.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        const node = document.createTextNode((input.innerText.trim() ? "\n" : "") + text);
        input.appendChild(node);
        const newRange = document.createRange();
        newRange.setStartAfter(node);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }

      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }

    showToast("Capsule injected", "success");
    return true;
  }

  function openSaveModal(prefill) {
    const existing = document.getElementById("cv-modal-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "cv-modal-overlay";
    overlay.innerHTML = `
      <div class="cv-modal" id="cv-modal">
        <div class="cv-modal__header">
          <span class="cv-modal__logo">CV</span>
          <span class="cv-modal__title">Save Capsule</span>
          <button class="cv-modal__close" id="cv-modal-close">x</button>
        </div>
        <div class="cv-modal__body">
          <label class="cv-label">Title <span class="cv-hint">(optional)</span></label>
          <input class="cv-input" id="cv-title" type="text" placeholder="Auto-generated from content" value="${escapeAttr(prefill.title)}" maxlength="120" />
          <label class="cv-label">Content</label>
          <textarea class="cv-textarea" id="cv-content" placeholder="Paste or edit content..." maxlength="8000">${escapeText(prefill.content)}</textarea>
          <label class="cv-label">Tags <span class="cv-hint">(comma-separated)</span></label>
          <input class="cv-input" id="cv-tags" type="text" placeholder="e.g. code, context, prompt" />
          <div class="cv-modal__source">
            <span class="cv-source-dot" style="background:${platform.color}"></span>
            ${escapeText(platform.name)} - stored locally only
          </div>
        </div>
        <div class="cv-modal__footer">
          <button class="cv-btn cv-btn--ghost" id="cv-modal-cancel">Cancel</button>
          <button class="cv-btn cv-btn--primary" id="cv-modal-save">Save Capsule</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("cv-modal-close").onclick = closeModal;
    document.getElementById("cv-modal-cancel").onclick = closeModal;
    overlay.addEventListener("click", e => {
      if (e.target === overlay) closeModal();
    });

    document.getElementById("cv-modal-save").onclick = () => {
      const title = document.getElementById("cv-title").value.trim();
      const content = document.getElementById("cv-content").value.trim();
      const tags = document.getElementById("cv-tags").value
        .split(",")
        .map(tag => tag.trim())
        .filter(Boolean);

      if (!content) {
        document.getElementById("cv-content").classList.add("cv-textarea--error");
        return;
      }

      chrome.runtime.sendMessage({
        type: "SAVE_CAPSULE",
        capsule: {
          title,
          content,
          tags,
          source: platform.name,
          url: location.href
        }
      }, res => {
        if (res?.ok) {
          closeModal();
          showToast("Capsule saved", "success");
        } else {
          showToast("Save failed", "error");
        }
      });
    };

    overlay.addEventListener("keydown", e => {
      if (e.key === "Escape") closeModal();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        document.getElementById("cv-modal-save").click();
      }
    });

    const contentInput = document.getElementById("cv-content");
    const titleInput = document.getElementById("cv-title");
    if (titleInput.value) {
      titleInput.focus();
      titleInput.select();
    } else {
      contentInput.focus();
    }
  }

  function closeModal() {
    const overlay = document.getElementById("cv-modal-overlay");
    if (!overlay) return;
    overlay.classList.add("cv-modal-overlay--closing");
    setTimeout(() => overlay.remove(), 160);
  }

  function injectFAB() {
    if (document.getElementById("cv-fab")) return;

    const fab = document.createElement("button");
    fab.id = "cv-fab";
    fab.className = "cv-fab";
    fab.setAttribute("title", "Save to Capsule Vault");
    fab.innerHTML = `
      <span class="cv-fab__icon">CV</span>
      <span class="cv-fab__label">Capture</span>
    `;
    document.body.appendChild(fab);
    fab.addEventListener("click", () => openSaveModal(extractSelectionOrConversation()));
    makeDraggable(fab);
  }

  function removeFAB() {
    document.getElementById("cv-fab")?.remove();
  }

  function makeDraggable(el) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    el.addEventListener("mousedown", e => {
      if (e.button !== 0) return;
      isDragging = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      const onMove = moveEvent => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) isDragging = true;
        if (!isDragging) return;
        el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, startLeft + dx)) + "px";
        el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, startTop + dy)) + "px";
        el.style.right = "auto";
        el.style.bottom = "auto";
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    el.addEventListener("click", e => {
      if (isDragging) e.stopImmediatePropagation();
    });
  }

  function showToast(message, type = "success") {
    document.getElementById("cv-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "cv-toast";
    toast.className = `cv-toast cv-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("cv-toast--visible"));
    setTimeout(() => {
      toast.classList.remove("cv-toast--visible");
      setTimeout(() => toast.remove(), 240);
    }, 2400);
  }

  function escapeAttr(str) {
    return escapeText(str).replace(/"/g, "&quot;");
  }

  function escapeText(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
