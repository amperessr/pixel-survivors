import { WEAPON_IDS, WEAPON_DATA } from '../weapons/WeaponData.js';
import { PASSIVE_IDS, PASSIVE_DATA, passiveLevelValue } from '../skills/PassiveData.js';
import { choice } from '../utils/MathUtils.js';

export default class LevelUpScene extends Phaser.Scene {
  constructor() { super('LevelUpScene'); }

  init(data) {
    this.gs = data.gameScene;
    this.weaponSystem = data.weaponSystem;
  }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.72).setScrollFactor(0);
    this.add.text(w / 2, h * 0.18, '升 級！選擇一項強化', {
      fontSize: '36px', color: '#6fd3ff', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);

    const options = this._buildOptions();
    const cardW = 280, gap = 40;
    const totalW = options.length * cardW + (options.length - 1) * gap;
    let startX = w / 2 - totalW / 2 + cardW / 2;
    const cy = h / 2 + 30;

    options.forEach((opt, i) => {
      const cx = startX + i * (cardW + gap);
      const card = this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, 320).setInteractive({ useHandCursor: true }).setScrollFactor(0);
      this.add.image(cx, cy - 95, opt.icon).setScale((opt.iconScale || 1.6) * 1.3).setScrollFactor(0);
      this.add.text(cx, cy - 25, opt.title, {
        fontSize: '18px', color: '#fff', fontStyle: 'bold', align: 'center', wordWrap: { width: 240 },
      }).setOrigin(0.5).setScrollFactor(0);
      this.add.text(cx, cy + 65, opt.desc, {
        fontSize: '14px', color: '#9fd3ff', align: 'center', wordWrap: { width: 240 },
      }).setOrigin(0.5).setScrollFactor(0);

      card.on('pointerover', () => card.setTint(0xbfe9ff));
      card.on('pointerout', () => card.clearTint());
      card.on('pointerdown', () => this._select(opt));
    });
  }

  _buildOptions() {
    const owned = this.weaponSystem.owned;
    const pool = [];

    // 新武器選項
    for (const id of WEAPON_IDS) {
      if (!owned[id]) {
        pool.push({
          type: 'newWeapon', id,
          title: `新武器：${WEAPON_DATA[id].name}`,
          desc: WEAPON_DATA[id].desc,
          icon: `weapon_${id}_lv1`,
        });
      }
    }
    // 武器升級選項
    for (const id of Object.keys(owned)) {
      if (owned[id] < 5) {
        pool.push({
          type: 'upgradeWeapon', id,
          title: `${WEAPON_DATA[id].name} 升級 → Lv${owned[id] + 1}`,
          desc: WEAPON_DATA[id].desc,
          icon: `weapon_${id}_lv${owned[id]}`,
        });
      }
    }
    // 被動能力選項
    for (const id of PASSIVE_IDS) {
      const lvl = this.gs.player.passiveLevels[id] || 0;
      if (lvl < 5) {
        pool.push({
          type: 'passive', id,
          title: `${PASSIVE_DATA[id].name} Lv${lvl + 1}`,
          desc: PASSIVE_DATA[id].desc,
          icon: PASSIVE_DATA[id].icon,
          iconScale: 3,
        });
      }
    }

    // 隨機挑選 3 個不重複選項；若不足則以回復生命補足
    const picked = [];
    const shuffled = pool.sort(() => Math.random() - 0.5);
    for (const opt of shuffled) {
      if (picked.length >= 3) break;
      picked.push(opt);
    }
    while (picked.length < 3) {
      picked.push({
        type: 'heal', id: 'heal',
        title: '生命藥水',
        desc: '立即回復 40% 最大生命值',
        icon: 'icon_moveSpeed',
        iconScale: 3,
      });
    }
    return picked;
  }

  _select(opt) {
    if (opt.type === 'newWeapon' || opt.type === 'upgradeWeapon') {
      this.weaponSystem.addOrUpgrade(opt.id);
    } else if (opt.type === 'passive') {
      const value = passiveLevelValue(opt.id, 1);
      this.gs.player.applyPassiveBonus(opt.id, value);
    } else if (opt.type === 'heal') {
      const p = this.gs.player;
      p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * 0.4);
    }
    this.gs.resumeFromLevelUp();
    this.scene.stop();
  }
}
