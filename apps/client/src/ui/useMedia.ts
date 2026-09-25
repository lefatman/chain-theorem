/** Media-query hook: the battle HUD switches to tabs below the board on narrow screens (12.3). */
import { useEffect, useState } from 'preact/hooks';

export const COMPACT_QUERY = '(max-width: 760px)';

export function useMedia(query: string): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}
