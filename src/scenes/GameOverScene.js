import { getPlayerName, setBestScore, getBestScore, addGold, getGold } from '../managers/SaveManager.js';
import { submitScore, subscribeLeaderboard } from '../firebase/firebase.js';
import { textStyle } from '../utils/TextStyle.js';

export default class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOverScene'); }

  init(data) {
    this.kills = data.kills || 0;
    this.level = data.level || 1;
    // 注意：不可用 this.time，那是 Phaser Scene 內建的計時器物件，
    // 之前覆蓋掉它會導致本場景與計時相關的功能出錯（重要 bug 修正）。
    this.playTime = data.time || 0;
  }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x10131a);
    this.add.text(w / 2, h * 0.1, '⚠ 遊戲結束 ⚠', textStyle({ fontSize: '72px', color: '#ff6b6b' })).setOrigin(0.5);

    const score = this.kills * 10 + this.level * 50 + Math.floor(this.playTime * 0.5);
    setBestScore(score);

    // 擊殺數直接轉換成金幣（1 擊殺 = 1 金幣），存進永久金幣存款，可以拿去商店買裝備
    const goldEarned = this.kills;
    addGold(goldEarned);

    const mm = String(Math.floor(this.playTime / 60)).padStart(2, '0');
    const ss = String(this.playTime % 60).padStart(2, '0');

    // ---- 統整資訊面板：用 ui_panel 框起來，加強美觀 ----
    const infoPanelW = 720, infoPanelH = 340;
    const infoPanelY = h * 0.36;
    this.add.image(w / 2, infoPanelY, 'ui_panel').setDisplaySize(infoPanelW, infoPanelH).setDepth(0);
    this.add.rectangle(w / 2, infoPanelY, infoPanelW - 6, infoPanelH - 6)
      .setStrokeStyle(3, 0xffd93d, 0.7).setFillStyle(0, 0).setDepth(1);
    this.add.text(w / 2, infoPanelY - infoPanelH / 2 + 30, '本場戰績', textStyle({
      fontSize: '30px', color: '#ffd93d',
    })).setOrigin(0.5).setDepth(1);
    this.add.rectangle(w / 2, infoPanelY - infoPanelH / 2 + 58, infoPanelW - 80, 2, 0xffd93d, 0.4).setDepth(1);

    this.add.text(w / 2, infoPanelY + 14, [
      `分數：${score}`,
      `等級：Lv.${this.level}`,
      `擊殺數：${this.kills}`,
      `存活時間：${mm}:${ss}`,
      `歷史最佳：${getBestScore()}`,
      `💰 獲得金幣：+${goldEarned}（目前總金幣：${getGold()}）`,
    ].join('\n'), textStyle({
      fontSize: '32px', color: '#fff', align: 'center', lineSpacing: 12,
    })).setOrigin(0.5).setDepth(1);

    const name = getPlayerName() || '冒險者';
    submitScore({
      name, score, kill: this.kills, time: this.playTime,
      date: new Date().toISOString(),
    });

    // ---- 排行榜面板：同樣用 ui_panel 框起來 ----
    const lbPanelW = 560, lbPanelH = 400;
    const lbPanelY = infoPanelY + infoPanelH / 2 + 40 + lbPanelH / 2;
    this.add.image(w / 2, lbPanelY, 'ui_panel').setDisplaySize(lbPanelW, lbPanelH).setDepth(0);
    this.add.rectangle(w / 2, lbPanelY, lbPanelW - 6, lbPanelH - 6)
      .setStrokeStyle(3, 0x6fd3ff, 0.7).setFillStyle(0, 0).setDepth(1);
    this.add.text(w / 2, lbPanelY - lbPanelH / 2 + 30, '🏆 即時排行榜 TOP10', textStyle({
      fontSize: '30px', color: '#ffd93d',
    })).setOrigin(0.5).setDepth(1);
    this.add.rectangle(w / 2, lbPanelY - lbPanelH / 2 + 58, lbPanelW - 80, 2, 0x6fd3ff, 0.4).setDepth(1);

    this.lbText = this.add.text(w / 2, lbPanelY - lbPanelH / 2 + 78, '讀取中...', textStyle({
      fontSize: '24px', color: '#cfe9ff', align: 'center', lineSpacing: 8,
    })).setOrigin(0.5, 0).setDepth(1);

    this._unsubLeaderboard = subscribeLeaderboard((rows) => {
      if (!this.lbText || !this.lbText.active) return;
      const lines = rows.slice(0, 10).map((r, i) => `${i + 1}. ${r.name || '???'}  —  ${r.score || 0}`);
      this.lbText.setText(lines.length ? lines.join('\n') : '目前尚無紀錄');
    });
    this.events.once('shutdown', () => {
      if (this._unsubLeaderboard) this._unsubLeaderboard();
    });

    const btn = this.add.image(w / 2, h - 60, 'ui_bar_bg').setDisplaySize(360, 76).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 60, '返回主選單', textStyle({ fontSize: '32px', color: '#10131a' })).setOrigin(0.5);
    btn.on('pointerover', () => btn.setTint(0x6fd3ff));
    btn.on('pointerout', () => btn.clearTint());
    btn.on('pointerdown', () => this.scene.start('MainMenuScene'));
  }
}
