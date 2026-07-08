import { EQUIPMENT_DATA, EQUIP_SLOTS, RING_SLOTS, SLOT_LABELS } from '../equipment/EquipmentData.js';
import {
  getInventory, setInventory, getEquipped, setEquipped, getGold,
  getStatLevel, getStatExp, getStatExpToNext, getStatPoints, getCritRatePoints,
  getCritRateBonus, investCritRatePoint, resetStatPoints,
  RESET_STAT_POINTS_GOLD_COST, CRIT_RATE_POINT_CAP_VALUE, CRIT_RATE_PER_POINT_VALUE,
} from '../managers/SaveManager.js';
import { CHARACTERS, BASE_STATS } from '../player/Player.js';
import { textStyle } from '../utils/TextStyle.js';

const COLS = 10, ROWS = 5; // 5x10 背包格子，跟楓之谷倉庫版面一樣

// 裝備欄分兩排「掛」在角色左右兩側，不再疊在身體部位上——
// 左邊由上到下：武器／衣服／褲子；右邊由上到下：頭盔／鞋子。
// 兩個戒指欄位移到角色正上方並排，跟左右兩排欄位保持距離。
const SLOT_SIDE_OFFSET = {
  weapon: { x: -155, y: -85 },
  clothes: { x: -155, y: 0 },
  pants: { x: -155, y: 85 },
  helmet: { x: 155, y: -85 },
  shoes: { x: 155, y: 0 },
  ring1: { x: -38, y: -170 },
  ring2: { x: 38, y: -170 },
};

const PORTRAIT_SCALE = 3.4;
const SLOT_SIZE = 66;

// 能力值面板顯示的項目：跟 UIScene 底部狀態列同一套圖示/顏色，額外多了生命上限。
const STATS_PANEL_DEFS = [
  { icon: 'pickup_heart', label: '生命上限', color: '#5bff8f', get: (s) => `${s.maxHp}` },
  { icon: 'icon_attack', label: '攻擊', color: '#ff5b5b', get: (s) => `${s.attack}` },
  { icon: 'icon_defense', label: '防禦', color: '#8fa3b8', get: (s) => `${s.defense}` },
  { icon: 'icon_moveSpeed', label: '移速', color: '#5bff8f', get: (s) => `${s.moveSpeed}` },
  { icon: 'icon_atkSpeed', label: '攻速', color: '#5bd4ff', get: (s) => `+${s.atkSpeed.toFixed(0)}%` },
  { icon: 'icon_critRate', label: '爆擊率', color: '#ffd93d', get: (s) => `${s.critRate.toFixed(0)}%` },
  { icon: 'icon_critDmg', label: '爆傷', color: '#ff9d3d', get: (s) => `${s.critDmg.toFixed(0)}%` },
];

// 背包場景：左邊是角色（裝備疊在對應身體部位上）+ 能力值面板，右邊是 5x10 的物品格子。
// 點背包裡的裝備 = 穿上（原本穿的那件會換回這一格）；點身上穿的裝備 = 脫下（放回背包第一個空格）；
// 滑鼠移到任何裝備上都會顯示名稱／數值提示；背包裡的裝備可以拖到垃圾桶丟棄。
export default class InventoryScene extends Phaser.Scene {
  constructor() { super('InventoryScene'); }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x10131a);
    this.add.text(w / 2, 50, '背包', textStyle({ fontSize: '56px', color: '#6fd3ff' })).setOrigin(0.5);

    this.inventory = getInventory();
    this.equipped = getEquipped();
    this._tooltip = null;
    this._pendingCritPoints = 0; // 「+1」按了但還沒按確認的爆擊率點數，確認後才會真的扣點寫入存檔

    this.goldText = this.add.text(w - 40, 50, `金幣：${getGold()}`, textStyle({
      fontSize: '30px', color: '#ffd93d',
    })).setOrigin(1, 0.5);
    // 永久等級（跟進遊戲後那場戰鬥的等級是兩回事，只在這裡跟主選單顯示）
    this.levelText = this.add.text(w - 40, 88, '', textStyle({
      fontSize: '22px', color: '#6fd3ff',
    })).setOrigin(1, 0.5);

    // ---------- 左側：角色（裝備疊在身體對應部位）----------
    const leftX = w * 0.2;
    const portraitY = 340;
    this.add.text(leftX, 90, '目前裝備', textStyle({ fontSize: '28px', color: '#9fd3ff' })).setOrigin(0.5);
    this.add.image(leftX, portraitY, 'player_balanced').setScale(PORTRAIT_SCALE);

    this.equipSlotImgs = {};
    this.equipIconImgs = {};
    this.equipEmptyLabels = {};

    // 五個一般裝備欄 + 兩個戒指欄，共用同一套渲染/互動邏輯（戒指目前只能從扭蛋機
    // 取得，扭蛋機制還沒實作，所以這兩格暫時一定是空的，但介面/互動都是完整的，
    // 之後扭蛋一接上就能直接動）。
    [...EQUIP_SLOTS, ...RING_SLOTS].forEach((slot) => {
      const off = SLOT_SIDE_OFFSET[slot];
      const sx = leftX + off.x, sy = portraitY + off.y;
      const bg = this.add.image(sx, sy, 'ui_equip_slot').setDisplaySize(SLOT_SIZE, SLOT_SIZE)
        .setInteractive({ useHandCursor: true }).setDepth(10);
      const emptyLabel = this.add.text(sx, sy, SLOT_LABELS[slot], textStyle({
        fontSize: '15px', color: '#ffe066',
      })).setOrigin(0.5).setAlpha(0.6).setDepth(11);
      this.equipSlotImgs[slot] = bg;
      this.equipEmptyLabels[slot] = emptyLabel;
      bg.on('pointerdown', () => this._unequip(slot));
      bg.on('pointerover', () => {
        bg.setTint(0xffe066);
        const itemId = this.equipped[slot];
        if (itemId && EQUIPMENT_DATA[itemId]) this._showTooltip(sx, sy, EQUIPMENT_DATA[itemId]);
      });
      bg.on('pointerout', () => { bg.clearTint(); this._hideTooltip(); });
    });

    // ---------- 左側下方：能力值面板 + 右側緊接著的升級點數面板 ----------
    this._buildStatsPanel(leftX, 480);
    this._buildStatPointsPanel(leftX + 290, 480);

    // ---------- 右側：5x10 背包格 ----------
    const gridW = 720, gridH = 380;
    const startX = w * 0.42, startY = 220;
    const cellW = gridW / COLS, cellH = gridH / ROWS;
    this.add.text(startX + gridW / 2, 170, '背包（點擊裝備／拖曳到垃圾桶丟棄）', textStyle({
      fontSize: '26px', color: '#9fd3ff',
    })).setOrigin(0.5);

    this.slotBgs = [];
    this.slotIcons = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const cx = startX + c * cellW + cellW / 2;
        const cy = startY + r * cellH + cellH / 2;
        const bg = this.add.image(cx, cy, 'ui_slot').setDisplaySize(cellW - 6, cellH - 6).setInteractive({ useHandCursor: true });
        bg.on('pointerdown', () => this._equipFromInventory(idx));
        bg.on('pointerover', () => bg.setTint(0x6fd3ff));
        bg.on('pointerout', () => bg.clearTint());
        this.slotBgs.push(bg);
        this.slotIcons.push(null);
      }
    }

    // ---------- 垃圾桶：把背包裡的裝備拖過來就丟棄 ----------
    this.trashX = startX + gridW / 2;
    this.trashY = 830;
    this.TRASH_TINT = 0xff6b6b;
    this.trashZone = this.add.image(this.trashX, this.trashY, 'ui_slot').setDisplaySize(140, 140).setTint(this.TRASH_TINT);
    this.add.text(this.trashX, this.trashY, '🗑', textStyle({ fontSize: '52px', color: '#ffffff' })).setOrigin(0.5);
    this.add.text(this.trashX, this.trashY + 84, '拖曳裝備到這裡丟棄', textStyle({
      fontSize: '20px', color: '#ff9a9a',
    })).setOrigin(0.5);

    const backBtn = this.add.image(w / 2, h - 70, 'ui_bar_bg').setDisplaySize(280, 70).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 70, '返回主選單', textStyle({ fontSize: '28px', color: '#10131a' })).setOrigin(0.5);
    backBtn.on('pointerover', () => backBtn.setTint(0x6fd3ff));
    backBtn.on('pointerout', () => backBtn.clearTint());
    backBtn.on('pointerdown', () => this.scene.start('MainMenuScene'));

    this._refresh();
  }

  // 能力值面板：以「平衡型」角色的基礎數值＋目前身上裝備的加成算出來的預覽數值
  // （跟 GameScene._applyEquipmentBonuses() 用同一套算法），讓玩家不用真的進遊戲
  // 也能看到「現在這身裝備大概會有多強」。
  _buildStatsPanel(cx, panelTop) {
    const panelW = 340, panelH = 300;
    const cy = panelTop + panelH / 2;
    this.add.image(cx, cy, 'ui_panel').setDisplaySize(panelW, panelH);
    this.add.rectangle(cx, cy, panelW - 6, panelH - 6).setStrokeStyle(3, 0x6fd3ff, 0.6).setFillStyle(0, 0);
    this.add.text(cx, panelTop + 26, '⚔ 能力值', textStyle({
      fontSize: '26px', color: '#6fd3ff',
    })).setOrigin(0.5);
    this.add.rectangle(cx, panelTop + 50, panelW - 50, 2, 0x6fd3ff, 0.4);

    this.statsValueTexts = {};
    const rowStartY = panelTop + 72, rowGap = 32;
    STATS_PANEL_DEFS.forEach((def, i) => {
      const ry = rowStartY + i * rowGap;
      this.add.image(cx - panelW / 2 + 34, ry, def.icon).setScale(0.8);
      this.add.text(cx - panelW / 2 + 58, ry, def.label, textStyle({
        fontSize: '20px', color: '#cfe9ff',
      })).setOrigin(0, 0.5);
      this.statsValueTexts[def.label] = this.add.text(cx + panelW / 2 - 30, ry, '', textStyle({
        fontSize: '20px', color: def.color,
      })).setOrigin(1, 0.5);
    });
  }

  // 升級點數面板：緊接在能力值面板右邊。升級每級發 3 點技能點，目前只能拿來加
  // 爆擊率（上限 40%），其餘能力值一律只能靠裝備或其他方式提升。「+1」只是先
  // 累積待確認的點數，按「確認」才會真的扣點數寫入存檔——這樣點錯了在確認前
  // 都還能反悔（離開背包畫面不按確認，待加點數就直接作廢，不會被存下來）。
  _buildStatPointsPanel(cx, panelTop) {
    const panelW = 240, panelH = 300;
    const cy = panelTop + panelH / 2;
    this.add.image(cx, cy, 'ui_panel').setDisplaySize(panelW, panelH);
    this.add.rectangle(cx, cy, panelW - 6, panelH - 6).setStrokeStyle(3, 0xffd93d, 0.6).setFillStyle(0, 0);
    this.add.text(cx, panelTop + 24, '⭐ 升級點數', textStyle({
      fontSize: '23px', color: '#ffd93d',
    })).setOrigin(0.5);
    this.add.rectangle(cx, panelTop + 46, panelW - 40, 2, 0xffd93d, 0.4);

    this.statPointsText = this.add.text(cx, panelTop + 72, '', textStyle({
      fontSize: '18px', color: '#cfe9ff',
    })).setOrigin(0.5);
    this.critBonusText = this.add.text(cx, panelTop + 100, '', textStyle({
      fontSize: '18px', color: '#ffd93d',
    })).setOrigin(0.5);
    this.add.text(cx, panelTop + 126, '爆擊率', textStyle({
      fontSize: '15px', color: '#9fd3ff',
    })).setOrigin(0.5);

    const plusBtn = this.add.image(cx - 42, panelTop + 162, 'ui_button_parchment').setDisplaySize(66, 44).setInteractive({ useHandCursor: true });
    this.add.text(cx - 42, panelTop + 162, '+1', textStyle({ fontSize: '20px', color: '#3a2413' })).setOrigin(0.5);
    plusBtn.on('pointerover', () => plusBtn.setTint(0xfff3d0));
    plusBtn.on('pointerout', () => plusBtn.clearTint());
    plusBtn.on('pointerdown', () => this._addPendingCritPoint());

    const confirmBtn = this.add.image(cx + 42, panelTop + 162, 'ui_button_parchment').setDisplaySize(66, 44).setInteractive({ useHandCursor: true });
    this.add.text(cx + 42, panelTop + 162, '確認', textStyle({ fontSize: '18px', color: '#3a2413' })).setOrigin(0.5);
    confirmBtn.on('pointerover', () => confirmBtn.setTint(0xfff3d0));
    confirmBtn.on('pointerout', () => confirmBtn.clearTint());
    confirmBtn.on('pointerdown', () => this._confirmCritPoints());

    this.pendingCritText = this.add.text(cx, panelTop + 198, '', textStyle({
      fontSize: '15px', color: '#9fd3ff',
    })).setOrigin(0.5);

    this.add.rectangle(cx, panelTop + 222, panelW - 40, 2, 0xffd93d, 0.25);

    const resetBtn = this.add.image(cx, panelTop + 254, 'ui_button_parchment').setDisplaySize(200, 46).setInteractive({ useHandCursor: true });
    this.add.text(cx, panelTop + 254, '重置所有能力值', textStyle({ fontSize: '17px', color: '#3a2413' })).setOrigin(0.5);
    this.add.text(cx, panelTop + 282, `消耗 ${RESET_STAT_POINTS_GOLD_COST.toLocaleString()} 金幣`, textStyle({
      fontSize: '13px', color: '#ff9a9a',
    })).setOrigin(0.5);
    resetBtn.on('pointerover', () => resetBtn.setTint(0xfff3d0));
    resetBtn.on('pointerout', () => resetBtn.clearTint());
    resetBtn.on('pointerdown', () => this._onResetStatPoints());
  }

  _addPendingCritPoint() {
    const available = getStatPoints() - this._pendingCritPoints;
    const previewInvested = getCritRatePoints() + this._pendingCritPoints;
    if (available <= 0) { this._showToast('沒有剩餘技能點了'); return; }
    if (previewInvested >= CRIT_RATE_POINT_CAP_VALUE) { this._showToast('爆擊率已經到上限 40% 了'); return; }
    this._pendingCritPoints++;
    this._refreshStatPointsPanel();
    this._refreshStatsPanel();
  }

  _confirmCritPoints() {
    if (this._pendingCritPoints <= 0) return;
    let confirmed = 0;
    for (let i = 0; i < this._pendingCritPoints; i++) {
      if (investCritRatePoint()) confirmed++;
    }
    this._pendingCritPoints = 0;
    this._refreshStatPointsPanel();
    this._refreshStatsPanel();
    this._showToast(`已投資 ${confirmed} 點到爆擊率`);
  }

  _onResetStatPoints() {
    if (this._pendingCritPoints > 0) {
      this._showToast('請先確認或不要點「+1」，再重置');
      return;
    }
    if (!resetStatPoints()) {
      this._showToast(`金幣不足，重置需要 ${RESET_STAT_POINTS_GOLD_COST.toLocaleString()} 金幣`);
      return;
    }
    this.goldText.setText(`金幣：${getGold()}`);
    this._refreshStatPointsPanel();
    this._refreshStatsPanel();
    this._showToast('已重置所有升級能力值');
  }

  _refreshStatPointsPanel() {
    const invested = getCritRatePoints();
    const available = getStatPoints() - this._pendingCritPoints;
    const previewBonus = (invested + this._pendingCritPoints) * CRIT_RATE_PER_POINT_VALUE;
    this.statPointsText.setText(`剩餘點數：${available}`);
    this.critBonusText.setText(`+${previewBonus.toFixed(1)}% / 40%`);
    this.pendingCritText.setText(this._pendingCritPoints > 0 ? `待確認：+${this._pendingCritPoints} 點` : '');
  }

  _refreshStatsPanel() {
    const mods = CHARACTERS.balanced.mods;
    const stats = {
      maxHp: Math.round(BASE_STATS.hp * mods.hp),
      attack: Math.round(BASE_STATS.attack * mods.attack),
      defense: Math.round(BASE_STATS.defense * mods.defense),
      moveSpeed: Math.round(BASE_STATS.moveSpeed * mods.moveSpeed),
      atkSpeed: BASE_STATS.atkSpeed,
      critRate: BASE_STATS.critRate + getCritRateBonus() + this._pendingCritPoints * CRIT_RATE_PER_POINT_VALUE,
      critDmg: BASE_STATS.critDmg,
    };
    Object.values(this.equipped).forEach((itemId) => {
      if (!itemId || !EQUIPMENT_DATA[itemId]) return;
      const bonus = EQUIPMENT_DATA[itemId].bonus || {};
      if (bonus.attack) stats.attack += bonus.attack;
      if (bonus.defense) stats.defense += bonus.defense;
      if (bonus.moveSpeed) stats.moveSpeed += bonus.moveSpeed;
      if (bonus.maxHp) stats.maxHp += bonus.maxHp;
    });
    STATS_PANEL_DEFS.forEach((def) => {
      this.statsValueTexts[def.label].setText(def.get(stats));
    });
  }

  _refresh() {
    // 重新畫出裝備欄（五個一般欄 + 兩個戒指欄）的圖示：有裝備時顯示圖示、隱藏空格
    // 標籤；沒有裝備時反過來
    [...EQUIP_SLOTS, ...RING_SLOTS].forEach((slot) => {
      if (this.equipIconImgs[slot]) { this.equipIconImgs[slot].destroy(); this.equipIconImgs[slot] = null; }
      const itemId = this.equipped[slot];
      const bg = this.equipSlotImgs[slot];
      if (itemId && EQUIPMENT_DATA[itemId]) {
        // 圖示是 128x128 的正式美術圖，縮放倍率調大讓圖示確實填滿欄位方框，
        // 不再看起來小小一顆飄在方框中間。
        const icon = this.add.image(bg.x, bg.y, EQUIPMENT_DATA[itemId].icon).setScale(0.55).setDepth(12);
        this.equipIconImgs[slot] = icon;
        this.equipEmptyLabels[slot].setVisible(false);
      } else {
        this.equipEmptyLabels[slot].setVisible(true);
      }
    });

    // 重新畫出背包格的圖示：可拖曳，拖到垃圾桶上放開就丟棄；滑鼠移上去顯示名稱/數值提示；
    // 沒有拖動、單純點一下的話維持原本「點擊裝備」的行為。
    this.slotIcons.forEach((icon) => { if (icon) icon.destroy(); });
    this.inventory.forEach((itemId, idx) => {
      if (itemId && EQUIPMENT_DATA[itemId]) {
        const def = EQUIPMENT_DATA[itemId];
        const bg = this.slotBgs[idx];
        // 背包格圖示縮放倍率調大，讓圖示填滿格子（原本 0.34 太小，格子裡空太多）。
        const icon = this.add.image(bg.x, bg.y, def.icon).setScale(0.47);
        icon.setInteractive({ useHandCursor: true, draggable: true });
        icon.on('dragstart', () => {
          icon.setData('dragged', false);
          this._hideTooltip();
          this.children.bringToTop(icon);
        });
        icon.on('drag', (pointer, dragX, dragY) => {
          icon.setData('dragged', true);
          icon.setPosition(dragX, dragY);
          this.trashZone.setTint(this._isOverTrash(dragX, dragY) ? 0xff0000 : this.TRASH_TINT);
        });
        icon.on('dragend', () => {
          this.trashZone.setTint(this.TRASH_TINT);
          if (this._isOverTrash(icon.x, icon.y)) {
            this._discardFromInventory(idx);
          } else {
            icon.setPosition(bg.x, bg.y);
          }
        });
        icon.on('pointerup', () => {
          if (!icon.getData('dragged')) this._equipFromInventory(idx);
        });
        icon.on('pointerover', () => this._showTooltip(bg.x, bg.y, def));
        icon.on('pointerout', () => this._hideTooltip());
        this.slotIcons[idx] = icon;
      } else {
        this.slotIcons[idx] = null;
      }
    });

    this.goldText.setText(`金幣：${getGold()}`);
    this.levelText.setText(`Lv.${getStatLevel()}　${getStatExp()}/${getStatExpToNext()} EXP`);
    this._refreshStatsPanel();
    this._refreshStatPointsPanel();
  }

  // 滑鼠移到裝備上顯示的名稱／數值提示框，固定畫在裝備正上方
  _showTooltip(x, y, def) {
    this._hideTooltip();
    const boxW = 260, boxH = 74;
    const ty = y - 70;
    const bg = this.add.rectangle(x, ty, boxW, boxH, 0x0a0e16, 0.92)
      .setStrokeStyle(2, 0xffe066, 0.85).setDepth(900);
    const name = this.add.text(x, ty - 16, def.name, textStyle({
      fontSize: '22px', color: '#ffe066',
    })).setOrigin(0.5).setDepth(901);
    const desc = this.add.text(x, ty + 14, def.desc, textStyle({
      fontSize: '18px', color: '#9fd3ff',
    })).setOrigin(0.5).setDepth(901);
    this._tooltip = [bg, name, desc];
  }

  _hideTooltip() {
    if (!this._tooltip) return;
    this._tooltip.forEach((o) => o.destroy());
    this._tooltip = null;
  }

  _isOverTrash(x, y) {
    const half = 70; // 垃圾桶顯示尺寸 140x140 的一半
    return Math.abs(x - this.trashX) < half && Math.abs(y - this.trashY) < half;
  }

  // 把背包裡的裝備永久丟棄（不會退還金幣），拖曳放開在垃圾桶上時呼叫
  _discardFromInventory(idx) {
    const itemId = this.inventory[idx];
    if (!itemId) return;
    const def = EQUIPMENT_DATA[itemId];
    this.inventory[idx] = null;
    setInventory(this.inventory);
    this._refresh();
    this._showToast(`已丟棄「${def ? def.name : itemId}」`);
  }

  // 點背包裡的裝備：穿上，原本穿的那件（如果有）換回同一格
  _equipFromInventory(idx) {
    const itemId = this.inventory[idx];
    if (!itemId || !EQUIPMENT_DATA[itemId]) return;
    const def = EQUIPMENT_DATA[itemId];
    const prev = this.equipped[def.slot];
    this.equipped[def.slot] = itemId;
    this.inventory[idx] = prev || null;
    setEquipped(this.equipped);
    setInventory(this.inventory);
    this._hideTooltip();
    this._refresh();
  }

  // 點身上穿的裝備：脫下，放回背包第一個空格；背包滿了就不能脫（避免物品憑空消失）
  _unequip(slot) {
    const itemId = this.equipped[slot];
    if (!itemId) return;
    const emptyIdx = this.inventory.findIndex((s) => !s);
    if (emptyIdx === -1) {
      this._showToast('背包已滿，無法卸下');
      return;
    }
    this.inventory[emptyIdx] = itemId;
    this.equipped[slot] = null;
    setEquipped(this.equipped);
    setInventory(this.inventory);
    this._hideTooltip();
    this._refresh();
  }

  _showToast(msg) {
    const w = this.scale.width, h = this.scale.height;
    const t = this.add.text(w / 2, h - 130, msg, textStyle({ fontSize: '26px', color: '#ff6b6b' })).setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, duration: 1200, delay: 400, onComplete: () => t.destroy() });
  }
}
