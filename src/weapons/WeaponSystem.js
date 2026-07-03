import ObjectPool from '../managers/ObjectPool.js';
import { getWeaponLevelData } from './WeaponData.js';
import { dist, angleTo } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

export default class WeaponSystem {
  constructor(scene, player, enemySystem) {
    this.scene = scene;
    this.player = player;
    this.enemySystem = enemySystem;
    this.owned = {}; // { fireball: level, ... }
    this.timers = {};
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

  addOrUpgrade(id) {
    const newLevel = Math.min((this.owned[id] || 0) + 1, 5);
    this.owned[id] = newLevel;
    this._setupTimer(id);
    if (id === 'sawblade') this._rebuildSawblades();
  }

  _setupTimer(id) {
    if (this.timers[id]) this.timers[id].remove();
    if (id === 'sawblade') return; // 鋸片為持續環繞，另行處理
    const data = getWeaponLevelData(id, this.owned[id]);
    this.timers[id] = this.scene.time.addEvent({
      delay: this._scaledCooldown(id, data.cooldown),
      loop: true,
      callback: () => this._fire(id),
    });
  }

  // 依照聯動屬性微調冷卻時間 (例如攻速影響飛刀/鋸片)
  _scaledCooldown(id, base) {
    const stats = this.player.stats;
    if (id === 'knife' || id === 'sawblade') {
      return Math.max(80, base / (1 + stats.atkSpeed * 0.35));
    }
    return base;
  }

  update(time, delta) {
    // 鋸片環繞更新
    if (this.owned.sawblade) {
      const data = getWeaponLevelData('sawblade', this.owned.sawblade);
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

    // 更新活躍投射物
    this.projectilePool.forEachActive((p) => {
      if (p.getData('type') === 'homing') {
        // 已有速度向量，僅檢查存活時間
      }
      if (this.scene.time.now > p.getData('expireAt')) {
        this.projectilePool.free(p);
      }
    });
  }

  _fire(id) {
    const enemy = this.enemySystem.findNearest(this.player.sprite.x, this.player.sprite.y);
    if (id !== 'frost' && !enemy) return;
    const data = getWeaponLevelData(id, this.owned[id]);
    const stats = this.player.stats;

    switch (id) {
      case 'fireball': this._fireFireball(data, stats, enemy); break;
      case 'lightning': this._fireLightning(data, stats, enemy); break;
      case 'knife': this._fireKnife(data, stats, enemy); break;
      case 'frost': this._fireFrost(data, stats); break;
    }
    audioManager.attack();
  }

  _fireFireball(data, stats, enemy) {
    // Attack 越高，體積(scale)與 aoe 越大
    const scaleBonus = 1 + stats.attack * 0.01;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const ang = angleTo(px, py, enemy.x, enemy.y);
    const proj = this.projectilePool.spawn();
    proj.setTexture('proj_fireball');
    proj.setPosition(px, py);
    proj.setScale(scaleBonus);
    proj.setData('dmg', data.dmg * (1 + stats.attack * 0.02));
    proj.setData('aoe', data.aoe * scaleBonus);
    proj.setData('pierce', data.pierce);
    proj.setData('kind', 'fireball');
    proj.setData('expireAt', this.scene.time.now + 2500);
    proj.body.setVelocity(Math.cos(ang) * data.speed, Math.sin(ang) * data.speed);
  }

  _fireLightning(data, stats, enemy) {
    // CritRate 越高，分裂數越多
    const bonusChains = Math.floor(stats.critRate / 20);
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const ang = angleTo(px, py, enemy.x, enemy.y);
    const proj = this.projectilePool.spawn();
    proj.setTexture('proj_lightning');
    proj.setPosition(px, py);
    proj.setData('dmg', data.dmg);
    proj.setData('chains', data.chains + bonusChains);
    proj.setData('range', data.range);
    proj.setData('kind', 'lightning');
    proj.setData('hitSet', new Set());
    proj.setData('expireAt', this.scene.time.now + 1200);
    proj.body.setVelocity(Math.cos(ang) * 420, Math.sin(ang) * 420);
  }

  _fireKnife(data, stats, enemy) {
    // AttackSpeed 越高，飛刀數量越多
    const bonusCount = Math.floor(stats.atkSpeed / 25);
    const totalCount = data.count + bonusCount;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const baseAng = angleTo(px, py, enemy.x, enemy.y);
    const spread = 0.18;
    for (let i = 0; i < totalCount; i++) {
      const off = (i - (totalCount - 1) / 2) * spread;
      const proj = this.projectilePool.spawn();
      proj.setTexture('proj_knife');
      proj.setPosition(px, py);
      proj.setRotation(baseAng + off);
      proj.setData('dmg', data.dmg);
      proj.setData('pierce', data.pierce);
      proj.setData('kind', 'knife');
      proj.setData('expireAt', this.scene.time.now + 1500);
      proj.body.setVelocity(Math.cos(baseAng + off) * data.speed, Math.sin(baseAng + off) * data.speed);
    }
  }

  _fireFrost(data, stats) {
    // Defense 越高，範圍越大
    const bonusRadius = stats.defense * 1.2;
    const radius = data.radius + bonusRadius;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const ring = this.scene.add.image(px, py, 'fx_frost').setScale(radius / 24).setAlpha(0.7).setDepth(9000);
    this.scene.tweens.add({
      targets: ring, alpha: 0, scale: radius / 20,
      duration: 400, onComplete: () => ring.destroy(),
    });
    this.enemySystem.forEachActive((e) => {
      if (dist(px, py, e.x, e.y) <= radius) {
        this.enemySystem.damageEnemy(e, data.dmg, stats.critRate, stats.critDmg);
        e.setData('slowUntil', this.scene.time.now + data.slowDuration);
        e.setData('slowFactor', 1 - data.slow);
      }
    });
  }

  _rebuildSawblades() {
    for (const sp of this.sawbladeSprites) sp.destroy();
    this.sawbladeSprites = [];
    const data = getWeaponLevelData('sawblade', this.owned.sawblade);
    for (let i = 0; i < data.count; i++) {
      const sp = this.scene.physics.add.image(this.player.sprite.x, this.player.sprite.y, 'proj_sawblade');
      sp.setData('kind', 'sawblade');
      sp.setData('lastHit', new Map());
      this.sawbladeSprites.push(sp);
      if (this.scene.projectileGroup) this.scene.projectileGroup.add(sp);
    }
  }

  getSawbladeDamage() {
    if (!this.owned.sawblade) return 0;
    return getWeaponLevelData('sawblade', this.owned.sawblade).dmg;
  }
}
