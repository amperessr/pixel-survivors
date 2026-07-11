import TextureFactory from '../systems/TextureFactory.js';
import { textStyle } from '../utils/TextStyle.js';

export default class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload() {
    // 目前的外部圖片素材：龍之翼遺物特效 + 主選單背景 + 五隻 Boss 的正式美術圖 +
    // 裝備圖示（商店三階 15 張／扭蛋一般裝備 100 張／扭蛋傳說裝備 25 張／四種戒指），
    // 其餘材質還是 TextureFactory 產生。
    this.load.image('fx_dragon_wing_pair', 'assets/dragon_wing.png');
    // 龍之光環遺物的正式美術圖：持續氣場特效用黑底原圖（搭配 ADD 疊加模式，
    // 黑色部分視覺上等於透明），卡片圖示則另外去背成有 alpha 的版本（一般疊加模式用）。
    this.load.image('fx_dragon_aura', 'assets/fx_dragon_aura.png');
    this.load.image('fx_dragon_aura_icon', 'assets/fx_dragon_aura_icon.png');
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
    // 世界末日新增的炎柱環（見 WeaponSystem._fireWorldEndPillarRing()），跟冰柱交替往外刺出
    this.load.image('fx_fire_pillar', 'assets/fx_fire_pillar.png');
    // 玩家角色改用正式美術圖（藍色史萊姆），取代原本程式產生的簡易貼圖
    this.load.image('player_balanced', 'assets/player_slime.png');
    // 四種小怪改用正式美術圖（山豬/哥布林/骷髏/半獸人），取代原本 TextureFactory
    // 程式產生的簡易貼圖（見 EnemyData.js 的角色定位分配）。
    this.load.image('enemy_boar', 'assets/enemy_boar.png');
    this.load.image('enemy_goblin', 'assets/enemy_goblin.png');
    this.load.image('enemy_skeleton', 'assets/enemy_skeleton.png');
    this.load.image('enemy_orc', 'assets/enemy_orc.png');
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

    // 神話階護甲套裝：暗影君王（目前唯一一組），正式美術圖切自
    // D:\遊戲檔案\素材\暗影君王.png，見 EquipmentData.js 的 MYTHIC_ARMOR_SERIES。
    const mythicSlugs = ['shadow'];
    mythicSlugs.forEach((slug) => {
      equipSlots.forEach((slot) => {
        const key = `equip_mythic_${slot}_${slug}`;
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

    // 王魔「爪擊斬波」正式美術圖，取代 TextureFactory 畫的簡易漸層弧形（見 Boss.js
    // _executeClaw／BOSS_TYPES 的 clawTexture）。金黑色給黑龍王/血色紅龍/惡魔王，
    // 琥珀色給樹王/獅鷲王。
    this.load.image('fx_claw_slash_gold', 'assets/fx_claw_slash_gold.png');
    this.load.image('fx_claw_slash_amber', 'assets/fx_claw_slash_amber.png');

    // 王魔「新星」衝擊波正式美術圖（惡魔王詛咒新星／樹王樹根衝擊／獅鷲王王者威壓，
    // 見 Boss.js _executeNova）：金色光環為主體，尖刺狀爆裂圈疊在外層加強張力。
    this.load.image('fx_shockwave_ring', 'assets/fx_shockwave_ring.png');
    this.load.image('fx_shockwave_burst', 'assets/fx_shockwave_burst.png');

    // 爆炸正式美術圖：魔王死亡（Boss.js _die()）疊金黃色爆裂，玩家死亡
    // （GameScene._spawnPlayerDeathExplosion）疊帶煙塵感的爆裂，取代原本純光環+
    // 粒子的程式特效（改成「光環+粒子+真的爆炸貼圖」三者疊加，不是單純貼一張圖）。
    this.load.image('fx_explosion_boss', 'assets/fx_explosion_boss.png');
    this.load.image('fx_explosion_player', 'assets/fx_explosion_player.png');

    // 雷霆套裝五件套「打雷」正式美術圖（見 GameScene.spawnThunderStrikeFx），
    // 取代原本用染色拉長的 fx_bolt 長方形佔位。含透明背景，光柱置中、
    // 落雷點在圖片高度約 87.5% 處。
    this.load.image('fx_thunder_strike', 'assets/fx_thunder_strike.png');

    // 汪汪大作戰（限時挑戰活動）專用魔王美術圖，見 src/boss/WoofBoss.js
    this.load.image('boss_woof', 'assets/boss_woof.png');
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
