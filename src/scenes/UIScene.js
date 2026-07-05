import { WEAPON_DATA, WEAPON_EVOLUTIONS } from '../weapons/WeaponData.js';
import { textStyle } from '../utils/TextStyle.js';

export default class UIScene extends Phaser.Scene {
  constructor() { super('UIScene'); }

  init(data) {
    this.gs = data.gameScene;
  }

  create() {
    const w = this.scale.width, h = this.scale.height;

    // ---- 左上：HP / 等級 / EXP ----
    this.add.image(280, 70, 'ui_bar_bg').setScrollFactor(0).setDisplaySize(500, 44).setOrigin(0.5);
    this.hpFill = this.add.image(30, 70, 'ui_bar_fill_hp').setScrollFactor(0).setOrigin(0, 0.5).setDisplaySize(492, 38);
    this.hpText = this.add.text(280, 70, '', textStyle({ fontSize: '26px', color: '#fff' })).setOrigin(0.5).setScrollFactor(0);

    this.lvText = this.add.text(30, 108, 'Lv.1', textStyle({ fontSize: '38px', color: '#6fd3ff' })).setScrollFactor(0);
    this.add.image(400, 158, 'ui_bar_bg').setScrollFactor(0).setDisplaySize(280, 22).setOrigin(0.5);
    this.xpFill = this.add.image(260, 158, 'ui_bar_fill_xp').setScrollFactor(0).setOrigin(0, 0.5).setDisplaySize(278, 19);

    // ---- 右上：時間 / 擊殺數 / FPS ----
    this.timeText = this.add.text(w - 32, 26, '', textStyle({ fontSize: '38px', color: '#fff' })).setOrigin(1, 0).setScrollFactor(0);
    this.killText = this.add.text(w - 32, 74, '', textStyle({ fontSize: '28px', color: '#ffd93d' })).setOrigin(1, 0).setScrollFactor(0);
    this.fpsText = this.add.text(w - 32, 112, '', textStyle({ fontSize: '20px', color: '#999' })).setOrigin(1, 0).setScrollFactor(0);

    // ---- 右側：目前技能 ----
    this.weaponPanel = this.add.container(w - 220, 220).setScrollFactor(0);
    this.add.text(w - 340, 180, '武器', textStyle({ fontSize: '26px', color: '#bbb' })).setScrollFactor(0);

    // ---- 下方：角色能力值 ----
    this.statsText = this.add.text(w / 2, h - 36, '', textStyle({
      fontSize: '26px', color: '#cfe9ff', align: 'center',
    })).setOrigin(0.5, 1).setScrollFactor(0);

    // ---- 暫停覆蓋層 ----
    this.pauseOverlay = this.add.container(0, 0).setScrollFactor(0).setDepth(50000).setVisible(false);
    const dim = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.6);
    const txt = this.add.text(w / 2, h / 2, '已暫停\n按 ESC 繼續', textStyle({
      fontSize: '64px', color: '#fff', align: 'center',
    })).setOrigin(0.5);
    this.pauseOverlay.add([dim, txt]);
  }

  update() {
    if (!this.gs || !this.gs.player) return;
    const p = this.gs.player;

    // 暫停遮罩只反映玩家手動按 ESC 的狀態，每一幀都重新判斷，
    // 這樣無論是 ESC 暫停/繼續，或是升級選單造成的暫停，都不會卡住
    this.pauseOverlay.setVisible(!!this.gs.escPaused && !this.gs.gameEnded);

    const hpRatio = Math.max(0, p.hp / p.stats.maxHp);
    this.hpFill.setDisplaySize(492 * hpRatio, 38);
    this.hpText.setText(`${Math.ceil(p.hp)} / ${p.stats.maxHp}`);
    this.lvText.setText(`Lv.${p.level}`);
    const xpRatio = Math.max(0, Math.min(1, p.exp / p.expToNext));
    this.xpFill.setDisplaySize(278 * xpRatio, 19);

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
    const ws = this.gs.weaponSystem;
    const owned = ws.owned;
    const keys = Object.keys(owned);
    const stateStr = keys.map(k => k + owned[k] + (ws.isEvolved(k) ? 'E' : '')).join(',');
    if (this._lastKeyStr === stateStr) return;
    this._lastKeyStr = stateStr;

    this.weaponPanel.removeAll(true);
    keys.forEach((id, i) => {
      const y = i * 88;
      const evolved = ws.isEvolved(id);
      const icon = this.add.image(-60, y, `weapon_${id}_lv${owned[id]}`).setScale(2.6);
      if (evolved) icon.setTint(0xffe066);
      const labelStr = evolved ? `⭐${WEAPON_EVOLUTIONS[id].name}` : `${WEAPON_DATA[id].name} Lv${owned[id]}`;
      const label = this.add.text(-10, y, labelStr, textStyle({
        fontSize: '24px', color: evolved ? '#ffe066' : '#fff',
      })).setOrigin(0, 0.5);
      this.weaponPanel.add([icon, label]);
    });
  }
}
