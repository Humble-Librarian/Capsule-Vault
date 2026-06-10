const SOURCE_COLORS = {
  ChatGPT: "#10a37f",
  Claude: "#cc6633",
  Gemini: "#4285f4",
  Perplexity: "#20b2aa",
  Mistral: "#ff6b35",
  DeepSeek: "#3b82f6",
  Copilot: "#0078d4",
  Grok: "#1da1f2",
  Manual: "#6c63ff"
};

let allCapsules = [];
let currentFilter = "all";
let currentSearch = "";
let editingId = null;

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadCapsules();
  await loadStats();
  renderList();
});

async function loadCapsules() {
  allCapsules = await sendMessage({ type: "GET_CAPSULES" }) || [];
}

async function loadStats() {
  const stats = await sendMessage({ type: "GET_STATS" });
  if (!stats) return;

  const label = document.getElementById("stats-label");
  const count = `${stats.count}/${stats.max} capsules`;
  const storage = stats.quotaMB > 0
    ? `${stats.usageKB}KB local`
    : "local IndexedDB";
  label.textContent = `${count} - ${storage}`;

  document.getElementById("floating-toggle").checked = Boolean(stats.settings?.floatingCapture);
}

function getFiltered() {
  let caps = [...allCapsules].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  if (currentFilter !== "all") {
    if (currentFilter === "Other") {
      const known = Object.keys(SOURCE_COLORS);
      caps = caps.filter(c => !known.includes(c.source));
    } else {
      caps = caps.filter(c => c.source === currentFilter);
    }
  }

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    caps = caps.filter(c =>
      (c.title || "").toLowerCase().includes(q) ||
      (c.content || "").toLowerCase().includes(q) ||
      (c.tags || []).some(t => String(t).toLowerCase().includes(q))
    );
  }

  return caps;
}

function renderList() {
  const container = document.getElementById("capsule-list");
  const emptyState = document.getElementById("empty-state");
  const filtered = getFiltered();

  container.querySelectorAll(".card, .no-results").forEach(el => el.remove());

  if (allCapsules.length === 0) {
    emptyState.style.display = "flex";
    return;
  }

  emptyState.style.display = "none";

  if (filtered.length === 0) {
    const noResults = document.createElement("div");
    noResults.className = "no-results";
    noResults.textContent = "No capsules match your search.";
    container.appendChild(noResults);
    return;
  }

  filtered.forEach(cap => container.appendChild(buildCard(cap)));
}

function buildCard(cap) {
  const card = document.createElement("div");
  card.className = `card${cap.pinned ? " card--pinned" : ""}`;
  card.dataset.id = cap.id;

  const color = sourceColor(cap.source);
  const preview = (cap.content || "").slice(0, 180).replace(/\s+/g, " ");
  const tags = (cap.tags || []).slice(0, 4);

  card.innerHTML = `
    <div class="card__bar" style="background:${color}"></div>
    <div class="card__body">
      <div class="card__top">
        <span class="card__title" title="${escapeAttr(cap.title)}">${cap.pinned ? '<span class="pin">PIN</span>' : ""}${highlight(cap.title, currentSearch)}</span>
        <div class="card__actions">
          <button class="card__btn card__btn--inject" data-id="${cap.id}" title="Inject into active page">IN</button>
          <button class="card__btn card__btn--edit" data-id="${cap.id}" title="Edit">ED</button>
          <button class="card__btn card__btn--copy" data-id="${cap.id}" title="Copy">CP</button>
          <button class="card__btn card__btn--delete" data-id="${cap.id}" title="Delete">DEL</button>
        </div>
      </div>
      <div class="card__preview">${highlight(preview, currentSearch)}</div>
      <div class="card__meta">
        <span class="card__source"><span class="card__source-dot" style="background:${color}"></span>${escapeHtml(cap.source || "Unknown")}</span>
        <span class="card__date">${formatDate(cap.createdAt)}</span>
        ${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
      </div>
    </div>
  `;

  card.querySelector(".card__title").addEventListener("click", () => openEditModal(cap.id));
  card.querySelector(".card__btn--inject").addEventListener("click", e => {
    e.stopPropagation();
    injectCapsule(cap);
  });
  card.querySelector(".card__btn--edit").addEventListener("click", e => {
    e.stopPropagation();
    openEditModal(cap.id);
  });
  card.querySelector(".card__btn--copy").addEventListener("click", e => {
    e.stopPropagation();
    copyText(cap.content);
  });
  card.querySelector(".card__btn--delete").addEventListener("click", e => {
    e.stopPropagation();
    deleteCapsule(cap.id);
  });

  return card;
}

async function injectCapsule(cap) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showToast("No active tab found", "error");
    return;
  }

  try {
    await sendMessage({ type: "ENSURE_CONTENT_SCRIPT", tabId: tab.id });
    chrome.tabs.sendMessage(tab.id, { type: "INJECT_CAPSULE", content: cap.content }, res => {
      if (chrome.runtime.lastError || !res?.ok) {
        copyText(cap.content, "Copied. Paste it into the page.");
        return;
      }
      showToast("Injected into active page", "success");
      window.close();
    });
  } catch {
    copyText(cap.content, "Copied. Paste it into the page.");
  }
}

async function deleteCapsule(id) {
  const res = await sendMessage({ type: "DELETE_CAPSULE", id });
  if (!res?.ok) return;
  allCapsules = allCapsules.filter(c => c.id !== id);
  renderList();
  await loadStats();
  showToast("Capsule deleted", "success");
}

function openEditModal(id) {
  const cap = allCapsules.find(c => c.id === id);
  if (!cap) return;
  editingId = id;

  document.getElementById("edit-title").value = cap.title || "";
  document.getElementById("edit-content").value = cap.content || "";
  document.getElementById("edit-tags").value = (cap.tags || []).join(", ");
  document.getElementById("edit-pinned").checked = Boolean(cap.pinned);
  document.getElementById("view-meta").textContent =
    `${cap.source || "Unknown"} - Created ${formatDate(cap.createdAt)} - ${(cap.content || "").length} chars`;

  document.getElementById("view-modal").classList.remove("hidden");
  document.getElementById("edit-title").focus();
}

function closeEditModal() {
  document.getElementById("view-modal").classList.add("hidden");
  editingId = null;
}

function openCreateModal() {
  document.getElementById("new-title").value = "";
  document.getElementById("new-content").value = "";
  document.getElementById("new-tags").value = "";
  document.getElementById("create-modal").classList.remove("hidden");
  document.getElementById("new-content").focus();
}

function closeCreateModal() {
  document.getElementById("create-modal").classList.add("hidden");
}

async function exportAll() {
  const res = await sendMessage({ type: "EXPORT_ALL" });
  if (!res?.ok) return;
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `capsule-vault-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${res.data.capsules.length} capsules`, "success");
}

function triggerImport() {
  document.getElementById("import-file").click();
}

function bindEvents() {
  const searchInput = document.getElementById("search-input");
  const clearBtn = document.getElementById("btn-search-clear");

  searchInput.addEventListener("input", () => {
    currentSearch = searchInput.value.trim();
    clearBtn.classList.toggle("visible", currentSearch.length > 0);
    renderList();
  });

  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    currentSearch = "";
    clearBtn.classList.remove("visible");
    renderList();
    searchInput.focus();
  });

  document.getElementById("filter-row").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("chip--active"));
    chip.classList.add("chip--active");
    currentFilter = chip.dataset.filter;
    renderList();
  });

  document.getElementById("btn-new").addEventListener("click", openCreateModal);
  document.getElementById("btn-export").addEventListener("click", exportAll);
  document.getElementById("btn-import").addEventListener("click", triggerImport);
  document.getElementById("btn-clear").addEventListener("click", clearAll);

  document.getElementById("floating-toggle").addEventListener("change", updateFloatingCapture);

  document.getElementById("create-modal-close").addEventListener("click", closeCreateModal);
  document.getElementById("create-modal-cancel").addEventListener("click", closeCreateModal);
  document.getElementById("create-modal").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeCreateModal();
  });
  document.getElementById("create-modal-save").addEventListener("click", saveNewCapsule);

  document.getElementById("view-modal-close").addEventListener("click", closeEditModal);
  document.getElementById("view-modal-cancel").addEventListener("click", closeEditModal);
  document.getElementById("view-modal").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeEditModal();
  });
  document.getElementById("edit-save").addEventListener("click", saveEditedCapsule);
  document.getElementById("edit-delete").addEventListener("click", () => {
    if (!editingId) return;
    const id = editingId;
    closeEditModal();
    deleteCapsule(id);
  });

  document.getElementById("import-file").addEventListener("change", importFile);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeEditModal();
      closeCreateModal();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

async function saveNewCapsule() {
  const title = document.getElementById("new-title").value.trim();
  const content = document.getElementById("new-content").value.trim();
  const tags = parseTags(document.getElementById("new-tags").value);

  if (!content) {
    document.getElementById("new-content").style.borderColor = "#ff4d6d";
    return;
  }

  const res = await sendMessage({
    type: "SAVE_CAPSULE",
    capsule: { title, content, tags, source: "Manual", url: "" }
  });
  if (!res?.ok) return;

  await loadCapsules();
  renderList();
  await loadStats();
  closeCreateModal();
  showToast("Capsule saved", "success");
}

async function saveEditedCapsule() {
  if (!editingId) return;
  const title = document.getElementById("edit-title").value.trim();
  const content = document.getElementById("edit-content").value.trim();
  if (!title || !content) return;

  const res = await sendMessage({
    type: "UPDATE_CAPSULE",
    id: editingId,
    updates: {
      title,
      content,
      tags: parseTags(document.getElementById("edit-tags").value),
      pinned: document.getElementById("edit-pinned").checked
    }
  });
  if (!res?.ok) return;

  await loadCapsules();
  renderList();
  closeEditModal();
  showToast("Changes saved", "success");
}

async function updateFloatingCapture(e) {
  const enabled = e.target.checked;
  const res = await sendMessage({ type: "UPDATE_SETTINGS", settings: { floatingCapture: enabled } });
  if (!res?.ok) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    if (enabled) {
      await sendMessage({ type: "ENSURE_CONTENT_SCRIPT", tabId: tab.id });
      chrome.tabs.sendMessage(tab.id, { type: "SHOW_FAB" });
      showToast("Floating Capture enabled", "success");
    } else {
      chrome.tabs.sendMessage(tab.id, { type: "HIDE_FAB" });
      showToast("Floating Capture disabled", "success");
    }
  } catch {
    showToast("Setting saved for future pages", "success");
  }
}

async function clearAll() {
  if (!confirm("Clear all capsules? Export first if you need a backup.")) return;
  const res = await sendMessage({ type: "CLEAR_ALL" });
  if (!res?.ok) return;
  allCapsules = [];
  renderList();
  await loadStats();
  showToast("Vault cleared", "success");
}

function importFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const res = await sendMessage({ type: "IMPORT_ALL", data });
      if (!res?.ok) {
        showToast(`Import failed: ${res?.error || "invalid file"}`, "error");
        return;
      }
      await loadCapsules();
      renderList();
      await loadStats();
      showToast(`Imported ${res.imported} capsules`, "success");
    } catch {
      showToast("Invalid JSON file", "error");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

async function copyText(text, message = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text || "");
    showToast(message, "success");
  } catch {
    showToast("Copy failed", "error");
  }
}

function sendMessage(message) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => resolve(response));
  });
}

function sourceColor(source) {
  return SOURCE_COLORS[source] || "#6c63ff";
}

function parseTags(value) {
  return value.split(",").map(t => t.trim()).filter(Boolean);
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

function highlight(text, query) {
  if (!query) return escapeHtml(text || "");
  const escaped = escapeHtml(text || "");
  const escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(new RegExp(`(${escapedQuery})`, "gi"), "<mark>$1</mark>");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

let toastTimer;

function showToast(message, type = "success") {
  let toast = document.getElementById("popup-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "popup-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `visible ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}
