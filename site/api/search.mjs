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
The user asked a question about current NFL news — injuries, transactions, depth charts, roster moves, \
or player status. Search the web and return concise, factual, up-to-date information. \
Lead with the most relevant current facts. If you cannot find reliable information, say so briefly.`;

function buildSearchContents(messages) {
  // Include the full conversation (including any partial assistant reply from phase 1)
  // so the search knows which player/topic to look up.
  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const text = (m.content || '').trim();
    if (!text) continue;
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) {
      prev.parts.push({ text });
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  // Gemini requires alternating roles — merge trailing model turns into the
  // final user message if needed.
  if (contents.length > 0 && contents[contents.length - 1].role === 'model') {
    const lastModel = contents.pop();
    const modelText = lastModel.parts.map(p => p.text).join('\n\n');
    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      const prev = contents[contents.length - 1];
      prev.parts.push({ text: `\n\n[Assistant context before searching: ${modelText}]` });
    } else {
      contents.push({
        role: 'user',
        parts: [{ text: `[Search for current information related to this conversation. Assistant context: ${modelText}]` }],
      });
    }
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Search for the latest relevant NFL news.' }] });
  }

  return contents;
}

function extractGroundedText(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('\n\n').trim();
  if (text) return text;

  // Some grounded responses only populate groundingMetadata without prose.
  const chunks = candidate?.groundingMetadata?.groundingChunks || [];
  const snippets = chunks
    .map(c => c.web?.title && c.web?.uri ? `- ${c.web.title}: ${c.web.uri}` : null)
    .filter(Boolean);
  if (snippets.length > 0) {
    return `Here's what turned up:\n\n${snippets.slice(0, 5).join('\n')}`;
  }

  return '';
}

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

  const contents = buildSearchContents(messages);

  try {
    const payload = {
      tools: [{ google_search: {} }],
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents,
    };

    let data = null;
    let lastStatus = 500;
    let lastErr = {};
    let blipRetries = 2;
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
        const delay = parseRetryDelaySeconds(lastErr);
        if (delay != null && delay <= 10 && blipRetries > 0) {
          blipRetries -= 1;
          await sleep(delay * 1000 + 250);
          continue;
        }
        modelIdx += 1;
        continue;
      }
      if (geminiRes.status === 404) {
        modelIdx += 1;
        continue;
      }
      break;
    }

    if (!data) {
      if (lastStatus === 429) {
        return res.status(429).json({
          error: 'Search rate limited',
          message: "Search is rate-limited right now — Google's quota, not your question. Give it a minute and try again.",
        });
      }
      return res.status(lastStatus).json({ error: 'Search API error', details: lastErr });
    }

    const candidate = data.candidates?.[0];
    const searchQueries = candidate?.groundingMetadata?.webSearchQueries || [];
    const text = extractGroundedText(data);

    if (!text) {
      return res.status(502).json({ error: 'Empty search result', searchQueries });
    }

    logConversation(messages, text);
    return res.status(200).json({ message: text, searchQueries });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
