import { hashNoise } from '../utils/MathUtils.js';

const TILE = 32;
const CHUNK_SIZE = 8; // 每個 chunk 為 8x8 個 tile
const CHUNK_PX = TILE * CHUNK_SIZE;
const LOAD_RADIUS = 2; // 以玩家為中心載入的 chunk 半徑

// 無限地圖生成器：以 chunk 為單位動態載入/卸載地板與裝飾物
export default class MapGenerator {
  constructor(scene) {
    this.scene = scene;
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

        const floorImg = this.scene.add.image(px, py, tileKey).setDepth(-10);
        this.floorGroup.add(floorImg);
        tiles.push(floorImg);

        // 裝飾物（樹/石頭/花）機率放置，避開河流
        if (tileKey === 'tile_grass') {
          const dn = hashNoise(wx, wy, 4242);
          if (dn > 0.965) {
            const tree = this.scene.physics.add.staticImage(px, py - 6, 'obj_tree').setDepth(py);
            tree.body.setSize(16, 12).setOffset(-8, 24);
            decor.push(tree);
          } else if (dn > 0.94) {
            const rock = this.scene.physics.add.staticImage(px, py, 'obj_rock').setDepth(py);
            rock.body.setSize(18, 12).setOffset(-9, 4);
            decor.push(rock);
          } else if (dn > 0.9) {
            const flower = this.scene.add.image(px, py, 'obj_flower').setDepth(py - 1000);
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
