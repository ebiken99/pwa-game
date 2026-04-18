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

const LEVEL_DURATION = 10; // seconds per level

/**
 * speed        : poop fall speed (px/s)
 * spawnInterval: ms between spawns
 * count        : how many poops can spawn simultaneously in a wave
 */
const LEVEL_CONFIG = [
  { speed: 260,  spawnInterval: 2400, label: 'レベル 1',     emoji: '🌱' },
  { speed: 420,  spawnInterval: 1900, label: 'レベル 2',     emoji: '🌿' },
  { speed: 600,  spawnInterval: 1500, label: 'レベル 3',     emoji: '🍀' },
  { speed: 800,  spawnInterval: 1150, label: 'レベル 4',     emoji: '🔥' },
  { speed: 1020, spawnInterval:  850, label: 'レベル 5',     emoji: '💀' },
  { speed: 1200, spawnInterval:  700, label: '👑 FINAL',     emoji: '👑' },
];
const FINAL_LEVEL = LEVEL_CONFIG.length; // 6

const PLAYER_SPEED    = 330;  // px/s
const GROUND_H        = 28;   // grass height
const POOP_EMOJI      = '💩';
const POOP_SIZE       = 42;
const GOLDEN_SIZE     = POOP_SIZE * 3;   // 3x normal poop (126px)
const GOLDEN_INTERVAL = 2500;            // ms between golden poop spawns
const STILL_THRESHOLD = 12;              // px: movement smaller than this = "still"
const STILL_DELAY_MS  = 2000;            // ms of stillness before aimed poop fires
const AIMED_INTERVAL_MS = 2500;          // ms between successive aimed poops

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
let animId            = null;
let gameOverFlash     = 0;
let lastGoldenSpawnTs = 0;
let cheatFlash        = 0;
let playerStillX      = null;
let playerStillMs     = 0;
let lastAimedTs       = 0;
let playerAnimTime    = 0;    // advances while moving, drives run animation

// ── Cheat code: 5 taps in top-right corner within 5s ──
let cheatTapCount = 0;
let cheatFirstTs  = 0;
const CHEAT_TAPS    = 5;
const CHEAT_WINDOW  = 5000; // ms

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

// ── Cheat: 5 taps top-right corner within 5s → FINAL STAGE ──
function checkCheatTap(clientX, clientY) {
  const inCorner = clientX > window.innerWidth * 0.75 && clientY < window.innerHeight * 0.18;
  if (!inCorner) return;
  const now = Date.now();
  if (cheatTapCount === 0 || now - cheatFirstTs > CHEAT_WINDOW) {
    cheatTapCount = 1;
    cheatFirstTs  = now;
  } else {
    cheatTapCount++;
    if (cheatTapCount >= CHEAT_TAPS) {
      cheatTapCount = 0;
      activateCheat();
    }
  }
}

function activateCheat() {
  initGame();
  currentLevel = FINAL_LEVEL;
  updateHUD();
  state      = STATE.PLAYING;
  cheatFlash = 1.0;
  hideOverlay();
  const now = performance.now();
  lastTs            = now;
  lastSpawnTs       = now;
  lastGoldenSpawnTs = now;
}

const gameContainer = document.getElementById('game-container');
gameContainer.addEventListener('touchstart', (e) => {
  // Cheat check runs regardless of state
  for (const t of e.changedTouches) checkCheatTap(t.clientX, t.clientY);
  if (state !== STATE.PLAYING) return;
  e.preventDefault();
  updateKeysFromTouches(e.touches);
}, { passive: false });
gameContainer.addEventListener('touchmove',   (e) => { if (state !== STATE.PLAYING) return; e.preventDefault(); updateKeysFromTouches(e.touches); }, { passive: false });
gameContainer.addEventListener('touchend',    (e) => { if (state !== STATE.PLAYING) return; e.preventDefault(); updateKeysFromTouches(e.touches); }, { passive: false });
gameContainer.addEventListener('touchcancel', (e) => { if (state !== STATE.PLAYING) return; e.preventDefault(); updateKeysFromTouches(e.touches); }, { passive: false });

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
    playerStillX      = null;
    playerStillMs     = 0;
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
  playerStillX      = null;
  playerStillMs     = 0;
  lastAimedTs       = 0;
  playerAnimTime    = 0;
  player.x          = canvas.width  / 2;
  player.y          = canvas.height - GROUND_H - 4;
  updateHUD();
}

// ============================================================
// Spawn poop
// ============================================================
function spawnPoop(now, golden = false) {
  const isGolden = golden || currentLevel === FINAL_LEVEL; // level 6: all golden
  const size     = isGolden ? GOLDEN_SIZE : POOP_SIZE;
  const margin   = size * 0.6;
  const x        = margin + Math.random() * (canvas.width - margin * 2);
  const cfg      = LEVEL_CONFIG[currentLevel - 1];
  poops.push({ x, y: -size, speed: cfg.speed, size, golden: isGolden });
  if (golden) lastGoldenSpawnTs = now;
  else        lastSpawnTs       = now;
}

function spawnAimedPoop(now) {
  const isGolden = currentLevel === FINAL_LEVEL;
  const size     = isGolden ? GOLDEN_SIZE : POOP_SIZE;
  const cfg      = LEVEL_CONFIG[currentLevel - 1];
  poops.push({ x: player.x, y: -size, speed: cfg.speed * 0.5, size, golden: isGolden, aimed: true });
  lastAimedTs = now;
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
  if (keys.left || keys.right) {
    playerAnimTime += dt * 8; // running cycle speed
  }

  // --- Level timer ---
  levelTimer += dt;

  // --- Aimed poop: level 5+ fires at player when they stay still ---
  if (currentLevel >= 5) {
    if (playerStillX === null) {
      playerStillX  = player.x;
      playerStillMs = 0;
    } else if (Math.abs(player.x - playerStillX) > STILL_THRESHOLD) {
      // player moved – reset
      playerStillX  = player.x;
      playerStillMs = 0;
    } else {
      playerStillMs += dt * 1000;
      if (playerStillMs >= STILL_DELAY_MS && now - lastAimedTs >= AIMED_INTERVAL_MS) {
        spawnAimedPoop(now);
      }
    }
  }

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
    if (currentLevel >= FINAL_LEVEL) {
      state = STATE.WIN;
      showOverlay(
        '🏆',
        '真のクリア！',
        `ゴールデンうんこを全て回避！<br>伝説の勇者よ！<br>よけた数: <strong>${score} 個</strong>`,
        'もう一度'
      );
    } else {
      currentLevel++;
      levelTimer = 0;
      poops = [];
      state = STATE.LEVELUP;
      updateHUD();
      const nextCfg = LEVEL_CONFIG[currentLevel - 1];
      const isFinal = currentLevel === FINAL_LEVEL;
      showOverlay(
        nextCfg.emoji,
        isFinal ? '👑 FINAL STAGE 👑' : `${nextCfg.label} スタート！`,
        isFinal ? '全てのうんこがゴールデン！<br>最後の試練を乗り越えろ！' : 'うんこが速くなった！<br>気をつけろ！',
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
  ctx.translate(player.x, player.y);
  if (player.facing === 1) ctx.scale(-1, 1); // face right

  const c   = Math.sin(playerAnimTime);   // -1…1 run cycle
  const bob = Math.abs(c) * 2;            // slight vertical bounce
  ctx.translate(0, -bob);

  const leg = c * 20;   // leg swing px
  const arm = -c * 15;  // arm swing px (counter-phase)

  const SKIN  = '#FFCC99';
  const HAIR  = '#5D4037';
  const SHIRT = '#1E88E5';
  const PANTS = '#283593';
  const SHOE  = '#1A1A1A';

  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  // ── Back leg ──
  ctx.strokeStyle = PANTS;
  ctx.lineWidth   = 7;
  ctx.beginPath();
  ctx.moveTo( 3, -20);
  ctx.lineTo( 3 + leg * 0.4, -10);
  ctx.lineTo( 3 + leg * 0.7,   0);
  ctx.stroke();

  // ── Front leg ──
  ctx.beginPath();
  ctx.moveTo(-3, -20);
  ctx.lineTo(-3 - leg * 0.4, -10);
  ctx.lineTo(-3 - leg * 0.7,   0);
  ctx.stroke();

  // ── Shoes ──
  ctx.fillStyle = SHOE;
  ctx.beginPath(); ctx.ellipse( 3 + leg * 0.7, 2, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-3 - leg * 0.7, 2, 8, 4, 0, 0, Math.PI * 2); ctx.fill();

  // ── Torso ──
  ctx.fillStyle = SHIRT;
  ctx.beginPath();
  ctx.roundRect(-11, -40, 22, 22, 5);
  ctx.fill();

  // ── Back arm ──
  ctx.strokeStyle = SKIN;
  ctx.lineWidth   = 6;
  ctx.beginPath();
  ctx.moveTo( 9, -36);
  ctx.lineTo( 9 + arm * 0.5, -28);
  ctx.lineTo( 9 + arm,       -22);
  ctx.stroke();

  // ── Front arm ──
  ctx.beginPath();
  ctx.moveTo(-9, -36);
  ctx.lineTo(-9 - arm * 0.5, -28);
  ctx.lineTo(-9 - arm,       -22);
  ctx.stroke();

  // ── Neck ──
  ctx.fillStyle = SKIN;
  ctx.fillRect(-5, -44, 10, 6);

  // ── Head ──
  ctx.beginPath();
  ctx.arc(0, -52, 13, 0, Math.PI * 2);
  ctx.fill();

  // ── Hair ──
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.arc(0, -52, 13, Math.PI * 1.1, Math.PI * 2 - 0.08);
  ctx.lineTo(0, -52);
  ctx.closePath();
  ctx.fill();

  // ── Eyes ──
  ctx.fillStyle = '#1A1A1A';
  ctx.beginPath(); ctx.arc(-5,  -52, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( 5,  -52, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(-4, -53, 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( 6, -53, 0.9, 0, Math.PI * 2); ctx.fill();

  // ── Mouth ──
  ctx.strokeStyle = '#CC4444';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.arc(0, -49, 4, 0.2, Math.PI - 0.2);
  ctx.stroke();

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


function drawGameOverFlash() {
  if (gameOverFlash <= 0) return;
  ctx.fillStyle = `rgba(220, 30, 30, ${gameOverFlash * 0.5})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  gameOverFlash -= 0.04;
}

function drawGoldenWarning() {
  if (state !== STATE.PLAYING) return;
  const isFinal      = currentLevel === FINAL_LEVEL;
  const isLevel5rush = currentLevel === 5 && levelTimer >= LEVEL_DURATION - 5;
  if (!isFinal && !isLevel5rush) return;

  const pulse = 0.5 + 0.5 * Math.sin(levelTimer * 6);
  ctx.fillStyle = `rgba(255, 200, 0, ${isFinal ? 0.08 + pulse * 0.07 : 0.06 + pulse * 0.06})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const bannerY = canvas.height * 0.18;
  ctx.save();
  ctx.font         = `bold ${Math.round(canvas.width * 0.048)}px Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = `rgba(255, 210, 0, ${0.8 + pulse * 0.2})`;
  ctx.shadowColor  = '#FFD700';
  ctx.shadowBlur   = 16;
  ctx.fillText(
    isFinal ? '👑 FINAL STAGE 👑' : '👑 ゴールデンうんこ出現！ 👑',
    canvas.width / 2, bannerY
  );
  ctx.restore();
}

function drawAimedWarning() {
  if (state !== STATE.PLAYING || currentLevel < 5) return;
  if (!playerStillX || playerStillMs < 400) return;

  const progress = Math.min(playerStillMs / STILL_DELAY_MS, 1);
  const groundY  = canvas.height - GROUND_H + 4;
  const rx       = 18 + progress * 22;
  const alpha    = 0.35 + progress * 0.5;

  ctx.save();
  ctx.strokeStyle = `rgba(255, 60, 60, ${alpha})`;
  ctx.lineWidth   = 2.5;
  // Elliptical shadow on ground
  ctx.beginPath();
  ctx.ellipse(playerStillX, groundY, rx, rx * 0.28, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Cross
  ctx.beginPath();
  ctx.moveTo(playerStillX - rx, groundY);
  ctx.lineTo(playerStillX + rx, groundY);
  ctx.moveTo(playerStillX, groundY - rx * 0.28 - 6);
  ctx.lineTo(playerStillX, groundY + rx * 0.28 + 6);
  ctx.stroke();
  ctx.restore();
}

function drawCheatFlash() {
  if (cheatFlash <= 0) return;
  ctx.fillStyle = `rgba(255, 215, 0, ${cheatFlash * 0.6})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.font         = `bold ${Math.round(canvas.width * 0.07)}px Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = `rgba(255, 255, 255, ${cheatFlash})`;
  ctx.shadowColor  = '#FFD700';
  ctx.shadowBlur   = 20;
  ctx.fillText('👑 FINAL STAGE 解放！ 👑', canvas.width / 2, canvas.height / 2);
  ctx.restore();
  cheatFlash -= 0.025;
}

// ============================================================
// Game Loop
// ============================================================
function gameLoop(now) {
  update(now);

  drawBackground();
  drawAimedWarning();
  drawPoops();
  drawGoldenWarning();
  drawPlayer();
  drawLevelProgress();
  drawGameOverFlash();
  drawCheatFlash();

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
