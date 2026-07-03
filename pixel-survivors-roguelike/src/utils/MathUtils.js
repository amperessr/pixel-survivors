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

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
