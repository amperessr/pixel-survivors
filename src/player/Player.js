import { clamp, dist } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { getEquipped } from '../managers/SaveManager.js';

const PLAYER_BASE_SCALE = 0.5;
// 玩家（含頭頂血條、龍之翼/龍之光環等身上的遺物視覺）改用固定高深度，不再用
// y 座標排序——之前用 y 排序時，任何在玩家下方（y 較大）的怪物/經驗寶石都會
// 蓋住翅膀和光環，被怪群包圍時遺物視覺整個被埋住，看起來就像「遺物沒顯示在身上」。
// 數值取在拾取物深度（HealthPackSystem.PICKUP_DEPTH = 5000000）之下一點，
// 血包/磁鐵仍然永遠畫在最上層。
export const PLAYER_DEPTH = 4999000;
const AUTO_PILOT_AVOID_RADIUS = 160; // 自動戒指：怪物進入這個範圍就會被當成威脅開始閃避
const AUTO_PILOT_DANGER_RADIUS = 90; // 自動戒指：怪物貼近到這個範圍內才會無條件優先逃命（範圍外優先去吃拾取物）
// 魔王體型大、接觸傷害判定半徑也大（見 Boss.js 的 BOSS_TOUCH_RADIUS=100），
// 一般小怪的閃避半徑貼著魔王走還是會被碰到——魔王的閃避/危險半徑要抓更大，
// 且威脅權重加倍，確保自動駕駛寧可繞遠路也不會一路衝去撞魔王。
const AUTO_PILOT_BOSS_AVOID_RADIUS = 260;
const AUTO_PILOT_BOSS_DANGER_RADIUS = 150;

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

export const BASE_STATS = {
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
    this.sprite.setScale(PLAYER_BASE_SCALE);
    this.sprite.setCollideWorldBounds(false);
    // 碰撞圓圈用「原始貼圖尺寸的比例」算，而不是寫死數字——'balanced' 現在改用
    // 玩家提供的藍色史萊姆正式美術圖，是緊貼裁切過的圖（64x51，沒有程式產生貼圖
    // 那圈留白），圓心/半徑要跟著實際圖片大小重新算，不然碰撞判定會偏移。
    const texW = this.sprite.frame.width, texH = this.sprite.frame.height;
    const bodyRadius = Math.min(texW, texH) * 0.42;
    this.sprite.body.setCircle(bodyRadius, texW / 2 - bodyRadius, texH / 2 - bodyRadius);
    this.sprite.setDepth(PLAYER_DEPTH);

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
    let mvx = 0, mvy = 0;
    if (this.keys.up.isDown) mvy -= 1;
    if (this.keys.down.isDown) mvy += 1;
    if (this.keys.left.isDown) mvx -= 1;
    if (this.keys.right.isDown) mvx += 1;
    if (this._hasRing('ring_auto')) {
      // 自動戒指：玩家手動操作永遠優先——只要有按方向鍵就聽玩家的，
      // 並記錄最後一次手動輸入時間；放開按鍵後 1 秒內維持不動（讓玩家
      // 有喘息空間、不會手一放開就被自動駕駛拉走），滿 1 秒才恢復自動模式。
      if (mvx !== 0 || mvy !== 0) {
        vx = mvx; vy = mvy;
        this._lastManualInputAt = time;
      } else if (time - (this._lastManualInputAt || 0) >= 1000) {
        ({ vx, vy } = this._computeAutoPilotDirection());
      }
    } else {
      vx = mvx; vy = mvy;
    }
    const len = Math.hypot(vx, vy) || 1;
    this.sprite.body.setVelocity((vx / len) * speed, (vy / len) * speed);

    if (vx !== 0) this.sprite.setFlipX(vx < 0);

    if (Phaser.Input.Keyboard.JustDown(this.keys.dash) && time > this.dashCooldownUntil && (vx !== 0 || vy !== 0)) {
      this._dash(time);
    }

    this._updateSquishAnim(time, vx !== 0 || vy !== 0);
    this._updateHeadBar();
    this.sprite.setDepth(PLAYER_DEPTH);
  }

  // 兩個戒指欄任一格裝著指定戒指就算「有裝備」（目前只有回血/自動兩種戒指，
  // 分別固定佔用 ring1/ring2，但這裡用值去比對，不寫死欄位，未來戒指種類變多
  // 也不用改這裡）。
  _hasRing(ringId) {
    const equipped = getEquipped();
    return equipped.ring1 === ringId || equipped.ring2 === ringId;
  }

  // 自動戒指：代替玩家自動移動。以「前往血包/磁鐵優先，經驗寶石其次」為主要
  // 驅動方向，同時把怪物/魔王的閃避向量混進去，讓路徑自然繞開威脅，而不是
  // 完全無視怪物筆直穿過去；貼到危險距離內時閃避權重會加重、逼近的力道相對
  // 變小，體感上就像「一邊慢慢靠近目標、一邊繞開怪物」。完全沒有拾取物目標時
  // 才單純閃避／原地待機。
  _computeAutoPilotDirection() {
    const px = this.sprite.x, py = this.sprite.y;
    const avoid = this._computeThreatAvoidance(px, py);

    const target = this._findPriorityPickup();
    if (target) {
      const d = dist(px, py, target.x, target.y) || 1;
      let tx = (target.x - px) / d, ty = (target.y - py) / d;
      if (avoid.threatCount > 0) {
        // 危險距離內閃避權重加重，確保就算目標剛好在怪物後面，也不會硬衝過去
        // 被打到；範圍內但還不危險時閃避權重較輕，路徑只是稍微偏一點、還是會
        // 持續朝目標靠近，就是「慢慢接近」的手感。
        const avoidWeight = avoid.dangerCount > 0 ? 1.6 : 0.7;
        tx += avoid.x * avoidWeight;
        ty += avoid.y * avoidWeight;
      }
      const len = Math.hypot(tx, ty) || 1;
      return { vx: tx / len, vy: ty / len };
    }

    if (avoid.threatCount > 0) return { vx: avoid.x, vy: avoid.y };
    return { vx: 0, vy: 0 };
  }

  // 算出遠離所有威脅（一般小怪＋魔王）的加總方向向量，越近權重越高；魔王的
  // 閃避半徑比小怪大很多、權重也加倍，避免自動駕駛只顧著閃小怪卻一路把玩家
  // 帶去撞魔王（魔王接觸傷害的判定半徑本來就比小怪大上不少）。
  _computeThreatAvoidance(px, py) {
    let x = 0, y = 0, threatCount = 0, dangerCount = 0;
    if (this.scene.enemySystem && this.scene.enemySystem.pool) {
      this.scene.enemySystem.pool.forEachActive((e) => {
        const d = dist(px, py, e.x, e.y);
        if (d > 0 && d < AUTO_PILOT_AVOID_RADIUS) {
          const w = (AUTO_PILOT_AVOID_RADIUS - d) / AUTO_PILOT_AVOID_RADIUS;
          x += ((px - e.x) / d) * w;
          y += ((py - e.y) / d) * w;
          threatCount++;
          if (d < AUTO_PILOT_DANGER_RADIUS) dangerCount++;
        }
      });
    }
    if (this.scene.boss && this.scene.boss.alive) {
      const b = this.scene.boss.sprite;
      const d = dist(px, py, b.x, b.y);
      if (d > 0 && d < AUTO_PILOT_BOSS_AVOID_RADIUS) {
        const w = (AUTO_PILOT_BOSS_AVOID_RADIUS - d) / AUTO_PILOT_BOSS_AVOID_RADIUS;
        x += ((px - b.x) / d) * w * 2;
        y += ((py - b.y) / d) * w * 2;
        threatCount++;
        if (d < AUTO_PILOT_BOSS_DANGER_RADIUS) dangerCount++;
      }
    }
    return { x, y, threatCount, dangerCount };
  }

  // 找優先拾取目標：血包／磁鐵優先於經驗寶石。重要修正：以前是三種拾取物混在
  // 一起純比距離，但經驗寶石多到幾乎隨時都有一顆離玩家最近，血包/磁鐵幾乎永遠
  // 選不到、形同虛設，玩家會覺得「自動戒指不會主動去找血包/磁鐵」——現在先只
  // 在血包/磁鐵的池子裡找最近的一個，兩者都沒有時才退而求其次去撿經驗寶石。
  _findPriorityPickup() {
    const px = this.sprite.x, py = this.sprite.y;
    let best = null, bestDist = Infinity;
    const scan = (pool) => {
      if (!pool) return;
      pool.forEachActive((img) => {
        const d = dist(px, py, img.x, img.y);
        if (d < bestDist) { bestDist = d; best = img; }
      });
    };
    scan(this.scene.healthPackSystem && this.scene.healthPackSystem.pool);
    scan(this.scene.magnetSystem && this.scene.magnetSystem.pool);
    if (best) return best;

    scan(this.scene.enemySystem && this.scene.enemySystem.expGemPool);
    return best;
  }

  // 史萊姆的 Q 彈動畫：只有一張靜態圖，沒有影格可以切換，改用「擠壓/拉伸」
  // 直接算縮放做出彈跳感——移動時彈得快、待機時緩慢呼吸，讓角色不會像貼紙
  // 一樣呆站在原地。用 sin 波即時算，不用額外的 tween 物件，跟衝刺/受傷閃白
  // 這些也會動到 sprite 的效果互不干擾。
  _updateSquishAnim(time, moving) {
    const freq = moving ? 260 : 900;
    const amp = moving ? 0.12 : 0.05;
    const wave = Math.sin((time / freq) * Math.PI * 2);
    const squashY = 1 + wave * amp;
    const squashX = 1 - wave * amp * 0.6; // 體積守恆感：縱向拉長時橫向跟著收窄一點
    this.sprite.setScale(PLAYER_BASE_SCALE * squashX, PLAYER_BASE_SCALE * squashY);
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
    // 改用百分比減傷（防禦100＝減傷50%，200＝66%，遞減收斂但不會到100%）——
    // 原本的固定值減免（amount - defense*0.5）在敵人傷害隨時間倍率成長後，
    // 防禦力的固定減免會被稀釋到幾乎歸零，後期防禦類裝備/角色形同虛設；
    // 百分比公式讓防禦力的「相對」防禦力始終有意義，不受時間倍率稀釋。
    const mitigated = Math.max(1, amount * (100 / (100 + this.stats.defense)));
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
