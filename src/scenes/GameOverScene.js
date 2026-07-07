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

    // 背景跟主選單共用同一張封面圖，維持風格一致
    this.add.image(w / 2, h / 2, 'menu_bg').setDisplaySize(w, h);

    this.add.rectangle(w / 2, 70, 640, 84, 0x0a0e16, 0.6);
    this.add.text(w / 2, 70, '⚠ 遊戲結束 ⚠', textStyle({ fontSize: '58px', color: '#ff6b6b' })).setOrigin(0.5);

    const score = this.kills * 10 + this.level * 50 + Math.floor(this.playTime * 0.5);
    setBestScore(score);

    // 擊殺數直接轉換成金幣（1 擊殺 = 1 金幣），存進永久金幣存款，可以拿去商店買裝備
    const goldEarned = this.kills;
    addGold(goldEarned);

    const mm = String(Math.floor(this.playTime / 60)).padStart(2, '0');
    const ss = String(this.playTime % 60).padStart(2, '0');

    // ---- 統整資訊面板：固定像素座標排版，確保標題／分隔線／每一行數值都留足間距，
    // 不會像素數比較長的內容擠在一起疊字 ----
    const infoPanelW = 760, infoPanelH = 380;
    const infoPanelY = 300;
    const infoPanelTop = infoPanelY - infoPanelH / 2;
    this.add.image(w / 2, infoPanelY, 'ui_panel').setDisplaySize(infoPanelW, infoPanelH).setDepth(0);
    this.add.rectangle(w / 2, infoPanelY, infoPanelW - 6, infoPanelH - 6)
      .setStrokeStyle(3, 0xffd93d, 0.7).setFillStyle(0, 0).setDepth(1);
    this.add.text(w / 2, infoPanelTop + 34, '本場戰績', textStyle({
      fontSize: '30px', color: '#ffd93d',
    })).setOrigin(0.5).setDepth(1);
    this.add.rectangle(w / 2, infoPanelTop + 64, infoPanelW - 80, 2, 0xffd93d, 0.4).setDepth(1);

    const statLines = [
      `分數：${score}`,
      `等級：Lv.${this.level}`,
      `擊殺數：${this.kills}`,
      `存活時間：${mm}:${ss}`,
      `歷史最佳：${getBestScore()}`,
      `💰 獲得金幣：+${goldEarned}（目前總金幣：${getGold()}）`,
    ];
    const statLineH = 36;
    statLines.forEach((line, i) => {
      this.add.text(w / 2, infoPanelTop + 96 + i * statLineH, line, textStyle({
        fontSize: '27px', color: '#ffffff',
      })).setOrigin(0.5).setDepth(1);
    });

    const name = getPlayerName() || '冒險者';
    submitScore({
      name, score, kill: this.kills, time: this.playTime,
      date: new Date().toISOString(),
    });

    // ---- 排行榜面板：同樣用 ui_panel 框起來，位置緊接在統整資訊面板下方 ----
    const lbPanelW = 620, lbPanelH = 430;
    const lbPanelY = infoPanelTop + infoPanelH + 40 + lbPanelH / 2;
    const lbPanelTop = lbPanelY - lbPanelH / 2;
    this.add.image(w / 2, lbPanelY, 'ui_panel').setDisplaySize(lbPanelW, lbPanelH).setDepth(0);
    this.add.rectangle(w / 2, lbPanelY, lbPanelW - 6, lbPanelH - 6)
      .setStrokeStyle(3, 0x6fd3ff, 0.7).setFillStyle(0, 0).setDepth(1);
    this.add.text(w / 2, lbPanelTop + 34, '🏆 即時排行榜 TOP10', textStyle({
      fontSize: '28px', color: '#ffd93d',
    })).setOrigin(0.5).setDepth(1);
    this.add.rectangle(w / 2, lbPanelTop + 64, lbPanelW - 80, 2, 0x6fd3ff, 0.4).setDepth(1);

    this.lbText = this.add.text(w / 2, lbPanelTop + 84, '讀取中...', textStyle({
      fontSize: '21px', color: '#cfe9ff', align: 'center', lineSpacing: 8,
    })).setOrigin(0.5, 0).setDepth(1);

    this._unsubLeaderboard = subscribeLeaderboard((rows) => {
      if (!this.lbText || !this.lbText.active) return;
      const lines = rows.slice(0, 10).map((r, i) => `${i + 1}. ${r.name || '???'}  —  ${r.score || 0}`);
      this.lbText.setText(lines.length ? lines.join('\n') : '目前尚無紀錄');
    });
    this.events.once('shutdown', () => {
      if (this._unsubLeaderboard) this._unsubLeaderboard();
    });

    // 按鈕改用跟主選單一致的羊皮紙風格，深咖啡色文字，不用 hover 也清楚可讀
    const btn = this.add.image(w / 2, h - 60, 'ui_button_parchment').setDisplaySize(360, 76).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 60, '返回主選單', textStyle({ fontSize: '32px', color: '#3a2413' })).setOrigin(0.5);
    btn.on('pointerover', () => btn.setTint(0xfff3d0));
    btn.on('pointerout', () => btn.clearTint());
    btn.on('pointerdown', () => this.scene.start('MainMenuScene'));
  }
}
