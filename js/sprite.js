'use strict';

/* The fighter, taken off the reference sheet.
   ------------------------------------------------------------------
   The image was sampled rather than copied by eye: each cell is the
   average of the pixels under it, matched to a palette slot by hue. His
   head, trunks, legs and boots are that sampling more or less untouched.

   His arms are not here. In the reference they are frozen in a guard,
   but in the game the gloves are live - they carry the punches and the
   hit detection - so the arms are drawn between the shoulder and the
   glove every frame instead. The chest the gloves were covering had to
   be filled back in.

   25 wide, 48 tall, feet on the last row, weight centred on column 12.

   h hair  k skin  l skin lit  d skin shaded  e eye
   g glove v glove shaded      w white kit
   t trunks u trunks shaded    b waistband   o boot   . nothing        */

const SPR_W = 25, SPR_H = 48, SPR_CX = 12;
const SPR_HEAD = 10;         // rows 0-9 are head and neck
const SPR_HIP  = 22;         // rows 22 down are trunks and legs
const SPR_SHOULDER = 38;     // how high the shoulders sit off the canvas

const BOXER = [
  '..........hhhhhhh........',   //  0  hair
  '.........hhhhhhhhh.......',   //  1
  '.........hhhhhhhhh.......',   //  2
  '.........hhhhhhhhh.......',   //  3
  '.........hhkkkkkhh.......',   //  4  fringe, forehead
  '.........hkkkkkkkd.......',   //  5
  '.........hkeekeekd.......',   //  6  eyes
  '.........dkkkkkkkd.......',   //  7
  '.........ddkeeekdd.......',   //  8  mouth
  '..........dkkkkd.........',   //  9  neck
  '.......kkkkkkkkkkk.......',   // 10  shoulders
  '......kkllkkkkkkkkd......',   // 11  deltoids
  '......kllkkkkkkkkkd......',   // 12
  '......klkkddkkddkkd......',   // 13  pecs
  '......kkkkddkkddkkd......',   // 14
  '......kkkkkkddkkkkd......',   // 15
  '.......kkkdkkdkkkd.......',   // 16  abs
  '.......kkkdkkdkkkd.......',   // 17
  '.......kkkdkkdkkkd.......',   // 18
  '........kkdkkdkkd........',   // 19
  '........kkkkkkkkd........',   // 20
  '.........kkkkkkd.........',   // 21
  '......dlbbbbbbblk........',   // 22  waistband
  '......kllbbbbbbku........',   // 23
  '.....ulttttttttttu.......',   // 24  trunks
  '.....tlttttttttttt.......',   // 25
  '.....tltttttttttttt......',   // 26
  '.....tlttttttttttttt.....',   // 27
  '....tlltttttuuutttttu....',   // 28
  '....tlttttttuuutttudd....',   // 29
  '....tlttttttuuttudkkkd...',   // 30
  '....tktttttu.uuudkklkd...',   // 31
  '.....ddddduu..uuddkklkd..',   // 32
  '.....dkkkkd......ddkkkd..',   // 33  legs
  '.....dkkkkd.......dkkdd..',   // 34
  '....dkkkkkd.......dkkdd..',   // 35
  '...dkkkkkd.......dkkkd...',   // 36
  '...dkkddd........dkkkd...',   // 37
  '...kkkdd..........kkkd...',   // 38
  '...wwwww.........wwwww...',   // 39  socks
  '...ttttt.........ttttt...',   // 40
  '...wwwww.........wwwww...',   // 41
  '...wwwww.........wwwww...',   // 42
  '..ooooooo.......ooooooo..',   // 43  boots
  '..owwwwoo.......oowwwwo..',   // 44
  '..ooooooo.......ooooooo..',   // 45
  '.ooooooooo.....ooooooooo.',   // 46
  '.ooooooooo.....ooooooooo.',   // 47
];

/* The mitt: rounded, a white streak off the top corner, cuff at the wrist. */
const GLOVE = [
  '..ggg..',
  '.ggggg.',
  'gwwgggv',
  'gwggggv',
  'ggggggv',
  'gggggvv',
  '.vvvvv.',
  '.wwwww.',
];
const GLOVE_W = 7, GLOVE_H = 8;

/* Footwork. The back foot drags and the front foot steps, so the stance
   opens and closes rather than the whole man sliding about. */
const STEP_ROWS = {
  0: null,                                    // planted
  1: ['...wwwww.........wwwww...',
      '...ttttt.........ttttt...',
      '...wwwww.........wwwww...',
      '...wwwww.........wwwww...',
      '...ooooooo.....ooooooo...',
      '...owwwwoo.....oowwwwo...',
      '...ooooooo.....ooooooo...',
      '..ooooooooo...ooooooooo..',
      '..ooooooooo...ooooooooo..'],
  2: ['..wwwww...........wwwww..',
      '..ttttt...........ttttt..',
      '..wwwww...........wwwww..',
      '..wwwww...........wwwww..',
      '.ooooooo.........ooooooo.',
      '.owwwwoo.........oowwwwo.',
      '.ooooooo.........ooooooo.',
      'ooooooooo.......ooooooooo',
      'ooooooooo.......ooooooooo'],
};

function sprPal(P) {
  return {
    h: P.hair, k: P.skin, l: P.skinLt, d: P.skinDk, e: P.out,
    g: P.glove, v: P.gloveDk, w: P.lace,
    t: P.trunk, u: P.trunkDk, b: P.belt, o: P.boot,
  };
}
