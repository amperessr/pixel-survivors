import { promptPlayerName, getGold } from '../managers/SaveManager.js';
import { subscribeLeaderboard } from '../firebase/firebase.js';
import { textStyle } from '../utils/TextStyle.js';

// 主選單：初始角色固定為「平衡型」，不再需要選角，
// 改成「背包／商店／開始遊戲」三個入口（GameScene 沒帶 characterId 時預設就是 balanced）。
export default class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenuScene'); }

  async create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x10131a);
    this.add.text(w / 2, h * 0.14, '像素求生 Pixel Survivors', textStyle({
      fontSize: '72px', color: '#6fd3ff',
    })).setOrigin(0.5);

    await promptPlayerName();

    this.add.image(w / 2, h * 0.42, 'player_balanced').setScale(3.2);

    this.goldText = this.add.text(w / 2, h * 0.14 + 60, `金幣：${getGold()}`, textStyle({
      fontSize: '30px', color: '#ffd93d',
    })).setOrigin(0.5);

    const btnW = 420, btnH = 96, gap = 30;
    const items = [
      { label: '背包', onPick: () => this.scene.start('InventoryScene') },
      { label: '商店', onPick: () => this.scene.start('ShopScene') },
      { label: '開始遊戲', onPick: () => this.scene.start('GameScene') },
    ];
    const totalH = items.length * btnH + (items.length - 1) * gap;
    let cy = h * 0.66 - totalH / 2 + btnH / 2;

    items.forEach((item) => {
      const btn = this.add.image(w / 2, cy, 'ui_bar_bg').setDisplaySize(btnW, btnH).setInteractive({ useHandCursor: true });
      this.add.text(w / 2, cy, item.label, textStyle({
        fontSize: '38px', color: '#10131a',
      })).setOrigin(0.5);
      btn.on('pointerover', () => btn.setTint(0x6fd3ff));
      btn.on('pointerout', () => btn.clearTint());
      btn.on('pointerdown', item.onPick);
      cy += btnH + gap;
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
