'use strict';

/* The standing guard, lifted straight off the reference sheet rather than
   drawn by hand: the image was sampled, averaged down to this grid and each
   cell matched to a palette slot by hue, so the shape and shading are his,
   not an impression of him.

   25 wide, 48 tall. His feet sit on the last row and his weight is centred
   on column 12.

   h hair   k skin   l skin lit   d skin shaded   e eye
   g glove  v glove shaded        w white kit
   t trunks u trunks shaded       b waistband
   o boot   . nothing                                                    */

const SPR_W = 25, SPR_H = 48, SPR_CX = 12;

const BOXER_IDLE = [
  '..........hhhhhhh........',
  '.........hhhhhhhhh.......',
  '.........hhhhhhhhh.......',
  '.........hhhhhhhhh.......',
  '.........hhdkkdddd.......',
  '.........hhkkdkkdd.......',
  '.........kdkdhkkhh.......',
  '.........dkkkdkkdd.......',
  '.........ddkkkkkk........',
  '.....kkkddddkkdddd.......',
  '....kklkkkggvddddkk.ggv..',
  '....klllkggwgvddkkkgggwv.',
  '....kllkggggggdkkkdgggggv',
  '...dkkkdggggggvkkdvgggggv',
  '...dkkkdgggggvvkkdvvggggv',
  '...kllkvggggvvdkkddvvvggv',
  '...kkdvwgggvdvdkkdddvvgvv',
  '..dkkkkgwvvdddddddddvvvv.',
  '..dkllkdddddkkkdd..dd.dd.',
  '..dkkkkddddkkdddd..ddddd.',
  '...dkdddddkkkdddd..ddddd.',
  '....ddddkdddddddd...dd...',
  '......dlbbbbbbblk........',
  '......kllbbbbbbku........',
  '.....ulttttttttttu.......',
  '.....tlttttttttttt.......',
  '.....tltttttttttttt......',
  '.....tlttttttttttttt.....',
  '....tlltttttuuutttttu....',
  '....tlttttttuuutttudd....',
  '....tlttttttuuttudkkkd...',
  '....tktttttu.uuudkklkd...',
  '.....ddddduu..uuddkklkd..',
  '.....dkkkkd......ddkkkd..',
  '.....dkkkkd.......dkkdd..',
  '....dkkkkkd.......dkkdd..',
  '...dkkkkkd.......dkkkd...',
  '...dkkddd........dkkkd...',
  '...kkkdd..........kkkd...',
  '..tlkkdd.........tttt....',
  '..wtttd...........tttt...',
  '...wtt............dwwo...',
  '.oo.oo...........ooooo...',
  '.oodo............ooooo...',
  '.oddo............oooodd..',
  'ooodoo...........oooooooo',
  'oooooo...........oooooooo',
  'oooooo...............oooo',
];

/* The fighter's own colours, keyed the way the masks are written. */
function sprPal(P) {
  return {
    h: P.hair, k: P.skin, l: P.skinLt, d: P.skinDk, e: P.out,
    g: P.glove, v: P.gloveDk, w: P.lace,
    t: P.trunk, u: P.trunkDk, b: P.belt, o: P.boot,
  };
}
