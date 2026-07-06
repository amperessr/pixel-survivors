import { EQUIPMENT_DATA, EQUIP_SLOTS, SLOT_LABELS } from '../equipment/EquipmentData.js';
import { getInventory, setInventory, getEquipped, setEquipped, getGold } from '../managers/SaveManager.js';
import { textStyle } from '../utils/TextStyle.js';

const COLS = 10, ROWS = 5; // 5x10 背包格子，跟楓之谷倉庫版面一樣

// 背包場景：左邊是角色目前身上五個裝備欄位，右邊是 5x10 的物品格子。
// 點背包裡的裝備 = 穿上（原本穿的那件會換回這一格）；點身上穿的裝備 = 脫下（放回背包第一個空格）。
export default class InventoryScene extends Phaser.Scene {
  constructor() { super('InventoryScene'); }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x10131a);
    this.add.text(w / 2, 50, '背包', textStyle({ fontSize: '56px', color: '#6fd3ff' })).setOrigin(0.5);

    this.inventory = getInventory();
    this.equipped = getEquipped();

    this.goldText = this.add.text(w - 40, 50, `金幣：${getGold()}`, textStyle({
      fontSize: '30px', color: '#ffd93d',
    })).setOrigin(1, 0.5);

    // ---------- 左側：角色與裝備欄 ----------
    const leftX = w * 0.2;
    this.add.image(leftX, 190, 'player_balanced').setScale(2.6);
    this.add.text(leftX, 300, '目前裝備', textStyle({ fontSize: '28px', color: '#9fd3ff' })).setOrigin(0.5);

    this.equipSlotImgs = {};
    this.equipIconImgs = {};
    const slotStartY = 360, slotGap = 108;
    EQUIP_SLOTS.forEach((slot, i) => {
      const sy = slotStartY + i * slotGap;
      const bg = this.add.image(leftX, sy, 'ui_equip_slot').setDisplaySize(88, 88).setInteractive({ useHandCursor: true });
      this.add.text(leftX, sy + 56, SLOT_LABELS[slot], textStyle({ fontSize: '22px', color: '#ffe066' })).setOrigin(0.5);
      this.equipSlotImgs[slot] = bg;
      bg.on('pointerdown', () => this._unequip(slot));
      bg.on('pointerover', () => bg.setTint(0xffe066));
      bg.on('pointerout', () => bg.clearTint());
    });

    // ---------- 右側：5x10 背包格 ----------
    const gridW = 720, gridH = 380;
    const startX = w * 0.42, startY = 220;
    const cellW = gridW / COLS, cellH = gridH / ROWS;
    this.add.text(startX + gridW / 2, 170, '背包（點擊裝備）', textStyle({
      fontSize: '28px', color: '#9fd3ff',
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

    const backBtn = this.add.image(w / 2, h - 70, 'ui_bar_bg').setDisplaySize(280, 70).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 70, '返回主選單', textStyle({ fontSize: '28px', color: '#10131a' })).setOrigin(0.5);
    backBtn.on('pointerover', () => backBtn.setTint(0x6fd3ff));
    backBtn.on('pointerout', () => backBtn.clearTint());
    backBtn.on('pointerdown', () => this.scene.start('MainMenuScene'));

    this._refresh();
  }

  _refresh() {
    // 重新畫出五個裝備欄的圖示
    EQUIP_SLOTS.forEach((slot) => {
      if (this.equipIconImgs[slot]) { this.equipIconImgs[slot].destroy(); this.equipIconImgs[slot] = null; }
      const itemId = this.equipped[slot];
      if (itemId && EQUIPMENT_DATA[itemId]) {
        const bg = this.equipSlotImgs[slot];
        const icon = this.add.image(bg.x, bg.y, EQUIPMENT_DATA[itemId].icon).setScale(1.4);
        this.equipIconImgs[slot] = icon;
      }
    });

    // 重新畫出背包格的圖示
    this.slotIcons.forEach((icon) => { if (icon) icon.destroy(); });
    this.inventory.forEach((itemId, idx) => {
      if (itemId && EQUIPMENT_DATA[itemId]) {
        const bg = this.slotBgs[idx];
        this.slotIcons[idx] = this.add.image(bg.x, bg.y, EQUIPMENT_DATA[itemId].icon).setScale(0.9);
      } else {
        this.slotIcons[idx] = null;
      }
    });

    this.goldText.setText(`金幣：${getGold()}`);
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
    this._refresh();
  }

  _showToast(msg) {
    const w = this.scale.width, h = this.scale.height;
    const t = this.add.text(w / 2, h - 130, msg, textStyle({ fontSize: '26px', color: '#ff6b6b' })).setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, duration: 1200, delay: 400, onComplete: () => t.destroy() });
  }
}
