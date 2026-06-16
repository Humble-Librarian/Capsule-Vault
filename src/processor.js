// Context Vault — Processor

export function processMemory(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  const now = Date.now();
  const content = String(raw.content || "").trim().slice(0, 8000);
  const title = String(raw.title || smartTitle(content)).trim().slice(0, 120);
  const keywords = extractKeywords(content);
  const source = String(raw.source || "Manual");
  const url = String(raw.url || "");
  const ts = Number(raw.created_at ?? raw.createdAt) ?? now;

  const formatted = `# Context: ${title}\nSource: ${source}\n\n${content}${keywords.length ? "\n\nKeywords: " + keywords.join(", ") : ""}`;

  return {
    id: raw.id || generateId(),
    title,
    content,
    summary: formatted,
    compressed: formatted,
    keywords,
    tags: keywords,
    source,
    url,
    pinned: Boolean(raw.pinned),
    createdAt: ts,
    updatedAt: now,
    version: 1
  };
}

export function compactMemory(memory) {
  return memory.compressed || memory.summary || memory.content || "";
}

export function extractKeywords(content) {
  const stop = new Set(["about","after","again","also","and","are","because","but","can","for","from","have","into","not","that","the","their","then","there","this","with","you","your","what","how","when","where","which","who","why","all","any","been","being","did","does","doing","each","few","got","has","had","her","his","its","let","like","make","may","might","must","need","new","now","old","our","out","own","put","ran","run","said","say","she","him","too","use","very","was","way","well","will","yet"]);
  const words = content.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
  const counts = new Map();
  for (const w of words) { if (!stop.has(w)) counts.set(w, (counts.get(w) || 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
}

function smartTitle(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (line.length < 5) continue;
    if (/^(chats|projects|artifacts|code|customize|recents|all chats|menu|settings)/i.test(line)) continue;
    if (line.split(/\s+/).length < 2) continue;
    return line.replace(/^[-*#>\s]+/, "").slice(0, 64).trim();
  }
  return (lines.find(l => l.length > 10) || lines[0] || "").slice(0, 64).trim() || "New memory";
}

function generateId() {
  return "cv_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}
