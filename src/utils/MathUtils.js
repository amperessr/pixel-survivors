// 通用數學工具函式
export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

export function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

export function choice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function angleTo(fromX, fromY, toX, toY) {
  return Math.atan2(toY - fromY, toX - fromX);
}

// 簡易種子雜訊 (用於地圖生成的偽隨機分布)
export function hashNoise(x, y, seed = 1337) {
  let h = x * 374761393 + y * 668265263 + seed * 69069;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h % 1000) / 1000 + 1) % 1;
}

// Mulberry32：標準種子亂數產生器，回傳一個可重複呼叫、每次吐一個 [0,1) 亂數的
// 函式。跟 hashNoise 的分工：hashNoise 適合「任意座標直接查值」（無限地圖查詢
// 很遠的格子不用先模擬中間所有格子），mulberry32 適合「同一個地點一連串相關的
// 隨機決定」（例如同一個 chunk 要選房間模板、要不要翻轉、裝飾物要不要偏移，
// 用同一個 seed 建一個產生器連續抽幾次），兩者都是無狀態、給同樣的 seed 保證
// 得到同樣的結果（見 MapGenerator 怎麼用）。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
