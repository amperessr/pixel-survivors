import TextureFactory from '../systems/TextureFactory.js';
import { textStyle } from '../utils/TextStyle.js';

export default class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload() {
    // 目前的外部圖片素材：龍之翼遺物特效 + 主選單背景 + 五隻 Boss 的正式美術圖 +
    // 裝備圖示（商店三階 15 張／扭蛋一般裝備 100 張／扭蛋傳說裝備 25 張／四種戒指），
    // 其餘材質還是 TextureFactory 產生。
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
    // 四種戒指改用正式美術圖，取代原本 TextureFactory.generateRingIcons() 畫的
    // 簡易戒環圖示（已裁切去背、置中塞進 128x128 透明畫布，跟其他裝備圖示同規格）。
    this.load.image('ring_heal', 'assets/ring_heal.png');
    this.load.image('ring_auto', 'assets/ring_auto.png');
    this.load.image('ring_gravity', 'assets/ring_gravity.png');
    this.load.image('ring_clone', 'assets/ring_clone.png');

    const equipSlots = ['weapon', 'helmet', 'clothes', 'pants', 'shoes'];
    const equipTiers = ['beginner', 'mid', 'high'];
    equipSlots.forEach((slot) => {
      equipTiers.forEach((tier) => {
        const key = `equip_${slot}_${tier}`;
        this.load.image(key, `assets/${key}.png`);
      });
    });

    // 扭蛋機專用裝備圖示：5 部位 x 20 款正式美術圖（不在商店販售，只能扭蛋抽到，
    // 見 EquipmentData.js 的 GACHA_EQUIPMENT_IDS）。
    for (let i = 1; i <= 20; i++) {
      const g = String(i).padStart(2, '0');
      equipSlots.forEach((slot) => {
        const key = `equip_${slot}_g${g}`;
        this.load.image(key, `assets/${key}.png`);
      });
    }

    // 傳說階裝備：5 主題套裝（烈焰/寒冰/聖光/狂風/雷霆）x 5 部位，正式美術圖切自
    // D:\遊戲檔案\素材 的系列圖，取代原本 TextureFactory 動態畫的簡易圖示。
    const legendarySlugs = ['flame', 'ice', 'holy', 'wind', 'thunder'];
    legendarySlugs.forEach((slug) => {
      equipSlots.forEach((slot) => {
        const key = `equip_legendary_${slot}_${slug}`;
        this.load.image(key, `assets/${key}.png`);
      });
    });

    // 電擊飛刃／血肉風暴／世界末日三把融合武器改用正式美術圖，取代原本
    // TextureFactory.generateFusionWeaponIcons() 畫的簡易圖示。
    // 世界末日的 worldend_* 特效切圖已棄用（切圖帶著原圖漸層背景去不乾淨，
    // 畫面上會出現方形色塊），落地/地板特效全部改回程式繪製（見 GameScene）。
    this.load.image('weapon_lightning_knife_lv5', 'assets/weapon_lightning_knife_lv5.png');
    this.load.image('weapon_knife_sawblade_lv5', 'assets/weapon_knife_sawblade_lv5.png');
    this.load.image('weapon_fireball_frost_lv5', 'assets/weapon_fireball_frost_lv5.png');
    this.load.image('proj_electroknife', 'assets/proj_electroknife.png');
    this.load.image('fx_bloodstorm', 'assets/fx_bloodstorm.png');
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
