import { RARITY_DATA } from '../equipment/EquipmentData.js';

// 稀有度外框視覺樣式（依 EquipmentData.js 的 RARITY_DATA 顏色）：
// 普通＝灰色細邊框／優秀＝綠色邊框／稀有＝藍色發光邊框／史詩＝紫色發光邊框／
// 傳說＝金色雙線＋四角刻花／神話＝紅金雙色、外層發光暈會持續脈動。
// 「發光」用外層加大、加寬、低透明度的同色描邊模擬光暈（Canvas/WebGL 都能畫，
// 不依賴只有 WebGL 才有的 postFX glow pipeline）。回傳一個 Container，
// 呼叫端可以像單一物件一樣 destroy()／setDepth()／setAlpha()。
export function createRarityFrame(scene, x, y, width, height, rarityId) {
  const container = scene.add.container(x, y);
  const rarity = RARITY_DATA[rarityId] || RARITY_DATA.common;

  const addRect = (w, h, lineWidth, color, alpha) => {
    const r = scene.add.rectangle(0, 0, w, h).setStrokeStyle(lineWidth, color, alpha).setFillStyle(0, 0);
    container.add(r);
    return r;
  };

  switch (rarityId) {
    case 'uncommon':
      addRect(width, height, 3, rarity.color, 0.95);
      break;

    case 'rare':
    case 'epic':
      addRect(width + 8, height + 8, 6, rarity.color, 0.25); // 外層發光暈
      addRect(width, height, 3, rarity.color, 1);
      break;

    case 'legendary': {
      addRect(width, height, 3, rarity.color, 1);
      addRect(width + 6, height + 6, 1, rarity.color, 0.55); // 外層細線，做出雙線雕花感
      // 四角刻花：短的 L 形折線裝飾
      const hw = width / 2, hh = height / 2, tick = 10;
      const g = scene.add.graphics();
      g.lineStyle(2, rarity.color, 0.9);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
        const cx = sx * hw, cy = sy * hh;
        g.lineBetween(cx, cy - sy * tick, cx, cy);
        g.lineBetween(cx - sx * tick, cy, cx, cy);
      });
      container.add(g);
      break;
    }

    case 'mythic': {
      // 紅金雙色：外層紅色發光暈持續脈動，內層金色實線邊框
      const glow = addRect(width + 10, height + 10, 7, 0xff3b3b, 0.35);
      addRect(width, height, 3, 0xffd700, 1);
      scene.tweens.add({
        targets: glow,
        alpha: { from: 0.25, to: 0.7 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      break;
    }

    case 'common':
    default:
      addRect(width, height, 2, 0x9a9a9a, 0.8);
      break;
  }

  return container;
}
