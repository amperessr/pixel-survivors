import { EQUIPMENT_DATA, EQUIP_SLOTS, RING_SLOTS, SLOT_LABELS, RARITY_DATA, RARITY_IDS, SELL_PRICES } from '../equipment/EquipmentData.js';
import { createRarityFrame } from '../utils/RarityFrame.js';
import {
  getInventory, setInventory, getEquipped, setEquipped, getGold, addGold,
  getStatLevel, getStatExp, getStatExpToNext, getStatPoints, getStatInvest,
  getStatBonus, investStatPoint, resetStatPoints,
  RESET_STAT_POINTS_GOLD_COST, STAT_INVEST_DEFS,
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
  pet: { x: 155, y: 85 }, // 寵物欄：右排最下面（寵物系統尚未實作，先保留欄位）
};

const PORTRAIT_SCALE = 3.4;
const SLOT_SIZE = 66;

// 能力值面板顯示的項目：跟 UIScene 底部狀態列同一套圖示/顏色，額外多了生命上限。
// investKey 對應 SaveManager.STAT_INVEST_DEFS 的 key，七項都能用升級點數投資
// （爆擊率上限 40%，其餘沒有上限）。攻速/爆擊率每點是零點幾 %，顯示改成留一位
// 小數，不然投資 1、2 點時數字看起來完全沒變化。
const STATS_PANEL_DEFS = [
  { icon: 'pickup_heart', label: '生命上限', color: '#5bff8f', investKey: 'maxHp', get: (s) => `${s.maxHp}` },
  { icon: 'icon_attack', label: '攻擊', color: '#ff5b5b', investKey: 'attack', get: (s) => `${s.attack}` },
  { icon: 'icon_defense', label: '防禦', color: '#8fa3b8', investKey: 'defense', get: (s) => `${s.defense}` },
  { icon: 'icon_moveSpeed', label: '移速', color: '#5bff8f', investKey: 'moveSpeed', get: (s) => `${s.moveSpeed}` },
  { icon: 'icon_atkSpeed', label: '攻速', color: '#5bd4ff', investKey: 'atkSpeed', get: (s) => `+${s.atkSpeed.toFixed(1)}%` },
  { icon: 'icon_critRate', label: '爆擊率', color: '#ffd93d', investKey: 'critRate', get: (s) => `${s.critRate.toFixed(1)}%` },
  { icon: 'icon_critDmg', label: '爆傷', color: '#ff9d3d', investKey: 'critDmg', get: (s) => `${s.critDmg.toFixed(0)}%` },
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
    // 「+1」按了但還沒按確認的待加點數，key 對應 STAT_INVEST_DEFS，確認後才會
    // 真的扣點寫入存檔（離開背包畫面不按確認，待加點數就直接作廢）。
    this._pendingInvest = {};
    for (const key of Object.keys(STAT_INVEST_DEFS)) this._pendingInvest[key] = 0;

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
    this.equipRarityFrames = {};

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
        if (itemId && EQUIPMENT_DATA[itemId]) this._showTooltip(sx, sy, EQUIPMENT_DATA[itemId], { isEquipped: true });
      });
      bg.on('pointerout', () => { bg.clearTint(); this._hideTooltip(); });
    });

    // 寵物欄：純介面佔位（寵物系統還沒實作，先把欄位放在右排最下面）
    {
      const off = SLOT_SIDE_OFFSET.pet;
      const sx = leftX + off.x, sy = portraitY + off.y;
      this.add.image(sx, sy, 'ui_equip_slot').setDisplaySize(SLOT_SIZE, SLOT_SIZE).setDepth(10).setAlpha(0.85);
      this.add.text(sx, sy, '寵物', textStyle({
        fontSize: '15px', color: '#ffe066',
      })).setOrigin(0.5).setAlpha(0.6).setDepth(11);
    }

    // ---------- 左側下方：能力值面板（每項能力值旁邊都能直接加點）----------
    this._buildStatsPanel(leftX, 480);

    // ---------- 右側：5x10 背包格 ----------
    const gridW = 720, gridH = 380;
    const startX = w * 0.42, startY = 220;
    const cellW = gridW / COLS, cellH = gridH / ROWS;
    // 拖曳裝備到任一格時要反查「放開位置是哪一格」，把格線幾何存起來
    this.gridGeom = { startX, startY, cellW, cellH };
    this.add.text(startX + gridW / 2, 170, '背包（點擊裝備／拖曳到垃圾桶丟棄）', textStyle({
      fontSize: '26px', color: '#9fd3ff',
    })).setOrigin(0.5);

    this.slotBgs = [];
    this.slotIcons = [];
    this.slotRarityFrames = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const cx = startX + c * cellW + cellW / 2;
        const cy = startY + r * cellH + cellH / 2;
        const bg = this.add.image(cx, cy, 'ui_slot').setDisplaySize(cellW - 6, cellH - 6).setInteractive({ useHandCursor: true });
        bg.on('pointerdown', () => this._handleSlotClick(idx));
        bg.on('pointerover', () => bg.setTint(0x6fd3ff));
        bg.on('pointerout', () => bg.clearTint());
        this.slotBgs.push(bg);
        this.slotIcons.push(null);
      }
    }

    // ---------- 一鍵出售／整理背包：放在背包格正下方一排 ----------
    // 依稀有度一鍵賣掉背包內全部該階裝備（只賣背包，身上穿著的不動；
    // 戒指是傳說/神話級稀有品，不提供出售避免誤賣）。
    const sellRowY = 650;
    const sellDefs = ['common', 'uncommon', 'rare', 'epic'];
    const sellBtnW = 158, sellGap = 12;
    const sortBtnW = 120;
    const rowTotalW = sellDefs.length * sellBtnW + sellDefs.length * sellGap + sortBtnW;
    let bx = startX + gridW / 2 - rowTotalW / 2 + sellBtnW / 2;
    sellDefs.forEach((rarityId) => {
      const rarity = RARITY_DATA[rarityId];
      const hex = '#' + rarity.color.toString(16).padStart(6, '0');
      const btn = this.add.image(bx, sellRowY, 'ui_button_parchment').setDisplaySize(sellBtnW, 52).setInteractive({ useHandCursor: true });
      this.add.text(bx, sellRowY - 10, `出售全部${rarity.label}`, textStyle({
        fontSize: '16px', color: hex === '#e8e8e8' ? '#5a5a5a' : hex,
      })).setOrigin(0.5);
      this.add.text(bx, sellRowY + 12, `${SELL_PRICES[rarityId]} 金幣/件`, textStyle({
        fontSize: '12px', color: '#3a2413',
      })).setOrigin(0.5);
      btn.on('pointerover', () => btn.setTint(0xfff3d0));
      btn.on('pointerout', () => btn.clearTint());
      btn.on('pointerdown', () => this._sellAllOfRarity(rarityId));
      bx += sellBtnW + sellGap;
    });
    {
      const btn = this.add.image(bx - sellBtnW / 2 + sortBtnW / 2, sellRowY, 'ui_button_parchment').setDisplaySize(sortBtnW, 52).setInteractive({ useHandCursor: true });
      this.add.text(bx - sellBtnW / 2 + sortBtnW / 2, sellRowY, '整理背包', textStyle({
        fontSize: '17px', color: '#3a2413',
      })).setOrigin(0.5);
      btn.on('pointerover', () => btn.setTint(0xfff3d0));
      btn.on('pointerout', () => btn.clearTint());
      btn.on('pointerdown', () => this._sortInventory());
    }

    // ---------- 垃圾桶：把背包裡的裝備拖過來就丟棄 ----------
    this.trashX = startX + gridW / 2;
    this.trashY = 830;
    this.TRASH_TINT = 0xff6b6b;
    this.trashZone = this.add.image(this.trashX, this.trashY, 'ui_slot').setDisplaySize(140, 140).setTint(this.TRASH_TINT);
    this.add.text(this.trashX, this.trashY, '🗑', textStyle({ fontSize: '52px', color: '#ffffff' })).setOrigin(0.5);
    this.add.text(this.trashX, this.trashY + 84, '拖曳裝備到這裡丟棄（拖到其他格子可換位置）', textStyle({
      fontSize: '20px', color: '#ff9a9a',
    })).setOrigin(0.5);

    const backBtn = this.add.image(w / 2, h - 70, 'ui_bar_bg').setDisplaySize(280, 70).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 70, '返回主選單', textStyle({ fontSize: '28px', color: '#10131a' })).setOrigin(0.5);
    backBtn.on('pointerover', () => backBtn.setTint(0x6fd3ff));
    backBtn.on('pointerout', () => backBtn.clearTint());
    backBtn.on('pointerdown', () => this.scene.start('MainMenuScene'));

    this._refresh();
  }

  // 能力值面板：以「平衡型」角色的基礎數值＋目前身上裝備的加成＋已投資的升級點數
  // 算出來的預覽數值（跟 GameScene._applyEquipmentBonuses() 用同一套算法），
  // 每一項旁邊都有「+1」可以加點；下方統一放「剩餘點數／確認／重置」。
  // 「+1」只是先累積待確認的點數，按「確認」才會真的扣點數寫入存檔——這樣
  // 點錯了在確認前都還能反悔（離開背包畫面不按確認，待加點數就直接作廢）。
  _buildStatsPanel(cx, panelTop) {
    const panelW = 420, panelH = 480;
    const cy = panelTop + panelH / 2;
    this.add.image(cx, cy, 'ui_panel').setDisplaySize(panelW, panelH);
    this.add.rectangle(cx, cy, panelW - 6, panelH - 6).setStrokeStyle(3, 0x6fd3ff, 0.6).setFillStyle(0, 0);
    this.add.text(cx, panelTop + 26, '⚔ 能力值', textStyle({
      fontSize: '26px', color: '#6fd3ff',
    })).setOrigin(0.5);
    this.add.rectangle(cx, panelTop + 50, panelW - 50, 2, 0x6fd3ff, 0.4);

    this.statsValueTexts = {};
    this.plusBtns = {};
    const rowStartY = panelTop + 72, rowGap = 34;
    STATS_PANEL_DEFS.forEach((def, i) => {
      const ry = rowStartY + i * rowGap;
      this.add.image(cx - panelW / 2 + 32, ry, def.icon).setScale(0.8);
      this.add.text(cx - panelW / 2 + 56, ry, def.label, textStyle({
        fontSize: '19px', color: '#cfe9ff',
      })).setOrigin(0, 0.5);
      this.statsValueTexts[def.label] = this.add.text(cx + panelW / 2 - 78, ry, '', textStyle({
        fontSize: '19px', color: def.color,
      })).setOrigin(1, 0.5);

      const plusBtn = this.add.image(cx + panelW / 2 - 30, ry, 'ui_button_parchment').setDisplaySize(48, 30).setInteractive({ useHandCursor: true });
      this.add.text(cx + panelW / 2 - 30, ry, '+1', textStyle({ fontSize: '16px', color: '#3a2413' })).setOrigin(0.5);
      plusBtn.on('pointerover', () => plusBtn.setTint(0xfff3d0));
      plusBtn.on('pointerout', () => plusBtn.clearTint());
      plusBtn.on('pointerdown', () => this._addPendingStat(def.investKey));
      this.plusBtns[def.investKey] = plusBtn;
    });

    const footerTop = rowStartY + STATS_PANEL_DEFS.length * rowGap + 10;
    this.add.rectangle(cx, footerTop, panelW - 40, 2, 0xffd93d, 0.3);

    this.statPointsText = this.add.text(cx, footerTop + 24, '', textStyle({
      fontSize: '18px', color: '#ffd93d',
    })).setOrigin(0.5);

    const confirmBtn = this.add.image(cx, footerTop + 60, 'ui_button_parchment').setDisplaySize(160, 42).setInteractive({ useHandCursor: true });
    this.add.text(cx, footerTop + 60, '確認加點', textStyle({ fontSize: '19px', color: '#3a2413' })).setOrigin(0.5);
    confirmBtn.on('pointerover', () => confirmBtn.setTint(0xfff3d0));
    confirmBtn.on('pointerout', () => confirmBtn.clearTint());
    confirmBtn.on('pointerdown', () => this._confirmStatPoints());

    const resetBtn = this.add.image(cx, footerTop + 108, 'ui_button_parchment').setDisplaySize(220, 42).setInteractive({ useHandCursor: true });
    this.add.text(cx, footerTop + 108, '重置所有能力值', textStyle({ fontSize: '17px', color: '#3a2413' })).setOrigin(0.5);
    this.add.text(cx, footerTop + 136, `消耗 ${RESET_STAT_POINTS_GOLD_COST.toLocaleString()} 金幣`, textStyle({
      fontSize: '13px', color: '#ff9a9a',
    })).setOrigin(0.5);
    resetBtn.on('pointerover', () => resetBtn.setTint(0xfff3d0));
    resetBtn.on('pointerout', () => resetBtn.clearTint());
    resetBtn.on('pointerdown', () => this._onResetStatPoints());
  }

  _addPendingStat(key) {
    const def = STAT_INVEST_DEFS[key];
    const available = getStatPoints() - this._pendingTotal();
    if (available <= 0) { this._showToast('沒有剩餘技能點了'); return; }
    if (def.cap != null) {
      const invested = getStatInvest()[key] + this._pendingInvest[key];
      if (invested >= def.cap) { this._showToast('爆擊率已經到上限 40% 了'); return; }
    }
    this._pendingInvest[key]++;
    this._refreshStatsPanel();
  }

  _pendingTotal() {
    return Object.values(this._pendingInvest).reduce((a, b) => a + b, 0);
  }

  _confirmStatPoints() {
    const total = this._pendingTotal();
    if (total <= 0) return;
    let confirmed = 0;
    for (const key of Object.keys(this._pendingInvest)) {
      for (let i = 0; i < this._pendingInvest[key]; i++) {
        if (investStatPoint(key)) confirmed++;
      }
      this._pendingInvest[key] = 0;
    }
    this._refreshStatsPanel();
    this._showToast(`已投資 ${confirmed} 點能力值`);
  }

  _onResetStatPoints() {
    if (this._pendingTotal() > 0) {
      this._showToast('請先確認或不要點「+1」，再重置');
      return;
    }
    if (!resetStatPoints()) {
      this._showToast(`金幣不足，重置需要 ${RESET_STAT_POINTS_GOLD_COST.toLocaleString()} 金幣`);
      return;
    }
    this.goldText.setText(`金幣：${getGold()}`);
    this._refreshStatsPanel();
    this._showToast('已重置所有升級能力值');
  }

  _refreshStatsPanel() {
    const mods = CHARACTERS.balanced.mods;
    const invest = getStatInvest();
    const bonusFor = (key) => (invest[key] + this._pendingInvest[key]) * STAT_INVEST_DEFS[key].perPoint;
    const stats = {
      maxHp: Math.round(BASE_STATS.hp * mods.hp) + bonusFor('maxHp'),
      attack: Math.round(BASE_STATS.attack * mods.attack) + bonusFor('attack'),
      defense: Math.round(BASE_STATS.defense * mods.defense) + bonusFor('defense'),
      moveSpeed: Math.round(BASE_STATS.moveSpeed * mods.moveSpeed) + bonusFor('moveSpeed'),
      atkSpeed: BASE_STATS.atkSpeed + bonusFor('atkSpeed'),
      critRate: BASE_STATS.critRate + bonusFor('critRate'),
      critDmg: BASE_STATS.critDmg + bonusFor('critDmg'),
    };
    Object.values(this.equipped).forEach((itemId) => {
      if (!itemId || !EQUIPMENT_DATA[itemId]) return;
      const bonus = EQUIPMENT_DATA[itemId].bonus || {};
      if (bonus.attack) stats.attack += bonus.attack;
      if (bonus.defense) stats.defense += bonus.defense;
      if (bonus.moveSpeed) stats.moveSpeed += bonus.moveSpeed;
      if (bonus.maxHp) stats.maxHp += bonus.maxHp;
    });
    this.statPointsText.setText(`剩餘點數：${getStatPoints() - this._pendingTotal()}`);
    STATS_PANEL_DEFS.forEach((def) => {
      this.statsValueTexts[def.label].setText(def.get(stats));
    });
  }

  // 稀有度外框顏色（十六進位色碼字串），見 EquipmentData.js 的 RARITY_DATA
  _rarityHex(def) {
    const rarity = RARITY_DATA[def.rarity] || RARITY_DATA.common;
    return '#' + rarity.color.toString(16).padStart(6, '0');
  }

  _refresh() {
    // 重新畫出裝備欄（五個一般欄 + 兩個戒指欄）的圖示：有裝備時顯示圖示、隱藏空格
    // 標籤；沒有裝備時反過來。裝備旁邊加一圈對應稀有度顏色的外框，一眼分辨階級。
    [...EQUIP_SLOTS, ...RING_SLOTS].forEach((slot) => {
      if (this.equipIconImgs[slot]) { this.equipIconImgs[slot].destroy(); this.equipIconImgs[slot] = null; }
      if (this.equipRarityFrames[slot]) { this.equipRarityFrames[slot].destroy(); this.equipRarityFrames[slot] = null; }
      const itemId = this.equipped[slot];
      const bg = this.equipSlotImgs[slot];
      if (itemId && EQUIPMENT_DATA[itemId]) {
        const def = EQUIPMENT_DATA[itemId];
        const frame = createRarityFrame(this, bg.x, bg.y, SLOT_SIZE + 6, SLOT_SIZE + 6, def.rarity).setDepth(11);
        this.equipRarityFrames[slot] = frame;
        // 圖示是 128x128 的正式美術圖，縮放倍率調大讓圖示確實填滿欄位方框，
        // 不再看起來小小一顆飄在方框中間。
        const icon = this.add.image(bg.x, bg.y, def.icon).setScale(0.55).setDepth(12);
        this.equipIconImgs[slot] = icon;
        this.equipEmptyLabels[slot].setVisible(false);
      } else {
        this.equipEmptyLabels[slot].setVisible(true);
      }
    });

    // 重新畫出背包格的圖示：可拖曳，拖到垃圾桶上放開就丟棄；滑鼠移上去顯示名稱/數值提示；
    // 沒有拖動、單純點一下的話維持原本「點擊裝備」的行為。
    this.slotIcons.forEach((icon) => { if (icon) icon.destroy(); });
    this.slotRarityFrames.forEach((frame) => { if (frame) frame.destroy(); });
    this.inventory.forEach((itemId, idx) => {
      if (itemId && EQUIPMENT_DATA[itemId]) {
        const def = EQUIPMENT_DATA[itemId];
        const bg = this.slotBgs[idx];
        this.slotRarityFrames[idx] = createRarityFrame(this, bg.x, bg.y, bg.displayWidth - 2, bg.displayHeight - 2, def.rarity);
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
            return;
          }
          // 拖到背包的其他格子上放開＝把裝備移到那一格（目標格有東西就交換位置），
          // 讓玩家可以自由決定每件裝備放在哪
          const targetIdx = this._cellIndexAt(icon.x, icon.y);
          if (targetIdx != null && targetIdx !== idx) {
            const tmp = this.inventory[targetIdx];
            this.inventory[targetIdx] = this.inventory[idx];
            this.inventory[idx] = tmp;
            setInventory(this.inventory);
            this._refresh();
            return;
          }
          icon.setPosition(bg.x, bg.y);
        });
        icon.on('pointerup', () => {
          if (!icon.getData('dragged')) this._handleSlotClick(idx);
        });
        icon.on('pointerover', () => this._showTooltip(bg.x, bg.y, def));
        icon.on('pointerout', () => this._hideTooltip());
        this.slotIcons[idx] = icon;
      } else {
        this.slotIcons[idx] = null;
        this.slotRarityFrames[idx] = null;
      }
    });

    this.goldText.setText(`金幣：${getGold()}`);
    this.levelText.setText(`Lv.${getStatLevel()}　${getStatExp()}/${getStatExpToNext()} EXP`);
    this._refreshStatsPanel();
  }

  // 滑鼠移到裝備上顯示的名稱／數值提示框，固定畫在裝備正上方。
  // 敘述文字（尤其戒指說明很長）套用 wordWrap 自動換行，並且先量出換行後的
  // 實際高度才決定整個框的高度／位置，避免長敘述超出框外或被切掉。
  // 滑到背包裝備時，額外顯示「跟身上同部位目前裝備的數值比較」；
  // 滑到身上穿著的裝備時，標示「目前裝備」。
  _showTooltip(x, y, def, opts = {}) {
    this._hideTooltip();
    const rarity = RARITY_DATA[def.rarity] || RARITY_DATA.common;
    const boxW = 280;
    const padding = 14;
    const headerH = 56; // 稀有度標籤 + 名稱 + 間距佔用的高度

    const desc = this.add.text(0, 0, def.desc, textStyle({
      fontSize: '18px', color: '#9fd3ff', align: 'center',
      wordWrap: { width: boxW - padding * 2, useAdvancedWrap: true },
    })).setOrigin(0.5, 0).setDepth(901);

    // 背包裝備 vs. 身上同部位目前裝備的比較文字（戒指沒有數值屬性，不做比較）
    let compare = null;
    if (!opts.isEquipped && def.slot !== 'ring') {
      const equippedId = this.equipped[def.slot];
      if (equippedId && EQUIPMENT_DATA[equippedId] && equippedId !== def.id) {
        const cur = EQUIPMENT_DATA[equippedId];
        const statKey = Object.keys(def.bonus)[0];
        const newVal = def.bonus[statKey] || 0;
        const curVal = (cur.bonus || {})[statKey] || 0;
        const diff = newVal - curVal;
        const diffText = diff > 0 ? `↑ +${diff}` : diff < 0 ? `↓ ${diff}` : '＝相同';
        const diffColor = diff > 0 ? '#5bff8f' : diff < 0 ? '#ff6b6b' : '#cfcfcf';
        compare = this.add.text(0, 0, `目前裝備：${cur.name}\n${curVal} → ${newVal}（${diffText}）`, textStyle({
          fontSize: '16px', color: diffColor, align: 'center',
          wordWrap: { width: boxW - padding * 2, useAdvancedWrap: true },
        })).setOrigin(0.5, 0).setDepth(901);
      }
    }

    const compareH = compare ? compare.height + 10 : 0;
    const boxH = padding * 2 + headerH + desc.height + compareH;
    const bottomGap = 40; // 提示框底部跟圖示之間的距離
    const topY = y - bottomGap - boxH;
    const centerY = topY + boxH / 2;

    const bg = this.add.rectangle(x, centerY, boxW, boxH, 0x0a0e16, 0.92)
      .setStrokeStyle(2, rarity.color, 0.9).setDepth(900);
    const rarityLabel = this.add.text(x, topY + padding, opts.isEquipped ? `${rarity.label}（目前裝備）` : rarity.label, textStyle({
      fontSize: '15px', color: this._rarityHex(def),
    })).setOrigin(0.5, 0).setDepth(901);
    const name = this.add.text(x, topY + padding + 22, def.name, textStyle({
      fontSize: '22px', color: '#ffe066',
    })).setOrigin(0.5, 0).setDepth(901);
    desc.setPosition(x, topY + padding + headerH);

    this._tooltip = [bg, rarityLabel, name, desc];
    if (compare) {
      compare.setPosition(x, topY + padding + headerH + desc.height + 10);
      this._tooltip.push(compare);
    }
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

  // 背包格點擊：改成「雙擊才穿上」防止誤穿——第一下只記錄，400ms 內點同一格
  // 第二下才真的執行穿裝備。
  _handleSlotClick(idx) {
    const now = this.time.now;
    if (this._lastClickIdx === idx && now - (this._lastClickAt || 0) < 400) {
      this._lastClickIdx = null;
      this._equipFromInventory(idx);
    } else {
      this._lastClickIdx = idx;
      this._lastClickAt = now;
    }
  }

  // 把座標反查成背包格 index；不在格線範圍內回傳 null
  _cellIndexAt(x, y) {
    const g = this.gridGeom;
    const c = Math.floor((x - g.startX) / g.cellW);
    const r = Math.floor((y - g.startY) / g.cellH);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return r * COLS + c;
  }

  // 一鍵出售背包內全部指定稀有度的裝備（身上穿著的不賣、戒指不在出售清單內）
  _sellAllOfRarity(rarityId) {
    const price = SELL_PRICES[rarityId];
    if (!price) return;
    let sold = 0;
    this.inventory.forEach((itemId, idx) => {
      const def = itemId && EQUIPMENT_DATA[itemId];
      if (def && def.rarity === rarityId && def.slot !== 'ring') {
        this.inventory[idx] = null;
        sold++;
      }
    });
    if (sold === 0) {
      this._showToast(`背包內沒有${RARITY_DATA[rarityId].label}裝備`);
      return;
    }
    addGold(sold * price);
    setInventory(this.inventory);
    this._refresh();
    this._showToast(`已出售 ${sold} 件${RARITY_DATA[rarityId].label}裝備，獲得 ${sold * price} 金幣`);
  }

  // 整理背包：由高稀有度到低排序（同稀有度依部位、再依數值高到低），空格全部擠到後面
  _sortInventory() {
    const items = this.inventory.filter(Boolean);
    const rarityOrder = (id) => RARITY_IDS.indexOf(EQUIPMENT_DATA[id]?.rarity ?? 'common');
    const slotOrder = (id) => [...EQUIP_SLOTS, 'ring'].indexOf(EQUIPMENT_DATA[id]?.slot);
    const bonusValue = (id) => Object.values(EQUIPMENT_DATA[id]?.bonus || {})[0] || 0;
    items.sort((a, b) =>
      rarityOrder(b) - rarityOrder(a) || slotOrder(a) - slotOrder(b) || bonusValue(b) - bonusValue(a));
    while (items.length < this.inventory.length) items.push(null);
    this.inventory = items;
    setInventory(this.inventory);
    this._refresh();
    this._showToast('背包整理完成');
  }

  // 雙擊背包裡的裝備：穿上，原本穿的那件（如果有）換回同一格。
  // 戒指共用兩個戒指欄：優先裝進空的那格，兩格都滿了就換掉 ring1。
  _equipFromInventory(idx) {
    const itemId = this.inventory[idx];
    if (!itemId || !EQUIPMENT_DATA[itemId]) return;
    const def = EQUIPMENT_DATA[itemId];
    let targetSlot = def.slot;
    if (def.slot === 'ring') {
      if (this.equipped.ring1 === itemId || this.equipped.ring2 === itemId) return; // 同一種戒指不能戴兩個
      targetSlot = !this.equipped.ring1 ? 'ring1' : (!this.equipped.ring2 ? 'ring2' : 'ring1');
    }
    const prev = this.equipped[targetSlot];
    this.equipped[targetSlot] = itemId;
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
