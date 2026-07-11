import { BOSS_TYPES } from '../boss/Boss.js';
import { textStyle } from '../utils/TextStyle.js';

// 暗影君王套裝五件套：擊敗魔王後跳出的抽取視窗（取代原本擊殺瞬間 50% 自動判定）。
// 最多三次機會，機率遞增（10%／25%／50%），任一次成功就停止並把 bossType 記進
// GameScene.shadowBossQueue；三次都失敗，或任一次選「否」就直接關閉、不抽取。
const EXTRACT_CHANCES = [10, 25, 50]; // 百分比，索引對應第 1/2/3 次

export default class ShadowExtractScene extends Phaser.Scene {
  constructor() { super('ShadowExtractScene'); }

  init(data) {
    this.gs = data.gameScene;
    this.bossType = data.bossType;
    this.attempt = 0; // 已經嘗試的次數，下一次要骰 EXTRACT_CHANCES[this.attempt]
  }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.75).setScrollFactor(0);

    const bossDef = BOSS_TYPES[this.bossType] || BOSS_TYPES.blue;
    this.bossName = bossDef.name;

    this.add.image(w / 2, h / 2, 'ui_panel').setDisplaySize(620, 300).setScrollFactor(0);
    this.add.rectangle(w / 2, h / 2, 614, 294).setStrokeStyle(3, 0xc68fff, 0.85).setFillStyle(0, 0).setScrollFactor(0);

    // 統一「黑字+紫色描邊」風格，跟 UIScene.announceShadowRise() 的召喚提示同一套視覺
    this.msgText = this.add.text(w / 2, h / 2 - 40, '', textStyle({
      fontSize: '30px', color: '#000000', fontStyle: 'bold', stroke: '#c68fff', strokeThickness: 6,
      align: 'center', wordWrap: { width: 560, useAdvancedWrap: true },
    })).setOrigin(0.5).setScrollFactor(0);

    this.yesBtn = this.add.image(w / 2 - 100, h / 2 + 90, 'ui_button_parchment')
      .setDisplaySize(170, 52).setInteractive({ useHandCursor: true }).setScrollFactor(0);
    this.yesText = this.add.text(w / 2 - 100, h / 2 + 90, '是', textStyle({
      fontSize: '24px', color: '#3a2413',
    })).setOrigin(0.5).setScrollFactor(0);
    this.noBtn = this.add.image(w / 2 + 100, h / 2 + 90, 'ui_button_parchment')
      .setDisplaySize(170, 52).setInteractive({ useHandCursor: true }).setScrollFactor(0);
    this.noText = this.add.text(w / 2 + 100, h / 2 + 90, '否', textStyle({
      fontSize: '24px', color: '#3a2413',
    })).setOrigin(0.5).setScrollFactor(0);

    this.yesBtn.on('pointerover', () => this.yesBtn.setTint(0xfff3d0));
    this.yesBtn.on('pointerout', () => this.yesBtn.clearTint());
    this.noBtn.on('pointerover', () => this.noBtn.setTint(0xff9a9a));
    this.noBtn.on('pointerout', () => this.noBtn.clearTint());

    this._showAsk();
  }

  _showAsk() {
    const verb = this.attempt === 0 ? '是否抽取' : '是否再次抽取';
    const prefix = this.attempt === 0 ? `${verb}${this.bossName}的影子？` : `抽取失敗\n${verb}？`;
    this.msgText.setText(prefix);
    this._setButtonsVisible(true);
    this.yesBtn.removeAllListeners('pointerdown');
    this.noBtn.removeAllListeners('pointerdown');
    this.yesBtn.once('pointerdown', () => this._roll());
    this.noBtn.once('pointerdown', () => this._close());
  }

  _roll() {
    const chance = EXTRACT_CHANCES[this.attempt];
    this.attempt++;
    const success = Math.random() * 100 < chance;
    this._setButtonsVisible(false);
    if (success) {
      this.gs.shadowBossQueue.push(this.bossType);
      this.msgText.setText('抽取成功');
      this.time.delayedCall(1100, () => this._close());
    } else if (this.attempt < EXTRACT_CHANCES.length) {
      this._showAsk();
    } else {
      this.msgText.setText('抽取失敗');
      this.time.delayedCall(1100, () => this._close());
    }
  }

  _setButtonsVisible(v) {
    this.yesBtn.setVisible(v); this.yesText.setVisible(v);
    this.noBtn.setVisible(v); this.noText.setVisible(v);
  }

  _close() {
    this.gs.resumeFromShadowExtract();
    this.scene.stop();
  }
}
