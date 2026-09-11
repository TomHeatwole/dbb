import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { formatLine, formatMoney, impliedProbability, formatPercent } from './oddsMath';
import { validateOfferInput } from './exchangeClient';

const LOGO = '/data/hwangai.png';
const PROMPT_PATH = '/data/hwangai_fredduel_bulk_prompt.txt';
const PLACEHOLDER = 'Describe the lines you want to lay, or upload a file';
const FILE_ACCEPT = '.txt,.csv,.tsv,.pdf,text/plain,text/csv,text/tab-separated-values,application/pdf';
const FILE_MAX_COUNT = 3;
const FILE_MAX_TEXT = 200 * 1024;
const FILE_MAX_PDF = 2 * 1024 * 1024;

const TEXT_EXTS = new Set(['.txt', '.csv', '.tsv']);
const PDF_EXT = '.pdf';

function fileExt(name) {
  const m = String(name || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
  return m ? m[1] : '';
}

function classifyFile(file) {
  const name = file?.name || 'file';
  const ext = fileExt(name);
  const mime = String(file?.type || '').toLowerCase();
  if (mime.startsWith('image/')) {
    return { error: 'Images are not supported. Attach a .txt, .csv, or .pdf.' };
  }
  if (TEXT_EXTS.has(ext) || mime === 'text/plain' || mime === 'text/csv' || mime === 'text/tab-separated-values') {
    return { kind: 'text', mime: mime || 'text/plain', max: FILE_MAX_TEXT };
  }
  if (ext === PDF_EXT || mime === 'application/pdf') {
    return { kind: 'pdf', mime: 'application/pdf', max: FILE_MAX_PDF };
  }
  return { error: `${name} is not a .txt, .csv, or .pdf.` };
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function buildApiContent(caption, files) {
  const bits = [];
  if (caption) bits.push(caption);
  for (const f of files || []) {
    if (f.kind === 'text') {
      bits.push(`\n\n--- attached file: ${f.name} ---\n${f.text}\n--- end ${f.name} ---`);
    } else if (f.kind === 'pdf') {
      bits.push(`\n\n[Attached PDF: ${f.name}. The PDF is included as a file part.]`);
    }
  }
  return bits.join('').trim() || 'See the attached file.';
}

function mergeSessionPdfs(sessionPdfs, incoming) {
  const next = [...(sessionPdfs || [])];
  for (const f of incoming || []) {
    if (f.kind !== 'pdf') continue;
    const payload = { name: f.name, mimeType: 'application/pdf', data: f.data };
    const idx = next.findIndex((p) => p.name === f.name);
    if (idx >= 0) next[idx] = payload;
    else next.push(payload);
  }
  return next.slice(-FILE_MAX_COUNT);
}

function pdfPayloadBytes(files) {
  let total = 0;
  for (const f of files || []) {
    const s = String(f.data || '').replace(/\s+/g, '');
    if (!s) continue;
    const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
    total += Math.max(0, Math.floor((s.length * 3) / 4) - pad);
  }
  return total;
}

const HANDOFF_MARKER = 'HANDOFF_HWANGAI';
const HANDOFF_DELAY_MS = 700;
const INTRO_MESSAGE = {
  role: 'assistant',
  content: "Describe the lines you want to lay, or upload a file. I'll put them in a review — nothing posts until you confirm.",
  intro: true,
};

function parseHandoffReply(reply) {
  const raw = String(reply || '');
  const hasMarker = raw.includes(HANDOFF_MARKER);
  const hasLink = /\/hwangai\b/i.test(raw);
  if (!hasMarker && !hasLink) return { text: raw.trim(), handoff: false };
  let text = raw.replace(/`?HANDOFF_HWANGAI`?/g, '');
  text = text.replace(/\[[^\]]*\]\(\s*\/hwangai[^)]*\)/gi, '');
  text = text.replace(/https?:\/\/[^\s)]*\/hwangai[^\s)]*/gi, '');
  text = text.replace(/\/hwangai(?:\?[^\s)]*)?/gi, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return {
    text: text || "That's not a batch of lines. Let me think on it properly…",
    handoff: true,
  };
}

function TypingDots() {
  return (
    <div className="hwang-ai-bubble hwang-ai-bubble--typing">
      <span className="hwang-ai-dot" />
      <span className="hwang-ai-dot" />
      <span className="hwang-ai-dot" />
    </div>
  );
}

function HandoffCard({ query }) {
  const href = `/hwangai?q=${encodeURIComponent(query || '')}`;
  return (
    <a
      className="scenario-hwang-ai-handoff"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <img src={LOGO} alt="" className="scenario-hwang-ai-handoff-logo" />
      <span className="scenario-hwang-ai-handoff-label">Open response in HwangAI</span>
      <span className="scenario-hwang-ai-handoff-arrow" aria-hidden="true">→</span>
    </a>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  if (message.handoff) {
    return (
      <div className="hwang-ai-message hwang-ai-message--ai">
        <img src={LOGO} alt="" className="hwang-ai-avatar" />
        <div className="hwang-ai-message-body">
          <HandoffCard query={message.query} />
        </div>
      </div>
    );
  }
  return (
    <div className={`hwang-ai-message ${isUser ? 'hwang-ai-message--user' : 'hwang-ai-message--ai'}`}>
      {!isUser && (
        <img src={LOGO} alt="HwangAI" className="hwang-ai-avatar" />
      )}
      <div className="hwang-ai-message-body">
        <div className={`hwang-ai-bubble ${isUser ? 'hwang-ai-bubble--user' : 'hwang-ai-bubble--ai'}`}>
          {isUser ? (
            <>
              {message.content ? message.content : null}
              {message.attachments?.length > 0 && (
                <div className="fd-bulk-file-chips">
                  {message.attachments.map((f) => (
                    <span key={`${f.kind}-${f.name}`} className="fd-bulk-file-chip">{f.name}</span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <ReactMarkdown>{message.content}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}

function kindLabel(draft) {
  if (draft.marketKind === 'weekly') {
    const wk = draft.market?.week;
    return wk ? `Week ${wk}` : 'Weekly';
  }
  if (draft.marketKind === 'custom') return 'Custom';
  return 'Season';
}

function DraftCard({ draft }) {
  const prob = impliedProbability(draft.line);
  return (
    <div className="fd-card fd-offer-card fd-bulk-draft-card">
      <div className="fd-card-top">
        <span className="fd-chip">{kindLabel(draft)}</span>
        <span className="fd-chip fd-chip-mine">Preview</span>
        <span className="fd-spacer" />
        <span className="fd-muted fd-small">
          expires {new Date(draft.expiresAt).toLocaleString()}
        </span>
      </div>
      <div className="fd-offer-title">{draft.title}</div>
      {draft.description ? <div className="fd-offer-desc">{draft.description}</div> : null}
      <div className="fd-offer-numbers">
        <div className="fd-line-block">
          <div className="fd-line-big">{formatLine(draft.line)}</div>
          <div className="fd-muted fd-small">{formatPercent(prob)} implied</div>
        </div>
        <div className="fd-exposure-block">
          <div>
            <strong>{formatMoney(draft.maxExposure)}</strong>
            <span className="fd-muted"> max exposure</span>
          </div>
          <div className="fd-muted fd-small">
            Min take {formatMoney(draft.minTake)}
            {draft.maxExposurePerPerson != null && (
              <> · {formatMoney(draft.maxExposurePerPerson)} / person</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildIdentityBlock(identity) {
  if (!identity || identity.rosterId == null) return '';
  const lines = [
    '',
    '════════════════════════════════════════',
    'LOGGED-IN USER',
    '════════════════════════════════════════',
    'The site login identified the person currently chatting with you:',
  ];
  if (identity.teamName) lines.push(`- Team name: ${identity.teamName}`);
  if (identity.ownerName) lines.push(`- Owner / display name: ${identity.ownerName}`);
  lines.push(`- Roster ID: ${identity.rosterId}`);
  lines.push('', 'When they say "my team", use this team.');
  return lines.join('\n');
}

/**
 * HwangAI chat that stages a batch of FredDuel offers. Nothing posts until
 * the user clicks Confirm and post lines.
 */
function FredDuelHwangAIBulk({
  teams,
  currentWeek,
  identity,
  onPostDrafts,
  onClose,
}) {
  const [messages, setMessages] = useState([INTRO_MESSAGE]);
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [sessionPdfs, setSessionPdfs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [basePrompt, setBasePrompt] = useState('');
  const [drafts, setDrafts] = useState(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const requestGenRef = useRef(0);
  const pendingFocusRef = useRef(false);
  const dragDepthRef = useRef(0);
  const reviewing = Boolean(drafts?.length);

  const snapshotRef = useRef({ teams, currentWeek, identity });
  snapshotRef.current = { teams, currentWeek, identity };

  useEffect(() => {
    fetch(PROMPT_PATH, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => setBasePrompt((text || '').trim()))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (reviewing) return;
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading, reviewing]);

  const systemPrompt = useMemo(() => {
    if (!basePrompt) return '';
    const block = buildIdentityBlock(identity);
    return block ? `${basePrompt}\n${block}` : basePrompt;
  }, [basePrompt, identity]);

  const canSend = Boolean((input.trim() || pendingFiles.length) && !loading && !posting && systemPrompt);
  const canAttach = Boolean(!loading && !posting && systemPrompt);

  const addFiles = useCallback(async (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setError(null);
    const added = [];
    for (const file of incoming) {
      if (pendingFiles.length + added.length >= FILE_MAX_COUNT) {
        setError(`Attach at most ${FILE_MAX_COUNT} files.`);
        break;
      }
      const classified = classifyFile(file);
      if (classified.error) {
        setError(classified.error);
        continue;
      }
      if (file.size > classified.max) {
        setError(`${file.name} is too large (max ${classified.kind === 'pdf' ? '2 MB' : '200 KB'}).`);
        continue;
      }
      try {
        if (classified.kind === 'text') {
          added.push({ name: file.name, kind: 'text', text: await readFileAsText(file) });
        } else {
          const data = await readFileAsBase64(file);
          const nextPdfs = mergeSessionPdfs(sessionPdfs, [
            ...pendingFiles,
            ...added,
            { name: file.name, kind: 'pdf', data },
          ]);
          if (pdfPayloadBytes(nextPdfs) > FILE_MAX_PDF) {
            setError('PDFs together must stay under 2 MB.');
            continue;
          }
          added.push({ name: file.name, kind: 'pdf', mimeType: 'application/pdf', data });
        }
      } catch (e) {
        setError(e.message || 'Could not read that file.');
      }
    }
    if (added.length) setPendingFiles((prev) => [...prev, ...added]);
  }, [pendingFiles, sessionPdfs]);

  function transferHasFiles(e) {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('Files');
  }

  function handleDragEnter(e) {
    if (!canAttach || !transferHasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragOver(true);
  }

  function handleDragOver(e) {
    if (!canAttach || !transferHasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(e) {
    if (!transferHasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragOver(false);
    if (!canAttach) return;
    addFiles(e.dataTransfer?.files);
  }

  const sendMessage = useCallback(async (overrideText) => {
    const caption = (overrideText ?? input).trim();
    const filesToSend = pendingFiles;
    if ((!caption && !filesToSend.length) || loading || !systemPrompt) return;

    const nextPdfs = mergeSessionPdfs(sessionPdfs, filesToSend);
    if (pdfPayloadBytes(nextPdfs) > FILE_MAX_PDF) {
      setError('PDFs together must stay under 2 MB.');
      return;
    }

    const attachments = filesToSend.map((f) => ({ name: f.name, kind: f.kind }));
    const userMessage = {
      role: 'user',
      content: caption,
      apiContent: buildApiContent(caption, filesToSend),
      attachments,
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setPendingFiles([]);
    setSessionPdfs(nextPdfs);
    setLoading(true);
    setError(null);
    setDrafts(null);
    setPostError(null);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    const snap = snapshotRef.current;
    const apiMessages = newMessages
      .filter((m) => !m.intro && !m.handoff)
      .map((m) => ({
        role: m.role,
        content: m.apiContent || m.content,
      }));
    const gen = requestGenRef.current;
    let staged = null;
    const handoffQuery = caption || (filesToSend[0]?.name || '');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          systemPrompt,
          mode: 'fredduel_bulk',
          fredduel: {
            teams: (snap.teams || []).map((t) => ({
              rosterId: t.rosterId,
              teamName: t.teamName,
              ownerName: t.ownerName || '',
            })),
            currentWeek: snap.currentWeek,
            identity: snap.identity || null,
          },
          ...(nextPdfs.length ? { files: nextPdfs } : {}),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error('[HwangAI FredDuel bulk] failed:', res.status, errBody);
        throw new Error(errBody.error || `Request failed: ${res.status}`);
      }
      const data = await res.json();
      if (gen !== requestGenRef.current) return;
      const { text: reply, handoff } = parseHandoffReply(
        data.message || "I blanked on that one — clanker moment. Hit me again.",
      );
      staged = Array.isArray(data.offerDrafts) && data.offerDrafts.length > 0
        ? data.offerDrafts
        : null;
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
      if (staged) setDrafts(staged);
      if (handoff) {
        await new Promise((resolve) => { setTimeout(resolve, HANDOFF_DELAY_MS); });
        if (gen !== requestGenRef.current) return;
        setMessages((prev) => [...prev, { role: 'assistant', handoff: true, query: handoffQuery }]);
      }
    } catch (err) {
      console.error('[HwangAI FredDuel bulk] error:', err);
      setError(err.message && !err.message.startsWith('Request failed')
        ? err.message
        : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      if (!staged) inputRef.current?.focus({ preventScroll: true });
    }
  }, [input, loading, messages, systemPrompt, pendingFiles, sessionPdfs]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInputChange(e) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  }

  const rejectDrafts = useCallback(() => {
    if (posting) return;
    pendingFocusRef.current = true;
    setDrafts(null);
    setPostError(null);
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: "Scrapped. Tell me what to change and I'll stage another batch.",
      },
    ]);
  }, [posting]);

  useEffect(() => {
    if (reviewing || !pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    inputRef.current?.focus({ preventScroll: true });
  }, [reviewing]);

  useEffect(() => {
    if (!reviewing) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') rejectDrafts();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [reviewing, rejectDrafts]);

  const confirmDrafts = async () => {
    if (!drafts?.length || posting) return;
    setPostError(null);
    for (const draft of drafts) {
      const err = validateOfferInput(draft);
      if (err) {
        setPostError(err);
        return;
      }
    }
    setPosting(true);
    try {
      await onPostDrafts(drafts);
    } catch (e) {
      setPostError(e.message || 'Could not post those lines.');
      setPosting(false);
      return;
    }
    setPosting(false);
  };

  const reviewDialog = reviewing ? createPortal(
    <div className="fd-bulk-review-overlay" role="presentation">
      <div
        className="fd-bulk-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fd-bulk-review-title"
      >
        <div className="fd-bulk-review-head">
          <img src={LOGO} alt="" className="fd-bulk-review-logo" />
          <div>
            <h3 id="fd-bulk-review-title">Review these lines</h3>
            <p>
              {drafts.length} offer{drafts.length === 1 ? '' : 's'} staged.
              Nothing posts until you confirm.
            </p>
          </div>
        </div>
        <div className="fd-bulk-review-list">
          {drafts.map((draft, i) => (
            <DraftCard key={`${draft.title}-${i}`} draft={draft} />
          ))}
        </div>
        {postError && <div className="fd-error">{postError}</div>}
        <div className="fd-bulk-review-actions">
          <button
            type="button"
            className="fd-btn fd-btn-primary"
            onClick={confirmDrafts}
            disabled={posting}
          >
            {posting ? 'Posting…' : 'Confirm and post lines'}
          </button>
          <button
            type="button"
            className="fd-btn fd-btn-ghost"
            onClick={rejectDrafts}
            disabled={posting}
          >
            Reject and keep chatting
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="fd-bulk-hwang">
      {reviewing ? (
        <div className="fd-bulk-hwang-minimized" aria-hidden="true">
          <img src={LOGO} alt="" />
          <span>HwangAI paused — review the lines</span>
        </div>
      ) : (
        <div
          className={`scenario-hwang-ai fd-bulk-hwang-chat${dragOver ? ' fd-bulk-hwang-chat--drop' : ''}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragOver && (
            <div className="fd-bulk-drop-hint" aria-hidden="true">
              Drop a .txt, .csv, or .pdf
            </div>
          )}
          <div className="scenario-hwang-ai-heading">
            <img src={LOGO} alt="" className="scenario-hwang-ai-heading-logo" aria-hidden="true" />
            HwangAI: Bulk offers
          </div>

          <div className="scenario-hwang-ai-messages" ref={messagesRef}>
            {messages.map((msg, i) => (
              <ChatMessage key={i} message={msg} />
            ))}
            {loading && (
              <div className="hwang-ai-message hwang-ai-message--ai">
                <img src={LOGO} alt="HwangAI" className="hwang-ai-avatar" />
                <TypingDots />
              </div>
            )}
            {error && <div className="hwang-ai-error">{error}</div>}
          </div>

          <div className="fd-bulk-composer">
            {(pendingFiles.length > 0 || sessionPdfs.length > 0) && (
              <div className="fd-bulk-file-bar" aria-label="Attached files">
                {pendingFiles.map((f, i) => (
                  <span key={`pending-${f.name}-${i}`} className="fd-bulk-file-chip fd-bulk-file-chip--pending">
                    {f.name}
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      disabled={loading || posting}
                      onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {sessionPdfs
                  .filter((p) => !pendingFiles.some((f) => f.kind === 'pdf' && f.name === p.name))
                  .map((p) => (
                    <span key={`session-${p.name}`} className="fd-bulk-file-chip fd-bulk-file-chip--session">
                      Using {p.name}
                      <button
                        type="button"
                        aria-label={`Stop using ${p.name}`}
                        disabled={loading || posting}
                        onClick={() => setSessionPdfs((prev) => prev.filter((x) => x.name !== p.name))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
              </div>
            )}
            <div className="hwang-ai-input-row">
              <input
                ref={fileInputRef}
                type="file"
                accept={FILE_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="fd-bulk-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || posting || !systemPrompt}
                aria-label="Attach a .txt, .csv, or .pdf"
                title="Attach a .txt, .csv, or .pdf"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    d="M16.5 6.5v10.2a4.5 4.5 0 0 1-9 0V6.75a3.25 3.25 0 0 1 6.5 0v9.45a2 2 0 0 1-4 0V8.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <textarea
                ref={inputRef}
                className="hwang-ai-input"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={PLACEHOLDER}
                rows={1}
                disabled={loading || posting || !systemPrompt}
              />
              <button
                type="button"
                className="hwang-ai-send-btn"
                onClick={() => sendMessage()}
                disabled={!canSend}
                aria-label="Send message"
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewDialog}

      {!reviewing && (
        <div className="fd-bulk-hwang-foot">
          <button type="button" className="fd-btn fd-btn-ghost" onClick={onClose} disabled={posting}>
            Back to the form
          </button>
        </div>
      )}
    </div>
  );
}

export default FredDuelHwangAIBulk;
