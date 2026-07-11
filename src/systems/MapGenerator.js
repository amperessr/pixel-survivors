import { hashNoise, mulberry32 } from '../utils/MathUtils.js';
import { ROOM_SIZE, ROOM_TEMPLATES, BIOME_TILE_RENDER, BIOME_IDS, decodeRLE } from './RoomData.js';

const TILE = 32;
const CHUNK_SIZE = ROOM_SIZE; // 8x8，跟房間模板對齊，一個 chunk＝一個房間模板
const CHUNK_PX = TILE * CHUNK_SIZE;
const LOAD_RADIUS = 2; // 以玩家為中心載入的 chunk 半徑

// 地板深度：必須是一個「無論如何都比任何角色/怪物的 Y 座標還要小」的固定值。
// 原本寫的是 -10，但玩家只要往上（Y 變負數）走一點點，怪物/玩家的深度
// （用世界座標 Y 當作深度）就會比 -10 還小，導致整隻怪物被畫在地板「下面」而完全消失。
// 這裡改成一個極大的負數，確保在任何合理的遊戲時間內都不會被超過。
const FLOOR_DEPTH = -1e9;

// 無限生成地圖器：以 chunk 為單位動態載入/卸載地板（Phaser Tilemap）與裝飾物。
// 2026-07-11 改版：地板不再逐格算機率、逐格建一個 Image GameObject，改成「種子化
// 房間拼接」——每個 chunk 從當局固定的那個地形的房間模板庫（見 RoomData.js）挑一塊
// 固定花紋貼上去，並用一個小型 Phaser Tilemap 圖層渲染地板（一個 chunk 一個
// TilemapLayer，取代原本 64 個 Image）。同一組 seed 在同一個座標永遠算出同一個結果，
// 地圖可以完全重現。
//
// 地形選擇：整趟遊戲固定用同一種地形（grass/desert/snow 三選一，見建構子），不是
// 同一趟裡混著走（那樣反而每趟看起來都差不多、永遠三種都會遇到）。改成「進場時
// 隨機決定這趟是草地/沙漠/雪地」，趟與趟之間才會有明顯差異，不會單調。
export default class MapGenerator {
  // opts.forest：汪汪大作戰限時挑戰場景用，鎖定草地地形並改用高密度樹林模板
  //（見 RoomData.ROOM_TEMPLATES.grassForest），取代舊版拉高樹木機率的做法，
  // 優先權比 opts.biome/種子隨機挑選都高。
  // opts.biome：外部指定這趟固定用哪種地形（不給就照種子隨機三選一）。
  // opts.seed：不給的話用目前時間戳記（維持「每局地圖都不一樣」的生存遊戲體驗）；
  // 之後若想讓某個活動所有玩家看到同一張地圖（例如排行榜挑戰要公平比較），
  // 只要外部傳同一個固定 seed（+ 固定 biome）進來即可，這裡不用再改。
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.forest = !!opts.forest;
    this.seed = opts.seed != null ? opts.seed : Math.floor(Date.now() % 2147483647);
    // 地形三選一：從 seed 算出來（不是直接 Math.random()），同一顆 seed 重現地圖時
    // 連「這趟是哪種地形」都要一起重現，不能開局另外擲一次跟 seed 無關的骰子。
    this.biome = this.forest ? 'grass'
      : opts.biome || BIOME_IDS[Math.floor(hashNoise(0, 0, this.seed + 7331) * BIOME_IDS.length)];
    this.loadedChunks = new Map(); // key: "cx,cy" -> {layer, decor:[]}

    // 三種地形共用同一個 Tilemap 物件（Tilemap 本身只是「已知有哪些 tileset」的
    // 容器，真正的地板資料活在各自的 TilemapLayer——每個 chunk 各自 createBlankLayer
    // 一個獨立圖層並定位到該 chunk 的世界座標，卸載時只需要 destroy 該圖層，
    // 不用整個 Tilemap 重建，比每個 chunk 各自 make.tilemap() 更省）。
    this.tilemap = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: CHUNK_SIZE, height: CHUNK_SIZE });
    this.tilesets = {};
    BIOME_IDS.forEach((biome) => {
      const texKey = BIOME_TILE_RENDER[biome].tileset;
      this.tilesets[biome] = this.tilemap.addTilesetImage(texKey, texKey, TILE, TILE);
    });

    this.decorGroup = scene.add.group();
    this.solidDecor = scene.physics.add.staticGroup();
  }

  update(playerX, playerY) {
    const ccx = Math.floor(playerX / CHUNK_PX);
    const ccy = Math.floor(playerY / CHUNK_PX);
    const needed = new Set();

    for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
      for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
        const cx = ccx + dx, cy = ccy + dy;
        const key = `${cx},${cy}`;
        needed.add(key);
        if (!this.loadedChunks.has(key)) {
          this._buildChunk(cx, cy, key);
        }
      }
    }
    // 卸載過遠的 chunk
    for (const key of Array.from(this.loadedChunks.keys())) {
      if (!needed.has(key)) {
        this._unloadChunk(key);
      }
    }
  }

  _buildChunk(cx, cy, key) {
    const biome = this.biome; // 整趟遊戲固定同一種地形，見建構子
    const templates = this.forest ? ROOM_TEMPLATES.grassForest : ROOM_TEMPLATES[biome];
    const render = BIOME_TILE_RENDER[biome];

    // 這個 chunk 專屬的種子亂數串流：選房間模板、要不要水平/垂直翻轉，都從同一個
    // 由 (cx,cy,worldSeed) 算出的種子連續抽——同樣的種子在同樣的座標永遠抽到同樣的
    // 結果，讓地圖可以完全重現，也不需要事先模擬其他 chunk。
    const chunkSeedInt = ((cx * 374761393) ^ (cy * 668265263) ^ this.seed) >>> 0;
    const rng = mulberry32(chunkSeedInt);
    const template = templates[Math.floor(rng() * templates.length)];
    const flipX = rng() < 0.5;
    const flipY = rng() < 0.5;
    const codes = decodeRLE(template);

    const worldX = cx * CHUNK_PX;
    const worldY = cy * CHUNK_PX;
    // width/height/tileWidth/tileHeight 明確帶入，不依賴預設值——createBlankLayer
    // 沒收到寬高時不會自動沿用建立 Tilemap 當下傳的 width/height，省略會建出
    // 0x0 的圖層，putTileAt 內部索引資料陣列時就會噴錯。
    const layer = this.tilemap.createBlankLayer(key, this.tilesets[biome], worldX, worldY, CHUNK_SIZE, CHUNK_SIZE, TILE, TILE);
    layer.setDepth(FLOOR_DEPTH);

    const decor = [];
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        // 翻轉是「畫在 (tx,ty) 這格時，去源模板的哪一格取代碼」，而不是搬動已經
        // 畫出來的格子，這樣只需要換讀取來源座標，不用另外處理鏡像後的貼圖翻轉。
        const srcX = flipX ? (CHUNK_SIZE - 1 - tx) : tx;
        const srcY = flipY ? (CHUNK_SIZE - 1 - ty) : ty;
        const code = codes[srcY * CHUNK_SIZE + srcX];
        const floorIndex = code <= 2 ? code : 0; // 3/4/5(裝飾) 底下的地板固定用平地(0)
        layer.putTileAt(floorIndex, tx, ty);

        if (code >= 3) {
          const wx = cx * CHUNK_SIZE + tx;
          const wy = cy * CHUNK_SIZE + ty;
          const px = wx * TILE + TILE / 2;
          const py = wy * TILE + TILE / 2;
          const d = render.decor[code];
          if (d.solid) {
            // 高大裝飾(3，樹/仙人掌/松樹)畫的位置比岩石(4)略高一點，碰撞體位置維持
            // 原本草地版本量好的偏移值，三種地形的裝飾物版型比例相近，共用同一組數字。
            const isTall = code === 3;
            const obj = this.scene.physics.add.staticImage(px, py - (isTall ? 6 : 0), d.tex).setDepth(py);
            obj.body.setSize(isTall ? 16 : 18, 12).setOffset(isTall ? -8 : -9, isTall ? 24 : 4);
            decor.push(obj);
          } else {
            // 矮裝飾(5，花/乾灌木/雪灌木)不需要跟怪物精細排序，用「比地板高一點點」
            // 的固定值即可，不可再用「py - 1000」這種偏移量，理由同上（一樣會在
            // py 夠小時被地板蓋過）。
            const obj = this.scene.add.image(px, py, d.tex).setDepth(FLOOR_DEPTH + 1);
            decor.push(obj);
          }
        }
      }
    }
    this.loadedChunks.set(key, { layer, decor });
  }

  _unloadChunk(key) {
    const chunk = this.loadedChunks.get(key);
    if (!chunk) return;
    chunk.layer.destroy();
    for (const d of chunk.decor) d.destroy();
    this.loadedChunks.delete(key);
  }
}
