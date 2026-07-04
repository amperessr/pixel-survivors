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

// 依目前難度（存活分鐘數）決定本次生成怪物的強度
export function rollEnemyTier(difficultyMinutes) {
  const rareChance = Math.min(0.12, 0.01 + difficultyMinutes * 0.012);
  const eliteChance = Math.min(0.35, 0.05 + difficultyMinutes * 0.03);
  const r = Math.random();
  if (r < rareChance) return 'rare';
  if (r < rareChance + eliteChance) return 'elite';
  return 'normal';
}
