// 本地儲存管理：玩家名稱僅需詢問一次，之後從 localStorage 讀取
const NAME_KEY = 'pixelSurvivors_playerName';
const BEST_KEY = 'pixelSurvivors_bestScore';

export function getPlayerName() {
  return localStorage.getItem(NAME_KEY);
}

export function setPlayerName(name) {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 12));
}

export function getBestScore() {
  return parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
}

export function setBestScore(score) {
  const best = getBestScore();
  if (score > best) {
    localStorage.setItem(BEST_KEY, String(score));
  }
}

// 顯示 HTML 名稱輸入 Modal，回傳 Promise<string>
export function promptPlayerName() {
  return new Promise((resolve) => {
    const existing = getPlayerName();
    if (existing) {
      resolve(existing);
      return;
    }
    const modal = document.getElementById('name-modal');
    const input = document.getElementById('name-input');
    const btn = document.getElementById('name-confirm');
    modal.classList.remove('hidden');
    input.focus();

    const confirm = () => {
      const val = input.value.trim() || `冒險者${Math.floor(Math.random() * 9000 + 1000)}`;
      setPlayerName(val);
      modal.classList.add('hidden');
      btn.removeEventListener('click', confirm);
      input.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Enter') confirm();
    };
    btn.addEventListener('click', confirm);
    input.addEventListener('keydown', onKey);
  });
}
