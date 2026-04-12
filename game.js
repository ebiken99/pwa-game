'use strict';

// ============================================================
// Canvas & Context
// ============================================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ============================================================
// Constants
// ============================================================
const STATE = {
  START:    'start',
  PLAYING:  'playing',
  LEVELUP:  'levelup',
  GAMEOVER: 'gameover',
  WIN:      'win',
};

const LEVEL_DURATION = 20; // seconds per level

/**
 * speed        : poop fall speed (px/s)
 * spawnInterval: ms between spawns
 * count        : how many poops can spawn simultaneously in a wave
 */
const LEVEL_CONFIG = [
  { speed: 260, spawnInterval: 2400, label: 'レベル 1', emoji: '🌱' },
  { speed: 420, spawnInterval: 1900, label: 'レベル 2', emoji: '🌿' },
  { speed: 600, spawnInterval: 1500, label: 'レベル 3', emoji: '🍀' },
  { speed: 800, spawnInterval: 1150, label: 'レベル 4', emoji: '🔥' },
  { speed: 1020, spawnInterval:  850, label: 'レベル 5', emoji: '💀' },
];

const PLAYER_EMOJI    = '🏃';
const POOP_EMOJI      = '💩';
const PLAYER_SIZE     = 54;   // font-size used for drawing
const POOP_SIZE       = 42;
const PLAYER_SPEED    = 330;  // px/s
const GROUND_H        = 28;   // grass height
const GOLDEN_SIZE     = POOP_SIZE * 3;   // 3x normal poop (126px)
const GOLDEN_INTERVAL = 2500;            // ms between golden poop spawns

// ============================================================
// Game State
// ============================================================
let state         = STATE.START;
let currentLevel  = 1;
let score         = 0;
let levelTimer    = 0;   // seconds elapsed in current level
let lastTs        = 0;
let lastSpawnTs   = 0;
let poops         = [];
let animId           = null;
let gameOverFlash    = 0;   // countdown for red flash on game over
let lastGoldenSpawnTs = 0;

// ============================================================
// Player
// ============================================================
const player = {
  x:     0,
  y:     0,
  hitW:  36,
  hitH:  54,
  facing: 1,   // 1 = right, -1 = left (mirror emoji)
};

// ============================================================
// Clouds (decorative)
// ============================================================
let clouds = [];

function initClouds() {
  clouds = [];
  const count = Math.max(4, Math.floor(canvas.width / 200));
  for (let i = 0; i < count; i++) {
    clouds.push(makCloud(Math.random() * canvas.width));
  }
}

function makCloud(x) {
  return {
    x,
    y:     20 + Math.random() * canvas.height * 0.28,
    w:     70 + Math.random() * 110,
    speed: 12 + Math.random() * 18,
  };
}

// ============================================================
// Input
// ============================================================
const keys = { left: false, right: false };

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') keys.left  = true;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
  if (e.key === ' ' || e.key === 'Enter') triggerStart();
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') keys.left  = false;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
});

// ── Touch zone: bottom half of screen ──────────────────
// Left side  → move left
// Right side → move right
function updateKeysFromTouches(touches) {
  if (state !== STATE.PLAYING) return;
  keys.left  = false;
  keys.right = false;
  for (const t of touches) {
    if (t.clientY > window.innerHeight / 2) {
      if (t.clientX < window.innerWidth / 2) keys.left  = true;
      else                                    keys.right = true;
    }
  }
}

const gameContainer = document.getElementById('game-container');
gameContainer.addEventListener('touchstart',  (e) => { e.preventDefault(); updateKeysFromTouches(e.touches); }, { passive: false });
gameContainer.addEventListener('touchmove',   (e) => { e.preventDefault(); updateKeysFromTouches(e.touches); }, { passive: false });
gameContainer.addEventListener('touchend',    (e) => { e.preventDefault(); updateKeysFromTouches(e.touches); }, { passive: false });
gameContainer.addEventListener('touchcancel', (e) => { e.preventDefault(); updateKeysFromTouches(e.touches); }, { passive: false });

// Mouse fallback for desktop
gameContainer.addEventListener('mousedown', (e) => {
  if (state !== STATE.PLAYING) return;
  if (e.clientY > window.innerHeight / 2) {
    keys.left  = e.clientX < window.innerWidth / 2;
    keys.right = e.clientX >= window.innerWidth / 2;
  }
});
gameContainer.addEventListener('mouseup', () => { keys.left = false; keys.right = false; });

// ============================================================
// Canvas resize
// ============================================================
function resizeCanvas() {
  // Use the container's actual rendered size (reliable on both iOS & Android).
  // The container is position:fixed;inset:0 so it always matches the visual viewport.
  const container = canvas.parentElement;
  canvas.width  = container.offsetWidth  || window.innerWidth;
  canvas.height = container.offsetHeight || window.innerHeight;
  player.x = canvas.width  / 2;
  player.y = canvas.height - GROUND_H - 4;
  initClouds();
}

window.addEventListener('resize', resizeCanvas);

// ============================================================
// HUD
// ============================================================
const elLevel = document.getElementById('level-display');
const elScore = document.getElementById('score-display');

function updateHUD() {
  elLevel.textContent = LEVEL_CONFIG[currentLevel - 1].label;
  elScore.textContent = `よけた: ${score} 個`;
}

// ============================================================
// Overlay
// ============================================================
const overlay       = document.getElementById('overlay');
const overlayEmoji  = document.getElementById('overlay-emoji');
const overlayTitle  = document.getElementById('overlay-title');
const overlayMsg    = document.getElementById('overlay-message');
const overlayBtn    = document.getElementById('overlay-btn');

function showOverlay(emoji, title, msg, btn) {
  overlayEmoji.textContent = emoji;
  overlayTitle.textContent = title;
  overlayMsg.innerHTML     = msg;
  overlayBtn.textContent   = btn;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

function triggerStart() {
  if (state === STATE.START || state === STATE.GAMEOVER || state === STATE.WIN) {
    initGame();
    state = STATE.PLAYING;
    hideOverlay();
    const now = performance.now();
    lastTs            = now;
    lastSpawnTs       = now;
    lastGoldenSpawnTs = now;
  } else if (state === STATE.LEVELUP) {
    state = STATE.PLAYING;
    hideOverlay();
    const now = performance.now();
    lastTs            = now;
    lastSpawnTs       = now;
    lastGoldenSpawnTs = now;
  }
}

overlayBtn.addEventListener('click', triggerStart);

// ============================================================
// Game init
// ============================================================
function initGame() {
  currentLevel      = 1;
  score             = 0;
  levelTimer        = 0;
  poops             = [];
  gameOverFlash     = 0;
  lastGoldenSpawnTs = 0;
  player.x          = canvas.width  / 2;
  player.y          = canvas.height - GROUND_H - 4;
  updateHUD();
}

// ============================================================
// Spawn poop
// ============================================================
function spawnPoop(now, golden = false) {
  const size   = golden ? GOLDEN_SIZE : POOP_SIZE;
  const margin = size * 0.6;
  const x      = margin + Math.random() * (canvas.width - margin * 2);
  const cfg    = LEVEL_CONFIG[currentLevel - 1];
  poops.push({ x, y: -size, speed: cfg.speed, size, golden });
  if (golden) lastGoldenSpawnTs = now;
  else        lastSpawnTs       = now;
}

// ============================================================
// Collision detection
// ============================================================
function hitTest(poop) {
  const halfPoop = poop.size * 0.42;
  return (
    player.x - player.hitW / 2 < poop.x + halfPoop &&
    player.x + player.hitW / 2 > poop.x - halfPoop &&
    player.y - player.hitH     < poop.y + halfPoop &&
    player.y                   > poop.y - halfPoop
  );
}

// ============================================================
// Update
// ============================================================
function update(now) {
  if (state !== STATE.PLAYING) return;

  const dt = Math.min((now - lastTs) / 1000, 0.1);
  lastTs = now;

  // --- Player movement ---
  if (keys.left) {
    player.x = Math.max(player.hitW / 2 + 8, player.x - PLAYER_SPEED * dt);
    player.facing = -1;
  }
  if (keys.right) {
    player.x = Math.min(canvas.width - player.hitW / 2 - 8, player.x + PLAYER_SPEED * dt);
    player.facing = 1;
  }

  // --- Level timer ---
  levelTimer += dt;

  // --- Spawn: normal poop ---
  const cfg = LEVEL_CONFIG[currentLevel - 1];
  if (now - lastSpawnTs >= cfg.spawnInterval) {
    spawnPoop(now);
  }

  // --- Spawn: golden poop (level 5, last 5 seconds) ---
  if (currentLevel === 5 && levelTimer >= LEVEL_DURATION - 5) {
    if (now - lastGoldenSpawnTs >= GOLDEN_INTERVAL) {
      spawnPoop(now, true);
    }
  }

  // --- Clouds ---
  for (const c of clouds) {
    c.x += c.speed * dt;
    if (c.x > canvas.width + c.w) {
      c.x = -c.w;
      c.y = 20 + Math.random() * canvas.height * 0.28;
    }
  }

  // --- Poops ---
  for (let i = poops.length - 1; i >= 0; i--) {
    const p = poops[i];
    p.y += p.speed * dt;

    if (hitTest(p)) {
      // Game Over
      state = STATE.GAMEOVER;
      gameOverFlash = 0.6;
      triggerShake();
      showOverlay(
        '💩',
        'ゲームオーバー',
        `うんこにぶつかった！<br>よけた数: <strong>${score} 個</strong><br>到達レベル: <strong>${currentLevel}</strong>`,
        'もう一度'
      );
      return;
    }

    if (p.y > canvas.height + POOP_SIZE) {
      poops.splice(i, 1);
      score++;
      updateHUD();
    }
  }

  // --- Level up check ---
  if (levelTimer >= LEVEL_DURATION) {
    if (currentLevel >= LEVEL_CONFIG.length) {
      state = STATE.WIN;
      showOverlay(
        '🎉',
        'ゲームクリア！',
        `全レベル制覇！おめでとう！<br>よけた数: <strong>${score} 個</strong>`,
        'もう一度'
      );
    } else {
      currentLevel++;
      levelTimer = 0;
      poops = [];
      state = STATE.LEVELUP;
      updateHUD();
      const nextCfg = LEVEL_CONFIG[currentLevel - 1];
      showOverlay(
        nextCfg.emoji,
        `${nextCfg.label} スタート！`,
        `うんこが速くなった！<br>気をつけろ！`,
        '続ける'
      );
    }
  }
}

// ============================================================
// Screen shake helper
// ============================================================
function triggerShake() {
  const container = document.getElementById('game-container');
  container.classList.remove('shake');
  void container.offsetWidth; // reflow to restart animation
  container.classList.add('shake');
  setTimeout(() => container.classList.remove('shake'), 500);
}

// ============================================================
// Draw helpers
// ============================================================
function drawCloud(c) {
  const h = c.w * 0.38;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.beginPath();
  ctx.ellipse(c.x,          c.y,          c.w * 0.50, h * 0.55, 0, 0, Math.PI * 2);
  ctx.ellipse(c.x + c.w*0.22, c.y - h*0.28, c.w * 0.30, h * 0.45, 0, 0, Math.PI * 2);
  ctx.ellipse(c.x - c.w*0.22, c.y - h*0.18, c.w * 0.26, h * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBackground() {
  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.82);
  sky.addColorStop(0,   '#5BB8E8');
  sky.addColorStop(0.5, '#87CEEB');
  sky.addColorStop(1,   '#C5E8F4');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Clouds
  for (const c of clouds) drawCloud(c);

  // Grass
  ctx.fillStyle = '#5AB85C';
  ctx.fillRect(0, canvas.height - GROUND_H, canvas.width, GROUND_H);
  // Darker earth stripe
  ctx.fillStyle = '#7D5124';
  ctx.fillRect(0, canvas.height - 10, canvas.width, 10);
  // Grass highlight tips
  ctx.fillStyle = '#6ECE6E';
  ctx.fillRect(0, canvas.height - GROUND_H, canvas.width, 5);
}

function drawPlayer() {
  ctx.save();
  ctx.font = `${PLAYER_SIZE}px serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  if (player.facing === 1) {
    // 🏃 is left-facing by default → flip horizontally to face right
    ctx.translate(player.x, player.y);
    ctx.scale(-1, 1);
    ctx.fillText(PLAYER_EMOJI, 0, 0);
  } else {
    ctx.fillText(PLAYER_EMOJI, player.x, player.y);
  }
  ctx.restore();
}

function drawPoops() {
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  for (const p of poops) {
    ctx.save();
    if (p.golden) {
      // Pulsing gold glow background
      const pulse = 0.5 + 0.5 * Math.sin(levelTimer * 8);
      ctx.fillStyle = `rgba(255, 215, 0, ${0.25 + pulse * 0.2})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.52, 0, Math.PI * 2);
      ctx.fill();
      // Gold ring
      ctx.strokeStyle = `rgba(255, 200, 0, ${0.6 + pulse * 0.4})`;
      ctx.lineWidth   = 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      // Glow on the emoji itself
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur  = 28;
    }
    ctx.font = `${p.size}px serif`;
    ctx.fillText(POOP_EMOJI, p.x, p.y);
    ctx.restore();
  }
}

function drawLevelProgress() {
  if (state !== STATE.PLAYING) return;

  const barX = 12;
  const barY = canvas.height - 44;
  const barW = canvas.width - 24;
  const barH = 9;

  // Track
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, 5);
  ctx.fill();

  // Fill
  const pct = Math.min(levelTimer / LEVEL_DURATION, 1);
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  grad.addColorStop(0,   '#FFD700');
  grad.addColorStop(0.6, '#FFA500');
  grad.addColorStop(1,   '#FF6347');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW * pct, barH, 5);
  ctx.fill();

  // Time remaining label
  const remaining = Math.max(0, Math.ceil(LEVEL_DURATION - levelTimer));
  ctx.fillStyle    = 'rgba(255,255,255,0.9)';
  ctx.font         = 'bold 13px Arial, sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`残り ${remaining}秒`, canvas.width - 12, barY - 9);
}

function drawTouchHint() {
  if (state !== STATE.PLAYING) return;
  const midX  = canvas.width  / 2;
  const zoneY = canvas.height / 2;
  const zoneH = canvas.height - zoneY;
  const centerY = zoneY + zoneH / 2;
  const arrowSize = Math.round(canvas.width * 0.07);

  ctx.save();
  ctx.font         = `bold ${arrowSize}px Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = 'rgba(255, 255, 255, 0.18)';
  ctx.textAlign    = 'left';
  ctx.fillText('◀', 18, centerY);
  ctx.textAlign    = 'right';
  ctx.fillText('▶', canvas.width - 18, centerY);
  // subtle divider
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(midX, zoneY);
  ctx.lineTo(midX, canvas.height - GROUND_H);
  ctx.stroke();
  ctx.restore();
}

function drawGameOverFlash() {
  if (gameOverFlash <= 0) return;
  ctx.fillStyle = `rgba(220, 30, 30, ${gameOverFlash * 0.5})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  gameOverFlash -= 0.04;
}

function drawGoldenWarning() {
  if (state !== STATE.PLAYING) return;
  if (currentLevel !== 5 || levelTimer < LEVEL_DURATION - 5) return;

  // Subtle gold tint over the whole screen
  const pulse = 0.5 + 0.5 * Math.sin(levelTimer * 6);
  ctx.fillStyle = `rgba(255, 200, 0, ${0.06 + pulse * 0.06})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Warning banner
  const bannerY = canvas.height * 0.18;
  ctx.save();
  ctx.font         = `bold ${Math.round(canvas.width * 0.048)}px Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = `rgba(255, 210, 0, ${0.8 + pulse * 0.2})`;
  ctx.shadowColor  = '#FFD700';
  ctx.shadowBlur   = 16;
  ctx.fillText('👑 ゴールデンうんこ出現！ 👑', canvas.width / 2, bannerY);
  ctx.restore();
}

// ============================================================
// Game Loop
// ============================================================
function gameLoop(now) {
  update(now);

  drawBackground();
  drawTouchHint();
  drawPoops();
  drawGoldenWarning();
  drawPlayer();
  drawLevelProgress();
  drawGameOverFlash();

  animId = requestAnimationFrame(gameLoop);
}

// ============================================================
// Boot
// ============================================================
resizeCanvas();

showOverlay(
  '💩',
  'うんこよけゲーム',
  '上から落ちてくるうんこをよけろ！<br>← → キー または 画面ボタンで操作<br>全5レベル・クリアを目指せ！',
  'スタート'
);

animId = requestAnimationFrame((now) => {
  lastTs      = now;
  lastSpawnTs = now;
  gameLoop(now);
});

// ============================================================
// PWA: Service Worker registration
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
