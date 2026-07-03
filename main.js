import BootScene from './src/scenes/BootScene.js';
import CharacterSelectScene from './src/scenes/CharacterSelectScene.js';
import GameScene from './src/scenes/GameScene.js';
import UIScene from './src/scenes/UIScene.js';
import LevelUpScene from './src/scenes/LevelUpScene.js';
import GameOverScene from './src/scenes/GameOverScene.js';

const config = {
  type: Phaser.AUTO,
  width: 960,
  height: 600,
  parent: 'game-container',
  backgroundColor: '#10131a',
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [BootScene, CharacterSelectScene, GameScene, UIScene, LevelUpScene, GameOverScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

window.addEventListener('load', () => {
  new Phaser.Game(config);
});
