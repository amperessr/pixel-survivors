import ObjectPool from '../managers/ObjectPool.js';
import { dist, randRange } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { getEquipped } from '../managers/SaveManager.js';

const MAX_MAGNETS = 1; // 同時間地圖上最多存在的磁鐵數量（比血包稀有，同時只會有一個）
const MIN_INTERVAL = 35000; // 最短生成間隔（毫秒），刻意比血包更久，維持「偶爾掉落」的稀有感
const MAX_INTERVAL = 55000; // 最長生成間隔（毫秒）
// 磁鐵離玩家太遠就直接回收，理由跟 HealthPackSystem 一樣：避免畫面邊緣的箭頭
// 一直指向一個玩家要走超久才追得到的舊磁鐵
const MAX_KEEP_DIST = 1400;

// 磁鐵系統：偶爾在地圖上生成磁鐵道具，走過去即可把地圖上「目前所有」經驗值瞬間吸過來
export default class MagnetSystem {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.nextSpawnAt = scene.time.now + randRange(MIN_INTERVAL, MAX_INTERVAL);

    this.pool = new ObjectPool(
      scene,
      () => scene.add.image(-200, -200, 'pickup_magnet'),
      (img, x, y) => {
        img.setPosition(x, y);
        img.setScale(1.4);
      },
      MAX_MAGNETS
    );
  }

  update(time) {
    const px = this.player.sprite.x, py = this.player.sprite.y;

    // 讓磁鐵原地緩慢浮動、發光，比較好被玩家注意到（跟血包一致的視覺語言）；
    // 同時檢查是否離玩家太遠該回收了
    this.pool.forEachActive((img) => {
      if (dist(img.x, img.y, px, py) > MAX_KEEP_DIST) {
        this.pool.free(img);
        return;
      }
      const bob = Math.sin(time / 250 + img.x) * 3;
      img.y = img.getData('baseY') + bob;
      img.rotation = Math.sin(time / 400 + img.x) * 0.15;
    });

    if (time > this.nextSpawnAt && this.pool.activeCount < MAX_MAGNETS) {
      this._trySpawn();
      this.nextSpawnAt = time + randRange(MIN_INTERVAL, MAX_INTERVAL);
    }

    // 引力戒：任一戒指欄裝著引力戒時，撿取範圍變成三倍（跟血包同一套規則）
    const equipped = getEquipped();
    const hasGravity = equipped.ring1 === 'ring_gravity' || equipped.ring2 === 'ring_gravity';
    const pickupRadius = hasGravity ? 66 : 22;
    this.pool.forEachActive((img) => {
      if (dist(img.x, img.y, px, py) < pickupRadius) {
        this._pickup(img);
      }
    });
  }

  _trySpawn() {
    const cam = this.scene.cameras.main;
    const halfW = cam.width / (2 * cam.zoom);
    const halfH = cam.height / (2 * cam.zoom);
    const edge = Math.hypot(halfW, halfH);
    const px = this.player.sprite.x, py = this.player.sprite.y;
    // 生成在鏡頭邊緣附近，讓玩家探索移動時剛好會發現，而不是憑空出現在眼前（跟血包同一套邏輯）
    const angle = randRange(0, Math.PI * 2);
    const radius = randRange(edge * 0.5, edge * 0.9);
    const x = px + Math.cos(angle) * radius;
    const y = py + Math.sin(angle) * radius;
    const img = this.pool.spawn(x, y);
    img.setData('baseY', y);
    img.setDepth(y);
  }

  _pickup(img) {
    this.pool.free(img);
    audioManager.pickup();
    // 標記「拾取當下」地圖上所有經驗寶石永久朝玩家飛，直到真的被撿到為止，
    // 不會像以前的計時器版本一樣時間到了就放著不管、卡在半路（見 EnemySystem.
    // pullAllGemsToPlayer() 的說明）。
    this.scene.enemySystem.pullAllGemsToPlayer();
    this.scene.spawnMagnetFx(img.x, img.y);
  }

  clearAll() {
    this.pool.freeAll();
  }
}
