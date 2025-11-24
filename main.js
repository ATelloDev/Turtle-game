(() => {
  'use strict';

  // DOM refs
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const nameInput = document.getElementById('playerName');
  const leaderboardEl = document.getElementById('leaderboard');
  const btnStart = document.getElementById('btnStart');
  const btnRestart = document.getElementById('btnRestart');
  const btnClear = document.getElementById('btnClear');
  const overlay = document.getElementById('overlay');

  // Game constants (Marine)
  const BUOYANCY = -500; // upward force px/s^2
  const DIVE_ACCEL = 900; // dive acceleration px/s^2
  const MAX_VY = 520; // clamp vertical speed
  const HAZARD_SPEED = 180; // jellyfish speed px/s
  const PEARL_SPEED = 220; // pearl speed px/s
  const SPAWN_EVERY = 1100; // ms
  const SURFACE_Y = 40; // top bound (water surface)
  const SEABED_Y = () => canvas.height - 60; // bottom bound (seabed)

  // State
  let state = 'menu'; // 'menu' | 'playing' | 'gameover'
  let last = 0;
  let accSpawn = 0;
  let score = 0;
  let passed = new Set();

  const turtle = {
    x: 160,
    y: 220,
    r: 20,
    vy: 0,
  };

  // Entities
  /** Jellyfish hazards */
  /** item: { x, y, r, phase } */
  let jellys = [];
  /** Pearls collectibles */
  /** item: { x, y, r } */
  let pearls = [];

  // Leaderboard helpers
  const LS_KEY = 'flappy-turtle-leaderboard-v1';
  const NAME_KEY = 'flappy-turtle-name';
  function getName() {
    return (localStorage.getItem(NAME_KEY) || '').slice(0, 16);
  }
  function setName(v) {
    localStorage.setItem(NAME_KEY, (v || '').slice(0, 16));
  }
  function loadLB() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  }
  function saveLB(items) {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  }
  function addScoreToLB(name, s) {
    const now = new Date().toISOString();
    const arr = loadLB();
    arr.push({ name: name || 'Anónimo', score: s|0, date: now });
    arr.sort((a,b) => b.score - a.score);
    const top = arr.slice(0, 10);
    saveLB(top);
    return top;
  }
  function renderLB(highlightName) {
    const arr = loadLB();
    leaderboardEl.innerHTML = '';
    if (arr.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'Aún no hay puntuaciones';
      li.style.color = '#94a3b8';
      leaderboardEl.appendChild(li);
      return;
    }
    arr.forEach((it, i) => {
      const li = document.createElement('li');
      li.textContent = `${it.name} — ${it.score}`;
      if (highlightName && it.name === highlightName) li.classList.add('me');
      leaderboardEl.appendChild(li);
    });
  }

  // UI init
  nameInput.value = getName();
  nameInput.addEventListener('change', (e) => setName(e.target.value));
  nameInput.addEventListener('blur', (e) => setName(e.target.value));

  btnStart.addEventListener('click', () => startGame());
  btnRestart.addEventListener('click', () => resetToMenu());
  btnClear.addEventListener('click', () => {
    localStorage.removeItem(LS_KEY);
    renderLB(getName());
  });

  // Controls
  let isDiving = false;
  function handlePressStart() {
    if (state === 'menu' || state === 'gameover') startGame();
    isDiving = true;
  }
  function handlePressEnd() { isDiving = false; }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); handlePressStart(); }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resetToMenu(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { e.preventDefault(); handlePressEnd(); }
  });
  canvas.addEventListener('pointerdown', () => handlePressStart(), { passive: true });
  window.addEventListener('pointerup', () => handlePressEnd(), { passive: true });

  // Resize handling to keep a nice aspect
  function fitCanvas() {
    const aspect = 16/9; // base width/height 800x450
    const containerW = canvas.parentElement.clientWidth;
    const w = containerW; // use full available width in the grid cell
    const h = Math.round(w / aspect);
    canvas.width = 800; // internal resolution fixed for physics
    canvas.height = 450;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  function startGame() {
    state = 'playing';
    overlay.classList.add('hidden');
    btnStart.disabled = true;
    btnRestart.disabled = false;
    resetWorld();
  }

  function resetToMenu() {
    state = 'menu';
    overlay.classList.remove('hidden');
    overlay.innerHTML = `<div class="card"><h2>Aventura Marina</h2><p>Presiona Espacio o Clic para bucear y esquiva medusas, recoge perlas.</p><p>Presiona Espacio o Clic para empezar</p></div>`;
    btnStart.disabled = false;
    btnRestart.disabled = false;
    resetWorld();
  }

  function gameOver() {
    state = 'gameover';
    const player = nameInput.value.trim() || 'Anónimo';
    setName(player);
    const top = addScoreToLB(player, score);
    renderLB(player);
    overlay.classList.remove('hidden');
    overlay.innerHTML = `<div class="card"><h2>¡Fin del buceo!</h2><p>Perlas: <strong>${score}</strong></p><p>Guardado para <strong>${player}</strong>.</p><p>Presiona R para reiniciar o clic en Reiniciar.</p></div>`;
    btnStart.disabled = true;
    btnRestart.disabled = false;
  }

  function resetWorld() {
    // physics reset
    turtle.x = 140;
    turtle.y = 280;
    turtle.vy = 0;
    jellys = [];
    pearls = [];
    score = 0;
    accSpawn = 0;
    passed.clear();
    updateScore(0);
  }

  function updateScore(v) {
    score = v;
    scoreEl.textContent = String(score);
  }

  function spawnEntity() {
    // Randomly spawn a jellyfish or a pearl entering from right
    const y = Math.floor(SURFACE_Y + 40 + Math.random() * (SEABED_Y() - SURFACE_Y - 80));
    if (Math.random() < 0.55) {
      // jellyfish
      jellys.push({ x: canvas.width + 40, y, r: 24, phase: Math.random()*Math.PI*2 });
    } else {
      pearls.push({ x: canvas.width + 40, y, r: 10 });
    }
  }

  function dist2(ax, ay, bx, by) { const dx = ax-bx, dy = ay-by; return dx*dx + dy*dy; }

  function update(dt) {
    if (state !== 'playing') return;

    // spawn
    accSpawn += dt * 1000;
    if (accSpawn >= SPAWN_EVERY) { accSpawn = 0; spawnEntity(); }

    // move entities
    for (const j of jellys) {
      j.x -= HAZARD_SPEED * dt;
      j.phase += dt * 2.5; // gentle bobbing
      j.y += Math.sin(j.phase) * 18 * dt;
    }
    for (const p of pearls) p.x -= PEARL_SPEED * dt;
    jellys = jellys.filter(j => j.x + j.r > -20);
    pearls = pearls.filter(p => p.x + p.r > -20);

    // physics turtle (buoyancy upwards / dive when pressed)
    const accel = isDiving ? DIVE_ACCEL : BUOYANCY;
    turtle.vy += accel * dt;
    turtle.vy = Math.max(-MAX_VY, Math.min(MAX_VY, turtle.vy));
    turtle.y += turtle.vy * dt;

    // bounds: clamp at surface, death at seabed
    if (turtle.y - turtle.r < SURFACE_Y) {
      turtle.y = SURFACE_Y + turtle.r;
      if (turtle.vy < 0) turtle.vy = 0;
    }
    if (turtle.y + turtle.r > SEABED_Y()) { return gameOver(); }

    // collisions with jellyfish (game over)
    for (const j of jellys) {
      const r = turtle.r + j.r - 2;
      if (dist2(turtle.x, turtle.y, j.x, j.y) < r*r) return gameOver();
    }
    // collisions with pearls (score)
    for (let i = pearls.length - 1; i >= 0; i--) {
      const p = pearls[i];
      const r = turtle.r + p.r;
      if (dist2(turtle.x, turtle.y, p.x, p.y) < r*r) {
        pearls.splice(i, 1);
        updateScore(score + 1);
      }
    }
  }

  function drawBackground() {
    // Water gradient
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#0ea5e9');
    g.addColorStop(0.5, '#0284c7');
    g.addColorStop(1, '#0c4a6e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Surface line
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, SURFACE_Y-2, canvas.width, 2);

    // Light rays
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ffffff';
    for (let i=0;i<5;i++) {
      const x = (i*160 + (Date.now()/18)%240) % (canvas.width+300) - 150;
      ctx.beginPath();
      ctx.moveTo(x, SURFACE_Y);
      ctx.lineTo(x+120, SURFACE_Y);
      ctx.lineTo(x+20, canvas.height);
      ctx.lineTo(x-100, canvas.height);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Seabed
    ctx.fillStyle = '#14532d';
    ctx.fillRect(0, SEABED_Y(), canvas.width, canvas.height - SEABED_Y());

    // Seaweed
    ctx.strokeStyle = '#166534';
    ctx.lineWidth = 3;
    for (let x=20; x<canvas.width; x+=80) {
      ctx.beginPath();
      const base = SEABED_Y();
      ctx.moveTo(x, base);
      ctx.quadraticCurveTo(x-10, base-30, x+6, base-60);
      ctx.quadraticCurveTo(x+14, base-30, x+2, base-10);
      ctx.stroke();
    }
  }

  function drawEntities() {
    // Jellyfish
    for (const j of jellys) {
      // body
      ctx.fillStyle = '#a78bfa';
      ctx.beginPath();
      ctx.ellipse(j.x, j.y, j.r*0.9, j.r*0.7, 0, 0, Math.PI*2);
      ctx.fill();
      // head dome
      ctx.fillStyle = '#8b5cf6';
      ctx.beginPath();
      ctx.ellipse(j.x, j.y-4, j.r*0.9, j.r*0.6, 0, 0, Math.PI);
      ctx.fill();
      // tentacles
      ctx.strokeStyle = '#c4b5fd';
      ctx.lineWidth = 2;
      for (let k=0;k<4;k++) {
        const off = (k-1.5)*5;
        ctx.beginPath();
        ctx.moveTo(j.x+off, j.y + j.r*0.4);
        ctx.quadraticCurveTo(j.x+off+6, j.y + j.r*0.7, j.x+off-4, j.y + j.r);
        ctx.stroke();
      }
    }
    // Pearls
    for (const p of pearls) {
      ctx.fillStyle = '#e5e7eb';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      ctx.arc(p.x-3, p.y-3, p.r*0.4, 0, Math.PI*2);
      ctx.fill();
    }
  }

  function drawTurtle() {
    const { x, y, r } = turtle;
    const t = Math.sin(Date.now()/120) * 2;
    const tilt = Math.max(-0.6, Math.min(0.6, turtle.vy / MAX_VY));

    // shadow on seabed
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    const shadowY = SEABED_Y();
    const dist = Math.max(0, shadowY - y - r);
    const s = Math.max(12, 28 - dist*0.05);
    ctx.beginPath();
    ctx.ellipse(x, shadowY - 6, s*1.3, s*0.6, 0, 0, Math.PI*2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    // shell
    ctx.fillStyle = '#065f46';
    ctx.beginPath();
    ctx.ellipse(0, 0, r*1.6, r*1.2, 0, 0, Math.PI*2);
    ctx.fill();
    // shell pattern
    ctx.fillStyle = '#0f766e';
    ctx.beginPath();
    ctx.ellipse(0, 0, r*1.3, r*0.9, 0, 0, Math.PI*2);
    ctx.fill();

    // head
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.ellipse(r*1.4, -4, r*0.8, r*0.7, 0, 0, Math.PI*2);
    ctx.fill();

    // eye
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(r*1.7, -6, r*0.12, 0, Math.PI*2);
    ctx.fill();

    // flipper
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.ellipse(-r*0.8, 0 + t, r*0.6, r*0.35, 0.4, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
  }

  function drawHUD() {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(14, 12, 100, 40);
    ctx.fillStyle = '#e5e7eb';
    ctx.font = 'bold 28px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText(String(score), 24, 40);
  }

  function loop(ts) {
    const dt = Math.min(0.033, (ts - last) / 1000 || 0);
    last = ts;

    // update
    update(dt);

    // draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    drawEntities();
    drawTurtle();
    drawHUD();

    requestAnimationFrame(loop);
  }

  // Initial UI
  renderLB(getName());
  resetToMenu();
  requestAnimationFrame(loop);
})();
