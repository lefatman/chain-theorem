/** Lazily create the Phaser game for the overworld (keeps Phaser out of the first load, 12.3). */
import Phaser from 'phaser';
import { WorldScene, type WorldSceneHost } from './WorldScene.ts';

export interface WorldGame {
  game: Phaser.Game;
  scene: WorldScene;
}

export function createWorldGame(parent: HTMLElement, host: WorldSceneHost): Promise<WorldGame> {
  return new Promise((resolve) => {
    const scene = new WorldScene(host);
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: '#1d2340',
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: Math.max(1, parent.clientWidth),
        height: Math.max(1, parent.clientHeight),
      },
      // Keys are read by the DOM overlay (they must work while the loop sleeps).
      input: { keyboard: false },
      scene: [scene],
      banner: false,
      callbacks: {
        postBoot: () => resolve({ game, scene }),
      },
    });
  });
}

/**
 * Destroy the game now. Phaser runs a destroy on the next loop step, which never comes while the
 * loop sleeps (on-demand rendering); waking it runs that step at once.
 */
export function destroyWorldGame(g: WorldGame): void {
  g.game.destroy(true);
  g.game.loop.wake();
}
