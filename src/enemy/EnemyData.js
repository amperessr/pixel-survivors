// 四種基礎敵人數值設定 (Boss 另見 boss/Boss.js)
// 2026-07-10 換上正式美術圖後重新分配定位：哥布林最弱／山豬速度最快／
// 骷髏攻擊力高／半獸人血量最厚(用高HP表現「防禦高」，敵人沒有獨立防禦數值)。
// 沿用原本四組已調好的數值(舊史萊姆→哥布林、舊哥布林→山豬、骷髏/獸人不變)，
// 只是重新對應到新的角色定位，不重新發明數字。
export const ENEMY_TYPES = {
  goblin: {
    id: 'goblin', texture: 'enemy_goblin', name: '哥布林',
    hp: 18, dmg: 6, speed: 60, exp: 2, scale: 1,
  },
  boar: {
    id: 'boar', texture: 'enemy_boar', name: '山豬',
    hp: 26, dmg: 8, speed: 85, exp: 3, scale: 1,
  },
  skeleton: {
    id: 'skeleton', texture: 'enemy_skeleton', name: '骷髏',
    hp: 22, dmg: 10, speed: 75, exp: 3, scale: 1,
  },
  orc: {
    id: 'orc', texture: 'enemy_orc', name: '半獸人',
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
// 關鍵點之間用線性插值；超過 10 分鐘後改成每分鐘固定 +1.0x
// （10min 5.0x／11min 6.0x／12min 7.0x／13min 8.0x……以此類推）。
const DIFFICULTY_CURVE = [
  { t: 0, mult: 1.0 },
  { t: 3, mult: 1.3 },
  { t: 5, mult: 1.8 },
  { t: 7, mult: 2.6 },
  { t: 10, mult: 5.0 },
];
const POST_10MIN_PER_MINUTE = 1.0; // 超過 10 分鐘後，每多 1 分鐘倍率固定 +1.0x

export function enemyScalingMultiplier(minutes) {
  const m = Math.max(0, minutes);
  const last = DIFFICULTY_CURVE[DIFFICULTY_CURVE.length - 1];
  if (m <= DIFFICULTY_CURVE[0].t) return DIFFICULTY_CURVE[0].mult;

  if (m >= last.t) {
    // 超過 10 分鐘：每分鐘固定 +1.0x（線性），不再是先前版本的指數延續
    return last.mult + (m - last.t) * POST_10MIN_PER_MINUTE;
  }

  for (let i = 1; i < DIFFICULTY_CURVE.length; i++) {
    const prev = DIFFICULTY_CURVE[i - 1];
    const cur = DIFFICULTY_CURVE[i];
    if (m <= cur.t) {
      const ratio = (m - prev.t) / (cur.t - prev.t);
      return prev.mult + (cur.mult - prev.mult) * ratio;
    }
  }
  return last.mult; // 理論上不會執行到這裡，保底回傳
}
