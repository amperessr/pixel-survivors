import ObjectPool from '../managers/ObjectPool.js';
import { ENEMY_TYPES, ENEMY_IDS, ENEMY_TIERS, rollEnemyTier, enemyScalingMultiplier } from './EnemyData.js';
import { dist, choice, randRange } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

const MAX_ENEMIES = 800; // 原本 500 隻上限打起來太稀疏，拉高讓畫面塞得下更多小怪
const GRID_SIZE = 96; // 空間網格邊長：把場上怪物依座標分桶，碰撞判定只需查附近幾個格子

export default class EnemySystem {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.difficultyMinutes = 0;
    this.spawnInterval = 420; // 出怪節奏再加快（原 600ms 一波，小怪密度太低、爽感不夠）
    this.lastSpawn = 0;
    this.grid = new Map(); // "gx,gy" -> [enemy, ...]，每幀重建一次

    // 診斷用：若怪物材質不存在（例如素材產生階段出錯），直接在主控台報錯，
    // 方便之後排查「怪物看不到」是不是材質根本沒生出來
    const requiredTextures = ['enemy_slime', 'enemy_goblin', 'enemy_skeleton', 'enemy_orc'];
    for (const key of requiredTextures) {
      if (!scene.textures.exists(key)) {
        console.error(`[EnemySystem] 材質 "${key}" 不存在！怪物將無法正常顯示，請檢查 TextureFactory 是否成功執行。`);
      }
    }

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

    this.magnetUntil = 0; // 磁鐵效果持續到的時間戳，期間內所有經驗寶石都會被強制吸過來
  }

  // 磁鐵拾取物觸發：讓地圖上「目前所有」經驗寶石在接下來這段時間內飛向玩家並被吸收
  activateMagnet(duration = 1600) {
    this.magnetUntil = this.scene.time.now + duration;
  }

  _resetEnemy(sprite, typeId, x, y, tier = 'normal') {
    const def = ENEMY_TYPES[typeId];
    const tierDef = ENEMY_TIERS[tier] || ENEMY_TIERS.normal;
    sprite.setTexture(def.texture);
    sprite.setPosition(x, y);
    sprite.setScale(def.scale * tierDef.scaleMult);
    sprite.setData('baseScale', def.scale * tierDef.scaleMult); // 給受擊擠壓動畫用，避免沿用到上一輪生命週期的縮放
    sprite.setDepth(y);
    // 防呆重置：確保從物件池取出的怪物一定是完全不透明、正常混合模式，
    // 避免任何殘留視覺狀態（例如特效或閃白動畫中途被打斷）造成看起來「隱形」
    sprite.setAlpha(1);
    try {
      sprite.setBlendMode(Phaser.BlendModes.NORMAL);
    } catch (err) {
      console.warn('[EnemySystem] setBlendMode 失敗，略過：', err);
    }
    // 怪物強化倍率統一改用 EnemyData.js 的 enemyScalingMultiplier() 曲線
    // （0 分鐘 1.0x／3 分鐘 1.3x／5 分鐘 1.8x／7 分鐘 2.6x／10 分鐘 5.0x，
    //  之後依同樣的成長率持續往上疊加），HP 與傷害套用同一條曲線。
    const scaling = enemyScalingMultiplier(this.difficultyMinutes);
    sprite.setData('typeId', typeId);
    sprite.setData('tier', tier);
    sprite.setData('tierTint', tierDef.tint);
    sprite.setData('hp', def.hp * scaling * tierDef.mult);
    sprite.setData('maxHp', def.hp * scaling * tierDef.mult);
    sprite.setData('dmg', def.dmg * scaling * tierDef.mult);
    sprite.setData('speed', def.speed);
    sprite.setData('exp', Math.round(def.exp * tierDef.expMult));
    sprite.setData('slowUntil', 0);
    sprite.setData('slowFactor', 1);
    sprite.setData('knockbackUntil', 0);
    sprite.setData('knockbackVX', 0);
    sprite.setData('knockbackVY', 0);
    sprite.setData('knockbackDuration', 220);
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
      e.setDepth(e.y);
      e.setFlipX(px < e.x);

      const knockbackUntil = e.getData('knockbackUntil');
      if (now < knockbackUntil) {
        // 擊退期間：直接套用擊退速度並隨時間衰減，暫時不追玩家，製造「被打飛」的手感
        const totalDuration = e.getData('knockbackDuration') || 220;
        const remainRatio = Math.max(0, (knockbackUntil - now) / totalDuration);
        e.body.setVelocity(e.getData('knockbackVX') * remainRatio, e.getData('knockbackVY') * remainRatio);
      } else {
        const slowed = now < e.getData('slowUntil') ? e.getData('slowFactor') : 1;
        const spd = e.getData('speed') * slowed;
        const ang = Math.atan2(py - e.y, px - e.x);
        e.body.setVelocity(Math.cos(ang) * spd, Math.sin(ang) * spd);
      }

      // 接觸傷害
      if (dist(e.x, e.y, px, py) < 20 && now - e.getData('lastHitAt') > 500) {
        e.setData('lastHitAt', now);
        const died = this.player.takeDamage(e.getData('dmg'), now);
        if (died) this.scene.onPlayerDeath();
      }
    });

    const magnetActive = time < this.magnetUntil;
    this.expGemPool.forEachActive((g) => {
      const d = dist(g.x, g.y, px, py);
      if (magnetActive) {
        // 磁鐵效果期間：不論距離多遠，全部寶石都朝玩家飛（距離越遠飛得越快，才追得上）
        const ang = Math.atan2(py - g.y, px - g.x);
        const speed = Math.min(1400, 380 + d * 2.2);
        g.body.setVelocity(Math.cos(ang) * speed, Math.sin(ang) * speed);
      } else if (d < 60) {
        const ang = Math.atan2(py - g.y, px - g.x);
        g.body.setVelocity(Math.cos(ang) * 380, Math.sin(ang) * 380);
      }
      if (dist(g.x, g.y, px, py) < 16) {
        const amount = g.getData('amount');
        this.expGemPool.free(g);
        // 核心規則（加經驗值）一定要先生效，音效只是附加效果——就算音效播放出狀況
        // （例如瀏覽器 AudioContext 出錯），也絕對不能連帶讓經驗值沒加到，
        // 所以這裡把音效包起來單獨處理，不會影響到下面的 onGainExp()。
        this.scene.onGainExp(amount);
        try {
          audioManager.pickup();
        } catch (err) {
          console.error('[EnemySystem] 撿取音效播放失敗（經驗值已正常加入，不受影響）：', err);
        }
      }
    });
  }

  _spawnWave() {
    const px = this.player.sprite.x, py = this.player.sprite.y;
    // 每波數量再往上拉（原 4 + 難度*1.6、上限 18），配合更短的出怪間隔，
    // 讓場面從一開始就有足夠的小怪密度，打起來才有爽感
    const count = Math.min(9 + Math.floor(this.difficultyMinutes * 2.2), 30);
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

  damageEnemy(enemy, baseDmg, critRate = 0, critDmg = 150, knockback = null) {
    let dmg = baseDmg;
    let isCrit = false;
    if (Math.random() * 100 < critRate) {
      dmg *= critDmg / 100;
      isCrit = true;
    }
    const hp = enemy.getData('hp') - dmg;
    enemy.setData('hp', hp);
    enemy.setTintFill(0xffffff);

    // 受擊瞬間做一個「擠壓→彈回」的縮放動畫，加強打擊的份量感（取代鏡頭震動）。
    // 用 baseScale 記錄敵人原本的縮放，動畫結束要準確恢復，不會越打越扁。
    const baseScale = enemy.getData('baseScale') || enemy.scaleX || 1;
    enemy.setData('baseScale', baseScale);
    this.scene.tweens.killTweensOf(enemy);
    this.scene.tweens.add({
      targets: enemy,
      scaleX: baseScale * (isCrit ? 1.35 : 1.2),
      scaleY: baseScale * (isCrit ? 0.7 : 0.82),
      duration: 60,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => { if (enemy.active) { enemy.setScale(baseScale); } },
    });

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

    // 擊退：把敵人往「遠離攻擊來源」的方向推開一小段時間
    if (knockback && knockback.force > 0) {
      const ang = Math.atan2(enemy.y - knockback.fromY, enemy.x - knockback.fromX);
      const duration = knockback.duration || 220;
      enemy.setData('knockbackVX', Math.cos(ang) * knockback.force);
      enemy.setData('knockbackVY', Math.sin(ang) * knockback.force);
      enemy.setData('knockbackDuration', duration);
      enemy.setData('knockbackUntil', this.scene.time.now + duration);
    }

    if (isCrit) this.scene.spawnCritFx(enemy.x, enemy.y);
    this.scene.spawnDamageNumber(enemy.x, enemy.y, dmg, isCrit);

    if (hp <= 0) {
      this._killEnemy(enemy);
    }
    return isCrit;
  }

  _killEnemy(enemy) {
    const exp = enemy.getData('exp');
    this.expGemPool.spawn(enemy.x, enemy.y, exp);
    this.scene.spawnKillFx(enemy.x, enemy.y);
    this.scene.registerKill();
    // 音效放在核心規則（掉經驗寶石／計入擊殺數）之後單獨包起來，就算播放出狀況
    // 也不會連帶讓下面的擊殺獎勵、回收敵人物件都沒執行到。
    try {
      audioManager.kill();
    } catch (err) {
      console.error('[EnemySystem] 擊殺音效播放失敗（擊殺獎勵已正常結算，不受影響）：', err);
    }
    // 血包改成純掉落制：擊殺小怪有 10% 機率在原地掉落血包（魔王 100%，
    // 見 GameScene.onBossDefeated；地圖不再定時自動生成血包）
    if (Math.random() < 0.1 && this.scene.healthPackSystem) {
      this.scene.healthPackSystem.forceSpawn(enemy.x, enemy.y);
    }
    this.pool.free(enemy);
  }

  clearAll() {
    this.pool.freeAll();
    this.expGemPool.freeAll();
  }

  // 魔王登場開場用：把場上所有小怪照正常擊殺流程一次清空（掉經驗寶石、播特效、
  // 計入總擊殺數），跟 clearAll() 的差別是這裡是「殺死」而不是單純消失不見。
  // 先拍一份快照再逐一擊殺，避免在遍歷 Set 的同時又被 _killEnemy() 內部的
  // pool.free() 修改同一個 Set 造成漏殺。
  killAllActive() {
    for (const enemy of Array.from(this.pool.active)) {
      this._killEnemy(enemy);
    }
  }
}
