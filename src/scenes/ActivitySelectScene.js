import { ACTIVITIES, formatWoofWarTime, WOOF_WAR_OPEN_AT, WOOF_WAR_CLOSE_LABEL } from '../activities/ActivityData.js';
import { getPlayerName } from '../managers/SaveManager.js';
import { textStyle } from '../utils/TextStyle.js';

// 活動關卡選擇畫面：主選單點「活動關卡」先進這裡，用跟 StartSkillScene/LevelUpScene
// 一致的卡片風格列出所有活動（目前只有汪汪大作戰一張，資料在 ActivityData.js，
// 之後要加新活動只要在那邊的 ACTIVITIES 陣列多加一筆，這個場景不用改）。
export default class ActivitySelectScene extends Phaser.Scene {
  constructor() { super('ActivitySelectScene'); }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.82).setScrollFactor(0);
    this.add.text(w / 2, h * 0.12, '活動關卡', textStyle({
      fontSize: '56px', color: '#6fd3ff',
    })).setOrigin(0.5).setScrollFactor(0);

    const cardW = 420, cardH = 520, gap = 40;
    const totalW = ACTIVITIES.length * cardW + (ACTIVITIES.length - 1) * gap;
    const startX = w / 2 - totalW / 2 + cardW / 2;
    const cy = h / 2 + 40;

    const playerName = getPlayerName();
    ACTIVITIES.forEach((act, i) => {
      const cx = startX + i * (cardW + gap);
      const phase = act.getPhase(playerName);
      const card = this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH)
        .setInteractive({ useHandCursor: true }).setScrollFactor(0);
      if (phase !== 'live') card.setAlpha(0.55);

      this.add.image(cx, cy - 160, act.icon).setScale(1.4).setScrollFactor(0);
      this.add.text(cx, cy - 40, act.label, textStyle({
        fontSize: '30px', color: '#fff', align: 'center',
      })).setOrigin(0.5).setScrollFactor(0);
      this.add.text(cx, cy + 20, act.desc, textStyle({
        fontSize: '18px', color: '#9fd3ff', align: 'center', lineSpacing: 6,
        wordWrap: { width: cardW - 50, useAdvancedWrap: true },
      })).setOrigin(0.5, 0).setScrollFactor(0);

      let statusText = '';
      if (phase === 'before') statusText = `⏳ 開放時間：${formatWoofWarTime(WOOF_WAR_OPEN_AT)}`;
      else if (phase === 'after') statusText = '🏁 活動已結束';
      else statusText = `🔥 開放中，結束時間：${WOOF_WAR_CLOSE_LABEL}`;
      this.add.text(cx, cy + cardH / 2 - 46, statusText, textStyle({
        fontSize: '17px', color: phase === 'live' ? '#5bff8f' : '#ff9a9a',
      })).setOrigin(0.5).setScrollFactor(0);

      card.on('pointerover', () => card.setTint(0xbfe9ff));
      card.on('pointerout', () => card.clearTint());
      card.on('pointerdown', () => {
        if (phase === 'before') { this._showToast(`活動尚未開放，開放時間：${formatWoofWarTime(WOOF_WAR_OPEN_AT)}`); return; }
        if (phase === 'after') { this._showToast('活動已結束，敬請期待下次活動！'); return; }
        act.onEnter(this);
      });
    });

    const backBtn = this.add.image(w / 2, h - 60, 'ui_bar_bg').setDisplaySize(280, 70).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 60, '返回主選單', textStyle({ fontSize: '28px', color: '#10131a' })).setOrigin(0.5);
    backBtn.on('pointerover', () => backBtn.setTint(0x6fd3ff));
    backBtn.on('pointerout', () => backBtn.clearTint());
    backBtn.on('pointerdown', () => this.scene.start('MainMenuScene'));
  }

  _showToast(msg) {
    const w = this.scale.width, h = this.scale.height;
    const t = this.add.text(w / 2, h - 130, msg, textStyle({ fontSize: '26px', color: '#ffe066' })).setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, duration: 1200, delay: 500, onComplete: () => t.destroy() });
  }
}
