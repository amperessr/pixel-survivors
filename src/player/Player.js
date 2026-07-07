import { clamp } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

// 四種初始角色設定 (依規格百分比修正基礎數值)
export const CHARACTERS = {
  attacker: {
    id: 'attacker', name: '4M', title: '飛過去扁你', texture: 'player_attacker',
    typeLabel: '攻擊型',
    desc: 'Attack +40%／HP -10%／Defense -10%',
    mods: { attack: 1.4, hp: 0.9, defense: 0.9, moveSpeed: 1, atkSpeed: 1 },
  },
  speedster: {
    id: 'speedster', name: '跩跩', title: '1000元內隨便拿', texture: 'player_speedster',
    typeLabel: '敏捷型',
    desc: 'MoveSpeed +40%／AtkSpeed +25%／Attack -15%',
    mods: { attack: 0.85, hp: 1, defense: 1, moveSpeed: 1.4, atkSpeed: 1.25 },
  },
  tank: {
    id: 'tank', name: '汪汪', title: '大主管', texture: 'player_tank',
    typeLabel: '防禦型',
    desc: 'HP +40%／Defense +40%／MoveSpeed -20%',
    mods: { attack: 1, hp: 1.4, defense: 1.4, moveSpeed: 0.8, atkSpeed: 1 },
  },
  balanced: {
    id: 'balanced', name: '基本款', title: '無', texture: 'player_balanced',
    typeLabel: '一般型',
    desc: '所有能力平均成長',
    mods: { attack: 1.1, hp: 1.1, defense: 1.1, moveSpeed: 1.1, atkSpeed: 1.1 },
  },
};

const BASE_STATS = {
  hp: 100, attack: 10, defense: 5, moveSpeed: 180,
  atkSpeed: 0, critRate: 5, critDmg: 150,
};

export default class Player {
  constructor(scene, x, y, characterId) {
    this.scene = scene;
    this.characterId = characterId;
    const char = CHARACTERS[characterId];
    this.charDef = char;

    this.sprite = scene.physics.add.sprite(x, y, char.texture);
    // 角色材質已改成 64x64（原本 32x32 的兩倍解析度，讓選角畫面更清晰），
    // 這裡縮小回 0.5 倍讓遊戲內實際顯示大小維持不變。
    this.sprite.setScale(0.5);
    this.sprite.setCollideWorldBounds(false);
    this.sprite.body.setCircle(22, 10, 16);
    this.sprite.setDepth(y);

    this.level = 1;
    this.exp = 0;
    this.expToNext = 10;
    this.kills = 0;

    this.stats = {
      maxHp: Math.round(BASE_STATS.hp * char.mods.hp),
      attack: Math.round(BASE_STATS.attack * char.mods.attack),
      defense: Math.round(BASE_STATS.defense * char.mods.defense),
      moveSpeed: Math.round(BASE_STATS.moveSpeed * char.mods.moveSpeed),
      atkSpeed: BASE_STATS.atkSpeed,
      critRate: BASE_STATS.critRate,
      critDmg: BASE_STATS.critDmg,
    };
    this.hp = this.stats.maxHp;

    this.invulnerableUntil = 0;
    this.isDashing = false;
    this.dashCooldownUntil = 0;

    this.passiveLevels = { attack: 0, critRate: 0, critDmg: 0, atkSpeed: 0, moveSpeed: 0 };

    // 頭上血條：讓玩家不用一直看左上角 HUD，直接在角色頭頂看到目前血量
    this.headBarBg = scene.add.image(x, y - 26, 'ui_bar_bg').setDisplaySize(40, 6).setDepth(9998);
    this.headBarFill = scene.add.image(x - 20, y - 26, 'ui_bar_fill_hp').setOrigin(0, 0.5).setDisplaySize(40, 5).setDepth(9999);

    this.keys = scene.input.keyboard.addKeys({
      up: 'W', down: 'S', left: 'A', right: 'D', dash: 'SPACE',
    });
  }

  applyPassiveBonus(id, valuePercent) {
    this.passiveLevels[id] = (this.passiveLevels[id] || 0) + 1;
    switch (id) {
      case 'attack': this.stats.attack = Math.round(this.stats.attack * (1 + valuePercent / 100)); break;
      case 'critRate': this.stats.critRate = clamp(this.stats.critRate + valuePercent, 0, 100); break;
      case 'critDmg': this.stats.critDmg += valuePercent; break;
      case 'atkSpeed': this.stats.atkSpeed += valuePercent; break;
      case 'moveSpeed': this.stats.moveSpeed = Math.round(this.stats.moveSpeed * (1 + valuePercent / 100)); break;
    }
  }

  // 龍之光環：擊敗 Boss 後玩家可選擇接受的永久強化——生命上限與攻擊力雙雙 x2，
  // 並直接回滿血，讓玩家馬上感受到「繼承巨龍力量」的爆發感。
  applyDragonAura() {
    this.hasDragonAura = true;
    this.stats.maxHp = Math.round(this.stats.maxHp * 2);
    this.stats.attack = Math.round(this.stats.attack * 2);
    this.hp = this.stats.maxHp;
  }

  // 龍之翼：擊敗紅龍後可選擇的永久強化——移動速度永久 x2
  // 龍之翼：擊敗紅龍後可選擇的永久強化——移動速度永久 x1.5
  applyDragonWings() {
    this.hasDragonWings = true;
    this.stats.moveSpeed = Math.round(this.stats.moveSpeed * 1.5);
  }

  update(time, delta) {
    if (this.hp <= 0) return;
    const speed = this.stats.moveSpeed * (this.isDashing ? 2.6 : 1);
    let vx = 0, vy = 0;
    if (this.keys.up.isDown) vy -= 1;
    if (this.keys.down.isDown) vy += 1;
    if (this.keys.left.isDown) vx -= 1;
    if (this.keys.right.isDown) vx += 1;
    const len = Math.hypot(vx, vy) || 1;
    this.sprite.body.setVelocity((vx / len) * speed, (vy / len) * speed);

    if (vx !== 0) this.sprite.setFlipX(vx < 0);

    if (Phaser.Input.Keyboard.JustDown(this.keys.dash) && time > this.dashCooldownUntil && (vx !== 0 || vy !== 0)) {
      this._dash(time);
    }

    this._updateHeadBar();
    this.sprite.setDepth(this.sprite.y);
  }

  _updateHeadBar() {
    const bx = this.sprite.x, by = this.sprite.y - 26;
    this.headBarBg.setPosition(bx, by);
    const ratio = Math.max(0, this.hp / this.stats.maxHp);
    this.headBarFill.setPosition(bx - 20, by);
    this.headBarFill.setDisplaySize(40 * ratio, 5);
    // 血條深度跟著玩家目前深度走，確保無論玩家在世界的哪個座標，血條永遠畫在玩家上方
    this.headBarBg.setDepth(this.sprite.depth + 1);
    this.headBarFill.setDepth(this.sprite.depth + 2);
    this.headBarBg.setVisible(true);
    this.headBarFill.setVisible(true);
  }

  _dash(time) {
    this.isDashing = true;
    this.invulnerableUntil = time + 220;
    audioManager.dash();
    this.scene.time.delayedCall(220, () => { this.isDashing = false; });
    this.dashCooldownUntil = time + 1800;
  }

  // 升級/遺物選單開著的期間 update() 完全不會執行，如果玩家這時候按了衝刺鍵，
  // 這個按鍵的「剛按下」狀態會一直留著沒被消耗掉，導致選單一關閉、下一幀
  // update() 恢復執行時，明明玩家沒有在那個當下按鍵，卻無端觸發一次衝刺——
  // 體感就像角色突然被瞬間移動。選單關閉、遊戲恢復時呼叫這個方法清掉殘留狀態。
  clearBankedInput() {
    this.keys.dash.reset();
  }

  takeDamage(amount, time) {
    if (time < this.invulnerableUntil || this.hp <= 0) return false;
    const mitigated = Math.max(1, amount - this.stats.defense * 0.5);
    this.hp = clamp(this.hp - mitigated, 0, this.stats.maxHp);
    this.invulnerableUntil = time + 500;
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => this.sprite.clearTint());
    return this.hp <= 0;
  }

  gainExp(amount) {
    this.exp += amount;
    const leveledUp = [];
    while (this.exp >= this.expToNext) {
      this.exp -= this.expToNext;
      this.level++;
      this.expToNext = Math.round(this.expToNext * 1.25 + 5);
      this.stats.maxHp += 8;
      this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * 0.3);
      leveledUp.push(this.level);
    }
    return leveledUp;
  }
}
