# RETRO BOXING

A Game Boy Color-styled boxing game. Two boxers in a ring, everything rendered
on a 400x260 pixel buffer, scaled up with nearest-neighbour so it stays
crunchy. The canvas fills the window in half-steps, which land on whole device
pixels on a 2x display.

The ring itself is square — 260 by 260 in world units — and draws about 2.2:1
because we are looking at it from ringside rather than from above.

## Run it

```bash
python3 -m http.server 8123
```

Then open <http://localhost:8123>. (Opening `index.html` directly also works.)

## Menu

The game opens on a menu over the ring:

| Item | |
| --- | --- |
| **TRAINING FIGHT** | pick a division, then a three-round bout against the AI |
| **MY FIGHTERS** | three slots — create, dress and retire your fighters |
| **MULTIPLAYER** | leaderboards, fight rooms, event cards *(needs a backend)* |
| **GUIDE** | three pages: weight classes, punches, defence |
| **SOUND** | on / off |

## Fighters

Three slots per player. Creating one sets his **name, division, skin tone and
country** — and those are fixed for life. To change any of them you retire him
and make another. **Shorts are the only thing you can change afterwards.**

Each fighter carries his own record: wins-losses-draws, win percentage, KOs
for and against, and a separate training record so sparring never pollutes the
figures a leaderboard would rank you on. If you have a fighter in the division
you pick for a training fight, he is the one who walks out — his shorts, his
skin, his name on the meter — and the result lands on his training record.

Fighters live in browser storage for now. `js/profile.js` is the only file
that touches storage, so moving them to accounts on a server means changing
`load` and `save` and nothing else.

`W`/`S` move, `Space` selects, `B` or `Escape` backs out. In a fight `Escape`
returns to the menu and `R` restarts the bout.

## Weight classes

Six divisions. Welterweight is the baseline the punch table is written for;
lighter men are quicker and hit lighter, heavier men are slower and hit
harder. The steps are small on purpose — one class either side should feel
like a step quicker or a step heavier, not like a different game.

| Division | lb | kg | Speed | Power |
| --- | --- | --- | --- | --- |
| Featherweight | 145 | 66 | ▮▮▮▮▮▮ | ▮ |
| Lightweight | 155 | 70 | ▮▮▮▮▮ | ▮▮ |
| **Welterweight** | 170 | 77 | ▮▮▮▮ | ▮▮▮ |
| Middleweight | 185 | 84 | ▮▮▮ | ▮▮▮▮ |
| Light heavyweight | 205 | 93 | ▮▮ | ▮▮▮▮▮ |
| Heavyweight | 265 | 120 | ▮ | ▮▮▮▮▮▮ |

Speed shortens every punch's windup, active and recovery frames and quickens
the footwork a little; power raises damage, knockback, stun and screen shake.
Throwing the same ten-punch sequence in each division:

| | Featherweight | Welterweight | Heavyweight |
| --- | --- | --- | --- |
| time | 4.32s | 4.80s | 5.48s |
| damage | 63 | 73 | 93 |

Both boxers fight in the division you pick, so the matchup stays even. The
in-game guide (menu → GUIDE) shows the same table with speed and power bars.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | move around the ring |
| `←` | jab (lead hand) |
| `→` | cross (rear hand) |
| `↑` + `←` / `→` | left / right uppercut |
| `Shift` + `←` / `→` | left / right hook |
| `↓` | duck |
| `↓` + `←` / `→` | left / right body shot |
| `Space` | guard — hands up |
| `Q` / `E` | slip the head left / right |
| `H` cycles controls → punch guide → off · `M` sound · `P` pause |
| `R` restart the bout · `Escape` back to the menu |

The modifier is read from whatever is **already held** when the left/right
arrow goes down, so hold `↓` *then* tap `←` for a body shot.

You never steer the boxer's facing: he always turns towards the opponent on
his own. WASD only slides him around the canvas, so `A`/`D` circle the
opponent rather than turning away from him.

## The punches

Press `H` twice in game for this table with SPD / PWR / STA bars. The ratings
there are derived from the numbers below, so the guide can't drift out of
sync with how a punch actually behaves.

| Punch | Frames | Reach | Damage | Stamina | Drains their stamina |
| --- | --- | --- | --- | --- | --- |
| jab | 11 | 29 | 3.8 | 4 | 2 |
| cross | 27 | 34 | 11.3 | 10 | 5 |
| left / right hook | 27 | 27 | 11.3 | 10 | 5 |
| left / right uppercut | 31 | **18** | 15.0 | 13 | 6 |
| left body | 15 | 28 | 5.0 | 6 | **9** |
| right body | 24 | 30 | 8.8 | 9 | **14** |

Damage is shown at welterweight. `PUNCHES` in `js/config.js` holds the base
figures; every fight multiplies them by the division's power rating and by a
global `POWER_SCALE`, so the whole card can be made heavier or lighter with
one number without disturbing how the punches compare to each other.

The jab is the quick, cheap range-finder. The cross is slow and heavy, and
both hooks are tuned to match it exactly. Uppercuts hit hardest and cost the
most, but their short reach means you have to be inside to land one. Body
shots do modest damage but take the wind out of whoever eats them.

## Defence

Each punch is `windup → active → recovery` frames. During the active frames
the throwing glove is a real point in the world; head punches are tested
against the boxer's **head**, body punches against his body. The three
defences cover different things, and each one leaves something open:

| | guard (`Space`) | duck (`↓`) | slip (`Q` / `E`) |
| --- | --- | --- | --- |
| jab / cross | blocked | slipped | **evaded** |
| hook | blocked | slipped | **hooks come around it** |
| uppercut | caught 45%, else through | clean hit | **evaded** |
| body shot | caught 45%, else through | clean hit | **clean hit** |

A high guard stops everything aimed at the head outright, and the gloves
catch a fair share of body shots and uppercuts on the way in too — but every
punch it catches costs you wind, so you cannot hide behind it all night.

`Q` and `E` move only the head — the body stays where it is — sliding it off
the line between the two boxers so a straight punch passes by. It is a timed
move, not a stance: it fires on the press, takes six frames to get there,
holds briefly and comes back, then needs a moment before it can go again.
Holding the key down does not keep the head out there, so a slip has to be
read off the other man's windup. A hook is wide enough to come around it.

Feedback on contact: a few frames of hit-stop, the screen shakes (harder for
heavier punches), the boxer who ate it flashes white, snaps his head back and
gets knocked backwards, a spark and sweat pop off the impact point, and a
chip-tune thud plays. Blocks get their own shorter shake and a leather "tok";
a slipped punch just swishes.

Punches pressed while stunned or during hit-stop are buffered and come out as
soon as the boxer can move again, and a punch pressed late in another punch's
recovery chains into a combo.

## Health and stamina

Both boxers have 300 health and 100 stamina, shown in the meters at the top.

- **Health** only comes off clean and through-the-guard hits.
- **Stamina** is spent to throw (see the table), to catch a punch on the
  guard (1.4x what it cost the other man to throw it), and 3 per slip.
  **Footwork is free** — moving around never costs stamina, it just breathes
  slower than standing still does. Wind comes back fastest standing still,
  barely at all on the move or behind a guard, and not at all mid-punch or
  while stunned. Eating a body shot takes a big bite out of it.
- **The tank shrinks.** Every punch thrown and every punch caught on the
  gloves permanently lowers the ceiling your stamina can recover to — the
  dark band that grows in from the right of the ST meter. It never falls
  below 45, and the corner wins 20 of it back between rounds, but a boxer who
  throws at everything has less and less to draw on: in a typical three-round
  fight the ceiling ends up around 60. Picking your punches is worth
  something.
- Below 25 stamina the legs get heavy and movement slows. If a punch costs
  more than you have left, it simply doesn't come out.

The opponent plays by the same rules — when its wind is low it breaks off,
circles out of range to breathe, and only throws jabs and body shots until it
has recovered.

## The bout

**Three rounds of two minutes.** The clock sits between the two meters.

- **Knockdowns.** At zero health a boxer goes down and takes an eight count,
  then gets up with 140 health. Three knockdowns in the same round is a TKO
  and ends the fight.
- **Between rounds** you get the scorecard: punches thrown, landed, how many
  went to the head and how many to the body, how many were blocked, how many
  were slipped or ducked, and knockdowns — for both boxers. Under it are the
  three judges' scores for the round and the running total. It holds for
  twelve seconds, or `Space` moves on. The corner puts 130 health back and
  refills your wind for the next round.
- **The judges** score every round on damage, work rate and above all
  knockdowns: 10-9 to the winner, 10-8 or 10-7 if they put the other man
  down, 10-10 for a round nobody took. Each judge sees it slightly
  differently, so the cards can disagree.
- **After round three** the fight goes to the cards: unanimous, majority or
  split decision, or a draw. `Space` starts a new fight.

## The opponent

`js/ai.js` circles, closes distance and throws scripted combos. It reads the
player's windup and answers with a guard, a duck or a slip — and will come
back over the top with a hook or a cross after slipping one. It picks body
shots and uppercuts when the player is turtling, uppercuts when the player
ducks, and won't start a fresh combo on a boxer who is still reeling.

## Layout

| File | What's in it |
| --- | --- |
| `js/font.js` | 5x7 bitmap font — every glyph is whole pixels |
| `js/config.js` | ring, punch table, weight classes, bout constants, palettes |
| `js/profile.js` | fighters and their records; the only file that touches storage |
| `js/audio.js` | synthesised chip SFX (no audio files) |
| `js/input.js` | keyboard, including the modifier combos |
| `js/render.js` | ring, boxers, meters, punch guide, scorecards |
| `js/boxer.js` | boxer state machine, gloves, head movement, condition |
| `js/ai.js` | opponent behaviour |
| `js/game.js` | main loop, hit resolution, rounds, judging, screen shake |

Punch timings, reach, damage, stamina, stun and shake live in one table —
`PUNCHES` in `js/config.js` — and the round length, knockdown rules and
recovery amounts are constants right above it. `WEIGHTS` in the same file
holds the six divisions; `makePunchTable()` derives the scaled table a fight
actually runs on, so nothing else has to know about weight classes.
