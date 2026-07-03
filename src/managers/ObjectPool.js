// 通用物件池：避免頻繁 new/destroy 造成 GC 卡頓
// 支援至少 500 隻怪物與 100 發子彈同時存在並維持 60 FPS
export default class ObjectPool {
  /**
   * @param {Phaser.Scene} scene
   * @param {Function} factory - () => GameObject，建立新物件
   * @param {Function} reset - (obj, ...args) => void，重新啟用物件時呼叫
   * @param {number} preallocate - 預先建立數量
   */
  constructor(scene, factory, reset, preallocate = 50) {
    this.scene = scene;
    this.factory = factory;
    this.reset = reset;
    this.pool = [];
    this.active = new Set();

    for (let i = 0; i < preallocate; i++) {
      const obj = this.factory();
      obj.setActive(false);
      obj.setVisible(false);
      this.pool.push(obj);
    }
  }

  spawn(...args) {
    let obj = this.pool.pop();
    if (!obj) {
      obj = this.factory();
    }
    obj.setActive(true);
    obj.setVisible(true);
    this.reset(obj, ...args);
    this.active.add(obj);
    return obj;
  }

  free(obj) {
    if (!this.active.has(obj)) return;
    obj.setActive(false);
    obj.setVisible(false);
    if (obj.body) {
      obj.body.setVelocity(0, 0);
    }
    this.active.delete(obj);
    this.pool.push(obj);
  }

  freeAll() {
    for (const obj of Array.from(this.active)) {
      this.free(obj);
    }
  }

  get activeCount() {
    return this.active.size;
  }

  forEachActive(cb) {
    for (const obj of this.active) cb(obj);
  }
}
