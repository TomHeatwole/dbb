/**
 * Classify an ESPN soccer goal description as SOP / Header / PK / FK / Own Goal.
 * Uses the same Gemini models as HwangAI. Reply is forced to one label.
 */

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.0-flash'];
const geminiUrlFor = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export const GOAL_TYPE_LABELS = {
  sop: 'SOP',
  header: 'Header',
  pk: 'PK',
  fk: 'FK',
  og: 'Own Goal',
};

const ALLOWED_KEYS = new Set(Object.keys(GOAL_TYPE_LABELS));

export const CLASSIFY_GOAL_SYSTEM_PROMPT = `You classify how a soccer goal was scored from a match commentary description.

Reply with exactly one of these labels and nothing else:
SOP
Header
PK
FK
Own Goal

Definitions:
- SOP: open-play shot (foot/body, not a header, not from a penalty or free kick, not an own goal)
- Header: the ball was headed in
- PK: penalty kick
- FK: scored directly from a free kick
- Own Goal: a player put the ball into their own net

Do not explain. Do not punctuate. Do not add extra words.`;

export function parseGoalTypeReply(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .split(/\r?\n/)[0]
    .trim()
    .toLowerCase();

  if (text === 'sop' || text === 'shot open play' || text === 'open play') return 'sop';
  if (text === 'header') return 'header';
  if (text === 'pk' || text === 'penalty' || text === 'penalty kick') return 'pk';
  if (text === 'fk' || text === 'free kick' || text === 'free-kick') return 'fk';
  if (text === 'own goal' || text === 'og' || text === 'own-goal') return 'og';
  return null;
}

export function goalTypeFromEspnPlayType(type) {
  const token = String(type?.type ?? type?.text ?? type ?? '').toLowerCase();
  if (!token) return null;
  if (token.includes('own')) return 'og';
  if (token.includes('penalty')) return 'pk';
  if (token.includes('header')) return 'header';
  if (token.includes('free-kick') || token.includes('free kick')) return 'fk';
  if (token === 'goal' || token.startsWith('goal')) return 'sop';
  return null;
}

const CLASSIFY_TIMEOUT_MS = 6000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('classify timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function generateOnce(apiKey, model, description) {
  const res = await fetch(`${geminiUrlFor(model)}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CLASSIFY_GOAL_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: String(description ?? '').trim() }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 16,
      },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
  return parseGoalTypeReply(text);
}

export async function classifyGoalType(description, { espnType = null } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && String(description ?? '').trim()) {
    for (const model of GEMINI_MODELS) {
      try {
        const key = await withTimeout(generateOnce(apiKey, model, description), CLASSIFY_TIMEOUT_MS);
        if (ALLOWED_KEYS.has(key)) return key;
      } catch (_) {
        /* try next model */
      }
    }
  }

  return goalTypeFromEspnPlayType(espnType) ?? 'sop';
}
