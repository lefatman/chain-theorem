/**
 * Report a player (M6 6.4, spec 15 R-SEC-011: report, mute and block stay available to everyone): a
 * reason from a fixed list, an optional note (500 characters) and, from a chat line, that line as
 * context. The reported player is never told who reported them. After sending, mute and block are
 * one tap away.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ReportReason } from '@chain-theorem/protocol';
import { api } from '../../net/api.ts';
import {
  blockedIds,
  closeReport,
  mutedIds,
  reportTarget,
  safetyError,
  setBlocked,
  setMuted,
} from '../../state/safety.ts';

export const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'hate', label: 'Hate speech' },
  { id: 'cheating', label: 'Cheating' },
  { id: 'spam', label: 'Spam or advertising' },
  { id: 'inappropriate_name', label: 'Inappropriate name' },
  { id: 'other', label: 'Something else' },
];
const NOTE_MAX = 500;

export function ReportDialog() {
  const t = reportTarget.value;
  const box = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [withLine, setWithLine] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);

  useEffect(() => {
    setReason(null);
    setNote('');
    setWithLine(true);
    setSent(false);
    setError(null);
    setAfter(null);
    if (t) box.current?.focus();
  }, [t?.p, t?.context?.chat?.text]);

  useEffect(() => {
    if (!t) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeReport();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [t]);

  if (!t) return null;
  const chat = t.context?.chat;

  const send = async (e: Event) => {
    e.preventDefault();
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const context = {
        ...(chat && withLine ? { chat } : {}),
        ...(t.context?.battleId ? { battleId: t.context.battleId } : {}),
        ...(t.context?.tradeId ? { tradeId: t.context.tradeId } : {}),
      };
      await api.report({
        target: t.p,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(Object.keys(context).length > 0 ? { context } : {}),
      });
      setSent(true);
    } catch (err) {
      setError(safetyError(err));
    } finally {
      setBusy(false);
    }
  };

  const also = async (what: 'mute' | 'block') => {
    setError(null);
    try {
      if (what === 'mute') await setMuted(t.p, true);
      else await setBlocked(t.p, true);
      setAfter(
        what === 'mute'
          ? `You muted ${t.name}. Their messages are hidden from you.`
          : `You blocked ${t.name}. They cannot whisper, challenge or invite you.`,
      );
    } catch (err) {
      setError(safetyError(err));
    }
  };

  return (
    <div class="trade-back report-back">
      <div
        class="trade-window report-window panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        tabIndex={-1}
        ref={box}
      >
        <h3 id="report-title">
          <span aria-hidden="true">⚑</span> Report {t.name}
        </h3>
        {sent ? (
          <>
            <p class="note ok" role="status">
              Thanks. The moderators will look at it. {t.name} is not told who reported them.
            </p>
            <div class="row start">
              <button
                type="button"
                disabled={mutedIds.value.has(t.p)}
                onClick={() => void also('mute')}
              >
                Mute {t.name}
              </button>
              <button
                type="button"
                class="danger"
                disabled={blockedIds.value.has(t.p)}
                onClick={() => void also('block')}
              >
                Block {t.name}
              </button>
              <button type="button" class="primary" onClick={closeReport}>
                Close
              </button>
            </div>
            {after && (
              <p class="note small-text" role="status">
                {after}
              </p>
            )}
          </>
        ) : (
          <form onSubmit={(e) => void send(e)}>
            <fieldset class="report-reasons">
              <legend>What is wrong?</legend>
              {REASONS.map((r) => (
                <label key={r.id} class="check">
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.id}
                    checked={reason === r.id}
                    onChange={() => setReason(r.id)}
                  />{' '}
                  {r.label}
                </label>
              ))}
            </fieldset>
            {chat && (
              <label class="check">
                <input
                  type="checkbox"
                  checked={withLine}
                  onChange={(e) => setWithLine((e.target as HTMLInputElement).checked)}
                />{' '}
                Include the message: <q class="report-line">{chat.text}</q>
              </label>
            )}
            <label>
              Anything else the moderators should know? (optional)
              <textarea
                value={note}
                maxLength={NOTE_MAX}
                rows={3}
                aria-describedby="report-count"
                onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
              />
            </label>
            <p id="report-count" class="muted small-text">
              {note.length}/{NOTE_MAX}
            </p>
            <div class="row start">
              <button type="submit" class="primary" disabled={!reason || busy}>
                Send report
              </button>
              <button type="button" onClick={closeReport}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {error && (
          <p class="note warn small-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
