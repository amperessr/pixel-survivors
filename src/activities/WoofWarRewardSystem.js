import { getWoofWarPhase } from './ActivityData.js';
import { getPlayerName, getWoofWarReward, setWoofWarReward } from '../managers/SaveManager.js';
import { fetchFullWoofWarLeaderboard } from '../firebase/firebase.js';
import { LOOT_BALL_IDS } from '../equipment/EquipmentData.js';

// MailboxScene 用這個 id 動態產生個人化結算信、MainMenuScene 用來檢查未讀紅點——
// 兩邊都要認得同一個 id 才能對上同一封信的領取/刪除狀態，所以在這裡統一匯出，
// 不要各自寫一份字串常數（改了容易漏改其中一邊）。
export const WOOF_WAR_REWARD_MAIL_ID = 'woofwar_reward_2026';

// 汪汪大作戰活動結束後的獎勵結算：這是純前端遊戲，沒有後端排程可以在 07/15 24:00
// 那一刻自動幫「所有」玩家發信，只能做到「玩家下次打開主選單時，如果活動已經結束
// 而且這個帳號還沒結算過，就補算一次」——見 MainMenuScene.create() 呼叫這個函式。
// 算過一次就把結果存進帳號（getWoofWarReward／setWoofWarReward，會跟著帳號同步到
// 雲端），不會每次開主選單都重打一次 API，結果也不會因為之後排行榜資料變動而改變。
//
// 名次對應獎勵（跟安培談好的活動規則）：
//   第 1 名　→ 紅球（自選神話裝備）
//   第 2 名　→ 金球（自選傳說裝備）
//   第 3 名　→ 10 萬金幣
//   其餘有紀錄的參加者　→ 3 萬金幣（參加獎）
//   完全沒有紀錄（沒打過汪汪）　→ 沒有獎勵，不會產生信件
export async function resolveWoofWarRewardIfNeeded() {
  if (getWoofWarPhase() !== 'after') return;
  if (getWoofWarReward()) return; // 已經結算過

  const name = getPlayerName();
  if (!name) return;

  const rows = await fetchFullWoofWarLeaderboard();
  const idx = rows.findIndex((r) => r.name === name);
  if (idx === -1) {
    setWoofWarReward({ participated: false });
    return;
  }

  const rank = idx + 1;
  let reward;
  if (rank === 1) {
    reward = { prizeType: 'item', itemId: LOOT_BALL_IDS.mythic, label: '自選神話裝備' };
  } else if (rank === 2) {
    reward = { prizeType: 'item', itemId: LOOT_BALL_IDS.legendary, label: '自選傳說裝備' };
  } else if (rank === 3) {
    reward = { prizeType: 'gold', gold: 100000, label: '10 萬金幣' };
  } else {
    reward = { prizeType: 'gold', gold: 30000, label: '3 萬金幣（參加獎）' };
  }
  setWoofWarReward({ participated: true, rank, ...reward });
}
