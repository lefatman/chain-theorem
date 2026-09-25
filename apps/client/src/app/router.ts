/** Tiny hash router: '#/battle' -> { name: 'battle', params }. No dependency, works offline. */
import { signal } from '@preact/signals';

export type RouteName =
  | 'title'
  | 'play'
  | 'battle'
  | 'loadouts'
  | 'lab'
  | 'settings'
  | 'world'
  | 'login'
  | 'online'
  | 'account'
  | 'leaderboards'
  | 'guild';

export interface Route {
  name: RouteName;
  params: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  const name = (path || 'title') as RouteName;
  return { name, params: new URLSearchParams(query) };
}

export const route = signal<Route>(parse());
window.addEventListener('hashchange', () => {
  route.value = parse();
});

export function go(name: RouteName, params?: Record<string, string>): void {
  const q = params ? `?${new URLSearchParams(params).toString()}` : '';
  location.hash = `#/${name}${q}`;
}
