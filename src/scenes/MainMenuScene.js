import { promptPlayerName, getPlayerName, logout, getStatLevel, isMailClaimed, isMailDeleted, getWoofWarReward } from '../managers/SaveManager.js';
import { subscribeLeaderboard, subscribeWoofWarLeaderboard } from '../firebase/firebase.js';
import { textStyle } from '../utils/TextStyle.js';
import { MAIL_DATA } from '../mail/MailData.js';
import { getWoofWarEffectivePhase, formatWoofWarTime, WOOF_WAR_OPEN_AT, WOOF_WAR_CLOSE_LABEL } from '../activities/ActivityData.js';
import { resolveWoofWarRewardIfNeeded, WOOF_WAR_REWARD_MAIL_ID } from '../activities/WoofWarRewardSystem.js';

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

    // 汪汪大作戰活動結束後的個人獎勵結算：不 await，避免因為網路請求拖慢主選單
    // 開啟速度——結算完成後 mailStatus 面板的紅點跟信箱列表下次重新整理時自然會
    // 反映出來，不需要卡在這裡等結果（見 WoofWarRewardSystem.js）。
    resolveWoofWarRewardIfNeeded().catch((err) => {
      console.warn('[MainMenuScene] 汪汪大作戰獎勵結算失敗（可能離線）：', err.message);
    });

    this.add.image(w / 2, 340, 'player_balanced').setScale(2.4);

    const btnW = 420, btnH = 88, gap = 24;

    // ---- 快捷功能列：背包／商店／信箱，三個並排的小按鈕 ----
    // 信箱是給開發者手動發獎勵用的入口（見 MailboxScene／MailData.js），
    // 有還沒領取/刪除的信時右上角會冒出一個紅點提醒玩家去看——順便檢查一下
    // 汪汪大作戰的個人化結算信（見上面 resolveWoofWarRewardIfNeeded）。這裡讀的是
    // 「上一次」結算出的快取，剛結束活動、這台裝置第一次開主選單那一次還沒結算完，
    // 紅點會等下一次開主選單才出現，是可以接受的小延遲。
    const woofWarReward = getWoofWarReward();
    const hasUnclaimedWoofWarReward = !!(woofWarReward && woofWarReward.participated
      && !isMailClaimed(WOOF_WAR_REWARD_MAIL_ID) && !isMailDeleted(WOOF_WAR_REWARD_MAIL_ID));
    const hasUnreadMail = hasUnclaimedWoofWarReward
      || MAIL_DATA.some((m) => !isMailClaimed(m.id) && !isMailDeleted(m.id));
    const quickItems = [
      { label: '背包', onPick: () => this.scene.start('InventoryScene') },
      { label: '商店', onPick: () => this.scene.start('ShopScene') },
      { label: '信箱', onPick: () => this.scene.start('MailboxScene'), badge: hasUnreadMail },
    ];
    const quickBtnH = 70, quickGap = 16;
    const quickTotalW = quickItems.length * btnW / 3 + (quickItems.length - 1) * quickGap;
    let qx = w / 2 - quickTotalW / 2 + (btnW / 3) / 2;
    const quickY = 560;
    quickItems.forEach((item) => {
      const bw = btnW / 3;
      const btn = this.add.image(qx, quickY, 'ui_button_parchment').setDisplaySize(bw, quickBtnH).setInteractive({ useHandCursor: true });
      this.add.text(qx, quickY, item.label, textStyle({ fontSize: '26px', color: '#3a2413' })).setOrigin(0.5);
      if (item.badge) {
        this.add.circle(qx + bw / 2 - 14, quickY - quickBtnH / 2 + 14, 8, 0xff3b3b).setStrokeStyle(2, 0xffffff);
      }
      btn.on('pointerover', () => btn.setTint(0xfff3d0));
      btn.on('pointerout', () => btn.clearTint());
      btn.on('pointerdown', item.onPick);
      qx += bw + quickGap;
    });

    // ---- 開始遊戲：活動關卡／第一關，維持原本的直向大按鈕堆疊 ----
    // 「當前關卡」（從存檔點繼續）已移除，原本的位置改放「活動關卡」入口，
    // 目前活動是「汪汪大作戰」限時挑戰（見 GameScene 的 woofWarMode）。
    const items = [
      {
        label: '活動關卡', stageLabel: '汪汪大作戰',
        onPick: () => this.scene.start('ActivitySelectScene'),
      },
      {
        label: '第一關', stageLabel: `第 1 關`,
        onPick: () => { console.log('[STAGE] 點了「第一關」，startStage=1'); this.scene.start('GameScene', { startStage: 1 }); },
      },
    ];
    // 按鈕區塊改用固定像素起點（不再用畫面高度百分比推算），確保上方角色圖片不會
    // 跟按鈕擠在一起重疊。關卡數字改成直接畫在按鈕本體裡（跟按鈕文字同一顆按鈕、
    // 分兩行顯示），而不是按鈕外部的浮動文字——不然會被上一顆按鈕的底部擋住一部分。
    let cy = quickY + quickBtnH / 2 + gap + btnH / 2;

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

    // ---- 左右兩側：更新日誌（左）＋ 排行榜（右），各自用面板框起來、左右對稱 ----
    // 面板高度原本是寫死的數字，內容一多（例如排行榜真的湊滿 10 筆、更新日誌又加了
    // 新項目）就會超出面板框。改成先把內文文字排好量出實際高度，面板框跟著內容大小
    // 自動撐開。兩塊面板改成左右並排（而不是同一側上下疊），面板頂端對齊同一個高度。
    const rightX = w - 260;
    const leftX = w - rightX; // 跟排行榜以畫面中心鏡射對稱
    const panelW = 480;
    const HEADER_H = 68; // 標題文字＋分隔線，到內文開始畫的距離
    const BOTTOM_PAD = 24; // 內文結束到面板下緣的留白

    // 排行榜固定用 10 行的高度來量（TOP10 上限），不管當下實際筆數多少，
    // 面板大小都是一致的，不會因為排行榜資料還沒載入完就忽大忽小。
    const lbBodyStyle = { fontSize: '21px', color: '#cfe9ff', align: 'center', lineSpacing: 7 };
    const lbMeasure = this.add.text(0, 0, Array(10).fill('讀取排行榜中...').join('\n'), textStyle(lbBodyStyle)).setVisible(false);
    const lbBodyH = lbMeasure.height;
    lbMeasure.destroy();
    const lbPanelH = HEADER_H + lbBodyH + BOTTOM_PAD;
    const lbPanelTop = 170; // 面板頂端固定位置，不隨內容高度變動
    const lbPanelY = lbPanelTop + lbPanelH / 2;

    this.add.image(rightX, lbPanelY, 'ui_panel').setDisplaySize(panelW, lbPanelH);
    this.add.rectangle(rightX, lbPanelY, panelW - 6, lbPanelH - 6).setStrokeStyle(3, 0x6fd3ff, 0.7).setFillStyle(0, 0);
    this.add.text(rightX, lbPanelY - lbPanelH / 2 + 28, '🏆 排行榜 TOP10', textStyle({
      fontSize: '26px', color: '#ffd93d',
    })).setOrigin(0.5);
    this.add.rectangle(rightX, lbPanelY - lbPanelH / 2 + 52, panelW - 60, 2, 0x6fd3ff, 0.4);
    this.lbText = this.add.text(rightX, lbPanelY - lbPanelH / 2 + HEADER_H, '讀取排行榜中...', textStyle(lbBodyStyle)).setOrigin(0.5, 0);

    // 更新日誌：簡單列出近期幾項重點更新，方便玩家知道遊戲還在持續開發（新的排在上面）
    const CHANGELOG = [
      '📬 新增信箱功能，不定期會收到獎勵信',
      '🆕 新增武器融合系統：飛刀融合雷電/鋸片、火球融合冰霜，打造全新招式',
      '🆕 分數計算改用「抵達關卡數」，不再看存活時間',
      '🆕 魔王登場新增開場演出：警示字置中、開場 3 秒無法攻擊',
      '⚔ 小怪密度大幅提高，戰鬥更有爽感',
      '🆕 關卡改成擊殺數推進，魔王關要打贏魔王才能過關',
      '🎨 惡魔王美術圖更新、龍之翼位置校正',
      '🆕 新增永久等級系統，升級可投資爆擊率',
      '🆕 新增帳號密碼系統，跨裝置同步存檔進度',
      '🆕 五魔王輪流登場，各有專屬技能與外觀',
    ];
    const logBodyStyle = {
      fontSize: '19px', color: '#e6e6e6', align: 'left', lineSpacing: 12,
      wordWrap: { width: panelW - 60, useAdvancedWrap: true },
    };
    const logMeasure = this.add.text(0, 0, CHANGELOG.join('\n'), textStyle(logBodyStyle)).setVisible(false);
    const logBodyH = logMeasure.height;
    logMeasure.destroy();
    const logPanelH = HEADER_H + logBodyH + BOTTOM_PAD;
    const logPanelTop = 170; // 跟排行榜面板頂端對齊同一個高度（lbPanelTop），左右對稱
    const logPanelY = logPanelTop + logPanelH / 2;

    this.add.image(leftX, logPanelY, 'ui_panel').setDisplaySize(panelW, logPanelH);
    this.add.rectangle(leftX, logPanelY, panelW - 6, logPanelH - 6).setStrokeStyle(3, 0xffe066, 0.7).setFillStyle(0, 0);
    this.add.text(leftX, logPanelY - logPanelH / 2 + 28, '📜 更新日誌', textStyle({
      fontSize: '26px', color: '#ffe066',
    })).setOrigin(0.5);
    this.add.rectangle(leftX, logPanelY - logPanelH / 2 + 52, panelW - 60, 2, 0xffe066, 0.4);
    this.add.text(leftX, logPanelY - logPanelH / 2 + HEADER_H, CHANGELOG.join('\n'), textStyle(logBodyStyle)).setOrigin(0.5, 0);

    this._unsubLeaderboard = subscribeLeaderboard((rows) => {
      if (!this.lbText || !this.lbText.active) return;
      const lines = rows.slice(0, 10).map((r, i) => `${i + 1}. ${r.name || '???'}  —  ${r.score || 0}`);
      this.lbText.setText(lines.length ? lines.join('\n') : '目前尚無紀錄');
    });
    this.events.once('shutdown', () => {
      if (this._unsubLeaderboard) this._unsubLeaderboard();
    });

    // ---- 活動關卡排行 TOP5（汪汪大作戰傷害排行＋獎品）：疊在排行榜 TOP10 面板下方，
    // 開放前只顯示「開放時間」不接排行榜；開放後（含活動結束後）都接排行榜即時顯示，
    // 只是標題下面那行狀態文字換成「結束時間」或「活動已結束」。----
    const woofPhase = getWoofWarEffectivePhase(getPlayerName());
    const WOOF_PRIZES = ['🎁 自選神話裝備', '🎁 自選傳說裝備', '💰 10 萬金幣', '💰 3 萬金幣', '💰 3 萬金幣'];
    const activityBodyStyle = { fontSize: '19px', color: '#cfe9ff', align: 'center', lineSpacing: 9 };
    const activityMeasure = this.add.text(0, 0, Array(5).fill('讀取排行榜中...').join('\n'), textStyle(activityBodyStyle)).setVisible(false);
    const activityBodyH = activityMeasure.height;
    activityMeasure.destroy();
    const ACTIVITY_STATUS_ROW_H = 30; // 標題下面那行開放/結束時間狀態文字多佔的高度
    const activityPanelH = HEADER_H + ACTIVITY_STATUS_ROW_H + activityBodyH + BOTTOM_PAD;
    const activityPanelTop = lbPanelY + lbPanelH / 2 + 24; // 疊在排行榜 TOP10 面板下方，留一點間距
    const activityPanelY = activityPanelTop + activityPanelH / 2;

    this.add.image(rightX, activityPanelY, 'ui_panel').setDisplaySize(panelW, activityPanelH);
    this.add.rectangle(rightX, activityPanelY, panelW - 6, activityPanelH - 6).setStrokeStyle(3, 0xffb84d, 0.7).setFillStyle(0, 0);
    this.add.text(rightX, activityPanelY - activityPanelH / 2 + 26, '🐾 活動關卡排行 TOP5', textStyle({
      fontSize: '23px', color: '#ffb84d',
    })).setOrigin(0.5);
    const activityStatusText = woofPhase === 'before'
      ? `開放時間：${formatWoofWarTime(WOOF_WAR_OPEN_AT)}`
      : woofPhase === 'live'
        ? `結束時間：${WOOF_WAR_CLOSE_LABEL}`
        : '活動已結束';
    this.add.text(rightX, activityPanelY - activityPanelH / 2 + 50, activityStatusText, textStyle({
      fontSize: '16px', color: woofPhase === 'live' ? '#5bff8f' : '#ff9a9a',
    })).setOrigin(0.5);
    this.add.rectangle(rightX, activityPanelY - activityPanelH / 2 + 68, panelW - 60, 2, 0xffb84d, 0.4);

    this.activityLbText = this.add.text(rightX, activityPanelY - activityPanelH / 2 + HEADER_H + ACTIVITY_STATUS_ROW_H, '', textStyle(activityBodyStyle)).setOrigin(0.5, 0);

    if (woofPhase === 'before') {
      // 開放前不接排行榜訂閱，避免玩家在活動還沒開始就看到別人測試打出來的傷害數字
      this.activityLbText.setText('活動尚未開始，敬請期待！');
    } else {
      this._unsubWoofLeaderboard = subscribeWoofWarLeaderboard((rows) => {
        if (!this.activityLbText || !this.activityLbText.active) return;
        const lines = rows.slice(0, 5).map((r, i) => `${i + 1}. ${r.name || '???'} — ${r.damage || 0}　${WOOF_PRIZES[i]}`);
        this.activityLbText.setText(lines.length ? lines.join('\n') : '目前尚無紀錄');
      });
      this.events.once('shutdown', () => {
        if (this._unsubWoofLeaderboard) this._unsubWoofLeaderboard();
      });
    }
  }

  _showToast(msg) {
    const w = this.scale.width, h = this.scale.height;
    const t = this.add.text(w / 2, h - 100, msg, textStyle({ fontSize: '26px', color: '#ffe066' })).setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, duration: 1200, delay: 500, onComplete: () => t.destroy() });
  }
}
