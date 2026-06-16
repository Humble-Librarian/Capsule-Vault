// Context Vault — Retrieval

export function retrieveRankedContext(memories, { query = "", budget = 4000, limit = 5 } = {}) {
  if (!memories || !Array.isArray(memories)) {
    return { memories: [], context: "", metrics: { retrieved_count: 0, total_chars: 0 } };
  }

  const scored = memories
    .map(m => ({ memory: m, score: sc(m, query) }))
    .filter(i => i.score > 0 || !query)
    .sort((a, b) => b.score - a.score || (b.memory.createdAt || 0) - (a.memory.createdAt || 0));

  const selected = [];
  let totalChars = 0;

  for (const item of scored) {
    if (selected.length >= limit) break;
    const c = item.memory.compressed || item.memory.summary || item.memory.content || "";
    if (totalChars + c.length > budget && selected.length > 0) break;
    selected.push({ ...item.memory, relevanceScore: Number(item.score.toFixed(3)) });
    totalChars += c.length;
  }

  return {
    memories: selected,
    context: selected.map(m => m.compressed || m.summary || m.content || "").join("\n\n---\n\n"),
    metrics: { retrieved_count: selected.length, total_chars: totalChars }
  };
}

export function scoreMemory(memory, query) { return sc(memory, query); }

function sc(m, q) {
  const stop = new Set(["about","after","again","also","and","are","because","but","can","for","from","have","into","not","that","the","their","then","there","this","with","you","your","what","how","when","where","which","who","why","all","any","been","being","did","does","doing","each","few","got","has","had","her","his","its","let","like","make","may","might","must","need","new","now","old","our","out","own","put","ran","run","said","say","she","him","too","use","very","was","way","well","will","yet"]);
  const words = q.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
  const terms = words.filter(w => !stop.has(w));
  if (!terms.length) return 0;
  const haystack = [m.title, m.summary, m.content, ...(m.keywords || []), ...(m.tags || [])].join(" ").toLowerCase();
  const match = terms.filter(t => haystack.includes(t)).length / terms.length;
  const rec = m.createdAt ? Math.max(0, 1 - (Math.max(0, (Date.now() - Number(m.createdAt)) / 86400000) / 30)) : 0;
  return (match * 0.6) + (rec * 0.4);
}
