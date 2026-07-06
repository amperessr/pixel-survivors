# 像素求生 Pixel Survivors

一款以 **Phaser 3 + 原生 JavaScript ES6 Module** 打造的 Roguelike 生存遊戲，
玩法參考 Vampire Survivors / Brotato / 20 Minutes Till Dawn 等作品但非直接複製。

## 特色

- 4 種初始角色（攻擊型 / 速度型 / 防禦型 / 平衡型）
- 5 種武器 × 5 階進化（火球術、雷電鎖鏈、旋風飛刀、旋轉鋸片、冰霜新星）
- 5 種被動能力 × 5 階（攻擊力、爆擊率、爆擊傷害、攻速、移速）
- 武器與能力值聯動的 Build 系統（例如 Attack 越高，火球越大、爆炸範圍越大）
- 每次升級三選一（新武器 / 武器升級 / 被動強化）
- 無限生成 Tile 地圖（草地、小路、河流、樹木、石頭、花）
- 5 種一般敵人 + Boss（三種技能：衝撞／範圍攻擊／遠距攻擊），每 5 分鐘登場一次
- 全部美術素材以 Canvas 程式動態繪製，無任何 Placeholder 圖片
- 全部音效以 Web Audio API 即時合成（攻擊、擊殺、升級、Boss、BGM）
- Object Pool 效能優化，支援 500 隻怪物 + 100 發子彈同屏並維持流暢度
- Firebase **Realtime Database**（非 Firestore）即時 TOP10 排行榜

## 操作方式

| 按鍵 | 功能 |
|---|---|
| W / A / S / D | 移動 |
| 滑鼠 | 瞄準方向（部分武器自動鎖定最近敵人） |
| 左鍵 | （武器為自動攻擊，保留擴充手動攻擊用） |
| Space | 衝刺（短暫無敵＋加速） |
| ESC | 暫停 / 繼續 |

## 本機執行

本專案不需要任何建置工具（build step），純瀏覽器 ES6 Module + CDN 載入 Phaser 3。

```bash
# 方式一：使用內建 http-server（需要 Node.js）
npm install
npm start
# 開啟瀏覽器造訪 http://localhost:8080

# 方式二：使用任何靜態伺服器皆可，例如
npx serve .
# 或使用 VSCode 的 Live Server 套件
```

> ⚠️ 由於使用 ES6 Module (`type="module"`)，**不可直接雙擊開啟 index.html**（file:// 協定會被瀏覽器的 CORS 政策阻擋），
> 必須透過任一種本機伺服器方式開啟。

## 部署

### GitHub Pages

1. 將本資料夾內容 push 到 GitHub repository
2. 到 repository 設定 → Pages → Source 選擇你的分支（例如 `main`）與根目錄 `/`
3. 幾分鐘後即可透過 `https://<你的帳號>.github.io/<repo名稱>/` 存取

### Vercel

```bash
npx vercel --prod
```

或直接在 Vercel 後台 Import 此 GitHub repository，Framework Preset 選擇 **Other**，
Build Command 留空，Output Directory 設為 `.`（根目錄）即可。

## Firebase 排行榜

本專案使用 **Firebase Realtime Database**（未使用 Firestore），設定於：

```
src/firebase/firebase.js
```

資料庫 URL：

```
https://game-text-cd3c2-default-rtdb.asia-southeast1.firebasedatabase.app/
```

流程：

1. 玩家第一次進入遊戲時會跳出輸入名稱視窗，名稱會存入 `localStorage`，之後不會再次詢問
2. 遊戲結束時自動上傳 `{ name, score, kill, time, date }` 至 `leaderboard` 節點
3. 角色選擇畫面與遊戲結束畫面都會透過 `onValue()` 即時監聽 TOP10 排行榜並自動更新畫面

> 若你的 Firebase Realtime Database 安全規則為預設鎖定狀態，請至 Firebase Console →
> Realtime Database → 規則，暫時開放讀寫（或依需求設計你自己的安全規則）：
> ```json
> {
>   "rules": {
>     "leaderboard": {
>       ".read": true,
>       ".write": true
>     }
>   }
> }
> ```

## 專案結構

```
.
├── assets/                 # 素材資料夾（分類保留，實際素材以程式動態生成）
│   ├── images/{player,enemy,boss,weapons,effects,ui,tiles,backgrounds,icons}
│   ├── audio/{bgm,sfx,boss}
│   ├── fonts/
│   └── shaders/
├── src/
│   ├── scenes/              # BootScene / MainMenuScene / InventoryScene / ShopScene / GameScene / UIScene / LevelUpScene / RelicChoiceScene / GameOverScene
│   ├── player/               # Player.js：角色數值、四職業設定、移動與衝刺
│   ├── enemy/                 # EnemyData.js / EnemySystem.js：怪物 AI 與物件池
│   ├── boss/                  # Boss.js：黑藍巨龍／血色紅龍兩種型態，三種技能與血條
│   ├── weapons/               # WeaponData.js / WeaponSystem.js：五武器五階＋進化與聯動
│   ├── skills/                # PassiveData.js：五被動十階
│   ├── relics/                # RelicData.js：擊敗 Boss 後可拿取的永久遺物（龍之光環／龍之翼）
│   ├── equipment/             # EquipmentData.js：裝備系統（武器/頭盔/衣服/褲子/鞋子），商店與背包共用
│   ├── ui/                    # （保留擴充：可拆分更細的 UI 元件）
│   ├── firebase/              # firebase.js：Realtime Database 排行榜
│   ├── managers/               # ObjectPool.js / AudioManager.js / SaveManager.js
│   ├── systems/                # TextureFactory.js（Canvas 程式生成美術）/ MapGenerator.js（無限地圖）/ HealthPackSystem.js / MagnetSystem.js
│   └── utils/                  # MathUtils.js
├── docs/
├── save/
├── dist/
├── index.html
├── style.css
├── main.js
├── package.json
└── README.md
```

## 效能設計

- 所有怪物、子彈、經驗寶石皆使用 `ObjectPool`（見 `src/managers/ObjectPool.js`）避免頻繁 GC
- 地圖以 8×8 tile 為一個 chunk，僅載入玩家周圍的 chunk，並卸載過遠的 chunk
- Boss 遠距攻擊彈幕使用限時自動銷毀，避免物件無限累積

## 已知限制與可擴充方向

- 美術與音效皆為程式生成之簡化版本（依需求規格的 Canvas / Web Audio 動態生成），
  若要換成正式委製的像素美術 PNG／音檔，只需將 `TextureFactory.js` 中對應的
  `this.scene.textures.createCanvas(...)` 材質改為 `this.load.image(...)` 載入真實檔案，
  並在 `AudioManager.js` 改為 `this.load.audio(...)` 即可無痛替換
- 目前武器彈道採自動鎖定最近敵人／固定環繞等模式；若要加入「滑鼠瞄準手動攻擊」，
  可在 `GameScene.js` 內監聽 `pointerdown` 並呼叫 `weaponSystem` 對應武器的手動觸發方法
