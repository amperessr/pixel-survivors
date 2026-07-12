// 角色顏色自訂：把史萊姆正式美術圖（player_balanced_src，見 BootScene.preload()）
// 讀進 Canvas，逐像素做 HSL 色相旋轉再寫回 player_balanced 這個材質 key——
// 遊戲內（Player.js 的 CHARACTERS.balanced.texture）跟背包畫面的角色預覽
// （InventoryScene 的 'player_balanced'）都吃這個 key，所以只要在這裡重新產生
// 一次，兩邊會同時套用到新顏色，不用另外改任何讀取的地方。
//
// 只旋轉「有彩色」的像素（飽和度夠高），黑色外框跟白色高光這些灰階細節維持
// 原樣不上色，不然整張圖套上同一個色相會糊成一片、失去原本的立體感／線稿。
const SATURATION_THRESHOLD = 0.12;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

// hueDegrees 傳 null 代表重設回原圖顏色（只是把來源圖原封不動複製一份到輸出 key，
// 不做任何色相替換）。
export function applyPlayerColorTexture(scene, hueDegrees) {
  const src = scene.textures.get('player_balanced_src').getSourceImage();
  const w = src.width, h = src.height;

  // 重用同一個 CanvasTexture 物件，只清空重畫再 refresh()，不要整個 remove()
  // 再 createCanvas() 重建——遊戲內角色 Sprite／背包畫面的角色圖示都是用
  // 'player_balanced' 這個 key 建立的 GameObject，內部存的是「當下那個 Texture
  // 物件」的直接參照，重建成一個新的 Texture 物件會讓這些既有 GameObject
  // 手上的參照變成指向已經被銷毀的舊材質，畫面上會直接消失/變空白。
  const tex = scene.textures.exists('player_balanced')
    ? scene.textures.get('player_balanced')
    : scene.textures.createCanvas('player_balanced', w, h);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0);

  if (hueDegrees !== null) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const targetH = ((hueDegrees % 360) + 360) % 360 / 360;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue; // 全透明像素不用處理
      const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s < SATURATION_THRESHOLD) continue; // 灰階細節（外框/高光）維持原樣
      const [r, g, b] = hslToRgb(targetH, s, l);
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  tex.refresh();
  try {
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  } catch (err) {
    console.warn('[PlayerColor] setFilter 失敗，改用預設濾鏡：', err);
  }
}
