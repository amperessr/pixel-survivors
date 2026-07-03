import { getPlayerName, setBestScore, getBestScore } from '../managers/SaveManager.js';
import { submitScore, subscribeLeaderboard } from '../firebase/firebase.js';

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
    this.add.text(w / 2, h * 0.13, '遊戲結束', { fontSize: '36px', color: '#ff6b6b', fontStyle: 'bold' }).setOrigin(0.5);

    const score = this.kills * 10 + this.level * 50 + Math.floor(this.playTime * 0.5);
    setBestScore(score);

    const mm = String(Math.floor(this.playTime / 60)).padStart(2, '0');
    const ss = String(this.playTime % 60).padStart(2, '0');

    this.add.text(w / 2, h * 0.26, [
      `分數：${score}`,
      `等級：Lv.${this.level}`,
      `擊殺數：${this.kills}`,
      `存活時間：${mm}:${ss}`,
      `歷史最佳：${getBestScore()}`,
    ].join('\n'), {
      fontSize: '18px', color: '#fff', align: 'center', lineSpacing: 8,
    }).setOrigin(0.5);

    const name = getPlayerName() || '冒險者';
    submitScore({
      name, score, kill: this.kills, time: this.playTime,
      date: new Date().toISOString(),
    });

    this.add.text(w / 2, h * 0.5, '🏆 即時排行榜 TOP10', { fontSize: '18px', color: '#ffd93d' }).setOrigin(0.5);
    this.lbText = this.add.text(w / 2, h * 0.5 + 30, '讀取中...', {
      fontSize: '14px', color: '#cfe9ff', align: 'center', lineSpacing: 5,
    }).setOrigin(0.5, 0);

    this._unsubLeaderboard = subscribeLeaderboard((rows) => {
      if (!this.lbText || !this.lbText.active) return;
      const lines = rows.slice(0, 10).map((r, i) => `${i + 1}. ${r.name || '???'}  —  ${r.score || 0}`);
      this.lbText.setText(lines.length ? lines.join('\n') : '目前尚無紀錄');
    });
    this.events.once('shutdown', () => {
      if (this._unsubLeaderboard) this._unsubLeaderboard();
    });

    const btn = this.add.image(w / 2, h - 100, 'ui_bar_bg').setDisplaySize(300, 60).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 100, '重新開始', { fontSize: '22px', color: '#10131a', fontStyle: 'bold' }).setOrigin(0.5);
    btn.on('pointerover', () => btn.setTint(0x6fd3ff));
    btn.on('pointerout', () => btn.clearTint());
    btn.on('pointerdown', () => this.scene.start('CharacterSelectScene'));
  }
}
