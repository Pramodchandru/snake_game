const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;   // 800
const H = canvas.height;  // 560
const WORLD = 2000;       // the island is 2000 x 2000 pixels
const DAY_LEN = 90;       // seconds per day (60 day + 30 night)
const DAYS_TO_WIN = 5;
const NAME = "Pramod";

// Darkness layer (second canvas)
const dark = document.createElement("canvas");
dark.width = W;
dark.height = H;
const dctx = dark.getContext("2d");

// ---------- State ----------
let state = "menu"; // menu | playing | paused | won | lost
let player, trees, rocks, bushes, lakes, rabbits, zombies, fires;
let elapsed, msg, msgTimer, cause, kills, swing, spawnTimer, lastTime = 0;
const keys = {};
let best = getBest();
const cam = { x: 0, y: 0 };
const touchJoy = { active: false, dx: 0, dy: 0, sprint: false };
let sprintHeld = false;

function getBest() {
  try { return Number(localStorage.getItem("pramodBest")) || 0; } catch (e) { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem("pramodBest", v); } catch (e) {}
}
function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function say(t, s) { msg = t; msgTimer = s || 2.5; }

// ---------- Day / night ----------
function dayTime() { return elapsed % DAY_LEN; }
function dayNumber() { return Math.floor(elapsed / DAY_LEN) + 1; }
function darkAmount() {
  const t = dayTime();
  if (t < 50) return 0;
  if (t < 60) return ((t - 50) / 10) * 0.88;
  if (t < 80) return 0.88;
  return 0.88 * ((90 - t) / 10);
}

// ---------- World generation ----------
function allObjects() { return [].concat(lakes, trees, rocks, bushes); }

function place(list, count, rFn, factory) {
  let tries = 0;
  while (list.length < count && tries < 6000) {
    tries++;
    const r = rFn();
    const x = rand(60, WORLD - 60), y = rand(60, WORLD - 60);
    if (Math.hypot(x - WORLD / 2, y - WORLD / 2) < 140) continue; // keep the start clear
    if (allObjects().some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 12)) continue;
    list.push(Object.assign({ x, y, r }, factory()));
  }
}

function resetGame() {
  lakes = []; trees = []; rocks = []; bushes = []; rabbits = []; zombies = []; fires = [];
  place(lakes, 4, () => rand(70, 115), () => ({ cd: 0 }));
  place(trees, 110, () => 14, () => ({ hits: 4, regrow: 0 }));
  place(rocks, 45, () => 16, () => ({ hits: 4, regrow: 0 }));
  place(bushes, 35, () => 12, () => ({ berries: true, regrow: 0 }));
  for (let i = 0; i < 22; i++) spawnRabbit();

  player = {
    x: WORLD / 2, y: WORLD / 2, r: 10, dx: 0, dy: 1,
    health: 100, hunger: 100, thirst: 100, stamina: 100, tired: false,
    wood: 0, stone: 0, berries: 0, raw: 0, cooked: 0, spear: false,
    attackCd: 0, hurt: 0, drinkCd: 0
  };
  elapsed = 0; kills = 0; swing = 0; spawnTimer = 3; cause = "";
  say("Hello " + NAME + "! Gather wood and stone, find water, survive " + DAYS_TO_WIN + " days.", 5);
}

function spawnRabbit() {
  for (let i = 0; i < 50; i++) {
    const x = rand(60, WORLD - 60), y = rand(60, WORLD - 60);
    if (allObjects().some((o) => Math.hypot(o.x - x, o.y - y) < o.r + 14)) continue;
    rabbits.push({ x, y, r: 8, vx: 0, vy: 0, t: 0, hp: 1 });
    return;
  }
}

function startGame() {
  resetGame();
  state = "playing";
}

// ---------- Collision ----------
function pushOut(e) {
  const obstacles = [].concat(
    lakes,
    trees.filter((t) => t.hits > 0),
    rocks.filter((r) => r.hits > 0)
  );
  obstacles.forEach((o) => {
    const dx = e.x - o.x, dy = e.y - o.y;
    const d = Math.hypot(dx, dy) || 0.001;
    const min = e.r + o.r;
    if (d < min) {
      e.x = o.x + (dx / d) * min;
      e.y = o.y + (dy / d) * min;
    }
  });
  e.x = clamp(e.x, e.r, WORLD - e.r);
  e.y = clamp(e.y, e.r, WORLD - e.r);
}

// ---------- Actions ----------
function interact() {
  const p = player;
  let best = null, bestD = 28;
  const consider = (type, o, d) => { if (d < bestD) { bestD = d; best = { type, o }; } };

  lakes.forEach((o) => consider("lake", o, dist(p, o) - o.r));
  trees.forEach((o) => { if (o.hits > 0) consider("tree", o, dist(p, o) - o.r); });
  rocks.forEach((o) => { if (o.hits > 0) consider("rock", o, dist(p, o) - o.r); });
  bushes.forEach((o) => { if (o.berries) consider("bush", o, dist(p, o) - o.r); });
  fires.forEach((o) => consider("fire", o, dist(p, o) - 10));

  if (!best) { say("Nothing to use here."); return; }
  const o = best.o;

  if (best.type === "lake") {
    p.thirst = Math.min(100, p.thirst + 35);
    say("Drank some water.", 1.2);
  } else if (best.type === "tree") {
    o.hits--; p.wood++;
    if (o.hits <= 0) { o.regrow = 70; say("Tree chopped. +1 wood", 1.2); }
  } else if (best.type === "rock") {
    o.hits--; p.stone++;
    if (o.hits <= 0) { o.regrow = 100; say("Rock mined out. +1 stone", 1.2); }
  } else if (best.type === "bush") {
    o.berries = false; o.regrow = 40;
    p.berries += 2;
    say("Picked 2 berries.", 1.2);
  } else if (best.type === "fire") {
    if (p.raw > 0) { p.raw--; p.cooked++; say("Cooked meat!", 1.2); }
    else if (p.wood > 0 && o.life < 150) { p.wood--; o.life = Math.min(180, o.life + 40); say("Added wood to the fire.", 1.2); }
    else say("Bring raw meat to cook, or wood to feed the fire.");
  }
}

function eat() {
  const p = player;
  if (p.cooked > 0) { p.cooked--; p.hunger = Math.min(100, p.hunger + 45); p.health = Math.min(100, p.health + 8); say("Ate cooked meat. Tasty!"); }
  else if (p.raw > 0) { p.raw--; p.hunger = Math.min(100, p.hunger + 15); p.health = Math.max(1, p.health - 5); say("Raw meat... you feel a bit sick."); }
  else if (p.berries > 0) { p.berries--; p.hunger = Math.min(100, p.hunger + 12); say("Ate a berry."); }
  else say("You have no food.");
}

function craft(n) {
  const p = player;
  if (n === 1) {
    if (p.spear) return say("You already have a spear.");
    if (p.wood >= 3 && p.stone >= 2) { p.wood -= 3; p.stone -= 2; p.spear = true; say("Crafted a spear! Attacks do double damage."); }
    else say("Spear needs 3 wood and 2 stone.");
  }
  if (n === 2) {
    if (fires.length >= 4) return say("Too many fires already.");
    if (p.wood >= 5) {
      p.wood -= 5;
      fires.push({ x: p.x + p.dx * 36, y: p.y + p.dy * 36, life: 150 });
      say("Campfire built. Zombies avoid its light.");
    } else say("Campfire needs 5 wood.");
  }
}

function attack() {
  const p = player;
  if (p.attackCd > 0 || state !== "playing") return;
  p.attackCd = 0.4;
  swing = 0.15;
  const dmg = p.spear ? 2 : 1;
  const targets = zombies.concat(rabbits);
  let target = null, td = 50;
  targets.forEach((t) => {
    const d = dist(p, t) - t.r;
    const dot = ((t.x - p.x) * p.dx + (t.y - p.y) * p.dy) / (dist(p, t) || 1);
    if (d < td && dot > -0.2) { td = d; target = t; }
  });
  if (!target) return;
  target.hp -= dmg;
  target.flash = 0.15;
  const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy) || 1;
  target.x += (dx / d) * 18; target.y += (dy / d) * 18;
  if (target.hp <= 0) {
    if (zombies.includes(target)) { kills++; say("Zombie down!", 1.2); }
    else { p.raw++; say("Caught a rabbit. +1 raw meat", 1.5); target.respawn = true; }
  }
}

// ---------- Update ----------
function update(dt) {
  const p = player;
  elapsed += dt;
  msgTimer = Math.max(0, msgTimer - dt);
  swing = Math.max(0, swing - dt);
  p.attackCd -= dt; p.hurt = Math.max(0, p.hurt - dt);

  // Movement
  let dx = 0, dy = 0;
  if (keys["arrowleft"] || keys["a"]) dx -= 1;
  if (keys["arrowright"] || keys["d"]) dx += 1;
  if (keys["arrowup"] || keys["w"]) dy -= 1;
  if (keys["arrowdown"] || keys["s"]) dy += 1;
  if (touchJoy.active) {
    dx += touchJoy.dx;
    dy += touchJoy.dy;
  }
  const moving = dx || dy;
  let sprint = false;
  if (moving) {
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    p.dx = dx; p.dy = dy;
    sprint = (!!keys["shift"] || sprintHeld || touchJoy.sprint) && p.stamina > 0 && !p.tired;
  }
  if (sprint) {
    p.stamina = Math.max(0, p.stamina - 30 * dt);
    if (p.stamina === 0) p.tired = true;
  } else {
    p.stamina = Math.min(100, p.stamina + 18 * dt);
    if (p.tired && p.stamina > 25) p.tired = false;
  }
  const speed = sprint ? 170 : 115;
  p.x += dx * speed * dt;
  p.y += dy * speed * dt;
  pushOut(p);

  // Survival stats
  p.hunger = Math.max(0, p.hunger - 0.5 * dt);
  p.thirst = Math.max(0, p.thirst - 0.7 * dt);
  if (p.hunger === 0 || p.thirst === 0) {
    p.health -= 2 * dt;
    cause = p.thirst === 0 ? "died of thirst" : "starved";
    if (Math.floor(elapsed) % 6 === 0 && msgTimer <= 0) say(p.thirst === 0 ? "You are dehydrated! Find water!" : "You are starving! Find food!", 2);
  } else if (p.hunger > 50 && p.thirst > 50) {
    p.health = Math.min(100, p.health + 1 * dt);
  }

  // Regrowth
  trees.forEach((t) => { if (t.hits <= 0) { t.regrow -= dt; if (t.regrow <= 0) t.hits = 4; } });
  rocks.forEach((r) => { if (r.hits <= 0) { r.regrow -= dt; if (r.regrow <= 0) r.hits = 4; } });
  bushes.forEach((b) => { if (!b.berries) { b.regrow -= dt; if (b.regrow <= 0) b.berries = true; } });

  // Fires burn down
  fires.forEach((f) => { f.life -= dt; });
  fires = fires.filter((f) => f.life > 0);

  updateRabbits(dt);
  updateZombies(dt);

  if (p.health <= 0) { if (!cause) cause = "was killed"; state = "lost"; return; }
  if (elapsed >= DAYS_TO_WIN * DAY_LEN) { state = "won"; if (!best || elapsed < best) { best = elapsed; saveBest(best); } }

  cam.x = clamp(p.x - W / 2, 0, WORLD - W);
  cam.y = clamp(p.y - H / 2, 0, WORLD - H);
}

function updateRabbits(dt) {
  const p = player;
  for (let i = rabbits.length - 1; i >= 0; i--) {
    const r = rabbits[i];
    if (r.respawn) { rabbits.splice(i, 1); spawnRabbit(); continue; }
    r.flash = Math.max(0, (r.flash || 0) - dt);
    r.t -= dt;
    const d = dist(p, r);
    if (d < 120) {
      r.vx = ((r.x - p.x) / d) * 110;
      r.vy = ((r.y - p.y) / d) * 110;
    } else if (r.t <= 0) {
      const a = rand(0, Math.PI * 2), s = Math.random() < 0.4 ? 0 : 40;
      r.vx = Math.cos(a) * s; r.vy = Math.sin(a) * s;
      r.t = rand(1, 3);
    }
    r.x += r.vx * dt; r.y += r.vy * dt;
    pushOut(r);
  }
}

function updateZombies(dt) {
  const p = player;
  const dark = darkAmount();
  const day = dayNumber();

  // Spawn at night, just outside the screen
  if (dark > 0.4) {
    spawnTimer -= dt;
    if (spawnTimer <= 0 && zombies.length < 1 + day * 2) {
      const a = rand(0, Math.PI * 2);
      zombies.push({
        x: clamp(p.x + Math.cos(a) * 520, 20, WORLD - 20),
        y: clamp(p.y + Math.sin(a) * 520, 20, WORLD - 20),
        r: 11, hp: 3, cd: 0, flash: 0
      });
      spawnTimer = rand(2, 4);
    }
  }

  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];
    z.cd -= dt; z.flash = Math.max(0, z.flash - dt);
    if (z.hp <= 0) { zombies.splice(i, 1); continue; }
    if (dark < 0.2) { z.hp -= 0.7 * dt; if (z.hp <= 0) { zombies.splice(i, 1); continue; } } // sunlight burns them

    const d = dist(p, z) || 1;
    const speed = 62 + day * 5;
    z.x += ((p.x - z.x) / d) * speed * dt;
    z.y += ((p.y - z.y) / d) * speed * dt;

    // Campfire light keeps them away
    fires.forEach((f) => {
      const fd = dist(f, z) || 1;
      if (fd < 85) {
        z.x += ((z.x - f.x) / fd) * 140 * dt;
        z.y += ((z.y - f.y) / fd) * 140 * dt;
      }
    });
    pushOut(z);

    if (d < z.r + p.r + 4 && z.cd <= 0) {
      const safe = fires.some((f) => dist(f, p) < 70);
      if (!safe) {
        p.health -= 8;
        p.hurt = 0.3;
        cause = "was killed by zombies";
      }
      z.cd = 1;
    }
  }
}

// ---------- Drawing ----------
function drawGround() {
  ctx.fillStyle = "#3d6b3a";
  ctx.fillRect(cam.x, cam.y, W, H);
  const size = 80;
  ctx.fillStyle = "#386436";
  const sx = Math.floor(cam.x / size) * size, sy = Math.floor(cam.y / size) * size;
  for (let x = sx; x < cam.x + W + size; x += size) {
    for (let y = sy; y < cam.y + H + size; y += size) {
      if (((x / size) + (y / size)) % 2 === 0) ctx.fillRect(x, y, size, size);
    }
  }
  // island edge
  ctx.strokeStyle = "#1e3a8a";
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, WORLD, WORLD);
}

function onScreen(o, pad) {
  return o.x > cam.x - pad && o.x < cam.x + W + pad && o.y > cam.y - pad && o.y < cam.y + H + pad;
}

function drawWorld() {
  lakes.forEach((l) => {
    if (!onScreen(l, l.r)) return;
    ctx.fillStyle = "#1d4ed8";
    ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath(); ctx.arc(l.x - l.r * 0.2, l.y - l.r * 0.2, l.r * 0.6, 0, Math.PI * 2); ctx.fill();
  });
  rocks.forEach((r) => {
    if (!onScreen(r, 30)) return;
    ctx.fillStyle = r.hits > 0 ? "#78716c" : "#44403c";
    ctx.beginPath(); ctx.arc(r.x, r.y, r.hits > 0 ? r.r : 6, 0, Math.PI * 2); ctx.fill();
  });
  bushes.forEach((b) => {
    if (!onScreen(b, 30)) return;
    ctx.fillStyle = "#166534";
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    if (b.berries) {
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(b.x - 6, b.y - 3, 4, 4);
      ctx.fillRect(b.x + 2, b.y + 1, 4, 4);
      ctx.fillRect(b.x - 1, b.y - 7, 4, 4);
    }
  });
  fires.forEach((f) => {
    if (!onScreen(f, 60)) return;
    ctx.fillStyle = "#57534e";
    ctx.beginPath(); ctx.arc(f.x, f.y, 10, 0, Math.PI * 2); ctx.fill();
    const flick = 6 + Math.random() * 4;
    const scale = Math.min(1, f.life / 30);
    ctx.fillStyle = "#f97316";
    ctx.beginPath(); ctx.arc(f.x, f.y - 3, flick * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fde047";
    ctx.beginPath(); ctx.arc(f.x, f.y - 3, flick * 0.5 * scale, 0, Math.PI * 2); ctx.fill();
  });
  rabbits.forEach((r) => {
    if (!onScreen(r, 20)) return;
    ctx.fillStyle = r.flash > 0 ? "#ef4444" : "#f5f5f4";
    ctx.beginPath(); ctx.ellipse(r.x, r.y, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(r.x + (r.vx < 0 ? -9 : 5), r.y - 10, 3, 7);
  });
  zombies.forEach((z) => {
    if (!onScreen(z, 20)) return;
    ctx.fillStyle = z.flash > 0 ? "#ffffff" : "#4d7c0f";
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(z.x - 5, z.y - 3, 3, 3);
    ctx.fillRect(z.x + 2, z.y - 3, 3, 3);
  });
  // trees are drawn last so they sit on top
  trees.forEach((t) => {
    if (!onScreen(t, 40)) return;
    if (t.hits <= 0) {
      ctx.fillStyle = "#78350f";
      ctx.beginPath(); ctx.arc(t.x, t.y, 6, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.fillStyle = "#78350f";
    ctx.fillRect(t.x - 4, t.y - 2, 8, 16);
    ctx.fillStyle = "#15803d";
    ctx.beginPath(); ctx.arc(t.x, t.y - 8, 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#16a34a";
    ctx.beginPath(); ctx.arc(t.x - 5, t.y - 12, 10, 0, Math.PI * 2); ctx.fill();
  });
}

function drawPlayer() {
  const p = player;
  ctx.fillStyle = p.hurt > 0 ? "#fca5a5" : "#38bdf8";
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#082f49";
  ctx.beginPath(); ctx.arc(p.x + p.dx * 5, p.y + p.dy * 5, 3, 0, Math.PI * 2); ctx.fill();
  if (p.spear) {
    ctx.strokeStyle = "#d6d3d1"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x + p.dx * 8, p.y + p.dy * 8);
    ctx.lineTo(p.x + p.dx * 30, p.y + p.dy * 30);
    ctx.stroke();
  }
  if (swing > 0) {
    ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 3;
    const a = Math.atan2(p.dy, p.dx);
    ctx.beginPath(); ctx.arc(p.x, p.y, 30, a - 0.8, a + 0.8); ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "center";
  ctx.fillText(NAME, p.x, p.y - 18);
}

function drawNight() {
  const amt = darkAmount();
  if (amt <= 0.01) return;
  dctx.globalCompositeOperation = "source-over";
  dctx.clearRect(0, 0, W, H);
  dctx.fillStyle = "rgba(4, 6, 24, " + amt + ")";
  dctx.fillRect(0, 0, W, H);
  dctx.globalCompositeOperation = "destination-out";
  const hole = (x, y, radius) => {
    const g = dctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    dctx.fillStyle = g;
    dctx.beginPath(); dctx.arc(x, y, radius, 0, Math.PI * 2); dctx.fill();
  };
  hole(player.x - cam.x, player.y - cam.y, 150);
  fires.forEach((f) => hole(f.x - cam.x, f.y - cam.y, f.life < 30 ? 90 + f.life * 3 : 190));
  dctx.globalCompositeOperation = "source-over";
  ctx.drawImage(dark, 0, 0);
}

function bar(x, y, w, v, color, label) {
  ctx.fillStyle = "#111827";
  ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(v / 100, 0, 1), 10);
  ctx.fillStyle = "#f9fafb";
  ctx.font = "11px Arial";
  ctx.textAlign = "left";
  ctx.fillText(label, x + w + 6, y + 9);
}

function clock() {
  const t = dayTime();
  const hours = (6 + (t / DAY_LEN) * 24) % 24; // day starts at 6:00
  const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
}

function drawHUD() {
  const p = player;
  bar(10, 10, 110, p.health, "#ef4444", "Health");
  bar(10, 26, 110, p.hunger, "#f59e0b", "Hunger");
  bar(10, 42, 110, p.thirst, "#3b82f6", "Thirst");
  bar(10, 58, 110, p.stamina, p.tired ? "#9ca3af" : "#22c55e", "Stamina");

  ctx.textAlign = "right";
  ctx.font = "bold 15px Arial";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("Day " + Math.min(dayNumber(), DAYS_TO_WIN) + " / " + DAYS_TO_WIN + "   " + clock(), W - 10, 22);
  ctx.font = "13px Arial";
  ctx.fillStyle = darkAmount() > 0.4 ? "#fca5a5" : "#bbf7d0";
  ctx.fillText(darkAmount() > 0.4 ? "Night: zombies are out" : "Daytime: gather supplies", W - 10, 40);

  // Inventory
  ctx.textAlign = "left";
  ctx.font = "13px Arial";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(8, H - 62, 520, 54);
  ctx.fillStyle = "#f9fafb";
  ctx.fillText("Wood " + p.wood + "   Stone " + p.stone + "   Berries " + p.berries +
    "   Raw meat " + p.raw + "   Cooked " + p.cooked + (p.spear ? "   [Spear]" : ""), 16, H - 42);
  ctx.fillStyle = p.wood >= 3 && p.stone >= 2 && !p.spear ? "#86efac" : "#9ca3af";
  ctx.fillText("[1] Spear: 3 wood + 2 stone", 16, H - 22);
  ctx.fillStyle = p.wood >= 5 ? "#86efac" : "#9ca3af";
  ctx.fillText("[2] Campfire: 5 wood", 200, H - 22);
  ctx.fillStyle = "#9ca3af";
  ctx.fillText("[F] Eat   [E] Use   [Space] Attack", 350, H - 22);

  if (msgTimer > 0) {
    ctx.textAlign = "center";
    ctx.font = "bold 15px Arial";
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(W / 2 - 280, 76, 560, 28);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(msg, W / 2, 95);
  }
  if (p.hurt > 0) {
    ctx.fillStyle = "rgba(220,38,38," + p.hurt + ")";
    ctx.fillRect(0, 0, W, H);
  }
}

function formatTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function overlay(title, lines) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "bold 38px Arial";
  ctx.fillText(title, W / 2, 110);
  ctx.font = "16px Arial";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 160 + i * 25));
}

function draw() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(-cam.x, -cam.y);
  drawGround();
  drawWorld();
  drawPlayer();
  ctx.restore();
  drawNight();
  drawHUD();

  if (state === "menu") {
    overlay(NAME + ": Island Survival", [
      "You are stranded on an island. Rescue arrives in " + DAYS_TO_WIN + " days.",
      "",
      "Move: WASD / Arrows / Touch Joystick",
      "Use / gather / drink: E or [Use]     Attack: Space / Click or [Attack]",
      "Eat: F or [Eat]     Craft: [Spear] / [Fire]     Pause: P",
      "",
      "Chop trees, mine rocks, pick berries, drink from lakes.",
      "Hunt rabbits and cook the meat on a campfire.",
      "At night zombies attack. Stay near a fire to keep them away.",
      "",
      "Tap Screen or Press Enter to Start"
    ]);
  } else if (state === "paused") {
    overlay("Paused", ["Press P or Tap Pause to resume"]);
  } else if (state === "won") {
    overlay("Rescued!", [
      NAME + " survived " + DAYS_TO_WIN + " days.",
      "Zombies defeated: " + kills,
      "",
      "Tap Screen or Press Enter to play again"
    ]);
  } else if (state === "lost") {
    overlay(NAME + " didn't make it", [
      NAME + " " + cause + " on day " + dayNumber() + ".",
      "Survived " + formatTime(elapsed) + "   Zombies defeated: " + kills,
      "",
      "Tap Screen or Press Enter to try again"
    ]);
  }
}

// ---------- Main loop ----------
function loop(t) {
  const dt = Math.min((t - lastTime) / 1000, 0.05);
  lastTime = t;
  if (state === "playing") update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ---------- Input ----------
document.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) e.preventDefault();
  if (key === "enter" && (state === "menu" || state === "won" || state === "lost")) { startGame(); return; }
  if (key === "p" || key === "escape") {
    if (state === "playing") state = "paused";
    else if (state === "paused") state = "playing";
    return;
  }
  const fresh = !keys[key];
  keys[key] = true;
  if (state !== "playing" || !fresh) return;
  if (key === "e") interact();
  if (key === "f") eat();
  if (key === "1") craft(1);
  if (key === "2") craft(2);
});
document.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener("pointerdown", (e) => {
  if (state === "menu" || state === "won" || state === "lost") {
    startGame();
  } else if (state === "playing") {
    // Only attack if not clicking on UI controls
    attack();
  }
});

// Holding Space attacks repeatedly (cooldown limits the speed)
setInterval(() => { if (keys[" "] && state === "playing") attack(); }, 50);

// ---------- Mobile Touch & Virtual Joystick Setup ----------
function initTouchControls() {
  const touchControls = document.getElementById("touch-controls");
  const toggleTouchBtn = document.getElementById("btn-toggle-touch");
  const pauseHeaderBtn = document.getElementById("btn-pause-header");
  const fullscreenBtn = document.getElementById("btn-fullscreen");
  const joystickZone = document.getElementById("joystick-zone");
  const joystickBase = document.getElementById("joystick-base");
  const joystickKnob = document.getElementById("joystick-knob");
  const sprintBtn = document.getElementById("btn-sprint");

  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth <= 1024);
  if (touchControls && isTouchDevice) {
    touchControls.classList.add("visible");
  }

  if (toggleTouchBtn && touchControls) {
    toggleTouchBtn.addEventListener("click", () => {
      touchControls.classList.toggle("visible");
    });
  }

  if (pauseHeaderBtn) {
    pauseHeaderBtn.addEventListener("click", () => {
      if (state === "playing") state = "paused";
      else if (state === "paused") state = "playing";
    });
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  // Virtual Joystick
  let joyId = null;
  let baseCenter = { x: 0, y: 0 };
  const maxRadius = 38;

  function resetJoy() {
    joyId = null;
    touchJoy.active = false;
    touchJoy.dx = 0;
    touchJoy.dy = 0;
    touchJoy.sprint = false;
    if (joystickKnob) {
      joystickKnob.style.transform = "translate(0px, 0px)";
    }
  }

  if (joystickZone && joystickBase && joystickKnob) {
    const onJoyStart = (e) => {
      e.preventDefault();
      if (joyId !== null) return;
      const t = e.changedTouches ? e.changedTouches[0] : e;
      joyId = t.identifier !== undefined ? t.identifier : 'mouse';
      const rect = joystickBase.getBoundingClientRect();
      baseCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      onJoyMove(e);
    };

    const onJoyMove = (e) => {
      if (joyId === null) return;
      e.preventDefault();
      let t = null;
      if (e.changedTouches) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === joyId) {
            t = e.changedTouches[i];
            break;
          }
        }
      } else {
        t = e;
      }
      if (!t) return;

      const diffX = t.clientX - baseCenter.x;
      const diffY = t.clientY - baseCenter.y;
      const dist = Math.hypot(diffX, diffY);
      const angle = Math.atan2(diffY, diffX);
      const clamped = Math.min(dist, maxRadius);

      const kx = Math.cos(angle) * clamped;
      const ky = Math.sin(angle) * clamped;
      joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;

      if (dist > 6) {
        touchJoy.active = true;
        touchJoy.dx = diffX / dist;
        touchJoy.dy = diffY / dist;
        touchJoy.sprint = (dist >= maxRadius - 4);
      } else {
        touchJoy.active = false;
        touchJoy.dx = 0;
        touchJoy.dy = 0;
        touchJoy.sprint = false;
      }
    };

    const onJoyEnd = (e) => {
      if (joyId === null) return;
      if (e.changedTouches) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === joyId) {
            resetJoy();
            break;
          }
        }
      } else {
        resetJoy();
      }
    };

    joystickZone.addEventListener("touchstart", onJoyStart, { passive: false });
    window.addEventListener("touchmove", onJoyMove, { passive: false });
    window.addEventListener("touchend", onJoyEnd, { passive: false });
    window.addEventListener("touchcancel", onJoyEnd, { passive: false });

    // Desktop mouse testing
    joystickZone.addEventListener("mousedown", onJoyStart);
    window.addEventListener("mousemove", (e) => { if (joyId === 'mouse') onJoyMove(e); });
    window.addEventListener("mouseup", (e) => { if (joyId === 'mouse') resetJoy(); });
  }

  // Sprint Button
  if (sprintBtn) {
    const setSprint = (val) => {
      sprintHeld = val;
      sprintBtn.classList.toggle("active", val);
    };
    sprintBtn.addEventListener("touchstart", (e) => { e.preventDefault(); setSprint(!sprintHeld); }, { passive: false });
    sprintBtn.addEventListener("click", () => { setSprint(!sprintHeld); });
  }

  // Action Buttons
  function bindTouchBtn(id, fn, canRepeat) {
    const btn = document.getElementById(id);
    if (!btn) return;
    let repeatTimer = null;

    const trigger = (e) => {
      e.preventDefault();
      if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) {}
      if (state === "menu" || state === "won" || state === "lost") {
        startGame();
        return;
      }
      fn();
    };

    btn.addEventListener("touchstart", (e) => {
      trigger(e);
      if (canRepeat) {
        repeatTimer = setInterval(() => {
          if (state === "playing") fn();
        }, 80);
      }
    }, { passive: false });

    btn.addEventListener("touchend", (e) => {
      e.preventDefault();
      if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
    }, { passive: false });

    btn.addEventListener("touchcancel", () => {
      if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
    });

    btn.addEventListener("click", (e) => {
      trigger(e);
    });
  }

  bindTouchBtn("btn-attack", attack, true);
  bindTouchBtn("btn-use", interact, false);
  bindTouchBtn("btn-eat", eat, false);
  bindTouchBtn("btn-craft-spear", () => craft(1), false);
  bindTouchBtn("btn-craft-fire", () => craft(2), false);
}

initTouchControls();

resetGame();
requestAnimationFrame(loop);