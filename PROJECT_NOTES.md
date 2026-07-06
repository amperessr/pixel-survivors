# 像素求生 Pixel Survivors — 專案參考文件

> 這份文件是給 Claude（或任何協作者）快速理解專案現況用的參考摘要，
> 放進 Project 的知識庫後，之後開新對話不需要重新貼程式碼或重新解釋設計決策。
> 完整原始碼請參考同一批上傳的 zip 檔（`pixel-survivors-roguelike.zip`）。

## 專案基本資訊

- **類型**：Roguelike 生存遊戲（類 Vampire Survivors），繁體中文介面
- **技術**：純 HTML + CSS + JavaScript（ES6 Module）＋ Phaser 3.70.0（CDN 載入，無 build 工具）
- **部署位置**：GitHub Pages，網址 `https://amperessr.github.io/pixel-survivors/`
- **排行榜**：Firebase Realtime Database（非 Firestore），DB URL：
  `https://game-text-cd3c2-default-rtdb.asia-southeast1.firebasedatabase.app/`
- **美術／音效**：全部用 Canvas 程式動態產生（`TextureFactory.js`）與 Web Audio 合成
  （`AudioManager.js`），沒有任何外部圖檔/音檔，避免了下載體積與版權問題
- **解析度**：遊戲畫布 1920×1080，`Phaser.Scale.FIT` 自動縮放配合各種螢幕
- **本機測試**：不可雙擊 `index.html`（ES6 Module 會被 CORS 擋），需用
  `npm start`（內建 http-server）或任何本機靜態伺服器開啟

## 資料夾結構

```
src/
  scenes/     BootScene(素材產生) → CharacterSelectScene → GameScene ⇄ UIScene/LevelUpScene → GameOverScene
  player/     Player.js：四職業設定、數值、移動/衝刺、頭上血條
  enemy/      EnemyData.js（4種怪+強度分級）／EnemySystem.js（物件池、AI、空間網格）
  boss/       Boss.js：黑藍西方龍，三種技能
  weapons/    WeaponData.js（5武器數值+進化+擊退設定）／WeaponSystem.js（開火邏輯）
  skills/     PassiveData.js：5種被動能力
  managers/   ObjectPool.js／AudioManager.js／SaveManager.js（localStorage 玩家名）
  systems/    TextureFactory.js（全部美術）／MapGenerator.js（無限地圖）／HealthPackSystem.js（血包）
  firebase/   firebase.js：Realtime Database 排行榜讀寫
  utils/      MathUtils.js／TextStyle.js（統一粗體黑體字型）
```

## 核心系統重點

### 角色（4 種，`src/player/Player.js` 的 `CHARACTERS`）
| id | 名稱 | 稱號 | 加成 |
|---|---|---|---|
| attacker | 4M | 飛過去扁你 | ATK+40%／HP-10%／DEF-10% |
| speedster | 跩跩 | 1000元內隨便拿 | 速度+40%／攻速+25%／ATK-15% |
| tank | 汪汪 | 大主管 | HP+40%／DEF+40%／速度-20% |
| balanced | 基本款 | 無 | 全能力均衡成長 |

### 武器系統（5 種，`src/weapons/WeaponData.js` + `WeaponSystem.js`）
每種 5 級，滿級後可再「進化」成更強版本（金色特效標示）：

| 武器 | 進化名稱 | 聯動屬性 |
|---|---|---|
| 火球術 fireball | 隕石燄爆 | Attack 越高 → 體積/爆炸範圍越大 |
| 雷電鎖鏈 lightning | 雷霆風暴 | CritRate 越高 → 分裂數越多；特效改成「史提克彈簧刀」風格電光藍白鋸齒連鎖閃電 |
| 旋風飛刀 knife | 旋風飛刃 | AttackSpeed 越高 → 數量越多 |
| 旋轉鋸片 sawblade | 狂暴鋸輪 | AttackSpeed 越高 → 轉速越快 |
| 冰霜新星 frost | 永凍冰川 | Defense 越高 → 範圍越大；**已改版**：不再是原地一次性 AOE，而是冰柱從地板冒出的機制（見下方） |

**冰霜技能機制（重要，2024 最新版）**：
- 一般：從玩家位置往「最近敵人方向」，一根接一根（間隔 120ms）冒出冰柱
- 進化：6 根冰柱同時以玩家為中心向外環狀噴發
- 實作在 `GameScene.spawnIcePillar()`：冰柱用 `Back.easeOut` 做出從地面刺出的彈跳動畫，
  冒出瞬間才造成傷害/減速/擊退，停留一小段時間後縮回消失
- 冰柱貼圖：`fx_ice_pillar`（`TextureFactory.generateIcePillars()`）

**雷電特效（重要）**：命中後往下一個目標跳躍時，會用 `GameScene.spawnChainLightningFx()`
在兩點之間畫一道鋸齒狀、疊加（ADD）混合模式的電弧，顏色改成電光藍白（`0x7ef7ff`），
模仿英雄聯盟「史提克彈簧刀」電刀連鎖閃電的視覺（原本是黃色系）。

**擊退系統**：`WEAPON_KNOCKBACK`（WeaponData.js）定義各武器擊退力道，
`EnemySystem.damageEnemy()` 的第 5 個參數 `knockback = {fromX, fromY, force, duration}`，
敵人身上會記錄 `knockbackUntil/knockbackVX/VY/knockbackDuration`，
在 `EnemySystem.update()` 的移動迴圈中優先套用擊退速度（會隨時間衰減），
擊退期間敵人暫停追擊玩家。Boss 不受擊退影響。

### 被動能力（5 種，`src/skills/PassiveData.js`）
Attack／CritRate／CritDmg／AttackSpeed／MoveSpeed，各 5 級。

### 升級系統（`LevelUpScene.js`）
三選一：新武器／武器升級／被動強化，武器滿五級後選項變成「⭐ 進化！」（金色外框強調）。

### 敵人與強度分級（`EnemyData.js` + `EnemySystem.js`）
4 種基礎怪（史萊姆/哥布林/骷髏/獸人）× 3 種強度：
- 一般（normal）：數值 ×1，經驗 ×1
- 菁英（elite）：數值 ×1.7，經驗 ×3，金色染色，體型 ×1.18
- 稀有（rare）：數值 ×2.8，經驗 ×8，粉紫染色，體型 ×1.4

強度出現機率隨遊戲時間增加（`rollEnemyTier()`）。經驗寶石體積/顏色依經驗值大小變化。

**效能優化**：`EnemySystem` 用空間網格（`grid`, 96px 一格）分區塊查詢附近怪物，
武器碰撞判定改用 `queryNear()` 而非每幀掃描全部怪物（原本 O(子彈數×怪物數) 暴力運算
在怪物多時會造成掉幀，這是後來抓到的「怪物看起來消失」的可能成因之一）。

### Boss（`src/boss/Boss.js`）
- 造型：黑藍色系西方龍，128×128 高解析度材質（`TextureFactory.generateBoss()`），
  翅膀/龍角/發光冰藍雙眼/背脊尖刺/捲曲尾巴
- 體型：`BOSS_SCALE = 2.1`，顯示約 269px，確保至少是一般小怪的 5 倍以上
- 三種技能：衝撞（charge）／範圍衝擊波（aoe）／**龍息遠距攻擊（ranged）**——
  已改版成朝玩家方向的扇形彈幕（非原本 360 度亂射），並有噴發視覺效果，更像龍在攻擊
- 每 5 分鐘出現一次，血條在畫面上方固定顯示
- 登場/範圍技/死亡都有對應的鏡頭震動與爆炸特效

### 血包系統（`src/systems/HealthPackSystem.js`，新增功能）
地圖上每 16~26 秒隨機在玩家探索範圍邊緣生成愛心血包（最多同時 3 個），
走過去自動回復 30% 最大生命值，有浮動動畫與拾取特效（`GameScene.spawnHealFx()`）。

### 特效系統（`GameScene.js` 內一系列 `spawn*Fx` 方法）
- `spawnBurstFx`：通用爆裂碎片噴射
- `spawnEmbersFx`：火焰餘燼（往上飄的小火星，用於火球命中）
- `spawnGlowRing`：疊加（ADD）混合模式的發光外環，各元素技能命中/施放都會用
- `spawnChainLightningFx`：史提克彈簧刀風格連鎖閃電
- `spawnIcePillar`：冰柱地刺
- `spawnCastFx` / `spawnImpactFx`：各武器出招瞬間／命中瞬間特效，`evolved` 參數會套用金色進化版特效
- 每種元素都有對應配色：火＝橘紅、雷＝電光藍白（`0x7ef7ff`）、冰＝淺藍、進化統一金色（`0xffe066`）
- **火球爆炸已移除鏡頭震動**（使用者反應太干擾），Boss 相關的震動有保留

### UI（`UIScene.js`）
- 左上：HP 血條／等級／經驗條
- 右上：時間／擊殺數／FPS
- **右側：技能面板**——用 `ui_panel` 材質做出真正的邊框面板，「技能」二字在框內置頂，
  面板高度依目前擁有的武器數量自動伸縮（`_refreshWeaponPanel()` 動態 `setDisplaySize`）
- 下方：角色能力數值列
- ESC 暫停遮罩：用 `gs.escPaused` 旗標控制（跟升級選單的暫停分開，避免暫停畫面卡住不消失）
- 全部文字統一用 `src/utils/TextStyle.js` 的 `textStyle()`，套用系統粗體黑體字型
  （微軟正黑體／蘋方／Noto Sans TC），避免預設西文字型太細看不清楚

### 地圖（`MapGenerator.js`）
無限生成、8×8 tile 為一個 chunk，動態載入/卸載。**重要 bug 修正**：
地板深度必須用極大負數固定值（`FLOOR_DEPTH = -1e9`），不可用小數字（例如原本的 -10），
否則玩家/怪物只要走到世界座標 Y 為負值（往上移動一點點就會發生）時，
用 Y 座標當深度排序會讓角色深度比地板還低，整隻怪物會被畫在地板下面而完全消失。
玩家與 Boss 的深度也改成動態跟隨 Y 座標（`sprite.setDepth(y)` 每幀更新），避免類似問題。

## 已修過的重要 Bug（避免之後重蹈覆轍）

1. **GameOverScene 曾經覆蓋 Phaser 內建的 `this.time`**：導致計時/結算功能出錯。
   現在存活秒數用 `this.playTime`，絕對不要用 `this.time` 存自訂資料。
2. **暫停遮罩卡住不消失**：升級選單也會觸發暫停，但舊版遮罩只認 ESC 觸發的暫停。
   現在用獨立的 `escPaused` 旗標，跟 `paused`（遊戲邏輯暫停）分開。
3. **地板深度排序 bug**（見上方地圖說明）——這是「怪物消失」的主要真正原因。
4. **火球 AOE 在同一幀對同一批敵人重複引爆**：原本穿透判斷寫在「每個敵人」的迴圈裡，
   導致火球停留在範圍內的每一幀都重複造成傷害。現在用 `exploded` 旗標確保只在命中當下引爆一次。
5. **飛刀/雷電對同一敵人多幀重複命中**：加上每顆投射物自己的 `hitSet`（Set）記錄已命中對象。
6. **武器攻速被動不會即時反映冷卻**：原本用 Phaser Timer Event 建立時就固定冷卻時間，
   之後屬性提升也不會重算。現在改成每次開火時「即時計算」冷卻（`_scaledCooldown`）。
7. **Firebase 排行榜監聽器沒清除**：切換場景時忘記 unsubscribe，會累積監聽器。
   現在在 `scene.events.once('shutdown', ...)` 裡呼叫 unsubscribe。
8. **Canvas 動態材質預設會模糊**：`pixelArt:true` 設定不會自動套用到跑時用
   `textures.createCanvas()` 產生的材質，必須手動 `tex.setFilter(Phaser.Textures.FilterMode.NEAREST)`
   （已包 try/catch 防止萬一失敗連累其他材質生不出來）。
9. **CJK 文字自動換行失效**：Phaser 預設 `wordWrap` 只在空白字元處斷行，中文沒有空白，
   長一點的說明文字會整段擠成一行衝出卡片外。必須加上 `useAdvancedWrap: true`。
10. **Boss 打死一半仍在播 AOE 動畫時整個遊戲卡死**：`Boss._startAoe()` 的環形特效要播 700ms，
    這段期間玩家可能用其他武器把 Boss 打死（`_die()` 已經 `sprite.destroy()`），
    但特效播完的 callback 沒檢查 `this.alive` 就直接讀取 `this.sprite.x/y`，
    對已銷毀的 GameObject 存取座標會拋例外，讓 Phaser 的 update 迴圈整個中斷。
    修法：callback 開頭一定要 `if (!this.alive) return;`。
    `GameScene.update()` 現在也額外包了一層 try/catch（`_update()`），
    任何未預期例外只會印到 console、跳過那一幀，不會再讓整個遊戲卡死。

## 這幾輪新增的系統（累積更新，供下次接手快速掌握）

- **磁鐵系統**（`src/systems/MagnetSystem.js`）：跟血包系統同一套邊緣生成邏輯，但更稀有
  （35~55 秒、同時最多 1 個）。撿到後呼叫 `EnemySystem.activateMagnet()`，
  接下來 1.6 秒內地圖上所有經驗寶石都會強制飛向玩家（`EnemySystem.update()` 內
  `magnetActive` 分支，無視距離、越遠飛越快）。
- **Boss 血條數字**：`Boss.js` 的 `hpText` 疊在血條中央即時顯示目前/最大 HP。
- **怪物強化倍率曲線**（`EnemyData.js` 的 `enemyScalingMultiplier()`）：
  0min 1.0x／3min 1.3x／5min 1.8x／7min 2.6x／10min 5.0x（線性插值），
  超過 10 分鐘後改成每分鐘固定 +1.0x（11min 6.0x／12min 7.0x…）。
  `EnemySystem._resetEnemy()` 的 HP 與傷害都套用同一條曲線。
- **被動技能上限拉到 10 級**（`PassiveData.js` 的 `MAX_PASSIVE_LEVEL`），
  武器仍是 5 級＋1 進化。所有技能都點滿後，升級選單抽不到選項時會自動補「血包」
  （`LevelUpScene._buildOptions()` 的 fallback，圖示/文案都是血包主題）。
  五個被動的說明文字現在都會明講「每級提升多少數值」＋聯動的武器效果。
- **火球術進化「隕石燄爆」改版**：不再沿地面飛行，改成鎖定敵人位置後從天而降砸隕石
  （`GameScene.spawnMeteorStrike()`，獨立於一般投射物池與碰撞系統之外，
  警戒圈→隕石墜落→落地爆炸三段式）。`WeaponSystem._fireFireball()` 的
  `data.evolved` 分支會呼叫這個方法，一般版火球邏輯不變。
- **冰霜新星進化版視覺調整**：進化版不再套用其他武器共用的金色進化色，
  改用更亮的冰藍白（`0xbfe9ff`）維持藍色調性；動畫節奏改成跟一般版一樣
  「由內到外」分 4 階段冒出，只是同時往 6 個方向（六邊形）噴發
  （`WeaponSystem._fireFrost()` 的 evolved 分支、`GameScene.spawnIcePillar()`）。
- **雙 Boss 型態輪替**（`Boss.js` 的 `BOSS_TYPES`）：黑藍巨龍（冰息）與血色紅龍（火息）
  依 `GameScene.bossSpawnCount` 輪流出現，每 5 分鐘一隻（`BOSS_INTERVAL_MS`不變）。
  紅龍是同一份貼圖直接染紅（`baseTint`），受傷閃白／充能結束後都要呼叫
  `_restoreTint()` 恢復對應底色，不能直接 `clearTint()`（否則紅龍會被洗回原色）。
- **遺物系統**（`src/relics/RelicData.js` + `src/scenes/RelicChoiceScene.js`）：
  擊敗 Boss 後跳出通用的二選一彈窗（取代原本寫死的 DragonAuraScene），
  依 `Boss.relicId` 帶入對應遺物資料。黑藍巨龍給「龍之光環」（HP／攻擊力 x2，
  `Player.applyDragonAura()`），紅龍給「龍之翼」（移動速度 x2，
  `Player.applyDragonWings()`）。每個遺物只能拿一次：`GameScene.onBossDefeated()`
  會先檢查 `relic.hasIt(player)`，已經有了就不會再跳出詢問。
  接受後 `GameScene` 會建立一個「每幀都重新對齊玩家座標」的持續光環視覺
  （`enableDragonAuraVisual()` / `enableDragonWingsVisual()` + 對應的
  `_updateDragonAura()` / `_updateDragonWings()`），不是只靠間歇性粒子噴發假裝跟隨。
  若擊殺 Boss 的經驗值剛好觸發升級，會先讓 `LevelUpScene` 跑完，
  透過 `_pendingRelic` 排隊，等升級選單關閉後才跳遺物視窗，避免兩個彈窗疊在一起。
- **技能面板圖示超框修正**（`UIScene._refreshWeaponPanel()`）：圖示改用固定
  `setDisplaySize()`（不再用 `setScale()` 直接放大原始材質，否則等級越高圖示越大越容易爆框），
  且每一列的 y 座標改成置中在該列區塊內（`i*rowH + rowH/2`），
  修正第一列圖示中心點卡在標題分隔線、上半部超出面板框的問題。
- **Boss 強度改用「第幾隻王」計算，不再用存活分鐘數線性公式**：`Boss.js` 的
  `bossStrengthMultiplier(bossIndex)` 走費氏數列變體（1, 2, 3, 5, 8, 13, 21...），
  對應第 1～N 隻王（每 5 分鐘一隻）：5min 1x／10min 2x／15min 3x／20min 5x／25min 8x…，
  HP 與傷害都套用同一個倍率。`GameScene` 用 `bossSpawnCount` 算出 `bossIndex` 傳進去。
- **隕石落地不再有鏡頭震動**（`GameScene.spawnMeteorStrike()`），跟一般火球一樣避免過度干擾。
- **鋸片轉速公式調整**：原本 `1 + atkSpeed * 0.3` 沒有上限，被動攻速衝到高等級時
  （被動上限拉到 10 級後單一被動就 +80）會讓鋸片轉速誇張到 25 倍以上。
  改成係數 0.02＋硬上限 3.5 倍（`WeaponSystem.update()` 內鋸片更新區塊），數值更合理。


## 設計常數速查

- 鏡頭縮放：`GameScene.create()` 裡 `this.cameras.main.setZoom(2.1)`
- 怪物生成半徑：`EnemySystem._computeSpawnRadius()` 依鏡頭實際可視範圍動態計算，
  確保怪物一定在畫面外生成，不會憑空冒出
- Boss 出現間隔：每 5 分鐘（`BOSS_INTERVAL_MS`）
- 血包生成間隔：16~26 秒隨機，同時最多 3 個（`HealthPackSystem.js` 的 `MIN/MAX_INTERVAL`／`MAX_PACKS`）
- 怪物上限：500 隻（`EnemySystem.js` 的 `MAX_ENEMIES`）

## Firebase 安全規則提醒

若排行榜讀寫失敗，記得到 Firebase Console → Realtime Database → 規則，
至少要開放 `leaderboard` 節點的讀寫（範例規則在 README.md 裡）。

## 已知可以繼續加強的方向（尚未做）

- 更多敵人種類、更多武器
- 手機觸控操作支援（目前只有 WASD + 滑鼠）
- 若要上架手機 App：程式碼不需重寫，用 Capacitor 把網頁包裝成 Android/iOS App 是最快的路徑
  （比重寫成 Unity 快很多），但最終編譯 APK／上架仍需要使用者自己的電腦上有 Android Studio
  （iOS 則需要 Mac + Xcode + Apple 開發者帳號），無法在這個純文字沙盒環境完成
