import { EQUIPMENT_DATA, getSelfPickPool } from '../equipment/EquipmentData.js';
import { getInventory, setInventory, addItemToInventory } from '../managers/SaveManager.js';
import { createRarityFrame } from '../utils/RarityFrame.js';
import { textStyle } from '../utils/TextStyle.js';

// 開球畫面：InventoryScene 雙擊活動獎勵球（紅球=神話自選／金球=傳說自選）跳確認
// 彈窗後才會進來這裡。流程：華麗開球特效（參考 ShopScene 抽到傳說/神話裝備的
// 出場演出手法）→ 自選裝備清單（神話池只有 2 件、傳說池 25 件裝備+2 枚戒指共
// 27 件，見 EquipmentData.getSelfPickPool）→ 確認選擇。
//
// 球要等「確認選擇」真的成功塞進背包之後才會從原本的格子移除——避免背包剛好
// 滿了的情況下，球被白白吃掉卻拿不到任何獎勵。
export default class LootBallOpenScene extends Phaser.Scene {
  constructor() { super('LootBallOpenScene'); }

  init(data) {
    this.itemId = data.itemId;
    this.invIdx = data.invIdx;
    this.ballDef = EQUIPMENT_DATA[this.itemId];
    this.selectedId = null;
  }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x0a0e16, 0.96);
    this._playOpenFx(() => this._showPicker());
  }

  // 球先在畫面中央發光放大旋轉，接著全畫面色光一閃＋一圈旋轉光芒炸開，球本體
  // 碎開消失，才進到自選畫面——手法借用 ShopScene 抽到傳說/神話裝備時的出場特效
  // （光柱／旋轉光芒／連環光環），改寫成「球破殼」的版本，維持全遊戲抽獎演出風格一致。
  _playOpenFx(onDone) {
    const w = this.scale.width, h = this.scale.height;
    const cx = w / 2, cy = h / 2;
    const isMythic = this.ballDef.rarity === 'mythic';
    const color = isMythic ? 0xff3b3b : 0xffb830;

    const ball = this.add.image(cx, cy, this.ballDef.icon).setScale(0);
    this.tweens.add({ targets: ball, scale: 2.4, duration: 500, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: ball, angle: 360, duration: 900, ease: 'Cubic.easeIn', delay: 500,
      onComplete: () => {
        const flash = this.add.rectangle(cx, cy, w, h, color, 0.4).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: flash, alpha: 0, duration: 500, onComplete: () => flash.destroy() });

        const rays = this.add.container(cx, cy);
        for (let i = 0; i < 14; i++) {
          const ray = this.add.rectangle(0, 0, 620, 22, color, 0.3)
            .setBlendMode(Phaser.BlendModes.ADD).setOrigin(0, 0.5).setRotation((i / 14) * Math.PI * 2);
          rays.add(ray);
        }
        rays.setScale(0.2).setAlpha(0);
        this.tweens.add({ targets: rays, scale: 1, alpha: 1, duration: 300, ease: 'Back.easeOut' });
        this.tweens.add({ targets: rays, angle: 40, duration: 1600, ease: 'Linear' });
        this.tweens.add({ targets: rays, alpha: 0, duration: 400, delay: 900, onComplete: () => rays.destroy() });

        this.cameras.main.flash(300, 255, isMythic ? 60 : 190, isMythic ? 60 : 60);
        this.tweens.add({
          targets: ball, scale: 0, alpha: 0, duration: 300, delay: 150, ease: 'Cubic.easeIn',
          onComplete: () => { ball.destroy(); onDone(); },
        });
      },
    });
  }

  // 自選清單：cols 上限 9，超過就自動換行，27 件裝備剛好排成 9x3 不用捲動。
  _showPicker() {
    const w = this.scale.width, h = this.scale.height;
    const isMythic = this.ballDef.ballTier === 'mythic';
    const items = getSelfPickPool(this.ballDef.ballTier);

    this.add.text(w / 2, 60, `🎉 自選一件${isMythic ? '神話' : '傳說'}裝備`, textStyle({
      fontSize: '42px', color: isMythic ? '#ff6b6b' : '#ffd93d', fontStyle: 'bold',
    })).setOrigin(0.5);
    this.add.text(w / 2, 108, '滑鼠移到圖示上可看說明，點選後按下方「確認選擇」', textStyle({
      fontSize: '18px', color: '#9fd3ff',
    })).setOrigin(0.5);

    const cols = Math.min(9, items.length);
    const rows = Math.ceil(items.length / cols);
    const cellSize = 112, gap = 16;
    const gridW = cols * cellSize + (cols - 1) * gap;
    const gridH = rows * cellSize + (rows - 1) * gap;
    const startX = w / 2 - gridW / 2 + cellSize / 2;
    const startY = h / 2 - gridH / 2;

    this.cellFrames = {};
    items.forEach((def, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const cx = startX + col * (cellSize + gap);
      const cy = startY + row * (cellSize + gap);
      const bg = this.add.image(cx, cy, 'ui_slot').setDisplaySize(cellSize - 6, cellSize - 6).setInteractive({ useHandCursor: true });
      const frame = createRarityFrame(this, cx, cy, cellSize, cellSize, def.rarity).setVisible(false);
      this.add.image(cx, cy, def.icon).setDisplaySize(cellSize - 22, cellSize - 22);
      this.cellFrames[def.id] = frame;

      bg.on('pointerover', () => { bg.setTint(0xffe066); this._showItemTooltip(cx, cy - cellSize / 2, def); });
      bg.on('pointerout', () => { bg.clearTint(); this._hideItemTooltip(); });
      bg.on('pointerdown', () => this._selectItem(def.id));
    });

    this.selectedNameText = this.add.text(w / 2, startY + gridH / 2 + cellSize / 2 + 36, '請選擇一件裝備', textStyle({
      fontSize: '24px', color: '#cfe9ff',
    })).setOrigin(0.5);

    this.confirmBtn = this.add.image(w / 2, h - 80, 'ui_button_parchment').setDisplaySize(240, 60).setInteractive({ useHandCursor: true }).setAlpha(0.5);
    this.add.text(w / 2, h - 80, '確認選擇', textStyle({ fontSize: '26px', color: '#3a2413' })).setOrigin(0.5);
    this.confirmBtn.on('pointerover', () => { if (this.selectedId) this.confirmBtn.setTint(0xfff3d0); });
    this.confirmBtn.on('pointerout', () => this.confirmBtn.clearTint());
    this.confirmBtn.on('pointerdown', () => this._confirmPick());
  }

  _selectItem(id) {
    this.selectedId = id;
    Object.entries(this.cellFrames).forEach(([itemId, frame]) => frame.setVisible(itemId === id));
    this.selectedNameText.setText(`已選擇：${EQUIPMENT_DATA[id].name}`);
    this.confirmBtn.setAlpha(1);
  }

  _showItemTooltip(x, y, def) {
    this._hideItemTooltip();
    const text = this.add.text(x, y - 10, `${def.name}\n${def.desc}`, textStyle({
      fontSize: '15px', color: '#ffe066', align: 'center',
      wordWrap: { width: 260, useAdvancedWrap: true },
    })).setOrigin(0.5, 1).setDepth(3001);
    const bg = this.add.rectangle(text.x, text.y - text.height / 2, text.width + 20, text.height + 16, 0x0a0e16, 0.92)
      .setStrokeStyle(2, 0xffd700, 0.8).setDepth(3000);
    this._itemTooltip = [bg, text];
  }

  _hideItemTooltip() {
    if (this._itemTooltip) { this._itemTooltip.forEach((o) => o.destroy()); this._itemTooltip = null; }
  }

  // 背包滿了就不消耗球、不扣選擇，讓玩家清出空間後可以再按一次確認——
  // 球只有在真的塞進背包成功之後，才會從原本的格子移除。
  _confirmPick() {
    if (!this.selectedId) return;
    if (!addItemToInventory(this.selectedId)) {
      this._showToast('背包已滿，請先清出空間再確認選擇');
      return;
    }
    const inv = getInventory();
    if (inv[this.invIdx] === this.itemId) {
      inv[this.invIdx] = null;
      setInventory(inv);
    }
    this._playGrantFx(EQUIPMENT_DATA[this.selectedId]);
  }

  _playGrantFx(def) {
    const w = this.scale.width, h = this.scale.height;
    this.children.removeAll(true);
    this.add.rectangle(w / 2, h / 2, w, h, 0x0a0e16, 0.96);

    const flash = this.add.circle(w / 2, h / 2, 10, 0xffd700, 0.9);
    this.tweens.add({ targets: flash, radius: 300, alpha: 0, duration: 500, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });

    const frame = createRarityFrame(this, w / 2, h / 2 - 60, 220, 220, def.rarity).setScale(0.3).setAlpha(0);
    const icon = this.add.image(w / 2, h / 2 - 60, def.icon).setScale(0).setAlpha(0);
    const nameText = this.add.text(w / 2, h / 2 + 90, def.name, textStyle({ fontSize: '34px', color: '#ffe066' })).setOrigin(0.5).setAlpha(0);
    const gotText = this.add.text(w / 2, h / 2 + 140, '🎉 已獲得，收進背包了！', textStyle({ fontSize: '24px', color: '#5bff8f' })).setOrigin(0.5).setAlpha(0);

    this.tweens.add({ targets: frame, scale: 1, alpha: 1, duration: 420, ease: 'Back.easeOut', delay: 120 });
    this.tweens.add({ targets: icon, scale: 1.4, alpha: 1, duration: 420, ease: 'Back.easeOut', delay: 200 });
    this.tweens.add({ targets: [nameText, gotText], alpha: 1, duration: 380, delay: 420 });

    const backBtn = this.add.image(w / 2, h - 90, 'ui_button_parchment').setDisplaySize(220, 60).setInteractive({ useHandCursor: true }).setAlpha(0);
    const backText = this.add.text(w / 2, h - 90, '返回背包', textStyle({ fontSize: '24px', color: '#3a2413' })).setOrigin(0.5).setAlpha(0);
    this.tweens.add({ targets: [backBtn, backText], alpha: 1, duration: 380, delay: 700 });
    backBtn.on('pointerover', () => backBtn.setTint(0xfff3d0));
    backBtn.on('pointerout', () => backBtn.clearTint());
    backBtn.on('pointerdown', () => this.scene.start('InventoryScene'));
  }

  _showToast(msg) {
    const w = this.scale.width, h = this.scale.height;
    const t = this.add.text(w / 2, h - 160, msg, textStyle({ fontSize: '22px', color: '#ff9a9a' })).setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, duration: 1400, delay: 600, onComplete: () => t.destroy() });
  }
}
