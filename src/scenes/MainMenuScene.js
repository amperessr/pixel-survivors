import { promptPlayerName, getCheckpointStage, getPlayerName, logout, getStatLevel } from '../managers/SaveManager.js';
import { subscribeLeaderboard } from '../firebase/firebase.js';
import { textStyle } from '../utils/TextStyle.js';

// 主選單：初始角色固定為「平衡型」，不再需要選角，
// 改成「背包／商店／開始遊戲」三個入口（GameScene 沒帶 characterId 時預設就是 balanced）。
export default class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenuScene'); }

  async create() {
    const w = this.scale.width, h = this.scale.height;

    // 背景改成玩家提供的封面美術圖（見 BootScene.preload() 載入的 'menu_bg'）
    this.add.image(w / 2, h / 2, 'menu_bg').setDisplaySize(w, h);

    // 背景圖本身很豐富（天空、村莊、瀑布都有內容），中間這一整欄的文字/按鈕
    // 疊一塊半透明深色底板上去，不管背景細節長怎樣，文字跟按鈕都保證看得清楚。
    this.add.rectangle(w / 2, 515, 660, 900, 0x0a0e16, 0.55).setDepth(-1);

    // 標題招牌：深色橫幅 + 金色描邊粗體大字 + 下方小字英文名，讓標題在豐富的
    // 背景美術圖上還是能一眼跳出來，看起來像正式的遊戲標題招牌，而不是隨手疊上去的文字。
    this.add.rectangle(w / 2, 100, 860, 150, 0x0a0e16, 0.55).setStrokeStyle(3, 0xffe066, 0.6);
    this.add.text(w / 2, 68, '像素求生', textStyle({
      fontSize: '80px', color: '#ffe066', stroke: '#3a2413', strokeThickness: 10,
      shadow: { offsetX: 0, offsetY: 4, color: '#000000', blur: 10, fill: true },
    })).setOrigin(0.5);
    this.add.text(w / 2, 136, 'P I X E L   S U R V I V O R S', textStyle({
      fontSize: '26px', color: '#ffffff', stroke: '#3a2413', strokeThickness: 4,
    })).setOrigin(0.5);

    await promptPlayerName();

    this.add.image(w / 2, 340, 'player_balanced').setScale(2.4);

    // 存檔點：每 5 關會記錄一次目前最高關卡（見 GameScene._update()）。
    // 「開始遊戲」有兩個選項：從存檔點當前關卡開始，或從第一關重新開始。
    // 兩個選項都要在按鈕正上方標出實際的關卡數字。
    const checkpointStage = getCheckpointStage();

    const btnW = 420, btnH = 88, gap = 24;
    const items = [
      { label: '背包', onPick: () => this.scene.start('InventoryScene') },
      { label: '商店', onPick: () => this.scene.start('ShopScene') },
      {
        label: '當前關卡', stageLabel: `第 ${checkpointStage} 關`,
        // 除錯用：暫時印出玩家實際點了哪顆按鈕，方便排查「點第一關卻從別的關卡開始」的問題，
        // 之後確認沒問題了可以把這行 console.log 拿掉。
        onPick: () => { console.log(`[STAGE] 點了「當前關卡」，checkpointStage=${checkpointStage}`); this.scene.start('GameScene', { startStage: checkpointStage }); },
      },
      {
        label: '第一關', stageLabel: `第 1 關`,
        onPick: () => { console.log('[STAGE] 點了「第一關」，startStage=1'); this.scene.start('GameScene', { startStage: 1 }); },
      },
    ];
    // 按鈕區塊改用固定像素起點（不再用畫面高度百分比推算），確保上方角色圖片不會
    // 跟按鈕擠在一起重疊。關卡數字改成直接畫在按鈕本體裡（跟按鈕文字同一顆按鈕、
    // 分兩行顯示），而不是按鈕外部的浮動文字——不然會被上一顆按鈕的底部擋住一部分。
    let cy = 560;

    items.forEach((item) => {
      const btn = this.add.image(w / 2, cy, 'ui_button_parchment').setDisplaySize(btnW, btnH).setInteractive({ useHandCursor: true });
      if (item.stageLabel) {
        this.add.text(w / 2, cy - 15, item.label, textStyle({
          fontSize: '30px', color: '#3a2413',
        })).setOrigin(0.5);
        this.add.text(w / 2, cy + 20, item.stageLabel, textStyle({
          fontSize: '19px', color: '#6b4423',
        })).setOrigin(0.5);
      } else {
        this.add.text(w / 2, cy, item.label, textStyle({
          fontSize: '38px', color: '#3a2413',
        })).setOrigin(0.5);
      }
      btn.on('pointerover', () => btn.setTint(0xfff3d0));
      btn.on('pointerout', () => btn.clearTint());
      btn.on('pointerdown', item.onPick);
      cy += btnH + gap;
    });

    this.add.rectangle(w / 2, h - 50, 760, 44, 0x0a0e16, 0.55);
    this.add.text(w / 2, h - 50, '操作：WASD 移動／自動鎖定攻擊／SPACE 衝刺／ESC 暫停', textStyle({
      fontSize: '26px', color: '#cfcfcf',
    })).setOrigin(0.5);

    // ---- 左下角：目前登入的名字 + 登出按鈕 ----
    // 同一台裝置登入過一次之後，往後開遊戲都會直接沿用（見 SaveManager.promptPlayerName()
    // 的「靜默背景同步」邏輯），不會每次都跳密碼輸入視窗；要換帳號的話按這顆登出鍵，
    // 才會清掉本機快取的登入狀態，下次開遊戲重新跳出名字/密碼視窗。
    // 永久等級（跟進遊戲後那場戰鬥的等級是兩回事）跟著登入名稱一起顯示，
    // 不用另外占一整行版面。
    this.add.text(120, h - 76, `已登入：${getPlayerName() || '???'}　Lv.${getStatLevel()}`, textStyle({
      fontSize: '18px', color: '#9fd3ff',
    })).setOrigin(0.5);
    const logoutBtn = this.add.image(120, h - 40, 'ui_button_parchment').setDisplaySize(170, 46).setInteractive({ useHandCursor: true });
    this.add.text(120, h - 40, '登出', textStyle({ fontSize: '22px', color: '#3a2413' })).setOrigin(0.5);
    logoutBtn.on('pointerover', () => logoutBtn.setTint(0xff9a9a));
    logoutBtn.on('pointerout', () => logoutBtn.clearTint());
    logoutBtn.on('pointerdown', () => logout());

    // ---- 右側：排行榜 + 更新日誌，各自用面板框起來 ----
    const rightX = w - 260;
    const panelW = 480;

    const lbPanelY = h * 0.24;
    const lbPanelH = 340;
    this.add.image(rightX, lbPanelY, 'ui_panel').setDisplaySize(panelW, lbPanelH);
    this.add.rectangle(rightX, lbPanelY, panelW - 6, lbPanelH - 6).setStrokeStyle(3, 0x6fd3ff, 0.7).setFillStyle(0, 0);
    this.add.text(rightX, lbPanelY - lbPanelH / 2 + 28, '🏆 排行榜 TOP10', textStyle({
      fontSize: '26px', color: '#ffd93d',
    })).setOrigin(0.5);
    this.add.rectangle(rightX, lbPanelY - lbPanelH / 2 + 52, panelW - 60, 2, 0x6fd3ff, 0.4);
    this.lbText = this.add.text(rightX, lbPanelY - lbPanelH / 2 + 68, '讀取排行榜中...', textStyle({
      fontSize: '21px', color: '#cfe9ff', align: 'center', lineSpacing: 7,
    })).setOrigin(0.5, 0);

    // 更新日誌：簡單列出近期幾項重點更新，方便玩家知道遊戲還在持續開發（新的排在上面）
    const CHANGELOG = [
      '🆕 新增永久等級系統，升級可投資爆擊率',
      '🆕 新增帳號密碼系統，跨裝置同步存檔進度',
      '🆕 五魔王輪流登場，各有專屬技能與外觀',
      '🎨 玩家角色、冰霜技能換成正式美術圖',
      '🆕 新增裝備系統：武器/頭盔/衣服/褲子/鞋子/戒指',
      '🆕 新增背包與商店，擊殺數可換金幣購買裝備',
      '🆕 新增遺物系統：擊敗魔王可獲得永久強化',
    ];
    const logPanelH = 320;
    const logPanelY = lbPanelY + lbPanelH / 2 + 30 + logPanelH / 2;
    this.add.image(rightX, logPanelY, 'ui_panel').setDisplaySize(panelW, logPanelH);
    this.add.rectangle(rightX, logPanelY, panelW - 6, logPanelH - 6).setStrokeStyle(3, 0xffe066, 0.7).setFillStyle(0, 0);
    this.add.text(rightX, logPanelY - logPanelH / 2 + 28, '📜 更新日誌', textStyle({
      fontSize: '26px', color: '#ffe066',
    })).setOrigin(0.5);
    this.add.rectangle(rightX, logPanelY - logPanelH / 2 + 52, panelW - 60, 2, 0xffe066, 0.4);
    this.add.text(rightX, logPanelY - logPanelH / 2 + 68, CHANGELOG.join('\n'), textStyle({
      fontSize: '19px', color: '#e6e6e6', align: 'left', lineSpacing: 12,
      wordWrap: { width: panelW - 60, useAdvancedWrap: true },
    })).setOrigin(0.5, 0);

    this._unsubLeaderboard = subscribeLeaderboard((rows) => {
      if (!this.lbText || !this.lbText.active) return;
      const lines = rows.slice(0, 10).map((r, i) => `${i + 1}. ${r.name || '???'}  —  ${r.score || 0}`);
      this.lbText.setText(lines.length ? lines.join('\n') : '目前尚無紀錄');
    });
    this.events.once('shutdown', () => {
      if (this._unsubLeaderboard) this._unsubLeaderboard();
    });
  }
}
