import { CHARACTERS } from '../player/Player.js';
import { promptPlayerName } from '../managers/SaveManager.js';
import { subscribeLeaderboard } from '../firebase/firebase.js';

export default class CharacterSelectScene extends Phaser.Scene {
  constructor() { super('CharacterSelectScene'); }

  async create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x10131a);
    this.add.text(w / 2, 60, '像素求生 Pixel Survivors', {
      fontSize: '34px', color: '#6fd3ff', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(w / 2, 100, '選擇你的角色', {
      fontSize: '16px', color: '#ccc',
    }).setOrigin(0.5);

    await promptPlayerName();

    const ids = Object.values(CHARACTERS);
    const cardW = 200, gap = 24;
    const totalW = ids.length * cardW + (ids.length - 1) * gap;
    let startX = w / 2 - totalW / 2 + cardW / 2;
    const cy = h / 2 - 20;

    ids.forEach((char, i) => {
      const cx = startX + i * (cardW + gap);
      const card = this.add.image(cx, cy, 'ui_card').setInteractive({ useHandCursor: true });
      this.add.image(cx, cy - 60, char.texture).setScale(2.2);
      this.add.text(cx, cy + 10, char.name, {
        fontSize: '14px', color: '#fff', fontStyle: 'bold', align: 'center', wordWrap: { width: 170 },
      }).setOrigin(0.5);
      this.add.text(cx, cy + 60, char.desc, {
        fontSize: '11px', color: '#9fd3ff', align: 'center', wordWrap: { width: 170 },
      }).setOrigin(0.5);

      card.on('pointerover', () => card.setTint(0xbfe9ff));
      card.on('pointerout', () => card.clearTint());
      card.on('pointerdown', () => {
        this.scene.start('GameScene', { characterId: char.id });
      });
    });

    this.add.text(w / 2, h - 90, '操作：WASD 移動／滑鼠瞄準／左鍵攻擊／SPACE 衝刺／ESC 暫停', {
      fontSize: '12px', color: '#888',
    }).setOrigin(0.5);

    // 排行榜預覽
    this.lbText = this.add.text(w - 20, 140, '讀取排行榜中...', {
      fontSize: '12px', color: '#ffd93d', align: 'right',
    }).setOrigin(1, 0);
    subscribeLeaderboard((rows) => {
      if (!this.lbText.active) return;
      const lines = ['🏆 排行榜 TOP10'];
      rows.slice(0, 10).forEach((r, i) => {
        lines.push(`${i + 1}. ${r.name || '???'} - ${r.score || 0}`);
      });
      this.lbText.setText(lines.join('\n'));
    });
  }
}
