import { dist, angleTo } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { textStyle } from '../utils/TextStyle.js';

// 汪汪大作戰專用魔王：跟 Boss.js 的五種常駐魔王是完全獨立的系統——那邊是「三招
// 隨機輪流選」，這邊是「四招各自獨立 CD」，招式內容也完全不同（雷射掃射／防護罩
// 無敵／持續追人的隕石大招），共用一套邏輯反而會讓 Boss.js 變得更難懂，所以另外
// 獨立一個檔案。2026-07-11 平衡調整：四招傷害全面拉高到「不閃真的會死」的程度
// （見 SKILLS 各招的 dmg）。血量歸零現在會直接結束這次挑戰（見 GameScene.update()
// 的 woofWarMode 分支），數值故意沒有跟著調降——保留原本「逼玩家認真閃招」的
// 高風險設計，死亡的代價從「無傷害地滿血復活」變成「提早結束挑戰」。
const MAX_HP = 2_000_000;
const DEFENSE = 300; // 百分比減傷公式跟 Player.takeDamage 一致：100/(100+defense)
const TOUCH_RADIUS = 90;
const BOSS_SCALE = 0.55;

// 四招各自的施放/持續時間與 CD（單位 ms）。CD 從「這招真正結束」那一刻開始算，
// 不是從前搖開始算——避免快 CD 的招式因為前搖時間長被拖累。
const SKILLS = {
  charge: { castMs: 2000, cd: 4000, dashMs: 400, dmg: 400 },
  // 雷射改成「持續 5 秒的追蹤光束」：不再是前搖鎖定方向就打完的一次性直線，
  // 執行期間每 tickMs 判定一次傷害，光束角度會持續朝玩家目前位置轉向，但轉速
  // 有上限（turnDegPerSec，每秒最多轉幾度）——玩家平移閃避還是躲得掉，不是
  // 無腦鎖死的必中光束，只是不能傻站原地不動。
  // 2026-07-11 再調整：光束視覺＋命中判定半徑一起放大（HIT_RADIUS 是視覺寬度
  // 換算出來的，兩者維持同比例，不然畫面看起來很粗、判定範圍卻沒跟著變寬）。
  laser: { castMs: 3000, cd: 8000, beamMs: 5000, dmg: 100, tickMs: 500, turnDegPerSec: 20, hitRadius: 100 },
  shield: { castMs: 0, cd: 15000, durationMs: 5000 },
  // 隕石：警示圈先出現、停留 warnMs 再真正落下（跟舊版「警示跟落下同時播、
  // 260ms 就砸下來」比，反應時間拉長成看得到、躲得掉），落點間隔也拉開到
  // 跟 warnMs+fallMs 差不多長，一顆一顆分明，不會疊成連續閃爍。aoe 同時是視覺
  // 警示圈半徑跟實際命中判定範圍（同一個數字），2026-07-11 再放大一倍。
  meteor: { castMs: 0, cd: 20000, durationMs: 10000, tickMs: 900, dmg: 600, aoe: 140, warnMs: 700, fallMs: 180 },
};
// 放技能時汪汪會喊的台詞（跟安培談好的規格），取代原本純功能性的「⚠ 汪汪衝撞！」
// 警示字——本身就有「宣告技能」的功能，不用兩套文字疊在一起。
const SKILL_VOICE_LINES = {
  meteor: '我不止霸凌你們我還霸凌老闆!',
  charge: '媽的撞死你!',
  laser: '跩跩你腳本寫完沒!!',
  shield: '我覺得我現在強的可怕',
};
const VOICE_LINE_DISPLAY_MS = 1800; // 台詞固定顯示這麼久，跟前搖時間脫鉤——
// 瞬發技（護盾/隕石）前搖是 0ms，不脫鉤的話台詞會跟舊版警示字一樣，根本來不及看到就被清掉了。

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

    this.phase = 'chase'; // chase | telegraph | charge | laserBeam | meteorActive | shieldActive（除了 chase／charge 的衝刺移動，其餘施法中都不會移動）
    this.shieldActive = false;
    this.nextReadyAt = { charge: 0, laser: 0, shield: 0, meteor: 0 };
    this._chooseAt = scene.time.now + 1200;
    this.paralyzedUntil = 0; // 雷霆套裝三件套：麻痺中無法選新招式，見 update()／GameScene._maybeThunderParalyze()
    this.nextParalyzeFxAt = 0; // 麻痺中身上竄電特效的節流時間戳，見 update()

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
    }

    // 麻痺視覺：跟小怪一樣，身上要看得出電流竄動，不是只有選不了招式
    if (time < this.paralyzedUntil && time >= this.nextParalyzeFxAt) {
      this.nextParalyzeFxAt = time + 90 + Math.random() * 70;
      this.scene.spawnBodyLightningFx(bx, by - this.sprite.displayHeight * 0.25);
    }

    if (this.phase === 'telegraph') {
      this._updateTelegraph(time);
    } else if (this.phase === 'charge') {
      this._updateCharge(time);
    } else if (this.phase === 'laserBeam') {
      this._updateLaserBeam(time);
    }

    // 接觸傷害：護盾期間一樣會撞人，但傷害維持很低，純粹是移動中的擦撞
    if (dist(bx, by, px, py) < TOUCH_RADIUS && time - (this._lastTouch || 0) > 700) {
      this._lastTouch = time;
      this.player.takeDamage(14, time);
    }

    // 台詞跟著汪汪走，生命週期跟前搖/招式無關（見 _showVoiceLine），所以每幀都要
    // 重新定位，不能只放在 telegraph 分支裡更新。
    if (this._voiceLineLabel) this._voiceLineLabel.setPosition(bx, by - 150);

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

    this._showVoiceLine(kind);

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
  }

  // 台詞泡泡：跟前搖時間脫鉤，固定顯示 VOICE_LINE_DISPLAY_MS 就自己收掉（見
  // update() 裡每幀重新定位），不進 _telegraphFx，瞬發技（護盾/隕石）呼叫
  // _clearTelegraphFx() 時不會被連帶清掉、來不及被玩家看到。
  _showVoiceLine(kind) {
    if (this._voiceLineLabel) { this._voiceLineLabel.destroy(); this._voiceLineLabel = null; }
    const bx = this.sprite.x, by = this.sprite.y;
    const label = this.scene.add.text(bx, by - 150, `汪汪：${SKILL_VOICE_LINES[kind]}`, textStyle({
      fontSize: '28px', color: '#ff4444', fontStyle: 'bold',
    })).setOrigin(0.5).setDepth(20010);
    this.scene.tweens.add({ targets: label, scale: 1.15, duration: 260, yoyo: true, repeat: -1 });
    this._voiceLineLabel = label;
    this.scene.time.delayedCall(VOICE_LINE_DISPLAY_MS, () => {
      if (this._voiceLineLabel === label) {
        this.scene.tweens.killTweensOf(label);
        label.destroy();
        this._voiceLineLabel = null;
      }
    });
  }

  _updateTelegraph(time) {
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

  // 招式二：雷射 —— 前搖先鎖定初始方向給玩家一個瞄準預告，實際發射後改成
  // 持續 beamMs 的追蹤光束：每幀把光束角度朝玩家目前位置轉一點（轉速上限
  // turnDegPerSec，見 _updateLaserBeam），不是焊死角度打完就收，玩家不能
  // 站著不動硬吃，但平移閃避還是躲得掉，不是無腦必中。
  _executeLaser(time) {
    this.phase = 'laserBeam';
    const def = SKILLS.laser;
    const bx = this.sprite.x, by = this.sprite.y;
    this._laserAngle = this._lockedAngle;
    // 汪汪本體施法期間完全不動（見 _executeLaser 呼叫前的 telegraph 已經定住），
    // 玩家只要一路跑，5 秒的持續時間內很容易跑出原本 1400 的射程，讓光束看起來
    // 明明對準玩家卻打不到——射程拉長到 3200，遠超玩家 5 秒內跑得到的距離。
    this._laserLength = 3200;
    this._laserStartAt = time;
    this._laserLastTickAt = 0;

    this.scene.cameras.main.flash(200, 255, 80, 80);
    audioManager.bossRoar();
    this.scene.spawnGlowRing(bx, by, 'fx_bossdeath', 0xff3d3d, 0.3, 2.2, 300);

    // 2026-07-11 放大很多：外層光暈 3.2→8、核心 1.3→3.5，跟命中判定
    // def.hitRadius 保持同比例（見 _updateLaserBeam），視覺跟實際範圍對得上。
    this._laserBeam = this.scene.add.image(bx, by, 'fx_bolt').setOrigin(0, 0.5).setDepth(19998)
      .setRotation(this._laserAngle).setScale(this._laserLength / 64, 8).setTint(0xff3d3d).setAlpha(0.85)
      .setBlendMode(Phaser.BlendModes.ADD);
    this._laserBeamCore = this.scene.add.image(bx, by, 'fx_bolt').setOrigin(0, 0.5).setDepth(19999)
      .setRotation(this._laserAngle).setScale(this._laserLength / 64, 3.5).setTint(0xffffff).setAlpha(0.7)
      .setBlendMode(Phaser.BlendModes.ADD);
  }

  // 每幀更新一次：光束角度朝玩家現在的位置緩緩轉向（有轉速上限，不是瞬間鎖死），
  // 位置固定在魔王身上；每 tickMs 判定一次「玩家到光束線段的距離」造成傷害，
  // 時間到 beamMs 就收尾、進 CD。
  _updateLaserBeam(time) {
    const def = SKILLS.laser;
    const bx = this.sprite.x, by = this.sprite.y;
    const targetAngle = angleTo(bx, by, this.player.sprite.x, this.player.sprite.y);
    const delta = this.scene.game.loop.delta || 16;
    const maxTurn = Phaser.Math.DegToRad(def.turnDegPerSec) * (delta / 1000);
    this._laserAngle = Phaser.Math.Angle.RotateTo(this._laserAngle, targetAngle, maxTurn);

    this._laserBeam.setPosition(bx, by).setRotation(this._laserAngle);
    this._laserBeamCore.setPosition(bx, by).setRotation(this._laserAngle);

    if (time - this._laserLastTickAt >= def.tickMs) {
      this._laserLastTickAt = time;
      const endX = bx + Math.cos(this._laserAngle) * this._laserLength;
      const endY = by + Math.sin(this._laserAngle) * this._laserLength;
      const d = this._distToSegment(this.player.sprite.x, this.player.sprite.y, bx, by, endX, endY);
      if (d < def.hitRadius) {
        this.player.takeDamage(def.dmg, time);
        this.scene.spawnBurstFx(this.player.sprite.x, this.player.sprite.y, 0xff3d3d, 6, 'fx_crit', 100);
      }
    }

    if (time - this._laserStartAt >= def.beamMs) {
      this._laserBeam.destroy();
      this._laserBeamCore.destroy();
      this._laserBeam = null;
      this._laserBeamCore = null;
      this.phase = 'chase';
      this.nextReadyAt.laser = time + def.cd;
      this._chooseAt = time + 400;
    }
  }

  _distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t, cy = ay + dy * t;
    return dist(px, py, cx, cy);
  }

  // 招式三：防護罩 —— 5 秒無敵（takeDamage 直接無視），身上疊一層金色透明光罩提示玩家
  // 現在打不進去，CD 從護盾結束那一刻開始算 15 秒。
  _executeShield(time) {
    // 施法（護盾持續期間）汪汪不能移動——'shieldActive' 不是 update() 會處理
    // 移動邏輯的 phase，效果等同定住，時間到才回 chase。
    this.phase = 'shieldActive';
    this.sprite.body.setVelocity(0, 0);
    this.shieldActive = true;
    const def = SKILLS.shield;

    this.shieldBubble = this.scene.add.image(this.sprite.x, this.sprite.y, 'fx_bossdeath')
      .setTint(0xffd700).setAlpha(0.5).setScale(3.4).setDepth(this.sprite.depth + 1)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: this.shieldBubble, alpha: 0.75, duration: 400, yoyo: true, repeat: -1 });
    audioManager.bossRoar();

    this.scene.time.delayedCall(def.durationMs, () => {
      this.shieldActive = false;
      if (this.shieldBubble) { this.shieldBubble.destroy(); this.shieldBubble = null; }
      this.phase = 'chase';
      this.nextReadyAt.shield = this.scene.time.now + def.cd;
      this._chooseAt = this.scene.time.now + 400;
    });
  }

  // 招式四（大招）：隕石 —— 10 秒內每 tickMs 在玩家附近降下一顆隕石，落點會追著
  // 玩家目前位置（帶一點隨機散佈）。tickMs 抓得跟「警示出現到砸落」的總時間差不多，
  // 一顆一顆分明地逼玩家持續移動閃避，不會疊成連續閃爍。施法（大招整個 10 秒）
  // 期間汪汪本體不能移動——'meteorActive' 不是 update() 會處理移動邏輯的 phase。
  _executeMeteor(time) {
    this.phase = 'meteorActive';
    this.sprite.body.setVelocity(0, 0);
    const def = SKILLS.meteor;
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
        this._spawnMeteor(px, py, def.dmg, def.aoe, def.warnMs, def.fallMs);
      },
    });

    this.scene.time.delayedCall(def.durationMs, () => {
      this.phase = 'chase';
      this.nextReadyAt.meteor = this.scene.time.now + def.cd;
      this._chooseAt = this.scene.time.now + 400;
    });
  }

  // 警示圈先快速長到全尺寸、停留 warnMs 給玩家看清楚並閃開，時間到才真的召喚隕石
  // 落下（fallMs，短促有衝擊感）——跟舊版「警示跟砸落同時播、0.26 秒就打中」比，
  // 是完全不同的節奏：看得到、來得及反應，而不是一片連續閃爍的警示圈。
  _spawnMeteor(x, y, dmg, aoe, warnMs, fallMs) {
    const warn = this.scene.add.circle(x, y, 6, 0xff6a2d, 0.3).setStrokeStyle(3, 0xff6a2d, 0.85).setDepth(20008);
    const growMs = Math.min(200, warnMs);
    this.scene.tweens.add({ targets: warn, radius: aoe, duration: growMs, ease: 'Sine.easeOut' });
    this.scene.tweens.add({
      targets: warn, alpha: 0.7, duration: 200, delay: growMs, yoyo: true,
      repeat: Math.max(0, Math.floor((warnMs - growMs) / 400)),
    });

    this.scene.time.delayedCall(warnMs, () => {
      warn.destroy();
      if (!this.alive) return;
      // 2026-07-11 放大很多：2.2→4.2，跟 aoe 一起放大，視覺跟實際命中範圍成比例
      const meteor = this.scene.add.image(x, y - 420, 'proj_fireball').setDepth(30003)
        .setScale(4.2).setTint(0xff6a2d).setRotation(0.4);
      this.scene.tweens.add({
        targets: meteor, y, duration: fallMs, ease: 'Cubic.easeIn',
        onComplete: () => {
          meteor.destroy();
          this.scene.spawnGlowRing(x, y, 'fx_flame', 0xff8a3d, 0.4, aoe / 26, 260);
          this.scene.spawnBurstFx(x, y, 0xff8a3d, 8, 'fx_flame', 140);
          if (this.player.sprite.active && dist(x, y, this.player.sprite.x, this.player.sprite.y) <= aoe) {
            this.player.takeDamage(dmg, this.scene.time.now);
          }
        },
      });
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
    if (this._laserBeam) { this._laserBeam.destroy(); this._laserBeamCore.destroy(); }
    if (this.scene.onWoofBossDefeated) this.scene.onWoofBossDefeated();
  }

  destroy() {
    this._clearTelegraphFx();
    if (this.sprite.active) this.sprite.destroy();
    this.headBarBg.destroy();
    this.headBarFill.destroy();
    if (this.shieldBubble) this.shieldBubble.destroy();
    if (this._laserBeam) { this._laserBeam.destroy(); this._laserBeamCore.destroy(); }
  }
}
