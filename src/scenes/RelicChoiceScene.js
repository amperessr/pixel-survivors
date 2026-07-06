import { textStyle } from '../utils/TextStyle.js';

// 遺物選擇彈窗：擊敗 Boss 後跳出的二選一視窗，內容依傳入的 relic 資料動態產生，
// 讓「龍之光環」「龍之翼」等不同遺物可以共用同一套 UI，不用每種遺物各寫一個場景。
export default class RelicChoiceScene extends Phaser.Scene {
  constructor() { super('RelicChoiceScene'); }

  init(data) {
    this.gs = data.gameScene;
    this.relic = data.relic;
  }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.8).setScrollFactor(0);

    this.add.text(w / 2, h * 0.14, '⚠ 巨龍已擊敗 ⚠', textStyle({
      fontSize: '58px', color: '#ffe066',
    })).setOrigin(0.5).setScrollFactor(0);
    this.add.text(w / 2, h * 0.14 + 66, `是否要拿取遺物：${this.relic.name}？`, textStyle({
      fontSize: '30px', color: '#cfe9ff',
    })).setOrigin(0.5).setScrollFactor(0);

    const cardW = 480, cardH = 560, gap = 70;
    const totalW = cardW * 2 + gap;
    const startX = w / 2 - totalW / 2 + cardW / 2;
    const cy = h / 2 + 40;

    this._makeCard(startX, cy, cardW, cardH, {
      icon: this.relic.icon, iconTint: this.relic.iconTint, iconScale: 1.3,
      title: `⭐ 拿取「${this.relic.name}」`,
      titleColor: '#ffe066',
      desc: this.relic.desc,
      onPick: () => this._accept(),
      gold: true,
    });

    this._makeCard(startX + cardW + gap, cy, cardW, cardH, {
      icon: 'pickup_heart', iconTint: 0xffffff, iconScale: 1.6,
      title: '維持現狀',
      titleColor: '#ffffff',
      desc: '不套用任何加成\n直接關閉視窗，繼續冒險',
      onPick: () => this._decline(),
      gold: false,
    });
  }

  _makeCard(cx, cy, cardW, cardH, opt) {
    const card = this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH)
      .setInteractive({ useHandCursor: true }).setScrollFactor(0);
    if (opt.gold) card.setTint(0xfff3c4);

    const icon = this.add.image(cx, cy - 170, opt.icon).setScale((opt.iconScale || 1.6) * 1.6).setScrollFactor(0);
    if (opt.iconTint) icon.setTint(opt.iconTint);

    this.add.text(cx, cy - 30, opt.title, textStyle({
      fontSize: '32px', color: opt.titleColor, align: 'center',
      wordWrap: { width: cardW - 50, useAdvancedWrap: true },
    })).setOrigin(0.5).setScrollFactor(0);

    this.add.text(cx, cy + 100, opt.desc, textStyle({
      fontSize: '24px', color: '#9fd3ff', align: 'center', lineSpacing: 10,
      wordWrap: { width: cardW - 60, useAdvancedWrap: true },
    })).setOrigin(0.5).setScrollFactor(0);

    const baseTint = opt.gold ? 0xfff3c4 : 0xffffff;
    const hoverTint = opt.gold ? 0xffffff : 0xbfe9ff;
    card.on('pointerover', () => card.setTint(hoverTint));
    card.on('pointerout', () => card.setTint(baseTint));
    card.on('pointerdown', () => opt.onPick());
  }

  _accept() {
    this.relic.apply(this.gs);
    this.gs.resumeFromRelicChoice();
    this.scene.stop();
  }

  _decline() {
    this.gs.resumeFromRelicChoice();
    this.scene.stop();
  }
}
