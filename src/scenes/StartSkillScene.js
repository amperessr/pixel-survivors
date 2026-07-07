import { WEAPON_IDS, WEAPON_DATA } from '../weapons/WeaponData.js';
import { textStyle } from '../utils/TextStyle.js';

// 開局技能選擇視窗：五種主動技能全部列出來，玩家自己選一個當這場遊戲的起始武器，
// 不再固定都是火球術。跟 LevelUpScene／RelicChoiceScene 共用同一套「卡片選擇」視覺風格。
export default class StartSkillScene extends Phaser.Scene {
  constructor() { super('StartSkillScene'); }

  init(data) {
    this.gs = data.gameScene;
  }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.82).setScrollFactor(0);
    this.add.text(w / 2, h * 0.12, '選擇你的起始技能', textStyle({
      fontSize: '56px', color: '#6fd3ff',
    })).setOrigin(0.5).setScrollFactor(0);
    this.add.text(w / 2, h * 0.12 + 54, '這將是你這場冒險的第一個主動技能', textStyle({
      fontSize: '24px', color: '#9fd3ff',
    })).setOrigin(0.5).setScrollFactor(0);

    const cardW = 340, cardH = 480, gap = 30;
    const totalW = WEAPON_IDS.length * cardW + (WEAPON_IDS.length - 1) * gap;
    const startX = w / 2 - totalW / 2 + cardW / 2;
    const cy = h / 2 + 60;

    WEAPON_IDS.forEach((id, i) => {
      const cx = startX + i * (cardW + gap);
      const def = WEAPON_DATA[id];
      const card = this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH)
        .setInteractive({ useHandCursor: true }).setScrollFactor(0);
      this.add.image(cx, cy - 150, `weapon_${id}_lv1`).setScale(2.4).setScrollFactor(0);
      this.add.text(cx, cy - 30, def.name, textStyle({
        fontSize: '28px', color: '#fff', align: 'center',
      })).setOrigin(0.5).setScrollFactor(0);
      this.add.text(cx, cy + 70, def.desc, textStyle({
        fontSize: '19px', color: '#9fd3ff', align: 'center', lineSpacing: 6,
        wordWrap: { width: cardW - 40, useAdvancedWrap: true },
      })).setOrigin(0.5).setScrollFactor(0);

      card.on('pointerover', () => card.setTint(0xbfe9ff));
      card.on('pointerout', () => card.clearTint());
      card.on('pointerdown', () => this._select(id));
    });
  }

  _select(weaponId) {
    this.gs.weaponSystem.addOrUpgrade(weaponId);
    this.gs.resumeFromStartSkillChoice();
    this.scene.stop();
  }
}
