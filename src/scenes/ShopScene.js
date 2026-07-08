import {
  EQUIPMENT_DATA, EQUIP_SLOTS, SLOT_LABELS, EQUIP_LINES, RARITY_DATA,
} from '../equipment/EquipmentData.js';
import { getGold, spendGold, addGold, isItemOwned, upgradeEquipment } from '../managers/SaveManager.js';
import { textStyle } from '../utils/TextStyle.js';
import { createRarityFrame } from '../utils/RarityFrame.js';

const GACHA_SINGLE_PRICE = 1000;
const GACHA_TEN_PRICE = 9000;

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

    // 裝備卡片牆縮小一點，把畫面右側讓出來給抽獎機面板
    this.cardW = 250;
    this.cardH = 230;
    this.gapX = 18;
    this.gapY = 18;
    const totalW = EQUIP_SLOTS.length * this.cardW + (EQUIP_SLOTS.length - 1) * this.gapX;
    this.startX = 60 + this.cardW / 2;
    this.startY = 270;

    // 每個部位一欄標題，標在該欄第一張卡片正上方
    EQUIP_SLOTS.forEach((slot, i) => {
      const cx = this.startX + i * (this.cardW + this.gapX);
      this.add.text(cx, this.startY - this.cardH / 2 - 16, SLOT_LABELS[slot], textStyle({
        fontSize: '22px', color: '#ffe066',
      })).setOrigin(0.5, 1);
    });

    this.gridContainer = this.add.container(0, 0);
    this._buildGrid();

    this._buildGachaPanel(60 + totalW + 40, w);

    const backBtn = this.add.image(w / 2, h - 50, 'ui_bar_bg').setDisplaySize(280, 62).setInteractive({ useHandCursor: true });
    this.add.text(w / 2, h - 50, '返回主選單', textStyle({ fontSize: '26px', color: '#10131a' })).setOrigin(0.5);
    backBtn.on('pointerover', () => backBtn.setTint(0x6fd3ff));
    backBtn.on('pointerout', () => backBtn.clearTint());
    backBtn.on('pointerdown', () => this.scene.start('MainMenuScene'));
  }

  // 抽獎機面板：日式扭蛋機圖片 + 一抽／十抽兩個按鈕。
  // 獎勵內容表還沒定案（使用者要求先保留），所以按鈕目前只會顯示「準備中」提示、
  // 不會扣款——之後獎勵表決定了，只需要改 `_gachaPull()` 這個函式接上真正的抽獎邏輯即可。
  _buildGachaPanel(panelLeft, screenW) {
    const panelW = screenW - panelLeft - 60;
    const cx = panelLeft + panelW / 2;
    const panelTop = 150, panelH = 820;
    const cy = panelTop + panelH / 2;

    this.add.image(cx, cy, 'ui_panel').setDisplaySize(panelW, panelH);
    this.add.rectangle(cx, cy, panelW - 6, panelH - 6).setStrokeStyle(3, 0xff9ad6, 0.7).setFillStyle(0, 0);
    this.add.text(cx, panelTop + 34, '🎰 幸運扭蛋', textStyle({
      fontSize: '30px', color: '#ff9ad6',
    })).setOrigin(0.5);
    this.add.rectangle(cx, panelTop + 66, panelW - 60, 2, 0xff9ad6, 0.4);

    this.add.image(cx, panelTop + 265, 'gacha_machine').setScale(1.3);

    this.add.text(cx, panelTop + 467, '每次抽獎都有機會拿到豐厚獎勵！', textStyle({
      fontSize: '19px', color: '#cfe9ff',
    })).setOrigin(0.5);

    const btnW = panelW - 100;
    this._buildGachaButton(cx, panelTop + 521, btnW, `一抽　💰 ${GACHA_SINGLE_PRICE}`, () => this._gachaPull(1, GACHA_SINGLE_PRICE));
    this._buildGachaButton(cx, panelTop + 611, btnW, `十抽　💰 ${GACHA_TEN_PRICE}`, () => this._gachaPull(10, GACHA_TEN_PRICE));
  }

  _buildGachaButton(cx, cy, btnW, label, onClick) {
    const btn = this.add.image(cx, cy, 'ui_button_parchment').setDisplaySize(btnW, 68).setInteractive({ useHandCursor: true });
    this.add.text(cx, cy, label, textStyle({ fontSize: '26px', color: '#3a2413' })).setOrigin(0.5);
    btn.on('pointerover', () => btn.setTint(0xfff3d0));
    btn.on('pointerout', () => btn.clearTint());
    btn.on('pointerdown', onClick);
  }

  _gachaPull(times, price) {
    // TODO: 獎勵表定案後在這裡實作真正的抽獎邏輯（扣款＋開獎＋發獎勵）。
    this._showToast('抽獎機制準備中，敬請期待！');
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

  // 買中/高階時，前一階裝備會被「原地升級」成新 id，原本的 id 就不會再出現在
  // 背包或身上任何地方——如果只單純判斷 isItemOwned(def.id)，買完高階之後
  // 初/中階卡片會看起來「又變回可以買」，其實是已經升級過的裝備，不該再讓玩家重買一次。
  // 這裡額外檢查同部位是否有更高階的版本已經擁有，有的話這一階也算「已購買」。
  _isSurpassed(def) {
    const line = EQUIP_LINES[def.slot];
    return line.slice(def.tierIndex + 1).some((higherId) => isItemOwned(higherId));
  }

  _buildCard(cx, cy, def) {
    const cardW = this.cardW, cardH = this.cardH;
    const owned = isItemOwned(def.id) || this._isSurpassed(def);
    const prevOwned = !def.prevId || isItemOwned(def.prevId) || this._isSurpassed(def);
    const locked = !owned && !prevOwned;
    const buyable = !owned && prevOwned;

    this.gridContainer.add(this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH));

    // 稀有度外框：每個階級有各自的視覺樣式（見 RarityFrame.js），一眼就能分辨階級。
    const rarity = RARITY_DATA[def.rarity] || RARITY_DATA.common;
    const frame = createRarityFrame(this, cx, cy, cardW - 6, cardH - 6, def.rarity);
    if (owned) frame.setAlpha(0.35);
    this.gridContainer.add(frame);

    const iconY = cy - 65;
    // 圖示現在是玩家提供的正式美術圖（128x128，取代舊的 48x48 程式產生貼圖），
    // 每階已經是各自獨立的圖案配色，不用再額外染色區分階級。
    const icon = this.add.image(cx, iconY, def.icon).setScale(0.675);
    if (owned) icon.setAlpha(0.3);
    this.gridContainer.add(icon);

    const rarityHex = '#' + rarity.color.toString(16).padStart(6, '0');
    this.gridContainer.add(this.add.text(cx, cy - 8, def.name, textStyle({
      fontSize: '24px', color: owned ? '#7a7a7a' : rarityHex,
    })).setOrigin(0.5));
    this.gridContainer.add(this.add.text(cx, cy - 92, rarity.label, textStyle({
      fontSize: '15px', color: owned ? '#7a7a7a' : rarityHex,
    })).setOrigin(0.5));
    this.gridContainer.add(this.add.text(cx, cy + 28, def.desc, textStyle({
      fontSize: '19px', color: owned ? '#6a6a6a' : '#9fd3ff', align: 'center',
      wordWrap: { width: cardW - 30, useAdvancedWrap: true },
    })).setOrigin(0.5));

    if (buyable) {
      this.gridContainer.add(this.add.text(cx, cy + 58, `💰 ${def.price}`, textStyle({
        fontSize: '22px', color: '#ffd93d',
      })).setOrigin(0.5));

      const btn = this.add.image(cx, cy + 92, 'ui_bar_bg').setDisplaySize(cardW - 100, 38).setInteractive({ useHandCursor: true });
      this.gridContainer.add(btn);
      this.gridContainer.add(this.add.text(cx, cy + 92, '購買', textStyle({
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
