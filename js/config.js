'use strict';

/* ---- screen ---- */
const VIEW_W = 400, VIEW_H = 260;
const CX = VIEW_W / 2, CY = 130;   // ring centre in screen pixels
const PERSP = 0.46;            // how much depth is squashed by the camera angle
const PANEL_Y = VIEW_H - 54;   // top of the bottom info box

/* ---- ring (world units; x = across, z = depth) ----
   A boxing ring is square, so these two are equal. It still draws wider than
   it is tall because we are looking at it from ringside, not from above. */
const RING_HX = 130, RING_HZ = 130;
const PAD_X = 14, PAD_Z = 14;  // how far inside the ropes a boxer may stand
const FLOOR_TOP = CY - RING_HZ * PERSP;
const FLOOR_BOT = CY + RING_HZ * PERSP;
const APRON_H = 12;

/* ---- boxers ---- */
const MIN_SEP = 20;            // boxers cannot stand closer than this
const WALK_SPEED = 1.15;
const BLOCK_SPEED = 0.55;
const DUCK_SPEED = 0.42;
const GLOVE_HIT_R = 11;        // glove radius used against the body
const HEAD_HIT_R = 9.5;        // ...and against the head, which can be moved
const HOOK_HEAD_R = 14;        // a hook comes around head movement
const SLIP_MAX = 11;           // how far Q/E take the head off the punch line
/* A slip is a timed move, not a stance: it cannot be held, so it has to be
   timed against the punch. 6 frames out, 9 held, 9 back, then a cooldown. */
const SLIP_OUT = 6, SLIP_HOLD = 9, SLIP_BACK = 9;
const SLIP_TOTAL = SLIP_OUT + SLIP_HOLD + SLIP_BACK;
const SLIP_COOL = 8;

/* ---- condition ---- */
const MAX_HP = 300;
const MAX_ST = 100;
const ST_REGEN = 0.30;         // standing still and breathing
const ST_REGEN_MOVE = 0.05;    // moving around is free, but you get no air back
const ST_REGEN_BLOCK = 0.07;   // barely recovering behind a guard
const GUARD_CATCH = 0.45;      // chance the guard also catches a body shot or uppercut
const BLOCK_ST_MULT = 1.4;     // stamina a blocked punch costs, x what it cost to throw

/* The tank shrinks. Every punch thrown and every punch caught on the gloves
   lowers the ceiling stamina can recover to, so a boxer who throws at
   everything has less and less to draw on as the fight goes on. */
const ST_CAP_MIN = 45;         // it never falls below this
const ST_CAP_DRAIN = 0.04;     // ceiling lost per point of stamina spent
const ST_CAP_ROUND = 20;       // what the corner gets back between rounds
const ST_LOW = 25;             // below this the legs get heavy
const ST_LOCK = 20;            // frames before wind starts coming back
const ST_SLIP = 3;             // what one slip costs
/* A crouch cannot be lived in. Hold it and his legs tire: the crouch rises
   over the last stretch until punches start clipping him, then he is forced
   upright and has to stand a moment before he can go down again. */
const DUCK_MAX = 120;          // two seconds is all his legs have
const DUCK_FADE = 40;          // ...and he is visibly rising for the last third
const DUCK_REST = 45;          // stood up this long before he may duck again
const ST_DUCK = 0.08;          // holding a crouch is work

/* ---- the bout ---- */
const ROUNDS = 3;
const ROUND_FRAMES = 120 * 60;  // two minutes a round
const REST_FRAMES = 12 * 60;    // the scorecard between rounds
const REST_SKIP_AFTER = 45;     // ...skippable with SPACE after this long
const COUNT_STEP = 26;          // frames per number of the count
const COUNT_TO = 8;
const KD_RECOVER_HP = 140;      // health you get up with
const ROUND_RECOVER_HP = 130;   // what the corner puts back between rounds
const TKO_KD = 3;               // knockdowns in one round that end it

/* ---- punches -------------------------------------------------------------
   hand  : which glove throws it
   kind  : straight | hook | upper       (shape of the animation)
   level : head | body | rise            (what a guard / a duck does to it)
   wind/act/rec : animation + hit window, in frames @60fps
   reach : how far the glove travels out from the chest, in world units
   dmg   : health taken on a clean hit
   sta   : stamina it costs to throw
   sap   : stamina taken off whoever eats it (body shots drain the most)
   stun  : frames the victim is stunned for
   knock : knockback impulse
   shake : screen shake on a clean hit

   The jab is the fastest and lightest. The cross is slow and heavy; both
   hooks are tuned to match the cross exactly. Uppercuts hit hardest and cost
   the most, but have to be thrown from close range.
--------------------------------------------------------------------------- */
const KEY = { L: '←', R: '→', U: '↑', D: '↓' };
const POWER_SCALE = 1.25;      // global lift on every punch, all classes

const PUNCHES = {
  jab:        { hand:'L', kind:'straight', level:'head', wind:2, act:4, rec:5,  reach:29, dmg:3,  sta:4,  sap:2,  stun:8,  knock:1.0, shake:1.8, name:'JAB',     key:KEY.L },
  cross:      { hand:'R', kind:'straight', level:'head', wind:7, act:6, rec:14, reach:34, dmg:9,  sta:10, sap:5,  stun:18, knock:2.6, shake:4.2, name:'CROSS',   key:KEY.R },
  leftHook:   { hand:'L', kind:'hook',     level:'head', wind:7, act:6, rec:14, reach:27, dmg:9,  sta:10, sap:5,  stun:18, knock:2.6, shake:4.2, name:'L HOOK',  key:'S+' + KEY.L },
  rightHook:  { hand:'R', kind:'hook',     level:'head', wind:7, act:6, rec:14, reach:27, dmg:9,  sta:10, sap:5,  stun:18, knock:2.6, shake:4.2, name:'R HOOK',  key:'S+' + KEY.R },
  leftUpper:  { hand:'L', kind:'upper',    level:'rise', wind:8, act:7, rec:16, reach:18, dmg:12, sta:13, sap:6,  stun:22, knock:2.9, shake:4.8, name:'L UPPER', key:KEY.U + KEY.L },
  rightUpper: { hand:'R', kind:'upper',    level:'rise', wind:8, act:7, rec:16, reach:18, dmg:12, sta:13, sap:6,  stun:22, knock:2.9, shake:4.8, name:'R UPPER', key:KEY.U + KEY.R },
  leftBody:   { hand:'L', kind:'straight', level:'body', wind:3, act:5, rec:7,  reach:28, dmg:4,  sta:6,  sap:9,  stun:10, knock:1.2, shake:2.0, name:'L BODY',  key:KEY.D + KEY.L },
  rightBody:  { hand:'R', kind:'straight', level:'body', wind:6, act:6, rec:12, reach:30, dmg:7,  sta:9,  sap:14, stun:15, knock:1.9, shake:3.2, name:'R BODY',  key:KEY.D + KEY.R },
};

/* The 1-5 ratings shown in the in-game guide are derived from the numbers
   above, so the guide can never drift away from how the punch behaves. */
for (const k in PUNCHES) {
  const p = PUNCHES[k];
  const t = p.wind + p.act + p.rec;
  p.spd  = t <= 12 ? 5 : t <= 16 ? 4 : t <= 22 ? 3 : t <= 28 ? 2 : 1;
  p.pwr  = p.dmg <= 3 ? 1 : p.dmg <= 5 ? 2 : p.dmg <= 7 ? 3 : p.dmg <= 9 ? 4 : 5;
  p.cost = p.sta <= 4 ? 1 : p.sta <= 6 ? 2 : p.sta <= 9 ? 3 : p.sta <= 11 ? 4 : 5;
}

/* ---- weight classes ------------------------------------------------------
   Welterweight is the baseline the punch table above is written for. Going
   down the scale trades power for hand speed; going up does the reverse.
   The differences are deliberately small - a class either side feels a step
   quicker or a step heavier, not like a different game.
--------------------------------------------------------------------------- */
const WEIGHTS = [
  { name: 'FEATHERWEIGHT',     short: 'FEATHER', lb: 145, kg: 66,  spd: 1.14, pwr: 0.86 },
  { name: 'LIGHTWEIGHT',       short: 'LIGHT',   lb: 155, kg: 70,  spd: 1.07, pwr: 0.93 },
  { name: 'WELTERWEIGHT',      short: 'WELTER',  lb: 170, kg: 77,  spd: 1.00, pwr: 1.00 },
  { name: 'MIDDLEWEIGHT',      short: 'MIDDLE',  lb: 185, kg: 84,  spd: 0.95, pwr: 1.08 },
  { name: 'LIGHT HEAVYWEIGHT', short: 'L-HEAVY', lb: 205, kg: 93,  spd: 0.90, pwr: 1.16 },
  { name: 'HEAVYWEIGHT',       short: 'HEAVY',   lb: 265, kg: 120, spd: 0.84, pwr: 1.28 },
];
const WEIGHT_BARS = WEIGHTS.length;
WEIGHTS.forEach((w, i) => {
  w.i = i;
  w.spdBar = WEIGHTS.length - i;      // the bars in the guide come straight
  w.pwrBar = i + 1;                   // from the order of the multipliers
  w.foot = 1 + (w.spd - 1) * 0.6;     // footwork moves less than the hands do
});
const DEFAULT_WEIGHT = 2;             // welterweight

/* Every fight runs on a copy of the punch table scaled for the class:
   fewer frames and less damage down the scale, more of both going up. */
function makePunchTable(w) {
  const t = {};
  for (const k in PUNCHES) {
    const p = PUNCHES[k];
    t[k] = Object.assign({}, p, {
      wind:  Math.max(1, Math.round(p.wind / w.spd)),
      act:   Math.max(2, Math.round(p.act / w.spd)),
      rec:   Math.max(2, Math.round(p.rec / w.spd)),
      dmg:   p.dmg * w.pwr * POWER_SCALE,
      knock: p.knock * w.pwr * POWER_SCALE,
      stun:  Math.round(p.stun * (1 + (w.pwr - 1) * 0.5)),
      shake: p.shake * (0.85 + 0.15 * w.pwr),
    });
  }
  return t;
}

// the order the guide lists them in, two columns of four
const GUIDE_COLS = [
  ['jab', 'cross', 'leftHook', 'rightHook'],
  ['leftUpper', 'rightUpper', 'leftBody', 'rightBody'],
];

/* ---- fighter looks -------------------------------------------------------
   Skin tone and hair are picked when a fighter is created and locked after.
   Shorts are the one thing that can be changed later. --------------------- */
const SKINS = [
  { skin:'#f8d4a8', skinDk:'#c89058', skinLt:'#ffecd0', hair:'#7a4a1e', hairLt:'#9a6a38' },
  { skin:'#f8c088', skinDk:'#c07840', skinLt:'#ffe0b8', hair:'#402018', hairLt:'#603028' },
  { skin:'#dc9c62', skinDk:'#a46c34', skinLt:'#f4bc88', hair:'#2a1a14', hairLt:'#4a3228' },
  { skin:'#b47c46', skinDk:'#7c4c1c', skinLt:'#d49c64', hair:'#201010', hairLt:'#382020' },
  { skin:'#8a5834', skinDk:'#56341a', skinLt:'#aa7048', hair:'#181010', hairLt:'#302020' },
  { skin:'#5e3c24', skinDk:'#382214', skinLt:'#7c5434', hair:'#120a0a', hairLt:'#281818' },
];

const SHORTS = [
  { name:'RED',    trunk:'#e03030', trunkDk:'#901010', belt:'#f8f8f8', glove:'#e83828', gloveDk:'#901818', boot:'#f8f8f8', bootDk:'#9098a8' },
  { name:'BLUE',   trunk:'#3868d8', trunkDk:'#203890', belt:'#f8f8f8', glove:'#3868d8', gloveDk:'#1c3078', boot:'#f8f8f8', bootDk:'#9098a8' },
  { name:'GREEN',  trunk:'#2f9c46', trunkDk:'#146028', belt:'#f8f8f8', glove:'#2f9c46', gloveDk:'#0e4a1e', boot:'#f8f8f8', bootDk:'#9098a8' },
  { name:'GOLD',   trunk:'#e8b022', trunkDk:'#96680c', belt:'#3a2a10', glove:'#e8b022', gloveDk:'#8a5c08', boot:'#3a2a10', bootDk:'#1a1208' },
  { name:'PURPLE', trunk:'#8a44c8', trunkDk:'#521c86', belt:'#f0d840', glove:'#8a44c8', gloveDk:'#421470', boot:'#f8f8f8', bootDk:'#9098a8' },
  { name:'BLACK',  trunk:'#2a2c3a', trunkDk:'#111220', belt:'#e8b022', glove:'#2a2c3a', gloveDk:'#0c0d16', boot:'#2a2c3a', bootDk:'#0c0d16' },
  { name:'WHITE',  trunk:'#eef0f8', trunkDk:'#a8aec4', belt:'#c02828', glove:'#eef0f8', gloveDk:'#9aa0b8', boot:'#eef0f8', bootDk:'#8a90a8' },
  { name:'ORANGE', trunk:'#f07818', trunkDk:'#9c4404', belt:'#f8f8f8', glove:'#f07818', gloveDk:'#8c3c04', boot:'#f8f8f8', bootDk:'#9098a8' },
  { name:'PINK',   trunk:'#f060a8', trunkDk:'#a02864', belt:'#f8f8f8', glove:'#f060a8', gloveDk:'#94205c', boot:'#f8f8f8', bootDk:'#9098a8' },
  { name:'TEAL',   trunk:'#20a8a8', trunkDk:'#0a6868', belt:'#f8f8f8', glove:'#20a8a8', gloveDk:'#085656', boot:'#f8f8f8', bootDk:'#9098a8' },
];

const COUNTRIES = [
  'AUS','USA','GBR','IRL','MEX','PHI','JPN','KOR','CHN','IND',
  'PAK','RUS','UKR','KAZ','CUB','BRA','ARG','COL','FRA','GER',
  'ITA','ESP','NED','POL','RSA','NGA','GHA','CAN','NZL','THA',
];

// build a sprite palette for a saved fighter
function palFor(f) {
  const sk = SKINS[f.skin] || SKINS[1];
  const sh = SHORTS[f.shorts] || SHORTS[0];
  return {
    skin: sk.skin, skinDk: sk.skinDk, skinLt: sk.skinLt,
    hair: sk.hair, hairLt: sk.hairLt,
    trunk: sh.trunk, trunkDk: sh.trunkDk, belt: sh.belt,
    glove: sh.glove, gloveDk: sh.gloveDk,
    boot: sh.boot, bootDk: sh.bootDk,
    out: '#181820',
  };
}

const NAME_MAX = 10;
const USER_MIN = 3, USER_MAX = 16;      // a player's login name
const USER_DOMAIN = '@retrobox.local';  // made up, never emailed
const FIGHTER_SLOTS = 3;

/* ---- palettes (Game Boy Color-ish) ---- */
const PAL_PLAYER = {
  skin:'#f8c088', skinDk:'#c07840', hair:'#402018', hairLt:'#603028',
  trunk:'#3868d8', trunkDk:'#203890', belt:'#f8f8f8',
  glove:'#e83828', gloveDk:'#901818', boot:'#f8f8f8', bootDk:'#9098a8',
  skinLt:'#ffe0b8', out:'#181820',
};
const PAL_BOT = {
  skin:'#c08048', skinDk:'#805020', hair:'#181018', hairLt:'#382838',
  trunk:'#e03030', trunkDk:'#901010', belt:'#f8d030',
  glove:'#303848', gloveDk:'#101018', boot:'#303848', bootDk:'#101018',
  skinLt:'#e8a870', out:'#181820',
};
const PAL_FLASH = {
  skin:'#f8f8f8', skinDk:'#c8c8d0', hair:'#f8f8f8', hairLt:'#f8f8f8',
  trunk:'#f8f8f8', trunkDk:'#c8c8d0', belt:'#f8f8f8',
  glove:'#f8f8f8', gloveDk:'#c8c8d0', boot:'#f8f8f8', bootDk:'#c8c8d0',
  skinLt:'#f8f8f8', out:'#606070',
};

/* ---- tiny helpers ---- */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp  = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeIn  = t => t * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const screenY = z => CY + z * PERSP;
