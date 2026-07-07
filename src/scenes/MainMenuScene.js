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

    // ---- 右側：排行榜 + 更新日誌，各自用面板框起來 ----
    const rightX = w - 260;
    const panelW = 480;

    const lbPanelY = h * 0.24;
    const lbPanelH = 340;
    this.add.image(rightX, lbPanelY, 'ui_panel').setDisplaySize(panelW, lbPanelH);
    this.add.rectangle(rightX, lbPanelY, panelW - 6, lbPanelH - 6).setStrokeStyle(3, 0x6fd3ff, 0.7).setFillStyle(0, 0);
    this.add.text(rightX, lbPanelY - lbPanelH / 2 + 28, '🏆 排行榜 TOP10', textStyle({
      fontSize: '26px', color: '#ffd93d',
    })).setOrigin(0.5);
    this.add.rectangle(rightX, lbPanelY - lbPanelH / 2 + 52, panelW - 60, 2, 0x6fd3ff, 0.4);
    this.lbText = this.add.text(rightX, lbPanelY - lbPanelH / 2 + 68, '讀取排行榜中...', textStyle({
      fontSize: '21px', color: '#cfe9ff', align: 'center', lineSpacing: 7,
    })).setOrigin(0.5, 0);

    // 更新日誌：簡單列出近期幾項重點更新，方便玩家知道遊戲還在持續開發
    const CHANGELOG = [
      '🆕 新增裝備系統：武器/頭盔/衣服/褲子/鞋子',
      '🆕 新增背包與商店，擊殺數可換金幣購買裝備',
      '🆕 新增遺物系統：擊敗魔王可獲得永久強化',
      '🆕 雙魔王輪替登場，各有專屬技能與外觀',
      '🆕 關卡制取代倒數計時，魔王關卡特別標示',
      '🛠 修正多項卡死、特效不同步等問題',
    ];
    const logPanelH = 320;
    const logPanelY = lbPanelY + lbPanelH / 2 + 30 + logPanelH / 2;
    this.add.image(rightX, logPanelY, 'ui_panel').setDisplaySize(panelW, logPanelH);
    this.add.rectangle(rightX, logPanelY, panelW - 6, logPanelH - 6).setStrokeStyle(3, 0xffe066, 0.7).setFillStyle(0, 0);
    this.add.text(rightX, logPanelY - logPanelH / 2 + 28, '📜 更新日誌', textStyle({
      fontSize: '26px', color: '#ffe066',
    })).setOrigin(0.5);
    this.add.rectangle(rightX, logPanelY - logPanelH / 2 + 52, panelW - 60, 2, 0xffe066, 0.4);
    this.add.text(rightX, logPanelY - logPanelH / 2 + 68, CHANGELOG.join('\n'), textStyle({
      fontSize: '19px', color: '#e6e6e6', align: 'left', lineSpacing: 12,
      wordWrap: { width: panelW - 60, useAdvancedWrap: true },
    })).setOrigin(0.5, 0);

    this._unsubLeaderboard = subscribeLeaderboard((rows) => {
      if (!this.lbText || !this.lbText.active) return;
      const lines = rows.slice(0, 10).map((r, i) => `${i + 1}. ${r.name || '???'}  —  ${r.score || 0}`);
      this.lbText.setText(lines.length ? lines.join('\n') : '目前尚無紀錄');
    });
    this.events.once('shutdown', () => {
      if (this._unsubLeaderboard) this._unsubLeaderboard();
    });
  }
}
