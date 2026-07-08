import ObjectPool from '../managers/ObjectPool.js';
import { dist } from '../utils/MathUtils.js';
import { audioManager } from '../managers/AudioManager.js';
import { getEquipped } from '../managers/SaveManager.js';

const MAX_PACKS = 3; // 同時間地圖上最多存在的血包數量
// 血包離玩家太遠（例如玩家往反方向跑走了）就直接回收——不然畫面邊緣的箭頭會
// 一直指向一個越來越遠、玩家可能要走超久才追得到的舊血包。
const MAX_KEEP_DIST = 1400;
const HEAL_RING_CHANCE = 0.3; // 回血戒指：每個血包生成時有 30% 機率自動飛向玩家
const HOMING_SPEED = 260;
const PICKUP_RADIUS = 22; // 走到血包多近算撿到；引力戒裝備時放大三倍

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

    const pickupRadius = this._pickupRadius();
    this.pool.forEachActive((img) => {
      if (dist(img.x, img.y, px, py) < pickupRadius) {
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
