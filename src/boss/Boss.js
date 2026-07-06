import { dist, angleTo } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { textStyle } from '../utils/TextStyle.js';

const BOSS_BASE_HP = 900;
const BOSS_BASE_DMG = 22;
// Boss 材質已改成 128x128（原本 64x64 太模糊），
// 用 2.1 倍縮放後顯示約 269px，安全超過一般小怪 5 倍以上的體型需求
const BOSS_SCALE = 2.1;
const BOSS_TOUCH_RADIUS = 100;   // Boss 對玩家造成接觸傷害的判定半徑（跟著體型放大）
const BOSS_AOE_HIT_RADIUS = 220; // Boss 範圍技能命中玩家的判定半徑

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
    relicId: 'dragonWings',
  },
};

// Boss 系統：西方龍造型，具備衝撞 / 範圍衝擊波 / 龍息遠距攻擊 三種技能，血條與死亡動畫。
// bossType 決定外觀配色、龍息屬性（冰／火）以及死亡後提供的遺物種類。
export default class Boss {
  constructor(scene, player, difficultyMinutes, bossType = 'blue') {
    this.scene = scene;
    this.player = player;
    this.alive = true;
    this.bossType = bossType;
    this.typeDef = BOSS_TYPES[bossType] || BOSS_TYPES.blue;
    this.relicId = this.typeDef.relicId;
    this.baseTint = this.typeDef.tint;

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

    // 登場震撼效果：鏡頭震動＋巨大陰影光環，凸顯體型巨大
    scene.cameras.main.shake(400, 0.01);
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
    this.sprite.setTint(this.typeDef.chargeTint);
    this.scene.cameras.main.flash(150, 100, 150, 255);
    this._chargeStartAt = time;
  }

  _updateCharge(time) {
    if (time - this._chargeStartAt > 900) {
      this.phase = 'chase';
      this._restoreTint();
      this.nextSkillAt = time + 2800;
      return;
    }
    const ang = angleTo(this.sprite.x, this.sprite.y, this.chargeTarget.x, this.chargeTarget.y);
    this.sprite.body.setVelocity(Math.cos(ang) * 480, Math.sin(ang) * 480);
  }

  // 恢復到這隻 Boss 原本的基底色調（紅龍是紅色 tint，藍龍則是完全不上色），
  // 取代直接呼叫 clearTint()——不然紅龍每次充能/受傷閃白過後就會被洗回原始貼圖顏色
  _restoreTint() {
    if (this.baseTint) this.sprite.setTint(this.baseTint);
    else this.sprite.clearTint();
  }

  // 技能二：範圍衝擊波（視覺範圍跟著巨大體型放大，顏色依 Boss 型態而定）
  _startAoe(time) {
    this.phase = 'aoe';
    const ring = this.scene.add.image(this.sprite.x, this.sprite.y, 'fx_frost')
      .setTint(this.typeDef.aoeColor).setScale(1).setAlpha(0.8).setDepth(19999);
    this.scene.cameras.main.shake(200, 0.006);
    this.scene.tweens.add({
      targets: ring, scale: 16, alpha: 0, duration: 700,
      onComplete: () => {
        ring.destroy();
        // 重要 bug 修正（造成「王出現一段時間後遊戲卡死」的元凶）：
        // AOE 環形特效播放需要 700ms，這段期間玩家仍可能用其他武器把 Boss 打死，
        // 屆時 this.sprite 已經在 _die() 被 destroy()，若這裡沒檢查 this.alive
        // 就直接讀取 this.sprite.x/y，會對已銷毀的 GameObject 存取座標拋出例外，
        // 讓 Phaser 的 update/render 迴圈整個中斷，畫面卡住不動且不再有任何反應。
        if (!this.alive) return;
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

  // 技能三：龍息遠距攻擊 —— 朝玩家方向噴出一道扇形龍息（藍龍是冰息、紅龍是火息），
  // 而不是漫無目的的全方位彈幕，更符合西方龍的形象，也讓玩家能靠移動閃避
  _startRanged(time) {
    this.phase = 'ranged';
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
    this.hpText.destroy();
    this.scene.onBossDefeated(this.bossType, this.relicId);
  }

  destroy() {
    if (this.sprite.active) this.sprite.destroy();
    this.barBg.destroy();
    this.barFill.destroy();
    this.label.destroy();
    this.hpText.destroy();
  }
}
