import BootScene from './src/scenes/BootScene.js';
import MainMenuScene from './src/scenes/MainMenuScene.js';
import InventoryScene from './src/scenes/InventoryScene.js';
import ShopScene from './src/scenes/ShopScene.js';
import GameScene from './src/scenes/GameScene.js';
import StartSkillScene from './src/scenes/StartSkillScene.js';
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
  // 限制單一畫格最多模擬的時間長度：瀏覽器分頁被切到背景、或某一幀因為
  // 生成大量物件（例如 Boss 登場一次建立好幾個物件）而卡頓時，預設情況下
  // Phaser 會把「卡住的這段時間」一次補算給下一格，造成角色瞬間被推走一大段
  // 距離、看起來像瞬間移動。把 min 拉高（=容許的最大單幀時間變短），
  // 卡頓恢復時最多只會補算一小段時間，就不會再有這種瞬移感。
  fps: { min: 30 },
  scene: [BootScene, MainMenuScene, InventoryScene, ShopScene, GameScene, StartSkillScene, UIScene, LevelUpScene, RelicChoiceScene, GameOverScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

window.addEventListener('load', () => {
  new Phaser.Game(config);
});
