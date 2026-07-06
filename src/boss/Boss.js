import { dist, angleTo } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { textStyle } from '../utils/TextStyle.js';

const BOSS_BASE_HP = 900;
const BOSS_BASE_DMG = 22;
// Boss 材質已改成 128x128（原本 64x64 太模糊），
// 用 2.1 倍縮放後顯示約 269px，安全超過一般小怪 5 倍以上的體型需求
const BOSS_SCALE = 2.1;
const BOSS_TOUCH_RADIUS = 100;   // Boss 對玩家造成接觸傷害的判定半徑（跟著體型放大）

// 兩種 Boss 型態的外觀／技能配色與死亡時提供的遺物設定。
// 黑藍巨龍沿用原本的冰系龍息，紅龍則改成火系龍息，死亡後提供的遺物也不同，
// 這樣兩種 Boss 輪流出現時，玩家最終可以拿到兩種不同的永久遺物。
const BOSS_TYPES = {
  blue: {
    label: '⚠ 黑藍巨龍降臨！ ⚠',
    labelColor: '#6fd3ff',
    tint: null, // 貼圖本身就是黑藍配色，不需要額外染色
    aoeColor: 0x3355ff,
    breathColor: 0x3d6bff,
    breathTexture: 'fx_frost',
    boltTexture: 'proj_frost',
    chargeTint: 0xaaccff,
    windColor: 0x24242c, // 黑龍衝刺時周圍的黑色風系粒子
    relicId: 'dragonAura',
  },
  red: {
    label: '⚠ 血色紅龍降臨！ ⚠',
    labelColor: '#ff6a3d',
    tint: 0xff4d2e, // 同一份龍造型直接染紅，做出「紅龍」的區隔，不用重畫新素材
    aoeColor: 0xff3300,
    breathColor: 0xff6a2d,
    breathTexture: 'fx_flame',
    boltTexture: 'proj_fireball',
    chargeTint: 0xffcfa0,
    windColor: 0xcc2200, // 紅龍衝刺時周圍的紅色風系粒子
    relicId: 'dragonWings',
  },
};

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

// Boss 系統：西方龍造型，具備衝撞 / 範圍衝擊波 / 龍息遠距攻擊 三種技能，血條與死亡動畫。
// bossType 決定外觀配色、龍息屬性（冰／火）以及死亡後提供的遺物種類；
// bossIndex 決定強度倍率（見上方 bossStrengthMultiplier）。
export default class Boss {
  constructor(scene, player, difficultyMinutes, bossType = 'blue', bossIndex = 1) {
    this.scene = scene;
    this.player = player;
    this.alive = true;
    this.bossType = bossType;
    this.typeDef = BOSS_TYPES[bossType] || BOSS_TYPES.blue;
    this.relicId = this.typeDef.relicId;
    this.baseTint = this.typeDef.tint;

    const scaling = bossStrengthMultiplier(bossIndex);
    this.maxHp = BOSS_BASE_HP * scaling;
    this.hp = this.maxHp;
    this.dmg = BOSS_BASE_DMG * scaling;

    const px = player.sprite.x, py = player.sprite.y;
    const angle = Math.random() * Math.PI * 2;
    const x = px + Math.cos(angle) * 600;
    const y = py + Math.sin(angle) * 600;

    this.sprite = scene.physics.add.sprite(x, y, 'boss_main');
    this.sprite.setScale(BOSS_SCALE);
    this.sprite.body.setCircle(40, 24, 30);
    this.sprite.setDepth(y);
    if (this.baseTint) this.sprite.setTint(this.baseTint);

    this.phase = 'chase'; // chase | charge | aoe | ranged
    this.phaseTimer = 0;
    this.nextSkillAt = scene.time.now + 2500;
    this.chargeTarget = null;

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
    const shadow = scene.add.image(x, y, 'fx_bossdeath').setTint(this.baseTint || 0x1a2a6c).setAlpha(0.5).setScale(0.5).setDepth(y - 1);
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
    this.barFill.setDisplaySize(Math.max(0, this.hp / this.maxHp) * 580, 32);
    this.hpText.setText(`${Math.ceil(Math.max(0, this.hp))} / ${Math.round(this.maxHp)}`);

    // 頭頂血條跟著 Boss 移動，並同步血量比例
    const headY = by - 90;
    this.headBarBg.setPosition(bx, headY).setDepth(headY - 1);
    const hpRatio = Math.max(0, this.hp / this.maxHp);
    this.headBarFill.setPosition(bx - 58, headY).setDisplaySize(116 * hpRatio, 8).setDepth(headY);
  }

  // 三個技能輪流隨機挑選：龍之吐息（遠距噴火/噴冰）／衝刺（續力衝撞）／龍爪（三爪金色斬擊）
  _chooseSkill(time) {
    const r = Math.random();
    if (r < 0.34) this._startCharge(time);
    else if (r < 0.67) this._startClaw(time);
    else this._startBreath(time);
  }

  // 技能一：衝刺 —— 鎖定玩家當下位置衝過去，持續 2 秒的續力衝刺（不是一瞬間衝撞完就結束），
  // 衝刺期間身邊會持續冒出型態專屬色的風系粒子（紅龍是紅色、黑龍是黑色），
  // 讓玩家提前看出「牠正在衝刺」，方便閃避
  _startCharge(time) {
    this.phase = 'charge';
    this.chargeTarget = { x: this.player.sprite.x, y: this.player.sprite.y };
    this.sprite.setTint(this.typeDef.chargeTint);
    this.scene.cameras.main.flash(150, 100, 150, 255);
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

  // 恢復到這隻 Boss 原本的基底色調（紅龍是紅色 tint，藍龍則是完全不上色），
  // 取代直接呼叫 clearTint()——不然紅龍每次充能/受傷閃白過後就會被洗回原始貼圖顏色
  _restoreTint() {
    if (this.baseTint) this.sprite.setTint(this.baseTint);
    else this.sprite.clearTint();
  }

  // 技能二：龍爪 —— 往玩家方向的前方揮出三條金色爪痕，短暫延遲後在揮擊點造成範圍傷害。
  // 三條爪痕垂直排列、依序些微延遲出現，模擬「三根爪子同時劃過」的斬擊感。
  _startClaw(time) {
    this.phase = 'claw';
    const bx = this.sprite.x, by = this.sprite.y;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const ang = angleTo(bx, by, px, py);
    const reach = 130; // 爪擊點距離 Boss 中心多遠（往玩家方向前撲一段距離）
    const cx = bx + Math.cos(ang) * reach;
    const cy = by + Math.sin(ang) * reach;
    const hitRadius = 95;

    this.scene.cameras.main.flash(150, 255, 224, 130);
    this.scene.hitStop(90);
    audioManager.bossRoar();

    const perpAng = ang + Math.PI / 2;
    for (let i = -1; i <= 1; i++) {
      const off = i * 26;
      const sx = cx + Math.cos(perpAng) * off;
      const sy = cy + Math.sin(perpAng) * off;
      const claw = this.scene.add.image(sx, sy, 'fx_claw_slash')
        .setDepth(20005).setRotation(ang).setScale(0.4, 1).setAlpha(0.95);
      this.scene.tweens.add({
        targets: claw, scaleX: 1.3, alpha: 0, duration: 260, delay: Math.abs(i) * 40,
        onComplete: () => claw.destroy(),
      });
    }

    this.scene.time.delayedCall(140, () => {
      if (!this.alive) return; // 動畫播放期間 Boss 可能已被打死，避免存取已銷毀的物件
      const d = dist(cx, cy, this.player.sprite.x, this.player.sprite.y);
      if (d < hitRadius) {
        const died = this.player.takeDamage(this.dmg * 1.1, this.scene.time.now);
        if (died) this.scene.onPlayerDeath();
      }
      this.phase = 'chase';
      this.nextSkillAt = this.scene.time.now + 3200;
    });
  }

  // 技能三：龍之吐息 —— 朝玩家方向噴出一道扇形龍息（藍龍是冰息、紅龍是火息），
  // 沿瞄準方向連續噴出好幾波往前衝的火焰/冰霜粒子，做出「持續吐息」的感覺，
  // 而不是漫無目的的全方位彈幕，更符合西方龍的形象，也讓玩家能靠移動閃避
  _startBreath(time) {
    this.phase = 'breath';
    const bx = this.sprite.x, by = this.sprite.y;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const baseAng = angleTo(bx, by, px, py);
    const t = this.typeDef;

    // 龍息噴發視覺：從龍口延伸出的長條光柱，沿瞄準方向拉長
    const breath = this.scene.add.image(bx, by, t.breathTexture)
      .setTint(t.breathColor).setAlpha(0.55).setDepth(19998).setOrigin(0, 0.5)
      .setRotation(baseAng).setScale(6, 2.2);
    this.scene.tweens.add({
      targets: breath, alpha: 0, scaleX: 8, duration: 450,
      onComplete: () => breath.destroy(),
    });
    this.scene.cameras.main.flash(120, 60, 100, 255);
    audioManager.bossRoar();

    // 沿瞄準方向連續噴出好幾波往前衝的粒子，強化「持續吐息」而不是單發特效的感覺
    for (let wave = 0; wave < 5; wave++) {
      this.scene.time.delayedCall(wave * 70, () => {
        if (!this.alive) return;
        const wx = bx + Math.cos(baseAng) * (20 + wave * 22);
        const wy = by + Math.sin(baseAng) * (20 + wave * 22);
        this.scene.spawnEmbersFx(wx, wy, 3, t.breathColor);
      });
    }

    // 扇形彈幕：以瞄準方向為中心，左右展開一個錐形
    const count = 7;
    const spreadTotal = 0.55; // 錐形總張角（弧度）
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * (spreadTotal / (count - 1));
      const ang = baseAng + off;
      const bolt = this.scene.physics.add.image(bx, by, t.boltTexture).setTint(t.breathColor).setScale(1.8);
      bolt.body.setVelocity(Math.cos(ang) * 400, Math.sin(ang) * 400);
      bolt.setData('dmg', this.dmg * 0.55);
      bolt.setData('kind', 'bossBolt');
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
    if (Math.random() * 100 < critRate) dmg *= critDmg / 100;
    this.hp -= dmg;
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => {
      if (!this.sprite.active) return;
      // 若這時 Boss 還在充能衝撞（自己也有 tint），閃白計時器不該蓋掉衝撞色，
      // 交給 _updateCharge 結束時的 _restoreTint() 處理即可
      if (this.phase !== 'charge') this._restoreTint();
    });
    if (this.hp <= 0 && this.alive) {
      this._die();
    }
  }

  _die() {
    this.alive = false;
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
    this.scene.onBossDefeated(this.bossType, this.relicId);
  }

  destroy() {
    if (this.sprite.active) this.sprite.destroy();
    this.barBg.destroy();
    this.barFill.destroy();
    this.label.destroy();
    this.hpText.destroy();
    this.headBarBg.destroy();
    this.headBarFill.destroy();
  }
}
