import { hashNoise } from '../utils/MathUtils.js';

const TILE = 32;
const CHUNK_SIZE = 8; // 每個 chunk 為 8x8 個 tile
const CHUNK_PX = TILE * CHUNK_SIZE;
const LOAD_RADIUS = 2; // 以玩家為中心載入的 chunk 半徑

// 地板深度：必須是一個「無論如何都比任何角色/怪物的 Y 座標還要小」的固定值。
// 原本寫的是 -10，但玩家只要往上（Y 變負數）走一點點，怪物/玩家的深度
// （用世界座標 Y 當作深度）就會比 -10 還小，導致整隻怪物被畫在地板「下面」而完全消失。
// 這裡改成一個極大的負數，確保在任何合理的遊戲時間內都不會被超過。
const FLOOR_DEPTH = -1e9;

// 無限生成地圖器：以 chunk 為單位動態載入/卸載地板與裝飾物
export default class MapGenerator {
  // opts.forest：汪汪大作戰限時挑戰場景用，把樹的生成機率大幅拉高（原本樹只有
  // ~3.5% 機率，太稀疏配不上「很多樹的森林」的活動場景需求），石頭/花維持原本機率不變。
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.forest = !!opts.forest;
    this.loadedChunks = new Map(); // key: "cx,cy" -> {tiles:[], decor:[]}
    this.floorGroup = scene.add.group();
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
    const tiles = [];
    const decor = [];
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        const wx = cx * CHUNK_SIZE + tx;
        const wy = cy * CHUNK_SIZE + ty;
        const px = wx * TILE + TILE / 2;
        const py = wy * TILE + TILE / 2;
        const n = hashNoise(wx, wy, 99);
        const nRiver = hashNoise(wx, wy, 555);

        let tileKey = 'tile_grass';
        if (nRiver > 0.93 && nRiver < 0.965) tileKey = 'tile_river';
        else if (n > 0.8 && n < 0.85) tileKey = 'tile_path';

        const floorImg = this.scene.add.image(px, py, tileKey).setDepth(FLOOR_DEPTH);
        this.floorGroup.add(floorImg);
        tiles.push(floorImg);

        // 裝飾物（樹/石頭/花）機率放置，避開河流
        if (tileKey === 'tile_grass') {
          const dn = hashNoise(wx, wy, 4242);
          const treeThreshold = this.forest ? 0.72 : 0.965; // 森林場景樹木機率大幅拉高
          if (dn > treeThreshold) {
            const tree = this.scene.physics.add.staticImage(px, py - 6, 'obj_tree').setDepth(py);
            tree.body.setSize(16, 12).setOffset(-8, 24);
            decor.push(tree);
          } else if (dn > 0.94) {
            const rock = this.scene.physics.add.staticImage(px, py, 'obj_rock').setDepth(py);
            rock.body.setSize(18, 12).setOffset(-9, 4);
            decor.push(rock);
          } else if (dn > 0.9) {
            // 花不需要跟怪物精細排序，用「比地板高一點點」的固定值即可，
            // 不可再用「py - 1000」這種偏移量，理由同上（一樣會在 py 夠小時被地板蓋過）
            const flower = this.scene.add.image(px, py, 'obj_flower').setDepth(FLOOR_DEPTH + 1);
            decor.push(flower);
          }
        }
      }
    }
    this.loadedChunks.set(key, { tiles, decor });
  }

  _unloadChunk(key) {
    const chunk = this.loadedChunks.get(key);
    if (!chunk) return;
    for (const t of chunk.tiles) t.destroy();
    for (const d of chunk.decor) d.destroy();
    this.loadedChunks.delete(key);
  }
}
