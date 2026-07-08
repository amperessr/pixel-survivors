import ObjectPool from '../managers/ObjectPool.js';
import { dist, randRange } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { getEquipped } from '../managers/SaveManager.js';

const MAX_PACKS = 3; // 同時間地圖上最多存在的血包數量
const MIN_INTERVAL = 16000; // 最短生成間隔（毫秒）
const MAX_INTERVAL = 26000; // 最長生成間隔（毫秒）
// 血包離玩家太遠（例如玩家往反方向跑走了）就直接回收，重新等下一次計時生成在
// 玩家「現在」附近的位置——不然畫面邊緣的箭頭會一直指向一個越來越遠、
// 玩家可能要走超久才追得到的舊血包，體感就是「走了很久都沒找到」。
const MAX_KEEP_DIST = 1400;
const HEAL_RING_CHANCE = 0.3; // 回血戒指：每個血包生成時有 30% 機率自動飛向玩家
const HOMING_SPEED = 260;

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

  update(time, delta) {
    const px = this.player.sprite.x, py = this.player.sprite.y;

    // 讓血包原地緩慢浮動、發光，比較好被玩家注意到；同時檢查是否離玩家太遠該回收了。
    // 回血戒指生成時抽中的血包會直接飛向玩家（見 _rollHoming()），不用等玩家走過去撿。
    this.pool.forEachActive((img) => {
      if (dist(img.x, img.y, px, py) > MAX_KEEP_DIST) {
        this.pool.free(img);
        return;
      }
      if (img.getData('homing')) {
        const ang = Math.atan2(py - img.y, px - img.x);
        const step = (HOMING_SPEED * delta) / 1000;
        img.x += Math.cos(ang) * step;
        img.y += Math.sin(ang) * step;
      } else {
        const bob = Math.sin(time / 250 + img.x) * 3;
        img.y = img.getData('baseY') + bob;
      }
    });

    if (time > this.nextSpawnAt && this.pool.activeCount < MAX_PACKS) {
      this._trySpawn();
      this.nextSpawnAt = time + randRange(MIN_INTERVAL, MAX_INTERVAL);
    }

    this.pool.forEachActive((img) => {
      if (dist(img.x, img.y, px, py) < 22) {
        this._pickup(img);
      }
    });
  }

  // 回血戒指：只要身上兩個戒指欄任一個裝著回血戒指，新生成的血包就有 30% 機率
  // 直接自動飛向玩家，不用特地走過去撿。
  _rollHoming(img) {
    const equipped = getEquipped();
    const hasHealRing = equipped.ring1 === 'ring_heal' || equipped.ring2 === 'ring_heal';
    if (hasHealRing && Math.random() < HEAL_RING_CHANCE) {
      img.setData('homing', true);
    }
  }

  // 讓外部（例如擊殺怪物時）直接在指定座標生成一個血包，不受一般的計時器限制，
  // 但仍然遵守 MAX_PACKS 上限（避免同時間地圖上血包爆量）
  forceSpawn(x, y) {
    if (this.pool.activeCount >= MAX_PACKS) return;
    const img = this.pool.spawn(x, y);
    img.setData('baseY', y);
    img.setData('homing', false);
    img.setDepth(y);
    this._rollHoming(img);
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
    img.setData('homing', false);
    img.setDepth(y);
    this._rollHoming(img);
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
