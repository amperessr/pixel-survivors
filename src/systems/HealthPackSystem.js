import ObjectPool from '../managers/ObjectPool.js';
import { dist, randRange } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';

const MAX_PACKS = 3; // 同時間地圖上最多存在的血包數量
const MIN_INTERVAL = 16000; // 最短生成間隔（毫秒）
const MAX_INTERVAL = 26000; // 最長生成間隔（毫秒）

// 血包系統：偶爾在地圖上生成愛心圖案的補血道具，走過去即可回復生命值
export default class HealthPackSystem {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.nextSpawnAt = scene.time.now + randRange(MIN_INTERVAL, MAX_INTERVAL);

    this.pool = new ObjectPool(
      scene,
      () => scene.add.image(-200, -200, 'pickup_heart'),
      (img, x, y) => {
        img.setPosition(x, y);
        img.setScale(1.4);
      },
      MAX_PACKS
    );
  }

  update(time) {
    // 讓血包原地緩慢浮動、發光，比較好被玩家注意到
    this.pool.forEachActive((img) => {
      const bob = Math.sin(time / 250 + img.x) * 3;
      img.y = img.getData('baseY') + bob;
    });

    if (time > this.nextSpawnAt && this.pool.activeCount < MAX_PACKS) {
      this._trySpawn();
      this.nextSpawnAt = time + randRange(MIN_INTERVAL, MAX_INTERVAL);
    }

    const px = this.player.sprite.x, py = this.player.sprite.y;
    this.pool.forEachActive((img) => {
      if (dist(img.x, img.y, px, py) < 22) {
        this._pickup(img);
      }
    });
  }

  // 讓外部（例如擊殺怪物時）直接在指定座標生成一個血包，不受一般的計時器限制，
  // 但仍然遵守 MAX_PACKS 上限（避免同時間地圖上血包爆量）
  forceSpawn(x, y) {
    if (this.pool.activeCount >= MAX_PACKS) return;
    const img = this.pool.spawn(x, y);
    img.setData('baseY', y);
    img.setDepth(y);
  }

  _trySpawn() {
    const cam = this.scene.cameras.main;
    const halfW = cam.width / (2 * cam.zoom);
    const halfH = cam.height / (2 * cam.zoom);
    const edge = Math.hypot(halfW, halfH);
    const px = this.player.sprite.x, py = this.player.sprite.y;
    // 生成在鏡頭邊緣附近，讓玩家探索移動時剛好會發現，而不是憑空出現在眼前
    const angle = randRange(0, Math.PI * 2);
    const radius = randRange(edge * 0.5, edge * 0.9);
    const x = px + Math.cos(angle) * radius;
    const y = py + Math.sin(angle) * radius;
    const img = this.pool.spawn(x, y);
    img.setData('baseY', y);
    img.setDepth(y);
  }

  _pickup(img) {
    const p = this.player;
    const healAmount = Math.max(20, Math.round(p.stats.maxHp * 0.3));
    p.hp = Math.min(p.stats.maxHp, p.hp + healAmount);
    this.pool.free(img);
    audioManager.pickup();
    this.scene.spawnHealFx(img.x, img.y, healAmount);
  }

  clearAll() {
    this.pool.freeAll();
  }
}
