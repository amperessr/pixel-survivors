import { clamp } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

// 四種初始角色設定 (依規格百分比修正基礎數值)
export const CHARACTERS = {
  attacker: {
    id: 'attacker', name: '攻擊型 · 烈焰戰士', texture: 'player_attacker',
    desc: 'Attack +40%／HP -10%／Defense -10%',
    mods: { attack: 1.4, hp: 0.9, defense: 0.9, moveSpeed: 1, atkSpeed: 1 },
  },
  speedster: {
    id: 'speedster', name: '速度型 · 疾風劍客', texture: 'player_speedster',
    desc: 'MoveSpeed +40%／AtkSpeed +25%／Attack -15%',
    mods: { attack: 0.85, hp: 1, defense: 1, moveSpeed: 1.4, atkSpeed: 1.25 },
  },
  tank: {
    id: 'tank', name: '防禦型 · 鋼鐵守衛', texture: 'player_tank',
    desc: 'HP +40%／Defense +40%／MoveSpeed -20%',
    mods: { attack: 1, hp: 1.4, defense: 1.4, moveSpeed: 0.8, atkSpeed: 1 },
  },
  balanced: {
    id: 'balanced', name: '平衡型 · 遊俠', texture: 'player_balanced',
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
    this.sprite.setCollideWorldBounds(false);
    this.sprite.body.setCircle(11, 5, 8);
    this.sprite.setDepth(5000);

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
  }

  _dash(time) {
    this.isDashing = true;
    this.invulnerableUntil = time + 220;
    audioManager.dash();
    this.scene.time.delayedCall(220, () => { this.isDashing = false; });
    this.dashCooldownUntil = time + 1800;
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
