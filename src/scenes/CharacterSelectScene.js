import { CHARACTERS } from '../player/Player.js';
import { promptPlayerName } from '../managers/SaveManager.js';
import { subscribeLeaderboard } from '../firebase/firebase.js';

export default class CharacterSelectScene extends Phaser.Scene {
  constructor() { super('CharacterSelectScene'); }

  async create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x10131a);
    this.add.text(w / 2, h * 0.08, '像素求生 Pixel Survivors', {
      fontSize: '44px', color: '#6fd3ff', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(w / 2, h * 0.08 + 46, '選擇你的角色', {
      fontSize: '18px', color: '#ccc',
    }).setOrigin(0.5);

    await promptPlayerName();

    const ids = Object.values(CHARACTERS);
    const cardW = 300, cardH = 360, gap = 44;
    const totalW = ids.length * cardW + (ids.length - 1) * gap;
    let startX = w / 2 - totalW / 2 + cardW / 2;
    const cy = h / 2 - 10;

    ids.forEach((char, i) => {
      const cx = startX + i * (cardW + gap);
      const card = this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH).setInteractive({ useHandCursor: true });
      this.add.image(cx, cy - 100, char.texture).setScale(3.2);

      this.add.text(cx, cy - 24, char.typeLabel, {
        fontSize: '15px', color: '#9fd3ff',
      }).setOrigin(0.5);
      this.add.text(cx, cy + 6, char.name, {
        fontSize: '26px', color: '#fff', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.add.text(cx, cy + 40, char.title === '無' ? '' : `「${char.title}」`, {
        fontSize: '15px', color: '#ffd93d', fontStyle: 'italic',
      }).setOrigin(0.5);
      this.add.text(cx, cy + 100, char.desc, {
        fontSize: '14px', color: '#9fd3ff', align: 'center', lineSpacing: 4,
        wordWrap: { width: cardW - 40, useAdvancedWrap: true },
      }).setOrigin(0.5);

      card.on('pointerover', () => card.setTint(0xbfe9ff));
      card.on('pointerout', () => card.clearTint());
      card.on('pointerdown', () => {
        this.scene.start('GameScene', { characterId: char.id });
      });
    });

    this.add.text(w / 2, h - 70, '操作：WASD 移動／自動鎖定攻擊／SPACE 衝刺／ESC 暫停', {
      fontSize: '18px', color: '#999',
    }).setOrigin(0.5);

    // 排行榜預覽
    this.lbText = this.add.text(w - 30, h * 0.16, '讀取排行榜中...', {
      fontSize: '14px', color: '#ffd93d', align: 'right', lineSpacing: 4,
    }).setOrigin(1, 0);
    this._unsubLeaderboard = subscribeLeaderboard((rows) => {
      if (!this.lbText || !this.lbText.active) return;
      const lines = ['🏆 排行榜 TOP10'];
      rows.slice(0, 10).forEach((r, i) => {
        lines.push(`${i + 1}. ${r.name || '???'} - ${r.score || 0}`);
      });
      this.lbText.setText(lines.join('\n'));
    });
    this.events.once('shutdown', () => {
      if (this._unsubLeaderboard) this._unsubLeaderboard();
    });
  }
}
