import {
  EQUIPMENT_DATA, EQUIP_SLOTS, SLOT_LABELS, EQUIP_LINES, RARITY_DATA, rollGachaItem,
  GACHA_RARITY_WEIGHTS, GACHA_POOL_BY_RARITY, RARITY_IDS, SELL_PRICES,
} from '../equipment/EquipmentData.js';
import {
  getGold, spendGold, addGold, isItemOwned, upgradeEquipment, addItemToInventory, getInventory,
  getAutoSellRarities, setAutoSellRarities, getGachaPity, setGachaPity,
} from '../managers/SaveManager.js';
import { textStyle } from '../utils/TextStyle.js';
import { createRarityFrame } from '../utils/RarityFrame.js';

const GACHA_SINGLE_PRICE = 1000;
const GACHA_TEN_PRICE = 9000;
const GACHA_PITY_LIMIT = 100; // 保底：連續抽這麼多次沒出傳說（或更高）以上，下一抽強制出一件傳說

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

    // 扭蛋機改用正式美術圖（原始解析度較大且長寬比跟舊版程式圖示不同，用
    // setDisplaySize 固定顯示高度、保留原圖比例，避免直接套用舊的 setScale
    // 數字把面板撐爆），整體往上收，騰出空間給下面的保底進度文字。
    const gachaImg = this.add.image(cx, panelTop + 240, 'gacha_machine');
    const gachaDisplayH = 330;
    gachaImg.setDisplaySize(gachaDisplayH * (gachaImg.width / gachaImg.height), gachaDisplayH);

    this.pityText = this.add.text(cx, panelTop + 448, '', textStyle({
      fontSize: '22px', color: '#ffd93d',
    })).setOrigin(0.5);
    this._refreshPityText();

    const btnW = panelW - 100;
    this._buildGachaButton(cx, panelTop + 508, btnW, `一抽　💰 ${GACHA_SINGLE_PRICE}`, () => this._gachaPull(1, GACHA_SINGLE_PRICE));
    this._buildGachaButton(cx, panelTop + 588, btnW, `十抽　💰 ${GACHA_TEN_PRICE}`, () => this._gachaPull(10, GACHA_TEN_PRICE));

    // 道具機率表按鈕：純資訊查詢入口，刻意做成跟上面兩顆羊皮紙「花錢抽獎」按鈕
    // 不同的深色底＋粉紅描邊樣式（呼應扭蛋面板的粉紅主題），一眼就分得出
    // 「這顆不用錢、是看說明的」。
    const infoBtnY = panelTop + 664;
    const infoBtn = this.add.rectangle(cx, infoBtnY, btnW, 54, 0x2a1a2e, 1)
      .setStrokeStyle(2, 0xff9ad6, 0.9).setInteractive({ useHandCursor: true });
    this.add.text(cx, infoBtnY, '📊 道具機率表', textStyle({ fontSize: '22px', color: '#ff9ad6' })).setOrigin(0.5);
    infoBtn.on('pointerover', () => infoBtn.setFillStyle(0x45294a, 1));
    infoBtn.on('pointerout', () => infoBtn.setFillStyle(0x2a1a2e, 1));
    infoBtn.on('pointerdown', () => this._showDropList());

    this._buildAutoSellRow(cx, panelTop + 780, panelW - 40);
  }

  // 自動賣出勾選列：勾起來的稀有度，扭蛋抽到時直接原地換成金幣（見 _gachaPull），
  // 不會佔背包格子。只開放普通/優秀/稀有/史詩四階，傳說/神話太稀有，不給誤勾賣掉。
  _buildAutoSellRow(cx, cy, rowW) {
    this.autoSellSet = new Set(getAutoSellRarities());
    this.add.text(cx, cy - 36, '扭蛋抽到時自動賣出：', textStyle({
      fontSize: '20px', color: '#9fd3ff',
    })).setOrigin(0.5);

    const rarities = ['common', 'uncommon', 'rare', 'epic'];
    const colW = rowW / rarities.length;
    this.autoSellBoxes = {};
    rarities.forEach((rarity, i) => {
      const rx = cx - rowW / 2 + colW * i + colW / 2;
      const rarityDef = RARITY_DATA[rarity];
      const hex = '#' + rarityDef.color.toString(16).padStart(6, '0');
      const box = this.add.image(rx, cy, 'ui_equip_slot').setDisplaySize(36, 36).setInteractive({ useHandCursor: true });
      const check = this.add.text(rx, cy, '✓', textStyle({ fontSize: '26px', color: '#5bff8f' })).setOrigin(0.5);
      this.add.text(rx, cy + 32, rarityDef.label, textStyle({ fontSize: '18px', color: hex })).setOrigin(0.5);
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

  // 更新保底進度顯示：目前連續多少抽沒出傳說（或更高）以上，滿 GACHA_PITY_LIMIT
  // 下一抽就會強制出傳說（見 _gachaPull）。
  _refreshPityText() {
    if (!this.pityText) return;
    const pity = getGachaPity();
    this.pityText.setText(`保底進度：${pity}/${GACHA_PITY_LIMIT}（滿了下一抽必出傳說）`);
  }

  _refreshAutoSellBoxes() {
    Object.entries(this.autoSellBoxes).forEach(([rarity, check]) => {
      check.setVisible(this.autoSellSet.has(rarity));
    });
  }

  // 道具機率表：整畫面覆蓋層，參考一般手遊的抽卡機率公示排版——每個稀有度一欄，
  // 欄首是「稀有度色帶＋總機率」的標題區塊，下面標示件數與單件機率，清單只列
  // 道具圖示＋名稱＋單件機率，仿照手遊常見的「提供比例」單欄捲動清單排版
  // （六個稀有度由上到下依序列出，各自先是一列稀有度色帶＋總機率的標題列，
  // 再列出該階所有道具），取代舊版「擠成 6 欄看不清楚」的並排表格。
  _showDropList() {
    const w = this.scale.width, h = this.scale.height;
    const overlay = this.add.container(0, 0).setDepth(9500);
    overlay.add(this.add.rectangle(w / 2, h / 2, w, h, 0x0a0c12, 0.95).setInteractive());
    overlay.add(this.add.text(w / 2, 40, '📊 道具機率表', textStyle({
      fontSize: '34px', color: '#ff9ad6',
    })).setOrigin(0.5));
    overlay.add(this.add.text(w / 2, 80, '每次抽獎先依各稀有度的機率決定階級，再從該階級的道具池中均勻隨機抽出一件', textStyle({
      fontSize: '19px', color: '#8fa3b8',
    })).setOrigin(0.5));

    // 可捲動清單區域：listContent 裡的所有列由上往下堆疊，超出可視範圍的部分
    // 用 Geometry Mask 裁掉，滑鼠滾輪捲動整個 listContent（見下面 onWheel）。
    const listX = w / 2, listW = Math.min(920, w - 240);
    const viewTop = 116, viewBottom = h - 88;
    const viewH = viewBottom - viewTop;
    const rowH = 56, headerH = 48;

    const listContent = this.add.container(listX, viewTop);
    overlay.add(listContent);

    let y = 0;
    // 由上到下神話→傳說→...→普通（由高到低），跟玩家「先看想要的稀有度」的
    // 習慣一致；RARITY_IDS 本身是共用常數（其他地方也用得到，見 InventoryScene），
    // 這裡另外複製一份反轉，不動到原本的順序。
    const displayOrder = [...RARITY_IDS].reverse();
    displayOrder.forEach((rarityId) => {
      const rarity = RARITY_DATA[rarityId];
      const pool = GACHA_POOL_BY_RARITY[rarityId] || [];
      const weight = GACHA_RARITY_WEIGHTS[rarityId] || 0;
      const hex = '#' + rarity.color.toString(16).padStart(6, '0');

      // 稀有度標題列：色帶底＋名稱（左）＋總機率（右）
      listContent.add(this.add.rectangle(0, y + headerH / 2, listW, headerH, rarity.color, 0.16)
        .setStrokeStyle(2, rarity.color, 0.9));
      listContent.add(this.add.text(-listW / 2 + 24, y + headerH / 2, rarity.label, textStyle({
        fontSize: '25px', color: hex, fontStyle: 'bold',
      })).setOrigin(0, 0.5));
      listContent.add(this.add.text(listW / 2 - 24, y + headerH / 2, `${weight}%（共 ${pool.length} 件）`, textStyle({
        fontSize: '19px', color: hex,
      })).setOrigin(1, 0.5));
      y += headerH + 8;

      // 單件機率（總機率平均分給池內每一件）
      const per = pool.length ? weight / pool.length : 0;
      const perStr = per >= 0.1 ? per.toFixed(2) : per.toFixed(3);

      pool.forEach((id) => {
        const item = EQUIPMENT_DATA[id];
        const rowCy = y + rowH / 2;
        listContent.add(this.add.rectangle(0, rowCy, listW, rowH - 6, 0x161a24, 0.65));
        listContent.add(this.add.image(-listW / 2 + 38, rowCy, item.icon).setDisplaySize(42, 42));
        listContent.add(this.add.text(-listW / 2 + 70, rowCy, item.name, textStyle({
          fontSize: '19px', color: '#cfe9ff',
        })).setOrigin(0, 0.5));
        listContent.add(this.add.text(listW / 2 - 24, rowCy, `${perStr}%`, textStyle({
          fontSize: '18px', color: '#8fa3b8',
        })).setOrigin(1, 0.5));
        y += rowH;
      });

      y += 20; // 稀有度區塊之間留白
    });

    const totalContentH = y;
    const maxScroll = Math.max(0, totalContentH - viewH);

    const maskShape = this.make.graphics().fillRect(listX - listW / 2 - 30, viewTop, listW + 60, viewH);
    listContent.setMask(maskShape.createGeometryMask());

    // 右側細長滾動軸：拇指高度依可視比例縮放，位置跟著 listContent 捲動同步，
    // 提示玩家「這裡可以滾動」，不然滑鼠滾輪這個互動方式不夠明顯。
    let scrollThumb = null;
    if (maxScroll > 0) {
      const trackX = listX + listW / 2 + 18, trackTop = viewTop, trackH = viewH;
      overlay.add(this.add.rectangle(trackX, trackTop + trackH / 2, 6, trackH, 0xffffff, 0.12));
      const thumbH = Math.max(40, (viewH / totalContentH) * trackH);
      scrollThumb = this.add.rectangle(trackX, trackTop + thumbH / 2, 6, thumbH, 0xff9ad6, 0.8);
      overlay.add(scrollThumb);
    }

    const applyScroll = (scrollY) => {
      const clamped = Phaser.Math.Clamp(scrollY, 0, maxScroll);
      listContent.y = viewTop - clamped;
      if (scrollThumb) {
        const ratio = maxScroll > 0 ? clamped / maxScroll : 0;
        const trackTop = viewTop, trackH = viewH;
        const thumbH = scrollThumb.height;
        scrollThumb.y = trackTop + thumbH / 2 + ratio * (trackH - thumbH);
      }
    };
    let scrollY = 0;
    const onWheel = (pointer, gameObjects, deltaX, deltaY) => {
      scrollY += deltaY * 0.6;
      applyScroll(scrollY);
    };
    this.input.on('wheel', onWheel);

    // 關閉鈕沿用「深色底＋粉紅描邊」的資訊按鈕樣式，跟開啟它的那顆按鈕成對；
    // 關閉時要把滾輪監聽跟遮罩用的 Graphics 一起清掉，避免離開這個畫面之後
    // 滾輪還在影響（已被銷毀的）清單、或 Graphics 物件變成孤兒殘留在記憶體裡。
    const closeBtn = this.add.rectangle(w / 2, h - 52, 220, 54, 0x2a1a2e, 1)
      .setStrokeStyle(2, 0xff9ad6, 0.9).setInteractive({ useHandCursor: true });
    overlay.add(closeBtn);
    overlay.add(this.add.text(w / 2, h - 52, '關閉', textStyle({ fontSize: '24px', color: '#ff9ad6' })).setOrigin(0.5));
    closeBtn.on('pointerover', () => closeBtn.setFillStyle(0x45294a, 1));
    closeBtn.on('pointerout', () => closeBtn.setFillStyle(0x2a1a2e, 1));
    closeBtn.on('pointerdown', () => {
      this.input.off('wheel', onWheel);
      maskShape.destroy();
      overlay.destroy();
    });
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
    // 保底：每一抽都讓保底計數 +1，抽到傳說或神話就歸零；計數滿 GACHA_PITY_LIMIT
    // 還沒歸零，這一抽直接強制出傳說（不再走機率表），確保連續衰運最多 100 抽
    // 就一定能拿到一件傳說。
    let pity = getGachaPity();
    const results = [];
    for (let i = 0; i < times; i++) {
      pity += 1;
      const forceLegendary = pity >= GACHA_PITY_LIMIT;
      const id = rollGachaItem(forceLegendary ? 'legendary' : undefined);
      const rarity = EQUIPMENT_DATA[id].rarity;
      if (rarity === 'legendary' || rarity === 'mythic') pity = 0;
      if (autoSellSet.has(rarity)) {
        const soldPrice = SELL_PRICES[rarity];
        addGold(soldPrice);
        results.push({ id, sold: true, soldPrice });
      } else {
        addItemToInventory(id);
        results.push({ id, sold: false });
      }
    }
    setGachaPity(pity);
    this._refreshPityText();
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
  // 傳說/神話另外先播一段盛大的出場特效（光柱＋旋轉光芒＋連環光環，見
  // _playRareEntranceFx），卡片本體延後 900ms 才翻出來，做出「抽到大獎」的儀式感。
  _revealSingleCard(overlay, cx, cy, result, onDone) {
    const { id, sold, soldPrice } = result;
    const def = EQUIPMENT_DATA[id];
    const rarity = RARITY_DATA[def.rarity] || RARITY_DATA.common;
    const rarityHex = '#' + rarity.color.toString(16).padStart(6, '0');
    const cardW = 380, cardH = 460; // 單抽卡片放大一圈，開獎瞬間份量感更足
    const isRare = def.rarity === 'legendary' || def.rarity === 'mythic';
    const rareDelay = isRare ? 900 : 0;
    if (isRare) this._playRareEntranceFx(overlay, cx, cy, def.rarity, 1);

    const flash = this.add.circle(cx, cy, 10, rarity.color, 0.9);
    overlay.add(flash);
    this.tweens.add({
      targets: flash, radius: 260, alpha: 0, duration: 500, ease: 'Cubic.easeOut',
      delay: rareDelay,
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

    this.tweens.add({ targets: frame, scale: 1, alpha: 1, duration: 420, ease: 'Back.easeOut', delay: 120 + rareDelay });
    this.tweens.add({ targets: card, scaleX: cardScaleX, scaleY: cardScaleY, alpha: 1, duration: 420, ease: 'Back.easeOut', delay: 120 + rareDelay });
    this.tweens.add({ targets: icon, scale: 0.87, alpha: 1, duration: 420, ease: 'Back.easeOut', delay: 200 + rareDelay });
    this.tweens.add({
      targets: [rarityLabel, nameText, descText], alpha: 1, duration: 380, delay: 420 + rareDelay,
      onComplete: () => {
        if (sold) this._playSoldFx(overlay, icon, descText, cx, cy - 115, soldPrice, 34, onDone);
        else onDone();
      },
    });
  }

  // 傳說/神話抽卡出場特效：參考其他遊戲抽到大獎的演出——全畫面色光一閃、
  // 一道光柱從畫面頂端打到卡片位置、卡片背後展開一圈慢慢旋轉的放射光芒、
  // 中心連環炸出多層擴散光環＋大量碎片，最後卡片才翻出來（翻牌延遲由呼叫端控制）。
  // 傳說＝金色系，神話＝紅色系再多疊一層金色光環，比傳說更誇張一階。
  _playRareEntranceFx(overlay, cx, cy, rarityId, scale = 1) {
    const isMythic = rarityId === 'mythic';
    const color = isMythic ? 0xff3b3b : 0xffb830;
    const w = this.scale.width, h = this.scale.height;

    // 全畫面色光一閃：告訴玩家「這一抽不一樣」
    const screenFlash = this.add.rectangle(w / 2, h / 2, w, h, color, 0.32)
      .setBlendMode(Phaser.BlendModes.ADD);
    overlay.add(screenFlash);
    this.tweens.add({ targets: screenFlash, alpha: 0, duration: 550, onComplete: () => screenFlash.destroy() });

    // 從畫面頂端打下來的光柱，落在卡片位置後慢慢收掉
    const beam = this.add.rectangle(cx, cy / 2, 110 * scale, cy, color, 0.55)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(0.08, 1);
    overlay.add(beam);
    this.tweens.add({ targets: beam, scaleX: 1, duration: 220, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: beam, alpha: 0, duration: 350, delay: 550, onComplete: () => beam.destroy() });

    // 卡片背後的放射狀光芒：12 道長條光束繞著中心慢慢旋轉，整段出場期間都亮著
    const rays = this.add.container(cx, cy).setDepth(1);
    for (let i = 0; i < 12; i++) {
      const ray = this.add.rectangle(0, 0, 460 * scale, 20 * scale, color, 0.28)
        .setBlendMode(Phaser.BlendModes.ADD).setOrigin(0, 0.5).setRotation((i / 12) * Math.PI * 2);
      rays.add(ray);
    }
    rays.setScale(0.2).setAlpha(0);
    overlay.add(rays);
    this.tweens.add({ targets: rays, scale: 1, alpha: 1, duration: 320, ease: 'Back.easeOut' });
    this.tweens.add({ targets: rays, angle: 60, duration: 2400, ease: 'Linear' });
    this.tweens.add({ targets: rays, alpha: 0, duration: 500, delay: 1900, onComplete: () => rays.destroy() });

    // 連環擴散光環：三波錯開時間往外炸，神話多疊一圈金色，做出「比傳說更高一階」的差異
    const ringWaves = isMythic ? [color, 0xffd700, color] : [color, 0xffe9b0, color];
    ringWaves.forEach((ringColor, i) => {
      const ring = this.add.image(cx, cy, 'fx_bossdeath').setTint(ringColor)
        .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.85).setScale(0.2);
      overlay.add(ring);
      this.tweens.add({
        targets: ring, scale: (5.5 + i * 1.5) * scale, alpha: 0, duration: 700,
        delay: i * 180, ease: 'Cubic.easeOut', onComplete: () => ring.destroy(),
      });
    });

    // 大量碎片從中心往外噴，數量比一般開獎多一截
    for (let i = 0; i < 22; i++) {
      const ang = Math.random() * Math.PI * 2;
      const distR = (90 + Math.random() * 190) * scale;
      const p = this.add.image(cx, cy, 'fx_crit').setTint(i % 3 === 0 ? 0xffffff : color)
        .setBlendMode(Phaser.BlendModes.ADD).setScale(0.5 + Math.random() * 0.7).setAlpha(0.95);
      overlay.add(p);
      this.tweens.add({
        targets: p,
        x: cx + Math.cos(ang) * distR, y: cy + Math.sin(ang) * distR,
        alpha: 0, scale: 0.15, duration: 620 + Math.random() * 260,
        delay: Math.random() * 150, ease: 'Cubic.easeOut',
        onComplete: () => p.destroy(),
      });
    }
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
    // 十抽滾到傳說/神話時，這格也播一份縮小版的出場特效（光柱＋光芒＋光環），
    // 讓玩家一眼掃過十張卡片牆就知道「這格是大獎」。
    if (def.rarity === 'legendary' || def.rarity === 'mythic') {
      this._playRareEntranceFx(overlay, cx, cy, def.rarity, 0.45);
    }
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
