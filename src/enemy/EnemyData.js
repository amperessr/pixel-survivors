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
