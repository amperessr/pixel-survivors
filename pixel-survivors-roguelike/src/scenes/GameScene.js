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
    this.cameras.main.setZoom(1);

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

  // 統一處理武器投射物 / 鋸片 對敵人的碰撞
  _updateCollisions(time) {
    const stats = this.player.stats;

    this.weaponSystem.projectilePool.forEachActive((p) => {
      if (!p.active) return;
      const kind = p.getData('kind');
      this.enemySystem.forEachActive((e) => {
        if (!e.active) return;
        const r = kind === 'fireball' ? p.getData('aoe') : 14;
        if (dist(p.x, p.y, e.x, e.y) > r) return;

        if (kind === 'lightning') {
          const hitSet = p.getData('hitSet');
          if (hitSet.has(e)) return;
          hitSet.add(e);
          this.enemySystem.damageEnemy(e, p.getData('dmg'), stats.critRate, stats.critDmg);
          const chainsLeft = p.getData('chains') - 1;
          if (chainsLeft > 0) {
            const next = this._findNearestExcluding(e.x, e.y, hitSet, p.getData('range'));
            if (next) {
              p.setData('chains', chainsLeft);
              p.setPosition(e.x, e.y);
              const ang = Math.atan2(next.y - e.y, next.x - e.x);
              p.body.setVelocity(Math.cos(ang) * 420, Math.sin(ang) * 420);
              p.setData('expireAt', this.time.now + 500);
              return;
            }
          }
          this.weaponSystem.projectilePool.free(p);
          return;
        }

        // 火球 / 飛刀
        this.enemySystem.damageEnemy(e, p.getData('dmg'), stats.critRate, stats.critDmg);
        if (kind === 'fireball') {
          this.spawnFlameFx(p.x, p.y);
        }
        const pierce = p.getData('pierce') || 0;
        if (pierce > 0) {
          p.setData('pierce', pierce - 1);
        } else {
          this.weaponSystem.projectilePool.free(p);
        }
      });
    });

    // 鋸片持續傷害
    for (const saw of this.weaponSystem.sawbladeSprites) {
      const dmg = this.weaponSystem.getSawbladeDamage();
      const lastHit = saw.getData('lastHit');
      this.enemySystem.forEachActive((e) => {
        if (!e.active) return;
        if (dist(saw.x, saw.y, e.x, e.y) > 16) return;
        const last = lastHit.get(e) || 0;
        if (time - last < 300) return;
        lastHit.set(e, time);
        this.enemySystem.damageEnemy(e, dmg, stats.critRate, stats.critDmg);
      });
      if (this.boss && this.boss.alive && dist(saw.x, saw.y, this.boss.sprite.x, this.boss.sprite.y) < 34) {
        const last = lastHit.get(this.boss) || 0;
        if (time - last >= 300) {
          lastHit.set(this.boss, time);
          this.boss.takeDamage(dmg, stats.critRate, stats.critDmg);
        }
      }
    }

    // 玩家投射物 對 Boss
    if (this.boss && this.boss.alive) {
      this.weaponSystem.projectilePool.forEachActive((p) => {
        if (!p.active) return;
        if (dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) < 30) {
          this.boss.takeDamage(p.getData('dmg'), stats.critRate, stats.critDmg);
          const kind = p.getData('kind');
          if (kind !== 'lightning') {
            this.weaponSystem.projectilePool.free(p);
          }
        }
      });
    }
  }

  _findNearestExcluding(x, y, excludeSet, range) {
    let best = null, bestD = Infinity;
    this.enemySystem.forEachActive((e) => {
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
    if (this.paused) {
      this.physics.world.pause();
      this.scene.launch('UIScene', { gameScene: this, showPauseOverlay: true });
    } else {
      this.physics.world.resume();
      this.events.emit('hidePauseOverlay');
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
}
