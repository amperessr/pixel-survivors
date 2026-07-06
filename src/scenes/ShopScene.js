import { EQUIPMENT_DATA, SHOP_ITEM_IDS } from '../equipment/EquipmentData.js';
import { getGold, spendGold, addGold, addItemToInventory } from '../managers/SaveManager.js';
import { textStyle } from '../utils/TextStyle.js';

// 商店：目前只賣五個基本裝備，各 3000 元，買了直接進背包第一個空格。
export default class ShopScene extends Phaser.Scene {
  constructor() { super('ShopScene'); }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x10131a);
    this.add.text(w / 2, 50, '商店', textStyle({ fontSize: '56px', color: '#6fd3ff' })).setOrigin(0.5);

    this.goldText = this.add.text(w - 40, 50, `金幣：${getGold()}`, textStyle({
      fontSize: '30px', color: '#ffd93d',
    })).setOrigin(1, 0.5);

    const cardW = 320, cardH = 420, gap = 40;
    const ids = SHOP_ITEM_IDS;
    const totalW = ids.length * cardW + (ids.length - 1) * gap;
    const startX = w / 2 - totalW / 2 + cardW / 2;
    const cy = h / 2 + 10;

    ids.forEach((itemId, i) => {
      const def = EQUIPMENT_DATA[itemId];
      const cx = startX + i * (cardW + gap);
      this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH);
      this.add.image(cx, cy - 130, def.icon).setScale(2.4);
      this.add.text(cx, cy - 30, def.name, textStyle({ fontSize: '32px', color: '#fff' })).setOrigin(0.5);
      this.add.text(cx, cy + 14, def.desc, textStyle({ fontSize: '24px', color: '#9fd3ff' })).setOrigin(0.5);
      this.add.text(cx, cy + 56, `💰 ${def.price}`, textStyle({ fontSize: '28px', color: '#ffd93d' })).setOrigin(0.5);

      const btn = this.add.image(cx, cy + 150, 'ui_bar_bg').setDisplaySize(220, 60).setInteractive({ useHandCursor: true });
      this.add.text(cx, cy + 150, '購買', textStyle({ fontSize: '26px', color: '#10131a' })).setOrigin(0.5);
      btn.on('pointerover', () => btn.setTint(0x6fd3ff));
      btn.on('pointerout', () => btn.clearTint());
      btn.on('pointerdown', () => this._buy(itemId, def));
    });

    const backBtn = this.add.image(w / 2, h - 70, 'ui_bar_bg').setDisplaySize(280, 70).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 70, '返回主選單', textStyle({ fontSize: '28px', color: '#10131a' })).setOrigin(0.5);
    backBtn.on('pointerover', () => backBtn.setTint(0x6fd3ff));
    backBtn.on('pointerout', () => backBtn.clearTint());
    backBtn.on('pointerdown', () => this.scene.start('MainMenuScene'));
  }

  _buy(itemId, def) {
    if (!spendGold(def.price)) {
      this._showToast('金幣不足！');
      return;
    }
    const ok = addItemToInventory(itemId);
    if (!ok) {
      // 背包滿了，把錢退回去，避免玩家平白損失金幣
      addGold(def.price);
      this._showToast('背包已滿，購買失敗');
      return;
    }
    this.goldText.setText(`金幣：${getGold()}`);
    this._showToast(`已購買「${def.name}」！`);
  }

  _showToast(msg) {
    const w = this.scale.width, h = this.scale.height;
    const t = this.add.text(w / 2, h - 130, msg, textStyle({ fontSize: '26px', color: '#ffe066' })).setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, duration: 1200, delay: 500, onComplete: () => t.destroy() });
  }
}
