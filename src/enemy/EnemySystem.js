import ObjectPool from '../managers/ObjectPool.js';
import { ENEMY_TYPES, ENEMY_IDS, ENEMY_TIERS, rollEnemyTier, enemyScalingMultiplier } from './EnemyData.js';
import { dist, choice, randRange } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

const MAX_ENEMIES = 800; // 原本 500 隻上限打起來太稀疏，拉高讓畫面塞得下更多小怪
const GRID_SIZE = 96; // 空間網格邊長：把場上怪物依座標分桶，碰撞判定只需查附近幾個格子

// 統一規則（2026-07-10 起）：不管哪個武器/地板效果觸發的減速或燃燒，強度都固定
// 用這兩個數字，不再各自武器各自一套強度——見 applySlow()/applyBurn()。
const SLOW_SPEED_FACTOR = 0.5; // 減速固定降到 50% 移動速度
const BURN_DPS_PERCENT = 0.05; // 燃燒固定每秒造成目標「最大生命值」5% 的傷害
const SLOW_FREEZE_THRESHOLD_MS = 3000; // 連續被減速累積滿這麼久，直接冰凍
const SLOW_FREEZE_DURATION_MS = 1000; // 累積減速觸發的冰凍持續多久
const SEPARATION_DIST = 18; // 怪物間的分離距離：比這更近就互相推開，避免完全重疊
const SEPARATION_FORCE = 60; // 分離力道（疊加在追擊速度上的推開速度）

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
    const requiredTextures = ['enemy_boar', 'enemy_goblin', 'enemy_skeleton', 'enemy_orc'];
    for (const key of requiredTextures) {
      if (!scene.textures.exists(key)) {
        console.error(`[EnemySystem] 材質 "${key}" 不存在！怪物將無法正常顯示，請檢查 TextureFactory 是否成功執行。`);
      }
    }

    this.pool = new ObjectPool(
      scene,
      () => {
        const s = scene.physics.add.sprite(-200, -200, 'enemy_goblin');
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

    // 地面持續效果區域（世界末日的燃燒地板／冰霜地板專用，見 addHazardZone()）
    this.hazardZones = [];
  }

  // 磁鐵拾取物觸發：讓地圖上「目前所有」經驗寶石飛向玩家並被吸收。
  // 重要修正：以前是用一個有時限的全域計時器（magnetUntil）控制，時間一到，
  // 還沒飛到玩家身邊的寶石就會停在半路——玩家反應「磁鐵吸到一半就停下來」。
  // 改成幫「目前」場上每一顆寶石各自標記一個永久 magnetHoming 旗標（不是比對
  // 全域計時器），一旦標記了就會一直飛向玩家直到被撿到為止，不會有時間到了
  // 就半路放棄的情況；新的寶石（磁鐵生效後才產生的）不會被追加標記，維持
  // 「磁鐵吸的是拾取當下地圖上已經存在的寶石」這個原本的設計。
  pullAllGemsToPlayer() {
    this.expGemPool.forEachActive((g) => g.setData('magnetHoming', true));
  }

  _resetEnemy(sprite, typeId, x, y, tier = 'normal') {
    const def = ENEMY_TYPES[typeId];
    const tierDef = ENEMY_TIERS[tier] || ENEMY_TIERS.normal;
    // 重要修正：受擊時的「擠壓」tween（見 damageEnemy）如果在播放到一半時這隻怪物
    // 被打死、物件池回收，tween 本身不會被中斷——如果 120ms 內這個 sprite 被
    // 重新生成成另一隻怪物，舊 tween 的 onComplete 還是會在稍後把縮放蓋回「上一隻
    // 怪物」的 baseScale，讓新怪物短暫顯示成錯誤的大小。回收再利用前先把殘留的
    // tween 清掉，新怪物才不會被上一輪的動畫尾巴影響。
    this.scene.tweens.killTweensOf(sprite);
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
    sprite.setData('slowAccumStart', 0); // 連續被減速累積滿 3 秒會冰凍，見 applySlow()
    sprite.setData('frozenUntil', 0);
    sprite.setData('freezeToken', 0); // 寒冰套裝五件套：只有「最新一次」冰凍的結算計時器算數，見 applyFreeze()
    sprite.setData('paralyzedUntil', 0); // 雷霆套裝專用：麻痺中無法施放技能（Boss 會檔 _chooseSkill）
    sprite.setData('burnUntil', 0);
    sprite.setData('burnDps', 0);
    sprite.setData('burnNextTick', 0);
    sprite.setData('knockbackUntil', 0);
    sprite.setData('knockbackVX', 0);
    sprite.setData('knockbackVY', 0);
    sprite.setData('knockbackDuration', 220);
    sprite.setData('lastHitAt', 0);
    sprite.setData('flashToken', 0); // 用來讓「閃白後恢復顏色」的計時器只認得最新一次的傷害
    sprite.setData('flashUntil', 0); // 受擊閃白的持續期間，狀態染色（燃燒/冰凍/緩速）先讓路
    sprite.setData('facingLeft', this.player.sprite.x < x); // 出生當下先面向玩家，之後每幀依實際移動速度更新（見 update()）
    if (tierDef.tint) sprite.setTint(tierDef.tint); else sprite.clearTint();
  }

  _resetGem(gem, x, y, amount) {
    gem.setPosition(x, y);
    gem.setData('amount', amount);
    gem.setData('magnetHoming', false); // 物件池回收再利用，不能沿用上一輪生命週期的磁鐵狀態
    gem.setAlpha(1);
    // 經驗寶石依經驗值大小呈現不同體積與亮度，讓玩家一眼看出這顆值多少經驗。
    // 尺寸曲線整體調小（上限 2.4→1.3）：原本大顆寶石快跟怪物一樣大，滿地寶石
    // 會把怪物蓋到看不見；另外深度固定壓到極低，寶石永遠畫在怪物腳下。
    const scale = Math.min(1.3, 0.55 + amount / 24);
    gem.setScale(scale);
    gem.setDepth(-1000000);
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
    this._updateHazardZones(time);

    if (time - this.lastSpawn > this.spawnInterval && this.pool.activeCount < MAX_ENEMIES) {
      this.lastSpawn = time;
      this._spawnWave();
    }

    const px = this.player.sprite.x, py = this.player.sprite.y;
    this.pool.forEachActive((e) => {
      if (!e.active) return;
      const now = time;
      e.setDepth(e.y);

      const frozen = now < e.getData('frozenUntil');
      const knockbackUntil = e.getData('knockbackUntil');
      if (frozen) {
        // 世界末日冰塊直接命中的冰凍：完全定住，連擊退慣性都不套用，直接停在原地
        e.body.setVelocity(0, 0);
      } else if (now < knockbackUntil) {
        // 擊退期間：直接套用擊退速度並隨時間衰減，暫時不追玩家，製造「被打飛」的手感
        const totalDuration = e.getData('knockbackDuration') || 220;
        const remainRatio = Math.max(0, (knockbackUntil - now) / totalDuration);
        e.body.setVelocity(e.getData('knockbackVX') * remainRatio, e.getData('knockbackVY') * remainRatio);
      } else {
        const slowed = now < e.getData('slowUntil') ? e.getData('slowFactor') : 1;
        const spd = e.getData('speed') * slowed;
        const ang = Math.atan2(py - e.y, px - e.x);
        // 分離力：跟太近的其他怪物互相推開一點（用既有的空間網格粗篩附近的怪，
        // 不用每隻掃全場），讓怪群擠在一起時不會完全重疊成同一坨。
        let sepX = 0, sepY = 0;
        this.queryNear(e.x, e.y, SEPARATION_DIST, (o) => {
          if (o === e) return;
          const ddx = e.x - o.x, ddy = e.y - o.y;
          const d = Math.hypot(ddx, ddy);
          if (d >= SEPARATION_DIST) return;
          if (d < 0.5) {
            // 兩隻完全疊在同一點：隨機挑個方向推開，不然算不出推開向量
            const ra = Math.random() * Math.PI * 2;
            sepX += Math.cos(ra); sepY += Math.sin(ra);
            return;
          }
          const push = (SEPARATION_DIST - d) / SEPARATION_DIST;
          sepX += (ddx / d) * push;
          sepY += (ddy / d) * push;
        });
        e.body.setVelocity(
          Math.cos(ang) * spd + sepX * SEPARATION_FORCE,
          Math.sin(ang) * spd + sepY * SEPARATION_FORCE
        );
      }

      // 朝向：改成依實際速度方向翻轉，而不是永遠面向玩家——被擊退往後飛的時候
      // 才會正確轉向背對玩家，而不是明明在往後飛卻還臉朝玩家。純垂直移動時
      // （水平速度接近 0）保留上一幀的朝向，避免原地抖動亂翻。
      const vx = e.body.velocity.x;
      if (Math.abs(vx) > 5) e.setData('facingLeft', vx < 0);
      // 貼圖原始美術本身是「面向左邊」，所以要往左走時反而不能翻轉（維持原圖），
      // 要往右走才需要翻轉成鏡像——跟直覺相反，故意取反，不然會變成倒退著走。
      e.setFlipX(!e.getData('facingLeft'));

      // 燃燒：持續時間內每 400ms 扣一次傷害，跟冰凍/減速互不影響、可以同時生效
      if (now < e.getData('burnUntil') && now >= e.getData('burnNextTick')) {
        e.setData('burnNextTick', now + 400);
        this._applyBurnTick(e, e.getData('burnDps') * 0.4);
        if (!e.active) return; // 這一 tick 燒死了，這隻怪物後面的接觸傷害判定不用再跑
      }

      // 狀態視覺：中狀態的怪物身上要看得出變化——冰凍＝冰藍、燃燒＝橘紅、
      // 緩速＝淡藍，都沒有才恢復階級色/原色。受擊閃白（flashUntil）期間先不蓋，
      // 讓打擊回饋維持清楚。
      if (now >= e.getData('flashUntil')) {
        if (frozen) e.setTint(0x7ad6ff);
        else if (now < e.getData('burnUntil')) e.setTint(0xff7a4d);
        else if (now < e.getData('slowUntil')) e.setTint(0xb8e4ff);
        else {
          const tierTint = e.getData('tierTint');
          if (tierTint) e.setTint(tierTint); else e.clearTint();
        }
      }

      // 接觸傷害：冰凍期間怪物完全動彈不得，也不會主動造成接觸傷害
      if (!frozen && dist(e.x, e.y, px, py) < 20 && now - e.getData('lastHitAt') > 500) {
        e.setData('lastHitAt', now);
        const died = this.player.takeDamage(e.getData('dmg'), now);
        if (died) this.scene.onPlayerDeath();
      }
    });

    this.expGemPool.forEachActive((g) => {
      const d = dist(g.x, g.y, px, py);
      if (g.getData('magnetHoming')) {
        // 被磁鐵標記的寶石：不論距離多遠、不論過了多久，都會持續朝玩家飛
        // （距離越遠飛得越快，才追得上），直到被撿到為止，見 pullAllGemsToPlayer()。
        const ang = Math.atan2(py - g.y, px - g.x);
        const speed = Math.min(1400, 380 + d * 2.2);
        g.body.setVelocity(Math.cos(ang) * speed, Math.sin(ang) * speed);
      } else if (d < 60) {
        const ang = Math.atan2(py - g.y, px - g.x);
        g.body.setVelocity(Math.cos(ang) * 380, Math.sin(ang) * 380);
      } else {
        // 重要修正：以前這裡沒有 else，寶石一旦因為磁鐵效果結束或玩家移動離開
        // 60px 拾取範圍而不再符合上面兩個條件，殘留的舊速度（磁鐵模式下最高可達
        // 1400px/s）會永遠留著繼續飛，且方向再也不會更新——這就是「經驗寶石亂飛」
        // 的成因：寶石朝玩家「舊」位置直線飛出，超出範圍後既不會轉向、也不會停下來。
        // 不在任何吸引範圍內時明確歸零，寶石才會乖乖停在原地等玩家靠近。
        g.body.setVelocity(0, 0);
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
    if (this.difficultyMinutes < 1) return 'goblin';
    if (this.difficultyMinutes < 3) return choice(['goblin', 'boar']);
    if (this.difficultyMinutes < 6) return choice(['goblin', 'boar', 'skeleton']);
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

    // 雷霆套裝五件套：打中目前正麻痺中的怪物，額外補上 10% 玩家攻擊力的傷害，
    // 並在命中點補一道打雷特效，呼應「被麻痺的怪物更好打」的套裝設計。
    const setBonuses = this.scene.setBonuses;
    if (setBonuses && setBonuses.thunder5 && this.scene.time.now < enemy.getData('paralyzedUntil')) {
      dmg += this.player.stats.attack * 0.1;
      this.scene.spawnThunderStrikeFx(enemy.x, enemy.y);
    }

    // 吸血戒指：造成傷害時回復玩家生命（比例與每秒上限見 GameScene.applyLifesteal）
    this.scene.applyLifesteal(dmg);

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
    enemy.setData('flashUntil', this.scene.time.now + 60);
    this.scene.time.delayedCall(60, () => {
      if (!enemy.active) return;
      if (enemy.getData('flashToken') !== token) return; // 期間又被打了一下，交給更新的那次處理
      const tierTint = enemy.getData('tierTint');
      if (tierTint) enemy.setTint(tierTint); else enemy.clearTint();
    });

    // 擊退：把敵人往「遠離攻擊來源」的方向推開一小段時間
    // （狂風套裝三件套：擊退力道 +100%，見 GameScene._computeSetBonuses()）
    if (knockback && knockback.force > 0) {
      const windMult = setBonuses && setBonuses.wind3 ? 2 : 1;
      const ang = Math.atan2(enemy.y - knockback.fromY, enemy.x - knockback.fromX);
      const duration = knockback.duration || 220;
      enemy.setData('knockbackVX', Math.cos(ang) * knockback.force * windMult);
      enemy.setData('knockbackVY', Math.sin(ang) * knockback.force * windMult);
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

  // 燃燒的單次扣血 tick：跟 damageEnemy 不同，不算爆擊、不做擊退/受擊擠壓動畫，
  // 避免每 400ms 一次的 DOT 也跟著疊一輪受擊特效，看起來會很吵
  _applyBurnTick(enemy, dmg) {
    if (!enemy.active || dmg <= 0) return;
    const hp = enemy.getData('hp') - dmg;
    enemy.setData('hp', hp);
    this.scene.spawnDamageNumber(enemy.x, enemy.y, Math.round(dmg), false);
    if (hp <= 0) this._killEnemy(enemy);
  }

  // 標準冰凍：完全定住（不能動也不能主動造成接觸傷害），世界末日的冰塊直接命中
  // 敵人時用這個（跟冰霜地板的「減速」是兩回事，冰凍更強但通常持續時間短很多）。
  // 寒冰套裝五件套：冰凍結束的瞬間額外造成 10% 玩家攻擊力的傷害——用遞增 token
  // 標記「這是第幾次冰凍」，只有最後一次冰凍的計時器真的會結算，避免同一隻怪物
  // 冰凍期間又被重新冰凍時，結算兩次傷害。
  applyFreeze(enemy, durationMs) {
    if (!enemy.active || durationMs <= 0) return;
    enemy.setData('frozenUntil', this.scene.time.now + durationMs);
    const token = (enemy.getData('freezeToken') || 0) + 1;
    enemy.setData('freezeToken', token);
    if (this.scene.setBonuses && this.scene.setBonuses.ice5) {
      this.scene.time.delayedCall(durationMs, () => {
        if (!enemy.active || enemy.getData('freezeToken') !== token) return;
        const dmg = this.player.stats.attack * 0.1;
        this.damageEnemy(enemy, dmg, 0, 100, null);
      });
    }
  }

  // 雷霆套裝專用：麻痺讓怪物短暫「無法施放技能」——一般小怪本來就沒有技能可放，
  // 主要影響 Boss（見 Boss.update() 對 paralyzedUntil 的判斷），並讓
  // damageEnemy() 判斷雷霆套裝五件套的額外傷害條件。
  applyParalyze(enemy, durationMs) {
    if (!enemy.active || durationMs <= 0) return;
    enemy.setData('paralyzedUntil', this.scene.time.now + durationMs);
  }

  // 找一隻跟 exclude 不同的隨機存活敵人，找不到就回傳 null。世界末日用這個讓
  // 隕石跟冰塊分別打向不同目標，而不是兩者疊在同一個點上。
  findRandomOther(exclude) {
    const candidates = [];
    this.pool.forEachActive((e) => { if (e !== exclude && e.active) candidates.push(e); });
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // 標準減速：不管哪個武器/地板效果觸發的，一律固定降到 50%（SLOW_SPEED_FACTOR）
  // 移動速度，只有「還能再減速多久」會刷新，強度不會因為重複套用而疊加更低。
  // 寒冰套裝三件套：持續時間 +50%。
  // 通用規則：只要「連續」被減速（中途沒有斷過）累積滿 3 秒，直接冰凍 1 秒——
  // 用 slowAccumStart 記錄這一段連續減速是從什麼時候開始的，一旦減速真的斷過
  // （呼叫時發現上一次的 slowUntil 已經過期）就重新起算，不是減速的「總次數」。
  applySlow(enemy, durationMs) {
    if (!enemy.active || durationMs <= 0) return;
    const setBonuses = this.scene.setBonuses;
    const finalDuration = setBonuses && setBonuses.ice3 ? durationMs * 1.5 : durationMs;
    const now = this.scene.time.now;

    if (now >= enemy.getData('slowUntil')) enemy.setData('slowAccumStart', now);
    enemy.setData('slowUntil', now + finalDuration);
    enemy.setData('slowFactor', SLOW_SPEED_FACTOR);

    if (now - enemy.getData('slowAccumStart') >= SLOW_FREEZE_THRESHOLD_MS) {
      this.applyFreeze(enemy, SLOW_FREEZE_DURATION_MS);
      enemy.setData('slowAccumStart', now); // 冰凍一次之後歸零重新累積，不會每次套用都連續觸發
    }
  }

  // 標準燃燒：每 400ms 燒一次「目標最大生命值 x BURN_DPS_PERCENT」的傷害，
  // 用最大生命值當基準是為了讓每一 tick 的傷害固定，不會因為血量被燒掉而遞減。
  // 重複套用只刷新「還能再燒多久」，不會疊加燒更快。
  // 烈焰套裝三件套：持續時間 +50%；五件套：額外疊加 10% 玩家攻擊力的每秒傷害。
  applyBurn(enemy, durationMs) {
    if (!enemy.active || durationMs <= 0) return;
    const now = this.scene.time.now;
    const setBonuses = this.scene.setBonuses;
    const finalDuration = setBonuses && setBonuses.flame3 ? durationMs * 1.5 : durationMs;
    const maxHp = enemy.getData('maxHp') || enemy.getData('hp') || 0;
    let dps = maxHp * BURN_DPS_PERCENT;
    if (setBonuses && setBonuses.flame5) dps += this.player.stats.attack * 0.1;
    enemy.setData('burnDps', dps);
    enemy.setData('burnUntil', now + finalDuration);
    if (enemy.getData('burnNextTick') < now) enemy.setData('burnNextTick', now + 400);
  }

  // 地面持續效果區域：世界末日的隕石／冰塊落地後各自留下的燃燒地板／冰霜地板
  // （見 GameScene.spawnMeteorDrop()／spawnIceDrop()）。type='fire' 範圍內的怪物持續燃燒，
  // type='frost' 範圍內的怪物持續減速；每幀重新套用一次效果，所以怪物一旦離開
  // 範圍，燃燒/減速會在很短時間內自然消退，不用另外寫「離開範圍」的判斷。
  addHazardZone(x, y, radius, type, durationMs) {
    this.hazardZones.push({ x, y, radius, type, expireAt: this.scene.time.now + durationMs });
  }

  _updateHazardZones(now) {
    if (this.hazardZones.length === 0) return;
    this.hazardZones = this.hazardZones.filter((z) => z.expireAt > now);
    this.hazardZones.forEach((zone) => {
      this.queryNear(zone.x, zone.y, zone.radius, (e) => {
        if (dist(zone.x, zone.y, e.x, e.y) > zone.radius) return;
        if (zone.type === 'fire') this.applyBurn(e, 650);
        else if (zone.type === 'frost') this.applySlow(e, 650);
      });
    });
  }

  _killEnemy(enemy) {
    const exp = enemy.getData('exp');
    this.expGemPool.spawn(enemy.x, enemy.y, exp);
    // 物件池 free() 會讓怪物瞬間隱形供下一隻重用，本體不能拿來播死亡動畫；
    // 把貼圖/朝向/縮放/階級染色這些「當下的樣子」交給 spawnKillFx 另外複製一份
    // 獨立的屍體圖片播放倒地動畫，兩者互不干擾物件池的重用時機。
    this.scene.spawnKillFx(enemy.x, enemy.y, {
      texture: enemy.texture.key,
      flipX: enemy.flipX,
      scale: enemy.getData('baseScale') || enemy.scaleX,
      tint: enemy.getData('tierTint') || null,
    });
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
