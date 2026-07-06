import ObjectPool from '../managers/ObjectPool.js';
import { getWeaponLevelData, WEAPON_EVOLUTIONS, WEAPON_KNOCKBACK } from './WeaponData.js';
import { angleTo } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

export default class WeaponSystem {
  constructor(scene, player, enemySystem) {
    this.scene = scene;
    this.player = player;
    this.enemySystem = enemySystem;
    this.owned = {}; // { fireball: level, ... }
    this.evolved = {}; // { fireball: true, ... } 滿五級後進化的武器
    this.nextFireAt = {}; // { fireball: timestamp, ... } 即時運算冷卻時間，避免屬性提升後冷卻不同步
    this.sawbladeSprites = [];
    this.sawbladeAngle = 0;

    this.projectilePool = new ObjectPool(
      scene,
      () => scene.physics.add.image(-100, -100, 'proj_fireball'),
      (obj) => obj,
      100
    );
  }

  hasWeapon(id) { return !!this.owned[id]; }
  getLevel(id) { return this.owned[id] || 0; }
  ownedWeaponIds() { return Object.keys(this.owned); }
  isMaxed(id) { return this.owned[id] >= 5; }
  isEvolved(id) { return !!this.evolved[id]; }
  canEvolve(id) { return this.owned[id] >= 5 && !this.evolved[id]; }

  addOrUpgrade(id) {
    const newLevel = Math.min((this.owned[id] || 0) + 1, 5);
    this.owned[id] = newLevel;
    // 立即可以再次開火（不必等待舊等級的冷卻）
    this.nextFireAt[id] = this.scene.time.now;
    if (id === 'sawblade') this._rebuildSawblades();
  }

  // 五級滿了之後進化成更強的高階武器：數值全面躍升，外觀加上金色高光
  evolveWeapon(id) {
    if (!this.canEvolve(id)) return;
    this.evolved[id] = true;
    this.nextFireAt[id] = this.scene.time.now;
    if (id === 'sawblade') this._rebuildSawblades();
    this.scene.spawnEvolveFx(this.player.sprite.x, this.player.sprite.y);
  }

  // 取得「目前實際生效」的武器數值：五級數值 + (若已進化) 進化倍率加成
  _getEffectiveData(id) {
    const base = getWeaponLevelData(id, this.owned[id]);
    if (!this.evolved[id]) return base;

    const evo = WEAPON_EVOLUTIONS[id];
    const scaled = { ...base, evolved: true, evoName: evo.name };
    scaled.dmg = base.dmg * evo.dmgMult;
    if (base.aoe != null) scaled.aoe = base.aoe * evo.extraMult;
    if (base.radius != null) scaled.radius = base.radius * evo.extraMult;
    if (base.range != null) scaled.range = base.range * evo.extraMult;
    if (base.chains != null) scaled.chains = Math.round(base.chains * evo.extraMult);
    if (base.count != null) scaled.count = Math.round(base.count * evo.extraMult);
    if (base.pierce != null) scaled.pierce = base.pierce + 1;
    if (base.slow != null) scaled.slow = Math.min(0.85, base.slow * 1.2);
    scaled.cooldown = base.cooldown / evo.extraMult;
    return scaled;
  }

  // 依照聯動屬性微調冷卻時間（例如攻速影響飛刀/鋸片）；
  // 每次開火時「即時」重新計算，屬性提升會立刻反映在下一次冷卻，不會卡在舊數值
  _scaledCooldown(id, base) {
    const stats = this.player.stats;
    if (id === 'knife' || id === 'sawblade') {
      return Math.max(80, base / (1 + stats.atkSpeed * 0.35));
    }
    return base;
  }

  update(time, delta) {
    // 依照擁有的武器，逐一檢查是否可以開火（取代舊版基於 Timer 的作法）
    for (const id of Object.keys(this.owned)) {
      if (id === 'sawblade') continue; // 鋸片為持續環繞傷害，非計時開火
      const nextAt = this.nextFireAt[id] || 0;
      if (time >= nextAt) {
        const fired = this._fire(id, time);
        const data = this._getEffectiveData(id);
        const cooldown = this._scaledCooldown(id, data.cooldown);
        // 若因找不到敵人而沒有實際開火（frost 以外的武器），縮短重試間隔避免卡頓
        this.nextFireAt[id] = time + (fired ? cooldown : Math.min(150, cooldown));
      }
    }

    // 鋸片環繞更新
    if (this.owned.sawblade) {
      const data = this._getEffectiveData('sawblade');
      const rot = data.rotSpeed * (1 + this.player.stats.atkSpeed * 0.3);
      this.sawbladeAngle += rot * (delta / 1000);
      const n = this.sawbladeSprites.length;
      for (let i = 0; i < n; i++) {
        const ang = this.sawbladeAngle + (i / n) * Math.PI * 2;
        const sp = this.sawbladeSprites[i];
        sp.x = this.player.sprite.x + Math.cos(ang) * data.radius;
        sp.y = this.player.sprite.y + Math.sin(ang) * data.radius;
        sp.rotation += 0.3;
      }
    }

    // 更新活躍投射物存活時間
    this.projectilePool.forEachActive((p) => {
      if (this.scene.time.now > p.getData('expireAt')) {
        this.projectilePool.free(p);
      }
    });
  }

  // 回傳是否真的開火（frost 一律開火；其餘武器需要有目標敵人）
  _fire(id, time) {
    const enemy = this.enemySystem.findNearest(this.player.sprite.x, this.player.sprite.y);
    if (id !== 'frost' && !enemy) return false;
    const data = this._getEffectiveData(id);
    const stats = this.player.stats;

    switch (id) {
      case 'fireball': this._fireFireball(data, stats, enemy); break;
      case 'lightning': this._fireLightning(data, stats, enemy); break;
      case 'knife': this._fireKnife(data, stats, enemy); break;
      case 'frost': this._fireFrost(data, stats); break;
    }
    audioManager.attack();
    return true;
  }

  _fireFireball(data, stats, enemy) {
    // Attack 越高，體積(scale)與 aoe 越大
    const scaleBonus = (1 + stats.attack * 0.01) * (data.evolved ? 1.3 : 1);
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const dmg = data.dmg * (1 + stats.attack * 0.02);
    const aoe = data.aoe * scaleBonus;

    if (data.evolved) {
      // 進化「隕石燄爆」：不再沿地面飛行，改成直接鎖定目標敵人所在位置，
      // 從天而降砸下一顆隕石（見 GameScene.spawnMeteorStrike()）
      const kb = WEAPON_KNOCKBACK.fireball;
      this.scene.spawnMeteorStrike(enemy.x, enemy.y, dmg, aoe, stats.critRate, stats.critDmg, {
        force: kb.force, duration: kb.duration,
      });
      return;
    }

    const ang = angleTo(px, py, enemy.x, enemy.y);
    const proj = this.projectilePool.spawn();
    proj.setTexture('proj_fireball');
    proj.setPosition(px, py);
    proj.setScale(scaleBonus);
    proj.clearTint();
    proj.setData('dmg', dmg);
    proj.setData('aoe', aoe);
    proj.setData('pierce', data.pierce);
    proj.setData('exploded', false);
    proj.setData('kind', 'fireball');
    proj.setData('evolved', false);
    proj.setData('expireAt', this.scene.time.now + 2500);
    proj.body.setVelocity(Math.cos(ang) * data.speed, Math.sin(ang) * data.speed);
    this.scene.spawnCastFx(px, py, 'fireball', ang, 0, false);
  }

  _fireLightning(data, stats, enemy) {
    // CritRate 越高，分裂數越多
    const bonusChains = Math.floor(stats.critRate / 20);
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const ang = angleTo(px, py, enemy.x, enemy.y);
    const proj = this.projectilePool.spawn();
    proj.setTexture('proj_lightning');
    proj.setPosition(px, py);
    // 改成電光藍白色調（類似英雄聯盟史提克彈簧刀電刀的連鎖閃電配色）
    proj.setTint(data.evolved ? 0xffe066 : 0x7ef7ff);
    proj.setData('dmg', data.dmg);
    proj.setData('chains', data.chains + bonusChains);
    proj.setData('range', data.range);
    proj.setData('kind', 'lightning');
    proj.setData('evolved', !!data.evolved);
    proj.setData('hitSet', new Set());
    proj.setData('expireAt', this.scene.time.now + 1200);
    proj.body.setVelocity(Math.cos(ang) * 420, Math.sin(ang) * 420);
    this.scene.spawnCastFx(px, py, 'lightning', ang, 0, data.evolved);
  }

  _fireKnife(data, stats, enemy) {
    // AttackSpeed 越高，飛刀數量越多
    const bonusCount = Math.floor(stats.atkSpeed / 25);
    const totalCount = data.count + bonusCount;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const baseAng = angleTo(px, py, enemy.x, enemy.y);
    const spread = 0.18;
    this.scene.spawnCastFx(px, py, 'knife', baseAng, 0, data.evolved);
    for (let i = 0; i < totalCount; i++) {
      const off = (i - (totalCount - 1) / 2) * spread;
      const proj = this.projectilePool.spawn();
      proj.setTexture('proj_knife');
      proj.setPosition(px, py);
      proj.setRotation(baseAng + off);
      if (data.evolved) proj.setTint(0xffe066); else proj.clearTint();
      proj.setData('dmg', data.dmg);
      proj.setData('pierce', data.pierce);
      proj.setData('kind', 'knife');
      proj.setData('evolved', !!data.evolved);
      proj.setData('hitSet', new Set());
      proj.setData('expireAt', this.scene.time.now + 1500);
      proj.body.setVelocity(Math.cos(baseAng + off) * data.speed, Math.sin(baseAng + off) * data.speed);
    }
  }

  _fireFrost(data, stats) {
    // Defense 越高，範圍越大
    const bonusRadius = stats.defense * 1.2;
    const totalRadius = data.radius + bonusRadius;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const kb = WEAPON_KNOCKBACK.frost;
    const knockback = { force: kb.force, duration: kb.duration };

    if (data.evolved) {
      // 進化：改成跟一般版一樣「由內到外」一根接一根冒出來的節奏，
      // 只是同時往六個方向（六邊形）噴發，而不是只有一個方向——
      // 每個方向各自從近到遠分 4 階段，同一階段的 6 個方向會同時冒出來，
      // 但不同階段之間仍保留 120ms 的間隔，維持「由內到外」的視覺節奏。
      const directions = 6;
      const steps = 4;
      const stepDist = totalRadius / steps;
      for (let s = 1; s <= steps; s++) {
        const pillarDist = stepDist * s;
        for (let d = 0; d < directions; d++) {
          const ang = (d / directions) * Math.PI * 2;
          const x = px + Math.cos(ang) * pillarDist;
          const y = py + Math.sin(ang) * pillarDist;
          this.scene.time.delayedCall((s - 1) * 120, () => {
            this.scene.spawnIcePillar(x, y, data.dmg, data.slow, data.slowDuration, stats.critRate, stats.critDmg, knockback, true);
          });
        }
      }
    } else {
      // 一般：從自己所在位置，往最近敵人的方向，一根接一根冒出冰柱
      const enemy = this.enemySystem.findNearest(px, py);
      const ang = enemy ? angleTo(px, py, enemy.x, enemy.y) : Math.random() * Math.PI * 2;
      const count = 4;
      const step = totalRadius / count;
      for (let i = 1; i <= count; i++) {
        const pillarDist = step * i;
        const x = px + Math.cos(ang) * pillarDist;
        const y = py + Math.sin(ang) * pillarDist;
        this.scene.time.delayedCall((i - 1) * 120, () => {
          this.scene.spawnIcePillar(x, y, data.dmg, data.slow, data.slowDuration, stats.critRate, stats.critDmg, knockback, false);
        });
      }
    }
  }

  _rebuildSawblades() {
    for (const sp of this.sawbladeSprites) sp.destroy();
    this.sawbladeSprites = [];
    const data = this._getEffectiveData('sawblade');
    for (let i = 0; i < data.count; i++) {
      const sp = this.scene.add.image(this.player.sprite.x, this.player.sprite.y, 'proj_sawblade');
      sp.setDepth(6000);
      if (data.evolved) sp.setTint(0xffe066);
      sp.setData('kind', 'sawblade');
      sp.setData('lastHit', new Map());
      this.sawbladeSprites.push(sp);
    }
  }

  getSawbladeDamage() {
    if (!this.owned.sawblade) return 0;
    return this._getEffectiveData('sawblade').dmg;
  }
}
