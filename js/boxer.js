'use strict';

/* A boxer lives on the ring floor at (x, z). It always turns to face its
   opponent; the player only ever *moves* it with WASD.
   Gloves are tracked as separate world-space points so a punch can be tested
   against the other boxer wherever the glove actually is. */
class Boxer {
  static newStats() {
    return { thrown: 0, landed: 0, head: 0, body: 0, blocked: 0, slipped: 0, kd: 0, dmg: 0 };
  }

  constructor(x, z, pal, label, isPlayer) {
    this.homeX = x; this.homeZ = z;
    this.pal = pal;
    this.label = label;
    this.isPlayer = !!isPlayer;
    this.gloves = { L: { x: 0, z: 0, h: 30 }, R: { x: 0, z: 0, h: 30 } };
    this.setWeight(WEIGHTS[DEFAULT_WEIGHT]);
    this.reset();
  }

  reset() {
    this.x = this.homeX; this.z = this.homeZ;
    this.vx = 0; this.vz = 0;
    this.ang = 0; this.dir = 'up';
    this.punch = null;
    this.buf = null; this.bufT = 0;
    this.blocking = false;
    this.duckAmt = 0;
    this.hurt = 0; this.hurtMax = 1;
    this.flash = 0;
    this.hitDirX = 0; this.hitDirZ = 0;
    this.headX = 0; this.headY = 0; this.leanX = 0;
    this.walkT = 0; this.bob = 0;
    this.lastPunch = '';
    this.hp = MAX_HP; this.hpShown = MAX_HP;
    this.st = MAX_ST;
    this.stCap = MAX_ST;        // the ceiling wind can come back to
    this.stLock = 0;
    this.down = false; this.downT = 0;
    this.slipAmt = 0;                 // signed: where the head is, in world units
    this.slipF = 0; this.slipCool = 0; this.slipSign = 0; this.prevSlip = 0;
    this.duckT = 0; this.duckLock = 0;
    this.slipDX = 0; this.slipDY = 0; // ...and what that looks like on screen
    this.stats = Boxer.newStats();
    this.computeGloves();
  }

  /* A boxer fights on a punch table scaled for his division. */
  setWeight(w) {
    this.weight = w;
    this.punches = makePunchTable(w);
  }

  /* world position of a point `lat` units to the boxer's own left(-)/right(+) */
  sx(lat) { return this.x - Math.sin(this.ang) * lat; }
  sz(lat) { return this.z + Math.cos(this.ang) * lat; }

  get busy() { return this.punch !== null || this.hurt > 0; }

  /* Where the head actually is. Q/E slide it sideways off the line between
     the two boxers, which is what makes a punch miss it. */
  headPoint() {
    return {
      x: this.x - Math.sin(this.ang) * this.slipAmt,
      z: this.z + Math.cos(this.ang) * this.slipAmt,
    };
  }

  phase() {
    if (!this.punch) return null;
    const d = this.punch.def, f = this.punch.f;
    if (f <= d.wind) return 'wind';
    if (f <= d.wind + d.act) return 'act';
    return 'rec';
  }

  tryPunch(name) {
    const def = this.punches[name];
    if (this.hurt > 0 || this.down || !def) return false;
    if (this.st < def.sta) {                // no wind left for this one
      if (this.isPlayer) Sfx.tired();
      return false;
    }
    if (this.punch) {
      // late in the recovery a punch can be buffered, so combos chain
      const d = this.punch.def;
      if (this.punch.f < d.wind + d.act + d.rec * 0.55) {
        this.buf = name; this.bufT = 12;
        return false;
      }
    }
    this.punch = { def, f: 0, hit: false, name };
    this.lastPunch = def.name;
    this.stats.thrown++;
    this.blocking = false;
    this.st -= def.sta;
    this.burnTank(def.sta);
    this.stLock = ST_LOCK;
    Sfx.whoosh(def.kind !== 'straight');
    return true;
  }

  takeHit(att, def, result) {
    const dx = this.x - att.x, dz = this.z - att.z;
    const m = Math.hypot(dx, dz) || 1;
    this.hitDirX = dx / m; this.hitDirZ = dz / m;

    if (result === 'block') {
      // holding a guard together costs wind, not health
      this.st = Math.max(0, this.st - def.sta * BLOCK_ST_MULT);
      this.burnTank(def.sta);
      this.stLock = Math.max(this.stLock, 12);
      this.vx += this.hitDirX * 0.7;
      this.vz += this.hitDirZ * 0.7;
      return;
    }
    const scale = result === 'graze' ? 0.55 : 1;
    this.hp = Math.max(0, this.hp - def.dmg * scale);
    this.st = Math.max(0, this.st - def.sap * scale);
    this.stLock = Math.max(this.stLock, 26);
    this.hurt = Math.round(def.stun * scale);
    this.hurtMax = this.hurt;
    this.flash = 3;
    this.punch = null; this.buf = null;
    this.vx += this.hitDirX * def.knock * scale;
    this.vz += this.hitDirZ * def.knock * scale;
  }

  burnTank(spent) {
    this.stCap = Math.max(ST_CAP_MIN, this.stCap - spent * ST_CAP_DRAIN);
  }

  goDown() {
    this.down = true; this.downT = 0;
    this.hp = 0; this.hurt = 0;
    this.punch = null; this.buf = null;
    this.blocking = false; this.duckAmt = 0;
    this.vx *= 1.6; this.vz *= 1.6;
  }

  getUp(hp) {
    this.down = false; this.downT = 0;
    this.hp = hp;
    this.st = Math.max(this.st, 55);
    this.hurt = 26; this.hurtMax = 26;   // still on unsteady legs
    this.slipAmt = 0;
    this.vx = 0; this.vz = 0;
  }

  /* intent: { mx, mz, block, duck, slip, punch } */
  update(intent, opp, game) {
    this.hpShown = lerp(this.hpShown, this.hp, 0.12);   // bars drain, they don't jump

    if (this.down) {                       // flat on the canvas: just slide to a stop
      this.downT++;
      this.x += this.vx; this.z += this.vz;
      this.vx *= 0.86; this.vz *= 0.86;
      const lx = RING_HX - PAD_X, lz = RING_HZ - PAD_Z;
      this.x = clamp(this.x, -lx, lx); this.z = clamp(this.z, -lz, lz);
      if (this.flash > 0) this.flash--;
      this.slipAmt = 0; this.slipDX = 0; this.slipDY = 0;
      return;
    }

    // ---- always turn towards the opponent -------------------------------
    const dx = opp.x - this.x, dz = opp.z - this.z;
    this.ang = Math.atan2(dz, dx);
    // which way he is facing is a fact about the ring, not about the camera
    const adx = Math.abs(dx), adz = Math.abs(dz);
    this.dir = adz > adx * 1.1 ? (dz > 0 ? 'down' : 'up')
                               : (dx > 0 ? 'right' : 'left');

    if (this.flash > 0) this.flash--;
    if (this.bufT > 0 && --this.bufT === 0) this.buf = null;

    const x0 = this.x, z0 = this.z;
    let moving = false;

    if (this.hurt > 0) {
      // ---- stunned: remember what was pressed, throw it on recovery --------
      if (intent.punch) { this.buf = intent.punch; this.bufT = 16; }
      this.hurt--;
      this.blocking = false;
      this.duckAmt = lerp(this.duckAmt, 0, 0.35);
      this.slipAmt = lerp(this.slipAmt, 0, 0.3);
      this.slipF = 0; this.prevSlip = 0;
      const k = this.hurt / this.hurtMax;
      const wob = Math.sin(this.hurt * 0.9) * k;
      this.headX = this.hitDirX * 3.2 * k + wob * 1.2;
      this.headY = -k * 1.5;
      this.leanX = this.hitDirX * 2.2 * k;
    } else {
      this.headX = lerp(this.headX, 0, 0.3);
      this.headY = lerp(this.headY, 0, 0.3);
      this.leanX = lerp(this.leanX, 0, 0.3);

      // ---- stance --------------------------------------------------------
      // ---- head movement (Q / E) -----------------------------------------
      // The head slides perpendicular to the opponent, so a slip always takes
      // it off the punch line. The sign is chosen so the head goes the way the
      // key says on screen, whichever direction the boxer happens to face.
      // It fires on the press and runs its course: you cannot sit in a slip.
      if (this.slipCool > 0) this.slipCool--;
      if (this.slipF > 0) {
        this.slipF--;
        if (this.slipF === 0) this.slipCool = SLIP_COOL;
      } else if (intent.slip && !this.prevSlip && this.slipCool <= 0 && this.st >= ST_SLIP) {
        const sxUnit = -Math.sin(this.ang);
        this.slipSign = Math.abs(sxUnit) < 0.25 ? intent.slip
                                                : intent.slip * Math.sign(sxUnit);
        this.slipF = SLIP_TOTAL;
        this.st -= ST_SLIP;
        this.stLock = Math.max(this.stLock, 10);
      }
      this.prevSlip = intent.slip;

      let amt = 0;
      if (this.slipF > 0) {
        const el = SLIP_TOTAL - this.slipF;
        amt = el < SLIP_OUT ? el / SLIP_OUT
            : el < SLIP_OUT + SLIP_HOLD ? 1
            : 1 - (el - SLIP_OUT - SLIP_HOLD) / SLIP_BACK;
      }
      this.slipAmt = this.slipSign * SLIP_MAX * clamp(amt, 0, 1);

      // ---- crouching (DOWN) ------------------------------------------------
      if (this.duckLock > 0) this.duckLock--;
      const wantDuck = intent.duck && this.duckLock <= 0 &&
                       !(this.punch && this.punch.def.level === 'rise');
      let duckTo = 0;
      if (wantDuck) {
        this.duckT++;
        // past the first stretch his legs are going and the crouch rises with
        // them, until punches start finding him
        const spent = clamp((this.duckT - DUCK_FULL) / (DUCK_MAX - DUCK_FULL), 0, 1);
        duckTo = 1 - (1 - DUCK_LOW) * spent;
        if (this.duckT >= DUCK_MAX) { this.duckLock = DUCK_REST; this.duckT = 0; }
      } else if (this.duckAmt < 0.25) {
        this.duckT = 0;
      }
      this.duckAmt = lerp(this.duckAmt, duckTo, 0.34);
      this.blocking = intent.block && !this.punch;

      if (intent.punch) this.tryPunch(intent.punch);
      else if (this.buf && !this.punch) { const n = this.buf; this.buf = null; this.tryPunch(n); }

      // ---- move ----------------------------------------------------------
      let sp = WALK_SPEED * this.weight.foot;   // lighter men move their feet quicker
      if (this.st < ST_LOW) sp *= 0.75;      // gassed: the legs go
      if (this.blocking) sp = BLOCK_SPEED;
      if (this.duckAmt > 0.5) sp = Math.min(sp, DUCK_SPEED);
      const ph = this.phase();
      if (ph === 'wind') sp *= 0.4;
      else if (ph === 'act') sp *= 0.12;
      else if (ph === 'rec') sp *= 0.5;

      let mx = intent.mx, mz = intent.mz;
      const m = Math.hypot(mx, mz);
      if (m > 0.01) {
        mx /= m; mz /= m;
        this.x += mx * sp;
        this.z += mz * sp;
        moving = sp > 0.3;
      }
      // small step into a punch
      if (ph === 'wind') {
        const d = Math.hypot(dx, dz);
        if (d > 24) { this.x += Math.cos(this.ang) * 0.45; this.z += Math.sin(this.ang) * 0.45; }
      }
    }

    // ---- knockback / drift -------------------------------------------------
    this.x += this.vx; this.z += this.vz;
    this.vx *= 0.84; this.vz *= 0.84;
    if (Math.abs(this.vx) < 0.01) this.vx = 0;
    if (Math.abs(this.vz) < 0.01) this.vz = 0;

    // ---- ring bounds -------------------------------------------------------
    const lx = RING_HX - PAD_X, lz = RING_HZ - PAD_Z;
    if (this.x < -lx) { this.x = -lx; this.vx *= -0.35; }
    if (this.x >  lx) { this.x =  lx; this.vx *= -0.35; }
    if (this.z < -lz) { this.z = -lz; this.vz *= -0.35; }
    if (this.z >  lz) { this.z =  lz; this.vz *= -0.35; }

    // ---- wind ---------------------------------------------------------------
    // Footwork is free - it only breathes slower than standing still does.
    const walked = moving && Math.hypot(this.x - x0, this.z - z0) > 0.25;
    if (this.stLock > 0) this.stLock--;
    const slipping = this.slipF > 0;
    const crouched = this.duckAmt > 0.5;
    if (crouched) this.st -= ST_DUCK;
    if (this.stLock <= 0 && !this.punch && this.hurt <= 0) {
      this.st += this.blocking ? ST_REGEN_BLOCK
               : (walked || slipping || crouched ? ST_REGEN_MOVE : ST_REGEN);
    }
    this.st = clamp(this.st, 0, this.stCap);

    // ---- walk bob ----------------------------------------------------------
    if (walked) {
      this.walkT += 0.24;
      const b = Math.sin(this.walkT) > 0.35 ? 1 : 0;
      if (b && !this.bob && game && game.nearCam(this)) Sfx.step();
      this.bob = b;
    } else {
      this.walkT = 0; this.bob = 0;
    }

    // ---- advance the punch, reporting the frames that can connect ----------
    if (this.punch) {
      this.punch.f++;
      const d = this.punch.def;
      if (this.punch.f > d.wind + d.act + d.rec) {
        this.punch = null;
        if (this.buf) { const n = this.buf; this.buf = null; this.tryPunch(n); }
      }
    }

    this.slipDX = -Math.sin(this.ang) * this.slipAmt;
    this.slipDY = Math.cos(this.ang) * this.slipAmt * PERSP;

    this.computeGloves();

    if (this.punch && this.phase() === 'act' && !this.punch.hit && game) {
      game.resolvePunch(this, opp);
    }
  }

  /* where each glove is, in world space, for this frame.
     The lead (left) hand sits further forward than the rear (right) hand, so
     the two gloves stay readable when the boxer is seen in profile. */
  poseHand(hand) {
    const sign = hand === 'L' ? -1 : 1;
    const baseF = hand === 'L' ? 9 : 3;
    const baseH = hand === 'L' ? 30 : 33;   // hands by the chin
    const g = { fwd: baseF, lat: sign * 5, hgt: baseH };

    if (this.blocking) { g.fwd = hand === 'L' ? 9 : 7; g.lat = sign * 4; g.hgt = 35; }
    if (this.hurt > 0) { g.fwd = 2; g.lat = sign * 8; g.hgt = 29; }

    const p = this.punch;
    if (p && p.def.hand === hand && this.hurt <= 0) {
      const d = p.def, f = p.f;
      let ph, t;
      if (f <= d.wind) { ph = 0; t = clamp(f / d.wind, 0, 1); }
      else if (f <= d.wind + d.act) { ph = 1; t = clamp((f - d.wind) / d.act, 0, 1); }
      else { ph = 2; t = clamp((f - d.wind - d.act) / d.rec, 0, 1); }

      if (d.kind === 'straight') {
        const bh = d.level === 'body' ? 22 : 36;   // 36 = opponent's jaw
        if (ph === 0)      { g.fwd = lerp(baseF, -4, easeOut(t)); g.lat = sign * lerp(5, 7, t);              g.hgt = lerp(baseH, bh, t); }
        else if (ph === 1) { g.fwd = lerp(-4, d.reach, easeOut(t)); g.lat = sign * lerp(7, 2, easeOut(t));   g.hgt = bh; }
        else               { g.fwd = lerp(d.reach, baseF, easeIn(t)); g.lat = sign * lerp(2, 5, t);          g.hgt = lerp(bh, baseH, t); }
      } else if (d.kind === 'hook') {
        if (ph === 0)      { g.fwd = lerp(baseF, 2, t);  g.lat = sign * lerp(5, 15, easeOut(t)); g.hgt = lerp(baseH, 34, t); }
        else if (ph === 1) { g.fwd = lerp(2, d.reach, Math.sin(t * Math.PI * 0.7)); g.lat = sign * lerp(15, -5, easeOut(t)); g.hgt = 36; }
        else               { g.fwd = lerp(d.reach * 0.8, baseF, t); g.lat = sign * lerp(-5, 5, t); g.hgt = lerp(36, baseH, t); }
      } else { // uppercut: drops to the hip, then rips upward
        if (ph === 0)      { g.fwd = lerp(baseF, -3, t); g.lat = sign * lerp(5, 8, t); g.hgt = lerp(baseH, 12, easeOut(t)); }
        else if (ph === 1) { g.fwd = lerp(-3, d.reach, easeOut(t)); g.lat = sign * lerp(8, 3, t); g.hgt = lerp(12, 41, easeOut(t)); }
        else               { g.fwd = lerp(d.reach, baseF, easeIn(t)); g.lat = sign * lerp(3, 5, t); g.hgt = lerp(41, baseH, t); }
      }
    }

    g.hgt -= this.duckAmt * 8;
    return g;
  }

  computeGloves() {
    const ca = Math.cos(this.ang), sa = Math.sin(this.ang);
    for (const hand of ['L', 'R']) {
      const p = this.poseHand(hand);
      // sideways offsets are squashed: in this camera a big lateral offset
      // would read as the glove floating above the boxer's head
      const lat = p.lat * 0.68;
      const g = this.gloves[hand];
      g.x = this.x + ca * p.fwd - sa * lat;
      g.z = this.z + sa * p.fwd + ca * lat;
      g.h = p.hgt;
      g.fwd = p.fwd;
    }
  }
}
