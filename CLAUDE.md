# CLAUDE.md — 像素求生 Pixel Survivors

給協作時快速對齊用的專案摘要。程式碼細節以實際檔案為準，這份文件只記錄「找檔案的捷徑」與「不成文的規則」。

## 專案環境

- **技術**：Phaser 3.70.0（CDN 載入，無 build 工具）＋ 原生 JavaScript ES6 Module
- **部署**：GitHub Pages — `https://amperessr.github.io/pixel-survivors/`
- **後端**：Firebase Realtime Database（不是 Firestore），排行榜與帳號存讀，設定在 `src/firebase/firebase.js`
- **解析度**：1920×1080，`Phaser.Scale.FIT` 自動縮放
- **本機測試**：不可雙擊 `index.html`（ES6 Module 會被瀏覽器 CORS 擋掉）。用 `npm start`（內建 http-server，port 8080）
- 沒有測試框架、沒有 build step，改完程式碼重新整理瀏覽器就能看到結果

## 目錄結構

```
main.js         匯入全部 Scene、建立 Phaser.Game
index.html / style.css
src/
  scenes/       BootScene(素材preload+TextureFactory生成) → MainMenuScene → GameScene
                ⇄ UIScene / LevelUpScene / RelicChoiceScene → GameOverScene
                另有 InventoryScene／ShopScene／MailboxScene／StartSkillScene／
                ActivitySelectScene（活動關卡選擇）／LootBallOpenScene（開自選神話/傳說球）
  player/       Player.js：設定與數值、移動/衝刺
  enemy/        EnemyData.js（怪物資料）／EnemySystem.js（AI、物件池、空間網格）
  boss/         Boss.js：五種常駐 Boss 型態與招式／WoofBoss.js：汪汪大作戰限定魔王（四招各自CD）
  weapons/      WeaponData.js（數值/進化/擊退設定）／WeaponSystem.js（開火邏輯）
  skills/       PassiveData.js：被動能力
  equipment/    EquipmentData.js：裝備與戒指資料（商店/扭蛋/傳說/活動自選球）
  relics/       RelicData.js：擊敗 Boss 後的遺物二選一
  activities/   ActivityData.js（活動開放/結束時間、封測名單、活動清單）／
                WoofWarRewardSystem.js（活動結束後個人化結算獎勵，動態產生信件）
  managers/     ObjectPool.js／AudioManager.js／SaveManager.js（localStorage存檔+帳號同步）
  systems/      TextureFactory.js（Canvas程式生成美術，尚未換正式圖的素材）／
                MapGenerator.js（無限地圖）／HealthPackSystem.js／MagnetSystem.js
  firebase/     firebase.js：Realtime Database 讀寫
  utils/        MathUtils.js／TextStyle.js（統一字型樣式）
assets/         正式美術圖，見下方「美術資產規範」
```

> `README.md` 裡寫的 `assets/images/{player,enemy,boss,...}` 分類子資料夾是舊版規劃，
> **實際 `assets/` 是單層平面資料夾**，所有 PNG 直接放在 `assets/` 下，不要照 README 建子目錄。

## 美術資產規範

- **位置**：`assets/`（平面資料夾，無子目錄），共約 150+ 張正式 PNG
- **載入方式**：全部集中在 `src/scenes/BootScene.js` 的 `preload()`，用
  `this.load.image(textureKey, 'assets/檔名.png')`，texture key 通常等於檔名（不含副檔名）
- **檔名 = texture key 命名慣例**（新增素材請照這個規則取名，才能跟現有程式碼邏輯對上）：
  | 前綴 | 說明 |
  |---|---|
  | `boss_xxx.png` | Boss 正式圖，如 `boss_black`／`boss_red`／`boss_demon`／`boss_treant`／`boss_griffin` |
  | `equip_{slot}_{tier}.png` | 商店裝備，`slot`=weapon/helmet/clothes/pants/shoes，`tier`=beginner/mid/high |
  | `equip_{slot}_g{01-20}.png` | 扭蛋一般裝備，5 部位 × 20 款 |
  | `equip_legendary_{slot}_{theme}.png` | 傳說套裝，`theme`=flame/ice/holy/wind/thunder |
  | `weapon_xxx_lv5.png` / `proj_xxx.png` | 融合武器與其彈道正式圖 |
  | `fx_xxx.png` | 特效圖，如 `fx_bloodstorm`／`fx_ice_pillar_evo` |
  | `ring_xxx.png` / `player_xxx.png` | 戒指、玩家角色圖 |
- **新素材來源**：先檢查 `D:\遊戲檔案\素材`，原始未裁切素材通常放在那，裁切/去背後才丟進 `assets/`
- **尚未有正式圖的素材**：由 `src/systems/TextureFactory.js` 用 Canvas 動態生成頂替。要換成正式圖時，
  只需把 `TextureFactory` 裡對應的 `createCanvas(...)` 邏輯移除，改到 `BootScene.preload()` 加一行
  `load.image(...)` 即可無痛替換（`AudioManager.js` 音效同理，改 `load.audio(...)`）

## 程式碼風格

- ES6 Module（`import`/`export`），2 空格縮排，單引號字串，行尾加分號
- Scene 統一寫法：`export default class XxxScene extends Phaser.Scene { constructor() { super('XxxScene'); } ... }`
- 資料與邏輯分離：純數值/設定放 `XxxData.js`（大寫常數或物件字面量），行為邏輯放 `XxxSystem.js`
- 中文註解只寫「為什麼」（平衡數值調整原因、繞過某個 bug 的權宜設計），不寫「做了什麼」；
  變數/函式命名維持英文
- 新功能優先重用既有 Manager/System（`ObjectPool`、`TextureFactory`、`AudioManager`），不重複造輪子

## 協作規則

- 協作者：安培
- 動作流程：先確認要怎麼修改，絕對要詢問是否要上傳(git push)，我確認後才動手；只有我說「上傳」才執行 git push
- 本機驗證：`npm start` 後開 `http://localhost:8080` 手動測試（純前端，沒有自動化測試）

## 省 Token 協作建議

- 直接說要改哪個系統/檔案（例如「改 WeaponSystem 的擊退邏輯」），不用重貼程式碼，我會自己找
- 若已經知道大概位置，給 `檔案路徑:行號` 比貼整段程式碼省 token
- 美術需求一次講清楚 slot/tier/主題，可以一次生成 `BootScene` 載入程式碼＋正確命名，不用來回確認命名規則
- 新增新的資料夾/系統時提醒我更新這份 `CLAUDE.md`，避免文件跟程式碼脫節
- 大改動前可以先用「條列想法」代替「完整需求描述」，我會回問缺的細節，比一次寫長文更省來回
