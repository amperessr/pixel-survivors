import ObjectPool from '../managers/ObjectPool.js';
import { getWeaponLevelData, WEAPON_EVOLUTIONS, WEAPON_KNOCKBACK } from './WeaponData.js';
import { angleTo } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

export default class WeaponSystem {
  constructor(scene, player, enemySystem) {
    this.scene = scene;
    this.player = player;
    this.enemySystem = enemySystem;
    this.owned = {}; // { fireball: level, ... }
    this.evolved = {}; // { fireball: true, ... } 滿五級後進化的武器
    this.nextFireAt = {}; // { fireball: timestamp, ... } 即時運算冷卻時間，避免屬性提升後冷卻不同步
    this.sawbladeSprites = [];
    this.sawbladeAngle = 0;

    this.projectilePool = new ObjectPool(
      scene,
      () => scene.physics.add.image(-100, -100, 'proj_fireball'),
      (obj) => obj,
      100
    );
  }

  // Boss 出現時優先鎖定 Boss 當攻擊目標——玩家對戰王的時候，火力應該集中在王身上，
  // 不會因為旁邊剛好有小怪離得比較近，武器瞄準方向就跑去打雜兵。Boss 物件本身
  // 沒有 x/y，實際用的是牠的 sprite（跟一般敵人 sprite 一樣有 x/y，下游程式碼
  // 不用另外判斷是 Boss 還是小怪）。
  _findTarget(px, py) {
    if (this.scene.boss && this.scene.boss.alive) return this.scene.boss.sprite;
    return this.enemySystem.findNearest(px, py);
  }

  hasWeapon(id) { return !!this.owned[id]; }
  getLevel(id) { return this.owned[id] || 0; }
  ownedWeaponIds() { return Object.keys(this.owned); }
  isMaxed(id) { return this.owned[id] >= 5; }
  isEvolved(id) { return !!this.evolved[id]; }
  canEvolve(id) { return this.owned[id] >= 5 && !this.evolved[id]; }

  addOrUpgrade(id) {
    const newLevel = Math.min((this.owned[id] || 0) + 1, 5);
    this.owned[id] = newLevel;
    // 立即可以再次開火（不必等待舊等級的冷卻）
    this.nextFireAt[id] = this.scene.time.now;
    if (id === 'sawblade') this._rebuildSawblades();
  }

  // 五級滿了之後進化成更強的高階武器：數值全面躍升，外觀加上金色高光
  evolveWeapon(id) {
    if (!this.canEvolve(id)) return;
    this.evolved[id] = true;
    this.nextFireAt[id] = this.scene.time.now;
    if (id === 'sawblade') this._rebuildSawblades();
    this.scene.spawnEvolveFx(this.player.sprite.x, this.player.sprite.y);
  }

  // 取得「目前實際生效」的武器數值：五級數值 + (若已進化) 進化倍率加成
  _getEffectiveData(id) {
    const base = getWeaponLevelData(id, this.owned[id]);
    if (!this.evolved[id]) return base;

    const evo = WEAPON_EVOLUTIONS[id];
    const scaled = { ...base, evolved: true, evoName: evo.name };
    scaled.dmg = base.dmg * evo.dmgMult;
    if (base.aoe != null) scaled.aoe = base.aoe * evo.extraMult;
    if (base.radius != null) scaled.radius = base.radius * evo.extraMult;
    if (base.range != null) scaled.range = base.range * evo.extraMult;
    if (base.chains != null) scaled.chains = Math.round(base.chains * evo.extraMult);
    if (base.count != null) scaled.count = Math.round(base.count * evo.extraMult);
    if (base.pierce != null) scaled.pierce = base.pierce + 1;
    if (base.slow != null) scaled.slow = Math.min(0.85, base.slow * 1.2);
    scaled.cooldown = base.cooldown / (evo.cooldownMult || evo.extraMult);
    return scaled;
  }

  // 攻速對各武器冷卻縮短的影響權重：飛刀/鋸片本來就是「攻速流」武器，攻速加成
  // 要吃滿；火球/雷電/冰霜走的是別條屬性線（攻擊力/爆擊/防禦），攻速對它們只給
  // 一點點加成，避免攻速被動疊一疊就把火球衝成跟飛刀一樣快，壞掉「傷害高、
  // 攻速慢」的定位。stats.atkSpeed 是百分比數字（如 80 代表 +80%），
  // 先除以 100 換成比例，再乘上權重，才不會像舊公式一樣一點點攻速就把冷卻壓到底。
  static ATK_SPEED_COOLDOWN_WEIGHT = {
    fireball: 0.15,
    lightning: 0.3,
    frost: 0.25,
    knife: 1.0,
    sawblade: 1.0,
  };

  _scaledCooldown(id, base) {
    const stats = this.player.stats;
    const weight = WeaponSystem.ATK_SPEED_COOLDOWN_WEIGHT[id] ?? 0.3;
    return Math.max(80, base / (1 + (stats.atkSpeed / 100) * weight));
  }

  update(time, delta) {
    // 依照擁有的武器，逐一檢查是否可以開火（取代舊版基於 Timer 的作法）；
    // 魔王登場開場的 3 秒內（見 GameScene.attacksLocked）玩家無法攻擊，直接跳過整個
    // 開火迴圈——冷卻時間戳記維持原樣不往前推進，開場結束後就能立刻正常開火，
    // 不會因為這 3 秒而額外多等一段冷卻。
    if (!this.scene.attacksLocked) {
      for (const id of Object.keys(this.owned)) {
        if (id === 'sawblade') continue; // 鋸片為持續環繞傷害，非計時開火
        const nextAt = this.nextFireAt[id] || 0;
        if (time >= nextAt) {
          const fired = this._fire(id, time);
          const data = this._getEffectiveData(id);
          const cooldown = this._scaledCooldown(id, data.cooldown);
          // 若因找不到敵人而沒有實際開火（frost 以外的武器），縮短重試間隔避免卡頓
          this.nextFireAt[id] = time + (fired ? cooldown : Math.min(150, cooldown));
        }
      }
    }

    // 鋸片環繞更新
    if (this.owned.sawblade) {
      const data = this._getEffectiveData('sawblade');
      // 轉速只受「疾風之刃（攻速）卡片」張數影響（每張 +8%），
      // 不受角色永久能力值或裝備影響。
      const spinCards = this.player.passiveLevels.atkSpeed || 0;
      const rot = data.rotSpeed * (1 + spinCards * 0.08); // 公轉角速度（繞著玩家轉的速度）
      this.sawbladeAngle += rot * (delta / 1000);
      const n = this.sawbladeSprites.length;
      // 鋸片「自轉」（貼圖本身的旋轉，純視覺效果，不影響命中判定）改成固定速度、
      // 不再跟攻速倍率掛鉤——之前公轉和自轉共用同一個倍率，攻速一高兩個一起衝，
      // 看起來像失控的電風扇。固定在跟 1 級公轉差不多的速度，任何build下都穩定。
      const selfSpinSpeed = 2.6; // 弧度/秒，約每秒轉 0.41 圈
      const selfSpinDelta = selfSpinSpeed * (delta / 1000);
      for (let i = 0; i < n; i++) {
        const ang = this.sawbladeAngle + (i / n) * Math.PI * 2;
        const sp = this.sawbladeSprites[i];
        sp.x = this.player.sprite.x + Math.cos(ang) * data.radius;
        sp.y = this.player.sprite.y + Math.sin(ang) * data.radius;
        sp.rotation += selfSpinDelta;
      }
    }

    // 更新活躍投射物存活時間
    this.projectilePool.forEachActive((p) => {
      if (this.scene.time.now > p.getData('expireAt')) {
        this.projectilePool.free(p);
      }
    });
  }

  // 回傳是否真的開火（frost 一律開火；其餘武器需要有目標敵人）。
  // 分身戒：本尊開火後，若場上有分身，分身也從自己的位置對它最近的目標
  // 再開一輪火，傷害為本尊的一半（鋸片是持續環繞型武器，分身不複製）。
  _fire(id, time) {
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const enemy = this._findTarget(px, py);
    if (id !== 'frost' && !enemy) return false;
    this._fireFrom(id, px, py, enemy, 1);

    const clone = this.scene.cloneSprite;
    if (clone && clone.active) {
      const cloneEnemy = this._findTarget(clone.x, clone.y);
      if (id === 'frost' || cloneEnemy) {
        this._fireFrom(id, clone.x, clone.y, cloneEnemy, 0.5);
      }
    }
    audioManager.attack();
    return true;
  }

  _fireFrom(id, ox, oy, enemy, dmgMult) {
    const data = this._getEffectiveData(id);
    const stats = this.player.stats;
    switch (id) {
      case 'fireball': this._fireFireball(data, stats, enemy, ox, oy, dmgMult); break;
      case 'lightning': this._fireLightning(data, stats, enemy, ox, oy, dmgMult); break;
      case 'knife': this._fireKnife(data, stats, enemy, ox, oy, dmgMult); break;
      case 'frost': this._fireFrost(data, stats, ox, oy, dmgMult); break;
    }
  }

  _fireFireball(data, stats, enemy, px, py, dmgMult = 1) {
    // 體積/爆炸範圍只受「力量卡片」在本場選取的張數影響（每張 +8%），
    // 不受角色永久能力值或裝備影響；傷害仍吃攻擊力（含裝備），讓裝備維持意義。
    const powerCards = this.player.passiveLevels.attack || 0;
    const scaleBonus = (1 + powerCards * 0.08) * (data.evolved ? 1.3 : 1);
    const dmg = data.dmg * (1 + stats.attack * 0.02) * dmgMult;
    const aoe = data.aoe * scaleBonus;

    if (data.evolved) {
      // 進化「隕石燄爆」：不再沿地面飛行，改成直接鎖定目標敵人所在位置，
      // 從天而降砸下一顆隕石（見 GameScene.spawnMeteorStrike()）
      const kb = WEAPON_KNOCKBACK.fireball;
      this.scene.spawnMeteorStrike(enemy.x, enemy.y, dmg, aoe, stats.critRate, stats.critDmg, {
        force: kb.force, duration: kb.duration,
      });
      return;
    }

    const ang = angleTo(px, py, enemy.x, enemy.y);
    const proj = this.projectilePool.spawn();
    proj.setTexture('proj_fireball');
    proj.setPosition(px, py);
    proj.setScale(scaleBonus);
    proj.clearTint();
    proj.setData('dmg', dmg);
    proj.setData('aoe', aoe);
    proj.setData('pierce', data.pierce);
    proj.setData('exploded', false);
    proj.setData('kind', 'fireball');
    proj.setData('evolved', false);
    proj.setData('expireAt', this.scene.time.now + 2500);
    proj.body.setVelocity(Math.cos(ang) * data.speed, Math.sin(ang) * data.speed);
    this.scene.spawnCastFx(px, py, 'fireball', ang, 0, false);
  }

  _fireLightning(data, stats, enemy, px, py, dmgMult = 1) {
    // 分裂數只受「幸運符文（爆擊）卡片」張數影響（每 2 張多分裂 1 次），
    // 不受角色永久能力值或裝備影響；傷害仍吃攻擊力（含裝備）。
    const bonusChains = Math.floor((this.player.passiveLevels.critRate || 0) / 2);
    const dmg = data.dmg * (1 + stats.attack * 0.02) * dmgMult;
    const ang = angleTo(px, py, enemy.x, enemy.y);
    const proj = this.projectilePool.spawn();
    proj.setTexture('proj_lightning');
    proj.setPosition(px, py);
    // 改成電光藍白色調（類似英雄聯盟史提克彈簧刀電刀的連鎖閃電配色）
    proj.setTint(data.evolved ? 0xffe066 : 0x7ef7ff);
    proj.setData('dmg', dmg);
    proj.setData('chains', data.chains + bonusChains);
    proj.setData('range', data.range);
    proj.setData('kind', 'lightning');
    proj.setData('evolved', !!data.evolved);
    proj.setData('hitSet', new Set());
    proj.setData('expireAt', this.scene.time.now + 1200);
    proj.body.setVelocity(Math.cos(ang) * 420, Math.sin(ang) * 420);
    this.scene.spawnCastFx(px, py, 'lightning', ang, 0, data.evolved);
  }

  _fireKnife(data, stats, enemy, px, py, dmgMult = 1) {
    // 飛刀數量只受「疾風之刃（攻速）卡片」張數影響（每 2 張多 1 把），
    // 不受角色永久能力值或裝備影響；傷害仍吃攻擊力（含裝備）。
    const totalCount = data.count + Math.floor((this.player.passiveLevels.atkSpeed || 0) / 2);
    const dmg = data.dmg * (1 + stats.attack * 0.02) * dmgMult;
    const baseAng = angleTo(px, py, enemy.x, enemy.y);
    const spread = 0.18;
    this.scene.spawnCastFx(px, py, 'knife', baseAng, 0, data.evolved);
    for (let i = 0; i < totalCount; i++) {
      const off = (i - (totalCount - 1) / 2) * spread;
      const proj = this.projectilePool.spawn();
      proj.setTexture('proj_knife');
      proj.setPosition(px, py);
      proj.setRotation(baseAng + off);
      if (data.evolved) proj.setTint(0xffe066); else proj.clearTint();
      proj.setData('dmg', dmg);
      proj.setData('pierce', data.pierce);
      proj.setData('kind', 'knife');
      proj.setData('evolved', !!data.evolved);
      proj.setData('hitSet', new Set());
      proj.setData('expireAt', this.scene.time.now + 1500);
      proj.body.setVelocity(Math.cos(baseAng + off) * data.speed, Math.sin(baseAng + off) * data.speed);
    }
  }

  _fireFrost(data, stats, px, py, dmgMult = 1) {
    // 冰霜原本連動的是防禦力，但被動卡片沒有「防禦」這張，所以冰霜範圍只由
    // 武器等級與進化決定（同樣不受角色永久能力值或裝備影響）；傷害仍吃攻擊力。
    const totalRadius = data.radius;
    const dmg = data.dmg * (1 + stats.attack * 0.02) * dmgMult;
    const kb = WEAPON_KNOCKBACK.frost;
    const knockback = { force: kb.force, duration: kb.duration };

    if (data.evolved) {
      // 進化：改成跟一般版一樣「由內到外」一根接一根冒出來的節奏，
      // 只是同時往六個方向（六邊形）噴發，而不是只有一個方向——
      // 每個方向各自從近到遠分 4 階段，同一階段的 6 個方向會同時冒出來，
      // 但不同階段之間仍保留 120ms 的間隔，維持「由內到外」的視覺節奏。
      const directions = 6;
      const steps = 4;
      const stepDist = totalRadius / steps;
      for (let s = 1; s <= steps; s++) {
        const pillarDist = stepDist * s;
        for (let d = 0; d < directions; d++) {
          const ang = (d / directions) * Math.PI * 2;
          const x = px + Math.cos(ang) * pillarDist;
          const y = py + Math.sin(ang) * pillarDist;
          this.scene.time.delayedCall((s - 1) * 120, () => {
            this.scene.spawnIcePillar(x, y, dmg, data.slow, data.slowDuration, stats.critRate, stats.critDmg, knockback, true);
          });
        }
      }
    } else {
      // 一般：從自己所在位置，往目標（優先鎖定 Boss）的方向，一根接一根冒出冰柱
      const enemy = this._findTarget(px, py);
      const ang = enemy ? angleTo(px, py, enemy.x, enemy.y) : Math.random() * Math.PI * 2;
      const count = 4;
      const step = totalRadius / count;
      for (let i = 1; i <= count; i++) {
        const pillarDist = step * i;
        const x = px + Math.cos(ang) * pillarDist;
        const y = py + Math.sin(ang) * pillarDist;
        this.scene.time.delayedCall((i - 1) * 120, () => {
          this.scene.spawnIcePillar(x, y, dmg, data.slow, data.slowDuration, stats.critRate, stats.critDmg, knockback, false);
        });
      }
    }
  }

  _rebuildSawblades() {
    for (const sp of this.sawbladeSprites) sp.destroy();
    this.sawbladeSprites = [];
    const data = this._getEffectiveData('sawblade');
    for (let i = 0; i < data.count; i++) {
      const sp = this.scene.add.image(this.player.sprite.x, this.player.sprite.y, 'proj_sawblade');
      sp.setDepth(6000);
      if (data.evolved) sp.setTint(0xffe066);
      sp.setData('kind', 'sawblade');
      sp.setData('lastHit', new Map());
      this.sawbladeSprites.push(sp);
    }
  }

  getSawbladeDamage() {
    if (!this.owned.sawblade) return 0;
    // 攻擊力比照其他武器的公式，同步反映到鋸片傷害上
    const data = this._getEffectiveData('sawblade');
    return data.dmg * (1 + this.player.stats.attack * 0.02);
  }
}
