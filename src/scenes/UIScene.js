import { WEAPON_DATA, WEAPON_EVOLUTIONS, WEAPON_FUSIONS } from '../weapons/WeaponData.js';
import { EQUIP_SLOTS, RING_SLOTS, EQUIPMENT_DATA, LEGENDARY_SET_BONUS_TEXT } from '../equipment/EquipmentData.js';
import { PASSIVE_IDS, PASSIVE_DATA } from '../skills/PassiveData.js';
import { getEquipped, isLevelUpAutoMode, setLevelUpAutoMode, getPlayerName } from '../managers/SaveManager.js';
import { audioManager } from '../managers/AudioManager.js';
import { textStyle } from '../utils/TextStyle.js';
import { subscribeWoofWarLeaderboard } from '../firebase/firebase.js';

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

    // 汪汪大作戰結果視窗只在第一次呼叫 showWoofWarResult() 時建立（見該函式的
    // `if (!this.woofWarResultOverlay)`），但這個欄位是存在 Scene 實例上的一般
    // JS 屬性，不會因為 scene.stop()／重新 create() 就自動清空——玩家點「再次
    // 挑戰」時 restartWoofWarChallenge() 會先 stop UIScene 再重開，畫面上的物件
    // 被 Phaser 銷毀了，但 this.woofWarResultOverlay 還留著指向「已銷毀物件」的
    // 舊參考，導致第二次結算呼叫 setText() 直接噴錯、卡在半途沒顯示結果（這正是
    // 玩家回報「時間到部分沒有順利結束遊戲」的另一個成因）。這裡在 create() 開頭
    // 明確重置，讓每次重開都會照 `!this.woofWarResultOverlay` 的判斷重新建立。
    this.woofWarResultOverlay = null;

    // ---- 左上：HP / 等級 / EXP ----
    this.add.image(280, 70, 'ui_bar_bg').setScrollFactor(0).setDisplaySize(500, 44).setOrigin(0.5);
    this.hpFill = this.add.image(30, 70, 'ui_bar_fill_hp').setScrollFactor(0).setOrigin(0, 0.5).setDisplaySize(492, 38);
    this.hpText = this.add.text(280, 70, '', textStyle({ fontSize: '26px', color: '#fff' })).setOrigin(0.5).setScrollFactor(0);

    this.lvText = this.add.text(30, 108, 'Lv.1', textStyle({ fontSize: '38px', color: '#6fd3ff' })).setScrollFactor(0);
    this.add.image(400, 158, 'ui_bar_bg').setScrollFactor(0).setDisplaySize(280, 22).setOrigin(0.5);
    this.xpFill = this.add.image(260, 158, 'ui_bar_fill_xp').setScrollFactor(0).setOrigin(0, 0.5).setDisplaySize(278, 19);

    // ---- 右上：擊殺數 / 存活時間 / FPS ----
    // 關卡改成擊殺數/擊敗魔王推進之後，畫面上已經沒有任何地方顯示存活時間了
    // （原本的「第 N 關」在時間制底下等於間接顯示時間，現在兩者已經脫鉤）——
    // 補回一個獨立的存活時間顯示，跟 GameOverScene 結算畫面的 mm:ss 格式一致。
    this.killText = this.add.text(w - 32, 26, '', textStyle({ fontSize: '28px', color: '#ffd93d' })).setOrigin(1, 0).setScrollFactor(0);
    this.timeText = this.add.text(w - 32, 64, '', textStyle({ fontSize: '22px', color: '#9fd3ff' })).setOrigin(1, 0).setScrollFactor(0);
    this.fpsText = this.add.text(w - 32, 98, '', textStyle({ fontSize: '20px', color: '#ffffff' })).setOrigin(1, 0).setScrollFactor(0);

    // ---- 正上方置中：目前關卡（擊殺數/擊敗魔王推進，見 GameScene.getStage()）----
    // 白色粗體；魔王關（每 5 關）改成紅色，並在文字前加骷髏圖案提醒玩家小心
    this.stageText = this.add.text(w / 2, 26, '', textStyle({
      fontSize: '40px', color: '#ffffff', fontStyle: 'bold',
    })).setOrigin(0.5, 0).setScrollFactor(0);

    // ---- 魔王血條：固定在關卡數字正下方，顯示名稱＋血量數字 ----
    // 原本畫在 GameScene（鏡頭有 2.1 倍縮放，位置/大小會跑掉），改到這個
    // 無縮放的 UI 疊加層；魔王在場才顯示，每幀從 gs.boss 讀血量（見 update()）。
    this.bossLabel = this.add.text(w / 2, 76, '', textStyle({
      fontSize: '26px', color: '#ff6a3d',
    })).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100).setVisible(false);
    this.bossBarBg = this.add.image(w / 2, 132, 'ui_bar_bg')
      .setScrollFactor(0).setDisplaySize(600, 34).setDepth(100).setVisible(false);
    this.bossBarFill = this.add.image(w / 2 - 290, 132, 'ui_bar_fill_boss')
      .setScrollFactor(0).setOrigin(0, 0.5).setDisplaySize(580, 30).setDepth(101).setVisible(false);
    this.bossHpText = this.add.text(w / 2, 132, '', textStyle({
      fontSize: '20px', color: '#ffffff',
    })).setOrigin(0.5).setScrollFactor(0).setDepth(102).setVisible(false);

    // ---- 右側：目前技能（用面板框把整塊「技能」區域框起來）----
    // 2026-07-11：原本 rowH=88／iconSize=60／PANEL_W=380 留白太多、文字顯得
    // 過小，整體收緊——面板變窄、列高變矮、圖示縮小，文字比例相對變大更好讀。
    const PANEL_W = 300;
    this.panelX = w - 180;
    this.panelTop = 150;
    const TITLE_H = 52;

    this.weaponPanelBg = this.add.image(this.panelX, this.panelTop, 'ui_panel')
      .setOrigin(0.5, 0).setScrollFactor(0).setDisplaySize(PANEL_W, 140).setDepth(-1);
    this.weaponPanelTitle = this.add.text(this.panelX, this.panelTop + 12, '技能', textStyle({
      fontSize: '24px', color: '#6fd3ff',
    })).setOrigin(0.5, 0).setScrollFactor(0);
    this.weaponPanelDivider = this.add.rectangle(
      this.panelX, this.panelTop + TITLE_H - 10, PANEL_W - 36, 2, 0x6fd3ff, 0.4
    ).setScrollFactor(0);

    this.weaponPanel = this.add.container(this.panelX - 50, this.panelTop + TITLE_H).setScrollFactor(0);
    this._panelW = PANEL_W;
    this._titleH = TITLE_H;

    // ---- 左側：暗影君王套裝專用面板（只有裝備滿 3 件才顯示，見 update() 裡的
    // setVisible 判斷）。顯示已提取的小兵影子／魔王影子數量＋各自的召喚按鈕，
    // 位置放在左上角 HP/XP 條下方原本空著的區域，不會跟右側技能面板搶位置。
    // 安培要求「文字視覺效果要大」，數字字級刻意拉到比其他 UI 格明顯大上一截
    // （36px + 描邊），做出「這是特殊資源」的份量感。
    this._buildShadowPanel();

    // ---- 下方：狀態列，分成「數值／已發動能力／裝備／技能」四大塊，數值/裝備/
    // 技能各自用 2 欄 x 3 列的卡片式排版（每個項目都用 ui_stat_chip 包成一張獨立
    // 卡片）；已發動能力獨立一欄顯示套裝效果文字，不用卡片格（內容是長條說明文字，
    // 硬塞進卡片格反而不好排版）----
    const bottomBarH = 210;
    const bottomBarY = h - bottomBarH / 2 - 10;
    const barLeft = 30, barWidth = w - 60;
    this.add.image(w / 2, bottomBarY, 'ui_panel').setDisplaySize(barWidth, bottomBarH).setScrollFactor(0).setDepth(-1);

    const colW = barWidth / 4;
    const col1CenterX = barLeft + colW * 0.5; // 數值
    const col2CenterX = barLeft + colW * 1.5; // 已發動能力
    const col3CenterX = barLeft + colW * 2.5; // 裝備
    const col4CenterX = barLeft + colW * 3.5; // 技能

    const barTop = bottomBarY - bottomBarH / 2;
    const titleY = barTop + 20;
    const gridTopY = barTop + 68;
    const rowGap = 48;

    this.add.text(col1CenterX, titleY, '數值', textStyle({ fontSize: '26px', color: '#cfe9ff', fontStyle: 'bold' })).setOrigin(0.5).setScrollFactor(0);
    this.add.text(col2CenterX, titleY, '已發動能力', textStyle({ fontSize: '26px', color: '#ffd93d', fontStyle: 'bold' })).setOrigin(0.5).setScrollFactor(0);
    this.add.text(col3CenterX, titleY, '裝備', textStyle({ fontSize: '26px', color: '#ffe066', fontStyle: 'bold' })).setOrigin(0.5).setScrollFactor(0);
    this.add.text(col4CenterX, titleY, '技能', textStyle({ fontSize: '26px', color: '#6fd3ff', fontStyle: 'bold' })).setOrigin(0.5).setScrollFactor(0);
    this.add.rectangle(col1CenterX, titleY + 22, colW - 50, 2, 0xcfe9ff, 0.25).setScrollFactor(0);
    this.add.rectangle(col2CenterX, titleY + 22, colW - 50, 2, 0xffd93d, 0.25).setScrollFactor(0);
    this.add.rectangle(col3CenterX, titleY + 22, colW - 50, 2, 0xffe066, 0.25).setScrollFactor(0);
    this.add.rectangle(col4CenterX, titleY + 22, colW - 50, 2, 0x6fd3ff, 0.25).setScrollFactor(0);

    // 直向分隔線，讓四大塊視覺上更清楚地分開
    this.add.rectangle(barLeft + colW, bottomBarY, 2, bottomBarH - 20, 0xffffff, 0.12).setScrollFactor(0);
    this.add.rectangle(barLeft + colW * 2, bottomBarY, 2, bottomBarH - 20, 0xffffff, 0.12).setScrollFactor(0);
    this.add.rectangle(barLeft + colW * 3, bottomBarY, 2, bottomBarH - 20, 0xffffff, 0.12).setScrollFactor(0);

    // 通用排版：給定該欄中心 X，回傳 2 欄 x 3 列共 6 張卡片的座標（由左到右、由上到下）
    const chipW = colW * 0.44, chipH = 44;
    const cellPositions = (colCenterX) => {
      const xs = [colCenterX - colW * 0.235, colCenterX + colW * 0.235];
      const ys = [gridTopY, gridTopY + rowGap, gridTopY + rowGap * 2];
      const pos = [];
      ys.forEach((y) => xs.forEach((x) => pos.push({ x, y })));
      return pos; // [row0-col0, row0-col1, row1-col0, row1-col1, row2-col0, row2-col1]
    };

    // ---------- 數值（6 個，STAT_DEFS 剛好 6 項，滿版 2x3）----------
    const statPos = cellPositions(col1CenterX);
    this.statChips = {};
    STAT_DEFS.forEach((def, i) => {
      const { x, y } = statPos[i];
      this.add.image(x, y, 'ui_stat_chip').setDisplaySize(chipW, chipH).setScrollFactor(0);
      this.add.image(x - chipW / 2 + 26, y, def.icon).setScale(1.5).setScrollFactor(0);
      const valueText = this.add.text(x - chipW / 2 + 50, y, '', textStyle({
        fontSize: '22px', color: def.color, fontStyle: 'bold',
      })).setOrigin(0, 0.5).setScrollFactor(0);
      this.statChips[def.key] = valueText;
    });

    // ---------- 已發動能力（見 EquipmentData.LEGENDARY_SET_BONUS_TEXT）：湊滿 3/5 件
    // 傳說套裝才會有內容，平時顯示置中的灰色提示字；有內容時兩者互相切換顯示
    // （見 _refreshSetBonusText），文字長度不固定用 wordWrap 讓長效果說明自動換行。----------
    const setBonusAreaW = colW - 50;
    this.setBonusPlaceholder = this.add.text(col2CenterX, bottomBarY, '尚無套裝效果', textStyle({
      fontSize: '18px', color: '#5a6172',
    })).setOrigin(0.5).setScrollFactor(0);
    this.setBonusText = this.add.text(col2CenterX, gridTopY - 12, '', textStyle({
      fontSize: '18px', color: '#ffe066', align: 'center',
    })).setOrigin(0.5, 0).setScrollFactor(0).setWordWrapWidth(setBonusAreaW, true).setVisible(false);

    // ---------- 裝備（5 個裝備欄 + 第 6 格擠進兩個戒指小欄位，每格都加上
    // 部位名稱小字——原本只靠圖示分辨，沒裝備時整格是空的完全看不出是哪個部位）----------
    const equipPos = cellPositions(col3CenterX);
    const equipped = getEquipped();
    const EQUIP_SLOT_LABELS = { weapon: '武器', helmet: '頭盔', clothes: '衣服', pants: '褲子', shoes: '鞋子' };
    EQUIP_SLOTS.forEach((slot, i) => {
      const { x, y } = equipPos[i];
      const itemId = equipped[slot];
      this.add.image(x, y, 'ui_stat_chip').setDisplaySize(chipW, chipH).setScrollFactor(0);
      const slotBg = this.add.image(x - chipW / 2 + 28, y, 'ui_equip_slot').setDisplaySize(40, 40).setScrollFactor(0);
      if (itemId && EQUIPMENT_DATA[itemId]) {
        // 圖示現在是 128x128 的正式美術圖（取代舊的 48x48 程式產生貼圖），縮放倍率
        // 等比例縮小，維持跟卡片大小相襯的顯示尺寸。
        this.add.image(x - chipW / 2 + 28, y, EQUIPMENT_DATA[itemId].icon).setScale(0.24).setScrollFactor(0);
      } else {
        slotBg.setAlpha(0.35);
      }
      this.add.text(x - chipW / 2 + 54, y, EQUIP_SLOT_LABELS[slot], textStyle({
        fontSize: '19px', color: itemId ? '#ffe066' : '#8a8f9c',
      })).setOrigin(0, 0.5).setScrollFactor(0);
    });
    // ---------- 戒指（擠在裝備欄僅剩的第 6 格，equipPos[5]，跟「鞋子」分屬同一列
    // 不同欄，位置不會疊到）----------
    // 上一版把戒指改成跟其他裝備欄一樣寬的獨立卡片，但座標算錯直接疊在「鞋子」格上
    // 面糊成一團；這裡改回放在第 6 格裡，但圖示從 40x40 再加大到 44x44。
    {
      const { x, y } = equipPos[5];
      const ringSize = 44, ringGap = 8;
      this.add.image(x, y, 'ui_stat_chip').setDisplaySize(chipW, chipH).setScrollFactor(0);
      this.add.text(x - chipW / 2 + 14, y, '戒指', textStyle({
        fontSize: '17px', color: '#8a8f9c',
      })).setOrigin(0, 0.5).setScrollFactor(0);
      RING_SLOTS.forEach((slot, i) => {
        const rx = x + chipW / 2 - 8 - ringSize / 2 - (RING_SLOTS.length - 1 - i) * (ringSize + ringGap);
        const itemId = equipped[slot];
        const ringBg = this.add.image(rx, y, 'ui_equip_slot').setDisplaySize(ringSize, ringSize).setScrollFactor(0);
        if (itemId && EQUIPMENT_DATA[itemId]) {
          this.add.image(rx, y, EQUIPMENT_DATA[itemId].icon).setScale(0.31).setScrollFactor(0);
        } else {
          ringBg.setAlpha(0.3);
        }
      });
    }
    {
      const { x, y } = equipPos[5];
      this.add.image(x, y, 'ui_stat_chip').setDisplaySize(chipW, chipH).setAlpha(0.15).setScrollFactor(0);
    }

    // ---------- 技能（5 個被動 + 1 個保留格；武器已經在右上角的技能面板顯示過，
    // 這裡改顯示被動等級，避免跟上面重複）----------
    const skillPos = cellPositions(col4CenterX);
    this.passiveChips = {};
    PASSIVE_IDS.forEach((id, i) => {
      const { x, y } = skillPos[i];
      this.add.image(x, y, 'ui_stat_chip').setDisplaySize(chipW, chipH).setScrollFactor(0);
      this.add.image(x - chipW / 2 + 26, y, PASSIVE_DATA[id].icon).setScale(1.4).setScrollFactor(0);
      const lvText = this.add.text(x - chipW / 2 + 48, y, '', textStyle({
        fontSize: '19px', color: '#cfe9ff',
      })).setOrigin(0, 0.5).setScrollFactor(0);
      this.passiveChips[id] = lvText;
    });
    {
      const { x, y } = skillPos[5];
      this.add.image(x, y, 'ui_stat_chip').setDisplaySize(chipW, chipH).setAlpha(0.3).setScrollFactor(0);
    }

    // ---- 左下角：返回主選單按鈕（放在底部狀態列上方，避免跟狀態列格子疊在一起），
    // 用跟主選單按鈕一樣的米色羊皮紙風格＋深咖啡色文字，維持全遊戲按鈕視覺統一。
    // 點下去要把 GameScene 本身跟可能還開著的關卡內彈出視窗（升級/遺物/開局選技能）
    // 一起關掉，不然回到主選單後這些場景還留在背景繼續跑。
    const menuBtnY = bottomBarY - bottomBarH / 2 - 30;
    const menuBtn = this.add.image(90, menuBtnY, 'ui_button_parchment')
      .setDisplaySize(150, 46).setScrollFactor(0).setInteractive({ useHandCursor: true });
    this.add.text(90, menuBtnY, '返回主選單', textStyle({
      fontSize: '22px', color: '#3a2413',
    })).setOrigin(0.5).setScrollFactor(0);
    menuBtn.on('pointerover', () => menuBtn.setTint(0xfff3d0));
    menuBtn.on('pointerout', () => menuBtn.clearTint());
    menuBtn.on('pointerdown', () => this._showLeaveConfirm());

    // ---- 靜音按鈕：返回主選單旁邊，切換所有音效/BGM 的開關 ----
    const muteBtn = this.add.image(205, menuBtnY, 'ui_button_parchment')
      .setDisplaySize(56, 46).setScrollFactor(0).setInteractive({ useHandCursor: true });
    this.muteBtnText = this.add.text(205, menuBtnY, audioManager.enabled ? '🔊' : '🔇', textStyle({
      fontSize: '24px', color: '#3a2413',
    })).setOrigin(0.5).setScrollFactor(0);
    muteBtn.on('pointerover', () => muteBtn.setTint(0xfff3d0));
    muteBtn.on('pointerout', () => muteBtn.clearTint());
    muteBtn.on('pointerdown', () => {
      audioManager.setEnabled(!audioManager.enabled);
      this.muteBtnText.setText(audioManager.enabled ? '🔊' : '🔇');
    });

    // ---- 升級選卡模式按鈕：只有戴著自動戒指（ring1 或 ring2 = ring_auto）才顯示，
    // 點一下在「半自動」（維持手動選卡）跟「全自動」（升級直接自動選最左邊那張卡，
    // 見 LevelUpScene.create()）之間切換，設定會存進帳號、跨場次/跨裝置都保留。
    const autoModeBtnX = 205 + 28 + 8 + 70;
    this.autoModeBtn = this.add.image(autoModeBtnX, menuBtnY, 'ui_button_parchment')
      .setDisplaySize(150, 46).setScrollFactor(0).setInteractive({ useHandCursor: true });
    this.autoModeBtnText = this.add.text(autoModeBtnX, menuBtnY, '', textStyle({
      fontSize: '18px', color: '#3a2413',
    })).setOrigin(0.5).setScrollFactor(0);
    this.autoModeBtn.on('pointerover', () => this.autoModeBtn.setTint(0xfff3d0));
    this.autoModeBtn.on('pointerout', () => this._refreshAutoModeBtn());
    this.autoModeBtn.on('pointerdown', () => {
      setLevelUpAutoMode(!isLevelUpAutoMode());
      this._refreshAutoModeBtn();
    });
    this._refreshAutoModeBtn();

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

    // ---- 離開確認彈窗：按「返回主選單」不會立刻離開，先跳出提示，
    // 避免手滑誤按就白白丟掉這局的擊殺金幣/關卡進度 ----
    this.confirmOverlay = this.add.container(0, 0).setScrollFactor(0).setDepth(50100).setVisible(false);
    const confirmDim = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.7).setInteractive();
    const confirmText = this.add.text(w / 2, h / 2 - 60, '確定要離開嗎？\n（會結算當前紀錄）', textStyle({
      fontSize: '40px', color: '#fff', align: 'center',
    })).setOrigin(0.5);
    const yesBtn = this.add.image(w / 2 - 110, h / 2 + 60, 'ui_button_parchment')
      .setDisplaySize(180, 60).setInteractive({ useHandCursor: true });
    const yesText = this.add.text(w / 2 - 110, h / 2 + 60, '確定', textStyle({
      fontSize: '26px', color: '#3a2413',
    })).setOrigin(0.5);
    const noBtn = this.add.image(w / 2 + 110, h / 2 + 60, 'ui_button_parchment')
      .setDisplaySize(180, 60).setInteractive({ useHandCursor: true });
    const noText = this.add.text(w / 2 + 110, h / 2 + 60, '取消', textStyle({
      fontSize: '26px', color: '#3a2413',
    })).setOrigin(0.5);
    yesBtn.on('pointerover', () => yesBtn.setTint(0xfff3d0));
    yesBtn.on('pointerout', () => yesBtn.clearTint());
    noBtn.on('pointerover', () => noBtn.setTint(0xfff3d0));
    noBtn.on('pointerout', () => noBtn.clearTint());
    yesBtn.on('pointerdown', () => this._confirmLeave());
    noBtn.on('pointerdown', () => this._cancelLeaveConfirm());
    this.confirmOverlay.add([confirmDim, confirmText, yesBtn, yesText, noBtn, noText]);
  }

  // 更新升級選卡模式按鈕的顯示：沒戴自動戒指就整顆隱藏；戴著的話顯示目前是
  // 半自動還是全自動（金色外框＝全自動）。裝備只會在主選單的背包場景更動，
  // 進來遊戲畫面後不會變，所以只在 create() 跟每次點擊後呼叫，不用放進 update()。
  _refreshAutoModeBtn() {
    const equipped = getEquipped();
    const hasRing = equipped.ring1 === 'ring_auto' || equipped.ring2 === 'ring_auto';
    this.autoModeBtn.setVisible(hasRing);
    this.autoModeBtnText.setVisible(hasRing);
    if (!hasRing) return;
    const auto = isLevelUpAutoMode();
    this.autoModeBtnText.setText(auto ? '選卡:全自動' : '選卡:半自動');
    this.autoModeBtn.setTint(auto ? 0xffe066 : 0xffffff);
  }

  // 按「返回主選單」先跳確認彈窗，暫停遊戲避免確認期間繼續受傷/死亡
  _showLeaveConfirm() {
    if (this.gs.gameEnded) return;
    this._leaveConfirmResumeAfter = !this.gs.paused;
    this.gs._confirmingLeave = true;
    this.gs.paused = true;
    this.gs.physics.world.pause();
    this.confirmOverlay.setVisible(true);
  }

  _cancelLeaveConfirm() {
    this.confirmOverlay.setVisible(false);
    this.gs._confirmingLeave = false;
    if (this._leaveConfirmResumeAfter) {
      this.gs.paused = false;
      this.gs.physics.world.resume();
      this.gs.player.clearBankedInput();
    }
  }

  // 確定離開：跟關掉分頁/正常死亡一樣，先把這局的擊殺金幣、關卡進度存起來，
  // 不讓玩家白打——重用 GameScene 掛在 beforeunload/pagehide 上的同一套存檔邏輯。
  _confirmLeave() {
    this.gs._saveOnExit();
    ['LevelUpScene', 'RelicChoiceScene', 'StartSkillScene'].forEach((key) => {
      if (this.scene.isActive(key)) this.scene.stop(key);
    });
    this.scene.stop('GameScene');
    this.scene.start('MainMenuScene');
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

    if (this.gs.woofWarMode) {
      // 汪汪大作戰：正上方改顯示倒數計時，不顯示一般模式的關卡進度
      const remainMs = Math.max(0, (this.gs._woofWarEndAt || 0) - this.gs.time.now);
      const mm = String(Math.floor(remainMs / 60000)).padStart(2, '0');
      const ss = String(Math.floor((remainMs % 60000) / 1000)).padStart(2, '0');
      this.stageText.setText(`⏱ ${mm}:${ss}`);
      this.stageText.setColor(remainMs <= 10000 ? '#ff4d4d' : '#ffb84d');
    } else {
      const stage = this.gs.getStage();
      const isBossStage = this.gs.isBossStage(stage);
      // 魔王關顯示「打死魔王才能過關」的提示；一般關顯示擊殺進度（目前/500），
      // 讓玩家看得出關卡是靠擊殺數推進的，不用自己去猜門檻在哪
      this.stageText.setText(isBossStage
        ? `💀 第 ${stage} 關（擊敗魔王）`
        : `第 ${stage} 關（${this.gs.stageKillCount}/500）`);
      this.stageText.setColor(isBossStage ? '#ff4d4d' : '#ffffff');
    }

    // 魔王血條：魔王在場才顯示，同步名稱、血量比例與數字
    const boss = this.gs.boss;
    const bossVisible = !!(boss && boss.alive);
    this.bossLabel.setVisible(bossVisible);
    this.bossBarBg.setVisible(bossVisible);
    this.bossBarFill.setVisible(bossVisible);
    this.bossHpText.setVisible(bossVisible);
    if (bossVisible) {
      this.bossLabel.setText(boss.typeDef.name).setColor(boss.typeDef.labelColor);
      const bossRatio = Math.max(0, boss.hp / boss.maxHp);
      this.bossBarFill.setDisplaySize(580 * bossRatio, 30);
      this.bossHpText.setText(`${Math.ceil(Math.max(0, boss.hp))} / ${Math.round(boss.maxHp)}`);
    }

    if (this.gs.woofWarMode) {
      // 右上角改顯示「對汪汪造成的總傷害」，取代擊殺數／存活時間（活動沒有小怪可殺）
      const dmg = Math.round((boss && boss.totalDamageTaken) || 0);
      this.killText.setText(`⚔ 造成傷害 ${dmg}`);
      this.timeText.setText('');
    } else {
      this.killText.setText(`💀 擊殺 ${this.gs.killCount}`);
      const elapsed = this.gs.getElapsedSeconds();
      const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const ss = String(elapsed % 60).padStart(2, '0');
      this.timeText.setText(`⏱ ${mm}:${ss}`);
    }
    this.fpsText.setText(`FPS ${Math.round(this.game.loop.actualFps)}`);

    STAT_DEFS.forEach((def) => {
      this.statChips[def.key].setText(`${def.label} ${def.get(p)}`);
    });
    this._refreshSetBonusText();
    PASSIVE_IDS.forEach((id) => {
      const lvl = this.gs.player.passiveLevels[id] || 0;
      this.passiveChips[id].setText(`${PASSIVE_DATA[id].name} Lv${lvl}`);
    });

    this._refreshWeaponPanel();
    this._refreshShadowPanel();
    this._updatePickupArrows();
  }

  // 傳說套裝效果：每幀都重算，不快取——GameScene 是同一個場景實例跨對局重複使用
  // （scene.launch／scene.start 不會重新 new 一個 GameScene），沒辦法用「算過一次
  // 就跳過」的旗標判斷是不是新的一局，用旗標反而會在下一局沿用上一局的舊資料。
  // 只是比對幾個布林值、組幾行字，開銷小到可以忽略，不需要額外快取機制。
  _refreshSetBonusText() {
    if (!this.gs.setBonuses) return;
    const sb = this.gs.setBonuses;
    const lines = [];
    Object.keys(LEGENDARY_SET_BONUS_TEXT).forEach((slug) => {
      const def = LEGENDARY_SET_BONUS_TEXT[slug];
      if (sb[`${slug}3`]) lines.push(`✅ ${def.label} 3件\n${def.three}`);
      if (sb[`${slug}5`]) lines.push(`✅ ${def.label} 5件\n${def.five}`);
    });
    const active = lines.length > 0;
    this.setBonusText.setVisible(active).setText(lines.join('\n\n'));
    this.setBonusPlaceholder.setVisible(!active);
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
  //
  // 重要修正：這裡原本用 `cam.midPoint` 當作畫面中心點，但箭頭一直固定指向左上方，
  // 代表 `cam.midPoint` 並沒有正確反映鏡頭實際跟隨玩家後的中心位置。
  // 鏡頭本來就是跟著玩家跑的（`startFollow`），玩家座標本身就等於畫面中心，
  // 改成直接用 `player.x/y` 計算，簡單又保證正確。
  _nearestOffscreen(system, player, cam) {
    if (!system || !system.pool) return null;
    const halfW = cam.width / (2 * cam.zoom), halfH = cam.height / (2 * cam.zoom);
    const margin = 40; // 留一點邊界，避免物件才剛超出畫面邊緣就急著顯示箭頭
    let best = null, bestDist = Infinity;
    system.pool.forEachActive((obj) => {
      const dx = obj.x - player.x, dy = obj.y - player.y;
      const onScreen = Math.abs(dx) < halfW - margin && Math.abs(dy) < halfH - margin;
      if (onScreen) return;
      const d = Math.hypot(dx, dy);
      if (d < bestDist) { bestDist = d; best = obj; }
    });
    return best ? { x: best.x, y: best.y } : null;
  }

  // 把箭頭放在畫面邊緣、朝著目標方向；沒有目標就隱藏
  _pointArrowAt(arrowImg, target) {
    if (!target) { arrowImg.setVisible(false); return; }
    const w = this.scale.width, h = this.scale.height;
    const cx = w / 2, cy = h / 2;
    const p = this.gs.player.sprite;
    const dx = target.x - p.x, dy = target.y - p.y;
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

  // 建立暗影君王套裝面板的所有元素（背景/標題/兩列數字/兩個召喚按鈕），全部包進
  // 一個 container 方便一次 setVisible 開關（沒湊到 3 件套時整組隱藏，見 update()）。
  _buildShadowPanel() {
    const panelX = 250, panelTop = 190, panelW = 400, panelH = 190;
    this.shadowPanel = this.add.container(0, 0).setScrollFactor(0).setDepth(50);

    const bg = this.add.image(panelX, panelTop, 'ui_panel')
      .setOrigin(0.5, 0).setDisplaySize(panelW, panelH).setDepth(-1);
    const title = this.add.text(panelX, panelTop + 14, '⚔ 暗影君王套裝', textStyle({
      fontSize: '24px', color: '#c68fff', fontStyle: 'bold',
    })).setOrigin(0.5, 0);
    const divider = this.add.rectangle(panelX, panelTop + 46, panelW - 36, 2, 0xc68fff, 0.4);

    // 每一列：圓形色塊當圖示（不用額外準備材質）＋標籤＋大字級數字＋召喚按鈕
    const rowY = [panelTop + 90, panelTop + 146];
    const labels = ['小兵影子', '魔王影子'];
    this.shadowCountTexts = [];
    this.shadowBtns = [];
    labels.forEach((label, i) => {
      const y = rowY[i];
      const dot = this.add.circle(panelX - panelW / 2 + 34, y, 15, 0x6a3fa0).setStrokeStyle(2, 0xc68fff);
      this.add.text(panelX - panelW / 2 + 62, y, label, textStyle({
        fontSize: '20px', color: '#e8d6ff',
      })).setOrigin(0, 0.5);
      // 數字視覺效果要大：36px + 描邊，明顯比其他 UI 格的數字（22px 上下）大上一截
      const countText = this.add.text(panelX + 30, y, '0', textStyle({
        fontSize: '36px', color: '#ffffff', fontStyle: 'bold', stroke: '#4a1f7a', strokeThickness: 5,
      })).setOrigin(0.5);
      this.shadowCountTexts.push(countText);

      const btn = this.add.image(panelX + panelW / 2 - 60, y, 'ui_button_parchment')
        .setDisplaySize(96, 42).setInteractive({ useHandCursor: true });
      const btnText = this.add.text(panelX + panelW / 2 - 60, y, '召喚', textStyle({
        fontSize: '20px', color: '#3a2413',
      })).setOrigin(0.5);
      btn.on('pointerover', () => btn.setTint(0xfff3d0));
      btn.on('pointerout', () => btn.clearTint());
      btn.on('pointerdown', () => this._onSummonShadow(i === 0 ? 'minion' : 'boss'));
      this.shadowBtns.push(btn);

      this.shadowPanel.add([dot, btn, btnText, countText]);
    });
    this.shadowPanel.add([bg, title, divider]);
    this.shadowPanel.setVisible(false);
  }

  // 每幀同步兩個數字；只有裝備滿 3 件暗影君王套裝時才顯示整組面板。
  _refreshShadowPanel() {
    const setBonuses = this.gs.setBonuses;
    const visible = !!(setBonuses && setBonuses.shadow3);
    this.shadowPanel.setVisible(visible);
    if (!visible) return;
    this.shadowCountTexts[0].setText(String(this.gs.shadowMinionCount || 0));
    this.shadowCountTexts[1].setText(String(this.gs.shadowBossCount || 0));
  }

  // 點下召喚按鈕：小兵影子跟魔王影子召喚出來的是同一種影子盟友（見
  // ShadowAllySystem.spawn()），差別只在消耗哪個貨幣池、以及一次召喚的數量——
  // 小兵影子比較好取得（5% 機率），一次最多召 100 隻，數量不夠 100 就有多少召多少
  // （不是「不滿 100 就不能召」）；魔王影子比較稀有，一次固定召 1 隻、消耗 1 個。
  _onSummonShadow(kind) {
    const key = kind === 'minion' ? 'shadowMinionCount' : 'shadowBossCount';
    const available = this.gs[key] || 0;
    if (available <= 0) return;
    const count = kind === 'minion' ? Math.min(100, available) : 1;
    this.gs[key] -= count;
    for (let i = 0; i < count; i++) this.gs.shadowAllySystem.spawn();
    this.announceShadowRise();
  }

  // 召喚瞬間的畫面正中央提示：黑色粗體「起來吧」+ 紫色底板，比照
  // showWoofWarStartBanner() 的淡入停留淡出寫法。
  announceShadowRise() {
    const w = this.scale.width, h = this.scale.height;
    const text = this.add.text(w / 2, h / 2, '起來吧', textStyle({
      fontSize: '64px', color: '#000000', fontStyle: 'bold', stroke: '#c68fff', strokeThickness: 8,
    })).setOrigin(0.5).setScrollFactor(0).setDepth(60001).setAlpha(0);
    const bg = this.add.rectangle(w / 2, h / 2, text.width + 90, text.height + 40, 0x2a1533, 0.8)
      .setStrokeStyle(3, 0xc68fff, 0.9).setScrollFactor(0).setDepth(60000).setAlpha(0);
    this.tweens.add({
      targets: [text, bg], alpha: 1, duration: 200,
      onComplete: () => {
        this.tweens.add({
          targets: [text, bg], alpha: 0, duration: 500, delay: 700,
          onComplete: () => { text.destroy(); bg.destroy(); },
        });
      },
    });
  }

  _refreshWeaponPanel() {
    const ws = this.gs.weaponSystem;
    const owned = ws.owned;
    const keys = Object.keys(owned);
    const stateStr = keys.map(k => k + owned[k] + (ws.isEvolved(k) ? 'E' : '')).join(',');
    if (this._lastKeyStr === stateStr) return;
    this._lastKeyStr = stateStr;

    // 面板高度依技能數量自動調整，讓「技能」框永遠剛好包住目前所有武器
    // 2026-07-11：rowH 88→56、iconSize 60→44，收緊行距讓文字比例更明顯，
    // 不再留一大片空白（見上面 create() 裡 PANEL_W／panelX 的同步調整）。
    const rowH = 56;
    const rows = Math.max(keys.length, 1);
    const panelH = this._titleH + rows * rowH + 16;
    this.weaponPanelBg.setDisplaySize(this._panelW, panelH);

    this.weaponPanel.removeAll(true);
    const iconSize = 44; // 統一圖示顯示大小；不用 setScale 直接放大原始材質，
                          // 否則等級越高（材質本身越大）圖示會越畫越大，容易超出框外
    keys.forEach((id, i) => {
      // 每一列的圖示改成「垂直置中在該列的區塊內」，而不是貼在列的最上緣——
      // 原本第一列圖示的中心點剛好卡在標題分隔線的位置，導致圖示上半部整個超出面板框，
      // 疊到「技能」標題那一行去了。
      const y = i * rowH + rowH / 2;
      const evolved = ws.isEvolved(id);
      const fusion = WEAPON_FUSIONS[id];
      const iconKey = fusion ? fusion.icon : `weapon_${id}_lv${owned[id]}`;
      const icon = this.add.image(-58, y, iconKey).setDisplaySize(iconSize, iconSize);
      if (evolved) icon.setTint(0xffe066);
      else if (fusion) icon.setTint(0xff9de0);
      const labelStr = evolved ? `⭐${WEAPON_EVOLUTIONS[id].name}`
        : fusion ? `🔥${fusion.name}`
        : `${WEAPON_DATA[id].name} Lv${owned[id]}`;
      const label = this.add.text(-14, y, labelStr, textStyle({
        fontSize: '22px', color: evolved ? '#ffe066' : fusion ? '#ff9de0' : '#fff',
      })).setOrigin(0, 0.5);
      this.weaponPanel.add([icon, label]);
    });
  }

  // ================= 汪汪大作戰：結果視窗 =================
  // 時間到（或汪汪意外被打死）由 GameScene._endWoofWarChallenge() 呼叫。規格明確
  // 要求「不要顯示獎勵預覽」，只顯示本次傷害＋目前排名；排名讀 TOP10 排行榜比對
  // 玩家名字，找不到（沒進前10）就顯示「10名外」，不特別去查真實名次。
  showWoofWarResult(totalDamage) {
    if (!this.woofWarResultOverlay) this._buildWoofWarResultOverlay();
    this.woofWarDamageText.setText(`本次傷害：${totalDamage}`);
    this.woofWarRankText.setText('排名讀取中...');
    this.woofWarResultOverlay.setVisible(true);

    const name = getPlayerName() || '冒險者';
    const unsub = subscribeWoofWarLeaderboard((rows) => {
      const idx = rows.findIndex((r) => r.name === name);
      this.woofWarRankText.setText(idx >= 0 ? `目前排名：第 ${idx + 1} 名` : '目前排名：10 名外');
      if (unsub) unsub();
    });
  }

  // 汪汪大作戰開場文字：由 GameScene._beginWoofWarBattle() 呼叫。畫在 UIScene
  // 而不是 GameScene，是因為 GameScene 鏡頭有 2.1 倍縮放、而且是先掛載的底層，
  // UIScene 這個無縮放疊加層永遠畫在它上面——直接畫在 GameScene 裡會被 UIScene
  // 右側的技能面板擋住一部分。固定貼在畫面最上緣（不是螢幕正中央），深度給到
  // 60000，比 UIScene 自己其他任何元素都高，保證不會被任何東西擋住。
  showWoofWarStartBanner() {
    const w = this.scale.width;
    const y = 18;
    const text = this.add.text(w / 2, y, '⚠ 汪汪大作戰開始！盡全力輸出傷害吧！ ⚠', textStyle({
      fontSize: '36px', color: '#ffb84d', fontStyle: 'bold', stroke: '#000000', strokeThickness: 7,
    })).setOrigin(0.5, 0).setScrollFactor(0).setDepth(60000);
    const bg = this.add.rectangle(w / 2, y + text.height / 2, text.width + 70, text.height + 20, 0x0a0e16, 0.72)
      .setScrollFactor(0).setDepth(59999);
    this.tweens.add({
      targets: [text, bg], alpha: 0, duration: 700, delay: 1800,
      onComplete: () => { text.destroy(); bg.destroy(); },
    });
  }

  _buildWoofWarResultOverlay() {
    const w = this.scale.width, h = this.scale.height;
    const overlay = this.add.container(0, 0).setScrollFactor(0).setDepth(50200).setVisible(false);
    const dim = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.75).setInteractive();
    const panelW = 560, panelH = 340;
    const panel = this.add.image(w / 2, h / 2, 'ui_panel').setDisplaySize(panelW, panelH);
    const border = this.add.rectangle(w / 2, h / 2, panelW - 6, panelH - 6).setStrokeStyle(3, 0xffb84d, 0.8).setFillStyle(0, 0);
    const title = this.add.text(w / 2, h / 2 - panelH / 2 + 46, '⚔ 汪汪大作戰結束 ⚔', textStyle({
      fontSize: '32px', color: '#ffb84d', fontStyle: 'bold',
    })).setOrigin(0.5);
    this.woofWarDamageText = this.add.text(w / 2, h / 2 - 30, '', textStyle({
      fontSize: '30px', color: '#ffffff',
    })).setOrigin(0.5);
    this.woofWarRankText = this.add.text(w / 2, h / 2 + 20, '', textStyle({
      fontSize: '26px', color: '#6fd3ff',
    })).setOrigin(0.5);

    const retryBtn = this.add.image(w / 2 - 120, h / 2 + panelH / 2 - 50, 'ui_button_parchment')
      .setDisplaySize(200, 62).setInteractive({ useHandCursor: true });
    const retryText = this.add.text(w / 2 - 120, h / 2 + panelH / 2 - 50, '再次挑戰', textStyle({
      fontSize: '24px', color: '#3a2413',
    })).setOrigin(0.5);
    const exitBtn = this.add.image(w / 2 + 120, h / 2 + panelH / 2 - 50, 'ui_button_parchment')
      .setDisplaySize(200, 62).setInteractive({ useHandCursor: true });
    const exitText = this.add.text(w / 2 + 120, h / 2 + panelH / 2 - 50, '返回主選單', textStyle({
      fontSize: '24px', color: '#3a2413',
    })).setOrigin(0.5);
    retryBtn.on('pointerover', () => retryBtn.setTint(0xfff3d0));
    retryBtn.on('pointerout', () => retryBtn.clearTint());
    retryBtn.on('pointerdown', () => {
      this.woofWarResultOverlay.setVisible(false);
      this.gs.restartWoofWarChallenge();
    });
    exitBtn.on('pointerover', () => exitBtn.setTint(0xfff3d0));
    exitBtn.on('pointerout', () => exitBtn.clearTint());
    exitBtn.on('pointerdown', () => {
      this.scene.stop('GameScene');
      this.scene.start('MainMenuScene');
    });

    overlay.add([dim, panel, border, title, this.woofWarDamageText, this.woofWarRankText, retryBtn, retryText, exitBtn, exitText]);
    this.woofWarResultOverlay = overlay;
  }
}
