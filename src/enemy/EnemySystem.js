import ObjectPool from '../managers/ObjectPool.js';
import { ENEMY_TYPES, ENEMY_IDS, ENEMY_TIERS, rollEnemyTier } from './EnemyData.js';
import { dist, choice, randRange } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

const MAX_ENEMIES = 500;
const GRID_SIZE = 96; // 空間網格邊長：把場上怪物依座標分桶，碰撞判定只需查附近幾個格子

export default class EnemySystem {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.difficultyMinutes = 0;
    this.spawnInterval = 900;
    this.lastSpawn = 0;
    this.grid = new Map(); // "gx,gy" -> [enemy, ...]，每幀重建一次

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
    // 防呆重置：確保從物件池取出的怪物一定是完全不透明、正常混合模式，
    // 避免任何殘留視覺狀態（例如特效或閃白動畫中途被打斷）造成看起來「隱形」
    sprite.setAlpha(1);
    sprite.setBlendMode(Phaser.BlendModes.NORMAL);
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
    sprite.setData('flashToken', 0); // 用來讓「閃白後恢復顏色」的計時器只認得最新一次的傷害
    if (tierDef.tint) sprite.setTint(tierDef.tint); else sprite.clearTint();
  }

  _resetGem(gem, x, y, amount) {
    gem.setPosition(x, y);
    gem.setData('amount', amount);
    gem.setAlpha(1);
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

  _cellKey(x, y) {
    return `${Math.floor(x / GRID_SIZE)},${Math.floor(y / GRID_SIZE)}`;
  }

  // 每幀重建一次空間網格：O(N)，之後每次「查詢附近怪物」都只需檢查少數格子，
  // 而不必每次都掃過全部怪物（原本武器碰撞判定是 O(子彈數 × 怪物數)，
  // 在怪物數量多時很容易造成單幀嚴重掉幀、畫面來不及重繪，看起來就像怪物瞬間消失）
  _rebuildGrid() {
    this.grid.clear();
    this.pool.forEachActive((e) => {
      const key = this._cellKey(e.x, e.y);
      let arr = this.grid.get(key);
      if (!arr) { arr = []; this.grid.set(key, arr); }
      arr.push(e);
    });
  }

  // 查詢以 (x,y) 為圓心、radius 為半徑的範圍內所有怪物（僅限已建格的候選者，
  // 呼叫端仍應自行用精確距離做最終判斷，這裡只是縮小候選範圍的「粗篩」）
  queryNear(x, y, radius, cb) {
    const cellR = Math.ceil(radius / GRID_SIZE) + 1;
    const cx = Math.floor(x / GRID_SIZE), cy = Math.floor(y / GRID_SIZE);
    for (let gy = cy - cellR; gy <= cy + cellR; gy++) {
      for (let gx = cx - cellR; gx <= cx + cellR; gx++) {
        const arr = this.grid.get(`${gx},${gy}`);
        if (!arr) continue;
        for (const e of arr) {
          if (e.active) cb(e);
        }
      }
    }
  }

  update(time, delta) {
    this._rebuildGrid();

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
    // 用一個遞增的 token 標記「這是第幾次閃白」，避免同一隻怪物在極短時間內
    // 被連續打好幾下時，較早的那次 delayedCall 事後又把顏色蓋回去、或誤判已死亡的物件
    const token = (enemy.getData('flashToken') || 0) + 1;
    enemy.setData('flashToken', token);
    this.scene.time.delayedCall(60, () => {
      if (!enemy.active) return;
      if (enemy.getData('flashToken') !== token) return; // 期間又被打了一下，交給更新的那次處理
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
