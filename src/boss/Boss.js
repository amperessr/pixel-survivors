import { dist, angleTo } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { textStyle } from '../utils/TextStyle.js';

const BOSS_BASE_HP = 900;
const BOSS_BASE_DMG = 22;
// Boss 體型：至少要比一般小怪大 5 倍以上（一般小怪顯示大小約 24~48px，
// Boss 材質原生 64x64，用 4.0 倍縮放後顯示約 256px，安全超過 5 倍）
const BOSS_SCALE = 4.0;
const BOSS_TOUCH_RADIUS = 95;   // Boss 對玩家造成接觸傷害的判定半徑（跟著體型放大）
const BOSS_AOE_HIT_RADIUS = 220; // Boss 範圍技能命中玩家的判定半徑

// Boss 系統：具備衝撞 / 範圍攻擊 / 遠距攻擊 三種技能，血條與死亡動畫
export default class Boss {
  constructor(scene, player, difficultyMinutes) {
    this.scene = scene;
    this.player = player;
    this.alive = true;

    const scaling = 1 + difficultyMinutes * 0.35;
    this.maxHp = BOSS_BASE_HP * scaling;
    this.hp = this.maxHp;
    this.dmg = BOSS_BASE_DMG * (1 + difficultyMinutes * 0.15);

    const px = player.sprite.x, py = player.sprite.y;
    const angle = Math.random() * Math.PI * 2;
    const x = px + Math.cos(angle) * 600;
    const y = py + Math.sin(angle) * 600;

    this.sprite = scene.physics.add.sprite(x, y, 'boss_main');
    this.sprite.setScale(BOSS_SCALE);
    this.sprite.body.setCircle(24, 8, 8);
    this.sprite.setDepth(y);

    this.phase = 'chase'; // chase | charge | aoe | ranged
    this.phaseTimer = 0;
    this.nextSkillAt = scene.time.now + 2500;
    this.chargeTarget = null;

    // 血條 UI (畫面固定位置，右上方中央)
    this.barBg = scene.add.image(scene.scale.width / 2, 130, 'ui_bar_bg')
      .setScrollFactor(0).setDepth(30000).setDisplaySize(600, 36);
    this.barFill = scene.add.image(scene.scale.width / 2 - 290, 130, 'ui_bar_fill_boss')
      .setScrollFactor(0).setDepth(30001).setOrigin(0, 0.5).setDisplaySize(580, 32);
    this.label = scene.add.text(scene.scale.width / 2, 88, '⚠ 巨型 Boss 降臨！ ⚠', textStyle({
      fontSize: '34px', color: '#ff6b6b',
    })).setScrollFactor(0).setDepth(30001).setOrigin(0.5);

    // 登場震撼效果：鏡頭震動＋巨大陰影光環，凸顯體型巨大
    scene.cameras.main.shake(400, 0.01);
    const shadow = scene.add.image(x, y, 'fx_bossdeath').setTint(0x330000).setAlpha(0.5).setScale(0.5).setDepth(y - 1);
    scene.tweens.add({ targets: shadow, scale: 3.2, alpha: 0, duration: 500, onComplete: () => shadow.destroy() });

    audioManager.bossRoar();
  }

  update(time, delta) {
    if (!this.alive) return;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const bx = this.sprite.x, by = this.sprite.y;

    if (time > this.nextSkillAt && this.phase === 'chase') {
      this._chooseSkill(time);
    }

    if (this.phase === 'chase') {
      const ang = angleTo(bx, by, px, py);
      this.sprite.body.setVelocity(Math.cos(ang) * 70, Math.sin(ang) * 70);
    } else if (this.phase === 'charge') {
      this._updateCharge(time);
    }

    // 接觸傷害（判定半徑跟著巨大體型放大）
    if (dist(bx, by, px, py) < BOSS_TOUCH_RADIUS && time - (this._lastTouch || 0) > 600) {
      this._lastTouch = time;
      const died = this.player.takeDamage(this.dmg * 0.5, time);
      if (died) this.scene.onPlayerDeath();
    }

    this.sprite.setFlipX(px < bx);
    this.sprite.setDepth(by);
    this.barFill.setDisplaySize((this.hp / this.maxHp) * 580, 32);
  }

  _chooseSkill(time) {
    const r = Math.random();
    if (r < 0.34) this._startCharge(time);
    else if (r < 0.67) this._startAoe(time);
    else this._startRanged(time);
  }

  // 技能一：衝撞
  _startCharge(time) {
    this.phase = 'charge';
    this.chargeTarget = { x: this.player.sprite.x, y: this.player.sprite.y };
    this.sprite.setTint(0xffaaaa);
    this.scene.cameras.main.flash(150, 255, 100, 100);
    this._chargeStartAt = time;
  }

  _updateCharge(time) {
    if (time - this._chargeStartAt > 900) {
      this.phase = 'chase';
      this.sprite.clearTint();
      this.nextSkillAt = time + 2800;
      return;
    }
    const ang = angleTo(this.sprite.x, this.sprite.y, this.chargeTarget.x, this.chargeTarget.y);
    this.sprite.body.setVelocity(Math.cos(ang) * 480, Math.sin(ang) * 480);
  }

  // 技能二：範圍攻擊（視覺範圍跟著巨大體型放大）
  _startAoe(time) {
    this.phase = 'aoe';
    const ring = this.scene.add.image(this.sprite.x, this.sprite.y, 'fx_frost')
      .setTint(0xff5b5b).setScale(1).setAlpha(0.8).setDepth(19999);
    this.scene.cameras.main.shake(200, 0.006);
    this.scene.tweens.add({
      targets: ring, scale: 16, alpha: 0, duration: 700,
      onComplete: () => {
        ring.destroy();
        const d = dist(this.sprite.x, this.sprite.y, this.player.sprite.x, this.player.sprite.y);
        if (d < BOSS_AOE_HIT_RADIUS) {
          const died = this.player.takeDamage(this.dmg, this.scene.time.now);
          if (died) this.scene.onPlayerDeath();
        }
        this.phase = 'chase';
        this.nextSkillAt = this.scene.time.now + 3200;
      },
    });
  }

  // 技能三：遠距攻擊 (發射多發彈幕)
  _startRanged(time) {
    this.phase = 'ranged';
    const count = 10;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const bolt = this.scene.physics.add.image(this.sprite.x, this.sprite.y, 'proj_frost').setTint(0xff8888).setScale(1.4);
      bolt.body.setVelocity(Math.cos(ang) * 220, Math.sin(ang) * 220);
      bolt.setData('dmg', this.dmg * 0.5);
      bolt.setData('kind', 'bossBolt');
      this.scene.bossBoltGroup.add(bolt);
      this.scene.time.delayedCall(3000, () => { if (bolt.active) bolt.destroy(); });
    }
    this.scene.time.delayedCall(400, () => {
      this.phase = 'chase';
      this.nextSkillAt = this.scene.time.now + 3000;
    });
  }

  takeDamage(amount, critRate = 0, critDmg = 150) {
    let dmg = amount;
    if (Math.random() * 100 < critRate) dmg *= critDmg / 100;
    this.hp -= dmg;
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => { if (this.sprite.active) this.sprite.clearTint(); });
    if (this.hp <= 0 && this.alive) {
      this._die();
    }
  }

  _die() {
    this.alive = false;
    audioManager.bossDeath();
    this.scene.cameras.main.shake(500, 0.015);
    // 巨大體型死亡時要有相對應的盛大爆炸效果
    for (let i = 0; i < 3; i++) {
      const fx = this.scene.add.image(this.sprite.x, this.sprite.y, 'fx_bossdeath').setDepth(20001).setScale(0.6);
      this.scene.tweens.add({
        targets: fx, scale: 5 + i * 1.5, alpha: 0, duration: 800 + i * 200, delay: i * 120,
        onComplete: () => fx.destroy(),
      });
    }
    this.sprite.destroy();
    this.barBg.destroy();
    this.barFill.destroy();
    this.label.destroy();
    this.scene.onBossDefeated();
  }

  destroy() {
    if (this.sprite.active) this.sprite.destroy();
    this.barBg.destroy();
    this.barFill.destroy();
    this.label.destroy();
  }
}
