// 五種被動能力，每種五階，直接強化角色數值，並間接觸發武器聯動效果
export const PASSIVE_IDS = ['attack', 'critRate', 'critDmg', 'atkSpeed', 'moveSpeed'];

export const PASSIVE_DATA = {
  attack: {
    id: 'attack', name: '力量祝福', icon: 'icon_attack',
    desc: '提升攻擊力，並使火球術體積與爆炸範圍更大。',
    perLevel: 8, // 每級增加的百分比數值
  },
  critRate: {
    id: 'critRate', name: '幸運符文', icon: 'icon_critRate',
    desc: '提升爆擊率，並使雷電鎖鏈分裂數增加。',
    perLevel: 6,
  },
  critDmg: {
    id: 'critDmg', name: '致命打擊', icon: 'icon_critDmg',
    desc: '提升爆擊傷害倍率。',
    perLevel: 15,
  },
  atkSpeed: {
    id: 'atkSpeed', name: '疾風之刃', icon: 'icon_atkSpeed',
    desc: '提升攻擊速度，並使飛刀數量增加、鋸片轉速加快。',
    perLevel: 8,
  },
  moveSpeed: {
    id: 'moveSpeed', name: '迅捷之靴', icon: 'icon_moveSpeed',
    desc: '提升移動速度。',
    perLevel: 6,
  },
};

export function passiveLevelValue(id, level) {
  return PASSIVE_DATA[id].perLevel * level;
}
