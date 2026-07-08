import TextureFactory from '../systems/TextureFactory.js';
import { textStyle } from '../utils/TextStyle.js';

export default class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload() {
    // 目前的外部圖片素材：龍之翼遺物特效 + 主選單背景 + 兩隻 Boss 龍的正式美術圖 +
    // 15 張裝備圖示（5 部位 x 3 階級的正式美術圖），其餘材質還是 TextureFactory 產生。
    this.load.image('fx_dragon_wing_pair', 'assets/dragon_wing.png');
    this.load.image('menu_bg', 'assets/menu_bg.jpg');
    this.load.image('boss_red', 'assets/boss_red.png');
    this.load.image('boss_black', 'assets/boss_black.png');
    // 新增三隻 Boss：惡魔王／樹王／獅鷲王的正式美術圖
    this.load.image('boss_demon', 'assets/boss_demon.png');
    this.load.image('boss_treant', 'assets/boss_treant.png');
    this.load.image('boss_griffin', 'assets/boss_griffin.png');
    // 冰霜新星／永凍冰川（進化版）的冰柱正式美術圖，取代原本程式產生的簡易冰柱貼圖
    this.load.image('fx_ice_pillar_normal', 'assets/fx_ice_pillar_normal.png');
    this.load.image('fx_ice_pillar_evo', 'assets/fx_ice_pillar_evo.png');
    // 玩家角色改用正式美術圖（藍色史萊姆），取代原本程式產生的簡易貼圖
    this.load.image('player_balanced', 'assets/player_slime.png');

    const equipSlots = ['weapon', 'helmet', 'clothes', 'pants', 'shoes'];
    const equipTiers = ['beginner', 'mid', 'high'];
    equipSlots.forEach((slot) => {
      equipTiers.forEach((tier) => {
        const key = `equip_${slot}_${tier}`;
        this.load.image(key, `assets/${key}.png`);
      });
    });
  }

  create() {
    const w = this.scale.width, h = this.scale.height;
    const label = this.add.text(w / 2, h / 2, '生成像素素材中...', textStyle({
      fontSize: '32px', color: '#6fd3ff',
    })).setOrigin(0.5);

    const factory = new TextureFactory(this);
    factory.generateAll();

    label.destroy();
    this.scene.start('MainMenuScene');
  }
}
