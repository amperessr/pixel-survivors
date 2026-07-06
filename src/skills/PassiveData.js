// 五種被動能力，每種十階，直接強化角色數值，並間接觸發武器聯動效果
export const PASSIVE_IDS = ['attack', 'critRate', 'critDmg', 'atkSpeed', 'moveSpeed'];

// 被動技能等級上限。武器上限是 5 級（見 WeaponSystem.isMaxed），被動則比照
// 「數值型」被動的設計拉長到 10 級，讓被動線在武器全部進化後還有成長空間。
export const MAX_PASSIVE_LEVEL = 10;

export const PASSIVE_DATA = {
  attack: {
    id: 'attack', name: '力量祝福', icon: 'icon_attack',
    desc: '每級提升攻擊力 8%，並使火球術體積與爆炸範圍更大。',
    perLevel: 8, // 每級增加的百分比數值
  },
  critRate: {
    id: 'critRate', name: '幸運符文', icon: 'icon_critRate',
    desc: '每級提升爆擊率 6%，並使雷電鎖鏈分裂數增加。',
    perLevel: 6,
  },
  critDmg: {
    id: 'critDmg', name: '致命打擊', icon: 'icon_critDmg',
    desc: '每級提升爆擊傷害 15%。',
    perLevel: 15,
  },
  atkSpeed: {
    id: 'atkSpeed', name: '疾風之刃', icon: 'icon_atkSpeed',
    desc: '每級提升攻擊速度 8%，並使飛刀數量增加、鋸片轉速加快。',
    perLevel: 8,
  },
  moveSpeed: {
    id: 'moveSpeed', name: '迅捷之靴', icon: 'icon_moveSpeed',
    desc: '每級提升移動速度 6%。',
    perLevel: 6,
  },
};

export function passiveLevelValue(id, level) {
  return PASSIVE_DATA[id].perLevel * level;
}
