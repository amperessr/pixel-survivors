import ObjectPool from '../managers/ObjectPool.js';
import { getWeaponLevelData, WEAPON_EVOLUTIONS, WEAPON_KNOCKBACK, WEAPON_FUSIONS, findFusionFor } from './WeaponData.js';
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
  isFusion(id) { return !!WEAPON_FUSIONS[id]; }
  // 融合武器暫時不開放再進化（之後有需要再開放），所以這裡額外排除掉它
  canEvolve(id) { return this.owned[id] >= 5 && !this.evolved[id] && !WEAPON_FUSIONS[id]; }

  // 這把「基礎武器」是不是被某個目前擁有中的融合武器鎖住了——例如飛刀+鋸片融合
  // 出血肉風暴之後，_rebuildSawblades() 只認 owned['knife_sawblade']，這時候如果
  // 又重新選到「新武器：旋轉鋸片」，鋸片會完全不開火、不計傷害，變成一張廢卡。
  // LevelUpScene 的新武器選項要用這個排除掉這種情況，直到玩家哪天把血肉風暴
  // 系統性地拆開（目前沒有拆開機制）才會又重新開放。
  isLockedByFusion(id) {
    return Object.values(WEAPON_FUSIONS).some((f) => f.parents.includes(id) && this.owned[f.id]);
  }

  // 兩把武器都滿 5 級、都還沒進化、也都還不是融合武器本身，且剛好有對應配方
  // （見 WeaponData.findFusionFor）才能融合。融合會清掉原本兩把武器（見
  // fuseWeapons），所以玩家之後還能重新拿到雷電/飛刀這些「融合前」的武器去
  // 單獨升級/進化——但如果那把融合武器已經拿過一次，不能再融合出第二份重複的，
  // 這裡額外擋掉。
  canFuse(idA, idB) {
    if (!this.isMaxed(idA) || !this.isMaxed(idB)) return false;
    if (this.evolved[idA] || this.evolved[idB]) return false;
    if (WEAPON_FUSIONS[idA] || WEAPON_FUSIONS[idB]) return false;
    const fusion = findFusionFor(idA, idB);
    if (!fusion) return false;
    if (this.owned[fusion.id]) return false; // 已經有這把融合武器了，不能重複融合
    return true;
  }

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

  // 融合：把兩把滿級武器「吃掉」，換成一把全新的融合武器（見 WeaponData.WEAPON_FUSIONS）。
  // 騰出的武器欄位讓玩家後續還能選到沒拿過的其他武器。
  fuseWeapons(idA, idB) {
    if (!this.canFuse(idA, idB)) return;
    const fusion = findFusionFor(idA, idB);
    delete this.owned[idA];
    delete this.owned[idB];
    delete this.nextFireAt[idA];
    delete this.nextFireAt[idB];
    this.owned[fusion.id] = 5;
    this.nextFireAt[fusion.id] = this.scene.time.now;
    if (idA === 'sawblade' || idB === 'sawblade') this._rebuildSawblades();
    // 複用進化特效表示「融合完成」，不用另外做一套視覺
    this.scene.spawnEvolveFx(this.player.sprite.x, this.player.sprite.y);
  }

  // 取得「目前實際生效」的武器數值：融合武器直接回傳固定數值（沒有等級曲線／
  // 進化倍率）；一般武器則是五級數值 + (若已進化) 進化倍率加成。
  _getEffectiveData(id) {
    const fusion = WEAPON_FUSIONS[id];
    if (fusion) return this._applyWindSizeBonus({ ...fusion.stats, isFusion: true });

    const base = getWeaponLevelData(id, this.owned[id]);
    if (!this.evolved[id]) return this._applyWindSizeBonus({ ...base });

    const evo = WEAPON_EVOLUTIONS[id];
    const scaled = { ...base, evolved: true, evoName: evo.name };
    scaled.dmg = base.dmg * evo.dmgMult;
    if (base.aoe != null) scaled.aoe = base.aoe * evo.extraMult;
    if (base.radius != null) scaled.radius = base.radius * evo.extraMult;
    if (base.range != null) scaled.range = base.range * evo.extraMult;
    if (base.chains != null) scaled.chains = Math.round(base.chains * evo.extraMult);
    if (base.count != null) scaled.count = Math.round(base.count * evo.extraMult);
    // 一般武器進化的穿透力預設是「+1」，飛刀進化要求命中數直接跳到 10，用
    // evo.pierceOverride 覆蓋掉預設規則（見 WeaponData.js 的 WEAPON_EVOLUTIONS.knife）。
    if (base.pierce != null) scaled.pierce = evo.pierceOverride != null ? evo.pierceOverride : base.pierce + 1;
    scaled.cooldown = base.cooldown / (evo.cooldownMult || evo.extraMult);
    return this._applyWindSizeBonus(scaled);
  }

  // 狂風套裝五件套：所有技能的「大小」+100%——這裡統一放大命中判定用的範圍/半徑
  // 欄位，各 _fireXXX 方法再各自把對應的投射物/特效視覺縮放乘上同一個倍率
  // （見 _windSizeMult()），確保「看起來變大」跟「打得到的範圍變大」是一致的。
  _applyWindSizeBonus(data) {
    const mult = this._windSizeMult();
    if (mult === 1) return data;
    ['aoe', 'radius', 'range', 'chainRange', 'innerRadius', 'outerRadius'].forEach((key) => {
      if (data[key] != null) data[key] *= mult;
    });
    return data;
  }

  // 統一委派給 GameScene.windSizeMult()，避免這裡跟 GameScene 各自維護一份
  // wind5 門檻判斷（見 GameScene.windSizeMult() 的說明）
  _windSizeMult() {
    return this.scene.windSizeMult();
  }

  // 攻速對各武器冷卻縮短的影響權重：飛刀/鋸片本來就是「攻速流」武器，攻速加成
  // 吃滿；其他武器原本只吃 15%~30%，結果就是玩家疊了疾風卡卻幾乎感覺不到火球/
  // 冰霜/雷電變快（攻速 +30% 火球實際只快 4.5%）——2026-07-10 全面拉高：慢速
  // 武器最低也吃 60%，每把武器疊攻速都有明顯手感，飛刀系仍然稍快一籌保留差異。
  // stats.atkSpeed 是百分比數字（如 80 代表 +80%），先除以 100 換成比例再乘權重。
  static ATK_SPEED_COOLDOWN_WEIGHT = {
    fireball: 0.6,
    lightning: 0.7,
    frost: 0.65,
    knife: 1.0,
    sawblade: 1.0,
    lightning_knife: 0.85, // 電擊飛刃：飛刀+雷電混血，攻速權重介於兩者之間
    fireball_frost: 0.6,   // 世界末日：爆發系融合武器，維持火球/冰霜那種慢而重的手感
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
        // 鋸片／血肉風暴（鋸片融合）都是持續環繞傷害，非計時開火，交給下面的環繞更新處理
        if (id === 'sawblade' || id === 'knife_sawblade') continue;
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

    // 鋸片／血肉風暴環繞更新：血肉風暴是內圈鋸片＋外圈飛刀的雙層環，外圈反向旋轉
    // （見 _rebuildSawblades() 怎麼幫每個 sprite 標記 ring 0/1），一般鋸片只有一圈。
    if (this.owned.sawblade || this.owned['knife_sawblade']) {
      const isDualRing = !!this.owned['knife_sawblade'];
      const fusionStats = isDualRing ? WEAPON_FUSIONS['knife_sawblade'].stats : null;
      const data = isDualRing ? null : this._getEffectiveData('sawblade');
      const baseRot = isDualRing ? fusionStats.rotSpeed : data.rotSpeed;
      // 轉速只受「疾風之刃（攻速）卡片」張數影響（每張 +8%），
      // 不受角色永久能力值或裝備影響。
      const spinCards = this.player.passiveLevels.atkSpeed || 0;
      const rot = baseRot * (1 + spinCards * 0.08); // 公轉角速度（繞著玩家轉的速度）
      this.sawbladeAngle += rot * (delta / 1000);
      const px = this.player.sprite.x, py = this.player.sprite.y;
      // 鋸片「自轉」（貼圖本身的旋轉，純視覺效果，不影響命中判定）改成固定速度、
      // 不再跟攻速倍率掛鉤——之前公轉和自轉共用同一個倍率，攻速一高兩個一起衝，
      // 看起來像失控的電風扇。固定在跟 1 級公轉差不多的速度，任何build下都穩定。
      const selfSpinSpeed = 2.6; // 弧度/秒，約每秒轉 0.41 圈
      const selfSpinDelta = selfSpinSpeed * (delta / 1000);
      const inner = this.sawbladeSprites.filter((sp) => (sp.getData('ring') || 0) === 0);
      const outer = this.sawbladeSprites.filter((sp) => sp.getData('ring') === 1);
      const placeRing = (sprites, radius, dirMult) => {
        const n = sprites.length;
        sprites.forEach((sp, i) => {
          const ang = this.sawbladeAngle * dirMult + (i / n) * Math.PI * 2;
          sp.x = px + Math.cos(ang) * radius;
          sp.y = py + Math.sin(ang) * radius;
          sp.rotation += selfSpinDelta;
        });
      };
      if (isDualRing) {
        placeRing(inner, fusionStats.innerRadius, 1);
        placeRing(outer, fusionStats.outerRadius, -0.8); // 外圈反向、慢一點旋轉，做出雙層絞殺的視覺
      } else {
        placeRing(inner, data.radius, 1);
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
      case 'lightning_knife': this._fireElectroKnife(data, stats, enemy, ox, oy, dmgMult); break;
      case 'fireball_frost': this._fireWorldEnd(data, stats, enemy, ox, oy, dmgMult); break;
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
    proj.setScale(scaleBonus * this._windSizeMult());
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
    proj.setScale(this._windSizeMult());
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
    // 狂風套裝五件套：冰柱排列間距（totalRadius，上面已經吃到 wind5）跟每根冰柱
    // 自己的命中半徑/貼圖大小要用同一個倍率，不然只有冰柱之間站得更開、單根
    // 冰柱本身完全沒變大——見 GameScene.spawnIcePillar() 的 sizeMult 參數。
    const sizeMult = this._windSizeMult();

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
          // 最外圈（離玩家最遠的那一階）冰柱標記 outermost，spawnIcePillar 會把它
          // 做得更大並直接冰凍命中的敵人，而不只是緩速——進化後的收尾一擊更有份量感。
          const outermost = s === steps;
          this.scene.time.delayedCall((s - 1) * 120, () => {
            this.scene.spawnIcePillar(x, y, dmg, data.slowDuration, stats.critRate, stats.critDmg, knockback, true, outermost, sizeMult);
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
          this.scene.spawnIcePillar(x, y, dmg, data.slowDuration, stats.critRate, stats.critDmg, knockback, false, false, sizeMult);
        });
      }
    }
  }

  // 帶電飛刀（電擊飛刃）：跟一般飛刀一樣連續投擲，只是命中後會在 GameScene 那邊
  // 額外對附近一名敵人補一道連鎖閃電（見 GameScene._handleElectroKnifeHit）。
  _fireElectroKnife(data, stats, enemy, px, py, dmgMult = 1) {
    const dmg = data.dmg * (1 + stats.attack * 0.02) * dmgMult;
    const baseAng = angleTo(px, py, enemy.x, enemy.y);
    const spread = 0.18;
    this.scene.spawnCastFx(px, py, 'knife', baseAng, 0, true);
    for (let i = 0; i < data.count; i++) {
      const off = (i - (data.count - 1) / 2) * spread;
      const proj = this.projectilePool.spawn();
      // 改用正式美術圖（藍白電光+金色電花的斜向閃電飛刃），取代原本借用一般飛刀
      // 貼圖再染色的做法。素材本身畫的是右上-左下走向，這裡補一個 45 度的旋轉
      // 校正，讓貼圖的視覺方向對齊實際飛行角度。
      proj.setTexture('proj_electroknife');
      proj.setPosition(px, py);
      proj.setRotation(baseAng + off + Math.PI / 4);
      proj.setScale(0.9 * this._windSizeMult());
      proj.clearTint();
      proj.setData('dmg', dmg);
      proj.setData('pierce', data.pierce);
      proj.setData('chainRange', data.chainRange);
      proj.setData('kind', 'electroKnife');
      proj.setData('evolved', false);
      proj.setData('hitSet', new Set());
      proj.setData('expireAt', this.scene.time.now + 1500);
      proj.body.setVelocity(Math.cos(baseAng + off) * data.speed, Math.sin(baseAng + off) * data.speed);
    }
  }

  // 世界末日（原「極端冰火」改版）：不飛行、不經過投射物池，隕石跟冰塊分別鎖定
  // 不同目標、各打各的（見 GameScene.spawnMeteorDrop()／spawnIceDrop()）——
  // 隕石打這次開火瞄準的目標（跟其他武器一致的規則，通常是最近的敵人/魔王），
  // 冰塊另外隨機挑一隻不同的敵人；找不到別的敵人時，退而求其次也打同一個目標。
  _fireWorldEnd(data, stats, enemy, px, py, dmgMult = 1) {
    const dmg = data.dmg * (1 + stats.attack * 0.02) * dmgMult;
    const kb = WEAPON_KNOCKBACK.frost;
    this.scene.spawnMeteorDrop(enemy.x, enemy.y, dmg, data.aoe, stats.critRate, stats.critDmg, {
      force: kb.force, duration: kb.duration,
    });
    const iceTarget = this.enemySystem.findRandomOther(enemy) || enemy;
    this.scene.spawnIceDrop(iceTarget.x, iceTarget.y, dmg, data.aoe, stats.critRate, stats.critDmg);
    this._fireWorldEndPillarRing(data, stats, px, py, dmgMult);
  }

  // 世界末日新增技能：完全比照冰霜新星進化版「永凍冰川」的技能結構（見
  // _fireFrost 的 data.evolved 分支）——由近到遠分 4 階、每階同時往 N 個方向
  // 冒出巨大冰柱，只是方向數從 6 改成 8，並且方向之間交替「大冰柱／炎柱」
  // （不是每階交替，是整條方向柱子固定同一種屬性）。跟隕石/冰塊各打各的目標
  // 互相獨立，傷害拉低到 0.7 倍避免疊加太誇張——這一圈本來就是「額外補傷害」，
  // 不是取代原本兩顆天降打擊。
  _fireWorldEndPillarRing(data, stats, px, py, dmgMult) {
    const dmg = data.dmg * (1 + stats.attack * 0.02) * dmgMult * 0.7;
    const kb = WEAPON_KNOCKBACK.frost;
    const knockback = { force: kb.force, duration: kb.duration };
    const sizeMult = this._windSizeMult();
    const directions = 8;
    const steps = 4;
    // Doomsday 沒有 frost 那種 radius 欄位，借用 aoe（隕石/冰塊命中半徑）換算，
    // 3.2 倍抓出跟永凍冰川同一個量級的「刺出去有感」距離。
    const totalRadius = data.aoe * 3.2;
    const stepDist = totalRadius / steps;
    for (let s = 1; s <= steps; s++) {
      const pillarDist = stepDist * s;
      const outermost = s === steps;
      for (let d = 0; d < directions; d++) {
        const ang = (d / directions) * Math.PI * 2;
        const x = px + Math.cos(ang) * pillarDist;
        const y = py + Math.sin(ang) * pillarDist;
        const isFire = d % 2 === 0;
        this.scene.time.delayedCall((s - 1) * 120, () => {
          if (isFire) {
            this.scene.spawnFirePillar(x, y, dmg, stats.critRate, stats.critDmg, knockback, outermost, sizeMult);
          } else {
            this.scene.spawnIcePillar(x, y, dmg, data.slowDuration || 1500, stats.critRate, stats.critDmg, knockback, true, outermost, sizeMult);
          }
        });
      }
    }
  }

  // 建立鋸片（或血肉風暴的雙層刀陣）的環繞 sprite。每個 sprite 用 'ring' 資料標記
  // 屬於內圈（0，鋸片）還是外圈（1，飛刀，只有血肉風暴才有），見 update() 怎麼
  // 分開兩圈各自的半徑跟旋轉方向。
  _rebuildSawblades() {
    for (const sp of this.sawbladeSprites) sp.destroy();
    this.sawbladeSprites = [];
    // 狂風套裝五件套：刀刃貼圖也要跟著放大，不然環繞半徑（見 update() 的 radius/
    // innerRadius/outerRadius，已經是 wind5 放大過的數值）變大了，刀刃本身看起來
    // 還是原本大小，畫面上會很不協調。
    const sizeMult = this._windSizeMult();

    if (this.owned['knife_sawblade']) {
      const s = WEAPON_FUSIONS['knife_sawblade'].stats;
      for (let i = 0; i < s.innerCount; i++) {
        // 內圈改用正式美術圖（血紅色的旋轉刀刃圖騰），取代原本借用一般鋸片貼圖，
        // 本身已經有完整配色，不用再額外染色。
        const sp = this.scene.add.image(this.player.sprite.x, this.player.sprite.y, 'fx_bloodstorm');
        sp.setScale(0.5 * sizeMult);
        sp.setDepth(6000).setData('kind', 'sawblade').setData('lastHit', new Map()).setData('ring', 0);
        this.sawbladeSprites.push(sp);
      }
      for (let i = 0; i < s.outerCount; i++) {
        // 外圈改用跟內圈同一張血肉風暴美術圖（本身已有完整配色，不用染色），
        // 只是外圈半徑比較大，稍微放大一點跟內圈做出區隔。
        const sp = this.scene.add.image(this.player.sprite.x, this.player.sprite.y, 'fx_bloodstorm');
        sp.setScale(0.65 * sizeMult);
        sp.setDepth(6000).setData('kind', 'sawblade').setData('lastHit', new Map()).setData('ring', 1);
        this.sawbladeSprites.push(sp);
      }
      return;
    }

    const data = this._getEffectiveData('sawblade');
    for (let i = 0; i < data.count; i++) {
      const sp = this.scene.add.image(this.player.sprite.x, this.player.sprite.y, 'proj_sawblade');
      sp.setDepth(6000);
      sp.setScale(sizeMult);
      if (data.evolved) sp.setTint(0xffe066);
      sp.setData('kind', 'sawblade');
      sp.setData('lastHit', new Map());
      sp.setData('ring', 0);
      this.sawbladeSprites.push(sp);
    }
  }

  getSawbladeDamage() {
    if (this.owned['knife_sawblade']) {
      const s = WEAPON_FUSIONS['knife_sawblade'].stats;
      return s.dmg * (1 + this.player.stats.attack * 0.02);
    }
    if (!this.owned.sawblade) return 0;
    // 攻擊力比照其他武器的公式，同步反映到鋸片傷害上
    const data = this._getEffectiveData('sawblade');
    return data.dmg * (1 + this.player.stats.attack * 0.02);
  }
}
