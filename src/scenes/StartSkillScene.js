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

    // 卡片寬度依武器數量動態縮小，避免全部列出來時（現在 6 把）超出畫面寬度——
    // 340px 是「5 把剛好塞滿」時的原始寬度，超過就照可用寬度等比例縮小，
    // 高度/圖示縮放跟著同一個比例調整，卡片整體看起來還是同一種比例，不會變形。
    const baseCardW = 340, baseCardH = 480, gap = 24;
    const availableW = w - 100;
    let cardW = baseCardW;
    if (WEAPON_IDS.length * baseCardW + (WEAPON_IDS.length - 1) * gap > availableW) {
      cardW = (availableW - (WEAPON_IDS.length - 1) * gap) / WEAPON_IDS.length;
    }
    const shrink = cardW / baseCardW;
    const cardH = baseCardH * shrink;
    const totalW = WEAPON_IDS.length * cardW + (WEAPON_IDS.length - 1) * gap;
    const startX = w / 2 - totalW / 2 + cardW / 2;
    const cy = h / 2 + 60;

    WEAPON_IDS.forEach((id, i) => {
      const cx = startX + i * (cardW + gap);
      const def = WEAPON_DATA[id];
      const card = this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH)
        .setInteractive({ useHandCursor: true }).setScrollFactor(0);
      this.add.image(cx, cy - 150 * shrink, `weapon_${id}_lv1`).setScale(2.4 * shrink).setScrollFactor(0);
      this.add.text(cx, cy - 30 * shrink, def.name, textStyle({
        fontSize: '28px', color: '#fff', align: 'center',
      })).setOrigin(0.5).setScrollFactor(0);
      this.add.text(cx, cy + 70 * shrink, def.desc, textStyle({
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
