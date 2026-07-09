import { dist, angleTo } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { textStyle } from '../utils/TextStyle.js';

const BOSS_BASE_HP = 900;
const BOSS_BASE_DMG = 22;
// Boss 現在用玩家提供的正式美術圖。兩隻龍（去背後的黑龍/紅龍，見 assets/boss_black.png、
// assets/boss_red.png）統一裁切/縮放成 574x320，0.9 倍縮放後龍的身體高度跟原本程式產生
// 的貼圖差不多大。惡魔王／樹王是直立人形，原始圖片長寬比跟龍差很多（比較接近正方形、
// 沒有龍那麼寬扁），沿用同一個縮放倍率會顯得比兩隻龍巨大兩倍以上，所以改成每個型態自己
// 的縮放倍率（見 BOSS_TYPES 的 scale 欄位），讓四種 Boss 站在畫面上的「體型感」比較一致。
const BOSS_SCALE = 0.9;
const BOSS_TOUCH_RADIUS = 100;   // Boss 對玩家造成接觸傷害的判定半徑（跟著體型放大）

// 四種 Boss 型態的外觀／技能配色與死亡時提供的遺物設定。
// 兩隻龍（黑藍／紅）沿用原本的衝刺／龍爪／龍息三招；惡魔王／樹王是新增的兩隻，
// 技能組改成「遠距／特殊／近戰」各一招（見 skills 欄位），近戰共用 claw 的揮擊
// 邏輯、遠距共用 breath 的扇形彈幕邏輯（只是換色換材質），特殊技能則是新增的
// nova（範圍新星），novaCenter 決定新星中心點是「Boss 自己」還是「鎖定的目標點」。
// 惡魔王／樹王死亡暫不提供遺物（relicId: null，遺物之後再補上），
// onBossDefeated() 已經會對 falsy relicId 直接跳過遺物選擇，不影響擊殺獎勵。
const BOSS_TYPES = {
  blue: {
    name: '黑龍王',
    label: '⚠ 黑龍王降臨！ ⚠',
    labelColor: '#6fd3ff',
    texture: 'boss_black',
    aoeColor: 0x3355ff,
    breathColor: 0x3d6bff,
    breathTexture: 'fx_frost',
    boltTexture: 'proj_frost',
    chargeTint: 0xaaccff,
    windColor: 0x24242c, // 黑龍衝刺時周圍的黑色風系粒子
    clawColor: 0xffe066,
    relicId: 'dragonAura',
    skills: ['charge', 'claw', 'breath'],
    skillLabels: { charge: '⚠ 衝刺！', claw: '⚠ 龍爪！', breath: '⚠ 龍息！' },
  },
  red: {
    name: '血色紅龍',
    label: '⚠ 血色紅龍降臨！ ⚠',
    labelColor: '#ff6a3d',
    texture: 'boss_red',
    aoeColor: 0xff3300,
    breathColor: 0xff6a2d,
    breathTexture: 'fx_flame',
    boltTexture: 'proj_fireball',
    chargeTint: 0xffcfa0,
    windColor: 0xcc2200, // 紅龍衝刺時周圍的紅色風系粒子
    clawColor: 0xffe066,
    relicId: 'dragonWings',
    skills: ['charge', 'claw', 'breath'],
    skillLabels: { charge: '⚠ 衝刺！', claw: '⚠ 龍爪！', breath: '⚠ 龍息！' },
  },
  demon: {
    name: '惡魔王',
    label: '⚠ 惡魔王降臨！ ⚠',
    labelColor: '#d18aff',
    texture: 'boss_demon',
    aoeColor: 0x8b2fd9,
    breathColor: 0x9d4dff,
    breathTexture: 'fx_frost',
    boltTexture: 'proj_frost',
    chargeTint: 0xe0c3ff,
    windColor: 0x4b1a66, // 惡魔王施放技能時周圍的暗紫色風系粒子
    clawColor: 0xd94dff,
    relicId: null, // 遺物之後補上
    skills: ['breath', 'nova', 'claw'], // 遠距：深淵彈幕／特殊：詛咒新星／近戰：惡魔爪擊
    skillLabels: { breath: '⚠ 深淵彈幕！', nova: '⚠ 詛咒新星！', claw: '⚠ 惡魔爪擊！' },
    novaCenter: 'self', // 新星以惡魔王自己為中心炸開
    novaRadius: 260,
    // 新版惡魔王圖換成 1536x1024、雙翼展開幾乎頂到畫布左右邊緣的構圖（跟樹王同尺寸
    // 但翼展比樹王站姿佔滿更多畫面），縮放倍率比樹王再收一點，避免因為翼展撐滿畫面
    // 而顯得比其他 Boss 誇張兩圈；玩家反應體型還是偏大，再收一點。
    scale: 0.5,
  },
  treant: {
    name: '樹王',
    label: '⚠ 樹王降臨！ ⚠',
    labelColor: '#8fe36a',
    texture: 'boss_treant',
    aoeColor: 0x4caf50,
    breathColor: 0x7ed957,
    breathTexture: 'fx_frost',
    boltTexture: 'proj_frost',
    chargeTint: 0xc8f7b0,
    windColor: 0x2e5c1f, // 樹王施放技能時周圍的深綠色風系粒子
    clawColor: 0x9dff6b,
    relicId: null, // 遺物之後補上
    skills: ['breath', 'nova', 'claw'], // 遠距：荊棘彈幕／特殊：樹根衝擊／近戰：巨杖橫掃
    skillLabels: { breath: '⚠ 荊棘彈幕！', nova: '⚠ 樹根衝擊！', claw: '⚠ 巨杖橫掃！' },
    novaCenter: 'target', // 樹根衝擊鎖定玩家所在位置冒出來，不是繞著樹王自己
    novaRadius: 170,
    scale: 0.55, // 原本 0.61，玩家反應體型偏大，再收一點
  },
  griffin: {
    name: '獅鷲王',
    label: '⚠ 獅鷲王降臨！ ⚠',
    labelColor: '#ffd24d',
    texture: 'boss_griffin',
    aoeColor: 0xffc233,
    breathColor: 0xfff0b3,
    breathTexture: 'fx_frost',
    boltTexture: 'proj_frost',
    chargeTint: 0xfff2c2,
    windColor: 0xb8860b, // 獅鷲王施放技能時周圍的金褐色風系粒子
    clawColor: 0xffe066,
    relicId: null, // 遺物之後補上
    skills: ['breath', 'nova', 'claw'], // 遠距：疾風彈幕／特殊：王者威壓／近戰：利爪連擊
    skillLabels: { breath: '⚠ 疾風彈幕！', nova: '⚠ 王者威壓！', claw: '⚠ 利爪連擊！' },
    novaCenter: 'self', // 王者威壓以獅鷲王自己為中心炸開，逼玩家退開
    novaRadius: 250,
    scale: 0.5, // 原圖 700x616，展翅姿態跟龍類似，體型調到跟兩隻龍差不多的視覺份量
  },
};

// 三個技能發動前的「前搖」時間：Boss 會停下來、亮起警示色並顯示警告文字/範圍指示，
// 讓玩家有充足時間看懂「牠要出招了」並閃開，過了這段時間才會真的造成傷害。
const TELEGRAPH_MS = 2000;

// Boss 強度倍率：依「這是第幾隻王」(bossIndex，從 1 開始，每 5 分鐘一隻)決定，
// 不再用存活分鐘數線性計算。數列從 1, 2 開始，之後每項是前兩項相加（費氏數列變體）：
// 第1隻(5分鐘) 1x／第2隻(10分鐘) 2x／第3隻(15分鐘) 3x／第4隻(20分鐘) 5x／
// 第5隻(25分鐘) 8x／第6隻(30分鐘) 13x……以此類推，越後面成長越快。
function bossStrengthMultiplier(bossIndex) {
  const n = Math.max(1, Math.floor(bossIndex));
  if (n === 1) return 1;
  if (n === 2) return 2;
  let a = 1, b = 2;
  for (let i = 3; i <= n; i++) {
    const c = a + b;
    a = b;
    b = c;
  }
  return b;
}

// Boss 系統：目前有五種型態（黑龍王／血色紅龍／惡魔王／樹王／獅鷲王），各自三招技能、
// 血條與死亡動畫共用同一套邏輯。bossType 決定外觀、技能組合（見 BOSS_TYPES.skills）
// 以及死亡後提供的遺物種類；bossIndex 決定強度倍率（見上方 bossStrengthMultiplier）。
export default class Boss {
  constructor(scene, player, difficultyMinutes, bossType = 'blue', bossIndex = 1) {
    this.scene = scene;
    this.player = player;
    this.alive = true;
    this.bossType = bossType;
    this.typeDef = BOSS_TYPES[bossType] || BOSS_TYPES.blue;
    this.relicId = this.typeDef.relicId;

    const scaling = bossStrengthMultiplier(bossIndex);
    this.maxHp = BOSS_BASE_HP * scaling;
    this.hp = this.maxHp;
    this.dmg = BOSS_BASE_DMG * scaling;

    const px = player.sprite.x, py = player.sprite.y;
    const angle = Math.random() * Math.PI * 2;
    const x = px + Math.cos(angle) * 600;
    const y = py + Math.sin(angle) * 600;

    this.sprite = scene.physics.add.sprite(x, y, this.typeDef.texture);
    this.sprite.setScale(this.typeDef.scale ?? BOSS_SCALE);
    // 碰撞圓圈只用來讓物理身體存在（遊戲裡怪物碰撞判定都是手動算距離，不是靠這個）。
    // 圓心抓在美術圖胸口位置：水平置中、垂直落在原圖高度 55% 左右（兩隻龍是寬扁的
    // 橫向姿勢，惡魔王／樹王是站立的直向人形，圖片長寬比差很多，所以用「原始貼圖
    // 尺寸的比例」算，而不是寫死 574x320 那組數字，四種 Boss 都能正確對齊）。
    const texW = this.sprite.frame.width, texH = this.sprite.frame.height;
    const bodyRadius = texH * 0.219;
    this.sprite.body.setCircle(bodyRadius, texW / 2 - bodyRadius, texH * 0.55 - bodyRadius);
    this.sprite.setDepth(y);

    this.phase = 'chase'; // chase | charge | aoe | ranged
    this.phaseTimer = 0;
    this.nextSkillAt = scene.time.now + 2500;
    this.chargeTarget = null;
    this.paralyzedUntil = 0; // 雷霆套裝三件套：麻痺中無法選新技能（見 update()），見 GameScene._maybeThunderParalyze()

    // 血條 UI (畫面固定位置，右上方中央)
    this.barBg = scene.add.image(scene.scale.width / 2, 130, 'ui_bar_bg')
      .setScrollFactor(0).setDepth(30000).setDisplaySize(600, 36);
    this.barFill = scene.add.image(scene.scale.width / 2 - 290, 130, 'ui_bar_fill_boss')
      .setScrollFactor(0).setDepth(30001).setOrigin(0, 0.5).setDisplaySize(580, 32);
    this.label = scene.add.text(scene.scale.width / 2, 88, this.typeDef.label, textStyle({
      fontSize: '34px', color: this.typeDef.labelColor,
    })).setScrollFactor(0).setDepth(30001).setOrigin(0.5);
    // 血條數字顯示：疊在血條中央，讓玩家清楚看到目前/最大 HP，不只是看色塊長度
    this.hpText = scene.add.text(scene.scale.width / 2, 130, `${Math.ceil(this.hp)} / ${Math.round(this.maxHp)}`, textStyle({
      fontSize: '22px', color: '#ffffff',
    })).setScrollFactor(0).setDepth(30002).setOrigin(0.5);

    // 頭頂血條：跟著 Boss 移動的世界座標血條，讓玩家不用一直看畫面上方，
    // 近戰纏鬥時也能直接看到 Boss 目前的血量比例（跟畫面固定的頂部血條並存，不衝突）
    this.headBarBg = scene.add.image(x, y - 90, 'ui_bar_bg').setDisplaySize(120, 12).setDepth(29996);
    this.headBarFill = scene.add.image(x - 58, y - 90, 'ui_bar_fill_boss').setOrigin(0, 0.5).setDisplaySize(116, 8).setDepth(29997);

    // 登場震撼效果：閃光＋巨大陰影光環，凸顯體型巨大（不用鏡頭震動）
    scene.cameras.main.flash(300, 255, 255, 255);
    const shadow = scene.add.image(x, y, 'fx_bossdeath').setTint(this.typeDef.aoeColor).setAlpha(0.5).setScale(0.5).setDepth(y - 1);
    scene.tweens.add({ targets: shadow, scale: 3.2, alpha: 0, duration: 500, onComplete: () => shadow.destroy() });

    audioManager.bossRoar();

    this._playIntroCinematic(x, y);
  }

  // 魔王登場開場：鏡頭在 1 秒內轉去對準魔王（脫離跟隨玩家），畫面中央跳出紅色警告字
  // 「XX已出現」，同時把場上所有小怪一次清空（照正常擊殺流程走，一樣掉經驗寶石／
  // 特效，只是不算進本關擊殺數——見 GameScene.registerKill() 對魔王關的判斷），
  // 讓玩家可以乾淨地面對魔王。整段開場（含警告字停留時間）共 3 秒，結束後鏡頭
  // 才恢復跟隨玩家。
  _playIntroCinematic(bx, by) {
    const scene = this.scene;
    const cam = scene.cameras.main;

    cam.stopFollow();
    cam.pan(bx, by, 1000, 'Sine.easeInOut');

    const warnText = scene.add.text(cam.width / 2, cam.height / 2, `⚠ ${this.typeDef.name}已出現 ⚠`, textStyle({
      fontSize: '56px', color: '#ff2020', fontStyle: 'bold', stroke: '#000000', strokeThickness: 8,
    })).setOrigin(0.5).setScrollFactor(0).setDepth(40000);
    scene.tweens.add({ targets: warnText, scale: 1.12, duration: 280, yoyo: true, repeat: 5 });
    scene.time.delayedCall(3000, () => warnText.destroy());

    if (scene.enemySystem) scene.enemySystem.killAllActive();

    // 開場這 3 秒玩家無法攻擊（見 WeaponSystem.update()／GameScene._handleSawbladeHits()
    // 對這面旗標的判斷），逼玩家先看完警示、站穩位置，而不是一開場就無腦輸出。
    scene.attacksLocked = true;
    scene.time.delayedCall(3000, () => {
      scene.attacksLocked = false;
      if (scene.player && scene.player.sprite && scene.player.sprite.active) {
        cam.startFollow(scene.player.sprite, true, 0.12, 0.12);
      }
    });
  }

  update(time, delta) {
    if (!this.alive) return;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const bx = this.sprite.x, by = this.sprite.y;

    // 開場 3 秒魔王也不能動作（見 _playIntroCinematic 設的 scene.attacksLocked）：
    // 不移動、不選技能、也不會造成接觸傷害，靜靜站著讓玩家看完警示、站穩位置——
    // 這段時間一定是剛出場的 'chase' 階段（lock 在 constructor 裡就立刻設定），
    // 不會卡在技能前搖/衝刺半途中被凍結。
    if (this.scene.attacksLocked) {
      this.sprite.body.setVelocity(0, 0);
      return;
    }

    // 雷霆套裝三件套：麻痺中的 Boss 選不了新技能（「無法施放技能」），過了
    // paralyzedUntil 才會恢復正常選招——不影響正在前搖/執行中的技能，只擋「下一招」。
    if (time > this.nextSkillAt && this.phase === 'chase' && time >= this.paralyzedUntil) {
      this._chooseSkill(time);
    }

    if (this.phase === 'chase') {
      const ang = angleTo(bx, by, px, py);
      this.sprite.body.setVelocity(Math.cos(ang) * 70, Math.sin(ang) * 70);
    } else if (this.phase === 'charge') {
      this._updateCharge(time);
    } else if (this.phase === 'telegraph') {
      this._updateTelegraph(time);
    }

    // 接觸傷害（判定半徑跟著巨大體型放大）
    if (dist(bx, by, px, py) < BOSS_TOUCH_RADIUS && time - (this._lastTouch || 0) > 600) {
      this._lastTouch = time;
      const died = this.player.takeDamage(this.dmg * 0.5, time);
      if (died) this.scene.onPlayerDeath();
    }

    this.sprite.setFlipX(px < bx);
    this.sprite.setDepth(by);
    this.barFill.setDisplaySize(Math.max(0, this.hp / this.maxHp) * 580, 32);
    this.hpText.setText(`${Math.ceil(Math.max(0, this.hp))} / ${Math.round(this.maxHp)}`);

    // 頭頂血條跟著 Boss 移動，並同步血量比例
    const headY = by - 90;
    this.headBarBg.setPosition(bx, headY).setDepth(headY - 1);
    const hpRatio = Math.max(0, this.hp / this.maxHp);
    this.headBarFill.setPosition(bx - 58, headY).setDisplaySize(116 * hpRatio, 8).setDepth(headY);
  }

  // 三個技能輪流隨機挑選，實際有哪三招由 typeDef.skills 決定（兩隻龍是
  // 衝刺／龍爪／龍息；惡魔王／樹王是遠距彈幕／新星／近戰揮擊，見 BOSS_TYPES）。
  // 選好之後不會馬上出招，而是先進入「前搖」：瞄準方向/目標點在這一刻就鎖定，
  // 停頓 TELEGRAPH_MS 讓玩家看到警示、有機會移動閃開，時間到才真的執行攻擊。
  _chooseSkill(time) {
    const skills = this.typeDef.skills || ['charge', 'claw', 'breath'];
    const kind = skills[Math.floor(Math.random() * skills.length)];
    this._startTelegraph(kind, time);
  }

  _startTelegraph(kind, time) {
    this.phase = 'telegraph';
    this._telegraphKind = kind;
    this._telegraphEndAt = time + TELEGRAPH_MS;
    this._telegraphFx = [];
    this.sprite.body.setVelocity(0, 0);

    const bx = this.sprite.x, by = this.sprite.y;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    // 鎖定瞄準：角度／目標點在前搖「開始」的這一刻就決定好，之後不會再重新瞄準，
    // 玩家躲開鎖定範圍就真的躲得掉，而不是不管怎麼跑最後都精準命中。
    this._telegraphAngle = angleTo(bx, by, px, py);
    this._telegraphTarget = { x: px, y: py };

    this.sprite.setTint(this.typeDef.chargeTint);
    audioManager.bossRoar();

    // 警示文字：跟著 Boss 頭頂浮動，清楚告訴玩家牠準備使出哪一招
    const label = this.scene.add.text(bx, by - 150, this.typeDef.skillLabels[kind], textStyle({
      fontSize: '30px', color: '#ff4444', fontStyle: 'bold',
    })).setOrigin(0.5).setDepth(20010);
    this.scene.tweens.add({ targets: label, scale: 1.18, duration: 260, yoyo: true, repeat: -1 });
    this._telegraphLabel = label;
    this._telegraphFx.push(label);

    if (kind === 'charge') {
      this._telegraphFx.push(this._telegraphLine(bx, by, this._telegraphAngle, 620, 0xaaccff));
    } else if (kind === 'claw') {
      const reach = 130, hitRadius = 95;
      const cx = bx + Math.cos(this._telegraphAngle) * reach;
      const cy = by + Math.sin(this._telegraphAngle) * reach;
      this._telegraphFx.push(this._telegraphRing(cx, cy, hitRadius));
    } else if (kind === 'nova') {
      const t = this.typeDef;
      const ncx = t.novaCenter === 'target' ? this._telegraphTarget.x : bx;
      const ncy = t.novaCenter === 'target' ? this._telegraphTarget.y : by;
      this._telegraphFx.push(this._telegraphRing(ncx, ncy, t.novaRadius, t.aoeColor));
    } else {
      this._telegraphFx.push(this._telegraphCone(bx, by, this._telegraphAngle));
    }
  }

  // 衝刺前搖指示線：一條沿瞄準方向延伸的警示光柱，預告衝刺路徑
  _telegraphLine(bx, by, ang, length, color) {
    const midX = bx + Math.cos(ang) * length / 2;
    const midY = by + Math.sin(ang) * length / 2;
    const line = this.scene.add.rectangle(midX, midY, length, 18, color, 0.4).setRotation(ang).setDepth(20009);
    this.scene.tweens.add({ targets: line, alpha: 0.85, duration: 240, yoyo: true, repeat: -1 });
    return line;
  }

  // 前搖指示圈：從 0 慢慢長大到實際命中半徑，讓玩家清楚看到「危險範圍」在哪。
  // 龍爪跟新星都共用這個指示圈，顏色可以指定（不指定就用預設的警示紅）。
  _telegraphRing(x, y, endRadius, color = 0xff2020) {
    const ring = this.scene.add.circle(x, y, 4, color, 0.28).setStrokeStyle(4, color, 0.9).setDepth(20009);
    this.scene.tweens.add({ targets: ring, radius: endRadius, duration: TELEGRAPH_MS, ease: 'Sine.easeIn' });
    return ring;
  }

  // 龍息前搖指示錐：跟正式噴出的龍息同一張材質，但半透明、慢慢脹大，預告噴發方向與範圍
  _telegraphCone(bx, by, ang) {
    const cone = this.scene.add.image(bx, by, this.typeDef.breathTexture)
      .setTint(this.typeDef.breathColor).setAlpha(0.35).setDepth(20008).setOrigin(0, 0.5)
      .setRotation(ang).setScale(1, 1.4);
    this.scene.tweens.add({ targets: cone, scaleX: 5.5, duration: TELEGRAPH_MS, ease: 'Sine.easeIn' });
    this.scene.tweens.add({ targets: cone, alpha: 0.6, duration: 240, yoyo: true, repeat: -1 });
    return cone;
  }

  _clearTelegraphFx() {
    (this._telegraphFx || []).forEach((fx) => {
      this.scene.tweens.killTweensOf(fx);
      fx.destroy();
    });
    this._telegraphFx = [];
    this._telegraphLabel = null;
  }

  _updateTelegraph(time) {
    if (this._telegraphLabel) this._telegraphLabel.setPosition(this.sprite.x, this.sprite.y - 150);
    if (time < this._telegraphEndAt) return;

    this._clearTelegraphFx();
    this._restoreTint();
    const kind = this._telegraphKind;
    if (kind === 'charge') this._executeCharge(time);
    else if (kind === 'claw') this._executeClaw(time);
    else if (kind === 'nova') this._executeNova(time);
    else this._executeBreath(time);
  }

  // 技能一：衝刺 —— 朝前搖鎖定的目標點衝過去，持續 2 秒的續力衝刺（不是一瞬間衝撞完就結束），
  // 衝刺期間身邊會持續冒出型態專屬色的風系粒子（紅龍是紅色、黑龍是黑色），
  // 讓玩家提前看出「牠正在衝刺」，方便閃避
  _executeCharge(time) {
    this.phase = 'charge';
    this.chargeTarget = this._telegraphTarget;
    this.sprite.setTint(this.typeDef.chargeTint);
    this.scene.cameras.main.flash(180, 100, 150, 255);
    this._chargeStartAt = time;
    this._nextWindFxAt = 0;
  }

  _updateCharge(time) {
    const CHARGE_DURATION = 2000; // 續力衝刺持續 2 秒
    if (time - this._chargeStartAt > CHARGE_DURATION) {
      this.phase = 'chase';
      this._restoreTint();
      this.nextSkillAt = time + 2800;
      return;
    }
    const ang = angleTo(this.sprite.x, this.sprite.y, this.chargeTarget.x, this.chargeTarget.y);
    this.sprite.body.setVelocity(Math.cos(ang) * 480, Math.sin(ang) * 480);

    // 衝刺期間持續在身邊冒出風系粒子，做出「捲起一陣風」的視覺提示
    if (time >= this._nextWindFxAt) {
      this._nextWindFxAt = time + 55;
      const windAng = Math.random() * Math.PI * 2;
      const wr = 30 + Math.random() * 30;
      const wx = this.sprite.x + Math.cos(windAng) * wr;
      const wy = this.sprite.y + Math.sin(windAng) * wr;
      this.scene.spawnEmbersFx(wx, wy, 2, this.typeDef.windColor);
    }
  }

  // 恢復成美術圖本身的顏色：充能/前搖警示/受傷閃白都只是暫時的 tint，
  // 現在兩隻龍用的都是玩家提供的正式美術圖（本身就有正確配色），恢復時單純清掉 tint 即可。
  _restoreTint() {
    this.sprite.clearTint();
  }

  // 特殊技能：新星 —— 惡魔王／樹王／獅鷲王的第三招。novaCenter 決定爆炸中心是
  // 「Boss 自己」還是「前搖鎖定的目標點」。改版：不再是前搖結束瞬間的隱形範圍判定
  // （玩家反應會莫名其妙被打），而是一圈「看得到、實際往外掃」的衝擊波光環——
  // 波前掃過玩家所在位置的那一刻才判定命中；衝擊波往外擴的期間玩家可以往外跑
  // 拉開距離，或是衝擊波過去之後再走回來，都不會被打到。
  _executeNova(time) {
    this.phase = 'nova';
    const t = this.typeDef;
    const bx = this.sprite.x, by = this.sprite.y;
    const cx = t.novaCenter === 'target' ? this._telegraphTarget.x : bx;
    const cy = t.novaCenter === 'target' ? this._telegraphTarget.y : by;
    const radius = t.novaRadius;
    const EXPAND_MS = 700; // 衝擊波從中心掃到最大半徑要多久（越久越好躲）

    this.scene.cameras.main.flash(220, (t.aoeColor >> 16) & 0xff, (t.aoeColor >> 8) & 0xff, t.aoeColor & 0xff);
    audioManager.bossRoar();

    // 衝擊波本體：主題色大環＋內層白色亮環一起往外掃，這一圈就是實際的命中判定
    const ring = this.scene.add.image(cx, cy, 'fx_bossdeath').setTint(t.aoeColor)
      .setAlpha(0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(20006).setScale(0.2);
    const ringCore = this.scene.add.image(cx, cy, 'fx_bossdeath').setTint(0xffffff)
      .setAlpha(0.6).setBlendMode(Phaser.BlendModes.ADD).setDepth(20007).setScale(0.12);
    // fx_bossdeath 貼圖在 scale 1 時半徑約 26px（跟 spawnGlowRing 的換算一致），
    // 讓視覺大小跟命中判定的波前半徑同步放大。
    this.scene.tweens.add({ targets: ring, scale: radius / 26, duration: EXPAND_MS, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: ringCore, scale: radius / 30, duration: EXPAND_MS, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: [ring, ringCore], alpha: 0, duration: 240, delay: EXPAND_MS, onComplete: () => { ring.destroy(); ringCore.destroy(); } });
    this.scene.spawnBurstFx(cx, cy, t.aoeColor, 22, 'fx_crit', 210);

    // 波前命中判定：每 30ms 算一次目前衝擊波掃到的半徑，玩家跟中心的距離剛好
    // 落在波前附近（±34px）才算被掃到，整招最多命中一次。
    let hasHit = false;
    const startAt = this.scene.time.now;
    const waveTimer = this.scene.time.addEvent({
      delay: 30, loop: true,
      callback: () => {
        const progress = (this.scene.time.now - startAt) / EXPAND_MS;
        if (progress >= 1) { waveTimer.remove(); return; }
        if (hasHit || !this.alive) return;
        const waveR = radius * progress;
        const d = dist(cx, cy, this.player.sprite.x, this.player.sprite.y);
        if (Math.abs(d - waveR) < 34) {
          hasHit = true;
          const died = this.player.takeDamage(this.dmg * 1.3, this.scene.time.now);
          if (died) this.scene.onPlayerDeath();
        }
      },
    });

    this.scene.time.delayedCall(EXPAND_MS, () => {
      this.phase = 'chase';
      this.nextSkillAt = this.scene.time.now + 3200;
    });
  }

  // 技能二：爪擊斬波 —— 改版：不再是「原地隱形範圍判定」（玩家反應會莫名其妙被打），
  // 而是往前搖鎖定方向「射出」五道排成扇形、實際往前飛的爪痕震波投射物——
  // 震波本身就是命中判定（跟龍息彈幕共用 bossBoltGroup 的碰撞邏輯，見
  // GameScene.update()），玩家看得到它飛過來、也真的閃得掉，被打到就是被震波碰到。
  _executeClaw(time) {
    this.phase = 'claw';
    const bx = this.sprite.x, by = this.sprite.y;
    const ang = this._telegraphAngle;
    const clawColor = this.typeDef.clawColor || 0xffe066;

    this.scene.cameras.main.flash(140, 255, 224, 130);
    audioManager.bossRoar();
    // 出手瞬間在 Boss 前方閃一圈揮擊光環，交代「這些震波是從這一爪揮出來的」
    const originX = bx + Math.cos(ang) * 60, originY = by + Math.sin(ang) * 60;
    this.scene.spawnGlowRing(originX, originY, 'fx_bossdeath', clawColor, 0.3, 2.2, 300);
    this.scene.spawnBurstFx(originX, originY, clawColor, 12, 'fx_crit', 160);

    const perpAng = ang + Math.PI / 2;
    for (let i = -2; i <= 2; i++) {
      const off = i * 34;
      const sx = originX + Math.cos(perpAng) * off;
      const sy = originY + Math.sin(perpAng) * off;
      const wave = this.scene.physics.add.image(sx, sy, 'fx_claw_slash')
        .setDepth(20005).setRotation(ang).setScale(1.0, 1.2).setAlpha(0.95).setTint(clawColor);
      wave.body.setVelocity(Math.cos(ang) * 430, Math.sin(ang) * 430);
      wave.setData('dmg', this.dmg * 1.1);
      wave.setData('kind', 'bossBolt');
      wave.setData('hitRadius', 36); // 震波體積大，命中半徑也放大（見 GameScene 的 bossBoltGroup 判定）
      this.scene.bossBoltGroup.add(wave);
      // 飛行途中慢慢變淡，快消失前就幾乎打不到人，避免「看起來已經消失卻還會命中」
      this.scene.tweens.add({ targets: wave, alpha: 0.35, duration: 900, delay: Math.abs(i) * 40 });
      this.scene.time.delayedCall(950, () => { if (wave.active) wave.destroy(); });
    }

    this.scene.time.delayedCall(400, () => {
      this.phase = 'chase';
      this.nextSkillAt = this.scene.time.now + 3200;
    });
  }

  // 技能三：龍之吐息 —— 朝前搖鎖定方向噴出一道扇形龍息（藍龍是冰息、紅龍是火息），
  // 沿瞄準方向連續噴出好幾波往前衝的火焰/冰霜粒子，做出「持續吐息」的感覺，
  // 而不是漫無目的的全方位彈幕，更符合西方龍的形象，也讓玩家能靠移動閃避
  _executeBreath(time) {
    this.phase = 'breath';
    const bx = this.sprite.x, by = this.sprite.y;
    const baseAng = this._telegraphAngle;
    const t = this.typeDef;

    // 龍口噴發瞬間先炸一圈衝擊光環＋碎片，噴出去之前先有「蓄力炸開」的份量感
    this.scene.spawnGlowRing(bx, by, 'fx_bossdeath', t.breathColor, 0.3, 3.4, 420);
    this.scene.spawnBurstFx(bx, by, t.breathColor, 16, 'fx_crit', 180);

    // 龍息噴發視覺：從龍口延伸出的長條光柱，沿瞄準方向拉長；疊一層純白核心光柱
    // 在外層色柱裡面，做出「外暗內亮」的層次感，比單一色塊更有噴射的力度
    const breath = this.scene.add.image(bx, by, t.breathTexture)
      .setTint(t.breathColor).setAlpha(0.8).setDepth(19998).setOrigin(0, 0.5)
      .setRotation(baseAng).setScale(6, 2.4);
    this.scene.tweens.add({
      targets: breath, alpha: 0, scaleX: 9, scaleY: 3, duration: 500,
      onComplete: () => breath.destroy(),
    });
    const breathCore = this.scene.add.image(bx, by, t.breathTexture)
      .setTint(0xffffff).setAlpha(0.65).setDepth(19999).setOrigin(0, 0.5)
      .setRotation(baseAng).setScale(5, 1.1);
    this.scene.tweens.add({
      targets: breathCore, alpha: 0, scaleX: 7.5, duration: 400,
      onComplete: () => breathCore.destroy(),
    });
    this.scene.cameras.main.flash(200, 90, 130, 255);
    this.scene.hitStop(90);
    audioManager.bossRoar();

    // 沿瞄準方向連續噴出好幾波往前衝的粒子，強化「持續吐息」而不是單發特效的感覺
    // （原本只噴 5 波，現在拉長到 7 波、每波粒子也變多，噴發時間感更持久）
    for (let wave = 0; wave < 7; wave++) {
      this.scene.time.delayedCall(wave * 65, () => {
        if (!this.alive) return;
        const wx = bx + Math.cos(baseAng) * (20 + wave * 22);
        const wy = by + Math.sin(baseAng) * (20 + wave * 22);
        this.scene.spawnEmbersFx(wx, wy, 4, t.breathColor);
      });
    }

    // 扇形彈幕：以瞄準方向為中心，左右展開一個錐形
    const count = 7;
    const spreadTotal = 0.55; // 錐形總張角（弧度）
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * (spreadTotal / (count - 1));
      const ang = baseAng + off;
      // 彈幕放大（1.8→2.6）讓玩家更容易看清楚每一顆的位置；命中半徑跟著視覺放大
      const bolt = this.scene.physics.add.image(bx, by, t.boltTexture).setTint(t.breathColor).setScale(2.6);
      bolt.body.setVelocity(Math.cos(ang) * 400, Math.sin(ang) * 400);
      bolt.setData('dmg', this.dmg * 0.55);
      bolt.setData('kind', 'bossBolt');
      bolt.setData('hitRadius', 24);
      this.scene.bossBoltGroup.add(bolt);
      this.scene.time.delayedCall(2200, () => { if (bolt.active) bolt.destroy(); });
    }
    this.scene.time.delayedCall(400, () => {
      this.phase = 'chase';
      this.nextSkillAt = this.scene.time.now + 3000;
    });
  }

  takeDamage(amount, critRate = 0, critDmg = 150) {
    let dmg = amount;
    let isCrit = false;
    if (Math.random() * 100 < critRate) {
      dmg *= critDmg / 100;
      isCrit = true;
    }
    // 雷霆套裝五件套：打中麻痺中的 Boss 額外補上 10% 玩家攻擊力的傷害＋打雷特效
    const setBonuses = this.scene.setBonuses;
    if (setBonuses && setBonuses.thunder5 && this.scene.time.now < this.paralyzedUntil) {
      dmg += this.player.stats.attack * 0.1;
      this.scene.spawnThunderStrikeFx(this.sprite.x, this.sprite.y);
    }
    this.hp -= dmg;
    this.sprite.setTintFill(0xffffff);
    this.scene.spawnDamageNumber(this.sprite.x, this.sprite.y - 30, dmg, isCrit);
    this.scene.time.delayedCall(60, () => {
      if (!this.sprite.active) return;
      // 若這時 Boss 還在充能衝撞／前搖警示（兩者都自己有 tint），閃白計時器不該蓋掉，
      // 分別交給 _updateCharge / _updateTelegraph 結束時的 _restoreTint() 處理即可
      if (this.phase !== 'charge' && this.phase !== 'telegraph') this._restoreTint();
    });
    if (this.hp <= 0 && this.alive) {
      this._die();
    }
  }

  _die() {
    this.alive = false;
    this._clearTelegraphFx(); // 前搖到一半被打死的話，警示文字/範圍指示不該留在畫面上
    audioManager.bossDeath();
    this.scene.cameras.main.flash(500, 255, 255, 255);
    this.scene.hitStop(150);

    const dx = this.sprite.x, dy = this.sprite.y;
    const themeColor = this.typeDef.aoeColor;

    // 巨大體型死亡要有相對應的盛大特效：四層依序擴散的光環（原本只有 3 層）
    for (let i = 0; i < 4; i++) {
      const fx = this.scene.add.image(dx, dy, 'fx_bossdeath').setDepth(20001).setScale(0.6);
      this.scene.tweens.add({
        targets: fx, scale: 6 + i * 1.8, alpha: 0, duration: 900 + i * 220, delay: i * 130,
        onComplete: () => fx.destroy(),
      });
    }
    // 型態專屬色的衝擊波（跟這隻龍的範圍技能同一種顏色，強化「同一隻龍」的視覺一致性）
    // + 一圈純白的內層閃光，讓爆炸有明暗層次而不是單一顏色的色塊
    this.scene.spawnGlowRing(dx, dy, 'fx_frost', themeColor, 0.6, 11, 950, 20002);
    this.scene.spawnGlowRing(dx, dy, 'fx_frost', 0xffffff, 0.5, 6, 650, 20003);
    // 大量四散碎片分兩批噴發，做出「還沒完全炸完、殘骸持續飛濺」的層次感
    this.scene.spawnBurstFx(dx, dy, themeColor, 30, 'fx_crit', 260);
    this.scene.time.delayedCall(160, () => {
      if (this.scene && this.scene.spawnBurstFx) this.scene.spawnBurstFx(dx, dy, 0xffffff, 20, 'fx_bossdeath', 210);
    });

    this.sprite.destroy();
    this.barBg.destroy();
    this.barFill.destroy();
    this.label.destroy();
    this.hpText.destroy();
    this.headBarBg.destroy();
    this.headBarFill.destroy();
    this.scene.onBossDefeated(this.bossType, this.relicId, dx, dy);
  }

  destroy() {
    this._clearTelegraphFx();
    if (this.sprite.active) this.sprite.destroy();
    this.barBg.destroy();
    this.barFill.destroy();
    this.label.destroy();
    this.hpText.destroy();
    this.headBarBg.destroy();
    this.headBarFill.destroy();
  }
}
