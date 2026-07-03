// 五種武器，每種五階，每階外觀/效果/攻擊方式皆不同
// 聯動設計 (Build 感)：
//   火球 (fireball)  : Attack 越高 -> 火球體積越大 -> 爆炸範圍越大 -> 傷害越高
//   雷電 (lightning) : CritRate 越高 -> 閃電分裂數越多
//   飛刀 (knife)     : AttackSpeed 越高 -> 飛刀數量越多
//   鋸片 (sawblade)  : AttackSpeed 越高 -> 旋轉速度越快、命中頻率提高
//   冰霜 (frost)     : Defense 越高 -> 凍結範圍越大、減速效果越強
export const WEAPON_IDS = ['fireball', 'lightning', 'knife', 'sawblade', 'frost'];

export const WEAPON_DATA = {
  fireball: {
    id: 'fireball',
    name: '火球術',
    desc: '朝最近敵人發射火球，命中後爆炸造成範圍傷害。Attack 越高，火球越大、爆炸範圍越大。',
    projectile: 'proj_fireball',
    synergyStat: 'attack',
    levels: [
      { dmg: 12, cooldown: 1100, aoe: 26, speed: 260, pierce: 0 },
      { dmg: 16, cooldown: 1000, aoe: 32, speed: 270, pierce: 0 },
      { dmg: 22, cooldown: 900, aoe: 38, speed: 280, pierce: 1 },
      { dmg: 30, cooldown: 800, aoe: 46, speed: 300, pierce: 1 },
      { dmg: 42, cooldown: 700, aoe: 58, speed: 320, pierce: 2 },
    ],
  },
  lightning: {
    id: 'lightning',
    name: '雷電鎖鏈',
    desc: '對最近敵人發射閃電並可跳躍到附近敵人。CritRate 越高，分裂數越多。',
    projectile: 'proj_lightning',
    synergyStat: 'critRate',
    levels: [
      { dmg: 10, cooldown: 900, chains: 1, range: 140 },
      { dmg: 13, cooldown: 850, chains: 2, range: 150 },
      { dmg: 17, cooldown: 800, chains: 3, range: 160 },
      { dmg: 22, cooldown: 750, chains: 4, range: 175 },
      { dmg: 30, cooldown: 700, chains: 6, range: 190 },
    ],
  },
  knife: {
    id: 'knife',
    name: '旋風飛刀',
    desc: '朝滑鼠方向連續投擲飛刀。AttackSpeed 越高，同時發射的飛刀數量越多。',
    projectile: 'proj_knife',
    synergyStat: 'atkSpeed',
    levels: [
      { dmg: 8, cooldown: 500, count: 1, speed: 420, pierce: 1 },
      { dmg: 9, cooldown: 460, count: 2, speed: 440, pierce: 1 },
      { dmg: 11, cooldown: 420, count: 2, speed: 460, pierce: 2 },
      { dmg: 13, cooldown: 380, count: 3, speed: 480, pierce: 2 },
      { dmg: 16, cooldown: 340, count: 4, speed: 500, pierce: 3 },
    ],
  },
  sawblade: {
    id: 'sawblade',
    name: '旋轉鋸片',
    desc: '環繞玩家旋轉的鋸片，持續對接觸敵人造成傷害。AttackSpeed 越高，旋轉越快。',
    projectile: 'proj_sawblade',
    synergyStat: 'atkSpeed',
    levels: [
      { dmg: 6, cooldown: 200, count: 1, radius: 46, rotSpeed: 2.4 },
      { dmg: 7, cooldown: 200, count: 2, radius: 50, rotSpeed: 2.7 },
      { dmg: 9, cooldown: 180, count: 2, radius: 54, rotSpeed: 3.0 },
      { dmg: 11, cooldown: 180, count: 3, radius: 58, rotSpeed: 3.4 },
      { dmg: 14, cooldown: 160, count: 4, radius: 64, rotSpeed: 3.8 },
    ],
  },
  frost: {
    id: 'frost',
    name: '冰霜新星',
    desc: '定期在玩家周圍釋放冰霜衝擊波，減速並傷害範圍內敵人。Defense 越高，範圍越大。',
    projectile: 'proj_frost',
    synergyStat: 'defense',
    levels: [
      { dmg: 8, cooldown: 2600, radius: 70, slow: 0.3, slowDuration: 1500 },
      { dmg: 10, cooldown: 2400, radius: 82, slow: 0.35, slowDuration: 1700 },
      { dmg: 13, cooldown: 2200, radius: 94, slow: 0.4, slowDuration: 1900 },
      { dmg: 17, cooldown: 2000, radius: 108, slow: 0.45, slowDuration: 2100 },
      { dmg: 22, cooldown: 1800, radius: 126, slow: 0.55, slowDuration: 2400 },
    ],
  },
};

export function getWeaponLevelData(id, level) {
  const w = WEAPON_DATA[id];
  return { ...w, ...w.levels[Math.min(level, w.levels.length) - 1], level };
}
