import {
  EQUIPMENT_DATA, EQUIP_SLOTS, SLOT_LABELS, EQUIP_LINES, RARITY_DATA, rollGachaItem,
  GACHA_RARITY_WEIGHTS, GACHA_POOL_BY_RARITY, RARITY_IDS, SELL_PRICES,
} from '../equipment/EquipmentData.js';
import {
  getGold, spendGold, addGold, isItemOwned, upgradeEquipment, addItemToInventory, getInventory,
  getAutoSellRarities, setAutoSellRarities,
} from '../managers/SaveManager.js';
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

  // 抽獎機面板：日式扭蛋機圖片 + 一抽／十抽兩個按鈕 + 自動賣出勾選列。
  _buildGachaPanel(panelLeft, screenW) {
    const panelW = screenW - panelLeft - 60;
    const cx = panelLeft + panelW / 2;
    const panelTop = 150, panelH = 900;
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
    this._buildGachaButton(cx, panelTop + 701, btnW, '📜 出現道具', () => this._showDropList());

    this._buildAutoSellRow(cx, panelTop + 780, panelW - 40);
  }

  // 自動賣出勾選列：勾起來的稀有度，扭蛋抽到時直接原地換成金幣（見 _gachaPull），
  // 不會佔背包格子。只開放普通/優秀/稀有/史詩四階，傳說/神話太稀有，不給誤勾賣掉。
  _buildAutoSellRow(cx, cy, rowW) {
    this.autoSellSet = new Set(getAutoSellRarities());
    this.add.text(cx, cy - 30, '扭蛋抽到時自動賣出：', textStyle({
      fontSize: '17px', color: '#9fd3ff',
    })).setOrigin(0.5);

    const rarities = ['common', 'uncommon', 'rare', 'epic'];
    const colW = rowW / rarities.length;
    this.autoSellBoxes = {};
    rarities.forEach((rarity, i) => {
      const rx = cx - rowW / 2 + colW * i + colW / 2;
      const rarityDef = RARITY_DATA[rarity];
      const hex = '#' + rarityDef.color.toString(16).padStart(6, '0');
      const box = this.add.image(rx, cy, 'ui_equip_slot').setDisplaySize(28, 28).setInteractive({ useHandCursor: true });
      const check = this.add.text(rx, cy, '✓', textStyle({ fontSize: '20px', color: '#5bff8f' })).setOrigin(0.5);
      this.add.text(rx, cy + 24, rarityDef.label, textStyle({ fontSize: '15px', color: hex })).setOrigin(0.5);
      this.autoSellBoxes[rarity] = check;
      box.on('pointerover', () => box.setTint(0xffe066));
      box.on('pointerout', () => box.clearTint());
      box.on('pointerdown', () => {
        if (this.autoSellSet.has(rarity)) this.autoSellSet.delete(rarity);
        else this.autoSellSet.add(rarity);
        setAutoSellRarities(Array.from(this.autoSellSet));
        this._refreshAutoSellBoxes();
      });
    });
    this._refreshAutoSellBoxes();
  }

  _refreshAutoSellBoxes() {
    Object.entries(this.autoSellBoxes).forEach(([rarity, check]) => {
      check.setVisible(this.autoSellSet.has(rarity));
    });
  }

  // 「出現道具」清單：整畫面覆蓋層，依稀有度分欄列出扭蛋抽得到的所有道具、
  // 能力效果與各稀有度的機率，讓玩家抽之前知道獎池內容。
  _showDropList() {
    const w = this.scale.width, h = this.scale.height;
    const overlay = this.add.container(0, 0).setDepth(9500);
    overlay.add(this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.88).setInteractive());
    overlay.add(this.add.text(w / 2, 44, '🎰 扭蛋出現道具一覽', textStyle({
      fontSize: '34px', color: '#ff9ad6',
    })).setOrigin(0.5));

    // 六個稀有度各一欄（含機率標題），道具多的欄位字級縮小塞得下
    const colW = w / RARITY_IDS.length;
    RARITY_IDS.forEach((rarityId, col) => {
      const rarity = RARITY_DATA[rarityId];
      const pool = GACHA_POOL_BY_RARITY[rarityId] || [];
      const weight = GACHA_RARITY_WEIGHTS[rarityId];
      const cx = colW * col + colW / 2;
      const hex = '#' + rarity.color.toString(16).padStart(6, '0');

      overlay.add(this.add.text(cx, 100, `${rarity.label}`, textStyle({
        fontSize: '26px', color: hex,
      })).setOrigin(0.5));
      overlay.add(this.add.text(cx, 132, weight != null ? `機率 ${weight}%` : '（暫無）', textStyle({
        fontSize: '18px', color: hex,
      })).setOrigin(0.5));
      overlay.add(this.add.rectangle(cx, 152, colW - 40, 2, rarity.color, 0.5));

      // 一般裝備一行一件「名稱 效果」；戒指的效果說明較長，交給 wordWrap 換行
      const fontSize = pool.length > 30 ? 15 : 17;
      const rowH = pool.length > 30 ? 23 : 27;
      let y = 172;
      pool.forEach((id) => {
        const def = EQUIPMENT_DATA[id];
        const effect = def.desc.replace('（僅扭蛋機取得）', '');
        const line = this.add.text(cx - colW / 2 + 22, y, `${def.name}　${effect}`, textStyle({
          fontSize: `${fontSize}px`, color: '#cfe9ff',
          wordWrap: { width: colW - 44, useAdvancedWrap: true },
        })).setOrigin(0, 0);
        overlay.add(line);
        y += Math.max(rowH, line.height + 6);
      });
    });

    const closeBtn = this.add.image(w / 2, h - 56, 'ui_button_parchment').setDisplaySize(200, 56)
      .setInteractive({ useHandCursor: true });
    overlay.add(closeBtn);
    overlay.add(this.add.text(w / 2, h - 56, '關閉', textStyle({ fontSize: '24px', color: '#3a2413' })).setOrigin(0.5));
    closeBtn.on('pointerover', () => closeBtn.setTint(0xfff3d0));
    closeBtn.on('pointerout', () => closeBtn.clearTint());
    closeBtn.on('pointerdown', () => overlay.destroy());
  }

  _buildGachaButton(cx, cy, btnW, label, onClick) {
    const btn = this.add.image(cx, cy, 'ui_button_parchment').setDisplaySize(btnW, 68).setInteractive({ useHandCursor: true });
    this.add.text(cx, cy, label, textStyle({ fontSize: '26px', color: '#3a2413' })).setOrigin(0.5);
    btn.on('pointerover', () => btn.setTint(0xfff3d0));
    btn.on('pointerout', () => btn.clearTint());
    btn.on('pointerdown', onClick);
  }

  // 抽獎前先確認背包有足夠空格，不夠就直接擋下、不扣款——避免抽了裝備卻發不出去。
  // 這裡仍然用 times（而不是「扣掉自動賣出後真正要塞背包的件數」）當門檻，因為
  // 抽到什麼要等真的抽了才知道；用 times 當保守上限，保證不管抽到什麼都塞得下。
  // 通過檢查後才扣款、依機率表抽出 times 件裝備／戒指：稀有度有勾選自動賣出的
  // 直接換成金幣、不進背包，其餘照常塞進背包，最後播開獎動畫。
  _gachaPull(times, price) {
    const freeSlots = getInventory().filter((s) => !s).length;
    if (freeSlots < times) {
      this._showToast(`背包已滿（需要 ${times} 格空位，目前只有 ${freeSlots} 格），請先整理背包！`);
      return;
    }
    if (!spendGold(price)) {
      this._showToast('金幣不足！');
      return;
    }
    const autoSellSet = this.autoSellSet || new Set(getAutoSellRarities());
    const results = [];
    for (let i = 0; i < times; i++) {
      const id = rollGachaItem();
      const rarity = EQUIPMENT_DATA[id].rarity;
      if (autoSellSet.has(rarity)) {
        const soldPrice = SELL_PRICES[rarity];
        addGold(soldPrice);
        results.push({ id, sold: true, soldPrice });
      } else {
        addItemToInventory(id);
        results.push({ id, sold: false });
      }
    }
    this.goldText.setText(`金幣：${getGold()}`);
    this._showGachaReveal(results, times, price);
  }

  // 開獎動畫：暗幕蓋住整個畫面擋掉底下互動。單抽是置中大卡片＋稀有度色光爆閃；
  // 十抽是 5x2 排列、依序滾出的小卡片牆。稀有度外框沿用商店卡片同一套 RarityFrame，
  // 讓抽到高階裝備時，畫面上的視覺份量跟商店展示一致。
  // times/price 記著這次是一抽還是十抽，讓「再來一次」按鈕能照原本的抽法直接再抽一次，
  // 不用先關掉視窗再回去按原本的按鈕。
  _showGachaReveal(results, times, price) {
    const w = this.scale.width, h = this.scale.height;
    const overlay = this.add.container(0, 0).setDepth(9000);
    overlay.add(this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.82).setInteractive());

    const btnGap = 30, btnW = 200, btnH = 56, btnY = h - 70;
    const closeBtn = this.add.image(w / 2 - btnW / 2 - btnGap / 2, btnY, 'ui_button_parchment').setDisplaySize(btnW, btnH)
      .setInteractive({ useHandCursor: true }).setAlpha(0);
    const closeText = this.add.text(w / 2 - btnW / 2 - btnGap / 2, btnY, '關閉', textStyle({
      fontSize: '24px', color: '#3a2413',
    })).setOrigin(0.5).setAlpha(0);
    const againBtn = this.add.image(w / 2 + btnW / 2 + btnGap / 2, btnY, 'ui_button_parchment').setDisplaySize(btnW, btnH)
      .setInteractive({ useHandCursor: true }).setAlpha(0);
    const againText = this.add.text(w / 2 + btnW / 2 + btnGap / 2, btnY, `再來一次（${times === 1 ? '一抽' : '十抽'}）`, textStyle({
      fontSize: times === 1 ? '24px' : '20px', color: '#3a2413',
    })).setOrigin(0.5).setAlpha(0);
    overlay.add([closeBtn, closeText, againBtn, againText]);
    closeBtn.on('pointerover', () => closeBtn.setTint(0xfff3d0));
    closeBtn.on('pointerout', () => closeBtn.clearTint());
    closeBtn.on('pointerdown', () => overlay.destroy());
    againBtn.on('pointerover', () => againBtn.setTint(0xfff3d0));
    againBtn.on('pointerout', () => againBtn.clearTint());
    againBtn.on('pointerdown', () => {
      overlay.destroy();
      this._gachaPull(times, price);
    });
    const revealCloseBtn = () => { closeBtn.setAlpha(1); closeText.setAlpha(1); againBtn.setAlpha(1); againText.setAlpha(1); };

    if (results.length === 1) {
      this._revealSingleCard(overlay, w / 2, h / 2 - 20, results[0], revealCloseBtn);
    } else {
      // 卡片放大一圈（190x230 → 230x280），十張排開還是裝得下 1920 寬的畫面。
      const cols = 5, rows = 2, cardW = 230, cardH = 280, gapX = 24, gapY = 32;
      const totalW = cols * cardW + (cols - 1) * gapX;
      const startX = w / 2 - totalW / 2 + cardW / 2;
      const startY = h / 2 - (rows * cardH + (rows - 1) * gapY) / 2 + cardH / 2 - 30;
      results.forEach((result, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const cx = startX + col * (cardW + gapX);
        const cy = startY + row * (cardH + gapY);
        this.time.delayedCall(i * 130, () => this._revealSmallCard(overlay, cx, cy, cardW, cardH, result));
      });
      this.time.delayedCall(results.length * 130 + 400, revealCloseBtn);
    }
  }

  // 單抽大卡片：先炸一圈跟稀有度同色的光暈，卡片、圖示、稀有度標籤、名稱、
  // 敘述依序淡入＋彈跳縮放，強化「開獎瞬間」的驚喜感。result = { id, sold, soldPrice }；
  // sold 的話翻牌動畫結束後會再多播一段「變成金幣」的特效（見 _playSoldFx）。
  _revealSingleCard(overlay, cx, cy, result, onDone) {
    const { id, sold, soldPrice } = result;
    const def = EQUIPMENT_DATA[id];
    const rarity = RARITY_DATA[def.rarity] || RARITY_DATA.common;
    const rarityHex = '#' + rarity.color.toString(16).padStart(6, '0');
    const cardW = 380, cardH = 460; // 單抽卡片放大一圈，開獎瞬間份量感更足

    const flash = this.add.circle(cx, cy, 10, rarity.color, 0.9);
    overlay.add(flash);
    this.tweens.add({
      targets: flash, radius: 260, alpha: 0, duration: 500, ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });

    // 注意：setDisplaySize() 之後不能再呼叫 setScale()，setScale 會直接蓋掉
    // setDisplaySize 算出來的縮放比例，讓卡片最後變回貼圖原始大小（跟放大過的
    // cardW/cardH 對不上，畫面看起來就是卡片跑掉、跟外框/其他元素大小不一致）。
    // 改成先量出「顯示成 cardW x cardH 需要的縮放值」，用它當動畫終點。
    const card = this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH).setAlpha(0);
    const cardScaleX = card.scaleX, cardScaleY = card.scaleY;
    card.setScale(cardScaleX * 0.3, cardScaleY * 0.3);
    const frame = createRarityFrame(this, cx, cy, cardW - 6, cardH - 6, def.rarity).setScale(0.3).setAlpha(0);
    const icon = this.add.image(cx, cy - 115, def.icon).setScale(0).setAlpha(0);
    const rarityLabel = this.add.text(cx, cy - 204, rarity.label, textStyle({
      fontSize: '26px', color: rarityHex,
    })).setOrigin(0.5).setAlpha(0);
    const nameText = this.add.text(cx, cy + 51, def.name, textStyle({
      fontSize: '34px', color: '#fff',
    })).setOrigin(0.5).setAlpha(0);
    const descText = this.add.text(cx, cy + 112, def.desc, textStyle({
      fontSize: '21px', color: '#9fd3ff', align: 'center',
      wordWrap: { width: cardW - 30, useAdvancedWrap: true },
    })).setOrigin(0.5).setAlpha(0);
    overlay.add([card, frame, icon, rarityLabel, nameText, descText]);

    this.tweens.add({ targets: frame, scale: 1, alpha: 1, duration: 420, ease: 'Back.easeOut', delay: 120 });
    this.tweens.add({ targets: card, scaleX: cardScaleX, scaleY: cardScaleY, alpha: 1, duration: 420, ease: 'Back.easeOut', delay: 120 });
    this.tweens.add({ targets: icon, scale: 0.87, alpha: 1, duration: 420, ease: 'Back.easeOut', delay: 200 });
    this.tweens.add({
      targets: [rarityLabel, nameText, descText], alpha: 1, duration: 380, delay: 420,
      onComplete: () => {
        if (sold) this._playSoldFx(overlay, icon, descText, cx, cy - 115, soldPrice, 34, onDone);
        else onDone();
      },
    });
  }

  // 自動賣出特效：等翻牌動畫播完之後，圖示原地翻轉縮小消失、原位置冒出一枚放大
  // 彈跳的金幣圖案，說明文字換成「已自動賣出 +N 金幣」，呼應「翻成金幣」的感覺。
  _playSoldFx(overlay, icon, infoText, iconX, iconY, soldPrice, coinFontSize, onDone) {
    this.tweens.add({
      targets: icon, scaleX: 0, angle: 360, duration: 260, ease: 'Cubic.easeIn',
    });
    const coin = this.add.text(iconX, iconY, '💰', textStyle({ fontSize: `${coinFontSize}px` }))
      .setOrigin(0.5).setScale(0);
    overlay.add(coin);
    this.tweens.add({
      targets: coin, scale: 1.3, duration: 300, delay: 220, ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({ targets: coin, scale: 1, duration: 140 }),
    });
    infoText.setText(`💰 已自動賣出 +${soldPrice.toLocaleString()} 金幣`);
    infoText.setColor('#ffd93d');
    this.tweens.add({
      targets: infoText, scale: 1.25, duration: 200, delay: 220, ease: 'Back.easeOut', yoyo: true,
      onComplete: onDone,
    });
  }

  // 十抽網格用的小卡片：比較簡單的縮放淡入，避免十張同時大爆閃洗版面。
  // result = { id, sold, soldPrice }；sold 的話淡入結束後圖示會翻成金幣圖案，
  // 名稱下方多冒出一行「+售出金額」。
  _revealSmallCard(overlay, cx, cy, cardW, cardH, result) {
    const { id, sold, soldPrice } = result;
    const def = EQUIPMENT_DATA[id];
    const rarity = RARITY_DATA[def.rarity] || RARITY_DATA.common;
    // 同樣要避免 setDisplaySize() 後又整個蓋掉 scale（見 _revealSingleCard 的說明）。
    const card = this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH).setAlpha(0);
    const cardScaleX = card.scaleX, cardScaleY = card.scaleY;
    card.setScale(cardScaleX * 0.5, cardScaleY * 0.5);
    const frame = createRarityFrame(this, cx, cy, cardW - 6, cardH - 6, def.rarity).setScale(0.5).setAlpha(0);
    const icon = this.add.image(cx, cy - cardH * 0.16, def.icon).setScale(0.51).setAlpha(0);
    const rarityHex = '#' + rarity.color.toString(16).padStart(6, '0');
    const nameText = this.add.text(cx, cy + cardH * 0.24, def.name, textStyle({
      fontSize: '18px', color: rarityHex, align: 'center',
      wordWrap: { width: cardW - 20, useAdvancedWrap: true },
    })).setOrigin(0.5).setAlpha(0);
    overlay.add([card, frame, icon, nameText]);
    this.tweens.add({ targets: frame, scale: 1, alpha: 1, duration: 320, ease: 'Back.easeOut' });
    this.tweens.add({ targets: card, scaleX: cardScaleX, scaleY: cardScaleY, alpha: 1, duration: 320, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: [icon, nameText], alpha: 1, duration: 320, ease: 'Cubic.easeOut',
      onComplete: sold ? () => this._playSmallSoldFx(overlay, icon, cx, cy, cardH, soldPrice) : undefined,
    });
  }

  // 十抽小卡片版的自動賣出特效：圖示翻轉縮小消失，原位置冒出金幣圖案，
  // 名稱下方補一行黃色的「+售出金額」。
  _playSmallSoldFx(overlay, icon, cx, cy, cardH, soldPrice) {
    this.tweens.add({ targets: icon, scaleX: 0, angle: 360, duration: 220, ease: 'Cubic.easeIn' });
    const coin = this.add.text(cx, cy - cardH * 0.16, '💰', textStyle({ fontSize: '22px' }))
      .setOrigin(0.5).setScale(0);
    overlay.add(coin);
    this.tweens.add({ targets: coin, scale: 1, duration: 260, delay: 180, ease: 'Back.easeOut' });
    const priceText = this.add.text(cx, cy + cardH * 0.4, `+${soldPrice.toLocaleString()}`, textStyle({
      fontSize: '17px', color: '#ffd93d',
    })).setOrigin(0.5).setScale(0);
    overlay.add(priceText);
    this.tweens.add({ targets: priceText, scale: 1, duration: 260, delay: 180, ease: 'Back.easeOut' });
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
