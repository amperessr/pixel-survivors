import { WEAPON_IDS, WEAPON_DATA, WEAPON_EVOLUTIONS, findFusionFor } from '../weapons/WeaponData.js';
import { PASSIVE_IDS, PASSIVE_DATA, MAX_PASSIVE_LEVEL, passiveLevelValue } from '../skills/PassiveData.js';
import { textStyle } from '../utils/TextStyle.js';

export default class LevelUpScene extends Phaser.Scene {
  constructor() { super('LevelUpScene'); }

  init(data) {
    this.gs = data.gameScene;
    this.weaponSystem = data.weaponSystem;
  }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.78).setScrollFactor(0);
    this.add.text(w / 2, h * 0.12, '升 級！選擇一項強化', textStyle({
      fontSize: '64px', color: '#6fd3ff',
    })).setOrigin(0.5).setScrollFactor(0);

    const options = this._buildOptions();
    const cardW = 460, cardH = 620, gap = 50;
    const totalW = options.length * cardW + (options.length - 1) * gap;
    let startX = w / 2 - totalW / 2 + cardW / 2;
    const cy = h / 2 + 60;

    options.forEach((opt, i) => {
      const cx = startX + i * (cardW + gap);
      const card = this.add.image(cx, cy, 'ui_card').setDisplaySize(cardW, cardH).setInteractive({ useHandCursor: true }).setScrollFactor(0);
      if (opt.type === 'evolveWeapon') {
        // 進化選項用金色外框強調，讓玩家一眼認出這是特殊選項
        card.setTint(0xfff3c4);
      } else if (opt.type === 'fuseWeapon') {
        // 融合選項用粉紫外框，跟進化的金色區分開，一樣是稀有的特殊選項
        card.setTint(0xffd0f0);
      }
      const icon = this.add.image(cx, cy - 190, opt.icon).setScale((opt.iconScale || 1.6) * 2.2).setScrollFactor(0);
      if (opt.iconTint) icon.setTint(opt.iconTint);
      const titleColor = opt.type === 'evolveWeapon' ? '#ffe066' : opt.type === 'fuseWeapon' ? '#ff8fe0' : '#fff';
      this.add.text(cx, cy - 70, opt.title, textStyle({
        fontSize: '32px', color: titleColor, align: 'center',
        wordWrap: { width: cardW - 50, useAdvancedWrap: true },
      })).setOrigin(0.5).setScrollFactor(0);
      this.add.text(cx, cy + 100, opt.desc, textStyle({
        fontSize: '24px', color: '#9fd3ff', align: 'center', lineSpacing: 8,
        wordWrap: { width: cardW - 60, useAdvancedWrap: true },
      })).setOrigin(0.5).setScrollFactor(0);

      const baseTint = opt.type === 'evolveWeapon' ? 0xfff3c4 : opt.type === 'fuseWeapon' ? 0xffd0f0 : 0xffffff;
      card.on('pointerover', () => card.setTint(0xffffff));
      card.on('pointerout', () => card.setTint(baseTint));
      card.on('pointerdown', () => this._select(opt));
    });
  }

  _buildOptions() {
    const owned = this.weaponSystem.owned;
    const pool = [];

    // 新武器選項：被某個目前擁有中的融合武器鎖住的基礎武器（例如飛刀+鋸片融合出
    // 血肉風暴之後的「鋸片」）不能再選，選了也不會真的開火，見 isLockedByFusion()。
    for (const id of WEAPON_IDS) {
      if (!owned[id] && !this.weaponSystem.isLockedByFusion(id)) {
        pool.push({
          type: 'newWeapon', id,
          title: `新武器：${WEAPON_DATA[id].name}`,
          desc: WEAPON_DATA[id].desc,
          icon: `weapon_${id}_lv1`,
        });
      }
    }
    // 武器升級選項 / 滿五級後的進化選項
    for (const id of Object.keys(owned)) {
      if (owned[id] < 5) {
        pool.push({
          type: 'upgradeWeapon', id,
          title: `${WEAPON_DATA[id].name} 升級 → Lv${owned[id] + 1}`,
          desc: WEAPON_DATA[id].desc,
          icon: `weapon_${id}_lv${owned[id]}`,
        });
      } else if (this.weaponSystem.canEvolve(id)) {
        const evo = WEAPON_EVOLUTIONS[id];
        pool.push({
          type: 'evolveWeapon', id,
          title: `⭐ 進化！${evo.name}`,
          desc: evo.desc,
          icon: `weapon_${id}_lv5`,
          iconTint: 0xffe066,
        });
      }
    }
    // 融合選項：任兩把「都滿級、都還沒進化、都不是融合武器本身」的武器，
    // 如果剛好有對應配方（見 WeaponData.WEAPON_FUSIONS），就給融合選項——
    // 融合跟單獨進化互斥（見 WeaponSystem.canEvolve 排除掉融合武器），
    // 玩家要嘛選其中一把單獨進化、要嘛選融合，是刻意做出的取捨。
    // 用 canFuse() 判斷（而不是自己重複寫一次規則），順便擋掉「已經融合過一次、
    // 重新練起雷電+飛刀想再融合出第二份一樣的武器」這種重複融合的狀況。
    const fusableIds = Object.keys(owned).filter((id) => this.weaponSystem.isMaxed(id) && !this.weaponSystem.isEvolved(id) && !this.weaponSystem.isFusion(id));
    for (let i = 0; i < fusableIds.length; i++) {
      for (let j = i + 1; j < fusableIds.length; j++) {
        if (!this.weaponSystem.canFuse(fusableIds[i], fusableIds[j])) continue;
        const fusion = findFusionFor(fusableIds[i], fusableIds[j]);
        pool.push({
          type: 'fuseWeapon', idA: fusableIds[i], idB: fusableIds[j],
          title: `🔥 融合！${fusion.name}`,
          desc: fusion.desc,
          icon: fusion.icon,
          iconTint: 0xff9de0,
        });
      }
    }

    // 被動能力選項
    for (const id of PASSIVE_IDS) {
      const lvl = this.gs.player.passiveLevels[id] || 0;
      if (lvl < MAX_PASSIVE_LEVEL) {
        pool.push({
          type: 'passive', id,
          title: `${PASSIVE_DATA[id].name} Lv${lvl + 1}`,
          desc: PASSIVE_DATA[id].desc,
          icon: PASSIVE_DATA[id].icon,
          iconScale: 3,
        });
      }
    }

    // 隨機挑選 3 個不重複選項；進化／融合選項優先出現（比較稀有、值得凸顯，
    // 兩者一起隨機排序，不會永遠融合蓋過進化或反過來）；
    // 若所有武器都已進化封頂、所有被動也都滿 10 級，選項會不足 3 個——
    // 這種「全部技能都點滿」的情況下，剩餘選項一律補上血包（立即回復生命），
    // 讓玩家不會卡在空白選項，也符合「全滿之後升級變成血包」的設計。
    const specialOpts = pool.filter((o) => o.type === 'evolveWeapon' || o.type === 'fuseWeapon').sort(() => Math.random() - 0.5);
    const otherOpts = pool.filter((o) => o.type !== 'evolveWeapon' && o.type !== 'fuseWeapon').sort(() => Math.random() - 0.5);
    const shuffled = [...specialOpts, ...otherOpts];

    const picked = [];
    for (const opt of shuffled) {
      if (picked.length >= 3) break;
      picked.push(opt);
    }
    while (picked.length < 3) {
      picked.push({
        type: 'heal', id: 'heal',
        title: '血包',
        desc: '所有技能已滿級！立即回復 40% 最大生命值',
        icon: 'pickup_heart',
        iconScale: 2.2,
      });
    }
    return picked;
  }

  _select(opt) {
    if (opt.type === 'newWeapon' || opt.type === 'upgradeWeapon') {
      this.weaponSystem.addOrUpgrade(opt.id);
    } else if (opt.type === 'evolveWeapon') {
      this.weaponSystem.evolveWeapon(opt.id);
    } else if (opt.type === 'fuseWeapon') {
      this.weaponSystem.fuseWeapons(opt.idA, opt.idB);
    } else if (opt.type === 'passive') {
      const value = passiveLevelValue(opt.id, 1);
      this.gs.player.applyPassiveBonus(opt.id, value);
    } else if (opt.type === 'heal') {
      const p = this.gs.player;
      const healAmount = Math.round(p.stats.maxHp * 0.4);
      p.hp = Math.min(p.stats.maxHp, p.hp + healAmount);
      this.gs.spawnHealFx(p.sprite.x, p.sprite.y, healAmount);
    }
    this.gs.resumeFromLevelUp();
    this.scene.stop();
  }
}
