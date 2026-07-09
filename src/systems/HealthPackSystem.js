import ObjectPool from '../managers/ObjectPool.js';
import { dist } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { getEquipped } from '../managers/SaveManager.js';

const MAX_PACKS = 3; // 同時間地圖上最多存在的血包數量
// 血包離玩家太遠（例如玩家往反方向跑走了）就直接回收——不然畫面邊緣的箭頭會
// 一直指向一個越來越遠、玩家可能要走超久才追得到的舊血包。
const MAX_KEEP_DIST = 1400;
// （舊「回血戒指＝血包 30% 機率自動飛向玩家」的邏輯已移除：ring_heal 改版成
//  吸血戒指，效果改在 GameScene.applyLifesteal() 實作，血包系統不再管戒指。）
const PICKUP_RADIUS = 22; // 走到血包多近算撿到；引力戒裝備時放大三倍
// 血包/磁鐵這類稀少的重要拾取物固定用一個很高的深度值，永遠畫在經驗寶石
// （預設深度 0）跟小怪（深度＝y 座標）上面——原本用 y 當深度，玩家在地圖
// 偏北側（y 為負）時，滿地的經驗寶石會整片蓋在血包上，玩家根本找不到。
export const PICKUP_DEPTH = 5000000;

// 血包系統：血包不再定時自動生成，改成純掉落制——小怪擊殺 10% 機率掉落
// （EnemySystem._killEnemy）、魔王 100% 掉落（GameScene.onBossDefeated），
// 都是透過 forceSpawn() 在擊殺點生成。
export default class HealthPackSystem {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;

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

  // 引力戒：任一戒指欄裝著引力戒時，撿取範圍變成三倍
  _pickupRadius() {
    const equipped = getEquipped();
    const hasGravity = equipped.ring1 === 'ring_gravity' || equipped.ring2 === 'ring_gravity';
    return hasGravity ? PICKUP_RADIUS * 3 : PICKUP_RADIUS;
  }

  update(time, delta) {
    const px = this.player.sprite.x, py = this.player.sprite.y;

    // 讓血包原地緩慢浮動、發光，比較好被玩家注意到；同時檢查是否離玩家太遠該回收了。
    this.pool.forEachActive((img) => {
      if (dist(img.x, img.y, px, py) > MAX_KEEP_DIST) {
        this.pool.free(img);
        return;
      }
      const bob = Math.sin(time / 250 + img.x) * 3;
      img.y = img.getData('baseY') + bob;
    });

    const pickupRadius = this._pickupRadius();
    this.pool.forEachActive((img) => {
      if (dist(img.x, img.y, px, py) < pickupRadius) {
        this._pickup(img);
      }
    });
  }

  // 在指定座標生成一個血包（擊殺怪物/魔王掉落用）。一般掉落遵守 MAX_PACKS 上限
  // 避免血包爆量；guaranteed=true（魔王 100% 掉落）時上限已滿就回收離玩家最遠的
  // 那一個來讓位，確保魔王的血包一定會掉出來。
  forceSpawn(x, y, guaranteed = false) {
    if (this.pool.activeCount >= MAX_PACKS) {
      if (!guaranteed) return;
      let farthest = null, farthestD = -1;
      const px = this.player.sprite.x, py = this.player.sprite.y;
      this.pool.forEachActive((img) => {
        const d = dist(img.x, img.y, px, py);
        if (d > farthestD) { farthestD = d; farthest = img; }
      });
      if (farthest) this.pool.free(farthest);
    }
    const img = this.pool.spawn(x, y);
    img.setData('baseY', y);
    img.setDepth(PICKUP_DEPTH);
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
