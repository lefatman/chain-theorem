/**
 * Safety settings (M6 6.4, R-SEC-011): the players this player muted or blocked, with Unmute and
 * Unblock. Both lists are private: nobody is told they were muted or blocked.
 */
import { useEffect, useState } from 'preact/hooks';
import type { SafetyEntry } from '@chain-theorem/protocol';
import { loadSafety, safety, safetyError, setBlocked, setMuted } from '../state/safety.ts';

function Group({
  title,
  empty,
  list,
  action,
  onAction,
}: {
  title: string;
  empty: string;
  list: SafetyEntry[];
  action: string;
  onAction(e: SafetyEntry): void;
}) {
  return (
    <>
      <h5>{title}</h5>
      {list.length === 0 ? (
        <p class="muted small-text">{empty}</p>
      ) : (
        <ul class="friend-list" aria-label={title}>
          {list.map((e) => (
            <li key={e.id}>
              <strong>{e.name}</strong>{' '}
              <button
                type="button"
                class="small"
                aria-label={`${action} ${e.name}`}
                onClick={() => onAction(e)}
              >
                {action}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function SafetyPanel() {
  const lists = safety.value;
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    loadSafety().catch((e: unknown) => setNote(safetyError(e)));
  }, []);
  const act = async (f: () => Promise<unknown>, done: string) => {
    setNote(null);
    try {
      await f();
      setNote(done);
    } catch (e) {
      setNote(safetyError(e));
    }
  };
  return (
    <section class="safety-panel" aria-label="Safety">
      <p class="muted small-text">
        Muted players' messages are hidden from you. Blocked players are muted too, and neither of
        you can whisper, challenge, invite or trade with the other. Nobody is told.
      </p>
      {lists === null ? (
        <p class="muted">Loading…</p>
      ) : (
        <>
          <Group
            title="Muted players"
            empty="Nobody is muted."
            list={lists.muted}
            action="Unmute"
            onAction={(e) => void act(() => setMuted(e.id, false), `${e.name} is no longer muted.`)}
          />
          <Group
            title="Blocked players"
            empty="Nobody is blocked."
            list={lists.blocked}
            action="Unblock"
            onAction={(e) =>
              void act(() => setBlocked(e.id, false), `${e.name} is no longer blocked.`)
            }
          />
        </>
      )}
      {note && (
        <p class="note small-text" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
