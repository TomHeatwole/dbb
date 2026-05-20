const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;

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
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tools: [{ google_search: {} }],
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents,
      }),
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.json().catch(() => ({}));
      return res.status(geminiRes.status).json({ error: 'Search API error', details: err });
    }

    const data = await geminiRes.json();
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
