// Context Vault — Groq API client (runs in service worker)

const GROQ_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

let _apiKey = null;

export async function getApiKey() {
  if (_apiKey) return _apiKey;
  const data = await chrome.storage.local.get("groq_api_key");
  _apiKey = data.groq_api_key || "";
  return _apiKey;
}

export async function setApiKey(key) {
  _apiKey = key;
  await chrome.storage.local.set({ groq_api_key: key });
}

export async function chat(messages, { model, temperature, maxTokens } = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("No API key set");

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      temperature: temperature ?? 0.1,
      max_tokens: maxTokens || 4096,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq API error ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

export async function analyzeCode(code, question, { language = "", fileName = "" } = {}) {
  const system = `You are ContextVault, a code analysis assistant.
Answer questions about code precisely. Reference specific lines when possible.
Be concise — developers prefer direct answers. Use markdown for code blocks.`;

  const user = `File: ${fileName || "unknown"}${language ? `\nLanguage: ${language}` : ""}

\`\`\`
${code.slice(0, 12000)}
\`\`\`

Question: ${question}`;

  return chat([
    { role: "system", content: system },
    { role: "user", content: user },
  ], { maxTokens: 2048 });
}

export async function explainCode(code, { language = "", fileName = "" } = {}) {
  const system = `You are ContextVault. Explain code clearly and concisely.
Cover: what it does, how it works, key patterns. Use markdown.`;

  const user = `File: ${fileName || "unknown"}${language ? `\nLanguage: ${language}` : ""}

\`\`\`
${code.slice(0, 12000)}
\`\`\`

Explain this code.`;

  return chat([
    { role: "system", content: system },
    { role: "user", content: user },
  ], { maxTokens: 2048 });
}

export async function planTask(description, codeContext = "") {
  const system = `You are ContextVault, a code action planner.
Given a task and optional code context, produce a concrete action plan.
Output: numbered steps, files to create/modify, risks.`;

  const user = codeContext
    ? `Context:\n\`\`\`\n${codeContext.slice(0, 8000)}\n\`\`\`\n\nTask: ${description}`
    : `Task: ${description}`;

  return chat([
    { role: "system", content: system },
    { role: "user", content: user },
  ], { maxTokens: 2048 });
}
