import { dist, angleTo } from '../utils/MathUtils.js';
import { ENEMY_TYPES, ENEMY_IDS } from '../enemy/EnemyData.js';
import { BOSS_TYPES } from '../boss/Boss.js';

// 暗影君王套裝召喚出的「影子盟友」：永久存在（沒有存活時間限制），會主動貼近
// 附近敵人攻擊、也會被敵人反打，血量歸零才會消失。跟 ring_clone 的分身幻影不同
// （那個純視覺跟隨、打不到也打不到人），這是真正獨立的戰鬥單位。
const SEARCH_RADIUS = 260; // 主動搜敵範圍
// 攻擊距離依種類：小兵影子維持原本的貼身距離，魔王影子體型放大 3 倍後貼身距離
// 看起來會很奇怪（明明是巨龍卻要臉貼臉才打得到），拉長到接近牠的體型範圍。
const ATTACK_RANGE_BY_KIND = { minion: 22, boss: 80 };
const ATTACK_COOLDOWN = 700; // 基礎攻擊間隔，實際會依玩家攻速縮短（見 update() 的 cooldown 計算）
const ATK_SPEED_WEIGHT = 0.6; // 攻速對影子攻擊間隔縮短的權重，跟 WeaponSystem 中段火力武器同一個量級
const MOVE_SPEED = 140;
const FOLLOW_RADIUS = 80; // 沒有目標時，離玩家多遠才會主動靠攏，避免散得太開
const HIT_INVULN_MS = 500; // 比照 Player.takeDamage 的無敵時間，避免同一幀被多隻怪重複打
const SHADOW_TINT = 0x2a1533; // 小兵/魔王影子統一染色，維持「都是提取出的影子」的一致觀感

// 三圍（HP／攻擊／防禦）依種類統一比例：小兵維持原本的玩家數值 1/5，魔王影子取得
// 難度高很多（湊滿五件套+最多三抽才有一隻）、體型也大一圈，拉高到 1/2.5，
// 明顯比小兵影子強一截，避免「稀有度看起來很高但打起來一樣弱」的落差感。
const STAT_DIVISOR = { minion: 5, boss: 2.5 };

// 魔王影子專屬「大招」：不是照搬 Boss.js 的完整技能系統（那是為單一魔王對玩家設計
// 的前搖警示+獨立投射物+跟魔王擊殺數掛鉤的傷害公式，直接套用在隨從身上會強到失控、
// 也會拖垮效能），改成簡化版——固定頻率插入一次高倍率攻擊，傷害一樣走 STAT_DIVISOR
// 換算（不會脫離玩家數值平衡），只用通用特效表現「這一下比較重」，沒有前搖警示。
const BOSS_SKILL_INTERVAL = 4000; // 大招獨立冷卻，跟普通攻擊冷卻分開算
const BOSS_SKILL_DMG_MULT = 2.5; // 大招傷害＝普通攻擊力 x 這個倍率

// 魔王影子要「明顯比小兵影子大」來區分稀有度，但五種魔王原始美術圖尺寸差異很大
// （兩隻龍 425x320/407x320 vs 惡魔王/樹王 1536x1024 vs 獅鷲王 700x616），直接沿用
// Boss.js 的 BOSS_TYPES.scale（那是給「真正的魔王戰鬥」用的縮放，套在隨從身上會
// 巨大到誇張）。改成用長邊統一縮放到固定目標尺寸，五種魔王影子看起來大小才一致。
// 2026-07-11：原本 110 玩家反應不夠有魄力，直接放大 3 倍。
const BOSS_SHADOW_TARGET_SIZE = 330;

export default class ShadowAllySystem {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.allies = [];
  }

  // 召喚一隻新的影子盟友：HP／攻擊力／防禦力都即時讀玩家「目前」數值換算（見
  // _maxHpFor()、update() 裡的 atk、damageAlly() 裡的 defense），玩家後續變強、
  // 或難度隨時間往上爬升時，已經召喚出來的影子也會一起跟著變強/變弱，不會固定在
  // 召喚當下那一刻，避免早期召喚的影子後期變成一戳就死的紙糊兵。
  // kind='minion'：外觀隨機挑一種小怪貼圖（哥布林/山豬/骷髏/半獸人），比例照該怪物
  // 原本的顯示大小。kind='boss'：外觀是 bossType 指定的那隻魔王貼圖，縮小成統一的
  // 隨從尺寸（見 BOSS_SHADOW_TARGET_SIZE），比小兵影子明顯大一圈以區分稀有度。
  spawn(kind = 'minion', bossType = null) {
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const ang = Math.random() * Math.PI * 2;
    const x = px + Math.cos(ang) * 40, y = py + Math.sin(ang) * 40;

    let texture, scale;
    if (kind === 'boss') {
      const def = BOSS_TYPES[bossType] || BOSS_TYPES.blue;
      texture = def.texture;
      const src = this.scene.textures.get(texture).getSourceImage();
      scale = BOSS_SHADOW_TARGET_SIZE / Math.max(src.width, src.height);
    } else {
      const def = ENEMY_TYPES[ENEMY_IDS[Math.floor(Math.random() * ENEMY_IDS.length)]];
      texture = def.texture;
      scale = def.scale;
    }

    const sprite = this.scene.physics.add.sprite(x, y, texture)
      .setScale(scale).setTint(SHADOW_TINT).setDepth(y);
    sprite.body.setCircle(10, sprite.width / 2 - 10, sprite.height / 2 - 10);
    sprite.setData('kind', kind);
    sprite.setData('hpRatio', 1); // 目前血量佔上限的比例，上限即時算（見 _maxHpFor），不存絕對數值
    sprite.setData('nextAttackAt', 0);
    sprite.setData('nextSkillAt', 0); // 魔王影子專屬大招冷卻（見 BOSS_SKILL_INTERVAL），小兵影子不會用到
    sprite.setData('invulnerableUntil', 0);
    this.allies.push(sprite);
    return sprite;
  }

  // 即時算某隻影子目前的血量上限：讀玩家「目前」生命上限 / STAT_DIVISOR[kind]，
  // 不快取——確保玩家變強或難度爬升時，血量上限跟著同步變動（見 spawn() 開頭說明）。
  _maxHpFor(kind) {
    return Math.max(1, Math.round(this.player.stats.maxHp / (STAT_DIVISOR[kind] || STAT_DIVISOR.minion)));
  }

  update(time) {
    const enemySystem = this.scene.enemySystem;
    const boss = this.scene.boss;
    const stats = this.player.stats;
    const critRate = stats.critRate, critDmg = stats.critDmg;
    // 攻擊間隔跟其他武器一樣吃玩家攻速加成（見 WeaponSystem._scaledCooldown 同一套公式）
    const cooldown = Math.max(200, ATTACK_COOLDOWN / (1 + (stats.atkSpeed / 100) * ATK_SPEED_WEIGHT));

    for (let i = this.allies.length - 1; i >= 0; i--) {
      const ally = this.allies[i];
      if (!ally.active) { this.allies.splice(i, 1); continue; }
      ally.setDepth(ally.y);
      const kind = ally.getData('kind') || 'minion';
      const atk = Math.max(1, stats.attack / (STAT_DIVISOR[kind] || STAT_DIVISOR.minion));
      const attackRange = ATTACK_RANGE_BY_KIND[kind] || ATTACK_RANGE_BY_KIND.minion;

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
        if (bestD > attackRange) {
          const ang = angleTo(ally.x, ally.y, tx, ty);
          ally.body.setVelocity(Math.cos(ang) * MOVE_SPEED, Math.sin(ang) * MOVE_SPEED);
        } else {
          ally.body.setVelocity(0, 0);
          if (time >= ally.getData('nextAttackAt')) {
            ally.setData('nextAttackAt', time + cooldown);
            // 魔王影子大招：獨立冷卻到了就這一下改用大招倍率，順便播放特效
            const useSkill = kind === 'boss' && time >= ally.getData('nextSkillAt');
            const dmg = useSkill ? atk * BOSS_SKILL_DMG_MULT : atk;
            if (useSkill) {
              ally.setData('nextSkillAt', time + BOSS_SKILL_INTERVAL);
              this._playBossSkillFx(tx, ty);
            }
            if (targetIsBoss) target.takeDamage(dmg, critRate, critDmg);
            else enemySystem.damageEnemy(target, dmg, critRate, critDmg, null);
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
  // 依種類換算（見 STAT_DIVISOR）。血量存成比例（hpRatio）而不是絕對值，上限
  // 每次都重新即時算，跟 spawn() 開頭說明的「不鎖死在召喚當下」是同一套邏輯。
  damageAlly(ally, amount) {
    if (!ally.active) return;
    const now = this.scene.time.now;
    if (now < ally.getData('invulnerableUntil')) return;
    ally.setData('invulnerableUntil', now + HIT_INVULN_MS);
    const kind = ally.getData('kind') || 'minion';
    const defense = this.player.stats.defense / (STAT_DIVISOR[kind] || STAT_DIVISOR.minion);
    const mitigated = Math.max(1, amount * (100 / (100 + defense)));
    const maxHp = this._maxHpFor(kind);
    const hp = maxHp * ally.getData('hpRatio') - mitigated;
    ally.setData('hpRatio', Math.max(0, hp / maxHp));
    ally.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => { if (ally.active) ally.setTint(SHADOW_TINT); });
    if (hp <= 0) this._killAlly(ally);
  }

  // 魔王影子大招特效：打在目標身上的紫色光環+爆裂粒子，跟其他暗影主題特效同一種
  // 配色（0x9d6bff），純視覺表現「這一下比較重」，不含任何額外判定邏輯。
  _playBossSkillFx(tx, ty) {
    this.scene.spawnGlowRing(tx, ty, 'fx_bossdeath', 0x9d6bff, 0.35, 2.0, 260);
    this.scene.spawnBurstFx(tx, ty, 0x9d6bff, 10, 'fx_crit', 140);
  }

  _killAlly(ally) {
    const idx = this.allies.indexOf(ally);
    if (idx >= 0) this.allies.splice(idx, 1);
    this.scene.spawnBurstFx(ally.x, ally.y, 0x9d6bff, 10, 'fx_crit', 110);
    this.scene.spawnKillFx(ally.x, ally.y);
    ally.destroy();
  }
}
