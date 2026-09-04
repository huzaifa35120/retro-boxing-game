'use strict';

/* All drawing happens on a 320x224 buffer that is then blown up with
   nearest-neighbour scaling, so everything here works in whole pixels. */

function px(ctx, x, y, w, h, col) {
  ctx.fillStyle = col;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function text(ctx, s, x, y, col) {
  drawText(ctx, s, x, y, col);
}

function ctext(ctx, s, cx, y, col) {
  text(ctx, s, Math.round(cx - textW(s) / 2), y, col);
}

/* ------------------------------------------------------------------ ring */

/* ---------------------------------------------------------------- the ring

   The ring never moves, so it is drawn once into two offscreen canvases -
   everything behind the boxers, and the near ropes in front of them - and
   each frame is then two drawImage calls instead of several hundred rects. */

const POST_BACK = 30, POST_FRONT = 40;
const ROPE_AT = [0.30, 0.55, 0.80];        // up the post
const FLASHES = [];
for (let i = 0; i < 12; i++) {
  FLASHES.push({ x: (i * 61 + 23) % (VIEW_W - 24) + 12, y: 30 + (i * 7) % 10, t: i * 13 });
}

let ringBack = null, ringFront = null;

function surface() {
  const c = document.createElement('canvas');
  c.width = VIEW_W; c.height = VIEW_H;
  return c;
}

// a chunky pixel line, for ropes running away from you
function line(ctx, x0, y0, x1, y1, col, th) {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    px(ctx, Math.round(x0 + dx * t), Math.round(y0 + dy * t), th || 2, th || 2, col);
  }
}

/* ---- the crowd, in the band left between the meters and the ropes ---- */
function paintCrowd(ctx) {
  const top = 26, bottom = Math.round(FLOOR_TOP) - 2;
  px(ctx, 0, 0, VIEW_W, VIEW_H, '#05070d');
  px(ctx, 0, top - 4, VIEW_W, bottom - top + 6, '#0c1020');

  // the aisle, lit, straight up the middle behind the ring
  px(ctx, CX - 16, top - 4, 32, bottom - top + 4, '#141a2e');
  for (let y = top - 2; y < bottom - 2; y += 4) {
    px(ctx, CX - 14, y, 28, 2, '#1c2440');
    px(ctx, CX - 14, y + 2, 28, 1, '#0e1322');
  }

  // two banks of heads, the near one bigger and darker
  for (let x = -6; x < VIEW_W; x += 7) {
    if (Math.abs(x - CX) < 15) continue;
    const h = 4 + ((x * 7) % 3);
    px(ctx, x, top + 5 - h, 5, h + 2, '#161c30');
    px(ctx, x + 1, top + 2 - h, 3, 3, '#1e2640');
  }
  for (let x = -9; x < VIEW_W; x += 10) {
    if (Math.abs(x - CX) < 17) continue;
    const h = 6 + ((x * 3) % 4);
    px(ctx, x, bottom - 7 - h, 8, h + 6, '#242c4a');
    px(ctx, x + 2, bottom - 11 - h, 5, 5, '#323c62');
    px(ctx, x + 3, bottom - 10 - h, 2, 2, '#465288');
  }

  // EXIT signs, low and out at the edges where the meters do not reach
  for (const ex of [6, VIEW_W - 30]) {
    const ey = bottom - 16;
    px(ctx, ex, ey, 24, 10, '#08150c');
    px(ctx, ex + 1, ey + 1, 22, 8, '#0f3a1c');
    text(ctx, 'EXIT', ex + 2, ey + 2, '#4cd468');
  }

  // the rail in front of them, then the arena floor
  px(ctx, 0, bottom - 1, VIEW_W, 2, '#39415e');
  px(ctx, 0, bottom + 1, VIEW_W, 3, '#080b12');
  px(ctx, 0, bottom + 4, VIEW_W, VIEW_H - bottom - 4, '#0a0d16');
  for (let x = 4; x < VIEW_W; x += 22) px(ctx, x, bottom + 8, 14, 1, '#101828');
  for (let y = bottom + 14; y < VIEW_H; y += 16) px(ctx, 0, y, VIEW_W, 1, '#0d1220');
}

/* ---- the platform and the canvas on top of it ---- */
function paintFloor(ctx) {
  const T = Math.round(FLOOR_TOP), B = Math.round(FLOOR_BOT);
  const halfAt = y => RING_HX * depthScale((y - CY) / PERSP);

  // apron: the thickness of the platform, panelled, and the skirt below
  for (let y = B; y < B + APRON_H; y++) {
    const hw = halfAt(B) + 6;
    const shade = y < B + 2 ? '#5878e8' : (y > B + APRON_H - 4 ? '#0e1a58' : '#1c2f94');
    px(ctx, CX - hw, y, hw * 2, 1, shade);
  }
  const hwB = halfAt(B) + 6;
  for (let x = -hwB + 5; x < hwB - 9; x += 13) {   // stop short of the edge
    px(ctx, CX + x, B + 3, 2, APRON_H - 6, '#16257a');
    px(ctx, CX + x + 6, B + 4, 1, APRON_H - 8, '#2a46b4');
  }
  px(ctx, CX - hwB, B + APRON_H, hwB * 2, 2, '#05070d');

  // canvas, lit from above: a trapezoid, brightest through the middle
  for (let y = T; y < B; y++) {
    const hw = Math.round(halfAt(y));
    const t = (y - T) / (B - T);
    const edge = Math.min(t, 1 - t) * 2;             // 0 at the rails, 1 mid
    let col = '#ded09c';
    if (edge > 0.18) col = '#e8dbb0';
    if (edge > 0.42) col = '#f1e5c2';
    if (edge > 0.66) col = '#f7edcd';
    px(ctx, CX - hw, y, hw * 2, 1, col);
    px(ctx, CX - hw, y, 2, 1, '#c2b088');          // worn edges
    px(ctx, CX + hw - 2, y, 2, 1, '#c2b088');
  }
  // weave
  for (let y = T + 2; y < B - 1; y += 3) {
    const hw = Math.round(halfAt(y)) - 3;
    for (let x = -hw + ((y - T) % 6 === 2 ? 0 : 3); x < hw; x += 6) px(ctx, CX + x, y, 1, 1, '#00000012');
  }
  // border line inside the ropes
  for (const inset of [10, 13]) {
    for (let y = T + inset; y < B - inset; y++) {
      const hw = Math.round(halfAt(y)) - inset;
      if (y === T + inset || y === B - inset - 1) px(ctx, CX - hw, y, hw * 2, 1, '#cbb98e');
      else { px(ctx, CX - hw, y, 1, 1, '#cbb98e'); px(ctx, CX + hw - 1, y, 1, 1, '#cbb98e'); }
    }
  }

  // centre mark
  const cy = (T + B) >> 1;
  px(ctx, CX - 46, cy - 17, 92, 34, '#e6d8ac');
  px(ctx, CX - 44, cy - 15, 88, 30, '#f3e7c6');
  px(ctx, CX - 41, cy - 12, 82, 24, '#e6d8ac');
  px(ctx, CX - 39, cy - 10, 78, 20, '#f3e7c6');
  ctext(ctx, '* RETRO *', CX, cy - 7, '#c2ac7a');
  ctext(ctx, 'BOXING', CX, cy + 2, '#c2ac7a');
}

/* ---- posts, pads and ropes ---- */
function paintPost(ctx, x, yBase, h, pad, padDk, w) {
  px(ctx, x - w - 1, yBase - 2, w * 2 + 3, 4, '#05070d');
  px(ctx, x - w, yBase - h, w * 2, h, padDk);
  px(ctx, x - w, yBase - h, Math.max(2, w - 1), h, pad);
  px(ctx, x + w - 2, yBase - h, 2, h, '#00000055');
  px(ctx, x - w, yBase - h - 3, w * 2, 4, pad);       // capped top
  px(ctx, x - w + 1, yBase - h - 2, w * 2 - 2, 1, '#ffffff66');
}

function paintPads(ctx, x, yBase, h, col, dk, w) {
  for (const a of ROPE_AT) {
    const y = Math.round(yBase - h * a) - 3;
    px(ctx, x - w - 2, y, w * 2 + 4, 7, dk);
    px(ctx, x - w - 2, y, w * 2 + 4, 2, col);
    px(ctx, x - w - 1, y + 1, w * 2 + 2, 1, '#ffffff44');
  }
}

function buildRing() {
  ringBack = surface();
  ringFront = surface();
  const b = ringBack.getContext('2d');
  const f = ringFront.getContext('2d');
  b.imageSmoothingEnabled = false; f.imageSmoothingEnabled = false;

  const T = Math.round(FLOOR_TOP), B = Math.round(FLOOR_BOT);
  const bx = Math.round(screenX(-RING_HX, -RING_HZ)), bX = Math.round(screenX(RING_HX, -RING_HZ));
  const fx = Math.round(screenX(-RING_HX, RING_HZ)), fX = Math.round(screenX(RING_HX, RING_HZ));
  const RED = ['#e04040', '#8c1414'], BLU = ['#4878e8', '#16307c'];

  paintCrowd(b);
  paintFloor(b);

  // back posts and the ropes that hang behind the boxers
  paintPost(b, bx, T, POST_BACK, RED[0], RED[1], 4);
  paintPost(b, bX, T, POST_BACK, BLU[0], BLU[1], 4);
  for (const a of ROPE_AT) {
    const yb = T - POST_BACK * a, yf = B - POST_FRONT * a;
    line(b, bx, yb, bX, yb, '#f2f2f8', 2);            // the far rope
    px(b, bx, yb + 2, bX - bx, 1, '#9aa0b8');
    line(b, bx, yb, fx, yf, '#e6e6f0', 2);            // and the two sides
    line(b, bX, yb, fX, yf, '#e6e6f0', 2);
  }
  paintPads(b, bx, T, POST_BACK, RED[0], RED[1], 4);
  paintPads(b, bX, T, POST_BACK, BLU[0], BLU[1], 4);

  // the near ropes and posts, which the boxers pass behind
  for (const a of ROPE_AT) {
    const yf = B - POST_FRONT * a;
    line(f, fx, yf, fX, yf, '#f8f8fc', 3);
    px(f, fx, yf + 3, fX - fx, 1, '#8f95ad');
  }
  paintPost(f, fx, B, POST_FRONT, BLU[0], BLU[1], 5);
  paintPost(f, fX, B, POST_FRONT, RED[0], RED[1], 5);
  paintPads(f, fx, B, POST_FRONT, BLU[0], BLU[1], 5);
  paintPads(f, fX, B, POST_FRONT, RED[0], RED[1], 5);
}

function drawRingBack(ctx, frame) {
  if (!ringBack) buildRing();
  ctx.drawImage(ringBack, 0, 0);
  for (const fl of FLASHES) {                          // the odd camera going off
    if (((frame + fl.t) % 170) < 4) {
      px(ctx, fl.x, fl.y, 3, 1, '#f8f8d8');
      px(ctx, fl.x + 1, fl.y - 1, 1, 3, '#f8f8d8');
    }
  }
}

function drawRingFront(ctx) {
  if (!ringFront) buildRing();
  ctx.drawImage(ringFront, 0, 0);
}

/* ----------------------------------------------------------------- boxer */

function drawShadow(ctx, b) {
  const x = Math.round(screenX(b.x, b.z)), y = Math.round(screenY(b.z));
  px(ctx, x - 7, y - 2, 15, 4, '#cbb894');
  px(ctx, x - 9, y - 1, 19, 2, '#cbb894');
  px(ctx, x - 5, y - 3, 11, 1, '#cbb894');
}

/* Paints a character mask, one fillRect per run of like pixels, so a hand
   drawn sprite costs about as much as the rectangles it replaces. */
function sprite(ctx, x, y, rows, map, flip) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; ) {
      const ch = row[c];
      let n = 1;
      while (c + n < row.length && row[c + n] === ch) n++;
      const col = map[ch];
      if (col) px(ctx, flip ? x + row.length - c - n : x + c, y + r, n, 1, col);
      c += n;
    }
  }
}

const GLOVE_ART = [
  '..oooo..',
  '.oggggo.',
  'ogwwggdo',
  'ogwgggdo',
  'oggggddo',
  'oggggddo',
  '.oddddo.',
  '.cccccc.',
  '..oooo..',
];

// the eye row carries no shading at the temples, or the two eyes and the
// dark edges of the skull read as one band across the face
const HEAD_FRONT = [
  '.hhhhhhhh.',
  'hHHHHhhhhh',
  'hHHhhhhhhh',
  'hhhhhhhhhh',
  'hdkkkkkkdh',
  'dkkkkkkkkd',
  'kkeekkeekk',
  'dkkkkkkkkd',
  'dkkkkkkkkd',
  'dkkkeekkkd',
  '.dddddddd.',
];
const HEAD_SIDE = [                 // faces right; flipped for the other way
  '.hhhhhhhh..',
  'hHHHHhhhhh.',
  'hHHhhhhhhh.',
  'hhhhhhhhhh.',
  'hdkkkkkkkh.',
  'dkkkkkkkkd.',
  'kkkkkeekkk.',
  'dkkkkkkkkkk',
  'dkkkkkkkkdk',
  'dkkkkkkeekd',
  '.dddddddd..',
];
const HEAD_BACK = [
  '.hhhhhhhh.',
  'hHHHHhhhhh',
  'hHHhhhhhhh',
  'hhhhhhhhhh',
  'hhhhhhhhhh',
  'hHHHHHhhhh',
  'hhhhhhhhhh',
  'dkkkkkkkkd',
  'dkkkkkkkkd',
  'dkkkkkkkkd',
  '.dddddddd.',
];

function drawGlove(ctx, gx, gy, P) {
  sprite(ctx, Math.round(gx) - 4, Math.round(gy) - 5, GLOVE_ART, {
    o: P.out, g: P.glove, d: P.gloveDk, w: '#ffffff', c: P.lace,
  });
}

function drawArm(ctx, x0, y0, x1, y1, P) {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    px(ctx, x0 + dx * t - 1, y0 + dy * t - 1, 3, 3, P.skin);
    px(ctx, x0 + dx * t - 1, y0 + dy * t + 1, 3, 1, P.skinDk);
  }
}

/* A tapered limb from the shoulder to the wrist: thick at the top, lit
   along the leading edge, shadowed underneath. */
function drawLimb(ctx, x0, y0, x1, y1, P) {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.max(1, Math.round(Math.hypot(dx, dy)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = Math.round(x0 + dx * t), y = Math.round(y0 + dy * t);
    const w = t < 0.45 ? 5 : (t < 0.75 ? 4 : 3);      // bicep, forearm, wrist
    const h = w;
    px(ctx, x - (w >> 1), y - (h >> 1), w, h, P.skin);
    px(ctx, x - (w >> 1), y - (h >> 1), w, 1, P.skinLt);
    px(ctx, x - (w >> 1), y + (h >> 1), w, 1, P.skinDk);
  }
}

function drawGlove(ctx, gx, gy, P) {
  sprite(ctx, Math.round(gx) - 3, Math.round(gy) - 4, GLOVE, sprPal(P));
}

/* The body is the reference sheet; the head, the trunk and the legs are
   drawn as three pieces so a crouch can fold him and a slip can take his
   head off the line without the rest of him following. */
function drawBody(ctx, b, P) {
  const fx = Math.round(screenX(b.x, b.z));
  const fy = Math.round(screenY(b.z)) - b.bob;
  const d  = Math.round(b.duckAmt * 8);
  const flip = b.dir === 'left';                    // he is drawn facing right
  const lean = Math.round(b.leanX + b.duckAmt * 3 * Math.cos(b.ang));
  const M = sprPal(P);
  const left = fx - SPR_CX, top = fy - (SPR_H - 1);
  const put = (rows, x, y) => sprite(ctx, x, y, rows, M, flip);

  // legs and boots, and the footwork under them
  const legs = BOXER.slice(SPR_HIP, 39);
  put(legs, left, top + SPR_HIP);
  const step = STEP_ROWS[b.stepFrame || 0];
  put(step || BOXER.slice(39), left, top + 39);

  // trunk, folding down into the hips as he crouches
  put(BOXER.slice(SPR_HEAD, SPR_HIP), left + lean, top + SPR_HEAD + d);

  // head, which the slip moves on its own
  const hx = left + lean + Math.round(b.headX) + Math.round(b.slipDX);
  const hy = top + d + Math.round(b.headY) + Math.round(b.slipDY);
  put(BOXER.slice(0, SPR_HEAD), hx, hy);
}

/* Flat on the canvas. Rather than a second set of art that would never
   match, he is the standing sprite laid on its side - feet towards
   whatever put him there, head away from it. */
function drawDownedBoxer(ctx, b) {
  const P = b.flash > 0 ? PAL_FLASH : b.pal;
  const fx = Math.round(screenX(b.x, b.z)), fy = Math.round(screenY(b.z));
  const s = b.hitDirX >= 0 ? 1 : -1;
  const M = sprPal(P);

  px(ctx, fx - 20, fy - 2, 40, 4, '#cbb894');          // the canvas takes his weight
  px(ctx, fx - 24, fy - 1, 48, 2, '#cbb894');

  const y0 = fy - 12;
  for (let r = 0; r < SPR_H; r++) {
    const row = BOXER[r];
    for (let c = 0; c < row.length; ) {
      const ch = row[c];
      let n = 1;
      while (c + n < row.length && row[c + n] === ch) n++;
      const col = M[ch];
      if (col) {
        // the sprite turned on its side: rows run along the canvas
        const lx = SPR_H - 1 - r;
        px(ctx, s > 0 ? fx - 24 + lx : fx + 23 - lx, y0 + c, 1, n, col);
      }
      c += n;
    }
  }
  // his hands where they fell
  drawGlove(ctx, fx + s * 4, fy - 14, P);
  drawGlove(ctx, fx - s * 3, fy - 6, P);
}

function drawBoxer(ctx, b) {
  if (b.down) { drawDownedBoxer(ctx, b); return; }
  const P = b.flash > 0 ? PAL_FLASH : b.pal;
  drawShadow(ctx, b);

  const parts = [];
  for (const hand of ['L', 'R']) {
    const g = b.gloves[hand];
    const lat = hand === 'L' ? -5 : 5;
    const gx = screenX(g.x, g.z);
    const gy = screenY(g.z) - g.h - b.bob - GLOVE_LIFT;
    // the shoulder has to take the same taper as the glove, or the arm
    // stretches towards the middle of the ring
    const sz = b.sz(lat);
    const sx = screenX(b.sx(lat), sz);
    const shy = screenY(sz) - (SPR_SHOULDER - 4 - Math.round(b.duckAmt * 8)) - b.bob;
    parts.push({ z: g.z, gx, gy, sx: sx + b.leanX, sy: shy });
  }
  parts.sort((a, c) => a.z - c.z);

  for (const p of parts) if (p.z < b.z) { drawLimb(ctx, p.sx, p.sy, p.gx, p.gy, P); drawGlove(ctx, p.gx, p.gy, P); }
  drawBody(ctx, b, P);
  for (const p of parts) if (p.z >= b.z) { drawLimb(ctx, p.sx, p.sy, p.gx, p.gy, P); drawGlove(ctx, p.gx, p.gy, P); }
}

/* -------------------------------------------------------------- fx / ui */

function drawSpark(ctx, s) {
  const x = Math.round(screenX(s.x, s.z)), y = Math.round(screenY(s.z) - s.h);
  const r = Math.round(s.r);
  const col = s.life > 3 ? '#f8f8f8' : '#f8d038';
  px(ctx, x - r, y, r * 2 + 1, 1, col);
  px(ctx, x, y - r, 1, r * 2 + 1, col);
  px(ctx, x - r + 1, y - r + 1, 2, 2, col);
  px(ctx, x + r - 2, y + r - 2, 2, 2, col);
  px(ctx, x - r + 1, y + r - 2, 2, 2, col);
  px(ctx, x + r - 2, y - r + 1, 2, 2, col);
}

function drawParticle(ctx, p) {
  px(ctx, screenX(p.x, p.z), screenY(p.z) - p.h, 2, 2, p.col);
}

// classic dialogue box: white fill, dark rounded frame
function drawBox(ctx, x, y, w, h) {
  px(ctx, x + 2, y, w - 4, h, '#f8f8f8');
  px(ctx, x, y + 2, w, h - 4, '#f8f8f8');
  px(ctx, x + 1, y + 1, w - 2, h - 2, '#f8f8f8');
  px(ctx, x + 3, y + 1, w - 6, 1, '#181820');
  px(ctx, x + 3, y + h - 2, w - 6, 1, '#181820');
  px(ctx, x + 1, y + 3, 1, h - 6, '#181820');
  px(ctx, x + w - 2, y + 3, 1, h - 6, '#181820');
  px(ctx, x + 2, y + 2, 1, 1, '#181820');
  px(ctx, x + w - 3, y + 2, 1, 1, '#181820');
  px(ctx, x + 2, y + h - 3, 1, 1, '#181820');
  px(ctx, x + w - 3, y + h - 3, 1, 1, '#181820');
}

/* ------------------------------------------------------- condition meters */

function drawBar(ctx, x, y, w, frac, col, bg, cap) {
  px(ctx, x - 1, y - 1, w + 2, 7, '#181820');
  px(ctx, x, y, w, 5, bg || '#8890a8');
  if (cap != null && cap < 1) {          // wind that is gone for good
    const c = Math.max(0, Math.round(w * cap));
    px(ctx, x + c, y, w - c, 5, '#503848');
    px(ctx, x + c, y, 1, 5, '#181820');
  }
  const f = Math.max(0, Math.min(w, Math.round(w * frac)));
  if (f > 0) {
    px(ctx, x, y, f, 5, col);
    px(ctx, x, y, f, 1, '#ffffff55');
  }
}

function drawStatus(ctx, b, x, y, w, name, mine) {
  const h = 28;
  drawBox(ctx, x, y, w, h);
  text(ctx, name, x + 7, y + 3, '#181820');
  if (mine) {                       // which of the two men you are boxing with
    const bx = x + 14 + textW(name);
    px(ctx, bx, y + 2, 22, 9, '#181820');
    px(ctx, bx + 1, y + 3, 20, 7, '#f0c832');
    text(ctx, 'YOU', bx + 3, y + 3, '#3a2c04');
  }
  const cls = b.weight.short;
  text(ctx, cls, x + w - 8 - textW(cls), y + 3, '#585868');

  const bx = x + 22, bw = w - 30;
  const hf = clamp(b.hpShown / MAX_HP, 0, 1);
  const sf = clamp(b.st / MAX_ST, 0, 1);
  text(ctx, 'HP', x + 6, y + 11, '#181820');
  drawBar(ctx, bx, y + 12, bw, hf,
          hf > 0.5 ? '#40c840' : hf > 0.22 ? '#f8d038' : '#e83828');
  text(ctx, 'ST', x + 6, y + 19, '#181820');
  drawBar(ctx, bx, y + 20, bw, sf, sf > 0.25 ? '#3878e0' : '#f88030',
          null, clamp(b.stCap / MAX_ST, 0, 1));
}

/* ------------------------------------------------------------ punch guide */

function drawRating(ctx, x, y, n, col, max) {
  for (let i = 0; i < (max || 5); i++) {
    px(ctx, x + i * 5, y, 4, 5, i < n ? col : '#c8c8d0');
    px(ctx, x + i * 5, y + 5, 4, 1, i < n ? '#00000030' : '#b0b0bc');
  }
}

function drawGuide(ctx, x, y, w) {
  const dark = '#181820';
  const colW = Math.floor(w / GUIDE_COLS.length);   // fit whatever width we get
  for (let c = 0; c < GUIDE_COLS.length; c++) {
    const cx = x + c * colW;
    text(ctx, 'PUNCH', cx, y, dark);
    text(ctx, 'SPD', cx + 68, y, '#2860c0');
    text(ctx, 'PWR', cx + 96, y, '#b02020');
    text(ctx, 'STA', cx + 124, y, '#a06010');
    GUIDE_COLS[c].forEach((k, i) => {
      const p = PUNCHES[k], ry = y + 10 + i * 10;
      text(ctx, p.key, cx, ry, dark);
      text(ctx, p.name, cx + 22, ry, dark);
      drawRating(ctx, cx + 68, ry + 1, p.spd, '#3878e0');
      drawRating(ctx, cx + 96, ry + 1, p.pwr, '#e83828');
      drawRating(ctx, cx + 124, ry + 1, p.cost, '#e8a020');
    });
  }
}

/* --------------------------------------------------------- round + cards */

const DARK = '#181820';

function timeStr(frames) {
  const t = Math.max(0, Math.ceil(frames / 60));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}

function drawClock(ctx, x, y, w, round, frames) {
  drawBox(ctx, x, y, w, 28);
  ctext(ctx, 'R' + round, x + w / 2, y + 5, DARK);
  ctext(ctx, timeStr(frames), x + w / 2, y + 15, DARK);
}

const STAT_ROWS = [
  ['PUNCHES THROWN', s => s.thrown],
  ['LANDED',         s => s.landed],
  ['   TO THE HEAD', s => s.head],
  ['   TO THE BODY', s => s.body],
  ['BLOCKED',        s => s.blocked],
  ['SLIPPED/DUCKED', s => s.slipped],
  ['KNOCKDOWNS',     s => s.kd],
];

/* The between-rounds screen: what each boxer landed, then the three cards. */
function drawRoundCard(ctx, round, ps, bs, card, totals, names) {
  const x = 8, y = 40, w = VIEW_W - 16, h = 156;
  const cA = VIEW_W - 142, cB = VIEW_W - 74;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, 'END OF ROUND ' + round, CX, y + 5, DARK);
  // by name, so both men read the same card the same way
  const nA = (names && names[0]) || 'RED', nB = (names && names[1]) || 'BLUE';
  text(ctx, nA, cA + 18 - textW(nA), y + 16, DARK);
  text(ctx, nB, cB + 18 - textW(nB), y + 16, DARK);

  STAT_ROWS.forEach((r, i) => {
    const ry = y + 27 + i * 11;
    text(ctx, r[0], x + 10, ry, DARK);
    text(ctx, String(r[1](ps)).padStart(3), cA, ry, DARK);
    text(ctx, String(r[1](bs)).padStart(3), cB, ry, DARK);
  });

  px(ctx, x + 8, y + 105, w - 16, 1, DARK);
  (card || []).forEach((sc, i) => {
    const ry = y + 110 + i * 10;
    text(ctx, 'JUDGE ' + (i + 1), x + 10, ry, DARK);
    text(ctx, String(sc[0]).padStart(3), cA, ry, DARK);
    text(ctx, String(sc[1]).padStart(3), cB, ry, DARK);
  });
  px(ctx, x + 8, y + 140, w - 16, 1, DARK);
  text(ctx, 'RUNNING TOTAL', x + 10, y + 144, DARK);
  text(ctx, String(totals[0]).padStart(3), cA, y + 144, DARK);
  text(ctx, String(totals[1]).padStart(3), cB, y + 144, DARK);
  ctext(ctx, 'SPACE FOR THE NEXT ROUND', CX, y + h + 2, '#c8d4f0');
}

/* The final verdict, or a stoppage. */
function drawResult(ctx, cards, verdict, winner, note) {
  const x = Math.round(CX - 130), y = 52, w = 260, h = 108;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, note ? 'THE FIGHT IS OVER' : 'WE GO TO THE CARDS', CX, y + 6, DARK);
  cards.forEach((sc, i) => {
    const ry = y + 22 + i * 10;
    text(ctx, 'JUDGE ' + (i + 1), x + 24, ry, DARK);
    text(ctx, String(sc[0]).padStart(3) + '  -' + String(sc[1]).padStart(3), x + 156, ry, DARK);
  });
  px(ctx, x + 10, y + 56, w - 20, 1, DARK);
  ctext(ctx, verdict, CX, y + 62, DARK);
  ctext(ctx, winner, CX, y + 74, DARK);
  ctext(ctx, 'PRESS SPACE FOR A NEW FIGHT', CX, y + 90, DARK);
}

// kept up above the ring so the count never covers the man on the canvas
function drawCount(ctx, name, n) {
  const w = 108, y = 31;
  drawBox(ctx, CX - w / 2, y, w, 28);
  ctext(ctx, name + ' IS DOWN', CX, y + 5, DARK);
  ctext(ctx, n >= COUNT_TO ? 'COUNT ' + n + '  OUT!' : 'COUNT ' + n, CX, y + 15, DARK);
}

/* ------------------------------------------------------------- menu + guide */

function drawMenu(ctx, items, idx, w) {
  drawBox(ctx, Math.round(CX - 86), 20, 172, 20);
  ctext(ctx, 'RETRO BOXING', CX, 25, DARK);

  const bx = Math.round(CX - 90), by = 40, bw = 180, bh = 108;
  drawBox(ctx, bx, by, bw, bh);
  items.forEach((it, i) => {
    const iy = by + 8 + i * 11;
    if (i === idx) text(ctx, '>', bx + 14, iy, DARK);
    text(ctx, it, bx + 24, iy, DARK);
  });
  px(ctx, bx + 10, by + 76, bw - 20, 1, DARK);
  ctext(ctx, w.name, CX, by + 81, DARK);
  ctext(ctx, w.lb + ' LB / ' + w.kg + ' KG', CX, by + 91, DARK);
  ctext(ctx, 'W/S MOVE   SPACE SELECT', CX, by + bh + 18, DARK);
}

/* The six divisions, with the speed and power each one fights at. Used both
   as the picker and as the first page of the guide. */
function drawWeightTable(ctx, title, sel, cursor, hint) {
  const x = 14, y = 28, w = VIEW_W - 28, h = 124;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, title, CX, y + 5, DARK);

  const nx = x + 24, lbx = x + 150, kgx = x + 186, sx = x + 234, px2 = x + 294;
  text(ctx, 'CLASS', nx, y + 17, DARK);
  text(ctx, 'LB', lbx, y + 17, DARK);
  text(ctx, 'KG', kgx, y + 17, DARK);
  text(ctx, 'SPD', sx, y + 17, '#2860c0');
  text(ctx, 'PWR', px2, y + 17, '#b02020');

  WEIGHTS.forEach((wt, i) => {
    const ry = y + 29 + i * 12;
    if (i === sel) text(ctx, cursor ? '>' : '*', x + 10, ry, DARK);
    text(ctx, wt.name, nx, ry, DARK);
    text(ctx, String(wt.lb).padStart(3), lbx, ry, DARK);
    text(ctx, String(wt.kg).padStart(3), kgx, ry, DARK);
    drawRating(ctx, sx, ry + 1, wt.spdBar, '#3878e0', WEIGHT_BARS);
    drawRating(ctx, px2, ry + 1, wt.pwrBar, '#e83828', WEIGHT_BARS);
  });
  ctext(ctx, hint, CX, y + h + 4, DARK);
}

function drawPunchPage(ctx) {
  const x = 14, y = 28, w = VIEW_W - 28, h = 124;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, 'THE PUNCHES', CX, y + 5, DARK);
  drawGuide(ctx, x + 8, y + 20, w - 16);
  px(ctx, x + 10, y + 74, w - 20, 1, DARK);
  ctext(ctx, 'SPD  HOW FAST IT COMES AND GOES', CX, y + 80, DARK);
  ctext(ctx, 'PWR  WHAT IT TAKES OFF HIM', CX, y + 90, DARK);
  ctext(ctx, 'STA  WHAT IT COSTS YOU TO THROW', CX, y + 100, DARK);
  ctext(ctx, 'SHOWN AT WELTERWEIGHT', CX, y + 112, '#585868');
}

const DEFENCE_LINES = [
  ['GUARD', 'SPACE', 'STOPS THE HEAD, CATCHES SOME BODY',
                     'WORK. EVERY CATCH COSTS WIND.'],
  ['DUCK', 'DOWN', 'GOES UNDER STRAIGHTS AND HOOKS. UPPERCUTS',
                   'AND BODY LAND. BURNS WIND WHILE HELD.'],
  ['SLIP', 'Q / E', 'TAKES THE HEAD OFF STRAIGHTS AND',
                    'UPPERCUTS. HOOKS COME AROUND IT.'],
];

function drawDefencePage(ctx) {
  const x = 14, y = 28, w = VIEW_W - 28, h = 124;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, 'DEFENCE', CX, y + 5, DARK);
  DEFENCE_LINES.forEach((d, i) => {
    const ry = y + 20 + i * 30;
    text(ctx, d[0], x + 12, ry, DARK);
    text(ctx, '(' + d[1] + ')', x + 48, ry, '#585868');
    text(ctx, d[2], x + 12, ry + 10, DARK);
    text(ctx, d[3], x + 12, ry + 19, DARK);
  });
  ctext(ctx, 'A SLIP IS TIMED - IT CANNOT BE HELD', CX, y + 110, '#585868');
}

function drawGuidePage(ctx, page, sel) {
  if (page === 0) {
    drawWeightTable(ctx, 'WEIGHT CLASSES', sel, false, '');
  } else if (page === 1) {
    drawPunchPage(ctx);
  } else {
    drawDefencePage(ctx);
  }
  ctext(ctx, '< A/D  PAGE ' + (page + 1) + ' OF 3  B BACK >', CX, 156, DARK);
}

/* ------------------------------------------------------------- fighters */

// a colour chip, used by the shorts and skin pickers
function swatch(ctx, x, y, w, h, col, dk) {
  px(ctx, x - 1, y - 1, w + 2, h + 2, DARK);
  px(ctx, x, y, w, h, col);
  px(ctx, x, y + h - 2, w, 2, dk);
  px(ctx, x, y, w, 1, '#ffffff55');
}

function arrows(ctx, x, y, w, on) {
  const c = on ? DARK : '#a0a0b0';
  text(ctx, '<', x - 10, y, c);
  text(ctx, '>', x + w + 4, y, c);
}

/* A standing boxer drawn from a fighter record, for the previews. */
function drawFighterPreview(ctx, fighter, cx, feetY, dir) {
  const stub = {
    x: cx - CX, z: (feetY - CY) / PERSP, ang: dir === 'left' ? Math.PI : 0,
    dir: dir || 'down', duckAmt: 0, hurt: 0, flash: 0, bob: 0,
    headX: 0, headY: 0, leanX: 0, slipDX: 0, slipDY: 0, down: false,
    pal: palFor(fighter),
    gloves: { L: { x: 0, z: 0, h: 30 }, R: { x: 0, z: 0, h: 33 } },
    sx(lat) { return this.x - Math.sin(this.ang) * lat; },
    sz(lat) { return this.z + Math.cos(this.ang) * lat; },
  };
  const ca = Math.cos(stub.ang), sa = Math.sin(stub.ang);
  for (const hand of ['L', 'R']) {
    const sign = hand === 'L' ? -1 : 1;
    const fwd = hand === 'L' ? 9 : 3, lat = sign * 5 * 0.68;
    stub.gloves[hand].x = stub.x + ca * fwd - sa * lat;
    stub.gloves[hand].z = stub.z + sa * fwd + ca * lat;
    stub.gloves[hand].h = hand === 'L' ? 30 : 33;
  }
  drawBoxer(ctx, stub);
}

/* ---- the three slots ---- */
function drawRoster(ctx, fighters, sel) {
  const x = 30, y = 30, w = VIEW_W - 60, h = 118;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, 'MY FIGHTERS', CX, y + 6, DARK);
  for (let i = 0; i < FIGHTER_SLOTS; i++) {
    const f = fighters[i], ry = y + 24 + i * 26;
    if (i === sel) text(ctx, '>', x + 10, ry + 4, DARK);
    px(ctx, x + 20, ry - 2, w - 40, 22, i === sel ? '#e8e8f0' : '#f8f8f8');
    px(ctx, x + 20, ry - 2, w - 40, 1, '#c0c0cc');
    if (!f) {
      text(ctx, String(i + 1) + '.  - EMPTY SLOT -', x + 26, ry + 4, '#8890a8');
    } else {
      swatch(ctx, x + 26, ry + 3, 10, 10, SHORTS[f.shorts].trunk, SHORTS[f.shorts].trunkDk);
      text(ctx, f.name, x + 44, ry, DARK);
      text(ctx, COUNTRIES[f.country], x + 44, ry + 10, '#585868');
      text(ctx, WEIGHTS[f.weight].short, x + 118, ry, DARK);
      text(ctx, WEIGHTS[f.weight].lb + ' LB', x + 118, ry + 10, '#585868');
      text(ctx, recordLine(f.record), x + 196, ry, DARK);
      text(ctx, winPct(f.record) + '% WINS', x + 196, ry + 10, '#585868');
      text(ctx, 'KO ' + f.record.koFor, x + 268, ry, '#585868');
    }
  }
  if (Net.saveError) {
    ctext(ctx, Net.saveError.slice(0, 52), CX, y + h - 12, '#c02828');
  } else {
    const who = Net.signedIn() ? 'ON ' + (Net.handle || 'YOUR ACCOUNT')
                               : 'GUEST - THESE STAY ON THIS BROWSER';
    ctext(ctx, who, CX, y + h - 12, '#585868');
  }
  ctext(ctx, 'SPACE SELECT    B BACK', CX, y + h + 6, DARK);
}

/* ---- making one ---- */
const NEW_ROWS = ['NAME', 'DIVISION', 'SKIN', 'SHORTS', 'COUNTRY', 'CREATE'];

function drawNewFighter(ctx, draft, row, blink) {
  const x = 22, y = 26, w = VIEW_W - 44, h = 140;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, 'NEW FIGHTER', CX, y + 6, DARK);

  const lx = x + 16, vx = x + 96, ax = vx + 96;
  const rowY = i => y + 22 + i * 19;

  for (let i = 0; i < NEW_ROWS.length; i++) {
    const on = i === row, ry = rowY(i);
    if (on) text(ctx, '>', x + 6, ry, DARK);
    if (i < 5) text(ctx, NEW_ROWS[i], lx, ry, DARK);
    switch (i) {
      case 0:
        text(ctx, draft.name + (on && blink ? '_' : ''), vx, ry, DARK);
        if (!draft.name) text(ctx, on ? '' : '- TYPE A NAME -', vx, ry, '#a0a0b0');
        break;
      case 1:
        text(ctx, WEIGHTS[draft.weight].name, vx, ry, DARK);
        text(ctx, WEIGHTS[draft.weight].lb + ' LB / ' + WEIGHTS[draft.weight].kg + ' KG',
             vx, ry + 9, '#585868');
        arrows(ctx, vx - 4, ry, 104, on);
        break;
      case 2:
        swatch(ctx, vx, ry - 1, 26, 9, SKINS[draft.skin].skin, SKINS[draft.skin].skinDk);
        arrows(ctx, vx - 4, ry, 30, on);
        break;
      case 3:
        swatch(ctx, vx, ry - 1, 26, 9, SHORTS[draft.shorts].trunk, SHORTS[draft.shorts].trunkDk);
        text(ctx, SHORTS[draft.shorts].name, vx + 48, ry, DARK);
        arrows(ctx, vx - 4, ry, 30, on);
        break;
      case 4:
        text(ctx, COUNTRIES[draft.country], vx, ry, DARK);
        arrows(ctx, vx - 4, ry, 20, on);
        break;
      case 5:
        text(ctx, draft.name ? 'CREATE FIGHTER' : 'NAME HIM FIRST',
             lx, ry + 2, draft.name ? DARK : '#a0a0b0');
        break;
    }
  }

  // live preview
  px(ctx, x + w - 78, y + 22, 62, h - 40, '#e4e4ec');
  px(ctx, x + w - 78, y + 22, 62, 1, '#c0c0cc');
  drawFighterPreview(ctx, draft, x + w - 47, y + h - 26, 'down');

  ctext(ctx, 'TYPE NAME   ' + KEY.U + KEY.D + ' ROW   ' + KEY.L + KEY.R + ' CHANGE   ESC BACK', CX, y + h + 6, DARK);
}

/* ---- one you already have ---- */
function drawFighterCard(ctx, f, row, confirmDelete) {
  const x = 40, y = 30, w = VIEW_W - 80, h = 130;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, f.name + '   ' + COUNTRIES[f.country], CX, y + 6, DARK);

  const lx = x + 16;
  text(ctx, WEIGHTS[f.weight].name, lx, y + 24, DARK);
  text(ctx, WEIGHTS[f.weight].lb + ' LB / ' + WEIGHTS[f.weight].kg + ' KG', lx, y + 34, '#585868');

  text(ctx, 'RECORD', lx, y + 52, DARK);
  text(ctx, recordLine(f.record), lx + 66, y + 52, DARK);
  text(ctx, 'WIN RATE', lx, y + 63, DARK);
  text(ctx, winPct(f.record) + '%', lx + 66, y + 63, DARK);
  text(ctx, 'BY KO', lx, y + 74, DARK);
  text(ctx, f.record.koFor + ' FOR / ' + f.record.koAgainst + ' AGAINST', lx + 66, y + 74, DARK);
  text(ctx, 'TRAINING', lx, y + 85, '#585868');
  text(ctx, recordLine(f.training), lx + 66, y + 85, '#585868');

  const r0 = y + 102, r1 = y + 114;
  if (row === 0) text(ctx, '>', x + 6, r0, DARK);
  text(ctx, 'SHORTS', lx, r0, DARK);
  swatch(ctx, lx + 66, r0 - 1, 26, 9, SHORTS[f.shorts].trunk, SHORTS[f.shorts].trunkDk);
  text(ctx, SHORTS[f.shorts].name, lx + 114, r0, DARK);
  arrows(ctx, lx + 62, r0, 30, row === 0);

  if (row === 1) text(ctx, '>', x + 6, r1, DARK);
  text(ctx, confirmDelete ? 'DELETE HIM? SPACE AGAIN TO CONFIRM' : 'DELETE FIGHTER',
       lx, r1, confirmDelete ? '#c02828' : DARK);

  px(ctx, x + w - 74, y + 20, 58, h - 34, '#e4e4ec');
  drawFighterPreview(ctx, f, x + w - 45, y + h - 20, 'down');

  ctext(ctx, 'ONLY THE SHORTS CAN BE CHANGED', CX, y + h + 6, DARK);
}

/* ---------------------------------------------------------- multiplayer */

function drawMultiplayer(ctx, items, sel, signedIn) {
  const x = 60, y = 34, w = VIEW_W - 120, h = 108;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, 'MULTIPLAYER', CX, y + 6, DARK);
  items.forEach((it, i) => {
    const ry = y + 26 + i * 13;
    if (i === sel) text(ctx, '>', x + 14, ry, DARK);
    text(ctx, it, x + 26, ry, DARK);
  });
  px(ctx, x + 10, y + h - 26, w - 20, 1, DARK);
  ctext(ctx, signedIn ? 'SIGNED IN' : 'NOT SIGNED IN - OFFLINE', CX, y + h - 20, '#585868');
  ctext(ctx, 'SPACE SELECT    B BACK', CX, y + h + 6, DARK);
}

function drawSoon(ctx, title, lines) {
  const x = 34, y = 34, w = VIEW_W - 68, h = 116;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, title, CX, y + 8, DARK);
  px(ctx, x + 10, y + 20, w - 20, 1, DARK);
  lines.forEach((l, i) => ctext(ctx, l, CX, y + 30 + i * 11, i === 0 ? DARK : '#585868'));
  ctext(ctx, 'B BACK', CX, y + h + 6, DARK);
}

/* What each multiplayer section will be, and what it is waiting on. */
const MP_PAGES = [
  { title: 'SIGN IN / SIGN UP', lines: [
      'ONE ACCOUNT, THREE FIGHTERS',
      'A NAME AND A PASSWORD - NO EMAIL',
      'RECORDS FOLLOW YOU ANYWHERE',
      '',
      'NEEDS AN ACCOUNT SERVER' ] },
];

/* ------------------------------------------------------------ account */

const AUTH_ROWS = ['NAME', 'PASSWORD', 'SIGN IN', 'CREATE ACCOUNT'];

function drawAuth(ctx, email, pass, row, blink, msg, busy) {
  const x = 50, y = 40, w = VIEW_W - 100, h = 110;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, 'RETRO BOXING ACCOUNT', CX, y + 7, DARK);
  px(ctx, x + 10, y + 20, w - 20, 1, DARK);

  const lx = x + 16, vx = x + 76;
  for (let i = 0; i < 2; i++) {
    const ry = y + 30 + i * 16, on = i === row;
    if (on) text(ctx, '>', x + 6, ry, DARK);
    text(ctx, AUTH_ROWS[i], lx, ry, DARK);
    px(ctx, vx - 2, ry - 2, w - 96, 11, '#e8e8f0');
    px(ctx, vx - 2, ry + 9, w - 96, 1, '#a8a8b8');
    const shown = i === 0 ? email.toUpperCase() : '*'.repeat(pass.length);
    if (i === 0 && !email && !on) text(ctx, 'PICK A FIGHTING NAME', vx, ry, '#a0a0b0');
    text(ctx, shown + (on && blink ? '_' : ''), vx, ry, DARK);
  }
  for (let i = 2; i < 4; i++) {
    const ry = y + 68 + (i - 2) * 13, on = i === row;
    if (on) text(ctx, '>', x + 6, ry, DARK);
    text(ctx, AUTH_ROWS[i], lx, ry, DARK);
  }
  // errors from the server can be long, so wrap them over two lines
  const note = busy ? 'TALKING TO THE SERVER...' : msg;
  if (note) {
    const per = Math.floor((w - 16) / FONT_ADV);
    if (note.length <= per) {
      ctext(ctx, note, CX, y + h - 14, busy ? '#585868' : '#c02828');
    } else {
      let cut = note.lastIndexOf(' ', per);
      if (cut < per * 0.5) cut = per;
      ctext(ctx, note.slice(0, cut), CX, y + h - 20, '#c02828');
      ctext(ctx, note.slice(cut).trim().slice(0, per), CX, y + h - 10, '#c02828');
    }
  }
  ctext(ctx, KEY.U + KEY.D + ' ROW    SPACE CONFIRM    ESC BACK', CX, y + h + 6, DARK);
}

function drawAuthNote(ctx, y) {
  ctext(ctx, 'NO EMAIL - JUST A NAME AND PASSWORD', CX, y, DARK);
}

function drawSignedIn(ctx, handle, fighters) {
  const x = 60, y = 46, w = VIEW_W - 120, h = 96;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, 'SIGNED IN', CX, y + 8, DARK);
  ctext(ctx, handle || '...', CX, y + 24, DARK);
  px(ctx, x + 10, y + 38, w - 20, 1, DARK);
  ctext(ctx, fighters + ' FIGHTER' + (fighters === 1 ? '' : 'S') + ' ON THIS ACCOUNT', CX, y + 46, '#585868');
  ctext(ctx, 'THEY FOLLOW YOU TO ANY BROWSER', CX, y + 58, '#585868');
  ctext(ctx, '> SIGN OUT', CX, y + 74, DARK);
  ctext(ctx, 'SPACE SIGN OUT    B BACK', CX, y + h + 6, DARK);
}

/* -------------------------------------------------------- leaderboard */

/* The belt sits above the rankings, in gold, and taller than the rest. */
function drawChampBanner(ctx, x, y, w, champ) {
  const h = 22;
  px(ctx, x, y, w, h, '#8a6a10');
  px(ctx, x + 1, y + 1, w - 2, h - 2, '#e8b81c');
  px(ctx, x + 1, y + 1, w - 2, 2, '#ffe87a');
  px(ctx, x + 1, y + h - 3, w - 2, 2, '#a07c10');
  px(ctx, x + 3, y + 3, w - 6, h - 6, '#f0c832');
  px(ctx, x + 3, y + 3, w - 6, 1, '#fff0a0');

  if (!champ) {
    ctext(ctx, 'THE TITLE IS VACANT', CX, y + 4, '#5a4208');
    ctext(ctx, 'THE SUNDAY TOURNAMENT WINNER TAKES IT', CX, y + 13, '#7a5c10');
    return;
  }
  text(ctx, 'CHAMPION', x + 8, y + 4, '#5a4208');
  text(ctx, champ.handle, x + 108, y + 4, '#7a5c10');
  swatch(ctx, x + 8, y + 13, 9, 7, SHORTS[champ.shorts].trunk, SHORTS[champ.shorts].trunkDk);
  text(ctx, champ.name, x + 22, y + 13, '#3a2c04');
  text(ctx, COUNTRIES[champ.country], x + 96, y + 13, '#5a4208');
  text(ctx, champ.wins + '-' + champ.losses + '-' + champ.draws, x + 140, y + 13, '#3a2c04');
  text(ctx, champ.win_pct + '%', x + 222, y + 13, '#3a2c04');
  text(ctx, 'KO ' + champ.ko_for, x + 288, y + 13, '#5a4208');
}

function drawBoard(ctx, division, rows, busy, err, champ) {
  const x = 14, y = 18, w = VIEW_W - 28, h = 152;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, WEIGHTS[division].name, CX, y + 5, DARK);
  arrows(ctx, x + 14, y + 5, w - 40, true);

  if (!busy && !err && rows) drawChampBanner(ctx, x + 8, y + 15, w - 16, champ);

  const nx = x + 40, cx2 = x + 118, rx = x + 168, px3 = x + 250, kx = x + 316;
  text(ctx, 'CONTENDERS', nx - 24, y + 41, DARK);
  text(ctx, 'FROM', cx2, y + 41, DARK);
  text(ctx, 'RECORD', rx, y + 41, DARK);
  text(ctx, 'WIN %', px3, y + 41, DARK);
  text(ctx, 'KO', kx, y + 41, DARK);

  if (busy) { ctext(ctx, 'LOADING...', CX, y + 60, '#585868'); }
  else if (err) {
    ctext(ctx, 'COULD NOT REACH THE SERVER', CX, y + 54, '#c02828');
    ctext(ctx, err, CX, y + 66, '#585868');
  } else if (!rows) {
    ctext(ctx, 'NO ACCOUNT SERVER CONNECTED', CX, y + 54, '#585868');
    ctext(ctx, 'SEE README - SUPABASE SETUP', CX, y + 66, '#585868');
  } else if (!rows.length) {
    ctext(ctx, 'NOBODY HAS FOUGHT IN THIS DIVISION YET', CX, y + 60, '#585868');
  } else {
    rows.forEach((r, i) => {
      const ry = y + 51 + i * 10;
      text(ctx, String(i + 1).padStart(2) + '.', x + 16, ry, DARK);
      swatch(ctx, nx - 12, ry, 7, 7, SHORTS[r.shorts].trunk, SHORTS[r.shorts].trunkDk);
      text(ctx, r.name, nx, ry, DARK);
      text(ctx, COUNTRIES[r.country], cx2, ry, DARK);
      text(ctx, r.wins + '-' + r.losses + '-' + r.draws, rx, ry, DARK);
      text(ctx, r.win_pct + '%', px3, ry, DARK);
      text(ctx, String(r.ko_for), kx, ry, DARK);
    });
  }
  ctext(ctx, KEY.L + KEY.R + ' DIVISION    B BACK', CX, y + h + 6, DARK);
}

/* ---------------------------------------------------------- fight rooms */

const WIRE_WORDS = {
  idle:    '',
  opening: 'OPENING A ROOM...',
  waiting: 'WAITING FOR AN OPPONENT',
  joining: 'LOOKING FOR THAT ROOM...',
  linking: 'CONNECTING TO THE OTHER CORNER...',
  ready:   'CONNECTED',
  live:    'FIGHT IN PROGRESS',
  lost:    'CONNECTION LOST',
};

/* How long a room has been standing open, so a stale one is obvious. */
function roomAge(iso) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (!isFinite(s)) return '';
  if (s >= 3600) return Math.floor(s / 3600) + 'H';
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function drawRooms(ctx, fighter, row, code, blink, list, top) {
  const x = 30, y = 12, w = VIEW_W - 60, h = 186;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, 'FIGHT ROOMS', CX, y + 6, DARK);
  px(ctx, x + 10, y + 18, w - 20, 1, DARK);

  const lx = x + 18, vx = x + 96;

  // who you are sending in
  if (row === 0) text(ctx, '>', x + 8, y + 26, DARK);
  text(ctx, 'FIGHTER', lx, y + 26, DARK);
  if (fighter) {
    swatch(ctx, vx, y + 25, 10, 8, SHORTS[fighter.shorts].trunk, SHORTS[fighter.shorts].trunkDk);
    text(ctx, fighter.name, vx + 16, y + 26, DARK);
    text(ctx, WEIGHTS[fighter.weight].name, vx + 16, y + 36, '#585868');
    arrows(ctx, vx - 4, y + 26, 100, row === 0);
  } else {
    text(ctx, 'MAKE A FIGHTER FIRST', vx, y + 26, '#c02828');
  }

  if (row === 1) text(ctx, '>', x + 8, y + 50, DARK);
  text(ctx, 'HOST A ROOM', lx, y + 50, DARK);

  if (row === 2) text(ctx, '>', x + 8, y + 62, DARK);
  text(ctx, 'JOIN CODE', lx, y + 62, DARK);
  px(ctx, vx - 2, y + 60, 40, 11, '#e8e8f0');
  px(ctx, vx - 2, y + 71, 40, 1, '#a8a8b8');
  text(ctx, code + (row === 2 && blink ? '_' : ''), vx + 2, y + 62, DARK);

  px(ctx, x + 10, y + 78, w - 20, 1, DARK);

  // ---- the rooms standing open, five at a time --------------------------
  const rooms = list || [], shown = Math.min(ROOM_ROWS, rooms.length);
  text(ctx, 'OPEN ROOMS', lx, y + 84, DARK);
  if (rooms.length > ROOM_ROWS) {
    const tag = (top + 1) + '-' + (top + shown) + ' OF ' + rooms.length;
    text(ctx, tag, x + w - 18 - textW(tag), y + 84, '#585868');
  }

  const ly = y + 98;
  if (!Net.online()) {
    text(ctx, 'SIGN IN TO SEE OPEN ROOMS', lx, ly, '#585868');
  } else if (!Net.rooms) {
    text(ctx, 'LOOKING...', lx, ly, '#585868');
  } else if (!rooms.length) {
    text(ctx, 'NOBODY IS WAITING - HOST ONE', lx, ly, '#585868');
  } else {
    for (let i = 0; i < shown; i++) {
      const r = rooms[top + i], ry = ly + i * 12;
      if (!r) break;
      const mine = fighter && r.division === fighter.weight;   // one you can take
      const sel = row === ROOM_FIRST + top + i;
      const col = mine ? DARK : '#9098a8';
      if (sel) { px(ctx, x + 6, ry - 2, w - 12, 11, '#dfe2ee'); text(ctx, '>', x + 8, ry, DARK); }
      text(ctx, r.code, lx, ry, col);
      const nm = (r.fighters && r.fighters.name) || '?';
      text(ctx, nm, x + 58, ry, col);
      text(ctx, WEIGHTS[r.division] ? WEIGHTS[r.division].short : '?', x + 148, ry, col);
      const age = roomAge(r.created_at);
      text(ctx, age, x + w - 22 - textW(age), ry, '#9098a8');
    }
    if (top > 0) text(ctx, '^', x + w - 12, ly, '#585868');
    if (top + shown < rooms.length) text(ctx, 'v', x + w - 12, ly + (shown - 1) * 12, '#585868');
  }

  px(ctx, x + 10, y + 156, w - 20, 1, DARK);
  const msg = Wire.error || WIRE_WORDS[Wire.status] || '';
  if (Wire.room && Wire.role === 'host' && Wire.status === 'waiting') {
    ctext(ctx, 'YOUR ROOM CODE  ' + Wire.room.code, CX, y + 162, DARK);
  } else if (msg) {
    ctext(ctx, msg, CX, y + 162, Wire.error ? '#c02828' : '#585868');
  } else {
    ctext(ctx, 'BOTH FIGHTERS MUST BE THE SAME DIVISION', CX, y + 162, '#585868');
  }
  ctext(ctx, 'SPACE CONFIRM    ' + KEY.U + KEY.D + ' MOVE    ESC BACK', CX, y + 173, DARK);
}


/* Both screens show the same ring, so in an online fight the two players are
   looking at the same picture from the same side - which means one of them is
   watching the far corner. A marker says which man is yours. */
function drawYouTag(ctx, b) {
  const x = Math.round(screenX(b.x, b.z));
  const y = Math.round(screenY(b.z)) - (b.down ? 22 : 54);
  const W = '#f8f8f8', D = '#181820';
  px(ctx, x - 10, y - 1, 21, 9, D);
  px(ctx, x - 9, y, 19, 7, W);
  text(ctx, 'YOU', x - 8, y, D);
  px(ctx, x - 3, y + 8, 7, 1, D);
  px(ctx, x - 2, y + 9, 5, 1, D);
  px(ctx, x - 1, y + 10, 3, 1, D);
  px(ctx, x, y + 11, 1, 1, D);
}

// Leaving a live fight has to be a decision, not a stray key. The clock keeps
// running underneath this box - you do not get to stop the fight to think.
function drawForfeitAsk(ctx) {
  const w = 208;
  drawBox(ctx, CX - w / 2, 28, w, 40);
  ctext(ctx, 'FORFEIT THE FIGHT?', CX, 34, '#c02828');
  ctext(ctx, 'IT GOES DOWN AS A LOSS FOR YOU', CX, 45, DARK);
  ctext(ctx, 'Y FORFEIT    N KEEP BOXING', CX, 57, DARK);
}

/* Something threw. Say what, rather than leaving a frozen picture on screen. */
function drawCrash(ctx, msg, n) {
  const w = 300, y = VIEW_H - 34;
  px(ctx, CX - w / 2, y, w, 26, '#2a0c0c');
  px(ctx, CX - w / 2, y, w, 1, '#c02828');
  px(ctx, CX - w / 2, y + 25, w, 1, '#c02828');
  ctext(ctx, 'SOMETHING BROKE - RELOAD THE PAGE', CX, y + 5, '#f8a0a0');
  ctext(ctx, msg, CX, y + 15, '#f8f8f8');
  if (n > 1) text(ctx, 'x' + n, CX + w / 2 - 26, y + 15, '#c02828');
}

// the two machines have stopped agreeing - say so rather than hide it
function drawDesync(ctx) {
  const w = 190;
  drawBox(ctx, CX - w / 2, 31, w, 28);
  ctext(ctx, 'THE TWO SCREENS HAVE COME APART', CX, 36, '#c02828');
  ctext(ctx, 'THIS FIGHT WILL NOT COUNT - ESC', CX, 46, DARK);
}

// shown over the ring while the two simulations are waiting on each other
function drawStall(ctx, frames) {
  if (frames < 30) return;
  const w = 118;
  drawBox(ctx, CX - w / 2, 31, w, 18);
  ctext(ctx, 'WAITING FOR OPPONENT', CX, 36, DARK);
}

/* ---------------------------------------------------------------- rules */

const RULE_PAGES = [
  { title: 'THE BOUT', lines: [
    'THREE ROUNDS OF TWO MINUTES.',
    '',
    'JUDGES SCORE EVERY ROUND ON DAMAGE, WORK',
    'RATE AND ABOVE ALL KNOCKDOWNS.',
    '10-9 TO THE WINNER OF A ROUND.',
    '10-8 IF HE PUT THE OTHER MAN DOWN, 10-7',
    'FOR TWICE. 10-10 IF NOBODY TOOK IT.',
    'THREE JUDGES, EACH SEEING IT HIS OWN WAY -',
    'SO CARDS CAN DISAGREE.',
    '',
    'AT ZERO HEALTH A BOXER TAKES AN EIGHT',
    'COUNT AND GETS UP ON 140 OF 300.',
    'THREE KNOCKDOWNS IN ONE ROUND IS A TKO.',
    'THE CORNER RETURNS 130 HEALTH BETWEEN',
    'ROUNDS, AND ALL YOUR WIND.',
  ]},
  { title: 'THE PUNCHES', lines: [
    'JAB IS QUICK AND LIGHT. CROSS IS SLOW AND',
    'HEAVY. BOTH HOOKS MATCH THE CROSS.',
    'UPPERCUTS HIT HARDEST BUT REACH LEAST.',
    'BODY SHOTS TAKE THE WIND OUT OF A MAN.',
    '',
    'EVERY PUNCH COSTS STAMINA TO THROW, AND',
    'THE HEAVIER IT IS THE MORE IT COSTS.',
    '',
    'THE TANK ALSO SHRINKS AS YOU THROW: THE',
    'CEILING IT RECOVERS TO FALLS ALL FIGHT.',
    'PICK YOUR PUNCHES.',
  ]},
  { title: 'DEFENCE', lines: [
    'GUARD STOPS EVERY HEAD PUNCH AND CATCHES',
    'ABOUT HALF THE BODY WORK - BUT EVERY',
    'PUNCH IT CATCHES COSTS YOU WIND.',
    '',
    'DUCK GOES UNDER STRAIGHTS AND HOOKS,',
    'AND INTO UPPERCUTS AND BODY SHOTS.',
    '',
    'SLIP TAKES THE HEAD OFF STRAIGHTS AND',
    'UPPERCUTS. HOOKS COME AROUND IT.',
    '',
    'NEITHER CAN BE LIVED IN. A SLIP IS A TIMED',
    'MOVE, AND A CROUCH BURNS WIND THE WHOLE',
    'TIME IT IS HELD - SIX OR SEVEN SECONDS',
    'FROM A FULL TANK. RUN IT DRY AND HIS LEGS',
    'GO: HE STANDS UP, AND STAYS UP UNTIL HE',
    'HAS SOME WIND BACK.',
  ]},
  { title: 'FIGHTERS AND DIVISIONS', lines: [
    'SIX DIVISIONS, 145LB UP TO 265LB.',
    'LIGHTER MEN ARE QUICKER AND HIT LIGHTER.',
    'BOTH FIGHTERS MUST BE THE SAME DIVISION.',
    '',
    'THREE FIGHTERS TO AN ACCOUNT.',
    'HIS NAME, DIVISION, SKIN AND COUNTRY ARE',
    'FIXED FOR LIFE. ONLY THE SHORTS CHANGE.',
    'TO CHANGE THE REST, RETIRE HIM.',
    '',
    'EVERY FIGHTER CARRIES HIS OWN RECORD.',
    'SPARRING AGAINST THE COMPUTER IS KEPT',
    'SEPARATELY AND NEVER COUNTS FOR RANKING.',
    '',
    'ONLY A FIGHT BETWEEN TWO PLAYERS COUNTS,',
    'AND THE RESULT IS WRITTEN BY THE SERVER,',
    'NOT BY EITHER MAN.',
  ]},
  { title: 'RANKINGS AND THE BELT', lines: [
    'EACH DIVISION RANKS ITS TOP 10 ON WIN',
    'PERCENTAGE. ONE BOUT MINIMUM TO BE RANKED.',
    'THE CHAMPION SITS ABOVE THE TEN.',
    '',
    'THE BELT IS WON IN THE SUNDAY TOURNAMENT',
    'AND HELD FOR THE WEEK, UNTIL THE NEXT ONE.',
    '',
    'EVERY FIGHT BETWEEN TWO PLAYERS COUNTS',
    'TOWARDS YOUR RANKING - QUICK FIGHTS AND',
    'ROOMS JUST THE SAME AS THE TOURNAMENT.',
    '',
    'SPARRING AGAINST THE COMPUTER NEVER DOES.',
  ]},
  { title: 'THE SUNDAY TOURNAMENT', lines: [
    'SUNDAY NIGHT, SYDNEY TIME, EVERY WEEK:',
    'QUARTER FINALS 7:00, SEMIS 7:30,',
    'THE FINAL AT 8:00.',
    '',
    'THE TOP 8 OF EACH DIVISION ARE DRAWN,',
    'SEEDED 1V8, 4V5, 2V7, 3V6 - SO THE TOP TWO',
    'CAN ONLY MEET IN THE FINAL.',
    '',
    'THE MARK IN BUTTON APPEARS ON YOUR BOUT',
    'TEN MINUTES BEFORE IT BOXES, AND GOES',
    'AGAIN ON THE HALF HOUR. PRESS IT OR YOU',
    'FORFEIT AND YOUR MAN WALKS THROUGH.',
    '',
    'ONCE BOTH OF YOU HAVE MARKED IN THE FIGHT',
    'OPENS ITSELF ON THE BELL. YOU DO NOT HAVE',
    'TO PRESS ANYTHING ELSE.',
  ]},
  { title: 'FINDING A FIGHT', lines: [
    'QUICK FIGHT PUTS YOU IN A QUEUE AND',
    'MATCHES YOU WITH ANYONE ELSE WAITING IN',
    'YOUR DIVISION.',
    '',
    'FIGHT ROOMS ARE FOR FIGHTING SOMEONE YOU',
    'KNOW: OPEN A ROOM, PASS ON THE FOUR LETTER',
    'CODE, AND THEY JOIN IT.',
    '',
    'EVERY ROOM STANDING OPEN IS ALSO LISTED,',
    'FIVE AT A TIME - SCROLL DOWN THE LIST AND',
    'TAKE ONE IN YOUR OWN DIVISION.',
    '',
    'A ROOM CLOSES WHEN YOU LEAVE IT, AND',
    'OPENING A NEW ONE CLOSES YOUR OLD ONE.',
    '',
    'BOTH FIGHTERS MUST BE THE SAME DIVISION.',
  ]},
  { title: 'LEAVING A FIGHT', lines: [
    'IN TRAINING YOU CAN LEAVE WHENEVER YOU',
    'LIKE. NOTHING IS RECORDED.',
    '',
    'ONLINE YOU CANNOT WALK OUT OF A FIGHT.',
    'ESC ASKS WHETHER YOU WANT TO FORFEIT,',
    'AND THE FIGHT CARRIES ON WHILE YOU',
    'DECIDE - IT IS NOT A PAUSE.',
    '',
    'A FORFEIT IS A LOSS FOR THE MAN WHO',
    'QUITS AND A WIN FOR HIS OPPONENT, AND',
    'GOES ON BOTH RECORDS THE SAME AS ANY',
    'OTHER RESULT. IT IS NOT SCORED AS A KO.',
    '',
    'IF YOU CLOSE THE PAGE MID-FIGHT THE',
    'CONNECTION DROPS AND NO RESULT IS',
    'SAVED FOR EITHER MAN.',
  ]}
];

function drawRules(ctx, page) {
  const p = RULE_PAGES[page];
  const x = 14, y = 12, w = VIEW_W - 28, h = 184;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, p.title, CX, y + 5, DARK);
  px(ctx, x + 10, y + 15, w - 20, 1, DARK);
  p.lines.forEach((l, i) => { if (l && i < 16) text(ctx, l, x + 16, y + 20 + i * 9, DARK); });
  px(ctx, x + 10, y + 166, w - 20, 1, DARK);
  ctext(ctx, '< A/D   PAGE ' + (page + 1) + ' OF ' + RULE_PAGES.length + '   B BACK >',
        CX, y + 171, DARK);
}


/* ----------------------------------------------------------- quick fight */

function drawQuick(ctx, fighter, searching, secs, msg) {
  const x = 60, y = 44, w = VIEW_W - 120, h = 100;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, 'QUICK FIGHT', CX, y + 8, DARK);
  px(ctx, x + 10, y + 20, w - 20, 1, DARK);

  if (!fighter) {
    ctext(ctx, 'MAKE A FIGHTER FIRST', CX, y + 42, '#c02828');
  } else {
    swatch(ctx, CX - 52, y + 31, 10, 8, SHORTS[fighter.shorts].trunk, SHORTS[fighter.shorts].trunkDk);
    text(ctx, fighter.name, CX - 36, y + 32, DARK);
    ctext(ctx, WEIGHTS[fighter.weight].name, CX, y + 44, '#585868');
    if (searching) {
      ctext(ctx, 'LOOKING FOR AN OPPONENT' + '...'.slice(0, 1 + (secs % 3)), CX, y + 62, DARK);
      ctext(ctx, 'WAITING ' + secs + 'S', CX, y + 74, '#585868');
    } else {
      ctext(ctx, 'SPACE TO SEARCH', CX, y + 66, DARK);
    }
  }
  if (msg) ctext(ctx, msg, CX, y + h - 12, '#c02828');
  ctext(ctx, searching ? 'B STOP SEARCHING' : 'B BACK', CX, y + h + 6, DARK);
}

/* ------------------------------------------------------------ tournament */

function boutName(fighters, id) {
  if (!id) return '---';
  const f = fighters[id];
  // the bracket is narrow; eight letters is enough to know who it is
  return f ? f.name.slice(0, 8) : '?';
}

function drawTourney(ctx, division, t, fighters, mine, msg, blink) {
  const x = 14, y = 16, w = VIEW_W - 28, h = 178;
  drawBox(ctx, x, y, w, h);
  ctext(ctx, WEIGHTS[division].name + '  SUNDAY TOURNAMENT', CX, y + 4, DARK);
  arrows(ctx, x + 14, y + 4, w - 40, true);
  px(ctx, x + 10, y + 14, w - 20, 1, DARK);

  if (!t) {
    ctext(ctx, 'NO DRAW YET FOR THIS DIVISION', CX, y + 60, '#585868');
    ctext(ctx, 'IT NEEDS AT LEAST TWO RANKED FIGHTERS', CX, y + 72, '#585868');
    ctext(ctx, 'SPACE TO OPEN THE DRAW', CX, y + 92, DARK);
    ctext(ctx, KEY.L + KEY.R + ' DIVISION    B BACK', CX, y + h - 12, DARK);
    return;
  }

  ctext(ctx, t.when, CX, y + 20, DARK);
  ctext(ctx, t.status === 'done' ? 'FINISHED'
           : t.status === 'live' ? 'UNDER WAY' : t.countdown, CX, y + 30, '#585868');

  const cols = [x + 20, x + 140, x + 254];
  ['QUARTERS 19:00', 'SEMIS 19:30', 'FINAL 20:00'].forEach((lab, i) =>
    text(ctx, lab, cols[i], y + 44, DARK));

  const top = y + 54, span = 92;
  for (const b of (t.bouts || [])) {
    const cx2 = cols[b.round - 1];
    const rows = b.round === 1 ? 4 : (b.round === 2 ? 2 : 1);
    const gap = span / rows;
    const by = Math.round(top + b.slot * gap + (gap - 18) / 2);
    px(ctx, cx2 - 3, by - 2, 108, 21, '#eef0f6');
    px(ctx, cx2 - 3, by - 2, 108, 1, '#c8ccd8');

    const red = boutName(fighters, b.red), blue = boutName(fighters, b.blue);
    text(ctx, red, cx2, by, b.winner && b.winner === b.red ? '#1a7a2a' : DARK);
    text(ctx, blue, cx2, by + 10, b.winner && b.winner === b.blue ? '#1a7a2a' : DARK);

    // a dot against each man who has marked in for this round
    if (t.isIn) {
      if (b.red && t.isIn(b.red, b.round))  px(ctx, cx2 + 51, by + 2, 3, 3, '#1a7a2a');
      if (b.blue && t.isIn(b.blue, b.round)) px(ctx, cx2 + 51, by + 12, 3, 3, '#1a7a2a');
    }
    if (b.walkover) text(ctx, 'W/O', cx2 + 80, by + 5, '#a06010');

    const isMine = mine && (b.red === mine || b.blue === mine) && !b.winner;
    if (isMine) text(ctx, '>', cx2 - 11, by + 5, '#c02828');

    // the door is open on this bout, so put the button on it
    if (isMine && t.canCheck && b.round === t.myRound) {
      const bx = cx2 + 59, bw = 45;
      px(ctx, bx, by + 2, bw, 13, blink ? '#1a7a2a' : '#12561e');
      px(ctx, bx, by + 2, bw, 1, '#48c060');
      text(ctx, 'MARK IN', bx + 2, by + 5, '#ffffff');
    }
  }

  px(ctx, x + 10, y + 150, w - 20, 1, DARK);
  ctext(ctx, msg || t.hint, CX, y + 154, msg ? '#c02828' : DARK);
  ctext(ctx, KEY.L + KEY.R + ' DIVISION   SPACE ' + (t.action || 'REFRESH') + '   B BACK',
        CX, y + 166, DARK);
}



/* Everything the fight came to: the three cards, the verdict, and what each
   man actually did over the whole bout. */
function drawFinal(ctx, jtot, verdict, winner, names, tally) {
  const x = 10, y = 10, w = VIEW_W - 20, h = 240;
  const cA = x + 250, cB = x + 330;
  px(ctx, 0, 0, VIEW_W, VIEW_H, '#0a0e18');
  drawBox(ctx, x, y, w, h);
  // nobody quits on the cards, so a forfeit does not get read off them
  const walked = verdict === 'FORFEIT';
  ctext(ctx, walked ? 'FINAL RESULT' : 'FINAL DECISION', CX, y + 5, DARK);

  if (walked) {
    ctext(ctx, 'THE FIGHT WAS NOT SCORED', CX, y + 33, '#585868');
  } else {
    jtot.forEach((sc, i) => {
      const ry = y + 22 + i * 11;
      text(ctx, 'JUDGE ' + (i + 1), x + 40, ry, DARK);
      text(ctx, String(sc[0]).padStart(3) + '  -' + String(sc[1]).padStart(3), x + 150, ry, DARK);
    });
  }

  px(ctx, x + 10, y + 70, w - 20, 1, DARK);
  ctext(ctx, verdict, CX, y + 76, DARK);
  ctext(ctx, winner, CX, y + 90, DARK);
  px(ctx, x + 10, y + 106, w - 20, 1, DARK);

  const nA = (names && names[0]) || 'RED', nB = (names && names[1]) || 'BLUE';
  text(ctx, nA, cA + 18 - textW(nA), y + 114, DARK);
  text(ctx, nB, cB + 18 - textW(nB), y + 114, DARK);
  STAT_ROWS.forEach((r, i) => {
    const ry = y + 128 + i * 13;
    text(ctx, r[0], x + 14, ry, DARK);
    text(ctx, String(r[1](tally.a)).padStart(3), cA, ry, DARK);
    text(ctx, String(r[1](tally.b)).padStart(3), cB, ry, DARK);
  });

  ctext(ctx, 'SPACE TO CARRY ON', CX, y + 226, '#585868');
}
