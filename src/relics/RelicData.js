// 遺物系統：擊敗特定 Boss 後可選擇拿取的永久加成，每種遺物一輩子只能拿一次
// （拿過之後同類型的 Boss 再死也不會重複詢問）。
export const RELICS = {
  dragonAura: {
    id: 'dragonAura',
    name: '龍之光環',
    subtitle: '擊敗黑藍巨龍的獎賞',
    desc: '生命上限與攻擊力\n永久提升 2 倍！\n身上會持續纏繞金色龍息氣場',
    // 用真正的黑龍美術圖（574x320，橫向構圖），iconScale 另外調過比例，
    // 不能沿用舊的方形貼圖縮放倍率，不然會爆版蓋住整張卡片。
    icon: 'boss_black',
    iconScale: 0.38,
    // 實際套用效果：呼叫 Player.applyDragonAura()
    apply(gameScene) {
      gameScene.player.applyDragonAura();
      gameScene.enableDragonAuraVisual();
    },
    hasIt(player) { return !!player.hasDragonAura; },
  },
  dragonWings: {
    id: 'dragonWings',
    name: '龍之翼',
    subtitle: '擊敗血色紅龍的獎賞',
    desc: '移動速度永久提升 1.5 倍！\n從此健步如飛，來去如風',
    icon: 'boss_red',
    iconScale: 0.38,
    apply(gameScene) {
      gameScene.player.applyDragonWings();
      gameScene.enableDragonWingsVisual();
    },
    hasIt(player) { return !!player.hasDragonWings; },
  },
};
