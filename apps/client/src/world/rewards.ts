/**
 * Reward toasts (M5, spec 10.2–10.5): XP, level ups, items, ability cards, key items and coins, in
 * plain words. Names come from the content registries; unknown ids print as they are.
 */
import { abilityById, itemById } from '@chain-theorem/content';
import type { Reward } from './controller.ts';

export interface RewardText {
  title: string;
  lines: string[];
}

const qty = (n: number) => (n > 1 ? ` ×${n}` : '');

export function rewardText(
  r: Reward,
  keyItemName: (id: string) => string | undefined = () => undefined,
): RewardText {
  const lines: string[] = [];
  if (r.xp > 0) lines.push(`+${r.xp} XP`);
  if (r.levelUp) lines.push(`You reached level ${r.level}!`);
  for (const i of r.items) lines.push(`Item: ${itemById.get(i.id)?.name ?? i.id}${qty(i.qty)}`);
  for (const c of r.cards)
    lines.push(`Ability card: ${abilityById.get(c.id)?.name ?? c.id}${qty(c.qty)}`);
  for (const k of r.keyItems) lines.push(`Key item: ${keyItemName(k) ?? k}`);
  if (r.coins > 0) lines.push(`+${r.coins} coins`);
  return { title: r.levelUp ? 'Level up!' : 'Reward', lines };
}
