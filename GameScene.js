import Player from '../player/Player.js';
import MapGenerator from '../systems/MapGenerator.js';
import EnemySystem from '../enemy/EnemySystem.js';
import HealthPackSystem from '../systems/HealthPackSystem.js';
import MagnetSystem from '../systems/MagnetSystem.js';
import WeaponSystem from '../weapons/WeaponSystem.js';
import Boss from '../boss/Boss.js';
import { WEAPON_IDS, WEAPON_KNOCKBACK } from '../weapons/WeaponData.js';
import { PASSIVE_IDS } from '../skills/PassiveData.js';
import { RELICS } from '../relics/RelicData.js';
import { dist } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { textStyle } from '../utils/TextStyle.js';

const BOSS_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分鐘一隻 Boss
// Boss 現在體型大幅放大，命中/接觸判定半徑也要跟著放大，這裡統一定義方便调整
const BOSS_HIT_RADIUS = 46;   // 子彈命中 Boss 的判定半徑
const BOSS_TOUCH_RADIUS = 76; // Boss 對玩家造成接觸傷害的判定半徑
const BOSS_SAW_RADIUS = 76;   // 鋸片對 Boss 造成傷害的判定半徑

export default class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  init(data) {
    this.characterId = data.characterId || 'balanced';
  }

  create() {
    this.cameras.main.setBackgroundColor('#4fa851');
    this.physics.world.setBounds(-1e7, -1e7, 2e7, 2e7);

    this.player = new Player(this, 0, 0, this.characterId);
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
    this.cameras.main.setZoom(2.1); // 鏡頭拉近，讓角色與怪物看起來更清楚、不會太小太遠

    this.map = new MapGenerator(this);
    this.enemySystem = new EnemySystem(this, this.player);
    this.healthPackSystem = new HealthPackSystem(this, this.player);
    this.magnetSystem = new MagnetSystem(this, this.player);
    this.weaponSystem = new WeaponSystem(this, this.player, this.enemySystem);
    this.weaponSystem.addOrUpgrade(WEAPON_IDS[0]); // 起始武器：火球術

    this.bossBoltGroup = this.physics.add.group();
    this.boss = null;
    this.nextBossAt = BOSS_INTERVAL_MS;
    this.bossSpawnCount = 0; // 用來讓黑藍巨龍／血色紅龍輪流出現

    this.startTime = this.time.now;
    this.killCount = 0;
    this.paused = false;
    this.escPaused = false; // 僅代表玩家手動按 ESC 暫停（用於顯示「已暫停」遮罩）
    this.dragonAuraActive = false; // 是否已接受龍之光環（永久跟隨光環視覺開關）
    this.dragonWingsActive = false; // 是否已接受龍之翼（永久跟隨風之尾跡視覺開關）
    this._pendingRelic = null; // 擊敗 Boss 順便升級時，排隊等升級選單關閉後再跳遺物選擇視窗

    // 滑鼠瞄準方向（用於飛刀等以滑鼠為準的武器，此處以世界座標更新提供 UI 之用）
    this.input.on('pointermove', () => {});

    // ESC 暫停
    this.input.keyboard.on('keydown-ESC', () => this._togglePause());

    this.scene.launch('UIScene', { gameScene: this });

    this.events.on('shutdown', () => {
      audioManager.stopBgm();
    });

    audioManager.startBgm();
  }

  update(time, delta) {
    if (this.paused) return;
    // 防呆：任何未預期的例外都只印出錯誤並跳過這一幀，而不是讓 Phaser 的
    // update 迴圈整個中斷、畫面卡住不動（Boss 那個卡死 bug就是活生生的例子，
    // 這裡多一層保護，以後就算有新的類似疏漏也不會直接讓整個遊戲當掉）。
    try {
      this._update(time, delta);
    } catch (err) {
      console.error('[GameScene] update() 發生未預期錯誤，已跳過本幀：', err);
    }
  }

  _update(time, delta) {

    this.player.update(time, delta);
    this.map.update(this.player.sprite.x, this.player.sprite.y);

    const elapsedMin = (time - this.startTime) / 60000;
    this.enemySystem.setDifficultyMinutes(elapsedMin);
    this.enemySystem.update(time, delta);
    this.healthPackSystem.update(time);
    this.magnetSystem.update(time);
    this.weaponSystem.update(time, delta);

    this._updateCollisions(time);

    if (this.boss) {
      this.boss.update(time, delta);
    } else if (time - this.startTime > this.nextBossAt) {
      this.nextBossAt += BOSS_INTERVAL_MS;
      // 每 5 分鐘出現一隻 Boss，兩種型態輪流出現：
      // 第 1、3、5...次是黑藍巨龍，第 2、4、6...次是血色紅龍
      const bossType = this.bossSpawnCount % 2 === 0 ? 'blue' : 'red';
      this.bossSpawnCount++;
      this.boss = new Boss(this, this.player, elapsedMin, bossType, this.bossSpawnCount);
    }

    this.bossBoltGroup.children.iterate((bolt) => {
      if (!bolt || !bolt.active) return;
      if (dist(bolt.x, bolt.y, this.player.sprite.x, this.player.sprite.y) < 16) {
        const died = this.player.takeDamage(bolt.getData('dmg'), time);
        bolt.destroy();
        if (died) this.onPlayerDeath();
      }
    });

    this._updateSuperSaiyanAura(time);
    this._updateDragonAura(time);
    this._updateDragonWings(time);
  }

  // 統一處理武器投射物 / 鋸片 對敵人與 Boss 的碰撞
  _updateCollisions(time) {
    const stats = this.player.stats;

    this.weaponSystem.projectilePool.forEachActive((p) => {
      if (!p.active) return;
      const kind = p.getData('kind');
      if (kind === 'fireball') this._handleFireballHit(p, stats);
      else if (kind === 'lightning') this._handleLightningHit(p, stats);
      else if (kind === 'knife') this._handleKnifeHit(p, stats);
    });

    this._handleSawbladeHits(time, stats);
  }

  // 火球：碰到任一目標即在原地引爆一次，對範圍內所有敵人/Boss 造成傷害；
  // 用 'exploded' 旗標避免同一顆火球在範圍內停留多幀時重複引爆
  _handleFireballHit(p, stats) {
    if (p.getData('exploded')) return;
    const aoe = p.getData('aoe');
    const evolved = p.getData('evolved');
    let triggered = false;
    this.enemySystem.queryNear(p.x, p.y, 14, (e) => {
      if (!triggered && dist(p.x, p.y, e.x, e.y) <= 14) triggered = true;
    });
    if (!triggered && this.boss && this.boss.alive && dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= BOSS_HIT_RADIUS) {
      triggered = true;
    }
    if (!triggered) return;

    p.setData('exploded', true);
    const kb = WEAPON_KNOCKBACK.fireball;
    this.enemySystem.queryNear(p.x, p.y, aoe, (e) => {
      if (dist(p.x, p.y, e.x, e.y) <= aoe) {
        this.enemySystem.damageEnemy(e, p.getData('dmg'), stats.critRate, stats.critDmg, {
          fromX: p.x, fromY: p.y, force: kb.force, duration: kb.duration,
        });
      }
    });
    if (this.boss && this.boss.alive && dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= aoe) {
      this.boss.takeDamage(p.getData('dmg'), stats.critRate, stats.critDmg);
    }
    this.spawnImpactFx(p.x, p.y, 'fireball', aoe, evolved);

    const pierce = p.getData('pierce') || 0;
    if (pierce > 0) {
      p.setData('pierce', pierce - 1);
      p.setData('exploded', false); // 允許穿透後在下一個目標再次引爆
    } else {
      this.weaponSystem.projectilePool.free(p);
    }
  }

  // 飛刀：單體傷害，用 hitSet 記錄已命中對象，避免同一把刀在多幀內對同一敵人重複造成傷害
  _handleKnifeHit(p, stats) {
    const hitSet = p.getData('hitSet');
    const evolved = p.getData('evolved');
    let target = null;
    this.enemySystem.queryNear(p.x, p.y, 14, (e) => {
      if (target || hitSet.has(e)) return;
      if (dist(p.x, p.y, e.x, e.y) <= 14) target = e;
    });
    let hitBoss = false;
    if (!target && this.boss && this.boss.alive && !hitSet.has(this.boss) &&
        dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= BOSS_HIT_RADIUS) {
      hitBoss = true;
    }
    if (!target && !hitBoss) return;

    const kb = WEAPON_KNOCKBACK.knife;
    if (hitBoss) {
      hitSet.add(this.boss);
      this.boss.takeDamage(p.getData('dmg'), stats.critRate, stats.critDmg);
      this.spawnImpactFx(this.boss.sprite.x, this.boss.sprite.y, 'knife', 0, evolved);
    } else {
      hitSet.add(target);
      this.enemySystem.damageEnemy(target, p.getData('dmg'), stats.critRate, stats.critDmg, {
        fromX: p.x, fromY: p.y, force: kb.force, duration: kb.duration,
      });
      this.spawnImpactFx(p.x, p.y, 'knife', 0, evolved);
    }

    const pierce = p.getData('pierce') || 0;
    if (pierce > 0) {
      p.setData('pierce', pierce - 1);
    } else {
      this.weaponSystem.projectilePool.free(p);
    }
  }

  // 雷電：用 hitSet 記錄已命中對象，命中後嘗試往附近尚未命中的目標跳躍
  _handleLightningHit(p, stats) {
    const hitSet = p.getData('hitSet');
    const evolved = p.getData('evolved');
    const range = p.getData('range');
    let target = null;
    this.enemySystem.queryNear(p.x, p.y, 14, (e) => {
      if (target || hitSet.has(e)) return;
      if (dist(p.x, p.y, e.x, e.y) <= 14) target = e;
    });
    let targetIsBoss = false;
    if (!target && this.boss && this.boss.alive && !hitSet.has(this.boss) &&
        dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= BOSS_HIT_RADIUS) {
      targetIsBoss = true;
    }
    if (!target && !targetIsBoss) return;

    const hitX = targetIsBoss ? this.boss.sprite.x : target.x;
    const hitY = targetIsBoss ? this.boss.sprite.y : target.y;
    const kb = WEAPON_KNOCKBACK.lightning;

    if (targetIsBoss) {
      hitSet.add(this.boss);
      this.boss.takeDamage(p.getData('dmg'), stats.critRate, stats.critDmg);
    } else {
      hitSet.add(target);
      this.enemySystem.damageEnemy(target, p.getData('dmg'), stats.critRate, stats.critDmg, {
        fromX: p.x, fromY: p.y, force: kb.force, duration: kb.duration,
      });
    }
    this.spawnImpactFx(hitX, hitY, 'lightning', 0, evolved);

    const chainsLeft = p.getData('chains') - 1;
    if (chainsLeft > 0) {
      const next = this._findNearestExcluding(hitX, hitY, hitSet, range);
      if (next) {
        p.setData('chains', chainsLeft);
        p.setPosition(hitX, hitY);
        const ang = Math.atan2(next.y - hitY, next.x - hitX);
        p.body.setVelocity(Math.cos(ang) * 420, Math.sin(ang) * 420);
        p.setData('expireAt', this.time.now + 500);
        // 電光連鎖視覺：在兩個目標之間畫出一道鋸齒狀電弧，就像史提克彈簧刀的連鎖閃電
        this.spawnChainLightningFx(hitX, hitY, next.x, next.y, evolved);
        return;
      }
    }
    this.weaponSystem.projectilePool.free(p);
  }

  // 鋸片：持續環繞傷害，各自用 lastHit 記錄每個目標的命中冷卻
  _handleSawbladeHits(time, stats) {
    const kb = WEAPON_KNOCKBACK.sawblade;
    for (const saw of this.weaponSystem.sawbladeSprites) {
      const dmg = this.weaponSystem.getSawbladeDamage();
      const evolved = this.weaponSystem.isEvolved('sawblade');
      const lastHit = saw.getData('lastHit');
      this.enemySystem.queryNear(saw.x, saw.y, 16, (e) => {
        if (!e.active) return;
        if (dist(saw.x, saw.y, e.x, e.y) > 16) return;
        const last = lastHit.get(e) || 0;
        if (time - last < 300) return;
        lastHit.set(e, time);
        this.enemySystem.damageEnemy(e, dmg, stats.critRate, stats.critDmg, {
          fromX: saw.x, fromY: saw.y, force: kb.force, duration: kb.duration,
        });
        this.spawnImpactFx(e.x, e.y, 'sawblade', 0, evolved);
      });
      if (this.boss && this.boss.alive && dist(saw.x, saw.y, this.boss.sprite.x, this.boss.sprite.y) < BOSS_SAW_RADIUS) {
        const last = lastHit.get(this.boss) || 0;
        if (time - last >= 300) {
          lastHit.set(this.boss, time);
          this.boss.takeDamage(dmg, stats.critRate, stats.critDmg);
          this.spawnImpactFx(this.boss.sprite.x, this.boss.sprite.y, 'sawblade', 0, evolved);
        }
      }
    }
  }

  _findNearestExcluding(x, y, excludeSet, range) {
    let best = null, bestD = Infinity;
    this.enemySystem.queryNear(x, y, range, (e) => {
      if (excludeSet.has(e)) return;
      const d = dist(x, y, e.x, e.y);
      if (d < range && d < bestD) { bestD = d; best = e; }
    });
    return best;
  }

  registerKill() { this.killCount++; }

  onGainExp(amount) {
    const leveledUp = this.player.gainExp(amount);
    if (leveledUp.length > 0) {
      audioManager.levelUp();
      this.spawnLevelUpFx(this.player.sprite.x, this.player.sprite.y);
      this._openLevelUp();
      return true;
    }
    return false;
  }

  _openLevelUp() {
    this.paused = true;
    this.physics.world.pause();
    this.scene.launch('LevelUpScene', {
      gameScene: this,
      weaponSystem: this.weaponSystem,
    });
  }

  resumeFromLevelUp() {
    this.paused = false;
    this.physics.world.resume();
    // 若這次升級是「擊敗 Boss 拿到經驗值」順便觸發的，等升級選單關掉後
    // 再接著跳遺物選擇視窗，避免兩個選單同時疊在畫面上
    if (this._pendingRelic) {
      const relic = this._pendingRelic;
      this._pendingRelic = null;
      this._openRelicChoicePrompt(relic);
    }
  }

  // Boss 死亡時由 Boss._die() 呼叫，帶入這隻 Boss 的型態與對應遺物 id
  onBossDefeated(bossType, relicId) {
    this.boss = null;
    this.registerKill();
    // 慶祝特效一定會播放，不受任何選單開關影響
    this.spawnSuperSaiyanAura();

    const relic = RELICS[relicId];
    // 每個遺物只能拿一次：如果玩家已經擁有這個遺物，就不用再跳出選擇視窗詢問了
    const alreadyOwned = relic && relic.hasIt(this.player);

    const leveledUp = this.onGainExp(30);
    if (relic && !alreadyOwned) {
      if (leveledUp) {
        // 升級選單已經在暫停/開啟中，先排隊，等它關閉後再跳遺物選擇視窗
        this._pendingRelic = relic;
      } else {
        this._openRelicChoicePrompt(relic);
      }
    }
  }

  _openRelicChoicePrompt(relic) {
    this.paused = true;
    this.physics.world.pause();
    this.scene.launch('RelicChoiceScene', { gameScene: this, relic });
  }

  resumeFromRelicChoice() {
    this.paused = false;
    this.physics.world.resume();
  }

  onPlayerDeath() {
    if (this.gameEnded) return;
    this.gameEnded = true;
    this.paused = true;
    audioManager.stopBgm();
    audioManager.gameOver();
    const elapsed = Math.floor((this.time.now - this.startTime) / 1000);
    this.scene.stop('UIScene');
    this.scene.start('GameOverScene', {
      kills: this.killCount,
      level: this.player.level,
      time: elapsed,
    });
  }

  _togglePause() {
    if (this.gameEnded) return;
    this.paused = !this.paused;
    this.escPaused = this.paused;
    if (this.paused) {
      this.physics.world.pause();
    } else {
      this.physics.world.resume();
    }
  }

  getElapsedSeconds() {
    return Math.floor((this.time.now - this.startTime) / 1000);
  }

  // ================= 特效輔助 =================
  // 通用「爆裂粒子」：從一個點往四周噴出好幾個小碎片，比單張淡出圖案更有份量感
  spawnBurstFx(x, y, color, count = 10, texture = 'fx_crit', baseSpeed = 90) {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = baseSpeed * (0.6 + Math.random() * 0.8);
      const particle = this.add.image(x, y, texture).setDepth(29998).setScale(0.35 + Math.random() * 0.25);
      if (color != null) particle.setTint(color);
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(ang) * speed,
        y: y + Math.sin(ang) * speed,
        alpha: 0,
        scale: 0.05,
        duration: 260 + Math.random() * 140,
        ease: 'Cubic.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }

  // 火焰餘燼：命中/爆炸後幾顆小火星緩緩往上飄散，很多其他遊戲的火屬性技能都有這種收尾效果
  spawnEmbersFx(x, y, count = 6, color = 0xffb066) {
    for (let i = 0; i < count; i++) {
      const ember = this.add.image(
        x + (Math.random() - 0.5) * 20,
        y + (Math.random() - 0.5) * 10,
        'fx_flame'
      ).setDepth(30002).setScale(0.15 + Math.random() * 0.15).setAlpha(0.85).setTint(color);
      ember.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: ember,
        y: ember.y - 30 - Math.random() * 20,
        x: ember.x + (Math.random() - 0.5) * 16,
        alpha: 0,
        duration: 500 + Math.random() * 300,
        ease: 'Sine.easeOut',
        onComplete: () => ember.destroy(),
      });
    }
  }

  // 發光外環：用疊加（ADD）混合模式做出「發光暈染」的效果，是很多遊戲元素技能的標準做法
  spawnGlowRing(x, y, texture, color, startScale, endScale, duration, depth = 29999) {
    const ring = this.add.image(x, y, texture).setDepth(depth).setScale(startScale).setAlpha(0.8).setTint(color);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: ring, scale: endScale, alpha: 0, duration, onComplete: () => ring.destroy() });
    return ring;
  }

  spawnCritFx(x, y) {
    const fx = this.add.image(x, y - 10, 'fx_crit').setDepth(30000).setScale(1.3);
    this.tweens.add({ targets: fx, y: y - 34, alpha: 0, scale: 1.9, duration: 380, onComplete: () => fx.destroy() });
    this.spawnBurstFx(x, y, 0xffe066, 5, 'fx_crit', 70);
  }
  spawnKillFx(x, y) {
    const fx = this.add.image(x, y, 'fx_kill').setDepth(29999).setScale(0.5);
    this.tweens.add({ targets: fx, scale: 1.4, alpha: 0, duration: 300, onComplete: () => fx.destroy() });
  }
  // 血包拾取特效：綠色系爆裂碎片 + 浮動的「+HP」數字
  spawnHealFx(x, y, amount) {
    this.spawnBurstFx(x, y, 0x5bff8f, 12, 'pickup_heart', 90);
    const ring = this.add.image(x, y, 'fx_levelup').setDepth(30000).setScale(0.3).setAlpha(0.9).setTint(0x5bff8f);
    this.tweens.add({ targets: ring, scale: 2, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
    const text = this.add.text(x, y - 10, `+${amount} HP`, textStyle({
      fontSize: '20px', color: '#5bff8f',
    })).setOrigin(0.5).setDepth(30001);
    this.tweens.add({ targets: text, y: y - 46, alpha: 0, duration: 700, onComplete: () => text.destroy() });
  }
  // 磁鐵拾取特效：藍紫色系爆裂碎片 + 一圈往外擴散的吸引波紋，暗示「範圍內東西被吸走了」
  spawnMagnetFx(x, y) {
    this.spawnBurstFx(x, y, 0x7ea0ff, 12, 'pickup_magnet', 90);
    const ring = this.add.image(x, y, 'fx_levelup').setDepth(30000).setScale(0.3).setAlpha(0.9).setTint(0x7ea0ff);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 550, onComplete: () => ring.destroy() });
    const text = this.add.text(x, y - 10, '磁力吸引！', textStyle({
      fontSize: '20px', color: '#a9c0ff',
    })).setOrigin(0.5).setDepth(30001);
    this.tweens.add({ targets: text, y: y - 46, alpha: 0, duration: 700, onComplete: () => text.destroy() });
  }
  // 擊敗 Boss 瞬間的慶祝爆閃：角色短暫染金、爆一圈金色衝擊波。
  // 這段純粹是「打贏了！」的視覺回饋，跟後面要不要接受龍之光環的永久加成無關，
  // 所以持續時間很短（1.2 秒），不會一直跟著玩家。
  spawnSuperSaiyanAura(duration = 1200) {
    const p = this.player.sprite;
    const auraTint = 0xffe066;
    p.setTint(auraTint);
    this.cameras.main.flash(320, 255, 224, 100);
    this.cameras.main.shake(250, 0.008);
    this.spawnGlowRing(p.x, p.y, 'fx_levelup', auraTint, 0.4, 5, 700, 29997);
    this.spawnBurstFx(p.x, p.y, auraTint, 26, 'fx_levelup', 210);
    this.saiyanBurstUntil = this.time.now + duration;
  }

  // 慶祝爆閃結束後把玩家身上暫時的金色 tint 清掉
  // （如果玩家後來接受了龍之光環，_updateDragonAura 會接手處理視覺，不會被這裡蓋掉）
  _updateSuperSaiyanAura(time) {
    if (!this.saiyanBurstUntil) return;
    if (time >= this.saiyanBurstUntil) {
      this.saiyanBurstUntil = null;
      if (!this.dragonAuraActive && this.player.sprite.active) this.player.sprite.clearTint();
    }
  }

  // 龍之光環（永久版）：玩家在 RelicChoiceScene 選擇拿取「龍之光環」後呼叫，
  // 建立一個「持續跟著玩家」的金色氣場光環，每一幀都重新對齊玩家座標，
  // 而不是只靠間歇性的粒子噴發假裝跟隨——這是這次要修正的重點。
  enableDragonAuraVisual() {
    this.dragonAuraActive = true;
    this._nextDragonEmberAt = 0;
    if (!this.dragonAuraRing) {
      this.dragonAuraRing = this.add.image(this.player.sprite.x, this.player.sprite.y, 'fx_levelup')
        .setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe066).setAlpha(0.5).setScale(1.5).setDepth(9997);
      this.tweens.add({
        targets: this.dragonAuraRing,
        scale: { from: 1.3, to: 1.9 },
        alpha: { from: 0.35, to: 0.6 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    this.dragonAuraRing.setVisible(true);
  }

  // 每幀更新：把光環釘在玩家目前座標上（永遠跟著玩家跑），
  // 並每隔一小段時間補幾顆往上竄的金色能量粒子，強化「持續繚繞」的感覺
  _updateDragonAura(time) {
    if (!this.dragonAuraActive) return;
    const p = this.player.sprite;
    this.dragonAuraRing.setPosition(p.x, p.y);
    this.dragonAuraRing.setDepth(p.depth - 1);
    if (time >= this._nextDragonEmberAt) {
      this._nextDragonEmberAt = time + 220;
      this.spawnEmbersFx(p.x, p.y, 2, 0xffe066);
    }
  }

  // 龍之翼（永久版）：玩家接受紅龍遺物後呼叫，建立一個淡藍白色、持續跟著玩家的
  // 氣流光環，並在移動時往身後噴出風之尾跡，視覺語言跟龍之光環一致（都是每幀貼齊玩家），
  // 只是顏色與粒子噴發方向不同，用來跟龍之光環做出區隔。
  enableDragonWingsVisual() {
    this.dragonWingsActive = true;
    this._nextWingsFxAt = 0;
    if (!this.dragonWingsRing) {
      this.dragonWingsRing = this.add.image(this.player.sprite.x, this.player.sprite.y, 'fx_frost')
        .setBlendMode(Phaser.BlendModes.ADD).setTint(0xcfe9ff).setAlpha(0.4).setScale(1.1).setDepth(9996);
      this.tweens.add({
        targets: this.dragonWingsRing,
        scale: { from: 0.9, to: 1.4 },
        alpha: { from: 0.25, to: 0.45 },
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    this.dragonWingsRing.setVisible(true);
  }

  _updateDragonWings(time) {
    if (!this.dragonWingsActive) return;
    const p = this.player.sprite;
    this.dragonWingsRing.setPosition(p.x, p.y);
    this.dragonWingsRing.setDepth(p.depth - 1);
    if (time >= this._nextWingsFxAt) {
      this._nextWingsFxAt = time + 160;
      // 風之尾跡：往「移動方向的反方向」噴出淡藍白色粒子，靜止不動時就隨機方向飄
      const vx = p.body.velocity.x, vy = p.body.velocity.y;
      const speed = Math.hypot(vx, vy);
      const backAng = speed > 5 ? Math.atan2(-vy, -vx) : Math.random() * Math.PI * 2;
      const bx = p.x + Math.cos(backAng) * 16, by = p.y + Math.sin(backAng) * 16;
      this.spawnEmbersFx(bx, by, 2, 0xcfe9ff);
    }
  }

  spawnFlameFx(x, y) {
    const fx = this.add.image(x, y, 'fx_flame').setDepth(29999);
    this.tweens.add({ targets: fx, scale: 1.6, alpha: 0, duration: 250, onComplete: () => fx.destroy() });
  }
  spawnLevelUpFx(x, y) {
    const fx = this.add.image(x, y, 'fx_levelup').setDepth(30001).setScale(0.4).setAlpha(0.9);
    this.tweens.add({ targets: fx, scale: 2.6, alpha: 0, duration: 700, onComplete: () => fx.destroy() });
    const fx2 = this.add.image(x, y, 'fx_levelup').setDepth(30001).setScale(0.2).setAlpha(0.7).setTint(0xffe066);
    this.tweens.add({ targets: fx2, scale: 3.4, alpha: 0, duration: 900, delay: 100, onComplete: () => fx2.destroy() });
    this.spawnBurstFx(x, y, 0x6fd3ff, 14, 'gem_exp', 130);
  }
  // 武器進化瞬間的華麗特效
  spawnEvolveFx(x, y) {
    audioManager.levelUp();
    this.cameras.main.flash(250, 255, 225, 110);
    for (let i = 0; i < 3; i++) {
      const ring = this.add.image(x, y, 'fx_levelup').setDepth(30002).setScale(0.3).setAlpha(0.9).setTint(0xffe066);
      this.tweens.add({
        targets: ring, scale: 3 + i, alpha: 0, duration: 700 + i * 150, delay: i * 100,
        onComplete: () => ring.destroy(),
      });
    }
    this.spawnBurstFx(x, y, 0xffe066, 20, 'fx_crit', 160);
  }

  // 攻擊「出招瞬間」特效：讓玩家清楚看到自己開火的那一刻。
  // evolved 為 true 時會套用金色進化版特效（更大、更亮、多一圈光環）
  spawnCastFx(x, y, kind, angle = 0, radius = 0, evolved = false) {
    const evoTint = 0xffe066;
    switch (kind) {
      case 'fireball': {
        const scale = evolved ? 1.3 : 0.85;
        const fx = this.add.image(x, y, 'fx_flame').setDepth(6001).setScale(scale).setAlpha(0.95);
        if (evolved) fx.setTint(evoTint);
        this.tweens.add({ targets: fx, scale: scale * 2, alpha: 0, duration: 220, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_flame', evolved ? evoTint : 0xff6a2d, 0.3, evolved ? 2.6 : 1.8, 260, 6000);
        this.spawnBurstFx(x, y, evolved ? evoTint : 0xff8a3d, evolved ? 12 : 6, 'fx_flame', evolved ? 130 : 85);
        break;
      }
      case 'lightning': {
        const fx = this.add.image(x, y, 'fx_bolt').setDepth(6001).setScale(evolved ? 2.4 : 1.5).setAlpha(1).setRotation(angle);
        fx.setTint(evolved ? evoTint : 0x7ef7ff);
        this.tweens.add({ targets: fx, scale: (evolved ? 2.4 : 1.5) * 1.6, alpha: 0, duration: 160, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_bolt', evolved ? evoTint : 0x7ef7ff, 0.4, evolved ? 2.2 : 1.4, 200, 6000);
        if (evolved) this.spawnBurstFx(x, y, evoTint, 10, 'fx_bolt', 120);
        break;
      }
      case 'knife': {
        const fx = this.add.image(x, y, 'fx_crit').setDepth(6001).setScale(evolved ? 1.9 : 1.15).setAlpha(0.95)
          .setRotation(angle).setTint(evolved ? evoTint : 0xdfefff);
        this.tweens.add({ targets: fx, scale: (evolved ? 1.9 : 1.15) * 1.7, alpha: 0, duration: 160, onComplete: () => fx.destroy() });
        break;
      }
      case 'frost': {
        const ring = this.add.image(x, y, 'fx_frost').setDepth(6001).setScale(radius / 24).setAlpha(0.7);
        if (evolved) ring.setTint(evoTint);
        this.tweens.add({
          targets: ring, alpha: 0, scale: radius / 20,
          duration: 400, onComplete: () => ring.destroy(),
        });
        // 二次擴散光環，讓範圍感更明顯，加上外圈發光層
        const ring2 = this.add.image(x, y, 'fx_frost').setDepth(6000).setScale(radius / 60).setAlpha(0.5);
        this.tweens.add({ targets: ring2, alpha: 0, scale: radius / 22, duration: 550, delay: 60, onComplete: () => ring2.destroy() });
        this.spawnGlowRing(x, y, 'fx_frost', evolved ? evoTint : 0x8fe3ff, radius / 80, radius / 26, 500, 5999);
        break;
      }
    }
  }

  // 攻擊「命中瞬間」特效：依武器種類顯示不同的命中視覺回饋，並附加碎片噴射與發光層
  spawnImpactFx(x, y, kind, radius = 0, evolved = false) {
    const evoTint = 0xffe066;
    switch (kind) {
      case 'fireball': {
        const scale = evolved ? 2.6 : 1.9;
        const fx = this.add.image(x, y, 'fx_flame').setDepth(29999).setScale(scale * 0.55);
        if (evolved) fx.setTint(evoTint);
        this.tweens.add({ targets: fx, scale, alpha: 0, duration: 280, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_flame', evolved ? evoTint : 0xff6a2d, 0.4, evolved ? 3.2 : 2.2, 340);
        this.spawnBurstFx(x, y, evolved ? evoTint : 0xff8a3d, evolved ? 16 : 10, 'fx_flame', evolved ? 170 : 115);
        this.spawnEmbersFx(x, y, evolved ? 10 : 6, evolved ? evoTint : 0xffb066);
        break;
      }
      case 'lightning': {
        const fx = this.add.image(x, y, 'fx_bolt').setDepth(29999).setScale(evolved ? 1.8 : 1.15).setAlpha(0.95);
        fx.setTint(evolved ? evoTint : 0x7ef7ff);
        this.tweens.add({ targets: fx, scale: (evolved ? 1.8 : 1.15) * 1.6, alpha: 0, duration: 190, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_bolt', evolved ? evoTint : 0x7ef7ff, 0.3, evolved ? 2.4 : 1.5, 220);
        this.spawnBurstFx(x, y, evolved ? evoTint : 0xaef9ff, evolved ? 10 : 5, 'fx_bolt', 110);
        break;
      }
      case 'knife': {
        const fx = this.add.image(x, y, 'fx_crit').setDepth(29999).setScale(evolved ? 1.5 : 0.95).setTint(evolved ? evoTint : 0xffffff);
        this.tweens.add({ targets: fx, scale: (evolved ? 1.5 : 0.95) * 1.7, alpha: 0, duration: 160, onComplete: () => fx.destroy() });
        this.spawnBurstFx(x, y, evolved ? evoTint : 0xdfefff, evolved ? 6 : 3, 'fx_crit', 90);
        break;
      }
      case 'sawblade': {
        const fx = this.add.image(x, y, 'fx_crit').setDepth(29999).setScale(evolved ? 1.3 : 0.8).setTint(evolved ? evoTint : 0xcfcfcf);
        this.tweens.add({ targets: fx, scale: (evolved ? 1.3 : 0.8) * 1.8, alpha: 0, duration: 140, onComplete: () => fx.destroy() });
        break;
      }
      case 'frost': {
        // 冰系刻意不跟其他武器共用金色進化色，維持藍色系（進化版用更亮的冰藍白）
        const frostEvoTint = 0xbfe9ff;
        const fx = this.add.image(x, y, 'fx_frost').setDepth(29999).setScale(evolved ? 1.5 : 0.85).setAlpha(0.85);
        if (evolved) fx.setTint(frostEvoTint);
        this.tweens.add({ targets: fx, scale: (evolved ? 1.5 : 0.85) * 1.9, alpha: 0, duration: 240, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_frost', evolved ? frostEvoTint : 0x8fe3ff, 0.3, evolved ? 2.6 : 1.5, 300);
        this.spawnBurstFx(x, y, evolved ? frostEvoTint : 0x8fe3ff, evolved ? 12 : 5, 'fx_frost', evolved ? 110 : 90);
        break;
      }
      default: {
        this.spawnKillFx(x, y);
      }
    }
  }

  // 電光連鎖特效：模仿英雄聯盟「史提克彈簧刀」電刀的連鎖閃電視覺——
  // 兩個命中點之間畫出一道鋸齒狀、會發光的電弧
  spawnChainLightningFx(x1, y1, x2, y2, evolved = false) {
    const color = evolved ? 0xffe066 : 0x7ef7ff;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // 垂直於連線方向的法線，用來做鋸齒偏移

    const graphics = this.add.graphics().setDepth(30000);
    graphics.setBlendMode(Phaser.BlendModes.ADD);
    const segments = 6;
    const drawBolt = (lineWidth, alpha, jagAmount) => {
      graphics.lineStyle(lineWidth, color, alpha);
      graphics.beginPath();
      graphics.moveTo(x1, y1);
      for (let i = 1; i < segments; i++) {
        const t = i / segments;
        const jag = (Math.random() - 0.5) * jagAmount;
        graphics.lineTo(x1 + dx * t + nx * jag, y1 + dy * t + ny * jag);
      }
      graphics.lineTo(x2, y2);
      graphics.strokePath();
    };
    drawBolt(evolved ? 5 : 3.5, 0.9, 16); // 外層粗光暈
    drawBolt(evolved ? 2 : 1.5, 1, 10);   // 內層細亮線

    this.tweens.add({
      targets: graphics, alpha: 0, duration: 160,
      onComplete: () => graphics.destroy(),
    });
    // 兩端各來一個電光閃爍
    this.spawnGlowRing(x1, y1, 'fx_bolt', color, 0.3, evolved ? 1.6 : 1.1, 150);
    this.spawnGlowRing(x2, y2, 'fx_bolt', color, 0.3, evolved ? 1.8 : 1.2, 170);
  }

  // 冰柱特效：從地面冒出一根結晶冰柱，命中範圍內敵人並造成減速。
  // knockback 為 null 時不造成擊退；evolved 為 true 時體型更大、特效更華麗，
  // 但刻意「不」套用其他武器共用的金色進化配色——冰系維持一貫的藍色系，
  // 用更亮更飽和的冰藍白（0xbfe9ff）來區分一般版與進化版。
  spawnIcePillar(x, y, dmg, slow, slowDuration, critRate, critDmg, knockback, evolved = false) {
    const tint = evolved ? 0xbfe9ff : null;

    // 地面裂痕／冰霜擴散提示，讓玩家注意到冰柱要冒出來的位置
    const crack = this.add.image(x, y, 'fx_frost').setDepth(y - 1).setScale(evolved ? 0.4 : 0.25).setAlpha(0.6);
    crack.setTint(evolved ? 0x8fd6ff : 0x8fe3ff);
    this.tweens.add({ targets: crack, scale: evolved ? 1.9 : 1.3, alpha: 0, duration: 260, onComplete: () => crack.destroy() });

    // 進化版限定：地面額外噴出幾道放射狀碎冰，堆疊出比一般版更華麗的地面特效
    if (evolved) {
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + Math.random() * 0.3;
        const shard = this.add.image(x, y, 'fx_frost').setDepth(y - 1).setScale(0.16).setAlpha(0.55).setTint(0xdff6ff);
        this.tweens.add({
          targets: shard,
          x: x + Math.cos(ang) * 30, y: y + Math.sin(ang) * 30,
          scale: 0.55, alpha: 0, duration: 340,
          onComplete: () => shard.destroy(),
        });
      }
    }

    // 冰柱由下往上「刺」出來的動畫（用 Back.easeOut 做出衝出地面的彈跳感），
    // 一般版跟進化版都是同一套「由內到外」的冒出邏輯，進化版只是體型更大
    const pillarScale = evolved ? 1.9 : 1.15;
    const pillar = this.add.image(x, y, 'fx_ice_pillar').setOrigin(0.5, 1).setDepth(y + 1).setScale(pillarScale, 0.05).setAlpha(0.95);
    if (tint) pillar.setTint(tint);

    this.tweens.add({
      targets: pillar,
      scaleY: pillarScale,
      duration: 150,
      ease: 'Back.easeOut',
      onComplete: () => {
        if (!pillar.active) return;
        // 冰柱冒出的瞬間造成傷害＋減速＋擊退
        const hitRadius = evolved ? 50 : 36;
        this.enemySystem.queryNear(x, y, hitRadius, (e) => {
          if (dist(x, y, e.x, e.y) > hitRadius) return;
          this.enemySystem.damageEnemy(e, dmg, critRate, critDmg, knockback ? {
            fromX: x, fromY: y, force: knockback.force, duration: knockback.duration,
          } : null);
          e.setData('slowUntil', this.time.now + slowDuration);
          e.setData('slowFactor', 1 - slow);
        });
        if (this.boss && this.boss.alive && dist(x, y, this.boss.sprite.x, this.boss.sprite.y) <= hitRadius + 20) {
          this.boss.takeDamage(dmg, critRate, critDmg);
        }
        this.spawnImpactFx(x, y, 'frost', hitRadius, evolved);

        if (evolved) {
          // 進化版收尾：頂端補一圈亮白冰晶閃光＋額外藍白碎片噴射，強調「更華麗」
          const flash = this.add.image(x, y - pillarScale * 34, 'fx_frost')
            .setDepth(y + 2).setScale(0.5).setAlpha(0.9).setTint(0xffffff).setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: flash, scale: 1.7, alpha: 0, duration: 280, onComplete: () => flash.destroy() });
          this.spawnBurstFx(x, y - 10, 0xbfe9ff, 12, 'fx_frost', 120);
        }

        // 停留一小段時間後縮回地面消失
        this.tweens.add({
          targets: pillar, scaleY: 0, alpha: 0, duration: 220, delay: 260,
          onComplete: () => pillar.destroy(),
        });
      },
    });
  }

  // 隕石襲擊（火球術進化「隕石燄爆」專用）：先在目標腳下標出警戒圈，
  // 短暫停頓後一顆巨大隕石從畫面上方直直砸下來，落地瞬間造成範圍爆炸傷害＋擊退。
  // 跟一般火球不同，這裡完全不經過投射物池／每幀碰撞判定，落點與爆炸都是直接算好的。
  spawnMeteorStrike(x, y, dmg, aoe, critRate, critDmg, knockback) {
    const warnColor = 0xff5a2d;

    // 警戒圈：在地面上標出即將被砸中的範圍，讓玩家有機會看到並閃避
    const warn = this.add.image(x, y, 'fx_frost').setDepth(y - 1).setScale(0.2).setAlpha(0.55).setTint(warnColor);
    this.tweens.add({
      targets: warn, scale: aoe / 24, alpha: 0.28, duration: 380, ease: 'Cubic.easeOut',
    });

    this.time.delayedCall(420, () => {
      warn.destroy();
      if (!this.player || !this.player.sprite.active) return;

      // 隕石本體：從畫面上方直直墜落到目標位置，用加速的 easeIn 模擬重力墜落感
      const meteor = this.add.image(x, y - 620, 'proj_fireball')
        .setDepth(30003).setScale(3.2).setTint(0xff6a2d).setRotation(0.4);
      const trailTimer = this.time.addEvent({
        delay: 40, loop: true,
        callback: () => {
          if (meteor.active) this.spawnEmbersFx(meteor.x, meteor.y - 10, 2, 0xff8a3d);
        },
      });

      this.tweens.add({
        targets: meteor,
        y,
        duration: 430,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          trailTimer.remove();
          meteor.destroy();

          // 落地爆炸：巨大爆炸特效＋範圍傷害（比照一般火球的 AOE 判定），
          // 不加鏡頭震動——跟火球一般命中一樣，震動太頻繁會干擾遊玩體驗
          this.spawnImpactFx(x, y, 'fireball', aoe, true);
          this.spawnBurstFx(x, y, 0xff6a2d, 20, 'fx_flame', 190);

          this.enemySystem.queryNear(x, y, aoe, (e) => {
            if (dist(x, y, e.x, e.y) > aoe) return;
            this.enemySystem.damageEnemy(e, dmg, critRate, critDmg, knockback ? {
              fromX: x, fromY: y, force: knockback.force, duration: knockback.duration,
            } : null);
          });
          if (this.boss && this.boss.alive && dist(x, y, this.boss.sprite.x, this.boss.sprite.y) <= aoe) {
            this.boss.takeDamage(dmg, critRate, critDmg);
          }
        },
      });
    });
  }
}
