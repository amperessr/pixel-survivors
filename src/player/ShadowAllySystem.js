import { dist, angleTo } from '../utils/MathUtils.js';

// 暗影君王套裝召喚出的「影子盟友」：永久存在（沒有存活時間限制），會主動貼近
// 附近敵人攻擊、也會被敵人反打，血量歸零才會消失。跟 ring_clone 的分身幻影不同
// （那個純視覺跟隨、打不到也打不到人），這是真正獨立的戰鬥單位。
const SEARCH_RADIUS = 260; // 主動搜敵範圍
const ATTACK_RANGE = 22;
const ATTACK_COOLDOWN = 700;
const MOVE_SPEED = 140;
const FOLLOW_RADIUS = 80; // 沒有目標時，離玩家多遠才會主動靠攏，避免散得太開
const HIT_INVULN_MS = 500; // 比照 Player.takeDamage 的無敵時間，避免同一幀被多隻怪重複打

export default class ShadowAllySystem {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.allies = [];
  }

  // 召喚一隻新的影子盟友：HP 在召喚當下依玩家目前生命上限鎖定（之後不會跟著玩家
  // 生命上限變動而改變上限），防禦力/攻擊力則在戰鬥時即時讀玩家目前數值，
  // 玩家後續變強時，已經召喚出來的影子也會一起變強。三圍統一都是玩家的 1/5。
  spawn() {
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const ang = Math.random() * Math.PI * 2;
    const x = px + Math.cos(ang) * 40, y = py + Math.sin(ang) * 40;
    const sprite = this.scene.physics.add.sprite(x, y, this.player.charDef.texture)
      .setScale(0.5).setTint(0x2a1533).setDepth(y);
    sprite.body.setCircle(10, sprite.width / 2 - 10, sprite.height / 2 - 10);
    const maxHp = Math.max(1, Math.round(this.player.stats.maxHp / 5));
    sprite.setData('maxHp', maxHp);
    sprite.setData('hp', maxHp);
    sprite.setData('nextAttackAt', 0);
    sprite.setData('invulnerableUntil', 0);
    this.allies.push(sprite);
    return sprite;
  }

  update(time) {
    const enemySystem = this.scene.enemySystem;
    const boss = this.scene.boss;
    const stats = this.player.stats;
    const atk = Math.max(1, stats.attack / 5);
    const critRate = stats.critRate, critDmg = stats.critDmg;

    for (let i = this.allies.length - 1; i >= 0; i--) {
      const ally = this.allies[i];
      if (!ally.active) { this.allies.splice(i, 1); continue; }
      ally.setDepth(ally.y);

      // 找目標：附近最近的小怪 vs 存活的魔王，取距離較近者——影子盟友是主動貼上去
      // 打附近敵人的散兵，不是像武器那樣優先鎖定魔王。
      let target = null, targetIsBoss = false, bestD = Infinity;
      enemySystem.queryNear(ally.x, ally.y, SEARCH_RADIUS, (e) => {
        const d = dist(ally.x, ally.y, e.x, e.y);
        if (d < bestD) { bestD = d; target = e; targetIsBoss = false; }
      });
      if (boss && boss.alive) {
        const d = dist(ally.x, ally.y, boss.sprite.x, boss.sprite.y);
        if (d < bestD) { bestD = d; target = boss; targetIsBoss = true; }
      }

      if (target) {
        const tx = targetIsBoss ? target.sprite.x : target.x;
        const ty = targetIsBoss ? target.sprite.y : target.y;
        if (bestD > ATTACK_RANGE) {
          const ang = angleTo(ally.x, ally.y, tx, ty);
          ally.body.setVelocity(Math.cos(ang) * MOVE_SPEED, Math.sin(ang) * MOVE_SPEED);
        } else {
          ally.body.setVelocity(0, 0);
          if (time >= ally.getData('nextAttackAt')) {
            ally.setData('nextAttackAt', time + ATTACK_COOLDOWN);
            if (targetIsBoss) target.takeDamage(atk, critRate, critDmg);
            else enemySystem.damageEnemy(target, atk, critRate, critDmg, null);
          }
        }
      } else {
        // 沒有目標：離玩家太遠就緩慢靠攏，避免召喚出來的影子散落得到處都是
        const d = dist(ally.x, ally.y, this.player.sprite.x, this.player.sprite.y);
        if (d > FOLLOW_RADIUS) {
          const ang = angleTo(ally.x, ally.y, this.player.sprite.x, this.player.sprite.y);
          ally.body.setVelocity(Math.cos(ang) * MOVE_SPEED, Math.sin(ang) * MOVE_SPEED);
        } else {
          ally.body.setVelocity(0, 0);
        }
      }
    }
  }

  // 敵人反打影子盟友時呼叫（見 EnemySystem.update() 的接觸傷害判定）。減傷公式
  // 跟 Player.takeDamage() 同一套（defense 100 減傷 50%），即時讀玩家目前防禦力
  // 的 1/5（見 spawn() 開頭的三圍統一 1/5 說明）。
  damageAlly(ally, amount) {
    if (!ally.active) return;
    const now = this.scene.time.now;
    if (now < ally.getData('invulnerableUntil')) return;
    ally.setData('invulnerableUntil', now + HIT_INVULN_MS);
    const defense = this.player.stats.defense / 5;
    const mitigated = Math.max(1, amount * (100 / (100 + defense)));
    const hp = ally.getData('hp') - mitigated;
    ally.setData('hp', hp);
    ally.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => { if (ally.active) ally.setTint(0x2a1533); });
    if (hp <= 0) this._killAlly(ally);
  }

  _killAlly(ally) {
    const idx = this.allies.indexOf(ally);
    if (idx >= 0) this.allies.splice(idx, 1);
    this.scene.spawnBurstFx(ally.x, ally.y, 0x9d6bff, 10, 'fx_crit', 110);
    this.scene.spawnKillFx(ally.x, ally.y);
    ally.destroy();
  }
}
