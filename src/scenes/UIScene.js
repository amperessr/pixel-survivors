import { WEAPON_DATA } from '../weapons/WeaponData.js';

export default class UIScene extends Phaser.Scene {
  constructor() { super('UIScene'); }

  init(data) {
    this.gs = data.gameScene;
  }

  create() {
    const w = this.scale.width, h = this.scale.height;

    // ---- 左上：HP / 等級 / EXP ----
    this.add.image(110, 30, 'ui_bar_bg').setScrollFactor(0).setDisplaySize(200, 16).setOrigin(0.5);
    this.hpFill = this.add.image(12, 30, 'ui_bar_fill_hp').setScrollFactor(0).setOrigin(0, 0.5).setDisplaySize(196, 14);
    this.hpText = this.add.text(112, 30, '', { fontSize: '11px', color: '#fff' }).setOrigin(0.5).setScrollFactor(0);

    this.lvText = this.add.text(12, 46, 'Lv.1', { fontSize: '14px', color: '#6fd3ff', fontStyle: 'bold' }).setScrollFactor(0);
    this.add.image(150, 64, 'ui_bar_bg').setScrollFactor(0).setDisplaySize(120, 10).setOrigin(0.5);
    this.xpFill = this.add.image(90, 64, 'ui_bar_fill_xp').setScrollFactor(0).setOrigin(0, 0.5).setDisplaySize(118, 8);

    // ---- 右上：時間 / 擊殺數 / FPS ----
    this.timeText = this.add.text(w - 12, 12, '', { fontSize: '14px', color: '#fff' }).setOrigin(1, 0).setScrollFactor(0);
    this.killText = this.add.text(w - 12, 32, '', { fontSize: '13px', color: '#ffd93d' }).setOrigin(1, 0).setScrollFactor(0);
    this.fpsText = this.add.text(w - 12, 50, '', { fontSize: '11px', color: '#888' }).setOrigin(1, 0).setScrollFactor(0);

    // ---- 右側：目前技能 ----
    this.weaponPanel = this.add.container(w - 90, 100).setScrollFactor(0);
    this.add.text(w - 150, 84, '武器', { fontSize: '12px', color: '#aaa' }).setScrollFactor(0);

    // ---- 下方：角色能力值 ----
    this.statsText = this.add.text(w / 2, h - 16, '', {
      fontSize: '12px', color: '#cfe9ff', align: 'center',
    }).setOrigin(0.5, 1).setScrollFactor(0);

    // ---- 暫停覆蓋層 ----
    this.pauseOverlay = this.add.container(0, 0).setScrollFactor(0).setDepth(50000).setVisible(false);
    const dim = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.6);
    const txt = this.add.text(w / 2, h / 2, '已暫停\n按 ESC 繼續', {
      fontSize: '28px', color: '#fff', align: 'center',
    }).setOrigin(0.5);
    this.pauseOverlay.add([dim, txt]);

    this.gs.events.on('hidePauseOverlay', () => this.pauseOverlay.setVisible(false));

    if (this.scene.settings.data && this.scene.settings.data.showPauseOverlay) {
      this.pauseOverlay.setVisible(true);
    }
  }

  update() {
    if (!this.gs || !this.gs.player) return;
    const p = this.gs.player;

    if (this.gs.paused && !this.gs.gameEnded) {
      this.pauseOverlay.setVisible(true);
    }

    const hpRatio = Math.max(0, p.hp / p.stats.maxHp);
    this.hpFill.setDisplaySize(196 * hpRatio, 14);
    this.hpText.setText(`${Math.ceil(p.hp)} / ${p.stats.maxHp}`);
    this.lvText.setText(`Lv.${p.level}`);
    const xpRatio = Math.max(0, Math.min(1, p.exp / p.expToNext));
    this.xpFill.setDisplaySize(118 * xpRatio, 8);

    const t = this.gs.getElapsedSeconds();
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    this.timeText.setText(`⏱ ${mm}:${ss}`);
    this.killText.setText(`💀 擊殺 ${this.gs.killCount}`);
    this.fpsText.setText(`FPS ${Math.round(this.game.loop.actualFps)}`);

    this.statsText.setText(
      `ATK ${p.stats.attack}  DEF ${p.stats.defense}  SPD ${p.stats.moveSpeed}  ` +
      `AtkSpd +${p.stats.atkSpeed.toFixed(0)}%  Crit ${p.stats.critRate.toFixed(0)}%  CritDmg ${p.stats.critDmg.toFixed(0)}%`
    );

    this._refreshWeaponPanel();
  }

  _refreshWeaponPanel() {
    const owned = this.gs.weaponSystem.owned;
    const keys = Object.keys(owned);
    if (this._lastKeyStr === keys.map(k => k + owned[k]).join(',')) return;
    this._lastKeyStr = keys.map(k => k + owned[k]).join(',');

    this.weaponPanel.removeAll(true);
    keys.forEach((id, i) => {
      const y = i * 40;
      const icon = this.add.image(-20, y, `weapon_${id}_lv${owned[id]}`).setScale(1.1);
      const label = this.add.text(0, y, `${WEAPON_DATA[id].name} Lv${owned[id]}`, {
        fontSize: '11px', color: '#fff',
      }).setOrigin(0, 0.5);
      this.weaponPanel.add([icon, label]);
    });
  }
}
