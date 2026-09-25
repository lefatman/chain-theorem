/**
 * Hot-seat local play: after each move the board hides behind a pass-the-device interstitial
 * (settings.passDevice, on by default) and the view flips to the next player.
 */
import {
  OPPONENT_NAME,
  expect,
  logGroups,
  playMove,
  startBattle,
  test,
  turnBanner,
} from './helpers.ts';

test('R-FMT-001 hot-seat shows the pass-device interstitial between turns', async ({ page }) => {
  await startBattle(page, { format: 'full', opponent: 'human' });
  const handoff = page.getByRole('dialog', { name: 'Pass the device' });
  await expect(handoff).toHaveCount(0);
  const before = await logGroups(page).count();

  await playMove(page, 'e2', 'e4', 'white');
  await expect(handoff).toBeVisible();
  await expect(handoff).toHaveAttribute('aria-modal', 'true');
  await expect(handoff).toContainText(`${OPPONENT_NAME.human} (Black), it is your turn`);
  const reveal = handoff.getByRole('button', {
    name: `I am ${OPPONENT_NAME.human}: show the board`,
  });
  await expect(reveal).toBeFocused();
  await reveal.click();
  await expect(handoff).toHaveCount(0);

  // Player 2 now sees the board from Black's side and moves by clicking the flipped canvas.
  await expect(turnBanner(page)).toContainText('Your move.');
  await playMove(page, 'e7', 'e5', 'black');
  await expect(handoff).toBeVisible();
  await expect(handoff).toContainText('You (White), it is your turn');
  await handoff.getByRole('button', { name: 'I am You: show the board' }).click();
  await expect(handoff).toHaveCount(0);

  await expect(logGroups(page)).toHaveCount(before + 2);
  await expect(page.getByRole('log')).toContainText(/e7\W.*e5/);
  await expect(turnBanner(page)).toContainText('Your move.');
});
