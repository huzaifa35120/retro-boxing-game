'use strict';

const cv = document.getElementById('screen');
cv.width = VIEW_W; cv.height = VIEW_H;    // the buffer size comes from config
const ctx = cv.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

const IDLE = { mx: 0, mz: 0, block: false, duck: false, slip: 0, punch: null };

const game = {
  player: new Boxer(-30, 26, PAL_PLAYER, 'YOU', true),
  bot:    new Boxer(30, -26, PAL_BOT, 'OPPONENT', false),
  brain:  new Brain(),
  shake: 0, freeze: 0,
  paused: false, page: 0, sound: true,
  sparks: [], bits: [],
  banner: '', bannerT: 0,
  frames: 0,

  /* screens -------------------------------------------------------------- */
  screen: 'menu',   // menu | weight | roster | newfighter | fightercard
                    // | multiplayer | mpsoon | guide | fight
  menuIdx: 0,
  weightIdx: DEFAULT_WEIGHT,
  weightPick: DEFAULT_WEIGHT,
  guidePage: 0,
  rosterSel: 0, newRow: 0, cardRow: 0, confirmDel: false, draft: null,
  mpSel: 0, mpTopic: 0,
  authRow: 0, authEmail: '', authPass: '', authMsg: '',
  roomRow: 0, roomCode: '', roomSlot: 0,
  boardDiv: DEFAULT_WEIGHT,
  rulePage: 0,
  quickOn: false, quickT: 0, quickMsg: '',
  tour: null, tourDiv: DEFAULT_WEIGHT, tourNames: {}, tourMsg: '', tourAt: 0,
  fighterSlot: -1, playerName: 'YOU', botName: 'OPPONENT',

  /* the bout ------------------------------------------------------------- */
  phase: 'fight',                 // fight | count | rest | over
  round: 1,
  roundT: ROUND_FRAMES,
  restT: 0, countT: 0, countN: 0, overT: 0,
  downed: null,
  cards: [],                      // one [[a,b],[a,b],[a,b]] per completed round
  jtot: [[0, 0], [0, 0], [0, 0]], // each judge's running total
  stoppage: null,
  verdict: '', winnerText: '',

  nearCam(b) { return b === this.player; },

  get weight() { return WEIGHTS[this.weightIdx]; },

  applyWeight() {
    this.player.setWeight(this.weight);
    this.bot.setWeight(this.weight);
  },

  menuItems() {
    return ['TRAINING FIGHT', 'MY FIGHTERS', 'MULTIPLAYER', 'GUIDE', 'RULES',
            'SOUND: ' + (this.sound ? 'ON' : 'OFF')];
  },

  mpItems() {
    return ['QUICK FIGHT', 'FIGHT ROOMS', 'SUNDAY TOURNAMENT', 'LEADERBOARDS',
            Net.signedIn() ? 'MY ACCOUNT' : 'SIGN IN / SIGN UP'];
  },

  toMenu() {
    this.screen = 'menu';
    this.phase = 'fight';
    this.player.reset(); this.bot.reset(); this.brain.reset();
    this.applyWeight();
    this.sparks.length = 0; this.bits.length = 0;
    this.shake = 0; this.freeze = 0; this.bannerT = 0;
    Input.flush();
  },

  /* Boxer A is always the host's man and boxer B the guest's, on both
     machines. Each player's own meter is drawn on the left, whichever he is. */
  localBoxer()  { return (Wire.active && Wire.role === 'guest') ? this.bot : this.player; },
  remoteBoxer() { return (Wire.active && Wire.role === 'guest') ? this.player : this.bot; },
  localName()   { return (Wire.active && Wire.role === 'guest') ? this.botName : this.playerName; },
  remoteName()  { return (Wire.active && Wire.role === 'guest') ? this.playerName : this.botName; },

  startOnlineFight() {
    Wire.status = 'live';               // so leaving later does not close a live room
    const hostF  = Wire.role === 'host' ? Wire.myFighter : Wire.theirFighter;
    const guestF = Wire.role === 'host' ? Wire.theirFighter : Wire.myFighter;
    this.weightIdx = hostF.weight;
    this.fighterSlot = -1;              // online records are written by the server
    this.screen = 'fight';
    this.reset();
    Rng.seed(Wire.seed);                // same rolls on both machines
    this.player.pal = palFor(hostF);
    this.bot.pal = palFor(guestF);
    this.playerName = hostF.name;
    this.botName = guestF.name;
    Wire.status = 'live';
  },

  reportOnline() {
    if (!Wire.active || !Wire.room) return;
    let winner = null, method = 'decision';
    if (this.stoppage) {
      method = 'tko';
      winner = this.stoppage.byPlayer ? Wire.room.host_fighter : Wire.room.guest_fighter;
    } else {
      let pw = 0, bw = 0;
      for (const t of this.jtot) { if (t[0] > t[1]) pw++; else if (t[1] > t[0]) bw++; }
      if (pw > bw) winner = Wire.room.host_fighter;
      else if (bw > pw) winner = Wire.room.guest_fighter;
      else method = 'draw';
    }
    Net.call('/rest/v1/rpc/report_match', {
      method: 'POST',
      body: { p_room: Wire.room.id, p_winner: winner, p_method: method, p_rounds: this.cards },
    }).catch(e => { Net.saveError = 'RESULT NOT SAVED: ' + e.message; });
  },

  startFight() {
    // fight as your own man if you have one in this division
    const fs = Profile.fighters();
    this.fighterSlot = fs.findIndex(f => f && f.weight === this.weightIdx);
    const f = this.fighterSlot >= 0 ? fs[this.fighterSlot] : null;
    this.playerName = f ? f.name : 'YOU';
    this.screen = 'fight';
    this.reset();
    this.player.pal = f ? palFor(f) : PAL_PLAYER;
  },

  /* ---------------------------------------------------------------- menus */
  stepMenu() {
    const items = this.menuItems();
    if (Input.any('w', 'ArrowUp')) this.menuIdx = (this.menuIdx + items.length - 1) % items.length;
    if (Input.any('s', 'ArrowDown')) this.menuIdx = (this.menuIdx + 1) % items.length;
    if (!Input.any(' ', 'Enter')) return;
    Input.flush();
    switch (this.menuIdx) {
      case 0: this.weightPick = this.weightIdx; this.screen = 'weight'; break;
      case 1: this.rosterSel = 0; this.screen = 'roster'; break;
      case 2: this.mpSel = 0; this.screen = 'multiplayer'; break;
      case 3: this.guidePage = 0; this.screen = 'guide'; break;
      case 4: this.rulePage = 0; this.screen = 'rules'; break;
      case 5: this.sound = Sfx.toggleMute(); break;
    }
  },

  stepWeight() {
    if (Input.any('w', 'ArrowUp')) this.weightPick = (this.weightPick + WEIGHTS.length - 1) % WEIGHTS.length;
    if (Input.any('s', 'ArrowDown')) this.weightPick = (this.weightPick + 1) % WEIGHTS.length;
    if (Input.any(' ', 'Enter')) {
      this.weightIdx = this.weightPick;
      this.applyWeight();
      this.startFight();
    } else if (Input.any('b', 'Escape', 'Backspace')) {
      this.screen = 'menu';
    }
  },

  /* ------------------------------------------------------------ fighters */
  stepRoster() {
    if (Input.any('w', 'ArrowUp')) this.rosterSel = (this.rosterSel + FIGHTER_SLOTS - 1) % FIGHTER_SLOTS;
    if (Input.any('s', 'ArrowDown')) this.rosterSel = (this.rosterSel + 1) % FIGHTER_SLOTS;
    if (Input.any('b', 'Escape', 'Backspace')) { this.screen = 'menu'; return; }
    if (!Input.any(' ', 'Enter')) return;
    if (Profile.get(this.rosterSel)) {
      this.cardRow = 0; this.confirmDel = false; this.screen = 'fightercard';
    } else {
      this.draft = Profile.newFighter();
      this.newRow = 0;
      Input.startTyping('');
      this.screen = 'newfighter';
    }
  },

  stepNewFighter() {
    const d = this.draft;
    d.name = Input.takeTyped(NAME_MAX);
    if (Input.any('ArrowUp')) this.newRow = (this.newRow + NEW_ROWS.length - 1) % NEW_ROWS.length;
    if (Input.any('ArrowDown')) this.newRow = (this.newRow + 1) % NEW_ROWS.length;
    const dir = (Input.any('ArrowRight') ? 1 : 0) - (Input.any('ArrowLeft') ? 1 : 0);
    if (dir) {
      if (this.newRow === 1) d.weight = (d.weight + dir + WEIGHTS.length) % WEIGHTS.length;
      else if (this.newRow === 2) d.skin = (d.skin + dir + SKINS.length) % SKINS.length;
      else if (this.newRow === 3) d.shorts = (d.shorts + dir + SHORTS.length) % SHORTS.length;
      else if (this.newRow === 4) d.country = (d.country + dir + COUNTRIES.length) % COUNTRIES.length;
    }
    if (Input.any('Escape')) { Input.stopTyping(); this.screen = 'roster'; return; }
    if (Input.any(' ', 'Enter') && this.newRow === NEW_ROWS.length - 1 && d.name) {
      Input.stopTyping();
      Profile.put(this.rosterSel, d);
      Sfx.bell();
      this.screen = 'roster';
    }
  },

  stepFighterCard() {
    const f = Profile.get(this.rosterSel);
    if (!f) { this.screen = 'roster'; return; }
    if (Input.any('w', 'ArrowUp')) { this.cardRow = 0; this.confirmDel = false; }
    if (Input.any('s', 'ArrowDown')) this.cardRow = 1;
    const dir = (Input.any('d', 'ArrowRight') ? 1 : 0) - (Input.any('a', 'ArrowLeft') ? 1 : 0);
    if (dir && this.cardRow === 0) Profile.setShorts(this.rosterSel, f.shorts + dir);
    if (Input.any('b', 'Escape', 'Backspace')) { this.screen = 'roster'; return; }
    if (Input.any(' ', 'Enter') && this.cardRow === 1) {
      if (this.confirmDel) { Profile.remove(this.rosterSel); this.screen = 'roster'; }
      else this.confirmDel = true;
    }
  },

  /* --------------------------------------------------------- multiplayer */
  stepMultiplayer() {
    const items = this.mpItems();
    if (Input.any('w', 'ArrowUp')) this.mpSel = (this.mpSel + items.length - 1) % items.length;
    if (Input.any('s', 'ArrowDown')) this.mpSel = (this.mpSel + 1) % items.length;
    if (Input.any('b', 'Escape', 'Backspace')) { this.screen = 'menu'; return; }
    if (!Input.any(' ', 'Enter')) return;
    const needAccount = () => {
      this.authRow = 0; this.authMsg = '';
      this.authEmail = ''; this.authPass = '';
      Input.startTyping('', 'name');
      this.screen = 'auth';
    };
    if (this.mpSel === 4) {
      if (Net.signedIn()) this.screen = 'account'; else needAccount();
      return;
    }
    if (this.mpSel === 3) {
      this.boardDiv = this.weightIdx;
      Net.wantBoard(this.boardDiv);
      this.screen = 'board';
      return;
    }
    if (!Net.signedIn()) { needAccount(); return; }
    this.roomSlot = Profile.fighters().findIndex(Boolean);
    if (this.mpSel === 0) {
      Wire.reset(); this.quickOn = false; this.quickT = 0; this.quickMsg = '';
      this.screen = 'quick';
    } else if (this.mpSel === 1) {
      Wire.reset();
      this.roomRow = 0; this.roomCode = '';
      Input.startTyping('', 'name');
      this.screen = 'rooms';
    } else {
      this.tourDiv = this.weightIdx; this.tourMsg = '';
      this.wantTourney(true);
      this.screen = 'tourney';
    }
  },

  /* ----------------------------------------------------------- quick fight */
  stepQuick() {
    if (Wire.status === 'ready') { this.startOnlineFight(); return; }
    const f = this.roomFighter(), id = this.roomFighterId();

    if (Input.any('b', 'Escape', 'Backspace')) {
      if (this.quickOn && id) Net.leaveCasual(id).catch(() => {});
      this.quickOn = false;
      this.screen = 'multiplayer';
      return;
    }
    if (Input.any(' ', 'Enter') && !this.quickOn) {
      if (!f) { this.quickMsg = 'MAKE A FIGHTER FIRST'; return; }
      if (!id) { this.quickMsg = 'STILL SAVING YOUR FIGHTER - TRY AGAIN'; return; }
      this.quickOn = true; this.quickT = 0; this.quickMsg = '';
    }
    if (!this.quickOn) return;

    this.quickT++;
    if (this.quickT % 60 !== 1) return;              // ask once a second
    Net.findCasual(id)
      .then(room => { if (room && this.quickOn) { this.quickOn = false; Wire.attach(room, f); } })
      .catch(e => { this.quickMsg = e.message; this.quickOn = false; });
  },

  /* ------------------------------------------------------------ tournament */
  wantTourney(force) {
    if (!force && this.tourAt && Date.now() - this.tourAt < 8000) return;
    this.tourAt = Date.now();
    Net.pullTournament(this.tourDiv)
      .then(t => { this.tour = t; return this.tourFighters(t); })
      .catch(e => { this.tourMsg = e.message; this.tour = null; });
  },

  async tourFighters(t) {
    this.tourNames = {};
    if (!t || !t.bouts) return;
    const ids = [];
    for (const b of t.bouts) { if (b.red) ids.push(b.red); if (b.blue) ids.push(b.blue); }
    if (!ids.length) return;
    const rows = await Net.call('/rest/v1/fighters?select=id,name&id=in.(' + ids.join(',') + ')');
    for (const r of rows || []) this.tourNames[r.id] = r;
  },

  stepTourney() {
    if (Wire.status === 'ready') { this.startOnlineFight(); return; }
    const dir = (Input.any('d', 'ArrowRight') ? 1 : 0) - (Input.any('a', 'ArrowLeft') ? 1 : 0);
    if (dir) {
      this.tourDiv = (this.tourDiv + dir + WEIGHTS.length) % WEIGHTS.length;
      this.tour = null; this.tourMsg = '';
      this.wantTourney(true);
    }
    if (Input.any('b', 'Escape', 'Backspace')) { this.screen = 'multiplayer'; return; }
    if (!Input.any(' ', 'Enter')) return;

    const id = this.roomFighterId();
    if (!this.tour) {
      Net.openTournament(this.tourDiv)
        .then(() => this.wantTourney(true))
        .catch(e => { this.tourMsg = e.message; });
      return;
    }
    if (!id) { this.tourMsg = 'MAKE A FIGHTER FIRST'; return; }
    const mine = this.myBout();
    if (mine) {
      Net.startBout(mine.id)
        .then(room => { if (room) Wire.attach(room, this.roomFighter()); })
        .catch(e => { this.tourMsg = e.message; });
    } else {
      Net.checkIn(this.tour.id, id)
        .then(() => this.wantTourney(true))
        .catch(e => { this.tourMsg = e.message; });
    }
  },

  /* what the tournament screen needs to say */
  tourView() {
    const t = this.tour;
    if (!t) return null;
    const start = Date.parse(t.starts_at);
    const mins = Math.round((start - Date.now()) / 60000);
    const id = this.roomFighterId();
    const inDraw = (t.bouts || []).some(b => b.red === id || b.blue === id);
    const checked = (t.checked || []).some(c => c.fighter === id);
    const mine = this.myBout();
    return Object.assign({}, t, {
      when: new Date(start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }).toUpperCase(),
      countdown: mins > 60 ? 'IN ' + Math.round(mins / 60) + ' HOURS'
               : mins > 0 ? 'IN ' + mins + ' MINUTES'
               : 'DOORS ARE OPEN',
      hint: !inDraw ? 'YOU ARE NOT IN THIS DRAW'
          : mine ? 'YOUR BOUT IS READY'
          : checked ? 'CHECKED IN - WAITING'
          : 'CHECK IN BEFORE IT STARTS',
      action: !this.tour ? 'OPEN' : (mine ? 'FIGHT' : (checked ? 'REFRESH' : 'CHECK IN')),
    });
  },

  myBout() {
    const id = this.roomFighterId();
    if (!id || !this.tour) return null;
    return (this.tour.bouts || []).find(b => !b.winner && b.red && b.blue &&
                                             (b.red === id || b.blue === id)) || null;
  },

  /* ------------------------------------------------------- fight rooms */
  roomFighter() {
    const fs = Profile.fighters();
    return this.roomSlot >= 0 ? fs[this.roomSlot] : null;
  },

  roomFighterId() {
    // the row id in the database, which is what the room needs
    const f = this.roomFighter();
    if (!f) return null;
    const id = Net.fighterIds ? Net.fighterIds[this.roomSlot] : null;
    if (!id && Net.signedIn() && !this.idFetch) {
      // we have the fighter but not his id - fetch it rather than pretend
      this.idFetch = true;
      Net.pullFighters().catch(() => {}).then(() => { this.idFetch = false; });
    }
    return id;
  },

  cycleRoomFighter(dir) {
    const fs = Profile.fighters();
    for (let n = 1; n <= FIGHTER_SLOTS; n++) {
      const i = (this.roomSlot + dir * n + FIGHTER_SLOTS * 2) % FIGHTER_SLOTS;
      if (fs[i]) { this.roomSlot = i; return; }
    }
  },

  stepRooms() {
    // the fight starts the moment both sides are connected
    if (Wire.status === 'ready') { Input.stopTyping(); this.startOnlineFight(); return; }

    this.roomCode = Input.takeTyped(4);
    const move = (Input.any('ArrowDown', 's') ? 1 : 0) - (Input.any('ArrowUp', 'w') ? 1 : 0);
    if (move) this.roomRow = clamp(this.roomRow + move, 0, 2);
    const dir = (Input.any('ArrowRight', 'd') ? 1 : 0) - (Input.any('ArrowLeft', 'a') ? 1 : 0);
    if (dir && this.roomRow === 0) this.cycleRoomFighter(dir);

    if (Input.any('b', 'Escape')) {
      Input.stopTyping(); Wire.reset(); this.screen = 'multiplayer'; return;
    }
    if (!Input.any(' ', 'Enter')) return;

    const f = this.roomFighter(), id = this.roomFighterId();
    if (!f) { Wire.fail('MAKE A FIGHTER FIRST'); return; }
    if (!id) { Wire.fail('STILL SAVING YOUR FIGHTER - TRY AGAIN'); return; }
    if (this.roomRow === 1) Wire.host(f, id);
    else if (this.roomRow === 2) {
      if (this.roomCode.length < 4) { Wire.fail('TYPE THE FOUR LETTER CODE'); return; }
      Wire.join(this.roomCode, f, id);
    }
  },

  stepRules() {
    if (Input.any('a', 'ArrowLeft')) this.rulePage = (this.rulePage + RULE_PAGES.length - 1) % RULE_PAGES.length;
    if (Input.any('d', 'ArrowRight')) this.rulePage = (this.rulePage + 1) % RULE_PAGES.length;
    if (Input.any('b', 'Escape', 'Backspace', ' ', 'Enter')) this.screen = 'menu';
  },

  stepBoard() {
    const dir = (Input.any('d', 'ArrowRight') ? 1 : 0) - (Input.any('a', 'ArrowLeft') ? 1 : 0);
    if (dir) {
      this.boardDiv = (this.boardDiv + dir + WEIGHTS.length) % WEIGHTS.length;
      Net.board = null;
      Net.boardDivision = -1;
      Net.wantBoard(this.boardDiv);
    }
    if (Input.any('b', 'Escape', 'Backspace', ' ', 'Enter')) this.screen = 'multiplayer';
  },

  /* ------------------------------------------------------------ account */
  stepAuth() {
    if (this.authRow === 0) this.authEmail = Input.takeTyped(USER_MAX);
    else if (this.authRow === 1) this.authPass = Input.takeTyped(32);

    const move = (Input.any('ArrowDown') ? 1 : 0) - (Input.any('ArrowUp') ? 1 : 0);
    if (move) {
      this.authRow = (this.authRow + move + AUTH_ROWS.length) % AUTH_ROWS.length;
      if (this.authRow === 0) Input.startTyping(this.authEmail, 'name');
      else if (this.authRow === 1) Input.startTyping(this.authPass, 'pass');
      else Input.stopTyping();
    }

    if (Input.any('Escape')) { Input.stopTyping(); this.screen = 'multiplayer'; return; }
    if (!Input.any(' ', 'Enter') || this.authRow < 2 || Net.busy) return;

    if (!Net.online()) { this.authMsg = 'NO SERVER CONFIGURED - SEE README'; return; }
    if (!this.authEmail || !this.authPass) { this.authMsg = 'FILL IN BOTH FIELDS'; return; }

    const creating = this.authRow === 3;
    const bad = Net.validUser(this.authEmail);
    if (bad) { this.authMsg = 'NAME: ' + bad; return; }
    if (creating && this.authPass.length < 6) { this.authMsg = 'PASSWORD NEEDS 6 CHARACTERS'; return; }

    Net.busy = true;
    this.authMsg = '';
    const go = creating ? Net.signUpUser(this.authEmail, this.authPass)
                        : Net.signInUser(this.authEmail, this.authPass);
    go.then(() => {
      if (!Net.signedIn()) { this.authMsg = 'CHECK YOUR EMAIL TO CONFIRM'; return null; }
      return Net.whoAmI().then(() => Profile.useAccount());
    }).then(() => {
      if (Net.signedIn()) { Input.stopTyping(); this.screen = 'account'; Sfx.bell(); }
    }).catch(e => { this.authMsg = e.message; })
      .then(() => { Net.busy = false; });
  },

  stepAccount() {
    if (Input.any('b', 'Escape', 'Backspace')) { this.screen = 'multiplayer'; return; }
    if (Input.any(' ', 'Enter')) {
      Profile.dropAccountCache();   // while we still know whose it was
      Net.signOut();
      Profile.load();               // back to the guest roster
      this.playerName = 'YOU';
      this.fighterSlot = -1;
      this.screen = 'multiplayer';
    }
  },

  stepSoon() {
    if (Input.any('b', 'Escape', 'Backspace', ' ', 'Enter')) this.screen = 'multiplayer';
  },

  stepGuide() {
    if (Input.any('a', 'ArrowLeft')) this.guidePage = (this.guidePage + 2) % 3;
    if (Input.any('d', 'ArrowRight')) this.guidePage = (this.guidePage + 1) % 3;
    if (Input.any('b', 'Escape', 'Backspace', ' ', 'Enter')) this.screen = 'menu';
  },

  reset() {
    this.player.reset(); this.bot.reset(); this.brain.reset();
    this.applyWeight();
    this.sparks.length = 0; this.bits.length = 0;
    this.shake = 0; this.freeze = 0;
    this.phase = 'fight'; this.round = 1; this.roundT = ROUND_FRAMES;
    this.restT = 0; this.countT = 0; this.overT = 0; this.downed = null;
    this.cards.length = 0;
    this.jtot = [[0, 0], [0, 0], [0, 0]];
    this.stoppage = null; this.verdict = ''; this.winnerText = '';
    this.banner = 'ROUND 1'; this.bannerT = 80;
    Sfx.bell();
  },

  say(s) { this.banner = s; this.bannerT = 45; },

  /* ---------------------------------------------------------- scoring */
  scoreRound() {
    // what a judge sees: damage, work rate, and above all knockdowns
    const val = s => s.dmg + s.landed * 1.5 + s.head * 0.5 + s.kd * 40;
    const d0 = val(this.player.stats) - val(this.bot.stats);
    const kdP = this.player.stats.kd, kdB = this.bot.stats.kd;
    const card = [];
    for (let i = 0; i < 3; i++) {
      const d = d0 + (Rng.next() * 24 - 12);   // three judges, three opinions
      let a, b;
      if (Math.abs(d) < 3) { a = 10; b = 10; }
      else if (d > 0) { a = 10; b = 9 - Math.min(2, kdP); }
      else { b = 10; a = 9 - Math.min(2, kdB); }
      card.push([a, b]);
      this.jtot[i][0] += a; this.jtot[i][1] += b;
    }
    this.cards.push(card);
  },

  cardTotals() {
    return this.jtot.reduce((t, j) => [t[0] + j[0], t[1] + j[1]], [0, 0]);
  },

  logResult() {
    if (this.fighterSlot < 0) return;
    let res, method = 'dec';
    if (this.stoppage) { res = this.stoppage.byPlayer ? 'w' : 'l'; method = 'ko'; }
    else {
      let pw = 0, bw = 0;
      for (const t of this.jtot) { if (t[0] > t[1]) pw++; else if (t[1] > t[0]) bw++; }
      res = pw > bw ? 'w' : (bw > pw ? 'l' : 'd');
    }
    Profile.recordFight(this.fighterSlot, res, method, false);   // training only
  },

  finish() {
    this.phase = 'over';
    this.overT = 60;
    this.logResult();
    this.reportOnline();
    if (this.stoppage) {
      this.verdict = 'TKO - ROUND ' + this.stoppage.round;
      this.winnerText = this.stoppage.byPlayer ? 'WINNER: YOU' : 'WINNER: OPPONENT';
      return;
    }
    let pw = 0, bw = 0, dr = 0;
    for (const t of this.jtot) { if (t[0] > t[1]) pw++; else if (t[1] > t[0]) bw++; else dr++; }
    if (pw === 3 || bw === 3) this.verdict = 'UNANIMOUS DECISION';
    else if (pw === bw) this.verdict = 'DRAW';
    else if (dr === 1) this.verdict = 'MAJORITY DECISION';
    else this.verdict = 'SPLIT DECISION';
    this.winnerText = pw > bw ? 'WINNER: YOU'
                    : bw > pw ? 'WINNER: OPPONENT' : 'THE FIGHT IS A DRAW';
  },

  endRound() {
    this.scoreRound();
    Sfx.bell();
    this.player.punch = null; this.bot.punch = null;
    if (this.round >= ROUNDS) { this.finish(); return; }
    this.phase = 'rest';
    this.restT = REST_FRAMES;
  },

  nextRound() {
    this.round++;
    this.roundT = ROUND_FRAMES;
    this.phase = 'fight';
    for (const b of [this.player, this.bot]) {
      b.hp = Math.min(MAX_HP, b.hp + ROUND_RECOVER_HP);   // the corner patches you up
      b.hpShown = b.hp;
      b.stCap = Math.min(MAX_ST, b.stCap + ST_CAP_ROUND);   // the corner works on him
      b.st = b.stCap;
      b.stats = Boxer.newStats();
      b.hurt = 0; b.punch = null; b.buf = null;
      b.slipAmt = 0; b.duckAmt = 0; b.vx = 0; b.vz = 0;
      b.x = b.homeX; b.z = b.homeZ;
    }
    this.brain.reset();
    this.sparks.length = 0; this.bits.length = 0;
    this.say('ROUND ' + this.round);
    Sfx.bell();
  },

  /* ------------------------------------------------------- knockdowns */
  knockdown(b) {
    b.goDown();
    const scorer = b === this.player ? this.bot : this.player;
    scorer.stats.kd++;
    this.downed = b;
    this.phase = 'count';
    this.countT = COUNT_STEP * COUNT_TO;
    this.countN = 1;
    this.shake = 6.5;
    this.freeze = 12;
    this.banner = b.isPlayer ? 'YOU ARE DOWN' : 'OPPONENT IS DOWN';
    this.bannerT = 100;
    this.burst(b.x, b.z, 22, 10, '#f8f0c0');
    Sfx.ko();
  },

  stepCount() {
    this.countT--;
    this.countN = clamp(COUNT_TO - Math.floor(this.countT / COUNT_STEP), 1, COUNT_TO);
    if (this.countT > 0) return;
    const b = this.downed;
    const scorer = b === this.player ? this.bot : this.player;
    if (scorer.stats.kd >= TKO_KD) {          // three times down in a round
      this.stoppage = { round: this.round, byPlayer: scorer === this.player };
      this.downed = null;
      this.finish();
      return;
    }
    b.getUp(KD_RECOVER_HP);
    this.downed = null;
    this.phase = 'fight';
    this.say('BOX ON!');
  },

  /* ---------------------------------------------------------------- hits */
  resolvePunch(att, def) {
    if (this.phase !== 'fight' || att.down || def.down) return;
    const pd = att.punch.def;
    const g = att.gloves[pd.hand];

    const bodyD = Math.hypot(g.x - def.x, g.z - def.z);
    if (bodyD > GLOVE_HIT_R + 5) return;                 // nowhere near him

    // Head punches are aimed at the head, and the head is a thing the
    // defender can move out of the way with Q / E.
    if (pd.level !== 'body') {
      const hp = def.headPoint();
      // a hook wraps around head movement; straights and uppercuts do not
      const r = pd.kind === 'hook' ? HOOK_HEAD_R : HEAD_HIT_R;
      if (Math.hypot(g.x - hp.x, g.z - hp.z) > r) {
        if (Math.abs(def.slipAmt) > 4) {                 // he rolled off it
          att.punch.hit = true;
          att.stats.slipped++;
          Sfx.slip();
          this.say('SLIPPED!');
        }
        return;
      }
    } else if (bodyD > GLOVE_HIT_R) return;

    // is the attacker in front of the defender's guard?
    const fx = Math.cos(def.ang), fz = Math.sin(def.ang);
    const ax = att.x - def.x, az = att.z - def.z;
    const am = Math.hypot(ax, az) || 1;
    const frontal = (fx * ax + fz * az) / am > 0.1;

    let result;
    if (def.duckAmt > 0.6 && pd.level === 'head') result = 'miss';
    else if (def.blocking && def.hurt <= 0 && frontal) {
      // A high guard stops everything aimed at the head. Body shots and
      // uppercuts are what beat it, but the gloves still catch a fair share
      // of those on the way in.
      result = pd.level === 'head' || Rng.next() < GUARD_CATCH ? 'block' : 'graze';
    } else result = 'clean';

    att.punch.hit = true;
    const hx = g.x, hz = g.z, hh = g.h;

    if (result === 'miss') {
      att.stats.slipped++;
      Sfx.slip();
      this.say('DUCKED!');
      return;
    }
    if (result === 'block') {
      att.stats.blocked++;
      Sfx.block();
      this.shake = Math.max(this.shake, 1.6);
      this.freeze = Math.max(this.freeze, 3);
      this.spark(hx, hz, hh, 4, 6);
      this.burst(hx, hz, hh, 3, '#f8f8f8');
      def.takeHit(att, pd, 'block');
      this.say('BLOCKED');
      return;
    }

    const heavy = result === 'clean';
    const scale = heavy ? 1 : 0.55;
    att.stats.landed++;
    att.stats.dmg += pd.dmg * scale;
    if (pd.level === 'body') att.stats.body++; else att.stats.head++;

    if (pd.level === 'body') Sfx.hitBody(heavy ? 1 : 0.8);
    else Sfx.hitHead(heavy ? 1 : 0.8);

    this.shake = Math.max(this.shake, pd.shake * (heavy ? 1 : 0.55));
    this.freeze = Math.max(this.freeze, heavy ? 6 : 4);
    this.spark(hx, hz, hh, heavy ? 7 : 5, heavy ? 9 : 6);
    this.burst(hx, hz, hh, heavy ? 6 : 3, '#f8f0c0');
    def.takeHit(att, pd, result);
    this.say(result === 'graze' ? pd.name + ' THRU GUARD' : pd.name + '!');
    if (def.hp <= 0) this.knockdown(def);
  },

  spark(x, z, h, r, life) { this.sparks.push({ x, z, h, r, r0: r, life, life0: life }); },

  burst(x, z, h, n, col) {
    for (let i = 0; i < n; i++) {
      this.bits.push({
        x, z, h, col,
        vx: rnd(-1.4, 1.4), vz: rnd(-0.9, 0.9), vh: rnd(0.6, 2.2),
        life: 16 + (Math.random() * 12 | 0),
      });
    }
  },

  confirmPressed() { return Input.down(' ') || Input.down('Enter'); },

  readIntent() {
    return {
      mx: (Input.down('d') ? 1 : 0) - (Input.down('a') ? 1 : 0),
      mz: (Input.down('s') ? 1 : 0) - (Input.down('w') ? 1 : 0),
      block: Input.down(' '),
      duck: Input.down('ArrowDown'),
      slip: (Input.down('e') ? 1 : 0) - (Input.down('q') ? 1 : 0),
      punch: Input.takePunch(),
    };
  },

  /* Lockstep: send our input a few frames ahead, and only advance a frame
     once both sides' inputs for it are in hand. */
  stepNet() {
    if (this.screen !== 'fight') { this.step(); return; }
    const f = Wire.frame;
    if (!Wire.mine.has(f + Wire.DELAY)) Wire.sendInput(f + Wire.DELAY, this.readIntent());
    if (!Wire.ready(f)) { Wire.stalled++; return; }
    Wire.stalled = 0;
    this.step(Wire.intents(f));
    Wire.frame++;
  },

  /* ---------------------------------------------------------------- step */
  step(net) {
    this.frames++;
    if (this.screen !== 'fight') {          // arrows are menu keys, not punches
      Input.flush();
      switch (this.screen) {
        case 'menu':        return this.stepMenu();
        case 'weight':      return this.stepWeight();
        case 'roster':      return this.stepRoster();
        case 'newfighter':  return this.stepNewFighter();
        case 'fightercard': return this.stepFighterCard();
        case 'multiplayer': return this.stepMultiplayer();
        case 'mpsoon':      return this.stepSoon();
        case 'rooms':       return this.stepRooms();
        case 'quick':       return this.stepQuick();
        case 'tourney':     return this.stepTourney();
        case 'rules':       return this.stepRules();
        case 'board':       return this.stepBoard();
        case 'auth':        return this.stepAuth();
        case 'account':     return this.stepAccount();
        default:            return this.stepGuide();
      }
    }
    if (this.bannerT > 0) this.bannerT--;

    if (this.freeze > 0) {           // hit-stop: hold the frame, keep shaking
      this.freeze--;
      this.shake *= 0.94;
      return;
    }

    if (this.phase === 'rest') {
      this.restT--;
      if (this.restT <= 0 ||
          (!Wire.active && REST_FRAMES - this.restT > REST_SKIP_AFTER && this.confirmPressed())) {
        Input.flush();
        this.nextRound();
      }
      return;
    }
    if (this.phase === 'over') {
      if (this.overT > 0) this.overT--;
      else if (this.confirmPressed()) this.toMenu();
      return;
    }

    const fighting = this.phase === 'fight';
    if (fighting) {
      this.roundT--;
      if (this.roundT <= 0) { this.endRound(); return; }
    } else {
      this.stepCount();
      if (this.phase !== 'count') return;
    }

    // ---- intents -----------------------------------------------------------
    // Online, both boxers' intents arrive from the wire: A is the host's man,
    // B is the guest's, the same way round on both machines.
    const pi = fighting ? (net ? (net.a || IDLE) : this.readIntent()) : IDLE;
    if (!fighting) Input.flush();
    const bi = fighting ? (net ? (net.b || IDLE) : this.brain.think(this.bot, this.player)) : IDLE;

    // Whoever updates first resolves his punch first, and a landed punch
    // cancels the other man's. Alternate, or the player would win every
    // simultaneous exchange in the fight.
    if (this.frames & 1) {
      this.bot.update(bi, this.player, this);
      this.player.update(pi, this.bot, this);
    } else {
      this.player.update(pi, this.bot, this);
      this.bot.update(bi, this.player, this);
    }

    // ---- keep the two of them out of each other -----------------------------
    const dx = this.bot.x - this.player.x, dz = this.bot.z - this.player.z;
    const d = Math.hypot(dx, dz);
    if (d < MIN_SEP && d > 0.0001 && !this.player.down && !this.bot.down) {
      const push = (MIN_SEP - d) / 2;
      const nx = dx / d, nz = dz / d;
      this.player.x -= nx * push; this.player.z -= nz * push;
      this.bot.x += nx * push;    this.bot.z += nz * push;
    }
    const lx = RING_HX - PAD_X, lz = RING_HZ - PAD_Z;
    for (const b of [this.player, this.bot]) {
      b.x = clamp(b.x, -lx, lx); b.z = clamp(b.z, -lz, lz);
    }

    // ---- fx ------------------------------------------------------------------
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life--; s.r = s.r0 * (0.5 + 1.1 * (1 - s.life / s.life0));
      if (s.life <= 0) this.sparks.splice(i, 1);
    }
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const p = this.bits[i];
      p.x += p.vx; p.z += p.vz; p.h += p.vh; p.vh -= 0.22;
      p.life--;
      if (p.life <= 0 || p.h < 0) this.bits.splice(i, 1);
    }

    this.shake *= 0.8;
    if (this.shake < 0.15) this.shake = 0;
  },

  /* ---------------------------------------------------------------- draw */
  draw() {
    ctx.save();
    if (this.shake > 0) {
      const s = this.shake;
      ctx.translate(Math.round(rnd(-s, s)), Math.round(rnd(-s * 1.25, s * 1.25)));
    }

    drawRingBack(ctx, this.frames);
    const order = [this.player, this.bot].sort((a, b) => a.z - b.z);
    for (const b of order) drawBoxer(ctx, b);
    for (const p of this.bits) drawParticle(ctx, p);
    for (const s of this.sparks) drawSpark(ctx, s);
    drawRingFront(ctx);
    ctx.restore();

    // ---- menus sit on top of the ring ---------------------------------------
    if (this.screen !== 'fight') {
      switch (this.screen) {
        case 'menu':
          drawMenu(ctx, this.menuItems(), this.menuIdx, this.weight); break;
        case 'weight':
          drawWeightTable(ctx, 'PICK YOUR DIVISION', this.weightPick, true,
                          'SPACE FIGHT   B BACK'); break;
        case 'roster':
          drawRoster(ctx, Profile.fighters(), this.rosterSel); break;
        case 'newfighter':
          drawNewFighter(ctx, this.draft, this.newRow, (this.frames >> 4) & 1); break;
        case 'fightercard':
          drawFighterCard(ctx, Profile.get(this.rosterSel), this.cardRow, this.confirmDel); break;
        case 'multiplayer':
          drawMultiplayer(ctx, this.mpItems(), this.mpSel, Net.signedIn()); break;
        case 'quick':
          drawQuick(ctx, this.roomFighter(), this.quickOn,
                    Math.floor(this.quickT / 60), this.quickMsg); break;
        case 'tourney':
          drawTourney(ctx, this.tourDiv, this.tourView(), this.tourNames,
                      this.roomFighterId(), this.tourMsg); break;
        case 'mpsoon':
          drawSoon(ctx, MP_PAGES[0].title, MP_PAGES[0].lines); break;
        case 'rooms':
          drawRooms(ctx, this.roomFighter(), this.roomRow, this.roomCode,
                    (this.frames >> 4) & 1); break;
        case 'rules':
          drawRules(ctx, this.rulePage); break;
        case 'board':
          drawBoard(ctx, this.boardDiv, Net.board, Net.busy, Net.error, Net.champ); break;
        case 'auth':
          drawAuth(ctx, this.authEmail, this.authPass, this.authRow,
                   (this.frames >> 4) & 1, this.authMsg, Net.busy);
          drawAuthNote(ctx, 168); break;
        case 'account':
          drawSignedIn(ctx, Net.handle, Profile.count()); break;
        default:
          drawGuidePage(ctx, this.guidePage, this.weightIdx);
      }
      px(ctx, 0, PANEL_Y, VIEW_W, VIEW_H - PANEL_Y, '#101828');
      drawBox(ctx, 2, PANEL_Y + 2, VIEW_W - 4, 56);
      const mc = '#181820';
      text(ctx, 'WASD MOVE   SPACE GUARD   ' + KEY.D + ' DUCK   Q/E SLIP', 10, PANEL_Y + 8, mc);
      text(ctx, KEY.L + ' JAB    ' + KEY.R + ' CROSS    SHIFT+' + KEY.L + '/' + KEY.R + ' HOOK', 10, PANEL_Y + 19, mc);
      text(ctx, KEY.U + KEY.L + '/' + KEY.U + KEY.R + ' UPPERCUT      ' + KEY.D + KEY.L + '/' + KEY.D + KEY.R + ' BODY', 10, PANEL_Y + 30, mc);
      text(ctx, 'IN A FIGHT:  P PAUSE   R RESTART   ESC MENU', 10, PANEL_Y + 41, mc);
      return;
    }

    // ---- ui (never shakes) ---------------------------------------------------
    drawStatus(ctx, this.localBoxer(), 2, 0, 170, this.localName());
    drawStatus(ctx, this.remoteBoxer(), VIEW_W - 172, 0, 170,
               Wire.active ? this.remoteName() : 'OPPONENT');
    drawClock(ctx, 176, 0, 48, this.round, this.roundT);

    px(ctx, 0, PANEL_Y, VIEW_W, VIEW_H - PANEL_Y, '#101828');
    const c = '#181820';
    const AL = KEY.L, AR = KEY.R, AU = KEY.U, AD = KEY.D;
    if (this.page === 0) {
      drawBox(ctx, 2, PANEL_Y + 2, VIEW_W - 4, 56);
      text(ctx, 'WASD MOVE   SPACE GUARD   ' + AD + ' DUCK   Q/E SLIP', 10, PANEL_Y + 8, c);
      text(ctx, AL + ' JAB    ' + AR + ' CROSS    SHIFT+' + AL + '/' + AR + ' HOOK', 10, PANEL_Y + 19, c);
      text(ctx, AU + AL + '/' + AU + AR + ' UPPERCUT      ' + AD + AL + '/' + AD + AR + ' BODY', 10, PANEL_Y + 30, c);
      text(ctx, 'H GUIDE   M SOUND ' + (this.sound ? 'ON ' : 'OFF') + '  P PAUSE   R RESET', 10, PANEL_Y + 41, c);
    } else if (this.page === 1) {
      drawBox(ctx, 2, PANEL_Y + 2, VIEW_W - 4, 56);
      drawGuide(ctx, 10, PANEL_Y + 8, VIEW_W - 20);
    } else {
      text(ctx, 'H FOR CONTROLS AND PUNCH GUIDE', 8, PANEL_Y + 20, '#8890a8');
    }

    if (Wire.active && Wire.stalled > 0) drawStall(ctx, Wire.stalled);

    if (this.phase === 'count' && this.downed) {
      drawCount(ctx, this.downed.isPlayer ? 'YOU' : 'OPPONENT', this.countN);
    } else if (this.phase === 'rest') {
      drawRoundCard(ctx, this.round, this.player.stats, this.bot.stats,
                    this.cards[this.cards.length - 1], this.cardTotals());
    } else if (this.phase === 'over') {
      drawResult(ctx, this.jtot, this.verdict, this.winnerText, !!this.stoppage);
    } else if (this.bannerT > 0 && this.banner) {
      const w = textW(this.banner) + 14;
      const bx = Math.round(CX - w / 2);
      drawBox(ctx, bx, 31, w, 16);
      text(ctx, this.banner, bx + 6, 35, c);
    }

    if (this.paused) {
      drawBox(ctx, CX - 34, CY - 12, 68, 22);
      text(ctx, 'PAUSED', CX - 16, CY - 5, c);
    }
  },
};

/* ------------------------------------------------------------ main loop */
Net.restore();
Profile.load();
if (Net.signedIn()) {
  Net.whoAmI()
    .then(() => Profile.useAccount())
    .catch(() => { Net.signOut(); Profile.load(); });
}
Input.init();
Input.onMeta = k => {
  if (game.screen !== 'fight') return;      // menus do their own input
  if (k === 'p') { game.paused = !game.paused; }
  else if (k === 'm') { game.sound = Sfx.toggleMute(); }
  else if (k === 'h') { game.page = (game.page + 1) % 3; }
  else if (k === 'r') { if (!Wire.active) game.reset(); }
  else if (k === 'Escape') { Wire.reset(); game.toMenu(); }
};

function resize() {
  const raw = Math.min((window.innerWidth - 20) / VIEW_W,
                       (window.innerHeight - 20) / VIEW_H);
  const s = Math.max(1, Math.floor(raw * 2) / 2);   // half steps keep pixels even
  cv.style.width = Math.round(VIEW_W * s) + 'px';
  cv.style.height = Math.round(VIEW_H * s) + 'px';
}
window.addEventListener('resize', resize);
resize();

const STEP = 1000 / 60;
let acc = 0, last = performance.now();

function frame(now) {
  let dt = now - last;
  last = now;
  if (dt > 250) dt = 250;
  acc += dt;
  let guard = 0;
  while (acc >= STEP && guard++ < 5) {
    if (game.paused) Input.flush();
    else if (Wire.active) game.stepNet();
    else game.step();
    Input.endFrame();
    acc -= STEP;
  }
  game.draw();
  requestAnimationFrame(frame);
}

game.applyWeight();
requestAnimationFrame(frame);
