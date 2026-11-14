(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const coinStat = document.getElementById("coinStat");
  const lifeStat = document.getElementById("lifeStat");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const overlayBtn = document.getElementById("overlayBtn");

  const W = canvas.width;
  const H = canvas.height;
  const TILE = 40;
  const GRAVITY = 2200;
  const MOVE_ACCEL = 3200;
  const MAX_RUN = 290;
  const JUMP_V = -720;
  const FRICTION = 0.82;
  const COYOTE_MS = 90;
  const JUMP_BUFFER_MS = 100;

  const keys = Object.create(null);
  const touch = { left: false, right: false, jump: false };

  let state = "title"; // title | play | win | lose
  let lastTime = 0;
  let cameraX = 0;
  let shake = 0;
  let particles = [];
  let animT = 0;

  const level = buildLevel();
  const player = makePlayer();
  let coins = [];
  let enemies = [];
  let lives = 3;
  let coinCount = 0;
  let spawnSafeUntil = 0;

  resetWorld(false);
  showOverlay(
    "Skybound Scout",
    "Dash across floating cliffs, grab coins, stomp Bramble Bugs, and light the summit beacon.",
    "Play"
  );

  function buildLevel() {
    // Character map: # solid, = platform, C coin, E enemy, S start, G goal, . empty
    const rows = [
      "................................................................................",
      "................................................................................",
      "........................C.......................................................",
      "......................====......................................................",
      "..............C......................C..........................................",
      "............====...................====................C........................",
      ".............................................====...............................",
      ".....C..............E......................................E....................",
      "...====...........====................C..................====...................",
      "....................................====........................................",
      "................C..................................C.................C..........",
      "..............====..............E................====..............====.........",
      "S...............................................................G...............",
      "################################################################################",
      "################################################################################",
    ];

    const solids = [];
    const platforms = [];
    const coinSpawns = [];
    const enemySpawns = [];
    let start = { x: TILE, y: H - TILE * 3 };
    let goal = { x: (rows[0].length - 4) * TILE, y: H - TILE * 4, w: TILE, h: TILE * 2 };

    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        const x = c * TILE;
        const y = r * TILE;
        if (ch === "#") solids.push({ x, y, w: TILE, h: TILE, ground: true });
        else if (ch === "=") platforms.push({ x, y, w: TILE, h: 16 });
        else if (ch === "C") coinSpawns.push({ x: x + 10, y: y + 8 });
        else if (ch === "E") enemySpawns.push({ x, y: y + 8 });
        else if (ch === "S") start = { x, y: y - 8 };
        else if (ch === "G") goal = { x: x + 8, y: y - TILE, w: 24, h: TILE * 2 };
      }
    }

    // Merge contiguous ground tiles into wider colliders for nicer edges
    const mergedGround = mergeRects(solids);
    const mergedPlatforms = mergeRects(platforms);

    return {
      width: rows[0].length * TILE,
      height: rows.length * TILE,
      solids: [...mergedGround, ...mergedPlatforms],
      coinSpawns,
      enemySpawns,
      start,
      goal,
      hills: [
        { x: 80, y: H - 40, r: 90, color: "#8fbf6a" },
        { x: 220, y: H - 30, r: 70, color: "#7aaa58" },
        { x: 520, y: H - 45, r: 110, color: "#8fbf6a" },
        { x: 900, y: H - 35, r: 85, color: "#7aaa58" },
        { x: 1400, y: H - 50, r: 120, color: "#8fbf6a" },
        { x: 1900, y: H - 28, r: 75, color: "#7aaa58" },
        { x: 2500, y: H - 42, r: 100, color: "#8fbf6a" },
        { x: 2900, y: H - 36, r: 80, color: "#7aaa58" },
      ],
    };
  }

  function mergeRects(rects) {
    if (!rects.length) return [];
    const byY = new Map();
    for (const r of rects) {
      const key = `${r.y}|${r.h}|${!!r.ground}`;
      if (!byY.has(key)) byY.set(key, []);
      byY.get(key).push(r);
    }
    const out = [];
    for (const group of byY.values()) {
      group.sort((a, b) => a.x - b.x);
      let cur = { ...group[0] };
      for (let i = 1; i < group.length; i++) {
        const n = group[i];
        if (n.x <= cur.x + cur.w + 0.5) {
          cur.w = Math.max(cur.w, n.x + n.w - cur.x);
        } else {
          out.push(cur);
          cur = { ...n };
        }
      }
      out.push(cur);
    }
    return out;
  }

  function makePlayer() {
    return {
      x: 0,
      y: 0,
      w: 28,
      h: 36,
      vx: 0,
      vy: 0,
      facing: 1,
      onGround: false,
      coyote: 0,
      jumpBuf: 0,
      invuln: 0,
      squash: 1,
      dead: false,
    };
  }

  function resetWorld(keepLives) {
    if (!keepLives) {
      lives = 3;
      coinCount = 0;
    }
    coins = level.coinSpawns.map((c) => ({
      x: c.x,
      y: c.y,
      r: 10,
      taken: false,
      bob: Math.random() * Math.PI * 2,
    }));
    enemies = level.enemySpawns.map((e) => ({
      x: e.x,
      y: e.y,
      w: 30,
      h: 26,
      vx: Math.random() > 0.5 ? 70 : -70,
      alive: true,
      squash: 1,
    }));
    Object.assign(player, {
      x: level.start.x,
      y: level.start.y,
      vx: 0,
      vy: 0,
      facing: 1,
      onGround: false,
      coyote: 0,
      jumpBuf: 0,
      invuln: 900,
      squash: 1,
      dead: false,
    });
    spawnSafeUntil = performance.now() + 900;
    cameraX = 0;
    particles = [];
    updateHud();
  }

  function updateHud() {
    coinStat.textContent = `Coins ${coinCount}`;
    lifeStat.textContent = `Lives ${lives}`;
  }

  function showOverlay(title, text, btn) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayBtn.textContent = btn;
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function startGame() {
    resetWorld(false);
    state = "play";
    hideOverlay();
    lastTime = performance.now();
  }

  overlayBtn.addEventListener("click", () => {
    if (state === "title" || state === "win" || state === "lose") startGame();
  });

  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === "KeyR") {
      startGame();
    }
    if ((e.code === "Enter" || e.code === "Space") && state !== "play") {
      startGame();
    }
    if ((e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp") && state === "play") {
      player.jumpBuf = JUMP_BUFFER_MS;
    }
  });

  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  function bindTouch(btn, on, off) {
    const start = (ev) => {
      ev.preventDefault();
      on();
    };
    const end = (ev) => {
      ev.preventDefault();
      off();
    };
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointerleave", end);
    btn.addEventListener("pointercancel", end);
  }

  document.querySelectorAll(".touch-btn").forEach((btn) => {
    const dir = btn.dataset.dir;
    const action = btn.dataset.action;
    if (dir === "left") {
      bindTouch(btn, () => (touch.left = true), () => (touch.left = false));
    } else if (dir === "right") {
      bindTouch(btn, () => (touch.right = true), () => (touch.right = false));
    } else if (action === "jump") {
      bindTouch(
        btn,
        () => {
          touch.jump = true;
          if (state === "play") player.jumpBuf = JUMP_BUFFER_MS;
          else startGame();
        },
        () => (touch.jump = false)
      );
    }
  });

  function wantLeft() {
    return keys.ArrowLeft || keys.KeyA || touch.left;
  }
  function wantRight() {
    return keys.ArrowRight || keys.KeyD || touch.right;
  }
  function wantJumpHeld() {
    return keys.Space || keys.KeyW || keys.ArrowUp || touch.jump;
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function resolveSolid(entity, solid, wasOnGround) {
    const prevBottom = entity.y + entity.h - entity.vy * (1 / 60);
    const overlapX = Math.min(entity.x + entity.w, solid.x + solid.w) - Math.max(entity.x, solid.x);
    const overlapY = Math.min(entity.y + entity.h, solid.y + solid.h) - Math.max(entity.y, solid.y);
    if (overlapX <= 0 || overlapY <= 0) return wasOnGround;

    // One-way platforms: only land from above
    const oneWay = !solid.ground && solid.h <= 20;
    if (oneWay) {
      if (entity.vy >= 0 && prevBottom <= solid.y + 6) {
        entity.y = solid.y - entity.h;
        entity.vy = 0;
        return true;
      }
      return wasOnGround;
    }

    if (overlapY < overlapX) {
      if (entity.y + entity.h / 2 < solid.y + solid.h / 2) {
        entity.y = solid.y - entity.h;
        entity.vy = 0;
        return true;
      }
      entity.y = solid.y + solid.h;
      entity.vy = Math.max(entity.vy, 0);
    } else {
      if (entity.x + entity.w / 2 < solid.x + solid.w / 2) {
        entity.x = solid.x - entity.w;
      } else {
        entity.x = solid.x + solid.w;
      }
      entity.vx = 0;
    }
    return wasOnGround;
  }

  function spawnBurst(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 160;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 40,
        life: 0.35 + Math.random() * 0.35,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function update(dt) {
    animT += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 8);

    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * dt;
    }
    particles = particles.filter((p) => p.life > 0);

    if (state !== "play" || player.dead) return;

    const now = performance.now();
    player.invuln = Math.max(0, player.invuln - dt * 1000);
    player.coyote = Math.max(0, player.coyote - dt * 1000);
    player.jumpBuf = Math.max(0, player.jumpBuf - dt * 1000);
    player.squash += (1 - player.squash) * Math.min(1, dt * 12);

    let ax = 0;
    if (wantLeft()) ax -= 1;
    if (wantRight()) ax += 1;
    if (ax !== 0) {
      player.vx += ax * MOVE_ACCEL * dt;
      player.facing = ax;
    } else {
      player.vx *= Math.pow(FRICTION, dt * 60);
      if (Math.abs(player.vx) < 8) player.vx = 0;
    }
    player.vx = Math.max(-MAX_RUN, Math.min(MAX_RUN, player.vx));

    player.vy += GRAVITY * dt;
    if (!wantJumpHeld() && player.vy < -180) {
      player.vy *= 0.55;
    }

    if (player.jumpBuf > 0 && (player.onGround || player.coyote > 0)) {
      player.vy = JUMP_V;
      player.onGround = false;
      player.coyote = 0;
      player.jumpBuf = 0;
      player.squash = 0.72;
      spawnBurst(player.x + player.w / 2, player.y + player.h, "#ffffff", 5);
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    let grounded = false;
    for (const solid of level.solids) {
      if (!aabb(player, solid)) continue;
      grounded = resolveSolid(player, solid, grounded) || grounded;
    }
    if (grounded && !player.onGround) {
      player.squash = 1.18;
    }
    player.onGround = grounded;
    if (grounded) player.coyote = COYOTE_MS;

    // World bounds
    if (player.x < 0) {
      player.x = 0;
      player.vx = 0;
    }
    if (player.x + player.w > level.width) {
      player.x = level.width - player.w;
      player.vx = 0;
    }
    if (player.y > level.height + 80) {
      hurtPlayer(true);
      return;
    }

    // Coins
    for (const coin of coins) {
      if (coin.taken) continue;
      coin.bob += dt * 4;
      const cx = coin.x + coin.r;
      const cy = coin.y + coin.r + Math.sin(coin.bob) * 4;
      const dx = player.x + player.w / 2 - cx;
      const dy = player.y + player.h / 2 - cy;
      if (dx * dx + dy * dy < (coin.r + 14) * (coin.r + 14)) {
        coin.taken = true;
        coinCount += 1;
        updateHud();
        spawnBurst(cx, cy, "#f4c430", 12);
      }
    }

    // Enemies
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      enemy.squash += (1 - enemy.squash) * Math.min(1, dt * 10);
      enemy.x += enemy.vx * dt;

      // Turn at edges / walls
      const feet = {
        x: enemy.vx > 0 ? enemy.x + enemy.w + 2 : enemy.x - 6,
        y: enemy.y + enemy.h + 2,
        w: 4,
        h: 8,
      };
      const footSupport = level.solids.some((s) => aabb(feet, s));
      const headProbe = {
        x: enemy.vx > 0 ? enemy.x + enemy.w : enemy.x - 4,
        y: enemy.y + 4,
        w: 4,
        h: enemy.h - 8,
      };
      const wallHit = level.solids.some((s) => s.ground && aabb(headProbe, s));
      if (!footSupport || wallHit) enemy.vx *= -1;

      // Gravity stick to ground lightly
      enemy.y += 400 * dt;
      for (const solid of level.solids) {
        if (!aabb(enemy, solid)) continue;
        if (enemy.y + enemy.h > solid.y && enemy.y < solid.y) {
          enemy.y = solid.y - enemy.h;
        }
      }

      if (!aabb(player, enemy)) continue;
      const stomping = player.vy > 40 && player.y + player.h - enemy.y < 18;
      if (stomping) {
        enemy.alive = false;
        enemy.squash = 0.3;
        player.vy = JUMP_V * 0.55;
        player.squash = 0.75;
        spawnBurst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, "#5a8f3d", 14);
        shake = 0.25;
      } else if (now > spawnSafeUntil && player.invuln <= 0) {
        hurtPlayer(false);
        return;
      }
    }

    // Goal
    if (aabb(player, level.goal)) {
      state = "win";
      spawnBurst(level.goal.x + 12, level.goal.y + 20, "#ffd56a", 24);
      showOverlay(
        "Beacon lit!",
        `You collected ${coinCount} coin${coinCount === 1 ? "" : "s"} and reached the summit.`,
        "Play again"
      );
    }

    // Camera
    const target = player.x + player.w / 2 - W * 0.38;
    cameraX += (target - cameraX) * Math.min(1, dt * 6);
    cameraX = Math.max(0, Math.min(level.width - W, cameraX));
  }

  function hurtPlayer(fell) {
    lives -= 1;
    updateHud();
    shake = 0.45;
    spawnBurst(player.x + player.w / 2, player.y + player.h / 2, "#e07a3a", 16);
    if (lives <= 0) {
      state = "lose";
      player.dead = true;
      showOverlay("Scout down", "The cliffs win this round. Try again!", "Retry");
      return;
    }
    resetWorld(true);
    if (fell) {
      // already reset to start
    }
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#6eb9df");
    g.addColorStop(0.55, "#c8ebff");
    g.addColorStop(1, "#e8f6c8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Soft sun
    const sx = W * 0.78 - cameraX * 0.02;
    const sy = 70;
    const sun = ctx.createRadialGradient(sx, sy, 10, sx, sy, 70);
    sun.addColorStop(0, "rgba(255, 236, 170, 0.95)");
    sun.addColorStop(1, "rgba(255, 236, 170, 0)");
    ctx.fillStyle = sun;
    ctx.fillRect(sx - 80, sy - 80, 160, 160);

    // Clouds (parallax)
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    const clouds = [
      { x: 40, y: 60, s: 1 },
      { x: 320, y: 90, s: 0.8 },
      { x: 700, y: 50, s: 1.1 },
      { x: 1100, y: 80, s: 0.9 },
      { x: 1600, y: 55, s: 1 },
      { x: 2100, y: 95, s: 0.85 },
      { x: 2600, y: 60, s: 1.05 },
    ];
    for (const c of clouds) {
      const x = c.x - cameraX * 0.25;
      drawCloud(x, c.y, c.s);
    }

    // Distant hills
    for (const h of level.hills) {
      const x = h.x - cameraX * 0.45;
      ctx.fillStyle = h.color;
      ctx.beginPath();
      ctx.ellipse(x, h.y, h.r, h.r * 0.55, 0, Math.PI, 0);
      ctx.fill();
    }
  }

  function drawCloud(x, y, s) {
    ctx.beginPath();
    ctx.ellipse(x, y, 28 * s, 16 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 22 * s, y + 2, 22 * s, 14 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 20 * s, y + 4, 18 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWorld() {
    ctx.save();
    const ox = shake ? (Math.random() - 0.5) * 8 * shake : 0;
    const oy = shake ? (Math.random() - 0.5) * 8 * shake : 0;
    ctx.translate(-cameraX + ox, oy);

    // Platforms / ground
    for (const s of level.solids) {
      if (s.ground) {
        ctx.fillStyle = "#5c4030";
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = "#6f9f4c";
        ctx.fillRect(s.x, s.y, s.w, 12);
        ctx.fillStyle = "#86b85a";
        ctx.fillRect(s.x, s.y, s.w, 5);
        // dirt flecks
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        for (let i = 0; i < s.w; i += 28) {
          ctx.fillRect(s.x + i + 8, s.y + 22, 6, 4);
        }
      } else {
        // floating ledge
        const grad = ctx.createLinearGradient(s.x, s.y, s.x, s.y + s.h);
        grad.addColorStop(0, "#c9894a");
        grad.addColorStop(1, "#9a6434");
        ctx.fillStyle = grad;
        roundRect(s.x, s.y, s.w, s.h, 4);
        ctx.fill();
        ctx.fillStyle = "#d9a25c";
        ctx.fillRect(s.x + 2, s.y + 2, s.w - 4, 4);
      }
    }

    // Goal beacon
    const g = level.goal;
    ctx.fillStyle = "#3d4f5c";
    ctx.fillRect(g.x + 8, g.y + 10, 8, g.h - 10);
    ctx.fillStyle = "#e07a3a";
    ctx.beginPath();
    ctx.moveTo(g.x + 16, g.y + 12);
    ctx.lineTo(g.x + 42, g.y + 24);
    ctx.lineTo(g.x + 16, g.y + 36);
    ctx.closePath();
    ctx.fill();
    // glow
    const pulse = 0.45 + Math.sin(animT * 4) * 0.15;
    ctx.fillStyle = `rgba(255, 200, 90, ${pulse})`;
    ctx.beginPath();
    ctx.arc(g.x + 12, g.y + 8, 14, 0, Math.PI * 2);
    ctx.fill();

    // Coins
    for (const coin of coins) {
      if (coin.taken) continue;
      const cy = coin.y + Math.sin(coin.bob) * 4;
      const squashX = 0.7 + Math.abs(Math.sin(coin.bob * 1.4)) * 0.3;
      ctx.save();
      ctx.translate(coin.x + coin.r, cy + coin.r);
      ctx.scale(squashX, 1);
      ctx.fillStyle = "#f0c23a";
      ctx.beginPath();
      ctx.arc(0, 0, coin.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffe58a";
      ctx.beginPath();
      ctx.arc(-2, -2, coin.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#c48a12";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, coin.r - 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Enemies — Bramble Bugs
    for (const enemy of enemies) {
      if (!enemy.alive) {
        // flattened residue briefly not needed
        continue;
      }
      drawBug(enemy);
    }

    drawScout(player);

    // Particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawScout(p) {
    const blink = p.invuln > 0 && Math.floor(animT * 20) % 2 === 0;
    if (blink) return;

    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const run = Math.abs(p.vx) > 20 && p.onGround;
    const leg = run ? Math.sin(animT * 18) * 5 : 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(p.facing, 1);
    ctx.scale(1 / p.squash, p.squash);

    // Cap / body
    ctx.fillStyle = "#2a9d8f";
    roundRect(-12, -16, 24, 22, 6);
    ctx.fill();

    // Scarf
    ctx.fillStyle = "#e07a3a";
    ctx.fillRect(-12, -2, 24, 5);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(18 + Math.sin(animT * 8) * 2, 6);
    ctx.lineTo(10, 8);
    ctx.fill();

    // Head
    ctx.fillStyle = "#f0c9a0";
    ctx.beginPath();
    ctx.arc(0, -20, 11, 0, Math.PI * 2);
    ctx.fill();

    // Cap brim
    ctx.fillStyle = "#238277";
    ctx.beginPath();
    ctx.ellipse(2, -26, 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a9d8f";
    ctx.beginPath();
    ctx.arc(0, -28, 8, Math.PI, 0);
    ctx.fill();

    // Eye
    ctx.fillStyle = "#1a2a36";
    ctx.beginPath();
    ctx.arc(4, -20, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.strokeStyle = "#1f6f66";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-5, 6);
    ctx.lineTo(-5 - leg, 16);
    ctx.moveTo(5, 6);
    ctx.lineTo(5 + leg, 16);
    ctx.stroke();

    ctx.restore();
  }

  function drawBug(e) {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const dir = e.vx >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(dir, 1);
    ctx.scale(1, e.squash);

    // Body
    ctx.fillStyle = "#4d7a32";
    ctx.beginPath();
    ctx.ellipse(0, 2, 14, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6b9a45";
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Spikes
    ctx.fillStyle = "#3a5c24";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 7 - 3, -6);
      ctx.lineTo(i * 7, -14);
      ctx.lineTo(i * 7 + 3, -6);
      ctx.fill();
    }

    // Eyes
    ctx.fillStyle = "#fff6d8";
    ctx.beginPath();
    ctx.arc(6, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a2a36";
    ctx.beginPath();
    ctx.arc(7, 0, 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.strokeStyle = "#2f4a1c";
    ctx.lineWidth = 2;
    const swing = Math.sin(animT * 10 + e.x * 0.05) * 3;
    ctx.beginPath();
    ctx.moveTo(-8, 8);
    ctx.lineTo(-12, 12 + swing);
    ctx.moveTo(0, 9);
    ctx.lineTo(0, 13 - swing);
    ctx.moveTo(8, 8);
    ctx.lineTo(12, 12 + swing);
    ctx.stroke();

    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    update(dt);
    drawSky();
    drawWorld();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
