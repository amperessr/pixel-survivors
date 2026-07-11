import { MAIL_DATA } from '../mail/MailData.js';
import { EQUIPMENT_DATA } from '../equipment/EquipmentData.js';
import {
  getMailStatus, isMailClaimed, isMailDeleted, claimMail, deleteMail,
  addGold, addItemToInventory, getGold, getWoofWarReward, isNewbieAccount,
} from '../managers/SaveManager.js';
import { resolveWoofWarRewardIfNeeded, WOOF_WAR_REWARD_MAIL_ID } from '../activities/WoofWarRewardSystem.js';
import { textStyle } from '../utils/TextStyle.js';

// 信箱：MailData.js 裡定義的信件列表（新的排最上面）＋汪汪大作戰活動結束後
// 動態產生的一封「個人化」結算信（見 _buildWoofWarRewardMail，內容依這個玩家
// 自己的名次而不同，不是寫死在 MailData.js 裡給所有人看一樣內容的信）。
// 點一封信會在右側開啟內容＋留言，可以選擇「領取」（金幣/道具直接發放進帳號）
// 或「刪除」。想發新的（給所有玩家看一樣內容的）獎勵信，直接在 MailData.js
// 的陣列加一筆新物件即可，不用改這個場景的程式碼。
export default class MailboxScene extends Phaser.Scene {
  constructor() { super('MailboxScene'); }

  async create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x10131a);
    this.add.text(w / 2, 50, '📬 信箱', textStyle({ fontSize: '48px', color: '#6fd3ff' })).setOrigin(0.5);

    this.goldText = this.add.text(w - 40, 50, `金幣：${getGold()}`, textStyle({
      fontSize: '26px', color: '#ffd93d',
    })).setOrigin(1, 0.5);

    // 進信箱前先確保活動獎勵已經結算過——大部分時候這裡會立刻回傳（已經在
    // MainMenuScene 結算過、有快取），只有活動剛結束後第一次點進信箱才會真的
    // 打一次 API，等它跑完才畫信件列表，確保這裡看到的資料是準的。
    await resolveWoofWarRewardIfNeeded().catch((err) => {
      console.warn('[MailboxScene] 汪汪大作戰獎勵結算失敗（可能離線）：', err.message);
    });

    // 新的信排最上面；已刪除的信直接不顯示。動態的新手禮包／活動結算信疊在最上面。
    const starterMail = this._buildStarterPackMail();
    const woofWarMail = this._buildWoofWarRewardMail();
    this.mails = [...(starterMail ? [starterMail] : []), ...(woofWarMail ? [woofWarMail] : []), ...[...MAIL_DATA].reverse()]
      .filter((m) => !isMailDeleted(m.id));
    this.selectedId = this.mails.length > 0 ? this.mails[0].id : null;

    // ---------- 左側：信件列表 ----------
    const listX = w * 0.27, listTop = 130, rowH = 74, listW = 480;
    this.add.text(listX, listTop - 30, '收件匣', textStyle({ fontSize: '24px', color: '#9fd3ff' })).setOrigin(0.5);

    this.rowNodes = [];
    this.mails.forEach((mail, i) => {
      const ry = listTop + i * rowH;
      const bg = this.add.image(listX, ry, 'ui_slot').setDisplaySize(listW, rowH - 8).setInteractive({ useHandCursor: true });
      const claimed = isMailClaimed(mail.id);
      const dot = this.add.text(listX - listW / 2 + 24, ry, claimed ? '📭' : '📩', textStyle({ fontSize: '26px' })).setOrigin(0.5);
      const title = this.add.text(listX - listW / 2 + 54, ry - 12, mail.title, textStyle({
        fontSize: '21px', color: claimed ? '#9fa8b0' : '#ffffff',
      })).setOrigin(0, 0.5);
      const date = this.add.text(listX - listW / 2 + 54, ry + 14, mail.date || '', textStyle({
        fontSize: '15px', color: '#6b7580',
      })).setOrigin(0, 0.5);
      bg.on('pointerover', () => bg.setTint(0x6fd3ff));
      bg.on('pointerout', () => bg.clearTint());
      bg.on('pointerdown', () => { this.selectedId = mail.id; this._refreshDetail(); this._refreshListHighlight(); });
      this.rowNodes.push({ mail, bg, dot, title, date });
    });

    if (this.mails.length === 0) {
      this.add.text(listX, listTop + 40, '目前沒有信件', textStyle({ fontSize: '20px', color: '#6b7580' })).setOrigin(0.5);
    }

    // ---------- 右側：信件內容 ----------
    this.detailX = w * 0.7;
    this.detailPanelW = 560;
    this.detailPanelTop = 120;
    this.detailNodes = [];
    this._refreshDetail();
    this._refreshListHighlight();

    // ---------- 底部：返回主選單 ----------
    const backBtn = this.add.image(w / 2, h - 60, 'ui_bar_bg').setDisplaySize(280, 70).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 60, '返回主選單', textStyle({ fontSize: '28px', color: '#10131a' })).setOrigin(0.5);
    backBtn.on('pointerover', () => backBtn.setTint(0x6fd3ff));
    backBtn.on('pointerout', () => backBtn.clearTint());
    backBtn.on('pointerdown', () => this.scene.start('MainMenuScene'));
  }

  // 目前選到的那一列列表項目加亮外框，其餘清掉，讓玩家看得出選了哪一封
  _refreshListHighlight() {
    this.rowNodes.forEach(({ mail, bg }) => {
      bg.setTint(mail.id === this.selectedId ? 0xffe066 : 0xffffff);
    });
  }

  // 重畫右側信件內容區塊：標題／日期／內文留言／獎勵預覽／領取與刪除按鈕
  _refreshDetail() {
    this.detailNodes.forEach((n) => n.destroy());
    this.detailNodes = [];

    const mail = this.mails.find((m) => m.id === this.selectedId);
    const x = this.detailX, panelW = this.detailPanelW, top = this.detailPanelTop;

    if (!mail) {
      const empty = this.add.text(x, top + 100, '選一封信查看內容', textStyle({ fontSize: '22px', color: '#6b7580' })).setOrigin(0.5, 0);
      this.detailNodes.push(empty);
      return;
    }

    const claimed = isMailClaimed(mail.id);
    const rewards = mail.rewards || {};
    const items = rewards.items || [];

    const title = this.add.text(x, top, mail.title, textStyle({ fontSize: '30px', color: '#ffe066' })).setOrigin(0.5, 0);
    const date = this.add.text(x, top + 44, mail.date || '', textStyle({ fontSize: '16px', color: '#6b7580' })).setOrigin(0.5, 0);
    this.add.rectangle(x, top + 72, panelW, 2, 0x6fd3ff, 0.4);

    const message = this.add.text(x, top + 88, mail.message || '', textStyle({
      fontSize: '20px', color: '#cfe9ff', align: 'center', lineSpacing: 8,
      wordWrap: { width: panelW - 20, useAdvancedWrap: true },
    })).setOrigin(0.5, 0);

    let cy = top + 88 + message.height + 30;
    this.detailNodes.push(title, date, message);

    // ---- 獎勵預覽 ----
    const hasRewards = (rewards.gold > 0) || items.length > 0;
    if (hasRewards) {
      const rewardTitle = this.add.text(x, cy, '🎁 附帶獎勵', textStyle({ fontSize: '20px', color: '#9fd3ff' })).setOrigin(0.5, 0);
      this.detailNodes.push(rewardTitle);
      cy += 36;

      if (rewards.gold > 0) {
        const goldRow = this.add.text(x, cy, `💰 金幣 x${rewards.gold.toLocaleString()}`, textStyle({
          fontSize: '20px', color: '#ffd93d',
        })).setOrigin(0.5, 0);
        this.detailNodes.push(goldRow);
        cy += 32;
      }

      if (items.length > 0) {
        const iconSize = 54, iconGap = 12;
        const totalW = items.length * iconSize + (items.length - 1) * iconGap;
        let ix = x - totalW / 2 + iconSize / 2;
        items.forEach((itemId) => {
          const def = EQUIPMENT_DATA[itemId];
          const slotBg = this.add.image(ix, cy + iconSize / 2, 'ui_equip_slot').setDisplaySize(iconSize, iconSize);
          this.detailNodes.push(slotBg);
          if (def) {
            const icon = this.add.image(ix, cy + iconSize / 2, def.icon).setDisplaySize(iconSize - 10, iconSize - 10);
            this.detailNodes.push(icon);
          } else {
            // MailData.js 填錯 id 時的防呆：不讓整個場景壞掉，至少顯示未知道具
            console.warn(`[MailboxScene] 找不到獎勵道具 id「${itemId}」，MailData.js 可能寫錯了`);
            const unknown = this.add.text(ix, cy + iconSize / 2, '？', textStyle({ fontSize: '24px', color: '#ff6b6b' })).setOrigin(0.5);
            this.detailNodes.push(unknown);
          }
          ix += iconSize + iconGap;
        });
        cy += iconSize + 20;
      }
    }

    cy += 20;

    // ---- 領取／刪除按鈕 ----
    const btnW = 200, btnH = 60;
    if (hasRewards) {
      const claimBtn = this.add.image(x - btnW / 2 - 10, cy, 'ui_button_parchment').setDisplaySize(btnW, btnH)
        .setInteractive({ useHandCursor: !claimed });
      const claimText = this.add.text(x - btnW / 2 - 10, cy, claimed ? '已領取' : '領取', textStyle({
        fontSize: '24px', color: claimed ? '#9fa8b0' : '#3a2413',
      })).setOrigin(0.5);
      if (claimed) {
        claimBtn.setAlpha(0.5);
      } else {
        claimBtn.on('pointerover', () => claimBtn.setTint(0xfff3d0));
        claimBtn.on('pointerout', () => claimBtn.clearTint());
        claimBtn.on('pointerdown', () => this._claim(mail));
      }
      this.detailNodes.push(claimBtn, claimText);
    }

    const deleteBtn = this.add.image(hasRewards ? x + btnW / 2 + 10 : x, cy, 'ui_button_parchment').setDisplaySize(btnW, btnH)
      .setInteractive({ useHandCursor: true });
    const deleteText = this.add.text(hasRewards ? x + btnW / 2 + 10 : x, cy, '刪除', textStyle({
      fontSize: '24px', color: '#3a2413',
    })).setOrigin(0.5);
    deleteBtn.on('pointerover', () => deleteBtn.setTint(0xff9a9a));
    deleteBtn.on('pointerout', () => deleteBtn.clearTint());
    deleteBtn.on('pointerdown', () => this._delete(mail));
    this.detailNodes.push(deleteBtn, deleteText);
  }

  // 領取：金幣直接加，道具逐一嘗試塞進背包（背包滿了就跳過那一件，其餘照常發放，
  // 不會整封信領取失敗），然後標記這封信已領取。
  _claim(mail) {
    if (isMailClaimed(mail.id)) return;
    const rewards = mail.rewards || {};
    if (rewards.gold > 0) addGold(rewards.gold);

    let skipped = 0;
    (rewards.items || []).forEach((itemId) => {
      if (!EQUIPMENT_DATA[itemId]) return; // 找不到的 id 已經在 _refreshDetail 警告過，這裡靜默跳過
      if (!addItemToInventory(itemId)) skipped++;
    });

    claimMail(mail.id);
    this.goldText.setText(`金幣：${getGold()}`);
    this._refreshDetail();
    this._refreshRow(mail.id);
    this._showToast(skipped > 0 ? `已領取獎勵（背包已滿，${skipped} 件道具未領到）` : '已領取獎勵！');
  }

  // 刪除：不管有沒有領取過都能刪，刪除後這封信會從列表消失（未領取的獎勵一併捨棄）
  _delete(mail) {
    const hadUnclaimedReward = !isMailClaimed(mail.id) &&
      ((mail.rewards && mail.rewards.gold > 0) || (mail.rewards && mail.rewards.items && mail.rewards.items.length > 0));
    deleteMail(mail.id);
    this.mails = this.mails.filter((m) => m.id !== mail.id);
    const row = this.rowNodes.find((r) => r.mail.id === mail.id);
    if (row) { row.bg.destroy(); row.dot.destroy(); row.title.destroy(); row.date.destroy(); }
    this.rowNodes = this.rowNodes.filter((r) => r.mail.id !== mail.id);
    this.selectedId = this.mails.length > 0 ? this.mails[0].id : null;
    this._refreshDetail();
    this._refreshListHighlight();
    this._showToast(hadUnclaimedReward ? '已刪除信件（未領取的獎勵一併捨棄）' : '已刪除信件');
  }

  // 領取後只更新那一列的已讀圖示/文字顏色，不用整個列表重建
  _refreshRow(mailId) {
    const row = this.rowNodes.find((r) => r.mail.id === mailId);
    if (!row) return;
    row.dot.setText('📭');
    row.title.setColor('#9fa8b0');
  }

  _showToast(msg) {
    const w = this.scale.width, h = this.scale.height;
    const t = this.add.text(w / 2, h - 130, msg, textStyle({ fontSize: '24px', color: '#5bff8f' })).setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, duration: 1400, delay: 500, onComplete: () => t.destroy() });
  }

  // 新手禮包：只有帳號建立當下被標記成「新手」的玩家才看得到（見 SaveManager.js
  // 的 isNewbieAccount／_markAsNewbieAccount），不寫進 MAIL_DATA 固定清單，
  // 避免舊玩家帳號也一起看到、白拿一筆多出來的金幣。
  _buildStarterPackMail() {
    if (!isNewbieAccount()) return null;
    return {
      id: 'starter_pack',
      title: '🎁 新手禮包',
      date: '',
      message: '歡迎遊玩像素生存~ 有任何問題可以私訊',
      rewards: { gold: 30000, items: [] },
    };
  }

  // 依這個玩家自己結算出的名次（見 WoofWarRewardSystem.resolveWoofWarRewardIfNeeded）
  // 動態組出一封「長得像普通信件」的物件，套進跟 MAIL_DATA 完全一樣的領取/刪除
  // 流程——沒結算過或結算出「沒參加」就不產生信件（回傳 null）。
  _buildWoofWarRewardMail() {
    const reward = getWoofWarReward();
    if (!reward || !reward.participated) return null;
    return {
      id: WOOF_WAR_REWARD_MAIL_ID,
      title: `🐾 汪汪大作戰結算：第 ${reward.rank} 名`,
      date: '2026-07-16',
      message: `活動已經結束囉，恭喜你在汪汪大作戰拿下第 ${reward.rank} 名！這是你的獎勵——${reward.label}，感謝參與～`,
      rewards: reward.prizeType === 'gold'
        ? { gold: reward.gold, items: [] }
        : { gold: 0, items: [reward.itemId] },
    };
  }
}
