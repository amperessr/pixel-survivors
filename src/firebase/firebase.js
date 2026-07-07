// Firebase Realtime Database 排行榜整合
// 注意：依需求規格，使用 Realtime Database，不使用 Firestore
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
  query,
  orderByChild,
  limitToLast,
  onValue,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// 專案設定：使用使用者提供的 Realtime Database URL
const firebaseConfig = {
  databaseURL:
    "https://game-text-cd3c2-default-rtdb.asia-southeast1.firebasedatabase.app/",
};

let app = null;
let db = null;
let leaderboardRef = null;

function ensureInit() {
  if (!app) {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    leaderboardRef = ref(db, "leaderboard");
  }
}

/**
 * 上傳分數紀錄到排行榜
 * @param {{name:string, score:number, kill:number, time:number, date:string}} entry
 */
export async function submitScore(entry) {
  try {
    ensureInit();
    await push(leaderboardRef, entry);
    return true;
  } catch (err) {
    console.warn("[Firebase] 上傳分數失敗（可能離線或網路受限）：", err.message);
    return false;
  }
}

/**
 * 訂閱排行榜 TOP10，依 score 排序，即時同步。
 * 同一個名稱只會顯示一次（取該名稱底下的最高分），避免同一人重複刷分把排行榜洗成
 * 都是自己的名字——做法是多撈一些原始紀錄（100 筆）回來，前端依名稱去重後再取前 10 名。
 * @param {(list: Array) => void} callback
 * @returns {Function} unsubscribe
 */
export function subscribeLeaderboard(callback) {
  try {
    ensureInit();
    // 撈多一點原始紀錄（不是只撈 10 筆），才有足夠的資料可以在去重之後還湊得滿 10 個不同的名字
    const topQuery = query(leaderboardRef, orderByChild("score"), limitToLast(100));
    const unsubscribe = onValue(
      topQuery,
      (snapshot) => {
        const rows = [];
        snapshot.forEach((child) => {
          rows.push(child.val());
        });
        rows.sort((a, b) => (b.score || 0) - (a.score || 0));

        // 依名稱去重：陣列已經是分數由高到低排序，所以每個名字第一次出現
        // 的那筆就是他的最高分，直接跳過後面重複的名字即可
        const seenNames = new Set();
        const deduped = [];
        for (const row of rows) {
          const key = row.name || "???";
          if (seenNames.has(key)) continue;
          seenNames.add(key);
          deduped.push(row);
          if (deduped.length >= 10) break;
        }
        callback(deduped);
      },
      (err) => {
        console.warn("[Firebase] 讀取排行榜失敗：", err.message);
        callback([]);
      }
    );
    return unsubscribe;
  } catch (err) {
    console.warn("[Firebase] 初始化失敗：", err.message);
    callback([]);
    return () => {};
  }
}
