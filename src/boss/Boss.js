import { dist, angleTo } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

const BOSS_BASE_HP = 900;
const BOSS_BASE_DMG = 22;

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
    const x = px + Math.cos(angle) * 500;
    const y = py + Math.sin(angle) * 500;

    this.sprite = scene.physics.add.sprite(x, y, 'boss_main');
    this.sprite.setScale(1.4);
    this.sprite.body.setCircle(24, 8, 8);
    this.sprite.setDepth(20000);

    this.phase = 'chase'; // chase | charge | aoe | ranged
    this.phaseTimer = 0;
    this.nextSkillAt = scene.time.now + 2500;
    this.chargeTarget = null;

    // 血條 UI (畫面固定位置，右上方中央)
    this.barBg = scene.add.image(scene.scale.width / 2, 70, 'ui_bar_bg')
      .setScrollFactor(0).setDepth(30000).setDisplaySize(320, 20);
    this.barFill = scene.add.image(scene.scale.width / 2 - 150, 70, 'ui_bar_fill_boss')
      .setScrollFactor(0).setDepth(30001).setOrigin(0, 0.5).setDisplaySize(300, 18);
    this.label = scene.add.text(scene.scale.width / 2, 50, 'Boss 降臨！', {
      fontSize: '16px', color: '#ff6b6b', fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(30001).setOrigin(0.5);

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

    // 接觸傷害
    if (dist(bx, by, px, py) < 34 && time - (this._lastTouch || 0) > 600) {
      this._lastTouch = time;
      const died = this.player.takeDamage(this.dmg * 0.5, time);
      if (died) this.scene.onPlayerDeath();
    }

    this.sprite.setFlipX(px < bx);
    this.barFill.setDisplaySize((this.hp / this.maxHp) * 300, 18);
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

  // 技能二：範圍攻擊
  _startAoe(time) {
    this.phase = 'aoe';
    const ring = this.scene.add.image(this.sprite.x, this.sprite.y, 'fx_frost')
      .setTint(0xff5b5b).setScale(1).setAlpha(0.8).setDepth(19999);
    this.scene.tweens.add({
      targets: ring, scale: 6, alpha: 0, duration: 700,
      onComplete: () => {
        ring.destroy();
        const d = dist(this.sprite.x, this.sprite.y, this.player.sprite.x, this.player.sprite.y);
        if (d < 160) {
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
    const count = 8;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const bolt = this.scene.physics.add.image(this.sprite.x, this.sprite.y, 'proj_frost').setTint(0xff8888);
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
    const fx = this.scene.add.image(this.sprite.x, this.sprite.y, 'fx_bossdeath').setDepth(20001);
    this.scene.tweens.add({
      targets: fx, scale: 2.4, alpha: 0, duration: 700,
      onComplete: () => fx.destroy(),
    });
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
