import { dist, angleTo } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { textStyle } from '../utils/TextStyle.js';

// 汪汪大作戰專用魔王：跟 Boss.js 的五種常駐魔王是完全獨立的系統——那邊是「三招
// 隨機輪流選」，這邊是「四招各自獨立 CD」，招式內容也完全不同（雷射掃射／防護罩
// 無敵／持續追人的隕石大招），共用一套邏輯反而會讓 Boss.js 變得更難懂，所以另外
// 獨立一個檔案。傷害刻意壓得很低（見 SKILLS 各招的 dmg），因為這隻魔王的定位是
// 「防禦血量異常高、讓玩家盡量拚傷害輸出」的活動關卡，不是要打死玩家的一般魔王。
const MAX_HP = 2_000_000;
const DEFENSE = 300; // 百分比減傷公式跟 Player.takeDamage 一致：100/(100+defense)
const TOUCH_RADIUS = 90;
const BOSS_SCALE = 0.55;

// 四招各自的施放/持續時間與 CD（單位 ms）。CD 從「這招真正結束」那一刻開始算，
// 不是從前搖開始算——避免快 CD 的招式因為前搖時間長被拖累。
const SKILLS = {
  charge: { castMs: 2000, cd: 4000, dashMs: 400, dmg: 40 },
  laser: { castMs: 3000, cd: 5000, beamMs: 600, dmg: 16, tickMs: 150 },
  shield: { castMs: 0, cd: 15000, durationMs: 5000 },
  meteor: { castMs: 0, cd: 20000, durationMs: 10000, tickMs: 300, dmg: 18, aoe: 70 },
};
const SKILL_LABELS = {
  charge: '⚠ 汪汪衝撞！', laser: '⚠ 汪汪雷射！', shield: '⚠ 汪汪護盾！', meteor: '⚠ 汪汪大災變！降下隕石！',
};

export default class WoofBoss {
  constructor(scene, player, x, y) {
    this.scene = scene;
    this.player = player;
    this.alive = true;
    this.maxHp = MAX_HP;
    this.hp = this.maxHp;
    this.defense = DEFENSE;
    this.totalDamageTaken = 0; // 「實際減血量」累計，供限時挑戰場景讀取顯示
    // UIScene 的魔王血條讀取 boss.typeDef.name／labelColor（見 UIScene.update()），
    // 汪汪沒有 BOSS_TYPES 那套型態表，補一個最小相容物件，血條才能正常顯示名稱。
    this.typeDef = { name: '汪汪', labelColor: '#ffb84d' };

    this.sprite = scene.physics.add.sprite(x, y, 'boss_woof');
    this.sprite.setScale(BOSS_SCALE);
    const texW = this.sprite.frame.width, texH = this.sprite.frame.height;
    const bodyRadius = texH * 0.22;
    this.sprite.body.setCircle(bodyRadius, texW / 2 - bodyRadius, texH * 0.58 - bodyRadius);
    this.sprite.setDepth(y);

    this.phase = 'chase'; // chase | telegraph | charge | laserBeam | meteorActive
    this.shieldActive = false;
    this.nextReadyAt = { charge: 0, laser: 0, shield: 0, meteor: 0 };
    this._chooseAt = scene.time.now + 1200;
    this.paralyzedUntil = 0; // 雷霆套裝三件套：麻痺中無法選新招式，見 update()／GameScene._maybeThunderParalyze()

    this.headBarBg = scene.add.image(x, y - 90, 'ui_bar_bg').setDisplaySize(160, 14).setDepth(29996);
    this.headBarFill = scene.add.image(x - 78, y - 90, 'ui_bar_fill_boss').setOrigin(0, 0.5).setDisplaySize(154, 10).setDepth(29997);

    scene.cameras.main.flash(300, 255, 255, 255);
    audioManager.bossRoar();
  }

  update(time) {
    if (!this.alive) return;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const bx = this.sprite.x, by = this.sprite.y;

    if (this.phase === 'chase') {
      const ang = angleTo(bx, by, px, py);
      const dToPlayer = dist(bx, by, px, py);
      // 保持一點距離感，不要整場黏在玩家臉上，讓雷射/隕石有發揮空間
      if (dToPlayer > 220) {
        this.sprite.body.setVelocity(Math.cos(ang) * 65, Math.sin(ang) * 65);
      } else {
        this.sprite.body.setVelocity(0, 0);
      }
      if (time >= this._chooseAt && time >= this.paralyzedUntil) this._chooseSkill(time);
    } else if (this.phase === 'telegraph') {
      this._updateTelegraph(time);
    } else if (this.phase === 'charge') {
      this._updateCharge(time);
    }

    // 接觸傷害：護盾期間一樣會撞人，但傷害維持很低，純粹是移動中的擦撞
    if (dist(bx, by, px, py) < TOUCH_RADIUS && time - (this._lastTouch || 0) > 700) {
      this._lastTouch = time;
      this.player.takeDamage(14, time);
    }

    this.sprite.setFlipX(px < bx);
    this.sprite.setDepth(by);

    const headY = by - 90;
    this.headBarBg.setPosition(bx, headY).setDepth(headY - 1);
    const hpRatio = Math.max(0, this.hp / this.maxHp);
    this.headBarFill.setPosition(bx - 78, headY).setDisplaySize(154 * hpRatio, 10).setDepth(headY);

    if (this.shieldBubble) this.shieldBubble.setPosition(bx, by);
  }

  // 四招之中，CD 已經轉好的隨機挑一招；都還在 CD 中就繼續 chase，1 秒後再檢查一次。
  _chooseSkill(time) {
    const ready = Object.keys(SKILLS).filter((k) => time >= this.nextReadyAt[k]);
    if (ready.length === 0) {
      this._chooseAt = time + 1000;
      return;
    }
    const kind = ready[Math.floor(Math.random() * ready.length)];
    this._startTelegraph(kind, time);
  }

  _startTelegraph(kind, time) {
    const def = SKILLS[kind];
    this.phase = def.castMs > 0 ? 'telegraph' : 'execute-instant';
    this._kind = kind;
    this._telegraphEndAt = time + def.castMs;
    this.sprite.body.setVelocity(0, 0);
    this._telegraphFx = [];

    const bx = this.sprite.x, by = this.sprite.y;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    this._lockedAngle = angleTo(bx, by, px, py);
    this._lockedTarget = { x: px, y: py };

    const label = this.scene.add.text(bx, by - 150, SKILL_LABELS[kind], textStyle({
      fontSize: '30px', color: '#ff4444', fontStyle: 'bold',
    })).setOrigin(0.5).setDepth(20010);
    this.scene.tweens.add({ targets: label, scale: 1.18, duration: 260, yoyo: true, repeat: -1 });
    this._telegraphLabel = label;
    this._telegraphFx.push(label);

    if (kind === 'charge') {
      this._telegraphFx.push(this._telegraphLine(bx, by, this._lockedAngle, 700, 0xff8a3d));
    } else if (kind === 'laser') {
      this._telegraphFx.push(this._telegraphLine(bx, by, this._lockedAngle, 1400, 0xff3d3d));
    }

    if (def.castMs === 0) {
      this._clearTelegraphFx();
      if (kind === 'shield') this._executeShield(time);
      else if (kind === 'meteor') this._executeMeteor(time);
    }
  }

  _telegraphLine(bx, by, ang, length, color) {
    const midX = bx + Math.cos(ang) * length / 2;
    const midY = by + Math.sin(ang) * length / 2;
    const line = this.scene.add.rectangle(midX, midY, length, 16, color, 0.35).setRotation(ang).setDepth(20009);
    this.scene.tweens.add({ targets: line, alpha: 0.8, duration: 220, yoyo: true, repeat: -1 });
    return line;
  }

  _clearTelegraphFx() {
    (this._telegraphFx || []).forEach((fx) => { this.scene.tweens.killTweensOf(fx); fx.destroy(); });
    this._telegraphFx = [];
    this._telegraphLabel = null;
  }

  _updateTelegraph(time) {
    if (this._telegraphLabel) this._telegraphLabel.setPosition(this.sprite.x, this.sprite.y - 150);
    if (time < this._telegraphEndAt) return;
    this._clearTelegraphFx();
    if (this._kind === 'charge') this._executeCharge(time);
    else if (this._kind === 'laser') this._executeLaser(time);
  }

  // 招式一：衝撞 —— 朝前搖鎖定的方向快速衝刺一小段，命中玩家造成一次接觸傷害
  _executeCharge(time) {
    this.phase = 'charge';
    this._chargeStartAt = time;
    this._chargeHit = false;
    this.scene.cameras.main.flash(150, 255, 150, 100);
    audioManager.bossRoar();
  }

  _updateCharge(time) {
    const def = SKILLS.charge;
    if (time - this._chargeStartAt > def.dashMs) {
      this.phase = 'chase';
      this.nextReadyAt.charge = time + def.cd;
      this._chooseAt = time + 400;
      return;
    }
    const ang = this._lockedAngle;
    this.sprite.body.setVelocity(Math.cos(ang) * 620, Math.sin(ang) * 620);
    if (!this._chargeHit && dist(this.sprite.x, this.sprite.y, this.player.sprite.x, this.player.sprite.y) < 100) {
      this._chargeHit = true;
      this.player.takeDamage(def.dmg, time);
      this.scene.spawnBurstFx(this.player.sprite.x, this.player.sprite.y, 0xff8a3d, 10, 'fx_crit', 140);
    }
    if (time % 55 < 20) {
      this.scene.spawnEmbersFx(this.sprite.x, this.sprite.y, 2, 0x8a5a2a);
    }
  }

  // 招式二：雷射 —— 前搖鎖定方向後，射出一道沿線的實體光束，命中判定用「玩家到
  // 直線的距離」計算，而不是投射物，因為光束是瞬間打穿全長，不是飛行過去的。
  _executeLaser(time) {
    this.phase = 'laserBeam';
    const def = SKILLS.laser;
    const bx = this.sprite.x, by = this.sprite.y;
    const ang = this._lockedAngle;
    const length = 1400;

    this.scene.cameras.main.flash(200, 255, 80, 80);
    audioManager.bossRoar();
    this.scene.spawnGlowRing(bx, by, 'fx_bossdeath', 0xff3d3d, 0.3, 2.2, 300);

    const beam = this.scene.add.image(bx, by, 'fx_bolt').setOrigin(0, 0.5).setDepth(19998)
      .setRotation(ang).setScale(length / 64, 3.2).setTint(0xff3d3d).setAlpha(0.85)
      .setBlendMode(Phaser.BlendModes.ADD);
    const beamCore = this.scene.add.image(bx, by, 'fx_bolt').setOrigin(0, 0.5).setDepth(19999)
      .setRotation(ang).setScale(length / 64, 1.3).setTint(0xffffff).setAlpha(0.7)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.time.delayedCall(def.beamMs, () => { beam.destroy(); beamCore.destroy(); });

    const endX = bx + Math.cos(ang) * length, endY = by + Math.sin(ang) * length;
    const startAt = time;
    let lastTickAt = 0;
    const tickTimer = this.scene.time.addEvent({
      delay: 40, loop: true,
      callback: () => {
        const now = this.scene.time.now;
        if (now - startAt > def.beamMs) { tickTimer.remove(); return; }
        if (now - lastTickAt < def.tickMs) return;
        const d = this._distToSegment(this.player.sprite.x, this.player.sprite.y, bx, by, endX, endY);
        if (d < 40) {
          lastTickAt = now;
          this.player.takeDamage(def.dmg, now);
          this.scene.spawnBurstFx(this.player.sprite.x, this.player.sprite.y, 0xff3d3d, 6, 'fx_crit', 100);
        }
      },
    });

    this.scene.time.delayedCall(def.beamMs, () => {
      this.phase = 'chase';
      this.nextReadyAt.laser = this.scene.time.now + def.cd;
      this._chooseAt = this.scene.time.now + 400;
    });
  }

  _distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t, cy = ay + dy * t;
    return dist(px, py, cx, cy);
  }

  // 招式三：防護罩 —— 5 秒無敵（takeDamage 直接無視），身上疊一層發光泡泡提示玩家
  // 現在打不進去，CD 從護盾結束那一刻開始算 15 秒。
  _executeShield(time) {
    this.phase = 'chase';
    this.shieldActive = true;
    const def = SKILLS.shield;
    this._chooseAt = time + 400;

    this.shieldBubble = this.scene.add.image(this.sprite.x, this.sprite.y, 'fx_bossdeath')
      .setTint(0x6fd3ff).setAlpha(0.45).setScale(3.4).setDepth(this.sprite.depth + 1)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: this.shieldBubble, alpha: 0.65, duration: 400, yoyo: true, repeat: -1 });
    audioManager.bossRoar();

    this.scene.time.delayedCall(def.durationMs, () => {
      this.shieldActive = false;
      if (this.shieldBubble) { this.shieldBubble.destroy(); this.shieldBubble = null; }
      this.nextReadyAt.shield = this.scene.time.now + def.cd;
    });
  }

  // 招式四（大招）：隕石 —— 10 秒內每 0.3 秒在玩家附近降下一顆隕石，落點會追著玩家
  // 目前位置（帶一點隨機散佈），逼玩家持續移動閃避，非常密集華麗。
  _executeMeteor(time) {
    this.phase = 'chase'; // 大招期間魔王本體維持一般移動，隕石獨立運作，不佔用招式判斷
    const def = SKILLS.meteor;
    this._chooseAt = time + 400;
    this.scene.cameras.main.flash(260, 255, 120, 60);
    audioManager.bossRoar();

    const startAt = time;
    const dropTimer = this.scene.time.addEvent({
      delay: def.tickMs, loop: true,
      callback: () => {
        if (this.scene.time.now - startAt > def.durationMs || !this.alive) { dropTimer.remove(); return; }
        if (!this.player.sprite.active) return;
        const px = this.player.sprite.x + (Math.random() - 0.5) * 160;
        const py = this.player.sprite.y + (Math.random() - 0.5) * 160;
        this._spawnMeteor(px, py, def.dmg, def.aoe);
      },
    });

    this.scene.time.delayedCall(def.durationMs, () => {
      this.nextReadyAt.meteor = this.scene.time.now + def.cd;
    });
  }

  _spawnMeteor(x, y, dmg, aoe) {
    // 落點警示圈：短暫預告，給玩家一點反應時間
    const warn = this.scene.add.circle(x, y, 6, 0xff6a2d, 0.3).setStrokeStyle(3, 0xff6a2d, 0.85).setDepth(20008);
    this.scene.tweens.add({ targets: warn, radius: aoe, duration: 260, ease: 'Sine.easeIn' });

    const meteor = this.scene.add.image(x, y - 420, 'proj_fireball').setDepth(30003)
      .setScale(2.2).setTint(0xff6a2d).setRotation(0.4);
    this.scene.tweens.add({
      targets: meteor, y, duration: 260, ease: 'Cubic.easeIn',
      onComplete: () => {
        meteor.destroy();
        warn.destroy();
        this.scene.spawnGlowRing(x, y, 'fx_flame', 0xff8a3d, 0.4, aoe / 26, 260);
        this.scene.spawnBurstFx(x, y, 0xff8a3d, 8, 'fx_flame', 140);
        if (dist(x, y, this.player.sprite.x, this.player.sprite.y) <= aoe) {
          this.player.takeDamage(dmg, this.scene.time.now);
        }
      },
    });
  }

  // 傷害計算跟一般魔王一樣走爆擊公式，但額外套用防禦減傷（100/(100+defense)），
  // 這才是「防禦異常高」的實際數值意義；累計「實際減血量」供場景結算用。
  takeDamage(amount, critRate = 0, critDmg = 150) {
    if (!this.alive) return;
    if (this.shieldActive) {
      this.scene.spawnDamageNumber(this.sprite.x, this.sprite.y - 30, 0, false);
      return;
    }
    let dmg = amount;
    let isCrit = false;
    if (Math.random() * 100 < critRate) {
      dmg *= critDmg / 100;
      isCrit = true;
    }
    // 雷霆套裝五件套：打中麻痺中的汪汪額外補傷害＋打雷特效，跟一般魔王的規則一致
    const setBonuses = this.scene.setBonuses;
    if (setBonuses && setBonuses.thunder5 && this.scene.time.now < this.paralyzedUntil) {
      dmg += this.player.stats.attack * 0.1;
      this.scene.spawnThunderStrikeFx(this.sprite.x, this.sprite.y);
    }
    const mitigated = Math.max(1, dmg * (100 / (100 + this.defense)));
    if (this.scene.applyLifesteal) this.scene.applyLifesteal(mitigated);
    this.hp -= mitigated;
    this.totalDamageTaken += mitigated;
    this.sprite.setTintFill(0xffffff);
    this.scene.spawnDamageNumber(this.sprite.x, this.sprite.y - 30, mitigated, isCrit);
    this.scene.time.delayedCall(60, () => {
      if (this.sprite.active) this.sprite.clearTint();
    });
    if (this.hp <= 0 && this.alive) this._die();
  }

  _die() {
    this.alive = false;
    this._clearTelegraphFx();
    audioManager.bossDeath();
    this.scene.cameras.main.flash(500, 255, 255, 255);
    const dx = this.sprite.x, dy = this.sprite.y;
    for (let i = 0; i < 4; i++) {
      const fx = this.scene.add.image(dx, dy, 'fx_bossdeath').setDepth(20001).setScale(0.6);
      this.scene.tweens.add({
        targets: fx, scale: 6 + i * 1.8, alpha: 0, duration: 900 + i * 220, delay: i * 130,
        onComplete: () => fx.destroy(),
      });
    }
    this.scene.spawnBurstFx(dx, dy, 0xff8a3d, 30, 'fx_crit', 260);
    this.sprite.destroy();
    this.headBarBg.destroy();
    this.headBarFill.destroy();
    if (this.shieldBubble) this.shieldBubble.destroy();
    if (this.scene.onWoofBossDefeated) this.scene.onWoofBossDefeated();
  }

  destroy() {
    this._clearTelegraphFx();
    if (this.sprite.active) this.sprite.destroy();
    this.headBarBg.destroy();
    this.headBarFill.destroy();
    if (this.shieldBubble) this.shieldBubble.destroy();
  }
}
