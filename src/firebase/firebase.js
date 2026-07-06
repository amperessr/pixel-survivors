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
 * 訂閱排行榜 TOP10，依 score 排序，即時同步
 * @param {(list: Array) => void} callback
 * @returns {Function} unsubscribe
 */
export function subscribeLeaderboard(callback) {
  try {
    ensureInit();
    const topQuery = query(leaderboardRef, orderByChild("score"), limitToLast(10));
    const unsubscribe = onValue(
      topQuery,
      (snapshot) => {
        const rows = [];
        snapshot.forEach((child) => {
          rows.push(child.val());
        });
        rows.sort((a, b) => (b.score || 0) - (a.score || 0));
        callback(rows);
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
