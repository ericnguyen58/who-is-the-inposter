'use strict';

// "Act & Draw" team mode.
// Teams of 2 (one team of 3 if the player count is odd). Before the first turn every team
// writes one word per round into a shared deck. Each turn one team plays: the actor picks a
// face-down card written by another team, acts or draws it, and the teammate guesses out loud.
// Picked cards leave the deck for good. The team that wrote the word confirms.
// If the deck can't cover a turn (e.g. players left), the other teams type a word live.
// Correct -> playing team +1. Fail or time up -> the team that wrote the word +1.
// A round = every team plays one turn. After the last round, the team with the most points wins.

const MIN_PLAYERS = 4;
const TURN_PHASES = ['picking', 'writing', 'ready', 'acting'];

class TeamGame {
  constructor({ players, rng = Math.random }) {
    this.players = players; // shared Map id -> { name }, owned by the imposter Game
    this.rng = rng;
    // lobby -> collecting -> picking (or writing) -> ready -> acting -> turnResult -> picking ... -> done
    this.phase = 'lobby';
    this.settings = { seconds: 60, rounds: 3 };
    this.teams = []; // { id, members: [playerId], score, actorIdx }
    this.turnIdx = 0;
    this.turnNo = 0;
    this.round = 1;
    this.playedThisRound = new Set(); // team ids that have played this round
    this.turn = null;
    this.nextTeamId = 1;
    this.deck = []; // { id, word, teamId } cards still unused
    this.nextCardId = 1;
    this.turnsPlayed = new Map(); // teamId -> turns played
  }

  active() {
    return this.phase !== 'lobby' && this.phase !== 'done';
  }

  // ---------- host actions ----------

  setSettings({ seconds, rounds } = {}) {
    if (this.phase === 'acting') throw new Error('Wait until the turn is over');
    if (seconds !== undefined) this.settings.seconds = clamp(Math.round(Number(seconds)), 10, 600);
    if (rounds !== undefined) this.settings.rounds = clamp(Math.round(Number(rounds)), 1, 20);
    this.beginIfDeckFull(); // lowering rounds while collecting may complete the deck
  }

  start() {
    if (this.active()) throw new Error('A game is already running');
    if (this.players.size < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players`);
    const ids = shuffle([...this.players.keys()], this.rng);
    this.teams = [];
    for (let i = 0; i + 1 < ids.length; i += 2) this.newTeam([ids[i], ids[i + 1]]);
    if (ids.length % 2) this.teams[this.teams.length - 1].members.push(ids[ids.length - 1]);
    this.turnIdx = 0;
    this.round = 1;
    this.playedThisRound.clear();
    this.deck = [];
    this.turnsPlayed.clear();
    this.phase = 'collecting'; // every team writes its words first
  }

  // Host starts the turns before every team has written all its words.
  begin() {
    if (this.phase !== 'collecting') throw new Error('Not collecting words');
    this.startTurn();
  }

  // Host picks a random card for the actor (e.g. when the actor is a bot).
  pickRandom() {
    if (this.phase !== 'picking') throw new Error('Not picking a card');
    const cards = this.eligibleCards(this.turn.teamId);
    this.takeCard(cards[Math.floor(this.rng() * cards.length)]);
  }

  // Host picks the word before every team has submitted.
  pickNow() {
    if (this.phase !== 'writing') throw new Error('Not collecting words');
    if (this.turn.words.size === 0) throw new Error('No team has written a word yet');
    this.chooseWord();
  }

  next() {
    if (this.phase !== 'turnResult') throw new Error('The turn is not finished');
    const i = this.teams.findIndex((t) => t.id === this.turn.teamId);
    this.turnIdx = ((i === -1 ? this.turnIdx : i + 1) % this.teams.length);
    this.startTurn();
  }

  // Stops any game, clears teams and scores, and goes back to the lobby. Settings stay.
  reset() {
    this.phase = 'lobby';
    this.teams = [];
    this.turn = null;
    this.round = 1;
    this.playedThisRound.clear();
    this.deck = [];
    this.turnsPlayed.clear();
  }

  toLobby() {
    if (this.phase !== 'done') throw new Error('The game is not finished');
    this.phase = 'lobby';
    this.teams = [];
    this.turn = null;
    this.deck = [];
  }

  // ---------- player actions ----------

  // Before the turns start, each team adds one word per round to the deck.
  addWord(playerId, rawWord) {
    if (this.phase !== 'collecting') throw new Error('Not collecting words');
    const team = this.teamOf(playerId);
    if (!team) throw new Error('You are not on a team');
    const word = String(rawWord || '').trim().slice(0, 30);
    if (!word) throw new Error('Enter a word');
    const mine = this.deck.filter((c) => c.teamId === team.id);
    if (mine.length >= this.settings.rounds) throw new Error('Your team has written all its words');
    if (mine.some((c) => c.word.toLowerCase() === word.toLowerCase())) throw new Error('Your team already has that word');
    this.deck.push({ id: this.nextCardId++, word, teamId: team.id });
    this.beginIfDeckFull();
  }

  // Turns start by themselves once every team has written all its words.
  beginIfDeckFull() {
    if (this.phase !== 'collecting') return;
    if (this.teams.every((t) => this.deck.filter((c) => c.teamId === t.id).length >= this.settings.rounds)) {
      this.startTurn();
    }
  }

  removeWord(playerId, cardId) {
    if (this.phase !== 'collecting') throw new Error('Not collecting words');
    const team = this.teamOf(playerId);
    const card = this.deck.find((c) => c.id === cardId);
    if (!team || !card || card.teamId !== team.id) throw new Error('Not your word');
    this.deck = this.deck.filter((c) => c !== card);
  }

  // The actor picks one of the face-down cards offered to their team.
  pickCard(playerId, cardId) {
    if (this.phase !== 'picking') throw new Error('Not picking a card');
    if (playerId !== this.turn.actorId) throw new Error('Only the actor can pick');
    const card = this.eligibleCards(this.turn.teamId).find((c) => c.id === cardId);
    if (!card) throw new Error('That card is not available');
    this.takeCard(card);
  }

  submitWord(playerId, rawWord) {
    if (this.phase !== 'writing') throw new Error('Not collecting words');
    const team = this.teamOf(playerId);
    if (!team || team.id === this.turn.teamId) throw new Error('Your team is playing this turn');
    const word = String(rawWord || '').trim().slice(0, 30);
    if (!word) throw new Error('Enter a word');
    this.turn.words.set(team.id, { word, by: playerId });
    if (this.turn.words.size >= this.teams.length - 1) this.chooseWord();
  }

  // Actor (or host, playerId = null) starts the timer. Returns the timer length in ms.
  startTimer(playerId, now = Date.now()) {
    if (this.phase !== 'ready') throw new Error('Not ready to start');
    if (playerId !== null && playerId !== this.turn.actorId) throw new Error('Only the actor can start');
    this.turn.endsAt = now + this.settings.seconds * 1000;
    this.phase = 'acting';
    return this.settings.seconds * 1000;
  }

  // A member of the team that wrote the word confirms the result.
  judge(playerId, correct) {
    if (this.phase !== 'acting') throw new Error('No turn running');
    const team = this.teamOf(playerId);
    if (!team || team.id !== this.turn.chosenTeamId) throw new Error('Only the team that wrote the word can judge');
    this.endTurn(correct ? 'guessed' : 'failed');
  }

  timeUp(turnNo) {
    if (this.phase === 'acting' && this.turnNo === turnNo) this.endTurn('timeout');
  }

  // ---------- players joining / leaving ----------

  addPlayer(id) {
    if (!this.active()) return;
    this.smallestTeam().members.push(id);
  }

  removePlayer(id) {
    if (!this.active()) return;
    const team = this.teamOf(id);
    if (!team) return;
    const t = this.turn;
    const inTurn = TURN_PHASES.includes(this.phase);
    let cancel = inTurn && t.actorId === id;
    team.members = team.members.filter((m) => m !== id);

    if (team.members.length < 2) {
      // Team too small: dissolve it, move the leftover player to the smallest team.
      this.teams = this.teams.filter((x) => x !== team);
      if (inTurn && (team.id === t.teamId || team.id === t.chosenTeamId)) cancel = true;
      if (t) t.words.delete(team.id);
      // Its words leave the deck: nobody would be left to judge them.
      this.deck = this.deck.filter((c) => c.teamId !== team.id);
      if (this.teams.length < 2) {
        // Not enough teams left to play: the game ends.
        if (this.teams[0]) this.teams[0].members.push(...team.members);
        this.phase = 'done';
        return;
      }
      for (const m of team.members) this.smallestTeam().members.push(m);
    }
    if (cancel) return this.endTurn('cancelled');
    if (this.phase === 'collecting') return this.beginIfDeckFull();
    if (this.phase === 'writing' && t.words.size >= this.teams.length - 1) this.chooseWord();
    if (this.phase === 'picking' && !this.eligibleCards(t.teamId).length) this.phase = 'writing';
  }

  // ---------- internals ----------

  newTeam(members) {
    const team = { id: this.nextTeamId++, members, score: 0, actorIdx: 0 };
    this.teams.push(team);
    return team;
  }

  teamOf(playerId) {
    return this.teams.find((t) => t.members.includes(playerId));
  }

  smallestTeam() {
    const min = Math.min(...this.teams.map((t) => t.members.length));
    const options = this.teams.filter((t) => t.members.length === min);
    return options[Math.floor(this.rng() * options.length)];
  }

  startTurn() {
    if (this.phase === 'collecting') shuffle(this.deck, this.rng); // mix the cards once
    const team = this.teams[this.turnIdx];
    const actorId = team.members[team.actorIdx % team.members.length];
    team.actorIdx += 1; // teammates take turns acting
    this.turnNo += 1;
    this.turn = {
      teamId: team.id,
      actorId,
      words: new Map(), // live-writing fallback: teamId -> { word, by }
      cardId: null, // card picked from the deck
      chosenTeamId: null,
      word: null,
      endsAt: null,
      result: null,
    };
    // Pick from the deck; if no card from another team is left, the other teams write live.
    this.phase = this.eligibleCards(team.id).length ? 'picking' : 'writing';
  }

  // Cards the playing team may pick: never their own, and only cards that still leave
  // every other team enough cards that aren't theirs for their remaining turns.
  eligibleCards(teamId) {
    const others = this.deck.filter((c) => c.teamId !== teamId);
    const R = this.deck.length;
    const left = (t) => Math.max(0, this.settings.rounds - (this.turnsPlayed.get(t.id) || 0));
    const own = (t) => this.deck.filter((c) => c.teamId === t.id).length;
    const fair = others.filter((card) => this.teams.every((z) => {
      if (z.id === teamId) return true;
      const before = left(z) <= R - own(z);
      const after = left(z) <= R - 1 - (own(z) - (card.teamId === z.id ? 1 : 0));
      return !before || after; // a pick may not break a team that is still OK
    }));
    return fair.length ? fair : others;
  }

  takeCard(card) {
    this.deck = this.deck.filter((c) => c !== card);
    this.turn.cardId = card.id;
    this.turn.chosenTeamId = card.teamId;
    this.turn.word = card.word;
    this.phase = 'ready';
  }

  chooseWord() {
    const entries = [...this.turn.words.entries()];
    const [teamId, { word }] = entries[Math.floor(this.rng() * entries.length)];
    this.turn.chosenTeamId = teamId;
    this.turn.word = word;
    this.phase = 'ready';
  }

  endTurn(outcome) {
    const t = this.turn;
    let pointTo = null;
    if (outcome === 'guessed') pointTo = t.teamId;
    else if (outcome !== 'cancelled') pointTo = t.chosenTeamId;
    const team = this.teams.find((x) => x.id === pointTo);
    if (team) team.score += 1;
    t.result = { outcome, pointTo: team ? team.id : null };
    t.endsAt = null;
    this.turnsPlayed.set(t.teamId, (this.turnsPlayed.get(t.teamId) || 0) + 1);
    this.playedThisRound.add(t.teamId);
    this.phase = 'turnResult';
    // Round over when every team has played; the game ends after the last round.
    if (this.teams.every((x) => this.playedThisRound.has(x.id))) {
      if (this.round >= this.settings.rounds) this.phase = 'done';
      else {
        this.round += 1;
        this.playedThisRound.clear();
      }
    }
  }

  // ---------- views ----------

  teamName(team) {
    return team ? team.members.map((m) => (this.players.get(m) || { name: '?' }).name).join(' & ') : '(gone)';
  }

  teamById(id) {
    return this.teams.find((t) => t.id === id);
  }

  resultView() {
    const t = this.turn;
    if (!t || !t.result) return null;
    return {
      outcome: t.result.outcome,
      word: t.word,
      playingTeam: this.teamName(this.teamById(t.teamId)),
      writerTeam: t.chosenTeamId ? this.teamName(this.teamById(t.chosenTeamId)) : null,
      pointTeam: t.result.pointTo ? this.teamName(this.teamById(t.result.pointTo)) : null,
    };
  }

  teamsView() {
    return [...this.teams]
      .sort((a, b) => b.score - a.score)
      .map((t) => ({ id: t.id, name: this.teamName(t), score: t.score, members: t.members }));
  }

  winners() {
    if (this.phase !== 'done' || !this.teams.length) return [];
    const top = Math.max(...this.teams.map((t) => t.score));
    return this.teams.filter((t) => t.score === top).map((t) => this.teamName(t));
  }

  timerMs(now) {
    return this.phase === 'acting' ? Math.max(0, this.turn.endsAt - now) : null;
  }

  turnView(now) {
    const t = this.turn;
    if (!t || this.phase === 'lobby') return null;
    return {
      playingTeam: this.teamName(this.teamById(t.teamId)),
      actorName: (this.players.get(t.actorId) || { name: '?' }).name,
      wordsIn: t.words.size,
      wordsNeeded: this.teams.length - 1,
      writerTeam: t.chosenTeamId ? this.teamName(this.teamById(t.chosenTeamId)) : null,
      timerMs: this.timerMs(now),
      cardId: t.cardId,
    };
  }

  // Word-collecting progress per team (no words, only counts).
  collectingView() {
    if (this.phase !== 'collecting') return null;
    return this.teams.map((t) => ({
      name: this.teamName(t),
      count: this.deck.filter((c) => c.teamId === t.id).length,
      need: this.settings.rounds,
    }));
  }

  // Face-down cards offered this turn (ids only) and how many are left in the deck.
  deckView() {
    const offered = this.phase === 'picking' ? this.eligibleCards(this.turn.teamId).map((c) => c.id) : [];
    return { left: this.deck.length, offered };
  }

  boardView(now = Date.now()) {
    return {
      phase: this.phase,
      minPlayers: MIN_PLAYERS,
      settings: { ...this.settings },
      round: this.round,
      teams: this.teamsView(),
      turn: this.turnView(now),
      result: this.resultView(),
      winners: this.winners(),
      collecting: this.collectingView(),
      deck: this.deckView(),
    };
  }

  playerView(id, now = Date.now()) {
    const t = this.turn;
    const team = this.teamOf(id);
    const view = {
      phase: this.phase,
      settings: { ...this.settings },
      round: this.round,
      myTeam: team ? { name: this.teamName(team), score: team.score } : null,
      role: null, // actor | guesser | writer | judge | watcher
      word: null,
      myTeamWord: null,
      turn: this.turnView(now),
      result: this.resultView(),
      teams: this.teamsView().map(({ name, score }) => ({ name, score })),
      winners: this.winners(),
      collecting: this.collectingView(),
      myWords: [],
      cards: [],
    };
    if (this.phase === 'collecting' && team) {
      view.myWords = this.deck.filter((c) => c.teamId === team.id).map(({ id, word }) => ({ id, word }));
    }
    if (!t || !TURN_PHASES.includes(this.phase) || !team) return view;

    if (team.id === t.teamId) {
      view.role = id === t.actorId ? 'actor' : 'guesser';
      if (id === t.actorId && this.phase === 'picking') view.cards = this.deckView().offered;
      if (id === t.actorId && this.phase !== 'writing' && this.phase !== 'picking') view.word = t.word;
    } else if (this.phase === 'picking') {
      view.role = 'watcher';
    } else if (this.phase === 'writing') {
      view.role = 'writer';
      const mine = t.words.get(team.id);
      view.myTeamWord = mine ? mine.word : null;
    } else if (team.id === t.chosenTeamId) {
      view.role = 'judge';
      view.word = t.word;
    } else {
      view.role = 'watcher';
    }
    return view;
  }
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { TeamGame, MIN_PLAYERS };
