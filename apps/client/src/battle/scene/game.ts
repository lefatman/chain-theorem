/** Lazily create the Phaser game for the battle board (keeps Phaser out of the first load, 12.3). */
import Phaser from 'phaser';
import { BoardScene } from './BoardScene.ts';
import { TILE } from './art.ts';
import { loadDropInArt } from './dropin.ts';

export interface BoardGame {
  game: Phaser.Game;
  scene: BoardScene;
}

export async function createBoardGame(parent: HTMLElement): Promise<BoardGame> {
  // Human art replaces procedural sheets before any texture is uploaded (4.5).
  await loadDropInArt();
  return new Promise((resolve) => {
    const scene = new BoardScene();
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: TILE * 8,
      height: TILE * 8,
      backgroundColor: '#1d2340',
      pixelArt: true,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [scene],
      banner: false,
      callbacks: {
        postBoot: () => resolve({ game, scene }),
      },
    });
  });
}
