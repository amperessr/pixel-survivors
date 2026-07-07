import {
  EQUIPMENT_DATA, EQUIP_SLOTS, SLOT_LABELS, EQUIP_LINES, TIER_TINTS,
} from '../equipment/EquipmentData.js';
import { getGold, spendGold, addGold, isItemOwned, upgradeEquipment } from '../managers/SaveManager.js';
import { textStyle } from '../utils/TextStyle.js';

// 商店：五個裝備部位 x 三個階級（初心者/中階/高階）的 5x3 卡片牆。
// 同一部位必須依序購買（先買初心者才能買中階，先買中階才能買高階），
// 每件裝備限購一次；買中/高階時會直接把背包或身上的前一階裝備原地升級成新的，
// 不會讓玩家背包裡同時存在同一部位的兩件裝備。
export default class ShopScene extends Phaser.Scene {
  constructor() { super('ShopScene'); }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x10131a);
    this.add.text(w / 2, 46, '商店', textStyle({ fontSize: '52px', color: '#6fd3ff' })).setOrigin(0.5);

    this.goldText = this.add.text(w - 40, 46, `金幣：${getGold()}`, textStyle({
      fontSize: '28px', color: '#ffd93d',
    })).setOrigin(1, 0.5);

    // 規則說明：新增的分階購買機制不是一眼就看得出來，這裡明講規則，
    // 避免玩家看到「上鎖」的中/高階裝備卻不知道要先買前一階。
    this.add.text(w / 2, 90, '⚠ 同部位裝備需依序購買：初心者 → 中階 → 高階，每件裝備限購一次', textStyle({
      fontSize: '21px', color: '#9fd3ff',
    })).setOrigin(0.5);

    this.cardW = 320;
    this.cardH = 260;
    this.gapX = 26;
    this.gapY = 20;
    const totalW = EQUIP_SLOTS.length * this.cardW + (EQUIP_SLOTS.length - 1) * this.gapX;
    this.startX = w / 2 - totalW / 2 + this.cardW / 2;
    this.startY = 270;

    // 每個部位一欄標題，標在該欄第一張卡片正上方
    EQUIP_SLOTS.forEach((slot, i) => {
      const cx = this.startX + i * (this.cardW + this.gapX);
      this.add.text(cx, this.startY - this.cardH / 2 - 16, SLOT_LABELS[slot], textStyle({
        fontSize: '24px', color: '#ffe066',
      })).setOrigin(0.5, 1);
    });

    this.gridContainer = this.add.container(0, 0);
    this._buildGrid();

    const backBtn = this.add.image(w / 2, h - 50, 'ui_bar_bg').setDisplaySize(280, 62).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 50, '返回主選單', textStyle({ fontSize: '26px', color: '#10131a' })).setOrigin(0.5);
    backBtn.on('pointerover', () => backBtn.setTint(0x6fd3ff));
    backBtn.on('pointerout', () => backBtn.clearTint());
    backBtn.on('pointerdown', () => this.scene.start('MainMenuScene'));
  }

  _buildGrid() {
    this.gridContainer.removeAll(true);

    EQUIP_SLOTS.forEach((slot, col) => {
      const line = EQUIP_LINES[slot];
      line.forEach((itemId, row) => {
        const def = EQUIPMENT_DATA[itemId];
        const cx = this.startX + col * (this.cardW + this.gapX);
        const cy = this.startY + row * (this.cardH + this.gapY);
        this._buildCard(cx, cy, def);
      });
    });
  }

  _buildCard(cx, cy, def) {
    const cardW = this.cardW, cardH = this.cardH;
    const owned = isItemOwned(def.id);
    const prevOwned = !def.prevId || isItemOwned(def.prevId);
    const locked = !owned && !prevOwned;
    const buyable = !owned && prevOwned;

    this.gridContainer.add(this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH));

    const iconY = cy - 65;
    const icon = this.add.image(cx, iconY, def.icon).setScale(1.8);
    if (TIER_TINTS[def.tier]) icon.setTint(TIER_TINTS[def.tier]); else icon.clearTint();
    if (owned) icon.setAlpha(0.3);
    this.gridContainer.add(icon);

    this.gridContainer.add(this.add.text(cx, cy - 8, def.name, textStyle({
      fontSize: '24px', color: owned ? '#7a7a7a' : '#fff',
    })).setOrigin(0.5));
    this.gridContainer.add(this.add.text(cx, cy + 28, def.desc, textStyle({
      fontSize: '19px', color: owned ? '#6a6a6a' : '#9fd3ff',
    })).setOrigin(0.5));

    if (buyable) {
      this.gridContainer.add(this.add.text(cx, cy + 58, `💰 ${def.price}`, textStyle({
        fontSize: '22px', color: '#ffd93d',
      })).setOrigin(0.5));

      const btn = this.add.image(cx, cy + 96, 'ui_bar_bg').setDisplaySize(cardW - 100, 40).setInteractive({ useHandCursor: true });
      this.gridContainer.add(btn);
      this.gridContainer.add(this.add.text(cx, cy + 96, '購買', textStyle({
        fontSize: '22px', color: '#10131a',
      })).setOrigin(0.5));
      btn.on('pointerover', () => btn.setTint(0x6fd3ff));
      btn.on('pointerout', () => btn.clearTint());
      btn.on('pointerdown', () => this._buy(def));
    } else if (owned) {
      this.gridContainer.add(this.add.rectangle(cx, iconY, cardW - 40, 70, 0x000000, 0.35));
      this.gridContainer.add(this.add.text(cx, iconY, '已購買', textStyle({
        fontSize: '28px', color: '#ff5a5a',
      })).setOrigin(0.5));
    } else if (locked) {
      this.gridContainer.add(this.add.rectangle(cx, iconY, cardW - 40, 70, 0x000000, 0.35));
      this.gridContainer.add(this.add.text(cx, iconY, '請先購買\n前一階裝備', textStyle({
        fontSize: '20px', color: '#ff5a5a', align: 'center', lineSpacing: 4,
      })).setOrigin(0.5));
    }
  }

  _buy(def) {
    if (!spendGold(def.price)) {
      this._showToast('金幣不足！');
      return;
    }
    const ok = upgradeEquipment(def.prevId, def.id);
    if (!ok) {
      // 只有初心者階（沒有前一階可升級）才會走進背包空格邏輯，背包滿了就退錢
      addGold(def.price);
      this._showToast('背包已滿，購買失敗');
      return;
    }
    this.goldText.setText(`金幣：${getGold()}`);
    this._buildGrid();
    this._showToast(`已購買「${def.name}」！`);
  }

  _showToast(msg) {
    const w = this.scale.width, h = this.scale.height;
    const t = this.add.text(w / 2, h - 100, msg, textStyle({ fontSize: '26px', color: '#ffe066' })).setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, duration: 1200, delay: 500, onComplete: () => t.destroy() });
  }
}
