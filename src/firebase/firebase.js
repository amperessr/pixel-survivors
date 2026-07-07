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
  get,
  set,
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

// ---------- 帳號系統：用名字＋密碼把存檔（金幣/裝備/背包/關卡進度）同步到雲端， ----------
// ---------- 讓同一個名字在不同電腦登入都能讀到最新進度。 ----------

// Realtime Database 的 key 不能包含 . # $ [ ] / ，把這些字元換掉，
// 避免玩家名字剛好用到這些符號時整個路徑失效。
function sanitizeNameKey(name) {
  return String(name).replace(/[.#$/\[\]]/g, "_");
}

// 密碼不能明碼存在資料庫裡：用瀏覽器內建的 Web Crypto API 做 SHA-256 雜湊，
// 資料庫裡只會存雜湊後的字串，存取時也只比對雜湊值。
export async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 讀取某個名字底下的雲端帳號資料。
 * @returns {Promise<{exists:boolean, data:Object|null}>}
 */
export async function fetchAccount(name) {
  ensureInit();
  const accountRef = ref(db, `accounts/${sanitizeNameKey(name)}`);
  const snapshot = await get(accountRef);
  if (!snapshot.exists()) return { exists: false, data: null };
  return { exists: true, data: snapshot.val() };
}

/**
 * 把整包帳號資料（密碼雜湊 + 金幣/裝備/背包/關卡進度）寫入雲端，
 * 用 set() 整包覆蓋，不是只更新單一欄位，避免不同裝置各自局部更新造成資料不一致。
 */
export async function saveAccount(name, data) {
  ensureInit();
  const accountRef = ref(db, `accounts/${sanitizeNameKey(name)}`);
  await set(accountRef, data);
}
