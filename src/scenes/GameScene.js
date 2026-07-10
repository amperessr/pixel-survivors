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
import { EQUIPMENT_DATA, getLegendarySeriesSlug } from '../equipment/EquipmentData.js';
import { getEquipped, addGold, setBestScore, setCheckpointStage, getStatBonus } from '../managers/SaveManager.js';
import { dist } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { textStyle } from '../utils/TextStyle.js';

// 關卡推進規則：一般關（非 5 的倍數）擊殺滿 KILLS_PER_STAGE 隻小怪就進到下一關；
// 魔王關（第 5、10、15...關）改成打死魔王才會進到下一關，見 registerKill()/onBossDefeated()。
const BOSS_STAGE_INTERVAL = 5;
const KILLS_PER_STAGE = 500;
// Boss 判定半徑統一定義方便調整（2026-07-10 魔王體型全面縮小，半徑跟著縮）
const BOSS_HIT_RADIUS = 36;   // 子彈命中 Boss 的判定半徑
const BOSS_TOUCH_RADIUS = 60; // Boss 對玩家造成接觸傷害的判定半徑
const BOSS_SAW_RADIUS = 60;   // 鋸片對 Boss 造成傷害的判定半徑
const ELECTRO_KNIFE_CHAIN_MAX = 8; // 電擊飛刃命中後，連鎖閃電最多牽連的小怪數量

export default class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  init(data) {
    this.characterId = data.characterId || 'balanced';
    // 存檔點：從主選單選擇「當前關卡」時會帶入 startStage，讓這場遊戲一開局就等同於
    // 「已經抵達第 N 關」的難度（怪物強度曲線見 create() 怎麼設定 this.stage）。
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
    this._computeSetBonuses();
    this._setupCloneRing();
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
    this.cameras.main.setZoom(2.1); // 鏡頭拉近，讓角色與怪物看起來更清楚、不會太小太遠

    this.map = new MapGenerator(this);
    this.enemySystem = new EnemySystem(this, this.player);
    this.healthPackSystem = new HealthPackSystem(this, this.player);
    this.magnetSystem = new MagnetSystem(this, this.player);
    this.weaponSystem = new WeaponSystem(this, this.player, this.enemySystem);

    this.bossBoltGroup = this.physics.add.group();
    this.boss = null;

    // getElapsedSeconds() 純粹用來算分數的存活時間加成，跟關卡推進無關（關卡推進改成
    // 擊殺數／擊敗魔王驅動，見下面 this.stage）。
    this.startTime = this.time.now;
    // 關卡系統：this.stage 是目前關卡數，一般關擊殺滿 KILLS_PER_STAGE 隻小怪
    // （this.stageKillCount）就進下一關；魔王關要打死魔王才會進下一關（見 onBossDefeated）。
    this.stage = this.startStage;
    this.stageKillCount = 0;
    // 補上「理論上應該已經打過幾隻王」的計數，讓黑藍/血色紅龍…五種型態的輪替
    // 從存檔點那一關開始算才對，不會每次都從黑龍王重新輪起。
    this.bossSpawnCount = Math.floor((this.startStage - 1) / BOSS_STAGE_INTERVAL);

    this.killCount = 0;
    this.bossKillCount = 0; // 擊殺魔王數：結算時每隻額外加分
    this.paused = false;
    this.escPaused = false; // 僅代表玩家手動按 ESC 暫停（用於顯示「已暫停」遮罩）
    this.dragonAuraActive = false; // 是否已接受龍之光環（永久跟隨光環視覺開關）
    this.dragonWingsActive = false; // 是否已接受龍之翼（永久跟隨風之尾跡視覺開關）
    this._pendingRelic = null; // 擊敗 Boss 順便升級時，排隊等升級選單關閉後再跳遺物選擇視窗
    this._pendingLevelUps = 0; // 一次撿到大量經驗值可能一口氣跳好幾級，排隊逐張顯示升級選單（見 onGainExp）
    this._levelUpOpen = false; // 升級選單目前是否開著，避免同一幀連續升級時重複 launch
    // 重要修正：Phaser 同一個 GameScene 物件會在好幾場遊戲之間重複使用（scene.start()
    // 只會重新呼叫 init()/create()，不會真的整個重建），這幾個旗標如果沒有在這裡
    // 重設，會直接沿用「上一場遊戲死亡時」留下的值——這正是「這場遊戲結束後，下一場
    // 玩家死亡不會結算」、「下一場撿經驗值完全沒反應」的根本原因：onGainExp()／
    // onPlayerDeath() 等一大堆地方都在最前面檢查 `if (this.gameEnded) return`，
    // 上一場死亡時已經把它設成 true，沒重設的話下一場一開局就已經是「遊戲已結束」的狀態。
    this.gameEnded = false;
    this._wentToGameOver = false;
    this.attacksLocked = false; // 魔王登場開場的 3 秒內設為 true，見 Boss._playIntroCinematic()

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
        this._syncProgress();
      } catch (err) {
        console.error('[GameScene] 離開前存檔失敗：', err);
      }
    };
    window.addEventListener('beforeunload', this._saveOnExit);
    window.addEventListener('pagehide', this._saveOnExit);
    // 重要修正：分頁切到背景（visibilitychange → hidden）常常只是玩家切去看別的
    // 分頁、等一下就切回來，不是真的要離開——如果這裡也呼叫 _saveOnExit()（會加
    // 金幣、且靠 _exitSaveDone 擋掉之後真正結束時的重複計算），玩家切回來後繼續玩
    // 到正常死亡，GameOverScene 又會把同一批擊殺數的金幣再加一次，等於同一場
    // 遊戲的金幣被算了兩次。所以背景時只做「不會重複計算」的 monotonic 存檔
    // （分數/關卡只增不減，見 _syncProgress）跟暫停，金幣一律留給真正的離開事件
    // （beforeunload/pagehide）或正常死亡結算，兩者都各自只會執行一次。
    this._bgPaused = false;
    this._onVisibilityChange = () => {
      if (this.gameEnded) return;
      if (document.visibilityState === 'hidden') {
        try { this._syncProgress(); } catch (err) { console.error('[GameScene] 背景同步存檔失敗：', err); }
        // 分頁背景期間瀏覽器通常會節流/停止 requestAnimationFrame，切回來的那一刻
        // Phaser 量到的「這一幀經過的時間」會是一大段背景期間，即使有 fps.min
        // 限制單幀最大補算量，背景時間夠長還是會補算好幾幀，玩家/怪物看起來像
        // 瞬間被推走一段距離——直接暫停物理世界就不會有東西需要補算。`_bgPaused`
        // 只標記「是這裡自己暫停的」，避免跟 ESC/升級選單等其他暫停來源互相蓋掉。
        if (!this.paused) {
          this.paused = true;
          this.physics.world.pause();
          this._bgPaused = true;
        }
      } else if (document.visibilityState === 'visible' && this._bgPaused) {
        this._bgPaused = false;
        this.paused = false;
        this.physics.world.resume();
        if (this.player) this.player.clearBankedInput();
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    // 這個 GameScene 物件會在好幾場遊戲之間重複使用，create() 每次重開都會執行到
    // 這裡——如果沒有這個旗標擋著，'shutdown' 監聽器會一場一場疊加下去（開好幾場
    // 遊戲後同一個 shutdown 事件會觸發好幾次同樣的清理邏輯），所以只在第一次掛上，
    // 之後每次 create() 就不再重複註冊。
    if (!this._shutdownHandlerBound) {
      this._shutdownHandlerBound = true;
      this.events.on('shutdown', () => {
        audioManager.stopBgm();
        window.removeEventListener('beforeunload', this._saveOnExit);
        window.removeEventListener('pagehide', this._saveOnExit);
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
      });
    }

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

  // 只存「只增不減」的進度（歷史最佳分數／存檔點關卡），不會加金幣，重複呼叫
  // 也不會造成任何重複計算——安全給分頁切背景等「可能不是真的要離開」的情境用。
  // 金幣只在真正離開（_saveOnExit）或正常死亡結算（GameOverScene）各自加一次。
  _syncProgress() {
    // 分數不再看存活時間，改用「目前關卡數」代表推進深度（關卡數越高代表打的
    // 怪越硬，比單純看擊殺數更能反映真實強度），跟 GameOverScene 的公式一致。
    const score = this.killCount * 10 + this.player.level * 50 + this.getStage() * 150
      + this.bossKillCount * 5000; // 擊殺魔王額外加分
    setBestScore(score);
    setCheckpointStage(this.getStage());
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
    // 永久等級投資的技能點跟裝備加成疊加：七項能力值都能加（爆擊率上限 40%，
    // 其餘沒有上限），生命上限的加成一樣直接補滿，不會讓玩家「掉血」。
    const maxHpBonus = getStatBonus('maxHp');
    stats.maxHp += maxHpBonus;
    this.player.hp += maxHpBonus;
    stats.attack += getStatBonus('attack');
    stats.defense += getStatBonus('defense');
    stats.moveSpeed += getStatBonus('moveSpeed');
    stats.atkSpeed += getStatBonus('atkSpeed');
    stats.critRate += getStatBonus('critRate');
    stats.critDmg += getStatBonus('critDmg');
  }

  // 傳說套裝效果：同一套主題裝（烈焰/寒冰/狂風/聖光/雷霆，戒指不算）湊滿 3 件／
  // 5 件時額外觸發，見 EquipmentData.LEGENDARY_SET_BONUS_TEXT 的效果說明。
  // this.setBonuses 存成 { flame3, flame5, ice3, ice5, wind3, wind5, holy3, holy5,
  // thunder3, thunder5 } 布林旗標，供 EnemySystem／WeaponSystem 讀取（讀 this.scene.setBonuses）。
  // 5 件套一定同時滿足 3 件套的條件，兩個門檻的效果會疊加，不是互斥的兩選一。
  _computeSetBonuses() {
    const equipped = getEquipped();
    const counts = {};
    Object.values(equipped).forEach((itemId) => {
      const slug = getLegendarySeriesSlug(itemId);
      if (slug) counts[slug] = (counts[slug] || 0) + 1;
    });
    const flags = {};
    ['flame', 'ice', 'wind', 'holy', 'thunder'].forEach((slug) => {
      const n = counts[slug] || 0;
      flags[`${slug}3`] = n >= 3;
      flags[`${slug}5`] = n >= 5;
    });
    this.setBonuses = flags;

    // 聖光套裝：攻速加成直接疊進玩家數值（3件 +30%／5件再疊 +60%，滿五件共 +90%）。
    // 5 件套原本是 +100%，但 2026-07-10 攻速對所有武器的冷卻權重全面拉高之後
    // （見 WeaponSystem.ATK_SPEED_COOLDOWN_WEIGHT），+100% 幾乎全額轉成射速，
    // 聖光套會壓倒其他四套傳說裝，降到 +60% 拉回套裝之間的平衡。
    if (flags.holy3) this.player.stats.atkSpeed += 30;
    if (flags.holy5) this.player.stats.atkSpeed += 60;

    // 吸血戒指（ring_heal 改版）：開局檢查一次是否戴著，戰鬥中造成傷害時走
    // applyLifesteal() 回血。
    this._hasLifestealRing = equipped.ring1 === 'ring_heal' || equipped.ring2 === 'ring_heal';
    this._lifestealWindowAt = 0;
    this._lifestealHealed = 0;
  }

  // 吸血戒指：攻擊造成傷害時吸取傷害的 3% 回復生命，每秒最多回復最大生命的 5%
  // ——上限是必要的：後期全武器同時輸出的總傷害極高，沒有上限的話吸血會直接
  // 讓玩家鎖血打不死。由 EnemySystem.damageEnemy()／Boss.takeDamage() 呼叫。
  applyLifesteal(dmg) {
    if (!this._hasLifestealRing || !this.player || this.gameEnded) return;
    const now = this.time.now;
    if (now - this._lifestealWindowAt >= 1000) {
      this._lifestealWindowAt = now;
      this._lifestealHealed = 0;
    }
    const cap = this.player.stats.maxHp * 0.05;
    if (this._lifestealHealed >= cap) return;
    const heal = Math.min(dmg * 0.03, cap - this._lifestealHealed);
    if (heal <= 0) return;
    this._lifestealHealed += heal;
    this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + heal);
  }

  // 分身戒：開局時召喚一個半透明的分身幻影。分身沒有物理實體（怪物打不到、
  // 不會擋路），純粹跟在本尊附近；攻擊由 WeaponSystem._fire() 讀取
  // this.cloneSprite，在本尊每次開火後從分身位置補一輪半傷害的攻擊。
  _setupCloneRing() {
    this.cloneSprite = null;
    const equipped = getEquipped();
    if (equipped.ring1 !== 'ring_clone' && equipped.ring2 !== 'ring_clone') return;
    const px = this.player.sprite.x, py = this.player.sprite.y;
    this.cloneSprite = this.add.sprite(px - 46, py, this.player.charDef.texture)
      .setScale(0.5).setAlpha(0.55).setTint(0xb9a8ff);
  }

  // 分身用「彈性跟隨」貼在本尊左後方：lerp 追過去會自然產生一點延遲感，
  // 看起來像殘影在跟著跑，而不是硬綁在固定位置的貼圖。
  _updateClone(time, delta) {
    const clone = this.cloneSprite;
    if (!clone || !clone.active) return;
    const p = this.player.sprite;
    const facing = p.flipX ? 1 : -1; // 跟在玩家背後那一側
    const targetX = p.x + facing * 46;
    const targetY = p.y;
    const t = Math.min(1, (delta / 1000) * 6);
    clone.x += (targetX - clone.x) * t;
    clone.y += (targetY - clone.y) * t;
    clone.setFlipX(p.flipX);
    clone.setDepth(clone.y);
    // 跟本尊一樣的 Q 彈呼吸縮放，只是幅度小一點
    const wave = Math.sin((time / 300) * Math.PI * 2) * 0.06;
    clone.setScale(0.5 * (1 - wave * 0.6), 0.5 * (1 + wave));
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
    this._updateClone(time, delta);
    this.map.update(this.player.sprite.x, this.player.sprite.y);

    // 怪物強度／菁英稀有機率曲線沿用原本依「難度數值」計算的公式（EnemyData.js），
    // 只是現在難度數值改成「目前關卡數 - 1」，不再是存活分鐘數——關卡本身已經改成
    // 擊殺數／擊敗魔王驅動，用關卡數當難度指標剛好跟推進速度掛鉤，不用另外重寫曲線。
    this.enemySystem.setDifficultyMinutes(this.stage - 1);
    this.enemySystem.update(time, delta);
    this.healthPackSystem.update(time, delta);
    this.magnetSystem.update(time);
    this.weaponSystem.update(time, delta);

    this._updateCollisions(time);

    if (this.boss) {
      this.boss.update(time, delta);
    } else if (this.isBossStage(this.stage)) {
      // 進到魔王關（第 5、10、15...關）立刻生成王，五種型態輪流出現：
      // 黑龍王 → 血色紅龍 → 惡魔王 → 樹王 → 獅鷲王 → 黑龍王……依序循環
      const BOSS_ROTATION = ['blue', 'red', 'demon', 'treant', 'griffin'];
      const bossType = BOSS_ROTATION[this.bossSpawnCount % BOSS_ROTATION.length];
      this.bossSpawnCount++;
      this.boss = new Boss(this, this.player, this.stage - 1, bossType, this.bossSpawnCount);
    }

    // 魔王投射物（龍息彈幕/爪擊震波）命中判定：命中半徑依每顆投射物自己的
    // hitRadius 資料（沒設定就用預設 16），讓大顆的震波/彈幕「看起來碰到就是碰到」。
    this.bossBoltGroup.children.iterate((bolt) => {
      if (!bolt || !bolt.active) return;
      const hitRadius = bolt.getData('hitRadius') || 16;
      if (dist(bolt.x, bolt.y, this.player.sprite.x, this.player.sprite.y) < hitRadius) {
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
      else if (kind === 'electroKnife') this._handleElectroKnifeHit(p, stats);
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

  // 電擊飛刃（融合武器）：命中判定跟一般飛刀完全一樣，差別是命中後會對附近
  // 「這把刀還沒命中過」的敵人一次補上多道連鎖閃電（每隻傷害為本體 50%、
  // 不吃穿透，最多牽連 ELECTRO_KNIFE_CHAIN_MAX 隻），而不是只找一隻——範圍
  // 內只找小怪，不會牽連到 Boss。
  _handleElectroKnifeHit(p, stats) {
    const hitSet = p.getData('hitSet');
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
    const dmg = p.getData('dmg');
    let hitX, hitY;
    if (hitBoss) {
      hitSet.add(this.boss);
      this.boss.takeDamage(dmg, stats.critRate, stats.critDmg);
      this._maybeThunderParalyze(this.boss, true);
      hitX = this.boss.sprite.x; hitY = this.boss.sprite.y;
    } else {
      hitSet.add(target);
      this.enemySystem.damageEnemy(target, dmg, stats.critRate, stats.critDmg, {
        fromX: p.x, fromY: p.y, force: kb.force, duration: kb.duration,
      });
      this._maybeThunderParalyze(target, false);
      hitX = target.x; hitY = target.y;
    }
    this.spawnImpactFx(hitX, hitY, 'electroKnife', 0, false);

    // 連鎖範圍內「這把刀還沒命中過」的敵人一次全部牽連（依距離近到遠取前 8 隻），
    // 每隻都補一道明顯的電弧，而不是只挑最近的一隻——被電到的敵人也加進
    // hitSet，避免同一把刀之後穿透命中下一個主目標時又重複電到同一批小怪。
    const chainRange = p.getData('chainRange');
    const chainCandidates = [];
    this.enemySystem.queryNear(hitX, hitY, chainRange, (e) => {
      if (hitSet.has(e)) return;
      const d = dist(hitX, hitY, e.x, e.y);
      if (d <= chainRange) chainCandidates.push({ e, d });
    });
    chainCandidates.sort((a, b) => a.d - b.d);
    chainCandidates.slice(0, ELECTRO_KNIFE_CHAIN_MAX).forEach(({ e }) => {
      hitSet.add(e);
      this.enemySystem.damageEnemy(e, dmg * 0.5, stats.critRate, stats.critDmg, null);
      this._maybeThunderParalyze(e, false);
      // 連鎖用「進化版」規格的電弧（更粗更亮），凸顯這是融合武器的額外加成
      this.spawnChainLightningFx(hitX, hitY, e.x, e.y, true);
    });

    const pierce = p.getData('pierce') || 0;
    if (pierce > 0) {
      p.setData('pierce', pierce - 1);
    } else {
      this.weaponSystem.projectilePool.free(p);
    }
  }

  // 隕石（世界末日左手，融合武器，原「極端冰火」改版一部分）：從天而降，落地
  // 造成範圍傷害＋擊退，範圍內敵人直接燃燒，並留下 3 秒燃燒地板讓之後經過的
  // 敵人也會持續中招（見 EnemySystem.applyBurn()／addHazardZone()）。跟冰塊各打
  // 各的目標，不會疊在同一個點（見 WeaponSystem._fireWorldEnd()）。玩家自己的
  // 攻擊技能、敵人不會閃避，所以不需要警示圈，按下去直接開始墜落，反應更快。
  spawnMeteorDrop(x, y, dmg, aoe, critRate, critDmg, knockback) {
    if (!this.player || !this.player.sprite.active) return;
    // 隕石本體回歸「火球貼圖染色」的做法：先前切自素材圖的 worldend_meteor 帶著
    // 原圖的漸層背景（去不乾淨），在畫面上會看到一塊方形底，反而更粗糙。
    const meteor = this.add.image(x, y - 620, 'proj_fireball')
      .setDepth(30003).setScale(3.2).setTint(0xff6a2d).setRotation(0.4);
    const trailTimer = this.time.addEvent({
      delay: 40, loop: true,
      callback: () => { if (meteor.active) this.spawnEmbersFx(meteor.x, meteor.y - 10, 2, 0xff8a3d); },
    });
    this.tweens.add({
      targets: meteor, y, duration: 430, ease: 'Cubic.easeIn',
      onComplete: () => {
        trailTimer.remove();
        meteor.destroy();
        this._spawnWorldEndImpactFx(x, y, aoe, 'fire');
        this.enemySystem.queryNear(x, y, aoe, (e) => {
          if (dist(x, y, e.x, e.y) > aoe) return;
          this.enemySystem.damageEnemy(e, dmg, critRate, critDmg, knockback ? {
            fromX: x, fromY: y, force: knockback.force, duration: knockback.duration,
          } : null);
          this.enemySystem.applyBurn(e, 3000);
        });
        if (this.boss && this.boss.alive && dist(x, y, this.boss.sprite.x, this.boss.sprite.y) <= aoe) {
          this.boss.takeDamage(dmg, critRate, critDmg);
        }
        this.enemySystem.addHazardZone(x, y, aoe, 'fire', 3000);
        this._spawnGroundPatchFx(x, y, aoe, 'fire');
      },
    });
  }

  // 大冰塊（世界末日右手）：從天而降，落地造成範圍傷害，範圍內敵人直接冰凍 1 秒
  // （完全定住，見 EnemySystem.applyFreeze()），並留下 3 秒冰霜地板讓之後經過的
  // 敵人持續減速（見 EnemySystem.applySlow()／addHazardZone()）。
  spawnIceDrop(x, y, dmg, aoe, critRate, critDmg) {
    if (!this.player || !this.player.sprite.active) return;
    // 冰晶本體回歸「冰霜貼圖染色」的做法，理由同 spawnMeteorDrop：切圖背景去不乾淨
    const ice = this.add.image(x, y - 620, 'proj_frost')
      .setDepth(30003).setScale(3.4).setTint(0xcdefff).setRotation(-0.3);
    this.tweens.add({
      targets: ice, y, duration: 430, ease: 'Cubic.easeIn',
      onComplete: () => {
        ice.destroy();
        this._spawnWorldEndImpactFx(x, y, aoe, 'frost');
        this.enemySystem.queryNear(x, y, aoe, (e) => {
          if (dist(x, y, e.x, e.y) > aoe) return;
          this.enemySystem.damageEnemy(e, dmg, critRate, critDmg, null);
          this.enemySystem.applyFreeze(e, 1000);
        });
        if (this.boss && this.boss.alive && dist(x, y, this.boss.sprite.x, this.boss.sprite.y) <= aoe) {
          this.boss.takeDamage(dmg, critRate, critDmg);
        }
        this.enemySystem.addHazardZone(x, y, aoe, 'frost', 3000);
        this._spawnGroundPatchFx(x, y, aoe, 'frost');
      },
    });
  }

  // 隕石／冰塊落地瞬間的爆閃特效：全程式繪製（爆閃圖＋發光圈＋碎片噴發）。
  // 先前用切自素材圖的 worldend_*_burst，但那批切圖帶著原圖的漸層背景去不乾淨，
  // 畫面上會出現一塊方形底，比程式特效更粗糙，全部改回程式繪製。
  _spawnWorldEndImpactFx(x, y, aoe, type) {
    const isFire = type === 'fire';
    const texture = isFire ? 'fx_flame' : 'fx_frost';
    const tint = isFire ? 0xff8a3d : 0x8fe3ff;
    const fx = this.add.image(x, y, texture).setDepth(29999).setScale(2.2 * 0.55);
    if (!isFire) fx.setTint(0xbfe9ff);
    this.tweens.add({ targets: fx, scale: 2.2 * 1.9, alpha: 0, duration: 300, onComplete: () => fx.destroy() });
    this.spawnGlowRing(x, y, texture, tint, 0.4, aoe / 26, 380);
    this.spawnBurstFx(x, y, tint, 10, texture, 170);
  }

  // 地面殘留特效（燃燒地板／冰霜地板）：不再貼一整張方形素材圖（切圖帶背景、
  // 看起來像一塊方塊壓在地上），改成「圓形柔光底暈＋持續 3 秒隨機竄出的小火苗/
  // 碎冰粒子」，讓地板看起來真的在燃燒/結凍。深度壓在怪物腳下（y-2/y-3）。
  _spawnGroundPatchFx(x, y, aoe, type) {
    const isFire = type === 'fire';
    const tint = isFire ? 0xff7a2d : 0x8fe3ff;

    // 底層圓形柔光（fx_bossdeath 是圓形柔光貼圖）：交代地板的生效範圍，
    // 用 ADD 疊加模式呈現「地面在發光」而不是一張圖蓋在地上，並隨時間輕微脈動
    const glow = this.add.image(x, y, 'fx_bossdeath').setDepth(y - 3).setTint(tint)
      .setAlpha(0).setScale(aoe / 26).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: glow, alpha: 0.3, duration: 200 });
    this.tweens.add({ targets: glow, alpha: { from: 0.3, to: 0.16 }, duration: 450, delay: 250, yoyo: true, repeat: 2 });
    this.tweens.add({ targets: glow, alpha: 0, duration: 400, delay: 2600, onComplete: () => glow.destroy() });

    // 持續 3 秒、每 130ms 在範圍內隨機一點竄出一小簇火苗（往上飄）或碎冰（原地
    // 結晶長出來再化掉），做出「地板正在燒／正在結凍」的動態感
    this.time.addEvent({
      delay: 130, repeat: Math.floor(2700 / 130),
      callback: () => {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * aoe * 0.9; // sqrt 讓分佈均勻鋪滿整個圓，不會擠在中心
        const fxX = x + Math.cos(ang) * r, fxY = y + Math.sin(ang) * r;
        if (isFire) {
          const flame = this.add.image(fxX, fxY, 'fx_flame').setDepth(y - 2)
            .setScale(0.3 + Math.random() * 0.35).setAlpha(0.9);
          this.tweens.add({
            targets: flame, y: fxY - 16, scale: 0.15, alpha: 0,
            duration: 400 + Math.random() * 150, ease: 'Cubic.easeOut',
            onComplete: () => flame.destroy(),
          });
        } else {
          const shard = this.add.image(fxX, fxY, 'fx_frost').setDepth(y - 2)
            .setScale(0.08).setAlpha(0.85).setTint(0xcdefff).setRotation(Math.random() * Math.PI);
          this.tweens.add({
            targets: shard, scale: 0.3 + Math.random() * 0.25, alpha: 0,
            duration: 550 + Math.random() * 200, ease: 'Sine.easeOut',
            onComplete: () => shard.destroy(),
          });
        }
      },
    });
  }

  // 雷霆套裝三件套：雷電系技能（雷電鎖鏈／電擊飛刃）命中敵人/魔王時 30% 機率
  // 造成 1 秒麻痺（讓怪物「無法施放技能」，小怪本身沒有技能可放，主要影響 Boss——
  // 見 Boss.update() 對 paralyzedUntil 的判斷），同時也是五件套額外傷害的觸發條件。
  _maybeThunderParalyze(target, isBoss) {
    if (!this.setBonuses || !this.setBonuses.thunder3) return;
    if (Math.random() >= 0.3) return;
    if (isBoss) {
      target.paralyzedUntil = this.time.now + 1000;
    } else {
      this.enemySystem.applyParalyze(target, 1000);
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
      this._maybeThunderParalyze(this.boss, true);
    } else {
      hitSet.add(target);
      this.enemySystem.damageEnemy(target, p.getData('dmg'), stats.critRate, stats.critDmg, {
        fromX: p.x, fromY: p.y, force: kb.force, duration: kb.duration,
      });
      this._maybeThunderParalyze(target, false);
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

  // 鋸片／血肉風暴（鋸片融合）：持續環繞傷害，各自用 lastHit 記錄每個目標的命中冷卻。
  // 血肉風暴命中特效改用專屬的 'bloodStorm' 規格（見 spawnImpactFx），比一般鋸片
  // 進化版更誇張，凸顯融合武器的稀有感。
  _handleSawbladeHits(time, stats) {
    if (this.attacksLocked) return; // 魔王登場開場 3 秒內鋸片不造成傷害（見 attacksLocked 的說明）
    const kb = WEAPON_KNOCKBACK.sawblade;
    const isBloodStorm = !!this.weaponSystem.owned['knife_sawblade'];
    const impactKind = isBloodStorm ? 'bloodStorm' : 'sawblade';
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
        this.spawnImpactFx(e.x, e.y, impactKind, 0, evolved);
      });
      if (this.boss && this.boss.alive && dist(saw.x, saw.y, this.boss.sprite.x, this.boss.sprite.y) < BOSS_SAW_RADIUS) {
        const last = lastHit.get(this.boss) || 0;
        if (time - last >= 300) {
          lastHit.set(this.boss, time);
          this.boss.takeDamage(dmg, stats.critRate, stats.critDmg);
          this.spawnImpactFx(this.boss.sprite.x, this.boss.sprite.y, impactKind, 0, evolved);
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

  registerKill() {
    this.killCount++;
    // 魔王關不靠擊殺小怪數推進（要打死魔王才會進下一關，見 onBossDefeated），
    // 這裡只負責一般關卡的小怪擊殺數累計。
    if (this.isBossStage(this.stage)) return;
    this.stageKillCount++;
    if (this.stageKillCount >= KILLS_PER_STAGE) this._advanceStage();
  }

  // 關卡推進：一般關擊殺數達標，或魔王關打死魔王時呼叫。存檔點跟著更新到「玩家目前
  // 抵達的關卡」（只會往前推進，見 SaveManager.setCheckpointStage 的實作）。
  _advanceStage() {
    this.stage++;
    this.stageKillCount = 0;
    setCheckpointStage(this.stage);
  }

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
      // 重要修正：一次撿到大量經驗值（例如磁鐵一次吸一整片經驗寶石、或擊敗魔王
      // 補的固定經驗值疊加）可能一口氣跳好幾級，gainExp() 會把每一級都算出來，
      // 但畫面一次只能開一張升級選單——多出來的升級次數以前會被直接吃掉，玩家
      // 明明跳了 3 級卻只選到 1 次強化。現在先排進佇列，等目前這張選完、
      // resumeFromLevelUp() 裡再接著開下一張，一級都不會漏。
      this._pendingLevelUps += leveledUp.length - 1;
      this._openLevelUp();
      return true;
    }
    return false;
  }

  _openLevelUp() {
    // this._levelUpOpen 防止「同一幀內連續撿到好幾顆經驗寶石、每顆都觸發升級」時
    // 重複呼叫 scene.launch('LevelUpScene')——physics.world.pause() 不會中斷當下
    // 這輪同步迴圈，光靠它擋不住同一幀內的重複觸發。
    if (this.gameEnded || this._levelUpOpen) return;
    this._levelUpOpen = true;
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
    this._levelUpOpen = false;
    // 佇列裡還有沒選完的升級次數，馬上接著開下一張，維持暫停狀態不恢復遊戲
    if (this._pendingLevelUps > 0) {
      this._pendingLevelUps--;
      this._openLevelUp();
      return;
    }
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

  // Boss 死亡時由 Boss._die() 呼叫，帶入這隻 Boss 的型態、對應遺物 id 與死亡座標
  onBossDefeated(bossType, relicId, bossX, bossY) {
    if (this.gameEnded) return; // 玩家跟 Boss 同時陣亡就不用再處理擊殺獎勵了
    this.boss = null;
    this.registerKill();
    this.bossKillCount++; // 結算時每隻魔王額外加 5000 分
    this._advanceStage(); // 魔王關要打死魔王才會進下一關
    // 魔王 100% 掉落血包（一般小怪是 10% 機率，見 EnemySystem._killEnemy）
    if (this.healthPackSystem && bossX != null) {
      this.healthPackSystem.forceSpawn(bossX, bossY, true);
    }
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
    const stage = this.getStage();
    // 死亡當下如果升級選單／遺物選擇視窗／開局選技能視窗剛好開著（例如跟 Boss
    // 同歸於盡），這些視窗不會自己關掉，會一直蓋在畫面最上層，看起來像是
    // 「遊戲卡住沒結束」，所以這裡強制把它們也一併關掉，確保一定會看到結算畫面。
    ['UIScene', 'LevelUpScene', 'RelicChoiceScene', 'StartSkillScene'].forEach((key) => {
      try { this.scene.stop(key); } catch (err) { console.error(`[GameScene] 關閉 ${key} 失敗：`, err); }
    });
    // time 只留給結算畫面當「存活時間」資訊顯示用，分數計算已經改用 stage（見
    // GameOverScene 的分數公式），不再吃時間。
    this.scene.start('GameOverScene', { kills, level, time: elapsed, stage, bossKills: this.bossKillCount });
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
    if (this.gameEnded || this._awaitingStartSkill || this._confirmingLeave) return;
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

  // 關卡系統：一般關擊殺滿 KILLS_PER_STAGE 隻小怪、魔王關打死魔王才會推進（見
  // registerKill()/onBossDefeated()/_advanceStage()），this.stage 就是目前關卡數本身。
  getStage() {
    return this.stage;
  }

  isBossStage(stage = this.stage) {
    return stage % BOSS_STAGE_INTERVAL === 0;
  }

  // ================= 特效輔助 =================
  // 通用「爆裂粒子」：從一個點往四周噴出好幾個小碎片，比單張淡出圖案更有份量感
  // 「打擊停頓」(hit stop)：短暫把物理世界的時間流速降到接近凍結，
  // 製造那種「這一拳很重」的手感，取代畫面震動（畫面震動容易讓人頭暈、
  // 也比較廉價，hit stop 是很多動作遊戲慣用的手法）。
  hitStop(duration = 70, scaleTo = 0.05) {
    if (this._hitStopUntil && this.time.now < this._hitStopUntil) return; // 短時間內不重疊觸發，避免疊加卡頓
    // 還原固定寫死回 1（正常速度），不要讀「呼叫當下」的 timeScale 當 prevScale——
    // 遊戲正常運作時 timeScale 本來就該一直是 1，用固定值還原比較保險，不會有
    // 極端情況下讀到還沒還原完的舊值、把時間流速卡在慢動作或凍結的風險。
    this.physics.world.timeScale = scaleTo;
    this._hitStopUntil = this.time.now + duration;
    this.time.delayedCall(duration, () => {
      this.physics.world.timeScale = 1;
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

  // 雷霆套裝五件套專用：打中麻痺中的怪物時，從高空劈下一道閃電打雷特效
  spawnThunderStrikeFx(x, y) {
    const bolt = this.add.image(x, y - 260, 'fx_bolt').setDepth(30002).setOrigin(0.5, 0)
      .setScale(1.4, 5.5).setTint(0xffe066).setAlpha(0.9).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: bolt, alpha: 0, duration: 220, delay: 60, onComplete: () => bolt.destroy() });
    this.spawnGlowRing(x, y, 'fx_bolt', 0xffe066, 0.3, 1.8, 260);
    this.spawnBurstFx(x, y, 0xffe066, 8, 'fx_bolt', 130);
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

  // corpse：擊殺當下那隻怪物的貼圖/朝向/縮放/階級染色（見 EnemySystem._killEnemy）。
  // 原本這裡只有一個小光暈爆閃，怪物本體被物件池瞬間隱藏去重用，玩家看起來就是
  // 「憑空消失」。現在額外複製一份獨立的屍體圖片，播放倒地+縮扁+淡出動畫再銷毀，
  // 跟物件池的重用時機完全分開，不會互相干擾。
  spawnKillFx(x, y, corpse = null) {
    const fx = this.add.image(x, y, 'fx_kill').setDepth(29999).setScale(0.5);
    this.tweens.add({ targets: fx, scale: 1.4, alpha: 0, duration: 300, onComplete: () => fx.destroy() });

    if (corpse && corpse.texture && this.textures.exists(corpse.texture)) {
      const scale = corpse.scale || 1;
      const body = this.add.image(x, y, corpse.texture)
        .setDepth(y - 1).setFlipX(!!corpse.flipX).setScale(scale);
      if (corpse.tint) body.setTint(corpse.tint);
      this.tweens.add({
        targets: body,
        angle: (Math.random() < 0.5 ? -1 : 1) * (75 + Math.random() * 20),
        scaleY: scale * 0.45,
        y: y + 6,
        alpha: 0,
        duration: 400,
        ease: 'Cubic.easeIn',
        onComplete: () => body.destroy(),
      });
    }

    this.spawnBurstFx(x, y, corpse && corpse.tint ? corpse.tint : 0xd0d0d0, 6, 'fx_kill', 70);
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
  // 建立一個「持續跟著玩家」的蒼藍氣場光環，每一幀都重新對齊玩家座標，
  // 而不是只靠間歇性的粒子噴發假裝跟隨。改用玩家提供的正式美術圖 fx_dragon_aura
  // （黑底＋ADD 疊加模式，黑色部分視覺上等於透明），不再沿用共用的 fx_levelup 佔位圖，
  // 也不額外 setTint——原圖本身就是藍/青色調，硬染金色只會把光暈蓋暗。
  enableDragonAuraVisual() {
    this.dragonAuraActive = true;
    this._nextDragonEmberAt = 0;
    if (!this.dragonAuraRing) {
      const tex = this.textures.get('fx_dragon_aura').getSourceImage();
      const baseScale = 150 / tex.width;
      this._dragonAuraBaseScale = baseScale;
      this.dragonAuraRing = this.add.image(this.player.sprite.x, this.player.sprite.y, 'fx_dragon_aura')
        .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.6).setScale(baseScale).setDepth(9997);
      this.tweens.add({
        targets: this.dragonAuraRing,
        scale: { from: baseScale * 0.85, to: baseScale * 1.2 },
        alpha: { from: 0.45, to: 0.75 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    this.dragonAuraRing.setVisible(true);
  }

  // 每幀更新：把光環釘在玩家目前座標上（永遠跟著玩家跑），
  // 並每隔一小段時間補幾顆往上竄的藍色能量粒子，強化「持續繚繞」的感覺
  _updateDragonAura(time) {
    if (!this.dragonAuraActive) return;
    const p = this.player.sprite;
    this.dragonAuraRing.setPosition(p.x, p.y);
    this.dragonAuraRing.setDepth(p.depth - 1);
    if (time >= this._nextDragonEmberAt) {
      this._nextDragonEmberAt = time + 220;
      this.spawnEmbersFx(p.x, p.y, 2, 0x66e0ff);
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
      // 錨點原本設在貼近圖片頂端（0.18），角色又只有 32x25.5 這麼小一隻，圖片
      // 82% 的面積都畫在錨點下方，實際看起來翅膀整坨往角色下方（腳邊）垂，而不是
      // 貼在背後——改成錨點抓在圖片高度 32% 左右（兩片翅膀交會關節再往下一點），
      // 上下面積比較平均，才會是「翅膀從背後展開」而不是「掛在腳下」的感覺。
      this.dragonWingPair = this.add.image(this.player.sprite.x, this.player.sprite.y, 'fx_dragon_wing_pair')
        .setOrigin(0.5, 0.32).setDisplaySize(displayW, displayH).setDepth(9996);
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
    // 錨點再往上拉一點（配合上面 origin 從 0.18 改成 0.32），讓翅膀整體貼在角色
    // 背後、上下均勻展開，而不是重心偏低垂在角色下方
    this.dragonWingPair.setPosition(p.x, p.y - 22);
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
      // 以下三種是融合武器專屬命中特效，刻意比同系武器的「進化版」規格再往上加一截
      // （更大的縮放/更多碎片/多疊一層光環），呼應融合武器本來就比單一進化更稀有。
      case 'electroKnife': {
        // 改用正式美術圖（藍白電光+金色電花的斜向閃電）取代借用的十字爆閃圖示
        const fx = this.add.image(x, y, 'proj_electroknife').setDepth(29999).setScale(0.7).setAlpha(0.95);
        this.tweens.add({ targets: fx, scale: 0.7 * 1.9, alpha: 0, duration: 180, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_bolt', 0x7ef7ff, 0.35, 2.3, 260);
        this.spawnBurstFx(x, y, 0xffe94d, 9, 'fx_bolt', 130); // 黃色電花混在藍白碎片裡，呼應圖示配色
        this.spawnBurstFx(x, y, 0xdfefff, 6, 'fx_crit', 100);
        break;
      }
      case 'bloodStorm': {
        // 改用正式美術圖（血紅色旋轉刀刃圖騰）取代借用的十字爆閃圖示
        const fx = this.add.image(x, y, 'fx_bloodstorm').setDepth(29999).setScale(0.55).setAlpha(0.95);
        this.tweens.add({ targets: fx, scale: 0.55 * 2, alpha: 0, duration: 160, onComplete: () => fx.destroy() });
        this.spawnGlowRing(x, y, 'fx_crit', 0xff5050, 0.3, 2, 200);
        this.spawnBurstFx(x, y, 0xff8f8f, 9, 'fx_crit', 120);
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
  // outermost：進化版六方向冰柱中「離玩家最遠那一圈」——做得比其他冰柱更大，
  // 命中時直接冰凍（而不只是緩速），當作進化冰霜新星收尾的重擊。
  spawnIcePillar(x, y, dmg, slowDuration, critRate, critDmg, knockback, evolved = false, outermost = false) {
    // 地面裂痕／冰霜擴散提示，讓玩家注意到冰柱要冒出來的位置
    const crack = this.add.image(x, y, 'fx_frost').setDepth(y - 1).setScale(evolved ? (outermost ? 0.55 : 0.4) : 0.25).setAlpha(0.6);
    crack.setTint(evolved ? 0x8fd6ff : 0x8fe3ff);
    this.tweens.add({ targets: crack, scale: evolved ? (outermost ? 2.4 : 1.9) : 1.3, alpha: 0, duration: 260, onComplete: () => crack.destroy() });

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
    // 進化版原圖是 283x420 的高聳冰柱（跟一般版 160x190 的瘦長冰柱同款畫風，只是
    // 更高更尖），縮放倍率調到讓它比一般版高上約 1.4 倍，跟命中半徑（evolved 50 /
    // 一般 36）的比例搭起來，視覺上有「進化後更巨大」的份量感。outermost 再放大
    // 一截，跟「直接冰凍」的效果份量對上。
    const pillarScale = evolved ? (outermost ? 0.35 * 1.4 : 0.35) : 0.55;
    const pillar = this.add.image(x, y, pillarTexture).setOrigin(0.5, 1).setDepth(y + 1).setScale(pillarScale, pillarScale * 0.05).setAlpha(0.95);

    this.tweens.add({
      targets: pillar,
      scaleY: pillarScale,
      duration: 150,
      ease: 'Back.easeOut',
      onComplete: () => {
        if (!pillar.active) return;
        // 冰柱冒出的瞬間造成傷害＋減速（outermost 額外直接冰凍）＋擊退
        const hitRadius = evolved ? (outermost ? 65 : 50) : 36;
        this.enemySystem.queryNear(x, y, hitRadius, (e) => {
          if (dist(x, y, e.x, e.y) > hitRadius) return;
          this.enemySystem.damageEnemy(e, dmg, critRate, critDmg, knockback ? {
            fromX: x, fromY: y, force: knockback.force, duration: knockback.duration,
          } : null);
          this.enemySystem.applySlow(e, slowDuration);
          if (outermost) this.enemySystem.applyFreeze(e, 1200);
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
