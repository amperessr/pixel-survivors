import Player from '../player/Player.js';
import MapGenerator from '../systems/MapGenerator.js';
import EnemySystem from '../enemy/EnemySystem.js';
import WeaponSystem from '../weapons/WeaponSystem.js';
import Boss from '../boss/Boss.js';
import { WEAPON_IDS } from '../weapons/WeaponData.js';
import { PASSIVE_IDS } from '../skills/PassiveData.js';
import { dist } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

const BOSS_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分鐘一隻 Boss

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
    this.weaponSystem = new WeaponSystem(this, this.player, this.enemySystem);
    this.weaponSystem.addOrUpgrade(WEAPON_IDS[0]); // 起始武器：火球術

    this.bossBoltGroup = this.physics.add.group();
    this.boss = null;
    this.nextBossAt = BOSS_INTERVAL_MS;

    this.startTime = this.time.now;
    this.killCount = 0;
    this.paused = false;
    this.escPaused = false; // 僅代表玩家手動按 ESC 暫停（用於顯示「已暫停」遮罩）

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

    this.player.update(time, delta);
    this.map.update(this.player.sprite.x, this.player.sprite.y);

    const elapsedMin = (time - this.startTime) / 60000;
    this.enemySystem.setDifficultyMinutes(elapsedMin);
    this.enemySystem.update(time, delta);
    this.weaponSystem.update(time, delta);

    this._updateCollisions(time);

    if (this.boss) {
      this.boss.update(time, delta);
    } else if (time - this.startTime > this.nextBossAt) {
      this.nextBossAt += BOSS_INTERVAL_MS;
      this.boss = new Boss(this, this.player, elapsedMin);
    }

    this.bossBoltGroup.children.iterate((bolt) => {
      if (!bolt || !bolt.active) return;
      if (dist(bolt.x, bolt.y, this.player.sprite.x, this.player.sprite.y) < 16) {
        const died = this.player.takeDamage(bolt.getData('dmg'), time);
        bolt.destroy();
        if (died) this.onPlayerDeath();
      }
    });
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
    let triggered = false;
    this.enemySystem.queryNear(p.x, p.y, 14, (e) => {
      if (!triggered && dist(p.x, p.y, e.x, e.y) <= 14) triggered = true;
    });
    if (!triggered && this.boss && this.boss.alive && dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= 20) {
      triggered = true;
    }
    if (!triggered) return;

    p.setData('exploded', true);
    this.enemySystem.queryNear(p.x, p.y, aoe, (e) => {
      if (dist(p.x, p.y, e.x, e.y) <= aoe) {
        this.enemySystem.damageEnemy(e, p.getData('dmg'), stats.critRate, stats.critDmg);
      }
    });
    if (this.boss && this.boss.alive && dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= aoe) {
      this.boss.takeDamage(p.getData('dmg'), stats.critRate, stats.critDmg);
    }
    this.spawnImpactFx(p.x, p.y, 'fireball');

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
    let target = null;
    this.enemySystem.queryNear(p.x, p.y, 14, (e) => {
      if (target || hitSet.has(e)) return;
      if (dist(p.x, p.y, e.x, e.y) <= 14) target = e;
    });
    let hitBoss = false;
    if (!target && this.boss && this.boss.alive && !hitSet.has(this.boss) &&
        dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= 20) {
      hitBoss = true;
    }
    if (!target && !hitBoss) return;

    if (hitBoss) {
      hitSet.add(this.boss);
      this.boss.takeDamage(p.getData('dmg'), stats.critRate, stats.critDmg);
      this.spawnImpactFx(this.boss.sprite.x, this.boss.sprite.y, 'knife');
    } else {
      hitSet.add(target);
      this.enemySystem.damageEnemy(target, p.getData('dmg'), stats.critRate, stats.critDmg);
      this.spawnImpactFx(p.x, p.y, 'knife');
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
    const range = p.getData('range');
    let target = null;
    this.enemySystem.queryNear(p.x, p.y, 14, (e) => {
      if (target || hitSet.has(e)) return;
      if (dist(p.x, p.y, e.x, e.y) <= 14) target = e;
    });
    let targetIsBoss = false;
    if (!target && this.boss && this.boss.alive && !hitSet.has(this.boss) &&
        dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= 20) {
      targetIsBoss = true;
    }
    if (!target && !targetIsBoss) return;

    const hitX = targetIsBoss ? this.boss.sprite.x : target.x;
    const hitY = targetIsBoss ? this.boss.sprite.y : target.y;

    if (targetIsBoss) {
      hitSet.add(this.boss);
      this.boss.takeDamage(p.getData('dmg'), stats.critRate, stats.critDmg);
    } else {
      hitSet.add(target);
      this.enemySystem.damageEnemy(target, p.getData('dmg'), stats.critRate, stats.critDmg);
    }
    this.spawnImpactFx(hitX, hitY, 'lightning');

    const chainsLeft = p.getData('chains') - 1;
    if (chainsLeft > 0) {
      const next = this._findNearestExcluding(hitX, hitY, hitSet, range);
      if (next) {
        p.setData('chains', chainsLeft);
        p.setPosition(hitX, hitY);
        const ang = Math.atan2(next.y - hitY, next.x - hitX);
        p.body.setVelocity(Math.cos(ang) * 420, Math.sin(ang) * 420);
        p.setData('expireAt', this.time.now + 500);
        return;
      }
    }
    this.weaponSystem.projectilePool.free(p);
  }

  // 鋸片：持續環繞傷害，各自用 lastHit 記錄每個目標的命中冷卻
  _handleSawbladeHits(time, stats) {
    for (const saw of this.weaponSystem.sawbladeSprites) {
      const dmg = this.weaponSystem.getSawbladeDamage();
      const lastHit = saw.getData('lastHit');
      this.enemySystem.queryNear(saw.x, saw.y, 16, (e) => {
        if (!e.active) return;
        if (dist(saw.x, saw.y, e.x, e.y) > 16) return;
        const last = lastHit.get(e) || 0;
        if (time - last < 300) return;
        lastHit.set(e, time);
        this.enemySystem.damageEnemy(e, dmg, stats.critRate, stats.critDmg);
        this.spawnImpactFx(e.x, e.y, 'sawblade');
      });
      if (this.boss && this.boss.alive && dist(saw.x, saw.y, this.boss.sprite.x, this.boss.sprite.y) < 34) {
        const last = lastHit.get(this.boss) || 0;
        if (time - last >= 300) {
          lastHit.set(this.boss, time);
          this.boss.takeDamage(dmg, stats.critRate, stats.critDmg);
          this.spawnImpactFx(this.boss.sprite.x, this.boss.sprite.y, 'sawblade');
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
    }
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
  }

  onBossDefeated() {
    this.boss = null;
    this.registerKill();
    this.onGainExp(30);
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

  // ---------- 特效輔助 ----------
  spawnCritFx(x, y) {
    const fx = this.add.image(x, y - 10, 'fx_crit').setDepth(30000);
    this.tweens.add({ targets: fx, y: y - 30, alpha: 0, duration: 350, onComplete: () => fx.destroy() });
  }
  spawnKillFx(x, y) {
    const fx = this.add.image(x, y, 'fx_kill').setDepth(29999).setScale(0.5);
    this.tweens.add({ targets: fx, scale: 1.4, alpha: 0, duration: 300, onComplete: () => fx.destroy() });
  }
  spawnFlameFx(x, y) {
    const fx = this.add.image(x, y, 'fx_flame').setDepth(29999);
    this.tweens.add({ targets: fx, scale: 1.6, alpha: 0, duration: 250, onComplete: () => fx.destroy() });
  }
  spawnLevelUpFx(x, y) {
    const fx = this.add.image(x, y, 'fx_levelup').setDepth(30001).setScale(0.4).setAlpha(0.9);
    this.tweens.add({ targets: fx, scale: 2.2, alpha: 0, duration: 600, onComplete: () => fx.destroy() });
  }

  // 攻擊「出招瞬間」特效：讓玩家清楚看到自己開火的那一刻
  spawnCastFx(x, y, kind, angle = 0, radius = 0) {
    switch (kind) {
      case 'fireball': {
        const fx = this.add.image(x, y, 'fx_flame').setDepth(6001).setScale(0.7).setAlpha(0.95);
        this.tweens.add({ targets: fx, scale: 1.3, alpha: 0, duration: 180, onComplete: () => fx.destroy() });
        break;
      }
      case 'lightning': {
        const fx = this.add.image(x, y, 'fx_bolt').setDepth(6001).setScale(1.3).setAlpha(1)
          .setRotation(angle);
        this.tweens.add({ targets: fx, scale: 2, alpha: 0, duration: 160, onComplete: () => fx.destroy() });
        break;
      }
      case 'knife': {
        const fx = this.add.image(x, y, 'fx_crit').setDepth(6001).setScale(1).setAlpha(0.95)
          .setRotation(angle).setTint(0xdfefff);
        this.tweens.add({ targets: fx, scale: 1.6, alpha: 0, duration: 160, onComplete: () => fx.destroy() });
        break;
      }
      case 'frost': {
        const ring = this.add.image(x, y, 'fx_frost').setDepth(6001).setScale(radius / 24).setAlpha(0.7);
        this.tweens.add({
          targets: ring, alpha: 0, scale: radius / 20,
          duration: 400, onComplete: () => ring.destroy(),
        });
        break;
      }
    }
  }

  // 攻擊「命中瞬間」特效：依武器種類顯示不同的命中視覺回饋
  spawnImpactFx(x, y, kind) {
    switch (kind) {
      case 'fireball': {
        const fx = this.add.image(x, y, 'fx_flame').setDepth(29999);
        this.tweens.add({ targets: fx, scale: 1.6, alpha: 0, duration: 250, onComplete: () => fx.destroy() });
        break;
      }
      case 'lightning': {
        const fx = this.add.image(x, y, 'fx_bolt').setDepth(29999).setScale(0.9).setAlpha(0.95);
        this.tweens.add({ targets: fx, scale: 1.4, alpha: 0, duration: 180, onComplete: () => fx.destroy() });
        break;
      }
      case 'knife': {
        const fx = this.add.image(x, y, 'fx_crit').setDepth(29999).setScale(0.7).setTint(0xffffff);
        this.tweens.add({ targets: fx, scale: 1.1, alpha: 0, duration: 150, onComplete: () => fx.destroy() });
        break;
      }
      case 'sawblade': {
        const fx = this.add.image(x, y, 'fx_crit').setDepth(29999).setScale(0.6).setTint(0xcfcfcf);
        this.tweens.add({ targets: fx, scale: 1, alpha: 0, duration: 130, onComplete: () => fx.destroy() });
        break;
      }
      case 'frost': {
        const fx = this.add.image(x, y, 'fx_frost').setDepth(29999).setScale(0.6).setAlpha(0.85);
        this.tweens.add({ targets: fx, scale: 1.1, alpha: 0, duration: 220, onComplete: () => fx.destroy() });
        break;
      }
      default: {
        this.spawnKillFx(x, y);
      }
    }
  }
}
