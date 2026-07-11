import {
  EQUIPMENT_DATA, EQUIP_SLOTS, RING_SLOTS, SLOT_LABELS, RARITY_DATA, RARITY_IDS, SELL_PRICES,
  LEGENDARY_SET_BONUS_TEXT, MYTHIC_SET_BONUS_TEXT, getLegendarySeriesSlug,
} from '../equipment/EquipmentData.js';
import { createRarityFrame } from '../utils/RarityFrame.js';
import {
  getInventory, setInventory, getEquipped, setEquipped, getGold, addGold,
  getStatLevel, getStatExp, getStatExpToNext, getStatPoints, getStatInvest,
  getStatBonus, investStatPoint, resetStatPoints,
  RESET_STAT_POINTS_GOLD_COST, STAT_INVEST_DEFS,
} from '../managers/SaveManager.js';
import { CHARACTERS, BASE_STATS } from '../player/Player.js';
import { textStyle } from '../utils/TextStyle.js';

const COLS = 12, ROWS = 6; // 12x6 背包格子（放大版面＋增加格數）

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

// 背包場景：左邊是角色（裝備疊在對應身體部位上）+ 能力值面板，右邊是 12x6 的物品格子。
// 單擊背包裝備彈出「穿上／出售」小選單，雙擊直接穿上；點身上穿的裝備 = 脫下
// （放回背包第一個空格）；滑鼠移到任何裝備上都會顯示名稱／數值提示；
// 背包裡的裝備可以拖曳到別的格子交換位置。
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

    // ---------- 左側：角色（裝備疊在身體對應部位）----------
    const leftX = w * 0.2;
    const portraitY = 340;
    this.add.text(leftX, 90, '目前裝備', textStyle({ fontSize: '28px', color: '#9fd3ff' })).setOrigin(0.5);
    this.add.image(leftX, portraitY, 'player_balanced').setScale(PORTRAIT_SCALE);
    // 永久等級（跟進遊戲後那場戰鬥的等級是兩回事）原本擺在戒指欄跟角色圖示中間，
    // 但那段空隙其實只有戒指欄底邊到角色圖示頂端之間約 50px，兩行字的面板塞不下、
    // 還是會跟戒指圖示或角色圖示疊到——改放到最上排，跟右上角「金幣」同一列，
    // 用自己的小面板獨立框起來，就不會再跟任何欄位重疊。
    // 等級框改成金色雙線＋四角刻花的「徽章」風格（跟裝備傳說級外框同一套設計語言，
    // 見 RarityFrame.js），外層疊一圈緩慢脈動的金色光暈，字級也放大加描邊，
    // 讓等級這個數值在畫面上更搶眼；下面再加一條 EXP 進度條，不用心算兩個數字
    // 就能一眼看出離升級還差多少。
    const levelBoxY = 50, levelBoxW = 290, levelBoxH = 62;
    const levelGlow = this.add.image(leftX, levelBoxY, 'fx_bossdeath')
      .setDisplaySize(levelBoxW * 1.15, levelBoxH * 2.6)
      .setTint(0xffd700).setAlpha(0.22).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: levelGlow, alpha: { from: 0.14, to: 0.32 }, duration: 1200,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this.add.image(leftX, levelBoxY, 'ui_panel').setDisplaySize(levelBoxW, levelBoxH);
    this.add.rectangle(leftX, levelBoxY, levelBoxW - 6, levelBoxH - 6)
      .setStrokeStyle(3, 0xffd700, 1).setFillStyle(0, 0);
    this.add.rectangle(leftX, levelBoxY, levelBoxW, levelBoxH)
      .setStrokeStyle(1, 0xffd700, 0.5).setFillStyle(0, 0);
    // 四角刻花：短的 L 形折線裝飾（跟傳說級裝備外框同一招）
    {
      const tickG = this.add.graphics();
      tickG.lineStyle(2, 0xffd700, 0.9);
      const hw = levelBoxW / 2, hh = levelBoxH / 2, tick = 12;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
        const cx = leftX + sx * hw, cy = levelBoxY + sy * hh;
        tickG.lineBetween(cx, cy - sy * tick, cx, cy);
        tickG.lineBetween(cx - sx * tick, cy, cx, cy);
      });
    }
    this.levelText = this.add.text(leftX, levelBoxY - 15, '', textStyle({
      fontSize: '27px', color: '#ffe066', fontStyle: 'bold',
      stroke: '#3a2413', strokeThickness: 4,
    })).setOrigin(0.5);
    this.levelExpText = this.add.text(leftX, levelBoxY + 6, '', textStyle({
      fontSize: '13px', color: '#9fd3ff',
    })).setOrigin(0.5);
    const expBarW = levelBoxW - 32, expBarH = 6;
    this.levelExpBarW = expBarW;
    this.add.rectangle(leftX, levelBoxY + 21, expBarW, expBarH, 0x000000, 0.45);
    this.levelExpBarFill = this.add.rectangle(leftX - expBarW / 2, levelBoxY + 21, 0, expBarH, 0xffe066, 1).setOrigin(0, 0.5);

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

    // ---------- 右側：12x6 背包格（放大版面） ----------
    const gridW = 940, gridH = 456;
    const startX = w * 0.375, startY = 200;
    const cellW = gridW / COLS, cellH = gridH / ROWS;
    // 拖曳裝備到任一格時要反查「放開位置是哪一格」，把格線幾何存起來
    this.gridGeom = { startX, startY, cellW, cellH };
    this.add.text(startX + gridW / 2, 155, '背包（單擊顯示穿上／出售，雙擊直接穿上）', textStyle({
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
    // 依稀有度一鍵賣掉背包內全部該階裝備（只賣背包，身上穿著的不動；六階都能賣，含戒指）。
    const sellRowY = startY + gridH + 55;
    // 傳說／神話太稀有也太值錢，一鍵出售容易誤按賣掉重要裝備，只留一般～史詩四階
    const sellDefs = RARITY_IDS.filter((id) => id !== 'legendary' && id !== 'mythic');
    const sellBtnW = 148, sellGap = 8;
    const sortBtnW = 130;
    const rowTotalW = sellDefs.length * sellBtnW + sellDefs.length * sellGap + sortBtnW;
    let bx = startX + gridW / 2 - rowTotalW / 2 + sellBtnW / 2;
    sellDefs.forEach((rarityId) => {
      const rarity = RARITY_DATA[rarityId];
      const hex = '#' + rarity.color.toString(16).padStart(6, '0');
      const btn = this.add.image(bx, sellRowY, 'ui_button_parchment').setDisplaySize(sellBtnW, 60).setInteractive({ useHandCursor: true });
      this.add.text(bx, sellRowY - 12, `出售全部${rarity.label}`, textStyle({
        fontSize: '19px', color: hex === '#e8e8e8' ? '#3a2413' : hex,
      })).setOrigin(0.5);
      this.add.text(bx, sellRowY + 14, `${SELL_PRICES[rarityId].toLocaleString()} 金幣/件`, textStyle({
        fontSize: '16px', color: '#3a2413',
      })).setOrigin(0.5);
      btn.on('pointerover', () => btn.setTint(0xfff3d0));
      btn.on('pointerout', () => btn.clearTint());
      btn.on('pointerdown', () => this._sellAllOfRarity(rarityId));
      bx += sellBtnW + sellGap;
    });
    {
      const btn = this.add.image(bx - sellBtnW / 2 + sortBtnW / 2, sellRowY, 'ui_button_parchment').setDisplaySize(sortBtnW, 60).setInteractive({ useHandCursor: true });
      this.add.text(bx - sellBtnW / 2 + sortBtnW / 2, sellRowY, '整理背包', textStyle({
        fontSize: '19px', color: '#3a2413',
      })).setOrigin(0.5);
      btn.on('pointerover', () => btn.setTint(0xfff3d0));
      btn.on('pointerout', () => btn.clearTint());
      btn.on('pointerdown', () => this._sortInventory());
    }

    const backBtn = this.add.image(w / 2, h - 60, 'ui_bar_bg').setDisplaySize(280, 70).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 60, '返回主選單', textStyle({ fontSize: '28px', color: '#10131a' })).setOrigin(0.5);
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
    // +110 是多留給面板最下面「已發動能力」那一小塊的空間（見下面 setBonusTitle）。
    const panelW = 420, panelH = 590;
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
      this.statsValueTexts[def.label] = this.add.text(cx + panelW / 2 - 92, ry, '', textStyle({
        fontSize: '19px', color: def.color,
      })).setOrigin(1, 0.5);

      // 「+1」跟「+10」兩顆快捷加點鍵並排，「+10」給想一次加多一點的玩家用，
      // 不用像單顆「+1」那樣點很多下。
      const plus1Btn = this.add.image(cx + panelW / 2 - 56, ry, 'ui_button_parchment').setDisplaySize(32, 28).setInteractive({ useHandCursor: true });
      this.add.text(cx + panelW / 2 - 56, ry, '+1', textStyle({ fontSize: '14px', color: '#3a2413' })).setOrigin(0.5);
      plus1Btn.on('pointerover', () => plus1Btn.setTint(0xfff3d0));
      plus1Btn.on('pointerout', () => plus1Btn.clearTint());
      plus1Btn.on('pointerdown', () => this._addPendingStat(def.investKey, 1));

      const plus10Btn = this.add.image(cx + panelW / 2 - 18, ry, 'ui_button_parchment').setDisplaySize(38, 28).setInteractive({ useHandCursor: true });
      this.add.text(cx + panelW / 2 - 18, ry, '+10', textStyle({ fontSize: '13px', color: '#3a2413' })).setOrigin(0.5);
      plus10Btn.on('pointerover', () => plus10Btn.setTint(0xfff3d0));
      plus10Btn.on('pointerout', () => plus10Btn.clearTint());
      plus10Btn.on('pointerdown', () => this._addPendingStat(def.investKey, 10));

      this.plusBtns[def.investKey] = [plus1Btn, plus10Btn];
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

    // 傳說套裝效果（見 EquipmentData.LEGENDARY_SET_BONUS_TEXT）：湊滿 3/5 件才顯示，
    // 平時整塊隱藏，避免沒穿滿套的玩家看到一堆空白提示。內容由 _refreshStatsPanel()
    // 根據 this.equipped 即時算，穿脫裝備時（呼叫 _refresh()）就會跟著更新。
    const setBonusTop = footerTop + 155;
    this.setBonusDivider = this.add.rectangle(cx, setBonusTop, panelW - 40, 2, 0xffd93d, 0.3).setVisible(false);
    this.setBonusTitle = this.add.text(cx, setBonusTop + 22, '✅ 已發動能力', textStyle({
      fontSize: '19px', color: '#ffd93d', fontStyle: 'bold',
    })).setOrigin(0.5).setVisible(false);
    this.setBonusText = this.add.text(cx, setBonusTop + 48, '', textStyle({
      fontSize: '15px', color: '#ffe066', align: 'center',
    })).setOrigin(0.5, 0);
  }

  // 「+1」／「+10」都走這個共用邏輯：先扣「還剩多少可加點數」的上限，超過上限
  // （目前只有爆擊率 40%）的部分直接跳過，不會多加；點數不夠時能加多少算多少，
  // 而不是整次都不加（例如剩 4 點按「+10」，就先加滿這 4 點）。
  _addPendingStat(key, amount) {
    const def = STAT_INVEST_DEFS[key];
    const available = getStatPoints() - this._pendingTotal();
    if (available <= 0) { this._showToast('沒有剩餘技能點了'); return; }
    let addAmount = Math.min(amount, available);
    if (def.cap != null) {
      const invested = getStatInvest()[key] + this._pendingInvest[key];
      const capRemaining = def.cap - invested;
      if (capRemaining <= 0) { this._showToast('爆擊率已經到上限 40% 了'); return; }
      addAmount = Math.min(addAmount, capRemaining);
    }
    this._pendingInvest[key] += addAmount;
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
      const invested = invest[def.investKey] + this._pendingInvest[def.investKey];
      this.statsValueTexts[def.label].setText(`${def.get(stats)} (${invested})`);
    });

    // 傳說套裝效果：同一套主題裝（不分部位、戒指不算）湊滿 3／5 件時才顯示，
    // 跟 GameScene._computeSetBonuses() 用同一套判定邏輯。
    const setCounts = {};
    Object.values(this.equipped).forEach((itemId) => {
      const slug = getLegendarySeriesSlug(itemId);
      if (slug) setCounts[slug] = (setCounts[slug] || 0) + 1;
    });
    const setLines = [];
    const allSetBonusText = { ...LEGENDARY_SET_BONUS_TEXT, ...MYTHIC_SET_BONUS_TEXT };
    Object.keys(allSetBonusText).forEach((slug) => {
      const n = setCounts[slug] || 0;
      const def = allSetBonusText[slug];
      if (n >= 3) setLines.push(`${def.label}：${def.three}`);
      if (n >= 5) setLines.push(`${def.label}：${def.five}`);
    });
    this.setBonusDivider.setVisible(setLines.length > 0);
    this.setBonusTitle.setVisible(setLines.length > 0);
    this.setBonusText.setText(setLines.join('\n'));
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

    // 重新畫出背包格的圖示：可拖曳到別的格子交換位置；滑鼠移上去顯示名稱/數值提示；
    // 沒有拖動、單純點一下的話走「單擊選單／雙擊穿上」的行為。
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
        });
        icon.on('dragend', () => {
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
    this.levelText.setText(`⭐ Lv.${getStatLevel()}`);
    const exp = getStatExp(), expToNext = Math.max(1, getStatExpToNext());
    this.levelExpText.setText(`${exp}/${expToNext} EXP`);
    this.levelExpBarFill.width = this.levelExpBarW * Math.min(1, exp / expToNext);
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

  // 背包格點擊：單擊顯示「穿上／出售」小選單；400ms 內在同一格再點一次（雙擊）
  // 則跳過選單直接穿上——防止誤穿，同時保留快速穿裝的手感。活動獎勵球
  // （kind === 'lootBall'，見 EquipmentData.js）不能穿，單擊/雙擊都改成走
  // 「開啟」確認流程，不會誤觸一般裝備的穿上邏輯。
  _handleSlotClick(idx) {
    if (!this.inventory[idx]) { this._hideActionMenu(); return; }
    const itemId = this.inventory[idx];
    const def = EQUIPMENT_DATA[itemId];
    const isBall = def && def.kind === 'lootBall';
    const now = this.time.now;
    if (this._lastClickIdx === idx && now - (this._lastClickAt || 0) < 400) {
      this._lastClickIdx = null;
      this._hideActionMenu();
      if (isBall) this._confirmOpenLootBall(idx);
      else this._equipFromInventory(idx);
    } else {
      this._lastClickIdx = idx;
      this._lastClickAt = now;
      this._showActionMenu(idx);
    }
  }

  // 單擊裝備彈出的「穿上／出售」小選單，畫在該格正上方（活動獎勵球顯示「開啟」
  // 取代「穿上」）
  _showActionMenu(idx) {
    this._hideActionMenu();
    this._hideTooltip();
    const itemId = this.inventory[idx];
    const def = EQUIPMENT_DATA[itemId];
    if (!def) return;
    const isBall = def.kind === 'lootBall';
    const bg = this.slotBgs[idx];
    const price = SELL_PRICES[def.rarity] || 0;
    const menuW = 150, btnH = 40;
    const cx = bg.x, cy = bg.y - bg.displayHeight / 2 - btnH - 6;

    const container = this.add.container(0, 0).setDepth(950);
    const wearBtn = this.add.image(cx, cy - btnH / 2 - 2, 'ui_button_parchment').setDisplaySize(menuW, btnH).setInteractive({ useHandCursor: true });
    const wearText = this.add.text(cx, cy - btnH / 2 - 2, isBall ? '開啟' : '穿上', textStyle({ fontSize: '18px', color: '#3a2413' })).setOrigin(0.5);
    const sellBtn = this.add.image(cx, cy + btnH / 2 + 2, 'ui_button_parchment').setDisplaySize(menuW, btnH).setInteractive({ useHandCursor: true });
    const sellText = this.add.text(cx, cy + btnH / 2 + 2, `出售（${price.toLocaleString()}）`, textStyle({ fontSize: '16px', color: '#3a2413' })).setOrigin(0.5);
    container.add([wearBtn, wearText, sellBtn, sellText]);

    wearBtn.on('pointerover', () => wearBtn.setTint(0xfff3d0));
    wearBtn.on('pointerout', () => wearBtn.clearTint());
    wearBtn.on('pointerdown', () => { this._hideActionMenu(); if (isBall) this._confirmOpenLootBall(idx); else this._equipFromInventory(idx); });
    sellBtn.on('pointerover', () => sellBtn.setTint(0xfff3d0));
    sellBtn.on('pointerout', () => sellBtn.clearTint());
    sellBtn.on('pointerdown', () => { this._hideActionMenu(); this._sellSingle(idx); });

    this._actionMenu = container;
  }

  // 開球前先跳確認彈窗（球是稀有獎勵，怕手滑誤開），確定後才真的切到
  // LootBallOpenScene 播抽獎動畫＋讓玩家自選裝備。
  _confirmOpenLootBall(idx) {
    const itemId = this.inventory[idx];
    const def = EQUIPMENT_DATA[itemId];
    if (!def) return;
    const w = this.scale.width, h = this.scale.height;
    const overlay = this.add.container(0, 0).setDepth(2000);
    const dim = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.7).setInteractive();
    const panel = this.add.image(w / 2, h / 2, 'ui_panel').setDisplaySize(520, 260);
    const border = this.add.rectangle(w / 2, h / 2, 514, 254).setStrokeStyle(3, 0xffd700, 0.8).setFillStyle(0, 0);
    const title = this.add.text(w / 2, h / 2 - 70, `是否開啟「${def.name}」？`, textStyle({
      fontSize: '26px', color: '#ffe066',
    })).setOrigin(0.5);
    const msg = this.add.text(w / 2, h / 2 - 20, def.desc, textStyle({
      fontSize: '18px', color: '#cfe9ff', align: 'center',
      wordWrap: { width: 460, useAdvancedWrap: true },
    })).setOrigin(0.5);
    const yesBtn = this.add.image(w / 2 - 90, h / 2 + 70, 'ui_button_parchment').setDisplaySize(160, 50).setInteractive({ useHandCursor: true });
    const yesText = this.add.text(w / 2 - 90, h / 2 + 70, '開啟', textStyle({ fontSize: '22px', color: '#3a2413' })).setOrigin(0.5);
    const noBtn = this.add.image(w / 2 + 90, h / 2 + 70, 'ui_button_parchment').setDisplaySize(160, 50).setInteractive({ useHandCursor: true });
    const noText = this.add.text(w / 2 + 90, h / 2 + 70, '取消', textStyle({ fontSize: '22px', color: '#3a2413' })).setOrigin(0.5);
    overlay.add([dim, panel, border, title, msg, yesBtn, yesText, noBtn, noText]);

    yesBtn.on('pointerover', () => yesBtn.setTint(0xfff3d0));
    yesBtn.on('pointerout', () => yesBtn.clearTint());
    yesBtn.on('pointerdown', () => {
      overlay.destroy();
      this.scene.start('LootBallOpenScene', { itemId, invIdx: idx });
    });
    noBtn.on('pointerover', () => noBtn.setTint(0xff9a9a));
    noBtn.on('pointerout', () => noBtn.clearTint());
    noBtn.on('pointerdown', () => overlay.destroy());
  }

  _hideActionMenu() {
    if (this._actionMenu) { this._actionMenu.destroy(); this._actionMenu = null; }
  }

  // 出售背包內單一件裝備（單擊選單的「出售」按鈕）
  _sellSingle(idx) {
    const itemId = this.inventory[idx];
    const def = itemId && EQUIPMENT_DATA[itemId];
    if (!def) return;
    const price = SELL_PRICES[def.rarity] || 0;
    this.inventory[idx] = null;
    if (price > 0) addGold(price);
    setInventory(this.inventory);
    this._refresh();
    this._showToast(`已出售「${def.name}」，獲得 ${price.toLocaleString()} 金幣`);
  }

  // 把座標反查成背包格 index；不在格線範圍內回傳 null
  _cellIndexAt(x, y) {
    const g = this.gridGeom;
    const c = Math.floor((x - g.startX) / g.cellW);
    const r = Math.floor((y - g.startY) / g.cellH);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return r * COLS + c;
  }

  // 一鍵出售背包內全部指定稀有度的裝備（含戒指；身上穿著的不賣）
  _sellAllOfRarity(rarityId) {
    const price = SELL_PRICES[rarityId];
    if (!price) return;
    let sold = 0;
    this.inventory.forEach((itemId, idx) => {
      const def = itemId && EQUIPMENT_DATA[itemId];
      if (def && def.rarity === rarityId) {
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
