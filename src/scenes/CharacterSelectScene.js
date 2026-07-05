import { CHARACTERS } from '../player/Player.js';
import { promptPlayerName } from '../managers/SaveManager.js';
import { subscribeLeaderboard } from '../firebase/firebase.js';
import { textStyle } from '../utils/TextStyle.js';

export default class CharacterSelectScene extends Phaser.Scene {
  constructor() { super('CharacterSelectScene'); }

  async create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x10131a);
    this.add.text(w / 2, h * 0.07, '像素求生 Pixel Survivors', textStyle({
      fontSize: '72px', color: '#6fd3ff',
    })).setOrigin(0.5);
    this.add.text(w / 2, h * 0.07 + 60, '選擇你的角色', textStyle({
      fontSize: '32px', color: '#ccc',
    })).setOrigin(0.5);

    await promptPlayerName();

    const ids = Object.values(CHARACTERS);
    const cardW = 420, cardH = 620, gap = 50;
    const totalW = ids.length * cardW + (ids.length - 1) * gap;
    let startX = w / 2 - totalW / 2 + cardW / 2;
    const cy = h / 2 + 10;

    ids.forEach((char, i) => {
      const cx = startX + i * (cardW + gap);
      const card = this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH).setInteractive({ useHandCursor: true });
      this.add.image(cx, cy - 190, char.texture).setScale(3.25);

      this.add.text(cx, cy - 60, char.typeLabel, textStyle({
        fontSize: '30px', color: '#9fd3ff',
      })).setOrigin(0.5);
      this.add.text(cx, cy - 10, char.name, textStyle({
        fontSize: '56px', color: '#fff',
      })).setOrigin(0.5);
      this.add.text(cx, cy + 50, char.title === '無' ? '' : `「${char.title}」`, textStyle({
        fontSize: '28px', color: '#ffd93d', fontStyle: 'italic',
      })).setOrigin(0.5);
      this.add.text(cx, cy + 150, char.desc, textStyle({
        fontSize: '26px', color: '#9fd3ff', align: 'center', lineSpacing: 10,
        wordWrap: { width: cardW - 60, useAdvancedWrap: true },
      })).setOrigin(0.5);

      card.on('pointerover', () => card.setTint(0xbfe9ff));
      card.on('pointerout', () => card.clearTint());
      card.on('pointerdown', () => {
        this.scene.start('GameScene', { characterId: char.id });
      });
    });

    this.add.text(w / 2, h - 50, '操作：WASD 移動／自動鎖定攻擊／SPACE 衝刺／ESC 暫停', textStyle({
      fontSize: '26px', color: '#999',
    })).setOrigin(0.5);

    // 排行榜預覽
    this.lbText = this.add.text(w - 36, h * 0.12, '讀取排行榜中...', textStyle({
      fontSize: '26px', color: '#ffd93d', align: 'right', lineSpacing: 8,
    })).setOrigin(1, 0);
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
