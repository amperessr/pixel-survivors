import BootScene from './src/scenes/BootScene.js';
import MainMenuScene from './src/scenes/MainMenuScene.js';
import InventoryScene from './src/scenes/InventoryScene.js';
import ShopScene from './src/scenes/ShopScene.js';
import GameScene from './src/scenes/GameScene.js';
import UIScene from './src/scenes/UIScene.js';
import LevelUpScene from './src/scenes/LevelUpScene.js';
import RelicChoiceScene from './src/scenes/RelicChoiceScene.js';
import GameOverScene from './src/scenes/GameOverScene.js';

const config = {
  type: Phaser.AUTO,
  width: 1920,
  height: 1080,
  parent: 'game-container',
  backgroundColor: '#10131a',
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [BootScene, MainMenuScene, InventoryScene, ShopScene, GameScene, UIScene, LevelUpScene, RelicChoiceScene, GameOverScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

window.addEventListener('load', () => {
  new Phaser.Game(config);
});
