/**
 * The player's guild as the server last described it (M6 6.1, 10.4): shared by the guild panel (world
 * side panel and the guild screen) and the world chat, which shows its Guild tab while the player is in
 * a guild. The server decides everything; this only caches its answers.
 */
import { signal } from '@preact/signals';
import type { MyGuild } from '@chain-theorem/protocol';
import { api } from '../net/api.ts';

export const guild = signal<MyGuild | null>(null);

/** Keep an answer of any guild call. */
export function setGuild(g: MyGuild): MyGuild {
  guild.value = g;
  return g;
}

export async function refreshGuild(): Promise<MyGuild> {
  return setGuild(await api.myGuild());
}
