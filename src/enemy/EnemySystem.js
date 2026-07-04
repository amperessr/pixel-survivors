import ObjectPool from '../managers/ObjectPool.js';
import { ENEMY_TYPES, ENEMY_IDS, ENEMY_TIERS, rollEnemyTier } from './EnemyData.js';
import { dist, choice, randRange } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

const MAX_ENEMIES = 500;

export default class EnemySystem {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.difficultyMinutes = 0;
    this.spawnInterval = 900;
    this.lastSpawn = 0;

    this.pool = new ObjectPool(
      scene,
      () => {
        const s = scene.physics.add.sprite(-200, -200, 'enemy_slime');
        s.body.setCircle(10, 4, 4);
        return s;
      },
      (s, typeId, x, y, tier) => this._resetEnemy(s, typeId, x, y, tier),
      120
    );

    this.expGemPool = new ObjectPool(
      scene,
      () => scene.physics.add.image(-200, -200, 'gem_exp'),
      (g, x, y, amount) => this._resetGem(g, x, y, amount),
      80
    );
  }

  _resetEnemy(sprite, typeId, x, y, tier = 'normal') {
    const def = ENEMY_TYPES[typeId];
    const tierDef = ENEMY_TIERS[tier] || ENEMY_TIERS.normal;
    sprite.setTexture(def.texture);
    sprite.setPosition(x, y);
    sprite.setScale(def.scale * tierDef.scaleMult);
    sprite.setDepth(y);
    const scaling = 1 + this.difficultyMinutes * 0.18;
    sprite.setData('typeId', typeId);
    sprite.setData('tier', tier);
    sprite.setData('tierTint', tierDef.tint);
    sprite.setData('hp', def.hp * scaling * tierDef.mult);
    sprite.setData('maxHp', def.hp * scaling * tierDef.mult);
    sprite.setData('dmg', def.dmg * (1 + this.difficultyMinutes * 0.1) * tierDef.mult);
    sprite.setData('speed', def.speed);
    sprite.setData('exp', Math.round(def.exp * tierDef.expMult));
    sprite.setData('slowUntil', 0);
    sprite.setData('slowFactor', 1);
    sprite.setData('lastHitAt', 0);
    if (tierDef.tint) sprite.setTint(tierDef.tint); else sprite.clearTint();
  }

  _resetGem(gem, x, y, amount) {
    gem.setPosition(x, y);
    gem.setData('amount', amount);
    // 經驗寶石依經驗值大小呈現不同體積與亮度，讓玩家一眼看出這顆值多少經驗
    const scale = Math.min(2.4, 0.8 + amount / 12);
    gem.setScale(scale);
    if (amount >= 24) gem.setTint(0xff9ad6);
    else if (amount >= 10) gem.setTint(0xffe066);
    else gem.clearTint();
  }

  setDifficultyMinutes(min) { this.difficultyMinutes = min; }

  // 依目前鏡頭縮放與視野大小，動態計算「剛好在畫面外」的生成半徑，
  // 避免怪物在玩家眼前憑空冒出（鏡頭拉近後尤其重要）
  _computeSpawnRadius() {
    const cam = this.scene.cameras.main;
    const halfW = cam.width / (2 * cam.zoom);
    const halfH = cam.height / (2 * cam.zoom);
    const edge = Math.hypot(halfW, halfH);
    return { min: edge + 60, max: edge + 260 };
  }

  update(time, delta) {
    if (time - this.lastSpawn > this.spawnInterval && this.pool.activeCount < MAX_ENEMIES) {
      this.lastSpawn = time;
      this._spawnWave();
    }

    const px = this.player.sprite.x, py = this.player.sprite.y;
    this.pool.forEachActive((e) => {
      if (!e.active) return;
      const now = time;
      const slowed = now < e.getData('slowUntil') ? e.getData('slowFactor') : 1;
      const spd = e.getData('speed') * slowed;
      const ang = Math.atan2(py - e.y, px - e.x);
      e.body.setVelocity(Math.cos(ang) * spd, Math.sin(ang) * spd);
      e.setDepth(e.y);
      e.setFlipX(px < e.x);

      // 接觸傷害
      if (dist(e.x, e.y, px, py) < 20 && now - e.getData('lastHitAt') > 500) {
        e.setData('lastHitAt', now);
        const died = this.player.takeDamage(e.getData('dmg'), now);
        if (died) this.scene.onPlayerDeath();
      }
    });

    this.expGemPool.forEachActive((g) => {
      if (dist(g.x, g.y, px, py) < 60) {
        const ang = Math.atan2(py - g.y, px - g.x);
        g.body.setVelocity(Math.cos(ang) * 380, Math.sin(ang) * 380);
      }
      if (dist(g.x, g.y, px, py) < 16) {
        const amount = g.getData('amount');
        this.expGemPool.free(g);
        audioManager.pickup();
        this.scene.onGainExp(amount);
      }
    });
  }

  _spawnWave() {
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const count = Math.min(3 + Math.floor(this.difficultyMinutes * 1.3), 14);
    const { min, max } = this._computeSpawnRadius();
    for (let i = 0; i < count; i++) {
      if (this.pool.activeCount >= MAX_ENEMIES) break;
      const angle = randRange(0, Math.PI * 2);
      const radius = randRange(min, max);
      const x = px + Math.cos(angle) * radius;
      const y = py + Math.sin(angle) * radius;
      const typeId = this._pickTypeForDifficulty();
      const tier = rollEnemyTier(this.difficultyMinutes);
      this.pool.spawn(typeId, x, y, tier);
    }
  }

  _pickTypeForDifficulty() {
    if (this.difficultyMinutes < 1) return 'slime';
    if (this.difficultyMinutes < 3) return choice(['slime', 'goblin']);
    if (this.difficultyMinutes < 6) return choice(['slime', 'goblin', 'skeleton']);
    return choice(ENEMY_IDS);
  }

  findNearest(x, y) {
    let best = null, bestD = Infinity;
    this.pool.forEachActive((e) => {
      const d = dist(x, y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    });
    return best;
  }

  forEachActive(cb) { this.pool.forEachActive(cb); }

  damageEnemy(enemy, baseDmg, critRate = 0, critDmg = 150) {
    let dmg = baseDmg;
    let isCrit = false;
    if (Math.random() * 100 < critRate) {
      dmg *= critDmg / 100;
      isCrit = true;
    }
    const hp = enemy.getData('hp') - dmg;
    enemy.setData('hp', hp);
    enemy.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => {
      if (!enemy.active) return;
      // 閃白結束後恢復原本強度所對應的顏色（一般怪為無染色）
      const tierTint = enemy.getData('tierTint');
      if (tierTint) enemy.setTint(tierTint); else enemy.clearTint();
    });

    if (isCrit) this.scene.spawnCritFx(enemy.x, enemy.y);

    if (hp <= 0) {
      this._killEnemy(enemy);
    }
    return isCrit;
  }

  _killEnemy(enemy) {
    const exp = enemy.getData('exp');
    this.expGemPool.spawn(enemy.x, enemy.y, exp);
    this.scene.spawnKillFx(enemy.x, enemy.y);
    audioManager.kill();
    this.scene.registerKill();
    this.pool.free(enemy);
  }

  clearAll() {
    this.pool.freeAll();
    this.expGemPool.freeAll();
  }
}
