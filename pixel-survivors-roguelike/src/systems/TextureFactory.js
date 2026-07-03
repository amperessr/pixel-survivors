// 素材產生器：以 Canvas 動態繪製所有像素風美術素材並註冊為 Phaser 材質
// 依規格：若無法直接產生 PNG，改以 Canvas 動態生成 (可愛 Q 版 / 明亮色彩 / 2.5D 俯視風格)
export default class TextureFactory {
  constructor(scene) {
    this.scene = scene;
  }

  // 建立一張畫布材質並回傳 context
  _canvas(key, w, h) {
    const tex = this.scene.textures.createCanvas(key, w, h);
    return { tex, ctx: tex.getContext() };
  }

  _finish(tex) {
    tex.refresh();
  }

  // 圓角矩形工具
  static roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  generateAll() {
    this.generatePlayers();
    this.generateEnemies();
    this.generateBoss();
    this.generateWeaponIcons();
    this.generateProjectiles();
    this.generatePassiveIcons();
    this.generateTiles();
    this.generateEffects();
    this.generateUI();
  }

  // ---------- 玩家四種角色 (Q版圓潤造型，用色區分職業) ----------
  generatePlayers() {
    const palette = {
      attacker: { body: '#ff6b5b', trim: '#c73f30', eye: '#2b2b2b' },
      speedster: { body: '#5bd4ff', trim: '#2a9ec2', eye: '#2b2b2b' },
      tank: { body: '#8f6bff', trim: '#5b3fc7', eye: '#2b2b2b' },
      balanced: { body: '#5bff8f', trim: '#2ac25b', eye: '#2b2b2b' },
    };
    for (const [id, c] of Object.entries(palette)) {
      const { tex, ctx } = this._canvas(`player_${id}`, 32, 32);
      // 陰影
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(16, 27, 9, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 身體 (圓潤Q版)
      ctx.fillStyle = c.body;
      TextureFactory.roundRect(ctx, 7, 8, 18, 18, 8);
      ctx.fill();
      ctx.strokeStyle = c.trim;
      ctx.lineWidth = 2;
      ctx.stroke();
      // 頭頂高光
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      TextureFactory.roundRect(ctx, 9, 10, 8, 5, 3);
      ctx.fill();
      // 眼睛
      ctx.fillStyle = c.eye;
      ctx.beginPath(); ctx.arc(13, 17, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(19, 17, 1.6, 0, Math.PI * 2); ctx.fill();
      // 披風/裝飾 (區分職業)
      ctx.fillStyle = c.trim;
      ctx.fillRect(6, 12, 3, 10);
      ctx.fillRect(23, 12, 3, 10);
      this._finish(tex);
    }
  }

  // ---------- 敵人四種一般怪 ----------
  generateEnemies() {
    // 史萊姆
    {
      const { tex, ctx } = this._canvas('enemy_slime', 24, 24);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(12, 21, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7be36a';
      ctx.beginPath();
      ctx.ellipse(12, 15, 9, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath(); ctx.ellipse(9, 11, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#233';
      ctx.beginPath(); ctx.arc(9, 15, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(15, 15, 1.3, 0, Math.PI * 2); ctx.fill();
      this._finish(tex);
    }
    // 哥布林
    {
      const { tex, ctx } = this._canvas('enemy_goblin', 26, 26);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(13, 23, 8, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8fbf4a';
      TextureFactory.roundRect(ctx, 5, 8, 16, 15, 6); ctx.fill();
      ctx.fillStyle = '#5f8a2f';
      ctx.beginPath(); ctx.moveTo(4, 9); ctx.lineTo(0, 3); ctx.lineTo(8, 8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(18, 9); ctx.lineTo(24, 3); ctx.lineTo(16, 8); ctx.fill();
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath(); ctx.arc(10, 16, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(16, 16, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c4c4c4';
      ctx.fillRect(19, 14, 6, 2);
      this._finish(tex);
    }
    // 骷髏
    {
      const { tex, ctx } = this._canvas('enemy_skeleton', 24, 26);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(12, 24, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f2f2e6';
      ctx.beginPath(); ctx.arc(12, 11, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1c1c1c';
      ctx.beginPath(); ctx.arc(9, 10, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(15, 10, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(9, 14, 6, 1.5);
      ctx.fillStyle = '#e8e8da';
      ctx.fillRect(7, 17, 10, 8);
      ctx.strokeStyle = '#b9b9a8';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(7, 19 + i * 2); ctx.lineTo(17, 19 + i * 2); ctx.stroke();
      }
      this._finish(tex);
    }
    // 獸人
    {
      const { tex, ctx } = this._canvas('enemy_orc', 30, 30);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(15, 27, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4f7d3a';
      TextureFactory.roundRect(ctx, 6, 9, 18, 17, 6); ctx.fill();
      ctx.fillStyle = '#eaeaea';
      ctx.beginPath(); ctx.moveTo(9, 18); ctx.lineTo(7, 23); ctx.lineTo(11, 19); ctx.fill();
      ctx.beginPath(); ctx.moveTo(21, 18); ctx.lineTo(23, 23); ctx.lineTo(19, 19); ctx.fill();
      ctx.fillStyle = '#ff3d3d';
      ctx.beginPath(); ctx.arc(11, 16, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(19, 16, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(24, 6, 3, 20);
      ctx.fillStyle = '#999';
      ctx.beginPath(); ctx.moveTo(24, 6); ctx.lineTo(30, 2); ctx.lineTo(30, 10); ctx.fill();
      this._finish(tex);
    }
  }

  // ---------- Boss (大型、威嚴、發光) ----------
  generateBoss() {
    const { tex, ctx } = this._canvas('boss_main', 64, 64);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(32, 58, 20, 5, 0, 0, Math.PI * 2); ctx.fill();
    // 光暈
    const grad = ctx.createRadialGradient(32, 32, 5, 32, 32, 34);
    grad.addColorStop(0, 'rgba(255,80,80,0.35)');
    grad.addColorStop(1, 'rgba(255,80,80,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    // 身體
    ctx.fillStyle = '#7a2130';
    TextureFactory.roundRect(ctx, 14, 16, 36, 34, 10);
    ctx.fill();
    ctx.strokeStyle = '#ffcf4d';
    ctx.lineWidth = 3;
    ctx.stroke();
    // 角
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath(); ctx.moveTo(18, 18); ctx.lineTo(10, 4); ctx.lineTo(24, 14); ctx.fill();
    ctx.beginPath(); ctx.moveTo(46, 18); ctx.lineTo(54, 4); ctx.lineTo(40, 14); ctx.fill();
    // 眼
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath(); ctx.arc(25, 30, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(39, 30, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(25, 30, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(39, 30, 1.3, 0, Math.PI * 2); ctx.fill();
    // 嘴
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.ellipse(32, 42, 8, 4, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#fff';
    for (let i = -6; i <= 6; i += 4) {
      ctx.fillRect(32 + i, 40, 2, 3);
    }
    this._finish(tex);
  }

  // ---------- 武器圖示 (5種 x 5階：以顏色深淺與大小表現階級) ----------
  generateWeaponIcons() {
    const weapons = {
      fireball: { base: '#ff8a3d', glow: '#ffdd55' },
      lightning: { base: '#ffe94d', glow: '#fff9c4' },
      knife: { base: '#c9d6df', glow: '#8fa3ad' },
      sawblade: { base: '#c0c0c0', glow: '#6e6e6e' },
      frost: { base: '#8fe3ff', glow: '#e3faff' },
    };
    for (const [id, c] of Object.entries(weapons)) {
      for (let lvl = 1; lvl <= 5; lvl++) {
        const size = 20 + lvl * 3;
        const { tex, ctx } = this._canvas(`weapon_${id}_lv${lvl}`, size, size);
        const cx = size / 2, cy = size / 2, r = size / 2 - 2;
        const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
        grad.addColorStop(0, c.glow);
        grad.addColorStop(1, c.base);
        ctx.fillStyle = grad;
        if (id === 'knife') {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-2, -r, 4, r * 2);
          ctx.restore();
        } else if (id === 'sawblade') {
          ctx.beginPath();
          const teeth = 8;
          for (let i = 0; i < teeth * 2; i++) {
            const ang = (i / (teeth * 2)) * Math.PI * 2;
            const rr = i % 2 === 0 ? r : r * 0.7;
            const px = cx + Math.cos(ang) * rr;
            const py = cy + Math.sin(ang) * rr;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#555';
          ctx.beginPath(); ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2); ctx.fill();
        } else if (id === 'lightning') {
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.2, cy - r);
          ctx.lineTo(cx + r * 0.3, cy - r * 0.1);
          ctx.lineTo(cx - r * 0.1, cy - r * 0.1);
          ctx.lineTo(cx + r * 0.2, cy + r);
          ctx.lineTo(cx - r * 0.3, cy + r * 0.1);
          ctx.lineTo(cx + r * 0.1, cy + r * 0.1);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        this._finish(tex);
      }
    }
  }

  // ---------- 飛行道具實體 (用於場上實際發射的物件) ----------
  generateProjectiles() {
    const defs = {
      proj_fireball: { color: '#ff8a3d', glow: '#ffdd55', r: 8 },
      proj_lightning: { color: '#ffe94d', glow: '#fff9c4', r: 6 },
      proj_knife: { color: '#c9d6df', glow: '#8fa3ad', r: 5 },
      proj_sawblade: { color: '#c0c0c0', glow: '#6e6e6e', r: 9 },
      proj_frost: { color: '#8fe3ff', glow: '#e3faff', r: 7 },
    };
    for (const [key, d] of Object.entries(defs)) {
      const size = d.r * 2 + 4;
      const { tex, ctx } = this._canvas(key, size, size);
      const cx = size / 2, cy = size / 2;
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, d.r);
      grad.addColorStop(0, d.glow);
      grad.addColorStop(1, d.color);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, d.r, 0, Math.PI * 2);
      ctx.fill();
      this._finish(tex);
    }
  }

  // ---------- 被動能力圖示 ----------
  generatePassiveIcons() {
    const passives = {
      attack: '#ff5b5b',
      critRate: '#ffd93d',
      critDmg: '#ff9d3d',
      atkSpeed: '#5bd4ff',
      moveSpeed: '#5bff8f',
    };
    for (const [id, color] of Object.entries(passives)) {
      const { tex, ctx } = this._canvas(`icon_${id}`, 22, 22);
      ctx.fillStyle = color;
      TextureFactory.roundRect(ctx, 2, 2, 18, 18, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(11, 5); ctx.lineTo(14, 11); ctx.lineTo(11, 17); ctx.lineTo(8, 11);
      ctx.closePath();
      ctx.fill();
      this._finish(tex);
    }
  }

  // ---------- 地圖 Tile (草地/樹/石頭/花/河流/小路) ----------
  generateTiles() {
    const T = 32;
    // 草地
    {
      const { tex, ctx } = this._canvas('tile_grass', T, T);
      ctx.fillStyle = '#5cb85c';
      ctx.fillRect(0, 0, T, T);
      ctx.fillStyle = 'rgba(80,160,80,0.5)';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(Math.random() * T, Math.random() * T, 2, 2);
      }
      this._finish(tex);
    }
    // 小路
    {
      const { tex, ctx } = this._canvas('tile_path', T, T);
      ctx.fillStyle = '#d8c48a';
      ctx.fillRect(0, 0, T, T);
      ctx.fillStyle = 'rgba(160,140,90,0.4)';
      for (let i = 0; i < 8; i++) {
        ctx.fillRect(Math.random() * T, Math.random() * T, 2, 2);
      }
      this._finish(tex);
    }
    // 河流
    {
      const { tex, ctx } = this._canvas('tile_river', T, T);
      ctx.fillStyle = '#4aa3e0';
      ctx.fillRect(0, 0, T, T);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(0, 10, T, 3);
      ctx.fillRect(0, 22, T, 2);
      this._finish(tex);
    }
    // 樹
    {
      const { tex, ctx } = this._canvas('obj_tree', T, T + 12);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(T / 2, T + 8, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7a4a2a';
      ctx.fillRect(T / 2 - 3, T - 8, 6, 16);
      ctx.fillStyle = '#3f9e4a';
      ctx.beginPath(); ctx.arc(T / 2, 12, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#57c266';
      ctx.beginPath(); ctx.arc(T / 2 - 5, 8, 7, 0, Math.PI * 2); ctx.fill();
      this._finish(tex);
    }
    // 石頭
    {
      const { tex, ctx } = this._canvas('obj_rock', T, T);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(16, 26, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9a9a9a';
      ctx.beginPath(); ctx.ellipse(16, 18, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.ellipse(12, 14, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      this._finish(tex);
    }
    // 花
    {
      const { tex, ctx } = this._canvas('obj_flower', T, T);
      const colors = ['#ff6b9d', '#ffd93d', '#fff'];
      const c = colors[Math.floor(Math.random() * colors.length)];
      ctx.fillStyle = '#3f9e4a';
      ctx.fillRect(15, 18, 2, 10);
      ctx.fillStyle = c;
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(16 + Math.cos(ang) * 4, 16 + Math.sin(ang) * 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffd93d';
      ctx.beginPath(); ctx.arc(16, 16, 2.5, 0, Math.PI * 2); ctx.fill();
      this._finish(tex);
    }
    // 背景 (更大範圍的草原漸層，作為 tilesprite 背景備援)
    {
      const { tex, ctx } = this._canvas('bg_field', 256, 256);
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#68c26a');
      grad.addColorStop(1, '#4fa851');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      this._finish(tex);
    }
  }

  // ---------- 特效 (爆擊/擊殺/火焰/雷電/冰凍/升級光圈/Boss死亡) ----------
  generateEffects() {
    const mk = (key, size, draw) => {
      const { tex, ctx } = this._canvas(key, size, size);
      draw(ctx, size);
      this._finish(tex);
    };
    mk('fx_crit', 28, (ctx, s) => {
      ctx.strokeStyle = '#ffe14d';
      ctx.lineWidth = 3;
      const cx = s / 2, cy = s / 2;
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * 4, cy + Math.sin(ang) * 4);
        ctx.lineTo(cx + Math.cos(ang) * 12, cy + Math.sin(ang) * 12);
        ctx.stroke();
      }
    });
    mk('fx_kill', 26, (ctx, s) => {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2); ctx.fill();
    });
    mk('fx_flame', 24, (ctx, s) => {
      const grad = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
      grad.addColorStop(0, '#ffdd55');
      grad.addColorStop(0.6, '#ff8a3d');
      grad.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
    });
    mk('fx_bolt', 24, (ctx, s) => {
      ctx.strokeStyle = '#fff9c4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(4, 2); ctx.lineTo(14, 10); ctx.lineTo(8, 12); ctx.lineTo(20, 22);
      ctx.stroke();
    });
    mk('fx_frost', 24, (ctx, s) => {
      const grad = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
      grad.addColorStop(0, '#e3faff');
      grad.addColorStop(1, 'rgba(140,220,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
    });
    mk('fx_levelup', 64, (ctx, s) => {
      ctx.strokeStyle = '#6fd3ff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(111,211,255,0.5)';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2); ctx.stroke();
    });
    mk('fx_bossdeath', 96, (ctx, s) => {
      const grad = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.4, '#ffcf4d');
      grad.addColorStop(1, 'rgba(255,80,80,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
    });
    // 經驗寶石
    mk('gem_exp', 12, (ctx, s) => {
      ctx.fillStyle = '#6fe3ff';
      ctx.beginPath();
      ctx.moveTo(s / 2, 0); ctx.lineTo(s, s / 2); ctx.lineTo(s / 2, s); ctx.lineTo(0, s / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  // ---------- UI 元件 (血條框、經驗條框、按鈕背景) ----------
  generateUI() {
    const mk = (key, w, h, draw) => {
      const { tex, ctx } = this._canvas(key, w, h);
      draw(ctx);
      this._finish(tex);
    };
    mk('ui_bar_bg', 200, 16, (ctx) => {
      ctx.fillStyle = '#20232c';
      TextureFactory.roundRect(ctx, 0, 0, 200, 16, 6);
      ctx.fill();
      ctx.strokeStyle = '#444';
      ctx.stroke();
    });
    mk('ui_bar_fill_hp', 200, 16, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 200, 0);
      grad.addColorStop(0, '#ff4d4d');
      grad.addColorStop(1, '#ff8a5b');
      ctx.fillStyle = grad;
      TextureFactory.roundRect(ctx, 0, 0, 200, 16, 6);
      ctx.fill();
    });
    mk('ui_bar_fill_xp', 200, 10, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 200, 0);
      grad.addColorStop(0, '#6fd3ff');
      grad.addColorStop(1, '#8fffd0');
      ctx.fillStyle = grad;
      TextureFactory.roundRect(ctx, 0, 0, 200, 10, 4);
      ctx.fill();
    });
    mk('ui_bar_fill_boss', 300, 18, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 300, 0);
      grad.addColorStop(0, '#c72d3d');
      grad.addColorStop(1, '#ff5b5b');
      ctx.fillStyle = grad;
      TextureFactory.roundRect(ctx, 0, 0, 300, 18, 6);
      ctx.fill();
    });
    mk('ui_panel', 260, 140, (ctx) => {
      ctx.fillStyle = 'rgba(20,22,32,0.9)';
      TextureFactory.roundRect(ctx, 0, 0, 260, 140, 10);
      ctx.fill();
      ctx.strokeStyle = '#6fd3ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    mk('ui_card', 190, 240, (ctx) => {
      ctx.fillStyle = 'rgba(30,34,48,0.95)';
      TextureFactory.roundRect(ctx, 0, 0, 190, 240, 12);
      ctx.fill();
      ctx.strokeStyle = '#6fd3ff';
      ctx.lineWidth = 3;
      ctx.stroke();
    });
  }
}
