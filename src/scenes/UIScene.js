import { WEAPON_DATA, WEAPON_EVOLUTIONS, WEAPON_FUSIONS } from '../weapons/WeaponData.js';
import { EQUIP_SLOTS, RING_SLOTS, EQUIPMENT_DATA } from '../equipment/EquipmentData.js';
import { PASSIVE_IDS, PASSIVE_DATA } from '../skills/PassiveData.js';
import { getEquipped, isLevelUpAutoMode, setLevelUpAutoMode } from '../managers/SaveManager.js';
import { audioManager } from '../managers/AudioManager.js';
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

    // ---- 下方：狀態列，分成「數值／裝備／技能」三大塊，各自 3 欄 x 2 列 ----
    // 整塊狀態列的文字/圖示原本偏小，跟這麼寬的底板不成比例，這裡統一放大
    // （底板本身也加高一點，才裝得下放大後的內容，不會擠在一起）。
    const bottomBarH = 230;
    const bottomBarY = h - bottomBarH / 2 - 10;
    const barLeft = 30, barWidth = w - 60;
    this.add.image(w / 2, bottomBarY, 'ui_panel').setDisplaySize(barWidth, bottomBarH).setScrollFactor(0).setDepth(-1);

    const colW = barWidth / 3;
    const col1CenterX = barLeft + colW * 0.5; // 數值
    const col2CenterX = barLeft + colW * 1.5; // 裝備
    const col3CenterX = barLeft + colW * 2.5; // 技能

    const titleY = bottomBarY - bottomBarH / 2 + 28;
    const gridTopY = bottomBarY - bottomBarH / 2 + 82;
    const rowGap = 86;

    this.add.text(col1CenterX, titleY, '數值', textStyle({ fontSize: '28px', color: '#cfe9ff' })).setOrigin(0.5).setScrollFactor(0);
    this.add.text(col2CenterX, titleY, '裝備', textStyle({ fontSize: '28px', color: '#ffe066' })).setOrigin(0.5).setScrollFactor(0);
    this.add.text(col3CenterX, titleY, '技能', textStyle({ fontSize: '28px', color: '#6fd3ff' })).setOrigin(0.5).setScrollFactor(0);

    // 直向分隔線，讓三大塊視覺上更清楚地分開
    this.add.rectangle(barLeft + colW, bottomBarY, 2, bottomBarH - 24, 0xffffff, 0.12).setScrollFactor(0);
    this.add.rectangle(barLeft + colW * 2, bottomBarY, 2, bottomBarH - 24, 0xffffff, 0.12).setScrollFactor(0);

    // 通用排版：給定該欄中心 X，回傳「上面三個、下面三個」共 6 個格子的座標
    const cellPositions = (colCenterX) => {
      const xs = [colCenterX - colW * 0.3, colCenterX, colCenterX + colW * 0.3];
      const ys = [gridTopY, gridTopY + rowGap];
      const pos = [];
      ys.forEach((y) => xs.forEach((x) => pos.push({ x, y })));
      return pos; // [row0-col0, row0-col1, row0-col2, row1-col0, row1-col1, row1-col2]
    };

    // ---------- 左：數值（6 個，STAT_DEFS 剛好 6 項，滿版 3x2）----------
    const statPos = cellPositions(col1CenterX);
    this.statChips = {};
    STAT_DEFS.forEach((def, i) => {
      const { x, y } = statPos[i];
      this.add.image(x - 44, y, def.icon).setScale(1.6).setScrollFactor(0);
      const valueText = this.add.text(x - 20, y, '', textStyle({
        fontSize: '22px', color: def.color,
      })).setOrigin(0, 0.5).setScrollFactor(0);
      this.statChips[def.key] = valueText;
    });

    // ---------- 中：裝備（5 個裝備欄 + 第 6 格擠進兩個戒指小欄位）----------
    const equipPos = cellPositions(col2CenterX);
    const equipped = getEquipped();
    EQUIP_SLOTS.forEach((slot, i) => {
      const { x, y } = equipPos[i];
      const itemId = equipped[slot];
      const slotBg = this.add.image(x, y, 'ui_equip_slot').setDisplaySize(66, 66).setScrollFactor(0);
      if (itemId && EQUIPMENT_DATA[itemId]) {
        // 圖示現在是 128x128 的正式美術圖（取代舊的 48x48 程式產生貼圖），縮放倍率
        // 等比例縮小，維持跟改版前一樣的實際顯示大小。
        this.add.image(x, y, EQUIPMENT_DATA[itemId].icon).setScale(0.394).setScrollFactor(0);
      } else {
        slotBg.setAlpha(0.35);
      }
    });
    {
      // 第 6 格改成兩個戒指小欄位並排（戒指目前只能從扭蛋機取得，扭蛋機制還沒
      // 實作，所以這兩格暫時一定是空的，但一旦拿到戒指就會直接顯示圖示）。
      const { x, y } = equipPos[5];
      RING_SLOTS.forEach((slot, i) => {
        const rx = x + (i === 0 ? -18 : 18);
        const itemId = equipped[slot];
        const ringBg = this.add.image(rx, y, 'ui_equip_slot').setDisplaySize(30, 30).setScrollFactor(0);
        if (itemId && EQUIPMENT_DATA[itemId]) {
          this.add.image(rx, y, EQUIPMENT_DATA[itemId].icon).setScale(0.18).setScrollFactor(0);
        } else {
          ringBg.setAlpha(0.3);
        }
      });
    }

    // ---------- 右：技能（5 個被動 + 1 個保留格；武器已經在右上角的技能面板顯示過，
    // 這裡改顯示被動等級，避免跟上面重複）----------
    const skillPos = cellPositions(col3CenterX);
    this.passiveChips = {};
    PASSIVE_IDS.forEach((id, i) => {
      const { x, y } = skillPos[i];
      this.add.image(x - 36, y, PASSIVE_DATA[id].icon).setScale(1.6).setScrollFactor(0);
      const lvText = this.add.text(x - 12, y, '', textStyle({
        fontSize: '22px', color: '#cfe9ff',
      })).setOrigin(0, 0.5).setScrollFactor(0);
      this.passiveChips[id] = lvText;
    });
    {
      const { x, y } = skillPos[5];
      this.add.image(x, y, 'ui_equip_slot').setDisplaySize(58, 58).setAlpha(0.15).setScrollFactor(0);
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

    const stage = this.gs.getStage();
    const isBossStage = this.gs.isBossStage(stage);
    // 魔王關顯示「打死魔王才能過關」的提示；一般關顯示擊殺進度（目前/500），
    // 讓玩家看得出關卡是靠擊殺數推進的，不用自己去猜門檻在哪
    this.stageText.setText(isBossStage
      ? `💀 第 ${stage} 關（擊敗魔王）`
      : `第 ${stage} 關（${this.gs.stageKillCount}/500）`);
    this.stageText.setColor(isBossStage ? '#ff4d4d' : '#ffffff');
    this.killText.setText(`💀 擊殺 ${this.gs.killCount}`);
    const elapsed = this.gs.getElapsedSeconds();
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    this.timeText.setText(`⏱ ${mm}:${ss}`);
    this.fpsText.setText(`FPS ${Math.round(this.game.loop.actualFps)}`);

    STAT_DEFS.forEach((def) => {
      this.statChips[def.key].setText(`${def.label} ${def.get(p)}`);
    });
    PASSIVE_IDS.forEach((id) => {
      const lvl = this.gs.player.passiveLevels[id] || 0;
      this.passiveChips[id].setText(`${PASSIVE_DATA[id].name.slice(0, 2)} Lv${lvl}`);
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
      const fusion = WEAPON_FUSIONS[id];
      const iconKey = fusion ? fusion.icon : `weapon_${id}_lv${owned[id]}`;
      const icon = this.add.image(-60, y, iconKey).setDisplaySize(iconSize, iconSize);
      if (evolved) icon.setTint(0xffe066);
      else if (fusion) icon.setTint(0xff9de0);
      const labelStr = evolved ? `⭐${WEAPON_EVOLUTIONS[id].name}`
        : fusion ? `🔥${fusion.name}`
        : `${WEAPON_DATA[id].name} Lv${owned[id]}`;
      const label = this.add.text(-10, y, labelStr, textStyle({
        fontSize: '24px', color: evolved ? '#ffe066' : fusion ? '#ff9de0' : '#fff',
      })).setOrigin(0, 0.5);
      this.weaponPanel.add([icon, label]);
    });
  }
}
