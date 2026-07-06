import { WEAPON_DATA, WEAPON_EVOLUTIONS } from '../weapons/WeaponData.js';
import { EQUIP_SLOTS, EQUIPMENT_DATA } from '../equipment/EquipmentData.js';
import { getEquipped } from '../managers/SaveManager.js';
import { textStyle } from '../utils/TextStyle.js';

// 底部數值狀態列的六個項目：圖示 + 中文標籤 + 數值，參考英雄聯盟角色面板
// 「圖示搭配文字」的呈現方式，取代原本一整串英文縮寫（ATK/DEF/SPD...）的純文字。
const STAT_DEFS = [
  { key: 'attack', icon: 'icon_attack', label: '攻擊', color: '#ff5b5b', get: (p) => `${Math.round(p.stats.attack)}` },
  { key: 'defense', icon: 'icon_defense', label: '防禦', color: '#8fa3b8', get: (p) => `${Math.round(p.stats.defense)}` },
  { key: 'moveSpeed', icon: 'icon_moveSpeed', label: '移速', color: '#5bff8f', get: (p) => `${Math.round(p.stats.moveSpeed)}` },
  { key: 'atkSpeed', icon: 'icon_atkSpeed', label: '攻速', color: '#5bd4ff', get: (p) => `+${p.stats.atkSpeed.toFixed(0)}%` },
  { key: 'critRate', icon: 'icon_critRate', label: '爆擊率', color: '#ffd93d', get: (p) => `${p.stats.critRate.toFixed(0)}%` },
  { key: 'critDmg', icon: 'icon_critDmg', label: '爆傷', color: '#ff9d3d', get: (p) => `${p.stats.critDmg.toFixed(0)}%` },
];

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

    // ---- 右側：目前技能（用面板框把整塊「技能」區域框起來）----
    const PANEL_W = 380;
    this.panelX = w - 220;
    this.panelTop = 150;
    const TITLE_H = 70;

    this.weaponPanelBg = this.add.image(this.panelX, this.panelTop, 'ui_panel')
      .setOrigin(0.5, 0).setScrollFactor(0).setDisplaySize(PANEL_W, 140).setDepth(-1);
    this.weaponPanelTitle = this.add.text(this.panelX, this.panelTop + 16, '技能', textStyle({
      fontSize: '28px', color: '#6fd3ff',
    })).setOrigin(0.5, 0).setScrollFactor(0);
    this.weaponPanelDivider = this.add.rectangle(
      this.panelX, this.panelTop + TITLE_H - 12, PANEL_W - 44, 2, 0x6fd3ff, 0.4
    ).setScrollFactor(0);

    this.weaponPanel = this.add.container(this.panelX - 70, this.panelTop + TITLE_H).setScrollFactor(0);
    this._panelW = PANEL_W;
    this._titleH = TITLE_H;

    // ---- 下方：狀態列（裝備 + 數值狀態）----
    // 底板：一條橫跨畫面下方的半透明面板，把裝備圖示跟數值都放在同一列
    const bottomBarH = 96;
    const bottomBarY = h - bottomBarH / 2 - 10;
    this.add.image(w / 2, bottomBarY, 'ui_panel').setDisplaySize(w - 60, bottomBarH).setScrollFactor(0).setDepth(-1);

    // 裝備圖示（讀開局當下的存檔裝備，整場遊戲不會變，只顯示一次即可）
    const equipped = getEquipped();
    const equipStartX = 70;
    this.add.text(equipStartX, bottomBarY - 34, '裝備', textStyle({
      fontSize: '20px', color: '#ffe066',
    })).setOrigin(0.5, 1).setScrollFactor(0);
    EQUIP_SLOTS.forEach((slot, i) => {
      const ex = equipStartX + i * 60 - (EQUIP_SLOTS.length - 1) * 30;
      const itemId = equipped[slot];
      const slotBg = this.add.image(ex, bottomBarY, 'ui_equip_slot').setDisplaySize(52, 52).setScrollFactor(0);
      if (itemId && EQUIPMENT_DATA[itemId]) {
        this.add.image(ex, bottomBarY, EQUIPMENT_DATA[itemId].icon).setScale(0.85).setScrollFactor(0);
      } else {
        slotBg.setAlpha(0.35);
      }
    });

    // 數值狀態：一排「圖示 + 中文標籤 + 數值」的狀態格，參考英雄聯盟角色面板的呈現方式，
    // 取代原本 ATK/DEF/SPD 那種英文縮寫的純文字。從裝備區右邊一路排到面板右側。
    const statAreaStartX = 260;
    const statAreaEndX = w - 100;
    const chipGap = (statAreaEndX - statAreaStartX) / (STAT_DEFS.length - 1);
    this.statChips = {};
    STAT_DEFS.forEach((def, i) => {
      const cx = statAreaStartX + i * chipGap;
      this.add.image(cx - 40, bottomBarY, def.icon).setScale(1.4).setScrollFactor(0);
      this.add.text(cx - 20, bottomBarY - 14, def.label, textStyle({
        fontSize: '17px', color: def.color,
      })).setOrigin(0, 0.5).setScrollFactor(0);
      const valueText = this.add.text(cx - 20, bottomBarY + 13, '', textStyle({
        fontSize: '24px', color: '#ffffff',
      })).setOrigin(0, 0.5).setScrollFactor(0);
      this.statChips[def.key] = valueText;
    });

    // ---- 畫面邊緣指示箭頭：血包（紅）／磁鐵（藍紫）不在畫面內時，指出方向 ----
    this.healthArrow = this.add.image(0, 0, 'ui_arrow').setTint(0xff5a5a).setScale(1.1)
      .setScrollFactor(0).setDepth(20000).setVisible(false);
    this.magnetArrow = this.add.image(0, 0, 'ui_arrow').setTint(0x7ea0ff).setScale(1.1)
      .setScrollFactor(0).setDepth(20000).setVisible(false);

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

    STAT_DEFS.forEach((def) => {
      this.statChips[def.key].setText(def.get(p));
    });

    this._refreshWeaponPanel();
    this._updatePickupArrows();
  }

  // 血包／磁鐵不在目前畫面範圍內時，在畫面邊緣顯示一個指向它的箭頭；
  // 畫面內能直接看到就不用箭頭了。兩種各自只找「離玩家最近的一個」來指示，
  // 避免畫面上箭頭太多反而分散注意力。
  _updatePickupArrows() {
    const cam = this.cameras.main;
    const p = this.gs.player.sprite;

    this._pointArrowAt(this.healthArrow, this._nearestOffscreen(this.gs.healthPackSystem, p, cam));
    this._pointArrowAt(this.magnetArrow, this._nearestOffscreen(this.gs.magnetSystem, p, cam));
  }

  // 從一個系統（HealthPackSystem / MagnetSystem）的物件池裡，找出「不在畫面範圍內
  // 的最近一個」，回傳世界座標 {x,y}；如果全部都在畫面內或根本沒有，回傳 null
  _nearestOffscreen(system, player, cam) {
    if (!system || !system.pool) return null;
    const halfW = cam.width / (2 * cam.zoom), halfH = cam.height / (2 * cam.zoom);
    const margin = 40; // 留一點邊界，避免物件才剛超出畫面邊緣就急著顯示箭頭
    let best = null, bestDist = Infinity;
    system.pool.forEachActive((obj) => {
      const dx = obj.x - cam.midPoint.x, dy = obj.y - cam.midPoint.y;
      const onScreen = Math.abs(dx) < halfW - margin && Math.abs(dy) < halfH - margin;
      if (onScreen) return;
      const d = Math.hypot(obj.x - player.x, obj.y - player.y);
      if (d < bestDist) { bestDist = d; best = obj; }
    });
    return best ? { x: best.x, y: best.y } : null;
  }

  // 把箭頭放在畫面邊緣、朝著目標方向；沒有目標就隱藏
  _pointArrowAt(arrowImg, target) {
    if (!target) { arrowImg.setVisible(false); return; }
    const w = this.scale.width, h = this.scale.height;
    const cx = w / 2, cy = h / 2;
    const cam = this.cameras.main;
    const dx = target.x - cam.midPoint.x, dy = target.y - cam.midPoint.y;
    const ang = Math.atan2(dy, dx);

    // 用畫面矩形跟射線的交點，把箭頭釘在螢幕邊緣（留一點邊距，不要貼到最邊邊）
    const margin = 60;
    const halfW = cx - margin, halfH = cy - margin;
    const scaleX = halfW / Math.abs(Math.cos(ang) || 1e-6);
    const scaleY = halfH / Math.abs(Math.sin(ang) || 1e-6);
    const scale = Math.min(scaleX, scaleY);
    const ax = cx + Math.cos(ang) * scale;
    const ay = cy + Math.sin(ang) * scale;

    arrowImg.setPosition(ax, ay);
    arrowImg.setRotation(ang);
    arrowImg.setVisible(true);
  }

  _refreshWeaponPanel() {
    const ws = this.gs.weaponSystem;
    const owned = ws.owned;
    const keys = Object.keys(owned);
    const stateStr = keys.map(k => k + owned[k] + (ws.isEvolved(k) ? 'E' : '')).join(',');
    if (this._lastKeyStr === stateStr) return;
    this._lastKeyStr = stateStr;

    // 面板高度依技能數量自動調整，讓「技能」框永遠剛好包住目前所有武器
    const rowH = 88;
    const rows = Math.max(keys.length, 1);
    const panelH = this._titleH + rows * rowH + 24;
    this.weaponPanelBg.setDisplaySize(this._panelW, panelH);

    this.weaponPanel.removeAll(true);
    const iconSize = 60; // 統一圖示顯示大小；不用 setScale 直接放大原始材質，
                          // 否則等級越高（材質本身越大）圖示會越畫越大，容易超出框外
    keys.forEach((id, i) => {
      // 每一列的圖示改成「垂直置中在該列的區塊內」，而不是貼在列的最上緣——
      // 原本第一列圖示的中心點剛好卡在標題分隔線的位置，導致圖示上半部整個超出面板框，
      // 疊到「技能」標題那一行去了。
      const y = i * rowH + rowH / 2;
      const evolved = ws.isEvolved(id);
      const icon = this.add.image(-60, y, `weapon_${id}_lv${owned[id]}`).setDisplaySize(iconSize, iconSize);
      if (evolved) icon.setTint(0xffe066);
      const labelStr = evolved ? `⭐${WEAPON_EVOLUTIONS[id].name}` : `${WEAPON_DATA[id].name} Lv${owned[id]}`;
      const label = this.add.text(-10, y, labelStr, textStyle({
        fontSize: '24px', color: evolved ? '#ffe066' : '#fff',
      })).setOrigin(0, 0.5);
      this.weaponPanel.add([icon, label]);
    });
  }
}
