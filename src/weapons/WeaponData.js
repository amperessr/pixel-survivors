// 五種武器，每種五階，每階外觀/效果/攻擊方式皆不同。
// 技能的體積/數量/範圍/轉速只由「武器等級 + 是否進化」決定，不再受角色能力值影響
// （攻擊力仍會透過統一公式提升所有武器的傷害，爆擊率/爆傷影響爆擊，見 PassiveData）。
export const WEAPON_IDS = ['fireball', 'lightning', 'knife', 'sawblade', 'frost'];

export const WEAPON_DATA = {
  fireball: {
    id: 'fireball',
    name: '火球術',
    desc: '朝最近敵人發射火球，命中後爆炸造成範圍傷害。升級可提升傷害、爆炸範圍與穿透。',
    projectile: 'proj_fireball',
    synergyStat: 'attack',
    levels: [
      { dmg: 12, cooldown: 1300, aoe: 26, speed: 260, pierce: 0 },
      { dmg: 16, cooldown: 1180, aoe: 32, speed: 270, pierce: 0 },
      { dmg: 22, cooldown: 1060, aoe: 38, speed: 280, pierce: 1 },
      { dmg: 30, cooldown: 950, aoe: 46, speed: 300, pierce: 1 },
      { dmg: 42, cooldown: 850, aoe: 58, speed: 320, pierce: 2 },
    ],
  },
  lightning: {
    id: 'lightning',
    name: '雷電鎖鏈',
    desc: '對最近敵人發射閃電並可跳躍到附近敵人。升級可提升傷害與分裂（跳躍）數。',
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
    desc: '朝最近敵人連續投擲飛刀。升級可提升傷害、飛刀數量與穿透。',
    projectile: 'proj_knife',
    synergyStat: 'atkSpeed',
    levels: [
      { dmg: 8, cooldown: 500, count: 1, speed: 420, pierce: 1 },
      { dmg: 9, cooldown: 460, count: 2, speed: 440, pierce: 1 },
      { dmg: 11, cooldown: 420, count: 2, speed: 460, pierce: 2 },
      { dmg: 13, cooldown: 380, count: 3, speed: 480, pierce: 2 },
      { dmg: 16, cooldown: 340, count: 4, speed: 500, pierce: 4 }, // pierce 4 = 命中數 5（見 pierce 定義：實際命中數 = pierce+1）
    ],
  },
  sawblade: {
    id: 'sawblade',
    name: '旋轉鋸片',
    desc: '環繞玩家旋轉的鋸片，持續對接觸敵人造成傷害。升級可提升傷害、數量與轉速。',
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
    desc: '定期從地面冒出冰柱，減速並傷害範圍內敵人。升級可提升傷害與範圍。',
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

// 融合武器：兩把「都滿 5 級、都還沒進化」的武器可以融合成一把全新武器（見
// WeaponSystem.fuseWeapons）。目前先做三組，數值公式統一是「兩把 5 級數值取平均
// 再乘 0.75（避免直接相加爆炸性過強）／冷卻取兩者較短再乘 1.1」；範圍/數量類
// 則是取較大值再放大，讓融合後的武器有明顯的體型/範圍升級感。
// 暫時不開放融合武器再往上進化——之後有需要再加。
export const WEAPON_FUSIONS = {
  lightning_knife: {
    id: 'lightning_knife',
    name: '電擊飛刃',
    parents: ['lightning', 'knife'],
    desc: '飛刀融合雷電。連續投擲帶電飛刀，命中後會對附近一名敵人補上一道連鎖閃電（傷害為本體 50%）。',
    icon: 'weapon_lightning_knife_lv5',
    stats: { dmg: 35, cooldown: 374, count: 5, speed: 500, pierce: 9, chainRange: 130 }, // pierce 9 = 命中數 10
  },
  knife_sawblade: {
    id: 'knife_sawblade',
    name: '血肉風暴',
    parents: ['knife', 'sawblade'],
    desc: '飛刀融合鋸片。環繞身邊形成內外雙層旋轉刀陣，內圈鋸片、外圈飛刀反向旋轉，持續絞碎接觸到的一切。',
    icon: 'weapon_knife_sawblade_lv5',
    stats: { dmg: 23, innerCount: 4, outerCount: 4, innerRadius: 54, outerRadius: 92, rotSpeed: 4.2 },
  },
  fireball_frost: {
    id: 'fireball_frost',
    name: '極端冰火',
    parents: ['fireball', 'frost'],
    desc: '火球融合冰霜。發射灼熱冰彈，命中後爆炸造成範圍傷害，並使爆炸範圍內敵人大幅減速。',
    icon: 'weapon_fireball_frost_lv5',
    stats: { dmg: 48, cooldown: 935, aoe: 64, speed: 320, slow: 0.44, slowDuration: 1680 },
  },
};

// 依兩個武器 id（順序不拘）找出對應的融合配方，找不到回傳 undefined
export function findFusionFor(idA, idB) {
  return Object.values(WEAPON_FUSIONS).find((f) =>
    (f.parents[0] === idA && f.parents[1] === idB) || (f.parents[0] === idB && f.parents[1] === idA));
}

export function getWeaponLevelData(id, level) {
  const w = WEAPON_DATA[id];
  return { ...w, ...w.levels[Math.min(level, w.levels.length) - 1], level };
}

// 每種武器的擊退設定：force 是推開的力道，duration 是擊退持續多久（毫秒）
export const WEAPON_KNOCKBACK = {
  fireball: { force: 260, duration: 220 },
  lightning: { force: 170, duration: 150 },
  knife: { force: 210, duration: 150 },
  sawblade: { force: 130, duration: 120 },
  frost: { force: 190, duration: 260 },
};

// 武器五級滿了之後可以「進化」成更強的高階版本，不是單純數值疊加，
// 而是外觀（金色光環）與數值全面躍升的新武器
export const WEAPON_EVOLUTIONS = {
  // cooldownMult 沒指定的話會直接沿用 extraMult（範圍/數量的放大倍率），
  // 但「冷卻時間縮短的倍率」跟「範圍/數量放大的倍率」其實是兩件不同的事，
  // 共用同一個數字容易失控——火球進化成隕石之後就是因為這樣才變得太快，
  // 這裡拆開來讓冷卻可以單獨調鬆一點，不用跟著範圍倍率一起放大。
  fireball: {
    name: '隕石燄爆',
    desc: '火球術的最終進化。不再沿地面飛行，改為鎖定敵人後從天而降砸下巨大隕石，範圍與威力大幅提升。',
    dmgMult: 1.9, extraMult: 1.6, cooldownMult: 0.85,
  },
  lightning: {
    name: '雷霆風暴',
    desc: '雷電鎖鏈的最終進化。分裂數與傷害都大幅躍升，瞬間連鎖整群敵人。',
    dmgMult: 1.7, extraMult: 1.8, cooldownMult: 1.3,
  },
  knife: {
    name: '旋風飛刃',
    desc: '飛刀的最終進化。數量與穿透力大幅提升，形成一片刀刃風暴。',
    dmgMult: 1.6, extraMult: 1.8, cooldownMult: 1.3,
    // 一般武器進化的穿透力是「+1」（見 WeaponSystem._getEffectiveData），但飛刀
    // 進化要求命中數直接跳到 10（pierce=9，命中數＝pierce+1），用這個欄位覆蓋掉
    // 預設的 +1 規則。
    pierceOverride: 9,
  },
  sawblade: {
    name: '狂暴鋸輪',
    desc: '旋轉鋸片的最終進化。數量與轉速大幅提升，環繞成一圈死亡領域。',
    dmgMult: 1.7, extraMult: 1.6, cooldownMult: 1.3,
  },
  frost: {
    name: '永凍冰川',
    desc: '冰霜新星的最終進化。範圍與減速效果大幅提升，凍結一切靠近的敵人。',
    dmgMult: 1.8, extraMult: 1.6, cooldownMult: 1.3,
  },
};
