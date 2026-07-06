// 五種基礎敵人數值設定 (Boss 另見 boss/Boss.js)
export const ENEMY_TYPES = {
  slime: {
    id: 'slime', texture: 'enemy_slime', name: '史萊姆',
    hp: 18, dmg: 6, speed: 60, exp: 2, scale: 1,
  },
  goblin: {
    id: 'goblin', texture: 'enemy_goblin', name: '哥布林',
    hp: 26, dmg: 8, speed: 85, exp: 3, scale: 1,
  },
  skeleton: {
    id: 'skeleton', texture: 'enemy_skeleton', name: '骷髏',
    hp: 22, dmg: 10, speed: 75, exp: 3, scale: 1,
  },
  orc: {
    id: 'orc', texture: 'enemy_orc', name: '獸人',
    hp: 46, dmg: 14, speed: 55, exp: 6, scale: 1.15,
  },
};

export const ENEMY_IDS = Object.keys(ENEMY_TYPES);

// 怪物強度分級：一般 / 菁英 / 稀有，數值與經驗值皆隨強度倍增，並用顏色/體型區分
export const ENEMY_TIERS = {
  normal: { id: 'normal', label: '', mult: 1, expMult: 1, scaleMult: 1, tint: null },
  elite: { id: 'elite', label: '菁英', mult: 1.7, expMult: 3, scaleMult: 1.18, tint: 0xffe066 },
  rare: { id: 'rare', label: '稀有', mult: 2.8, expMult: 8, scaleMult: 1.4, tint: 0xff6bd6 },
};

// 依存活分鐘數決定本次生成怪物的強度
export function rollEnemyTier(difficultyMinutes) {
  const rareChance = Math.min(0.12, 0.01 + difficultyMinutes * 0.012);
  const eliteChance = Math.min(0.35, 0.05 + difficultyMinutes * 0.03);
  const r = Math.random();
  if (r < rareChance) return 'rare';
  if (r < rareChance + eliteChance) return 'elite';
  return 'normal';
}

// 怪物隨時間變強的倍率曲線（同時套用在 HP 與傷害上）。
// 指定關鍵點：0 分鐘 1.0x／3 分鐘 1.3x／5 分鐘 1.8x／7 分鐘 2.6x／10 分鐘 5.0x，
// 關鍵點之間用線性插值；超過 10 分鐘後，沿用最後一段（7→10 分鐘）的成長率，
// 以等比方式持續往上疊加，讓遊戲後期繼續變難而不是直接打平。
const DIFFICULTY_CURVE = [
  { t: 0, mult: 1.0 },
  { t: 3, mult: 1.3 },
  { t: 5, mult: 1.8 },
  { t: 7, mult: 2.6 },
  { t: 10, mult: 5.0 },
];

export function enemyScalingMultiplier(minutes) {
  const m = Math.max(0, minutes);
  if (m <= DIFFICULTY_CURVE[0].t) return DIFFICULTY_CURVE[0].mult;

  for (let i = 1; i < DIFFICULTY_CURVE.length; i++) {
    const prev = DIFFICULTY_CURVE[i - 1];
    const cur = DIFFICULTY_CURVE[i];
    if (m <= cur.t) {
      const ratio = (m - prev.t) / (cur.t - prev.t);
      return prev.mult + (cur.mult - prev.mult) * ratio;
    }
  }

  // 超過最後一個關鍵點（10 分鐘）：延續 7→10 分鐘那一段的「每分鐘成長倍率」，
  // 用指數方式繼續往上疊加（而非固定死在 5.0x）
  const last = DIFFICULTY_CURVE[DIFFICULTY_CURVE.length - 1];
  const prev = DIFFICULTY_CURVE[DIFFICULTY_CURVE.length - 2];
  const perMinuteGrowth = Math.pow(last.mult / prev.mult, 1 / (last.t - prev.t));
  return last.mult * Math.pow(perMinuteGrowth, m - last.t);
}
