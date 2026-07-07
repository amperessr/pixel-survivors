import Player from '../player/Player.js';
import MapGenerator from '../systems/MapGenerator.js';
import EnemySystem from '../enemy/EnemySystem.js';
import HealthPackSystem from '../systems/HealthPackSystem.js';
import MagnetSystem from '../systems/MagnetSystem.js';
import WeaponSystem from '../weapons/WeaponSystem.js';
import Boss from '../boss/Boss.js';
import { WEAPON_KNOCKBACK } from '../weapons/WeaponData.js';
import { PASSIVE_IDS } from '../skills/PassiveData.js';
import { RELICS } from '../relics/RelicData.js';
import { EQUIPMENT_DATA } from '../equipment/EquipmentData.js';
import { getEquipped, addGold, setBestScore, setCheckpointStage } from '../managers/SaveManager.js';
import { dist } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { textStyle } from '../utils/TextStyle.js';

// Boss 固定在第 5、10、15...關「一開始」就出現，用關卡數（不是存活分鐘數）反推
// 觸發時間點——直接拿「每 5 分鐘」換算會因為關卡從第 1 關（而不是第 0 關）開始算，
// 跟關卡顯示差了一整關，變成王在第 6、11、16...關才出現，慢了一拍。
const BOSS_STAGE_INTERVAL = 5;
// Boss 現在體型大幅放大，命中/接觸判定半徑也要跟著放大，這裡統一定義方便调整
const BOSS_HIT_RADIUS = 46;   // 子彈命中 Boss 的判定半徑
const BOSS_TOUCH_RADIUS = 76; // Boss 對玩家造成接觸傷害的判定半徑
const BOSS_SAW_RADIUS = 76;   // 鋸片對 Boss 造成傷害的判定半徑

export default class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  init(data) {
    this.characterId = data.characterId || 'balanced';
    // 存檔點：從主選單選擇「當前關卡」或「往前十關」時會帶入 startStage，
    // 讓這場遊戲一開局就等同於「已經存活到第 N 關」的難度（怪物強度／Boss 生成
    // 時間都是照存活分鐘數算的，見下面 create() 怎麼往回推 startTime）。
    // 沒有帶值就是預設從第 1 關開始（一般模式）。
    this.startStage = Math.max(1, Math.floor(data.startStage || 1));
    // 除錯用：暫時印出主選單實際傳進來的 startStage，方便排查「點第一關卻從別的關卡開始」的問題，
    // 之後確認沒問題了可以整段拿掉。
    console.log(`[STAGE] init() 收到 data.startStage=${data.startStage}　最終 this.startStage=${this.startStage}`);
  }

  create() {
    this.cameras.main.setBackgroundColor('#4fa851');
    this.physics.world.setBounds(-1e7, -1e7, 2e7, 2e7);

    this.player = new Player(this, 0, 0, this.characterId);
    this._applyEquipmentBonuses();
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
    this.cameras.main.setZoom(2.1); // 鏡頭拉近，讓角色與怪物看起來更清楚、不會太小太遠

    this.map = new MapGenerator(this);
    this.enemySystem = new EnemySystem(this, this.player);
    this.healthPackSystem = new HealthPackSystem(this, this.player);
    this.magnetSystem = new MagnetSystem(this, this.player);
    this.weaponSystem = new WeaponSystem(this, this.player, this.enemySystem);

    this.bossBoltGroup = this.physics.add.group();
    this.boss = null;

    // 存檔點：把 startTime 往回推，讓「存活分鐘數」（怪物強度／Boss 生成都是照這個算的）
    // 從一開局就等於 startStage 對應的關卡數，而不用真的重新玩過前面的關卡。
    const elapsedAtStartMs = (this.startStage - 1) * 60000;
    this.startTime = this.time.now - elapsedAtStartMs;
    // 補上「理論上應該已經打過幾隻王」的計數，讓黑藍/血色紅龍的輪替從這關開始算才對；
    // 下一隻王訂在下一個「第 5 的倍數」關卡一開始的時間點，不會因為往回推了 startTime
    // 就讓好幾隻王在一開局同一瞬間排隊出現。
    this.bossSpawnCount = Math.floor((this.startStage - 1) / BOSS_STAGE_INTERVAL);
    this.nextBossAt = ((this.bossSpawnCount + 1) * BOSS_STAGE_INTERVAL - 1) * 60000;

    this.killCount = 0;
    this.paused = false;
    this.escPaused = false; // 僅代表玩家手動按 ESC 暫停（用於顯示「已暫停」遮罩）
    this.dragonAuraActive = false; // 是否已接受龍之光環（永久跟隨光環視覺開關）
    this.dragonWingsActive = false; // 是否已接受龍之翼（永久跟隨風之尾跡視覺開關）
    this._pendingRelic = null; // 擊敗 Boss 順便升級時，排隊等升級選單關閉後再跳遺物選擇視窗
    // 重要修正：Phaser 同一個 GameScene 物件會在好幾場遊戲之間重複使用（scene.start()
    // 只會重新呼叫 init()/create()，不會真的整個重建），這幾個旗標如果沒有在這裡
    // 重設，會直接沿用「上一場遊戲死亡時」留下的值——這正是「這場遊戲結束後，下一場
    // 玩家死亡不會結算」、「下一場撿經驗值完全沒反應」的根本原因：onGainExp()／
    // onPlayerDeath() 等一大堆地方都在最前面檢查 `if (this.gameEnded) return`，
    // 上一場死亡時已經把它設成 true，沒重設的話下一場一開局就已經是「遊戲已結束」的狀態。
    this.gameEnded = false;
    this._wentToGameOver = false;
    this._lastCheckpointStage = 0;

    // 滑鼠瞄準方向（用於飛刀等以滑鼠為準的武器，此處以世界座標更新提供 UI 之用）
    this.input.on('pointermove', () => {});

    // ESC 暫停
    this.input.keyboard.on('keydown-ESC', () => this._togglePause());

    this.scene.launch('UIScene', { gameScene: this });

    // 玩家把網頁直接關掉、重新整理、或整個瀏覽器跳出時，遊戲不會有機會正常跑到
    // GameOverScene 去結算——這裡額外掛上 beforeunload/pagehide，離開前立刻把
    // 目前的擊殺數換算成金幣、分數存進歷史最佳，不用等玩家「正常死亡」才存檔。
    // 只在遊戲還沒正常結束時才存一次（`this.gameEnded` 為 false），避免跟
    // GameOverScene 正常結算的那次重複計算；`_exitSaveDone` 則是防止
    // beforeunload 跟 pagehide 剛好同時觸發時被重複執行兩次。
    this._exitSaveDone = false;
    this._saveOnExit = () => {
      if (this.gameEnded || this._exitSaveDone) return;
      this._exitSaveDone = true;
      try {
        addGold(this.killCount);
        const elapsed = this.getElapsedSeconds();
        const score = this.killCount * 10 + this.player.level * 50 + Math.floor(elapsed * 0.5);
        setBestScore(score);
        // 關卡進度原本只有每滿 5 關才存一次存檔點，玩家在中間關卡離開的話會漏掉
        // 這幾關的進度，這裡連同金幣/分數一起把「目前關卡」存下去（只會往前推進，
        // 不會蓋掉更高的紀錄，見 setCheckpointStage()）。
        setCheckpointStage(this.getStage());
      } catch (err) {
        console.error('[GameScene] 離開前存檔失敗：', err);
      }
    };
    window.addEventListener('beforeunload', this._saveOnExit);
    window.addEventListener('pagehide', this._saveOnExit);
    // 手機瀏覽器（尤其是被切到背景、被系統直接砍掉分頁時）pagehide/beforeunload
    // 不一定每次都會確實觸發，額外掛 visibilitychange 當保險。因為 `_exitSaveDone`
    // 這個旗標只會在「開新的一局」時重置，同一局遊戲裡不管切幾次分頁都只會
    // 存一次，不會被重複觸發、也不會被拿來重複洗金幣。
    this._onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') this._saveOnExit();
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    this.events.on('shutdown', () => {
      audioManager.stopBgm();
      window.removeEventListener('beforeunload', this._saveOnExit);
      window.removeEventListener('pagehide', this._saveOnExit);
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    });

    audioManager.startBgm();

    // 開局不再固定送火球術，改成跳出選單讓玩家自己選一個起始技能——
    // 遊戲維持暫停狀態，直到玩家選好為止（見 resumeFromStartSkillChoice()）。
    // `_awaitingStartSkill` 這面旗標是為了擋掉這段期間按 ESC：如果沒擋，_togglePause()
    // 會把 paused 誤解成一般 ESC 暫停而提早恢復運作，選單卻還蓋在畫面上、武器也還沒選。
    this._awaitingStartSkill = true;
    this.paused = true;
    this.physics.world.pause();
    this.scene.launch('StartSkillScene', { gameScene: this });
  }

  resumeFromStartSkillChoice() {
    if (this.gameEnded) return;
    this._awaitingStartSkill = false;
    this.paused = false;
    this.physics.world.resume();
    this.player.clearBankedInput();
  }

  // 讀取存檔裡目前裝備的五個欄位（武器/頭盔/衣服/褲子/鞋子），
  // 把對應的數值加成疊加到玩家身上——只在開局套用一次，之後升級/被動/遺物
  // 都是在這個基礎上再疊加，彼此不衝突。
  _applyEquipmentBonuses() {
    const equipped = getEquipped();
    const stats = this.player.stats;
    Object.values(equipped).forEach((itemId) => {
      if (!itemId || !EQUIPMENT_DATA[itemId]) return;
      const bonus = EQUIPMENT_DATA[itemId].bonus || {};
      if (bonus.attack) stats.attack += bonus.attack;
      if (bonus.defense) stats.defense += bonus.defense;
      if (bonus.moveSpeed) stats.moveSpeed += bonus.moveSpeed;
      if (bonus.maxHp) {
        stats.maxHp += bonus.maxHp;
        this.player.hp += bonus.maxHp; // 生命上限提升的部分直接補滿，不用讓玩家「掉血」
      }
    });
  }

  update(time, delta) {
    // 死亡監控放在最前面、不受 this.paused 影響——onPlayerDeath() 本身就會把
    // paused 設成 true 來凍結玩法，如果這段被 paused 擋在後面，下面「血量歸零
    // 滿 5 秒還沒結束遊戲」的保底計時器就永遠不會被執行到。
    // 安全網：不管 _update() 內部是否有例外被下面的 try/catch 吃掉，
    // 只要偵測到玩家血量已經歸零但遊戲還沒結束，就直接強制觸發死亡流程。
    // 這個呼叫本身也包 try/catch——萬一 onPlayerDeath() 內部真的有什麼漏網之魚，
    // 至少不會讓整個 update() 迴圈跟著掛掉，下一幀還有機會再試一次。
    if (this.player && this.player.hp <= 0) {
      if (!this._hpZeroSince) this._hpZeroSince = time;
      if (!this.gameEnded) {
        try {
          this.onPlayerDeath();
        } catch (err) {
          console.error('[GameScene] onPlayerDeath() 發生未預期錯誤：', err);
        }
      }
      // 保底中的保底：不管上面死亡流程有沒有正常跑完（動畫卡住、選單忘了關...），
      // 血量歸零超過 5 秒就不演了，直接強制切到結算畫面，玩家絕對不會卡在
      // 原地動彈不得超過 5 秒。
      if (time - this._hpZeroSince > 5000) {
        this._forceGameOver();
      }
      return;
    }
    this._hpZeroSince = null;

    if (this.paused) return;
    // 防呆：任何未預期的例外都只印出錯誤並跳過這一幀，而不是讓 Phaser 的
    // update 迴圈整個中斷、畫面卡住不動（Boss 那個卡死 bug就是活生生的例子，
    // 這裡多一層保護，以後就算有新的類似疏漏也不會直接讓整個遊戲當掉）。
    try {
      this._update(time, delta);
    } catch (err) {
      console.error('[GameScene] update() 發生未預期錯誤，已跳過本幀：', err);
    }
  }

  _update(time, delta) {

    this.player.update(time, delta);
    this.map.update(this.player.sprite.x, this.player.sprite.y);

    // 每滿 5 關就記錄一次存檔點（只會往前推進，見 SaveManager.setCheckpointStage）
    const stage = this.getStage();
    if (stage % 5 === 0 && stage !== this._lastCheckpointStage) {
      this._lastCheckpointStage = stage;
      setCheckpointStage(stage);
    }

    const elapsedMin = (time - this.startTime) / 60000;
    this.enemySystem.setDifficultyMinutes(elapsedMin);
    this.enemySystem.update(time, delta);
    this.healthPackSystem.update(time);
    this.magnetSystem.update(time);
    this.weaponSystem.update(time, delta);

    this._updateCollisions(time);

    if (this.boss) {
      this.boss.update(time, delta);
    } else if (time - this.startTime > this.nextBossAt) {
      // 每 5 關（第 5、10、15...關）出現一隻 Boss，四種型態輪流出現：
      // 黑藍巨龍 → 血色紅龍 → 惡魔王 → 樹王 → 黑藍巨龍……依序循環
      const BOSS_ROTATION = ['blue', 'red', 'demon', 'treant'];
      const bossType = BOSS_ROTATION[this.bossSpawnCount % BOSS_ROTATION.length];
      this.bossSpawnCount++;
      this.nextBossAt = ((this.bossSpawnCount + 1) * BOSS_STAGE_INTERVAL - 1) * 60000;
      this.boss = new Boss(this, this.player, elapsedMin, bossType, this.bossSpawnCount);
    }

    this.bossBoltGroup.children.iterate((bolt) => {
      if (!bolt || !bolt.active) return;
      if (dist(bolt.x, bolt.y, this.player.sprite.x, this.player.sprite.y) < 16) {
        const died = this.player.takeDamage(bolt.getData('dmg'), time);
        bolt.destroy();
        if (died) this.onPlayerDeath();
      }
    });

    this._updateSuperSaiyanAura(time);
    this._updateDragonAura(time);
    this._updateDragonWings(time);
  }

  // 統一處理武器投射物 / 鋸片 對敵人與 Boss 的碰撞
  _updateCollisions(time) {
    const stats = this.player.stats;

    this.weaponSystem.projectilePool.forEachActive((p) => {
      if (!p.active) return;
      const kind = p.getData('kind');
      if (kind === 'fireball') this._handleFireballHit(p, stats);
      else if (kind === 'lightning') this._handleLightningHit(p, stats);
      else if (kind === 'knife') this._handleKnifeHit(p, stats);
    });

    this._handleSawbladeHits(time, stats);
  }

  // 火球：碰到任一目標即在原地引爆一次，對範圍內所有敵人/Boss 造成傷害；
  // 用 'exploded' 旗標避免同一顆火球在範圍內停留多幀時重複引爆
  _handleFireballHit(p, stats) {
    if (p.getData('exploded')) return;
    const aoe = p.getData('aoe');
    const evolved = p.getData('evolved');
    let triggered = false;
    this.enemySystem.queryNear(p.x, p.y, 14, (e) => {
      if (!triggered && dist(p.x, p.y, e.x, e.y) <= 14) triggered = true;
    });
    if (!triggered && this.boss && this.boss.alive && dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= BOSS_HIT_RADIUS) {
      triggered = true;
    }
    if (!triggered) return;

    p.setData('exploded', true);
    const kb = WEAPON_KNOCKBACK.fireball;
    this.enemySystem.queryNear(p.x, p.y, aoe, (e) => {
      if (dist(p.x, p.y, e.x, e.y) <= aoe) {
        this.enemySystem.damageEnemy(e, p.getData('dmg'), stats.critRate, stats.critDmg, {
          fromX: p.x, fromY: p.y, force: kb.force, duration: kb.duration,
        });
      }
    });
    if (this.boss && this.boss.alive && dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= aoe) {
      this.boss.takeDamage(p.getData('dmg'), stats.critRate, stats.critDmg);
    }
    this.spawnImpactFx(p.x, p.y, 'fireball', aoe, evolved);

    const pierce = p.getData('pierce') || 0;
    if (pierce > 0) {
      p.setData('pierce', pierce - 1);
      p.setData('exploded', false); // 允許穿透後在下一個目標再次引爆
    } else {
      this.weaponSystem.projectilePool.free(p);
    }
  }

  // 飛刀：單體傷害，用 hitSet 記錄已命中對象，避免同一把刀在多幀內對同一敵人重複造成傷害
  _handleKnifeHit(p, stats) {
    const hitSet = p.getData('hitSet');
    const evolved = p.getData('evolved');
    let target = null;
    this.enemySystem.queryNear(p.x, p.y, 14, (e) => {
      if (target || hitSet.has(e)) return;
      if (dist(p.x, p.y, e.x, e.y) <= 14) target = e;
    });
    let hitBoss = false;
    if (!target && this.boss && this.boss.alive && !hitSet.has(this.boss) &&
        dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= BOSS_HIT_RADIUS) {
      hitBoss = true;
    }
    if (!target && !hitBoss) return;

    const kb = WEAPON_KNOCKBACK.knife;
    if (hitBoss) {
      hitSet.add(this.boss);
      this.boss.takeDamage(p.getData('dmg'), stats.critRate, stats.critDmg);
      this.spawnImpactFx(this.boss.sprite.x, this.boss.sprite.y, 'knife', 0, evolved);
    } else {
      hitSet.add(target);
      this.enemySystem.damageEnemy(target, p.getData('dmg'), stats.critRate, stats.critDmg, {
        fromX: p.x, fromY: p.y, force: kb.force, duration: kb.duration,
      });
      this.spawnImpactFx(p.x, p.y, 'knife', 0, evolved);
    }

    const pierce = p.getData('pierce') || 0;
    if (pierce > 0) {
      p.setData('pierce', pierce - 1);
    } else {
      this.weaponSystem.projectilePool.free(p);
    }
  }

  // 雷電：用 hitSet 記錄已命中對象，命中後嘗試往附近尚未命中的目標跳躍
  _handleLightningHit(p, stats) {
    const hitSet = p.getData('hitSet');
    const evolved = p.getData('evolved');
    const range = p.getData('range');
    let target = null;
    this.enemySystem.queryNear(p.x, p.y, 14, (e) => {
      if (target || hitSet.has(e)) return;
      if (dist(p.x, p.y, e.x, e.y) <= 14) target = e;
    });
    let targetIsBoss = false;
    if (!target && this.boss && this.boss.alive && !hitSet.has(this.boss) &&
        dist(p.x, p.y, this.boss.sprite.x, this.boss.sprite.y) <= BOSS_HIT_RADIUS) {
      targetIsBoss = true;
    }
    if (!target && !targetIsBoss) return;

    const hitX = targetIsBoss ? this.boss.sprite.x : target.x;
    const hitY = targetIsBoss ? this.boss.sprite.y : target.y;
    const kb = WEAPON_KNOCKBACK.lightning;

    if (targetIsBoss) {
      hitSet.add(this.boss);
      this.boss.takeDamage(p.getData('dmg'), stats.critRate, stats.critDmg);
    } else {
      hitSet.add(target);
      this.enemySystem.damageEnemy(target, p.getData('dmg'), stats.critRate, stats.critDmg, {
        fromX: p.x, fromY: p.y, force: kb.force, duration: kb.duration,
      });
    }
    this.spawnImpactFx(hitX, hitY, 'lightning', 0, evolved);

    const chainsLeft = p.getData('chains') - 1;
    if (chainsLeft > 0) {
      const next = this._findNearestExcluding(hitX, hitY, hitSet, range);
      if (next) {
        p.setData('chains', chainsLeft);
        p.setPosition(hitX, hitY);
        const ang = Math.atan2(next.y - hitY, next.x - hitX);
        p.body.setVelocity(Math.cos(ang) * 420, Math.sin(ang) * 420);
        p.setData('expireAt', this.time.now + 500);
        // 電光連鎖視覺：在兩個目標之間畫出一道鋸齒狀電弧，就像史提克彈簧刀的連鎖閃電
        this.spawnChainLightningFx(hitX, hitY, next.x, next.y, evolved);
        return;
      }
    }
    this.weaponSystem.projectilePool.free(p);
  }

  // 鋸片：持續環繞傷害，各自用 lastHit 記錄每個目標的命中冷卻
  _handleSawbladeHits(time, stats) {
    const kb = WEAPON_KNOCKBACK.sawblade;
    for (const saw of this.weaponSystem.sawbladeSprites) {
      const dmg = this.weaponSystem.getSawbladeDamage();
      const evolved = this.weaponSystem.isEvolved('sawblade');
      const lastHit = saw.getData('lastHit');
      this.enemySystem.queryNear(saw.x, saw.y, 16, (e) => {
        if (!e.active) return;
        if (dist(saw.x, saw.y, e.x, e.y) > 16) return;
        const last = lastHit.get(e) || 0;
        if (time - last < 300) return;
        lastHit.set(e, time);
        this.enemySystem.damageEnemy(e, dmg, stats.critRate, stats.critDmg, {
          fromX: saw.x, fromY: saw.y, force: kb.force, duration: kb.duration,
        });
        this.spawnImpactFx(e.x, e.y, 'sawblade', 0, evolved);
      });
      if (this.boss && this.boss.alive && dist(saw.x, saw.y, this.boss.sprite.x, this.boss.sprite.y) < BOSS_SAW_RADIUS) {
        const last = lastHit.get(this.boss) || 0;
        if (time - last >= 300) {
          lastHit.set(this.boss, time);
          this.boss.takeDamage(dmg, stats.critRate, stats.critDmg);
          this.spawnImpactFx(this.boss.sprite.x, this.boss.sprite.y, 'sawblade', 0, evolved);
        }
      }
    }
  }

  _findNearestExcluding(x, y, excludeSet, range) {
    let best = null, bestD = Infinity;
    this.enemySystem.queryNear(x, y, range, (e) => {
      if (excludeSet.has(e)) return;
      const d = dist(x, y, e.x, e.y);
      if (d < range && d < bestD) { bestD = d; best = e; }
    });
    return best;
  }

  registerKill() { this.killCount++; }

  onGainExp(amount) {
    if (this.gameEnded) return false; // 遊戲已經結束就不要再處理升級（避免死後還跳升級選單）
    // 除錯用：暫時印出每次加經驗值前後的數值，方便排查「撿寶石沒反應」的問題，
    // 之後確認沒問題了可以整段拿掉。
    const expBefore = this.player.exp;
    const leveledUp = this.player.gainExp(amount);
    console.log(`[EXP] +${amount}　exp: ${expBefore} -> ${this.player.exp} / ${this.player.expToNext}　lv=${this.player.level}`);
    if (leveledUp.length > 0) {
      audioManager.levelUp();
      this.spawnLevelUpFx(this.player.sprite.x, this.player.sprite.y);
      this._openLevelUp();
      return true;
    }
    return false;
  }

  _openLevelUp() {
    if (this.gameEnded) return;
    this.paused = true;
    this.physics.world.pause();
    this.scene.launch('LevelUpScene', {
      gameScene: this,
      weaponSystem: this.weaponSystem,
    });
  }

  resumeFromLevelUp() {
    // 重要防呆：玩家死亡的同一時間點有可能剛好也觸發升級（例如同歸於盡打死 Boss），
    // 如果這裡沒檢查 gameEnded，死亡演出播到一半時升級選單被關掉，會把
    // physics.world 恢復運作、this.paused 設回 false，讓怪物的擊退/碰撞
    // 又能推著「已經死亡」的玩家滑動，而且遊戲永遠不會真的結束——
    // 這正是「死亡時人物會往一個方向不停前進、無法結束遊戲」的根本原因。
    if (this.gameEnded) return;
    this.paused = false;
    this.physics.world.resume();
    this.player.clearBankedInput();
    // 若這次升級是「擊敗 Boss 拿到經驗值」順便觸發的，等升級選單關掉後
    // 再接著跳遺物選擇視窗，避免兩個選單同時疊在畫面上
    if (this._pendingRelic) {
      const relic = this._pendingRelic;
      this._pendingRelic = null;
      this._openRelicChoicePrompt(relic);
    }
  }

  // Boss 死亡時由 Boss._die() 呼叫，帶入這隻 Boss 的型態與對應遺物 id
  onBossDefeated(bossType, relicId) {
    if (this.gameEnded) return; // 玩家跟 Boss 同時陣亡就不用再處理擊殺獎勵了
    this.boss = null;
    this.registerKill();
    // 慶祝特效一定會播放，不受任何選單開關影響
    this.spawnSuperSaiyanAura();

    const relic = RELICS[relicId];
    // 每個遺物只能拿一次：如果玩家已經擁有這個遺物，就不用再跳出選擇視窗詢問了
    const alreadyOwned = relic && relic.hasIt(this.player);

    const leveledUp = this.onGainExp(30);
    if (relic && !alreadyOwned) {
      if (leveledUp) {
        // 升級選單已經在暫停/開啟中，先排隊，等它關閉後再跳遺物選擇視窗
        this._pendingRelic = relic;
      } else {
        this._openRelicChoicePrompt(relic);
      }
    }
  }

  _openRelicChoicePrompt(relic) {
    if (this.gameEnded) return;
    this.paused = true;
    this.physics.world.pause();
    this.scene.launch('RelicChoiceScene', { gameScene: this, relic });
  }

  resumeFromRelicChoice() {
    // 跟 resumeFromLevelUp() 一樣的防呆：死亡後就不要再把物理世界恢復運作
    if (this.gameEnded) return;
    this.paused = false;
    this.physics.world.resume();
    this.player.clearBankedInput();
  }

  // 拿到遺物時的通知橫幅：畫面正中央短暫顯示「獲得遺物／xxx」，
  // 跟升級、進化那些提示走同一種「淡入停留→淡出」的節奏，讓玩家清楚知道剛剛拿到了什麼。
  announceRelicObtained(relicName) {
    const w = this.scale.width, h = this.scale.height;
    const container = this.add.container(w / 2, h * 0.32).setScrollFactor(0).setDepth(31000).setAlpha(0);

    const title = this.add.text(0, -6, '獲得遺物', textStyle({
      fontSize: '30px', color: '#cfe9ff',
    })).setOrigin(0.5);
    const name = this.add.text(0, 38, relicName, textStyle({
      fontSize: '52px', color: '#ffe066',
    })).setOrigin(0.5);
    container.add([title, name]);

    this.tweens.add({
      targets: container,
      alpha: 1,
      duration: 260,
      yoyo: false,
      onComplete: () => {
        this.tweens.add({
          targets: container, alpha: 0, duration: 500, delay: 1500,
          onComplete: () => container.destroy(),
        });
      },
    });
  }

  onPlayerDeath() {
    if (this.gameEnded) return;
    this.gameEnded = true;
    this.paused = true;

    // 立刻歸零玩家的移動速度並直接停用整個物理身體——這是「死亡瞬間會一直往
    // 一個方向衝刺停不下來」的直接解法：如果死亡當下玩家正在衝刺/移動，
    // 物理身體上還留著速度，下面雖然會呼叫 physics.world.pause() 讓整個物理
    // 世界凍結，但這裡先手動清零＋停用身體，就算後面 pause() 那一步意外沒執行到、
    // 或是之後物理世界不知道為什麼被恢復運作，這個身體本身也不會再被引擎更新位置，
    // 是最徹底、最不依賴其他狀態的解法。
    if (this.player && this.player.sprite && this.player.sprite.body) {
      this.player.sprite.body.setVelocity(0, 0);
      this.player.sprite.body.enable = false;
    }

    try {
      audioManager.stopBgm();
      audioManager.gameOver();
      this.physics.world.pause();
      const px = this.player.sprite.x, py = this.player.sprite.y;
      this._spawnPlayerDeathExplosion(px, py);
      // 原地爆炸播完之後，畫面慢慢淡成黑幕，淡黑完成才真的切換到結算畫面，
      // 而不是像之前那樣一斷氣馬上跳畫面
      this.cameras.main.fade(1300, 0, 0, 0);
      this.time.delayedCall(1400, () => this._forceGameOver());
    } catch (err) {
      console.error('[GameScene] 死亡特效發生錯誤，直接切換到結算畫面：', err);
      this._forceGameOver();
    }
  }

  // 保底：不管死亡特效／淡黑效果發生什麼意外，這個函式一定要被呼叫到，而且只會
  // 真正執行一次——這是延續之前「血量歸零但畫面卡住不結束」的防呆精神。也被
  // update() 裡「血量歸零滿 5 秒還沒結束遊戲」的保底計時器呼叫，數值都重新現算，
  // 不依賴呼叫來源，確保無論卡在哪個環節都能正常結算。
  _forceGameOver() {
    if (this._wentToGameOver) return;
    this._wentToGameOver = true;
    const kills = this.killCount;
    const level = this.player ? this.player.level : 1;
    const elapsed = Math.floor((this.time.now - this.startTime) / 1000);
    // 死亡當下如果升級選單／遺物選擇視窗剛好開著（例如跟 Boss 同歸於盡），
    // 這兩個視窗不會自己關掉，會一直蓋在畫面最上層，看起來像是「遊戲卡住沒結束」，
    // 所以這裡強制把它們也一併關掉，確保一定會看到結算畫面。
    ['UIScene', 'LevelUpScene', 'RelicChoiceScene'].forEach((key) => {
      try { this.scene.stop(key); } catch (err) { console.error(`[GameScene] 關閉 ${key} 失敗：`, err); }
    });
    this.scene.start('GameOverScene', { kills, level, time: elapsed });
  }

  // 玩家死亡瞬間的原地爆炸特效：紅白兩色碎片＋擴散光環＋角色本體淡出放大消失，
  // 讓「死亡」這件事有足夠的視覺份量，而不是直接卡在原地一動也不動。
  _spawnPlayerDeathExplosion(x, y) {
    this.cameras.main.flash(220, 255, 90, 90);
    this.hitStop(140);
    this.spawnBurstFx(x, y, 0xff5a3d, 26, 'fx_flame', 230);
    this.spawnBurstFx(x, y, 0xffffff, 16, 'fx_crit', 170);
    const ring = this.add.image(x, y, 'fx_bossdeath').setDepth(30005).setScale(0.5).setTint(0xff5a3d);
    this.tweens.add({ targets: ring, scale: 3.6, alpha: 0, duration: 520, onComplete: () => ring.destroy() });

    if (this.player.sprite.active) {
      this.tweens.add({
        targets: this.player.sprite,
        alpha: 0,
        scaleX: this.player.sprite.scaleX * 1.6,
        scaleY: this.player.sprite.scaleY * 1.6,
        duration: 380,
      });
    }
  }

  _togglePause() {
    if (this.gameEnded || this._awaitingStartSkill) return;
    this.paused = !this.paused;
    this.escPaused = this.paused;
    if (this.paused) {
      this.physics.world.pause();
    } else {
      this.physics.world.resume();
      this.player.clearBankedInput();
    }
  }

  getElapsedSeconds() {
    return Math.floor((this.time.now - this.startTime) / 1000);
  }

  // 關卡系統：1 分鐘 = 1 關（從第 1 關開始），每 5 關（5、10、15...）是魔王關。
  // 這只是「顯示層」的換算，底層難度曲線／Boss 生成計時器都還是照原本的存活分鐘數走，
  // 兩者剛好對得上（每 5 分鐘一隻王 = 每 5 關一隻王），不用另外重寫一套邏輯。
  getStage() {
    return Math.floor(this.getElapsedSeconds() / 60) + 1;
  }

  isBossStage(stage = this.getStage()) {
    return stage % 5 === 0;
  }

  // ================= 特效輔助 =================
  // 通用「爆裂粒子」：從一個點往四周噴出好幾個小碎片，比單張淡出圖案更有份量感
  // 「打擊停頓」(hit stop)：短暫把物理世界的時間流速降到接近凍結，
  // 製造那種「這一拳很重」的手感，取代畫面震動（畫面震動容易讓人頭暈、
  // 也比較廉價，hit stop 是很多動作遊戲慣用的手法）。
  hitStop(duration = 70, scaleTo = 0.05) {
    if (this._hitStopUntil && this.time.now < this._hitStopUntil) return; // 短時間內不重疊觸發，避免疊加卡頓
    const prevScale = this.physics.world.timeScale;
    this.physics.world.timeScale = scaleTo;
    this._hitStopUntil = this.time.now + duration;
    this.time.delayedCall(duration, () => {
      this.physics.world.timeScale = prevScale;
    });
  }

  spawnBurstFx(x, y, color, count = 10, texture = 'fx_crit', baseSpeed = 90) {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = baseSpeed * (0.6 + Math.random() * 0.8);
      const particle = this.add.image(x, y, texture).setDepth(29998).setScale(0.35 + Math.random() * 0.25);
      if (color != null) particle.setTint(color);
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(ang) * speed,
        y: y + Math.sin(ang) * speed,
        alpha: 0,
        scale: 0.05,
        duration: 260 + Math.random() * 140,
        ease: 'Cubic.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }

  // 火焰餘燼：命中/爆炸後幾顆小火星緩緩往上飄散，很多其他遊戲的火屬性技能都有這種收尾效果
  spawnEmbersFx(x, y, count = 6, color = 0xffb066) {
    for (let i = 0; i < count; i++) {
      const ember = this.add.image(
        x + (Math.random() - 0.5) * 20,
        y + (Math.random() - 0.5) * 10,
        'fx_flame'
      ).setDepth(30002).setScale(0.15 + Math.random() * 0.15).setAlpha(0.85).setTint(color);
      ember.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: ember,
        y: ember.y - 30 - Math.random() * 20,
        x: ember.x + (Math.random() - 0.5) * 16,
        alpha: 0,
        duration: 500 + Math.random() * 300,
        ease: 'Sine.easeOut',
        onComplete: () => ember.destroy(),
      });
    }
  }

  // 發光外環：用疊加（ADD）混合模式做出「發光暈染」的效果，是很多遊戲元素技能的標準做法
  spawnGlowRing(x, y, texture, color, startScale, endScale, duration, depth = 29999) {
    const ring = this.add.image(x, y, texture).setDepth(depth).setScale(startScale).setAlpha(0.8).setTint(color);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: ring, scale: endScale, alpha: 0, duration, onComplete: () => ring.destroy() });
    return ring;
  }

  spawnCritFx(x, y) {
    const fx = this.add.image(x, y - 10, 'fx_crit').setDepth(30000).setScale(1.3);
    this.tweens.add({ targets: fx, y: y - 34, alpha: 0, scale: 1.9, duration: 380, onComplete: () => fx.destroy() });
    this.spawnBurstFx(x, y, 0xffe066, 5, 'fx_crit', 70);
  }

  // 傷害數字：一般傷害白色，爆擊傷害黃色（字體也比較大），從敵人身上往上飄再淡出。
  // x 座標加一點隨機偏移，避免同一隻怪物短時間內連續中好幾刀時數字全部疊在同一點看不清楚。
  spawnDamageNumber(x, y, amount, isCrit) {
    const offsetX = (Math.random() - 0.5) * 24;
    const text = this.add.text(x + offsetX, y - 14, `${Math.round(amount)}`, textStyle({
      fontSize: isCrit ? '28px' : '20px',
      color: isCrit ? '#ffe066' : '#ffffff',
    })).setOrigin(0.5).setDepth(30010);
    this.tweens.add({
      targets: text, y: y - 50, alpha: 0, duration: 650, ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  spawnKillFx(x, y) {
    const fx = this.add.image(x, y, 'fx_kill').setDepth(29999).setScale(0.5);
    this.tweens.add({ targets: fx, scale: 1.4, alpha: 0, duration: 300, onComplete: () => fx.destroy() });
  }
  // 血包拾取特效：綠色系爆裂碎片 + 浮動的「+HP」數字
  spawnHealFx(x, y, amount) {
    this.spawnBurstFx(x, y, 0x5bff8f, 12, 'pickup_heart', 90);
    const ring = this.add.image(x, y, 'fx_levelup').setDepth(30000).setScale(0.3).setAlpha(0.9).setTint(0x5bff8f);
    this.tweens.add({ targets: ring, scale: 2, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
    const text = this.add.text(x, y - 10, `+${amount} HP`, textStyle({
      fontSize: '20px', color: '#5bff8f',
    })).setOrigin(0.5).setDepth(30001);
    this.tweens.add({ targets: text, y: y - 46, alpha: 0, duration: 700, onComplete: () => text.destroy() });
  }
  // 磁鐵拾取特效：藍紫色系爆裂碎片 + 一圈往外擴散的吸引波紋，暗示「範圍內東西被吸走了」
  spawnMagnetFx(x, y) {
    this.spawnBurstFx(x, y, 0x7ea0ff, 12, 'pickup_magnet', 90);
    const ring = this.add.image(x, y, 'fx_levelup').setDepth(30000).setScale(0.3).setAlpha(0.9).setTint(0x7ea0ff);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 550, onComplete: () => ring.destroy() });
    const text = this.add.text(x, y - 10, '磁力吸引！', textStyle({
      fontSize: '20px', color: '#a9c0ff',
    })).setOrigin(0.5).setDepth(30001);
    this.tweens.add({ targets: text, y: y - 46, alpha: 0, duration: 700, onComplete: () => text.destroy() });
  }
  // 擊敗 Boss 瞬間的慶祝爆閃：角色短暫染金、爆一圈金色衝擊波。
  // 這段純粹是「打贏了！」的視覺回饋，跟後面要不要接受龍之光環的永久加成無關，
  // 所以持續時間很短（1.2 秒），不會一直跟著玩家。
  spawnSuperSaiyanAura(duration = 1200) {
    const p = this.player.sprite;
    const auraTint = 0xffe066;
    p.setTint(auraTint);
    this.cameras.main.flash(320, 255, 224, 100);
    this.hitStop(80);
    this.spawnGlowRing(p.x, p.y, 'fx_levelup', auraTint, 0.4, 5, 700, 29997);
    this.spawnBurstFx(p.x, p.y, auraTint, 26, 'fx_levelup', 210);
    this.saiyanBurstUntil = this.time.now + duration;
  }

  // 慶祝爆閃結束後把玩家身上暫時的金色 tint 清掉
  // （如果玩家後來接受了龍之光環，_updateDragonAura 會接手處理視覺，不會被這裡蓋掉）
  _updateSuperSaiyanAura(time) {
    if (!this.saiyanBurstUntil) return;
    if (time >= this.saiyanBurstUntil) {
      this.saiyanBurstUntil = null;
      if (!this.dragonAuraActive && this.player.sprite.active) this.player.sprite.clearTint();
    }
  }

  // 龍之光環（永久版）：玩家在 RelicChoiceScene 選擇拿取「龍之光環」後呼叫，
  // 建立一個「持續跟著玩家」的金色氣場光環，每一幀都重新對齊玩家座標，
  // 而不是只靠間歇性的粒子噴發假裝跟隨——這是這次要修正的重點。
  enableDragonAuraVisual() {
    this.dragonAuraActive = true;
    this._nextDragonEmberAt = 0;
    if (!this.dragonAuraRing) {
      this.dragonAuraRing = this.add.image(this.player.sprite.x, this.player.sprite.y, 'fx_levelup')
        .setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe066).setAlpha(0.5).setScale(1.5).setDepth(9997);
      this.tweens.add({
        targets: this.dragonAuraRing,
        scale: { from: 1.3, to: 1.9 },
        alpha: { from: 0.35, to: 0.6 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    this.dragonAuraRing.setVisible(true);
  }

  // 每幀更新：把光環釘在玩家目前座標上（永遠跟著玩家跑），
  // 並每隔一小段時間補幾顆往上竄的金色能量粒子，強化「持續繚繞」的感覺
  _updateDragonAura(time) {
    if (!this.dragonAuraActive) return;
    const p = this.player.sprite;
    this.dragonAuraRing.setPosition(p.x, p.y);
    this.dragonAuraRing.setDepth(p.depth - 1);
    if (time >= this._nextDragonEmberAt) {
      this._nextDragonEmberAt = time + 220;
      this.spawnEmbersFx(p.x, p.y, 2, 0xffe066);
    }
  }

  // 龍之翼（永久版）：玩家接受紅龍遺物後呼叫，在玩家背後掛上一整張「一對翅膀」的圖片
  // （fx_dragon_wing_pair，玩家提供的美術圖，本身就是左右對稱、中間留了角色站的空隙），
  // 每幀貼齊玩家位置並持續有呼吸般的拍動感，移動時還會往身後噴出淡淡的火焰色粒子尾跡。
  //
  // 重要修正：之前是拿「單邊翅膀」材質各自定位兩張、再用 setFlipX 鏡射拼出一對，
  // 兩張的位移量（±8px）遠小於翅膀本身的大小，疊在一起幾乎完全重疊，
  // 看起來就是畫面回報的那坨糊在一起的紅色色塊，而不是分開在角色左右兩側的翅膀。
  // 現在直接用玩家給的完整「一對翅膀」圖，一張圖搞定，不會再有這個重疊問題。
  enableDragonWingsVisual() {
    this.dragonWingsActive = true;
    this._nextWingsFxAt = 0;
    if (!this.dragonWingPair) {
      const tex = this.textures.get('fx_dragon_wing_pair').getSourceImage();
      const displayW = 130;
      const displayH = displayW * (tex.height / tex.width);
      // 錨點改成貼近圖片頂端（兩片翅膀交會的關節縫隙處），讓這個縫隙對齊角色肩膀，
      // 翅膀主體大部分往下往外展開，而不是像之前那樣整片翅膀懸在角色偏下方的位置
      this.dragonWingPair = this.add.image(this.player.sprite.x, this.player.sprite.y, 'fx_dragon_wing_pair')
        .setOrigin(0.5, 0.18).setDisplaySize(displayW, displayH).setDepth(9996);
      // 記住 setDisplaySize 算出來的基準縮放值，之後拍動動畫要在這個基準上疊加，
      // 不能直接呼叫 setScale(1±flap)，那樣會蓋掉 setDisplaySize 的效果，
      // 讓翅膀突然變回原始貼圖的超大尺寸（1351x781）。
      this.dragonWingBaseScaleX = this.dragonWingPair.scaleX;
      this.dragonWingBaseScaleY = this.dragonWingPair.scaleY;
    }
    this.dragonWingPair.setVisible(true);
  }

  _updateDragonWings(time) {
    if (!this.dragonWingsActive) return;
    const p = this.player.sprite;

    // 呼吸般的拍動感：用 sin 波讓翅膀輕微縮放擺盪，不會呆板地完全靜止
    const flap = Math.sin(time / 260) * 0.05;
    this.dragonWingPair.setPosition(p.x, p.y - 16);
    this.dragonWingPair.setScale(
      this.dragonWingBaseScaleX * (1 + flap * 0.4),
      this.dragonWingBaseScaleY * (1 - flap)
    );
    this.dragonWingPair.setDepth(p.depth - 1); // 畫在玩家「背後」，而不是蓋在角色上面

    if (time >= this._nextWingsFxAt) {
      this._nextWingsFxAt = time + 220;
      // 風之尾跡：往「移動方向的反方向」噴出火焰色粒子，靜止不動時就隨機方向飄
      const vx = p.body.velocity.x, vy = p.body.velocity.y;
      const speed = Math.hypot(vx, vy);
      const backAng = speed > 5 ? Math.atan2(-vy, -vx) : Math.random() * Math.PI * 2;
      const bx = p.x + Math.cos(backAng) * 16, by = p.y + Math.sin(backAng) * 16;
      this.spawnEmbersFx(bx, by, 2, 0xff8a3d);
    }
  }

  spawnFlameFx(x, y) {
    const fx = this.add.image(x, y, 'fx_flame').setDepth(29999);
    this.tweens.add({ targets: fx, scale: 1.6, alpha: 0, duration: 250, onComplete: () => fx.destroy() });
  }
  spawnLevelUpFx(x, y) {
    const fx = this.add.image(x, y, 'fx_levelup').setDepth(30001).setScale(0.4).setAlpha(0.9);
    this.tweens.add({ targets: fx, scale: 2.6, alpha: 0, duration: 700, onComplete: () => fx.destroy() });
    const fx2 = this.add.image(x, y, 'fx_levelup').setDepth(30001).setScale(0.2).setAlpha(0.7).setTint(0xffe066);
    this.tweens.add({ targets: fx2, scale: 3.4, alpha: 0, duration: 900, delay: 100, onComplete: () => fx2.destroy() });
    this.spawnBurstFx(x, y, 0x6fd3ff, 14, 'gem_exp', 130);
  }
  // 武器進化瞬間的華麗特效
  spawnEvolveFx(x, y) {
    audioManager.levelUp();
    this.cameras.main.flash(250, 255, 225, 110);
    for (let i = 0; i < 3; i++) {
      const ring = this.add.image(x, y, 'fx_levelup').setDepth(30002).setScale(0.3).setAlpha(0.9).setTint(0xffe066);
      this.tweens.add({
        targets: ring, scale: 3 + i, alpha: 0, duration: 700 + i * 150, delay: i * 100,
        onComplete: () => ring.destroy(),
      });
    }
    this.spawnBurstFx(x, y, 0xffe066, 20, 'fx_crit', 160);
  }

  // 攻擊「出招瞬間」特效：讓玩家清楚看到自己開火的那一刻。
  // evolved 為 true 時會套用金色進化版特效（更大、更亮、多一圈光環）
  spawnCastFx(x, y, kind, angle = 0, radius = 0, evolved = false) {
    const evoTint = 0xffe066;
    switch (kind) {
      case 'fireball': {
        const scale = evolved ? 1.3 : 0.85;
        const fx = this.add.image(x, y, 'fx_flame').setDepth(6001).setScale(scale).setAlpha(0.95);
        if (evolved) fx.setTint(evoTint);
        this.tweens.add({ targets: fx, scale: scale * 2, alpha: 0, duration: 220, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_flame', evolved ? evoTint : 0xff6a2d, 0.3, evolved ? 2.6 : 1.8, 260, 6000);
        this.spawnBurstFx(x, y, evolved ? evoTint : 0xff8a3d, evolved ? 12 : 6, 'fx_flame', evolved ? 130 : 85);
        break;
      }
      case 'lightning': {
        const fx = this.add.image(x, y, 'fx_bolt').setDepth(6001).setScale(evolved ? 2.4 : 1.5).setAlpha(1).setRotation(angle);
        fx.setTint(evolved ? evoTint : 0x7ef7ff);
        this.tweens.add({ targets: fx, scale: (evolved ? 2.4 : 1.5) * 1.6, alpha: 0, duration: 160, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_bolt', evolved ? evoTint : 0x7ef7ff, 0.4, evolved ? 2.2 : 1.4, 200, 6000);
        if (evolved) this.spawnBurstFx(x, y, evoTint, 10, 'fx_bolt', 120);
        break;
      }
      case 'knife': {
        const fx = this.add.image(x, y, 'fx_crit').setDepth(6001).setScale(evolved ? 1.9 : 1.15).setAlpha(0.95)
          .setRotation(angle).setTint(evolved ? evoTint : 0xdfefff);
        this.tweens.add({ targets: fx, scale: (evolved ? 1.9 : 1.15) * 1.7, alpha: 0, duration: 160, onComplete: () => fx.destroy() });
        break;
      }
      case 'frost': {
        const ring = this.add.image(x, y, 'fx_frost').setDepth(6001).setScale(radius / 24).setAlpha(0.7);
        if (evolved) ring.setTint(evoTint);
        this.tweens.add({
          targets: ring, alpha: 0, scale: radius / 20,
          duration: 400, onComplete: () => ring.destroy(),
        });
        // 二次擴散光環，讓範圍感更明顯，加上外圈發光層
        const ring2 = this.add.image(x, y, 'fx_frost').setDepth(6000).setScale(radius / 60).setAlpha(0.5);
        this.tweens.add({ targets: ring2, alpha: 0, scale: radius / 22, duration: 550, delay: 60, onComplete: () => ring2.destroy() });
        this.spawnGlowRing(x, y, 'fx_frost', evolved ? evoTint : 0x8fe3ff, radius / 80, radius / 26, 500, 5999);
        break;
      }
    }
  }

  // 攻擊「命中瞬間」特效：依武器種類顯示不同的命中視覺回饋，並附加碎片噴射與發光層
  spawnImpactFx(x, y, kind, radius = 0, evolved = false) {
    const evoTint = 0xffe066;
    switch (kind) {
      case 'fireball': {
        const scale = evolved ? 2.6 : 1.9;
        const fx = this.add.image(x, y, 'fx_flame').setDepth(29999).setScale(scale * 0.55);
        if (evolved) fx.setTint(evoTint);
        this.tweens.add({ targets: fx, scale, alpha: 0, duration: 280, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_flame', evolved ? evoTint : 0xff6a2d, 0.4, evolved ? 3.2 : 2.2, 340);
        this.spawnBurstFx(x, y, evolved ? evoTint : 0xff8a3d, evolved ? 16 : 10, 'fx_flame', evolved ? 170 : 115);
        this.spawnEmbersFx(x, y, evolved ? 10 : 6, evolved ? evoTint : 0xffb066);
        break;
      }
      case 'lightning': {
        const fx = this.add.image(x, y, 'fx_bolt').setDepth(29999).setScale(evolved ? 1.8 : 1.15).setAlpha(0.95);
        fx.setTint(evolved ? evoTint : 0x7ef7ff);
        this.tweens.add({ targets: fx, scale: (evolved ? 1.8 : 1.15) * 1.6, alpha: 0, duration: 190, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_bolt', evolved ? evoTint : 0x7ef7ff, 0.3, evolved ? 2.4 : 1.5, 220);
        this.spawnBurstFx(x, y, evolved ? evoTint : 0xaef9ff, evolved ? 10 : 5, 'fx_bolt', 110);
        break;
      }
      case 'knife': {
        const fx = this.add.image(x, y, 'fx_crit').setDepth(29999).setScale(evolved ? 1.5 : 0.95).setTint(evolved ? evoTint : 0xffffff);
        this.tweens.add({ targets: fx, scale: (evolved ? 1.5 : 0.95) * 1.7, alpha: 0, duration: 160, onComplete: () => fx.destroy() });
        this.spawnBurstFx(x, y, evolved ? evoTint : 0xdfefff, evolved ? 6 : 3, 'fx_crit', 90);
        break;
      }
      case 'sawblade': {
        const fx = this.add.image(x, y, 'fx_crit').setDepth(29999).setScale(evolved ? 1.3 : 0.8).setTint(evolved ? evoTint : 0xcfcfcf);
        this.tweens.add({ targets: fx, scale: (evolved ? 1.3 : 0.8) * 1.8, alpha: 0, duration: 140, onComplete: () => fx.destroy() });
        break;
      }
      case 'frost': {
        // 冰系刻意不跟其他武器共用金色進化色，維持藍色系（進化版用更亮的冰藍白）
        const frostEvoTint = 0xbfe9ff;
        const fx = this.add.image(x, y, 'fx_frost').setDepth(29999).setScale(evolved ? 1.5 : 0.85).setAlpha(0.85);
        if (evolved) fx.setTint(frostEvoTint);
        this.tweens.add({ targets: fx, scale: (evolved ? 1.5 : 0.85) * 1.9, alpha: 0, duration: 240, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_frost', evolved ? frostEvoTint : 0x8fe3ff, 0.3, evolved ? 2.6 : 1.5, 300);
        this.spawnBurstFx(x, y, evolved ? frostEvoTint : 0x8fe3ff, evolved ? 12 : 5, 'fx_frost', evolved ? 110 : 90);
        break;
      }
      default: {
        this.spawnKillFx(x, y);
      }
    }
  }

  // 電光連鎖特效：模仿英雄聯盟「史提克彈簧刀」電刀的連鎖閃電視覺——
  // 兩個命中點之間畫出一道鋸齒狀、會發光的電弧
  spawnChainLightningFx(x1, y1, x2, y2, evolved = false) {
    const color = evolved ? 0xffe066 : 0x7ef7ff;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // 垂直於連線方向的法線，用來做鋸齒偏移

    const graphics = this.add.graphics().setDepth(30000);
    graphics.setBlendMode(Phaser.BlendModes.ADD);
    const segments = 6;
    const drawBolt = (lineWidth, alpha, jagAmount) => {
      graphics.lineStyle(lineWidth, color, alpha);
      graphics.beginPath();
      graphics.moveTo(x1, y1);
      for (let i = 1; i < segments; i++) {
        const t = i / segments;
        const jag = (Math.random() - 0.5) * jagAmount;
        graphics.lineTo(x1 + dx * t + nx * jag, y1 + dy * t + ny * jag);
      }
      graphics.lineTo(x2, y2);
      graphics.strokePath();
    };
    drawBolt(evolved ? 5 : 3.5, 0.9, 16); // 外層粗光暈
    drawBolt(evolved ? 2 : 1.5, 1, 10);   // 內層細亮線

    this.tweens.add({
      targets: graphics, alpha: 0, duration: 160,
      onComplete: () => graphics.destroy(),
    });
    // 兩端各來一個電光閃爍
    this.spawnGlowRing(x1, y1, 'fx_bolt', color, 0.3, evolved ? 1.6 : 1.1, 150);
    this.spawnGlowRing(x2, y2, 'fx_bolt', color, 0.3, evolved ? 1.8 : 1.2, 170);
  }

  // 冰柱特效：從地面冒出一根結晶冰柱，命中範圍內敵人並造成減速。
  // knockback 為 null 時不造成擊退；evolved 為 true 時換成進化版的專屬美術圖
  // （見下方 pillarTexture），不再跟一般版共用同一張貼圖疊色縮放。
  spawnIcePillar(x, y, dmg, slow, slowDuration, critRate, critDmg, knockback, evolved = false) {
    // 地面裂痕／冰霜擴散提示，讓玩家注意到冰柱要冒出來的位置
    const crack = this.add.image(x, y, 'fx_frost').setDepth(y - 1).setScale(evolved ? 0.4 : 0.25).setAlpha(0.6);
    crack.setTint(evolved ? 0x8fd6ff : 0x8fe3ff);
    this.tweens.add({ targets: crack, scale: evolved ? 1.9 : 1.3, alpha: 0, duration: 260, onComplete: () => crack.destroy() });

    // 進化版限定：地面額外噴出幾道放射狀碎冰，堆疊出比一般版更華麗的地面特效
    if (evolved) {
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + Math.random() * 0.3;
        const shard = this.add.image(x, y, 'fx_frost').setDepth(y - 1).setScale(0.16).setAlpha(0.55).setTint(0xdff6ff);
        this.tweens.add({
          targets: shard,
          x: x + Math.cos(ang) * 30, y: y + Math.sin(ang) * 30,
          scale: 0.55, alpha: 0, duration: 340,
          onComplete: () => shard.destroy(),
        });
      }
    }

    // 冰柱由下往上「刺」出來的動畫（用 Back.easeOut 做出衝出地面的彈跳感）。一般版跟
    // 進化版改用兩張不同的正式美術圖（小冰柱／大冰柱），各自調過縮放倍率，
    // 讓兩張圖在遊戲裡的視覺大小跟舊版數值手感差不多。
    const pillarTexture = evolved ? 'fx_ice_pillar_evo' : 'fx_ice_pillar_normal';
    const pillarScale = evolved ? 0.42 : 0.55;
    const pillar = this.add.image(x, y, pillarTexture).setOrigin(0.5, 1).setDepth(y + 1).setScale(pillarScale, pillarScale * 0.05).setAlpha(0.95);

    this.tweens.add({
      targets: pillar,
      scaleY: pillarScale,
      duration: 150,
      ease: 'Back.easeOut',
      onComplete: () => {
        if (!pillar.active) return;
        // 冰柱冒出的瞬間造成傷害＋減速＋擊退
        const hitRadius = evolved ? 50 : 36;
        this.enemySystem.queryNear(x, y, hitRadius, (e) => {
          if (dist(x, y, e.x, e.y) > hitRadius) return;
          this.enemySystem.damageEnemy(e, dmg, critRate, critDmg, knockback ? {
            fromX: x, fromY: y, force: knockback.force, duration: knockback.duration,
          } : null);
          e.setData('slowUntil', this.time.now + slowDuration);
          e.setData('slowFactor', 1 - slow);
        });
        if (this.boss && this.boss.alive && dist(x, y, this.boss.sprite.x, this.boss.sprite.y) <= hitRadius + 20) {
          this.boss.takeDamage(dmg, critRate, critDmg);
        }
        this.spawnImpactFx(x, y, 'frost', hitRadius, evolved);

        if (evolved) {
          // 進化版收尾：頂端補一圈亮白冰晶閃光＋額外藍白碎片噴射，強調「更華麗」；
          // 閃光位置用實際圖片顯示高度換算，不再綁死舊版 procedural 貼圖比例的魔術數字
          const flash = this.add.image(x, y - pillar.displayHeight * 0.85, 'fx_frost')
            .setDepth(y + 2).setScale(0.5).setAlpha(0.9).setTint(0xffffff).setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: flash, scale: 1.7, alpha: 0, duration: 280, onComplete: () => flash.destroy() });
          this.spawnBurstFx(x, y - 10, 0xbfe9ff, 12, 'fx_frost', 120);
        }

        // 停留一小段時間後縮回地面消失
        this.tweens.add({
          targets: pillar, scaleY: 0, alpha: 0, duration: 220, delay: 260,
          onComplete: () => pillar.destroy(),
        });
      },
    });
  }

  // 隕石襲擊（火球術進化「隕石燄爆」專用）：先在目標腳下標出警戒圈，
  // 短暫停頓後一顆巨大隕石從畫面上方直直砸下來，落地瞬間造成範圍爆炸傷害＋擊退。
  // 跟一般火球不同，這裡完全不經過投射物池／每幀碰撞判定，落點與爆炸都是直接算好的。
  spawnMeteorStrike(x, y, dmg, aoe, critRate, critDmg, knockback) {
    const warnColor = 0xff5a2d;

    // 警戒圈：在地面上標出即將被砸中的範圍，讓玩家有機會看到並閃避
    const warn = this.add.image(x, y, 'fx_frost').setDepth(y - 1).setScale(0.2).setAlpha(0.55).setTint(warnColor);
    this.tweens.add({
      targets: warn, scale: aoe / 24, alpha: 0.28, duration: 380, ease: 'Cubic.easeOut',
    });

    this.time.delayedCall(420, () => {
      warn.destroy();
      if (!this.player || !this.player.sprite.active) return;

      // 隕石本體：從畫面上方直直墜落到目標位置，用加速的 easeIn 模擬重力墜落感
      const meteor = this.add.image(x, y - 620, 'proj_fireball')
        .setDepth(30003).setScale(3.2).setTint(0xff6a2d).setRotation(0.4);
      const trailTimer = this.time.addEvent({
        delay: 40, loop: true,
        callback: () => {
          if (meteor.active) this.spawnEmbersFx(meteor.x, meteor.y - 10, 2, 0xff8a3d);
        },
      });

      this.tweens.add({
        targets: meteor,
        y,
        duration: 430,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          trailTimer.remove();
          meteor.destroy();

          // 落地爆炸：巨大爆炸特效＋範圍傷害（比照一般火球的 AOE 判定），
          // 不加鏡頭震動——跟火球一般命中一樣，震動太頻繁會干擾遊玩體驗
          this.spawnImpactFx(x, y, 'fireball', aoe, true);
          this.spawnBurstFx(x, y, 0xff6a2d, 20, 'fx_flame', 190);

          this.enemySystem.queryNear(x, y, aoe, (e) => {
            if (dist(x, y, e.x, e.y) > aoe) return;
            this.enemySystem.damageEnemy(e, dmg, critRate, critDmg, knockback ? {
              fromX: x, fromY: y, force: knockback.force, duration: knockback.duration,
            } : null);
          });
          if (this.boss && this.boss.alive && dist(x, y, this.boss.sprite.x, this.boss.sprite.y) <= aoe) {
            this.boss.takeDamage(dmg, critRate, critDmg);
          }
        },
      });
    });
  }
}
