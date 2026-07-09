// 音效管理器：使用 Web Audio API 即時合成音效與簡易 BGM
// 依需求：攻擊、擊殺、升級、Boss、BGM
const MUTE_KEY = 'pixelSurvivors_muted';

export default class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.bgmNodes = [];
    // 靜音狀態改成讀 localStorage：玩家按過靜音鈕之後，重開新局（甚至重新整理
    // 整個網頁）都要維持上次的開關狀態，不能每次都重置回「有聲音」。
    this.enabled = localStorage.getItem(MUTE_KEY) !== '1';
    this.bgmPlaying = false;
  }

  // 唯一的靜音開關入口：同時更新記憶體狀態、寫回 localStorage、並即時停掉/
  // 恢復目前播放中的 BGM——UIScene 的靜音鈕跟其他呼叫端都應該走這個方法，
  // 不要再各自直接改 this.enabled 又各自呼叫 startBgm/stopBgm，兩邊分開寫
  // 容易漏掉某一種情境（例如忘記存 localStorage）。
  setEnabled(value) {
    this.enabled = value;
    localStorage.setItem(MUTE_KEY, value ? '0' : '1');
    if (value) {
      this.startBgm();
    } else {
      this.stopBgm();
    }
  }

  _ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.18;
      this.bgmGain.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _tone(freq, dur, type = 'sine', gainVal = 0.3, when = 0, sweepTo = null) {
    if (!this.enabled) return;
    this._ensureCtx();
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    gain.gain.setValueAtTime(gainVal, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  attack() { this._tone(440, 0.06, 'square', 0.15, 0, 260); }
  hit() { this._tone(180, 0.08, 'sawtooth', 0.18, 0, 90); }
  kill() { this._tone(320, 0.12, 'triangle', 0.2, 0, 120); }
  levelUp() {
    this._tone(523, 0.12, 'sine', 0.25, 0);
    this._tone(659, 0.12, 'sine', 0.25, 0.08);
    this._tone(784, 0.2, 'sine', 0.25, 0.16);
  }
  pickup() { this._tone(880, 0.05, 'sine', 0.12, 0, 1200); }
  bossRoar() {
    this._tone(80, 0.5, 'sawtooth', 0.35, 0, 40);
    this._tone(120, 0.4, 'square', 0.25, 0.05, 60);
  }
  bossDeath() {
    this._tone(300, 0.6, 'sawtooth', 0.3, 0, 40);
    this._tone(200, 0.6, 'square', 0.25, 0.1, 30);
  }
  dash() { this._tone(600, 0.08, 'sine', 0.15, 0, 900); }
  gameOver() {
    this._tone(400, 0.3, 'sine', 0.25, 0, 200);
    this._tone(300, 0.4, 'sine', 0.25, 0.2, 100);
  }

  startBgm() {
    // GameScene 每次開新局都會無條件呼叫 startBgm()，這裡自己擋掉靜音狀態，
    // 呼叫端不用每個地方都各自檢查 enabled，也不會發生「上次按了靜音，開新局
    // 卻又聽到音樂」的情況。
    if (!this.enabled || this.bgmPlaying) return;
    this._ensureCtx();
    this.bgmPlaying = true;
    const notes = [261.6, 293.7, 329.6, 349.2, 392.0, 440.0, 392.0, 349.2];
    let i = 0;
    this._bgmInterval = setInterval(() => {
      if (!this.bgmPlaying) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(notes[i % notes.length], t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.15, t0 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
      osc.connect(gain);
      gain.connect(this.bgmGain);
      osc.start(t0);
      osc.stop(t0 + 0.45);
      i++;
    }, 420);
  }

  stopBgm() {
    this.bgmPlaying = false;
    if (this._bgmInterval) clearInterval(this._bgmInterval);
  }
}

export const audioManager = new AudioManager();
