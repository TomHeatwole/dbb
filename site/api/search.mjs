// Fallback models have separate free-tier quotas — keeps search alive when
// the primary model is rate-limited. Note grounded-search requests have their
// own (tighter) quota per model, so brief retries on the primary matter more
// than the fallback chain here.
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.0-flash'];
const geminiUrlFor = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Extract Google's suggested retry delay (seconds) from a 429 error body. */
function parseRetryDelaySeconds(errJson) {
  const details = errJson?.error?.details || [];
  for (const d of details) {
    if (d['@type']?.includes('RetryInfo') && typeof d.retryDelay === 'string') {
      const secs = parseFloat(d.retryDelay);
      if (Number.isFinite(secs)) return secs;
    }
  }
  return null;
}

function logConversation(messages, response = null) {
  const entry = {
    ts: new Date().toISOString(),
    source: 'search',
    turns: messages.map(m => ({ role: m.role, content: m.content })),
    ...(response !== null ? { response } : {}),
  };
  console.log('[HwangAI]', JSON.stringify(entry));
}

const SYSTEM_INSTRUCTION = `You are a web search assistant for HwangAI, a dynasty fantasy football AI. \
The user asked a question and the main AI has already given an answer from its training data. \
Your job is to search the web for current, up-to-date information that enriches or corrects that answer — \
specifically: recent injuries, player news, NFL transactions, depth chart changes, or any breaking \
information from the last few weeks. Be concise and direct. Lead with the most relevant current facts.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { messages } = body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  try {
    const payload = {
      tools: [{ google_search: {} }],
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents,
    };

    let data = null;
    let lastStatus = 500;
    let lastErr = {};
    let blipRetries = 2; // budget for short rate-limit waits (maxDuration 30s)
    let modelIdx = 0;
    while (modelIdx < GEMINI_MODELS.length) {
      const geminiRes = await fetch(`${geminiUrlFor(GEMINI_MODELS[modelIdx])}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (geminiRes.ok) {
        data = await geminiRes.json();
        break;
      }
      lastStatus = geminiRes.status;
      lastErr = await geminiRes.json().catch(() => ({}));

      if (geminiRes.status === 429) {
        // Per-minute blip (phase 1 chat just burned several requests) → wait
        const delay = parseRetryDelaySeconds(lastErr);
        if (delay != null && delay <= 10 && blipRetries > 0) {
          blipRetries -= 1;
          await sleep(delay * 1000 + 250);
          continue; // retry same model
        }
        modelIdx += 1; // exhausted quota → next model
        continue;
      }
      if (geminiRes.status === 404) {
        modelIdx += 1; // model unavailable to this key → next model
        continue;
      }
      break; // other errors: bail
    }

    if (!data) {
      return res.status(lastStatus).json({ error: 'Search API error', details: lastErr });
    }
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.find(p => p.text)?.text || '';
    const searchQueries = candidate?.groundingMetadata?.webSearchQueries || [];

    logConversation(messages, text);
    return res.status(200).json({ message: text, searchQueries });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
