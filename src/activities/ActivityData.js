// 活動關卡資料：主選單「活動關卡」先進 ActivitySelectScene 選一個活動再進遊戲，
// 這裡定義每個活動的開放時間／卡片內容，之後要加新活動只要在 ACTIVITIES 陣列
// 多加一筆、在 onPick 裡呼叫對應的進場邏輯即可，不用改 ActivitySelectScene 本身。
//
// 汪汪大作戰時間表：07/11 00:00 開放、07/15 24:00（=07/16 00:00）結束。開放前／
// 結束後都視為「尚未開放」，同一套時間判斷同時給 ActivitySelectScene（能不能進）
// 跟 MainMenuScene 的排行榜面板（顯示開放/結束時間、活動已結束）共用。
export const WOOF_WAR_OPEN_AT = new Date(2026, 6, 11, 0, 0, 0).getTime();  // 2026/07/11 00:00
export const WOOF_WAR_CLOSE_AT = new Date(2026, 6, 16, 0, 0, 0).getTime(); // 實際邊界＝2026/07/16 00:00

// 結束時間的「顯示文字」故意跟 WOOF_WAR_CLOSE_AT 的實際時間戳分開處理：Date 物件
// 沒辦法表示「24:00」這種寫法（會自動進位成隔天 00:00），但安培給的規格就是要顯示
// 「07/15 24:00」——直接格式化 WOOF_WAR_CLOSE_AT 只會秀出「07/16 00:00」，跟需求
// 的顯示文字對不上，所以顯示字串在這裡另外寫死，實際的開放判斷邏輯還是用
// WOOF_WAR_CLOSE_AT 那個時間戳，兩者不會不同步（07/16 00:00 就是 07/15 24:00）。
export const WOOF_WAR_CLOSE_LABEL = '07/15 24:00';

// 'before' 尚未開放／'live' 開放中／'after' 已結束
export function getWoofWarPhase(now = Date.now()) {
  if (now < WOOF_WAR_OPEN_AT) return 'before';
  if (now < WOOF_WAR_CLOSE_AT) return 'live';
  return 'after';
}

// 封測名單：正式開放時間到之前，只有名單內的玩家能提早把活動當成「開放中」來測試，
// 其餘玩家還是照真實時間看到「尚未開放」——活動結束後（'after'）名單就不再生效，
// 不會讓已結束的活動又對名單內的人重新打開。要正式公開測試時把名單清空即可，
// 不用動到任何呼叫這個函式的地方。
export const WOOF_WAR_BETA_TESTERS = ['安培'];

export function getWoofWarEffectivePhase(playerName) {
  const phase = getWoofWarPhase();
  if (phase === 'before' && WOOF_WAR_BETA_TESTERS.includes(playerName)) return 'live';
  return phase;
}

function pad2(n) { return String(n).padStart(2, '0'); }
// 顯示用日期字串，跟 CLAUDE.md／MailData.js 的慣例一致，格式 MM/DD HH:mm——
// 只給「開放時間」這種正常時刻用，結束時間請用上面寫死的 WOOF_WAR_CLOSE_LABEL。
export function formatWoofWarTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export const ACTIVITIES = [
  {
    id: 'woofWar',
    label: '汪汪大作戰',
    desc: '打倒血量異常高的汪汪，比誰在時限內造成的傷害最多！排行榜前 5 名活動結束後會收到獎勵信件。',
    icon: 'boss_woof',
    getPhase: (playerName) => getWoofWarEffectivePhase(playerName),
    onEnter: (scene) => scene.scene.start('GameScene', { woofWarMode: true }),
  },
];
