'use strict';

const WORD_PAIRS = require('./words');
const TEST_PAIRS = require('./words-test');

const MAX_ROUNDS = 5; // default rounds per game; the host can change it
const MIN_PLAYERS = 3;
const VOTE_SECONDS = 10; // each vote lasts the first 10 seconds of the music
const SKIP = 'skip';

// Phases: lobby -> clues <-> voting -> result -> (next game) clues ... -> done
class Game {
  constructor({ rng = Math.random, pairs = WORD_PAIRS, testPairs = TEST_PAIRS } = {}) {
    this.rng = rng;
    this.pairs = pairs;
    this.testPairs = testPairs;
    this.useTestWords = false; // true while test bots are on
    this.players = new Map(); // id -> { id, name, score, wasImposter }
    this.phase = 'lobby';
    this.queue = []; // players still waiting for their imposter turn in this rotation
    this.usedPairs = new Set(); // "word|word" keys of pairs already played
    this.lastImposterId = null;
    this.gameNo = 0;
    this.current = null; // the game in progress
    this.roundNote = null; // what happened in the last round when nobody was voted out
    this.voteNo = 0; // counts votes, so an old vote timer can't close a newer vote
    // maxRounds: clue + vote rounds per game. games: games per session, 0 = everyone is imposter once.
    this.settings = { maxRounds: MAX_ROUNDS, games: 0 };
  }

  // ---------- players ----------

  addPlayer(id, rawName) {
    const name = String(rawName || '').trim().slice(0, 16);
    if (!name) throw new Error('Enter a name');
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) throw new Error('That name is taken');
    }
    this.players.set(id, { id, name, score: 0, wasImposter: false });
    // Joined mid-rotation: give them a random spot among the players still waiting.
    if (this.inRotation()) {
      const at = Math.floor(this.rng() * (this.queue.length + 1));
      this.queue.splice(at, 0, id);
    }
    return this.players.get(id);
  }

  removePlayer(id) {
    if (!this.players.has(id)) return;
    this.players.delete(id);
    this.queue = this.queue.filter((q) => q !== id);
    const g = this.current;
    if (!g || !g.participants.includes(id)) return;
    g.participants = g.participants.filter((p) => p !== id);
    if (this.phase !== 'clues' && this.phase !== 'voting') return;
    if (id === g.imposterId) {
      // Imposter left: the game is cancelled, nobody scores.
      g.result = { winner: null, cancelled: true, votedOutId: null, tally: {}, points: 0, round: g.round };
      this.phase = 'result';
      return;
    }
    g.votes.delete(id);
    for (const [voter, target] of g.votes) if (target === id) g.votes.delete(voter);
    if (this.phase === 'voting' && g.votes.size >= g.participants.length) this.closeVote();
  }

  inRotation() {
    return this.phase !== 'lobby' && this.phase !== 'done';
  }

  // ---------- host actions ----------

  setSettings({ maxRounds, games } = {}) {
    if (this.phase === 'clues' || this.phase === 'voting') throw new Error('Wait until the game is over');
    if (maxRounds !== undefined) this.settings.maxRounds = clamp(maxRounds, 1, 10);
    if (games !== undefined) this.settings.games = clamp(games, 0, 50);
  }

  start() {
    if (this.inRotation()) throw new Error('A rotation is already running');
    if (this.players.size < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players`);
    this.newRotation();
    this.gameNo = 0;
    this.startGame();
  }

  // Stops any game, sets scores to 0 and goes back to the lobby. Players and settings stay.
  reset() {
    this.phase = 'lobby';
    this.queue = [];
    this.current = null;
    this.roundNote = null;
    this.gameNo = 0;
    for (const p of this.players.values()) {
      p.score = 0;
      p.wasImposter = false;
    }
  }

  next() {
    if (this.phase !== 'result') throw new Error('The current game is not finished');
    this.startGame();
  }

  // Returns how long the vote lasts in ms. The server closes it with voteTimeUp().
  startVote(now = Date.now()) {
    if (this.phase !== 'clues') throw new Error('Not in a clue round');
    this.current.votes.clear();
    this.current.voteEndsAt = now + VOTE_SECONDS * 1000;
    this.voteNo += 1;
    this.roundNote = null;
    this.phase = 'voting';
    return VOTE_SECONDS * 1000;
  }

  voteTimeUp(voteNo) {
    if (this.phase === 'voting' && this.voteNo === voteNo) this.closeVote();
  }

  voteTimerMs(now) {
    return this.phase === 'voting' ? Math.max(0, this.current.voteEndsAt - now) : null;
  }

  vote(voterId, target) {
    const g = this.current;
    if (this.phase !== 'voting') throw new Error('Voting is not open');
    if (!g.participants.includes(voterId)) throw new Error('You are not in this game');
    if (target !== SKIP && (!g.participants.includes(target) || target === voterId)) {
      throw new Error('Invalid vote');
    }
    g.votes.set(voterId, target);
    if (g.votes.size >= g.participants.length) this.closeVote();
  }

  closeVote() {
    if (this.phase !== 'voting') throw new Error('Voting is not open');
    const g = this.current;
    const tally = {};
    for (const target of g.votes.values()) tally[target] = (tally[target] || 0) + 1;
    const top = Math.max(0, ...Object.values(tally));
    const leaders = Object.keys(tally).filter((k) => tally[k] === top);

    if (leaders.length !== 1 || leaders[0] === SKIP) {
      // Tie, skip, or no votes: nobody is out.
      if (g.round >= this.settings.maxRounds) return this.endGame('imposter', null, tally);
      this.roundNote = { round: g.round, reason: leaders.length === 1 ? 'skip' : 'tie', tally };
      g.round += 1;
      this.phase = 'clues';
      return;
    }
    const votedOutId = leaders[0];
    this.endGame(votedOutId === g.imposterId ? 'crew' : 'imposter', votedOutId, tally);
  }

  // ---------- internals ----------

  // Shuffles everyone into the imposter queue for a new rotation.
  newRotation() {
    this.queue = shuffle([...this.players.keys()], this.rng);
    // Avoid the same imposter twice in a row across rotations.
    if (this.queue.length > 1 && this.queue[0] === this.lastImposterId) {
      [this.queue[0], this.queue[this.queue.length - 1]] = [this.queue[this.queue.length - 1], this.queue[0]];
    }
    for (const p of this.players.values()) p.wasImposter = false;
  }

  startGame() {
    const limit = this.settings.games;
    if (limit ? this.gameNo >= limit : this.queue.length === 0) {
      this.phase = 'done';
      this.current = null;
      this.roundNote = null;
      return;
    }
    if (this.players.size < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players`);
    // Fixed number of games: when everyone has been imposter, start the next rotation.
    if (this.queue.length === 0) this.newRotation();
    const imposterId = this.queue.shift();
    const pair = this.pickPair();
    const flip = this.rng() < 0.5;
    this.players.get(imposterId).wasImposter = true;
    this.lastImposterId = imposterId;
    this.gameNo += 1;
    this.current = {
      imposterId,
      imposterWord: flip ? pair[0] : pair[1],
      crewWord: flip ? pair[1] : pair[0],
      participants: [...this.players.keys()],
      round: 1,
      votes: new Map(),
      result: null,
    };
    this.roundNote = null;
    this.phase = 'clues';
  }

  pickPair() {
    const list = this.useTestWords ? this.testPairs : this.pairs;
    const key = (p) => p.join('|');
    let free = list.filter((p) => !this.usedPairs.has(key(p)));
    if (!free.length) {
      for (const p of list) this.usedPairs.delete(key(p));
      free = list;
    }
    const pair = free[Math.floor(this.rng() * free.length)];
    this.usedPairs.add(key(pair));
    return pair;
  }

  endGame(winner, votedOutId, tally) {
    const g = this.current;
    let points = 0;
    if (winner === 'imposter') {
      points = g.round; // 1 point per round survived, max = rounds per game
      const imp = this.players.get(g.imposterId);
      if (imp) imp.score += points;
    } else {
      points = 1;
      for (const id of g.participants) {
        if (id !== g.imposterId && this.players.has(id)) this.players.get(id).score += 1;
      }
    }
    g.result = { winner, cancelled: false, votedOutId, tally, points, round: g.round };
    this.roundNote = null;
    this.phase = 'result';
  }

  // ---------- views ----------

  name(id) {
    if (id === SKIP) return 'Skip';
    const p = this.players.get(id);
    return p ? p.name : '(left)';
  }

  namedTally(tally) {
    return Object.entries(tally || {})
      .map(([id, count]) => ({ name: this.name(id), count }))
      .sort((a, b) => b.count - a.count);
  }

  resultView() {
    const g = this.current;
    if (this.phase !== 'result' || !g) return null;
    const r = g.result;
    return {
      winner: r.winner,
      cancelled: r.cancelled,
      points: r.points,
      round: r.round,
      imposterId: g.imposterId,
      imposterName: this.name(g.imposterId),
      votedOutName: r.votedOutId ? this.name(r.votedOutId) : null,
      crewWord: g.crewWord,
      imposterWord: g.imposterWord,
      tally: this.namedTally(r.tally),
    };
  }

  roundNoteView() {
    if (!this.roundNote) return null;
    return { ...this.roundNote, tally: this.namedTally(this.roundNote.tally) };
  }

  scores() {
    return [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, score: p.score, wasImposter: p.wasImposter }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  boardView(connected = new Set(), now = Date.now()) {
    const g = this.current;
    return {
      phase: this.phase,
      minPlayers: MIN_PLAYERS,
      maxRounds: this.settings.maxRounds,
      settings: { ...this.settings },
      gameNo: this.gameNo,
      totalGames: this.settings.games || this.gameNo + this.queue.length,
      round: g ? g.round : 0,
      players: this.scores().map((p) => ({
        ...p,
        connected: connected.has(p.id),
        inGame: !!g && g.participants.includes(p.id),
        voted: this.phase === 'voting' && g.votes.has(p.id),
      })),
      votesIn: this.phase === 'voting' ? g.votes.size : 0,
      voteTimerMs: this.voteTimerMs(now),
      votesNeeded: g ? g.participants.length : 0,
      roundNote: this.roundNoteView(),
      result: this.resultView(),
    };
  }

  playerView(id, now = Date.now()) {
    const me = this.players.get(id);
    if (!me) return null;
    const g = this.current;
    const inGame = !!g && g.participants.includes(id) && (this.phase === 'clues' || this.phase === 'voting' || this.phase === 'result');
    const view = {
      phase: this.phase,
      me: { id, name: me.name, score: me.score },
      inGame,
      maxRounds: this.settings.maxRounds,
      round: g ? g.round : 0,
      word: null,
      options: [],
      myVote: null,
      voteTimerMs: this.voteTimerMs(now),
      roundNote: this.roundNoteView(),
      result: this.resultView(),
      players: this.scores().map((p) => ({ name: p.name, score: p.score })),
    };
    if (inGame) {
      view.word = id === g.imposterId ? g.imposterWord : g.crewWord;
      if (this.phase === 'voting') {
        view.options = g.participants.filter((p) => p !== id).map((p) => ({ id: p, name: this.name(p) }));
        view.myVote = g.votes.get(id) || null;
      }
    }
    return view;
  }
}

function clamp(n, lo, hi) {
  n = Math.round(Number(n));
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

module.exports = { Game, MAX_ROUNDS, MIN_PLAYERS, SKIP, VOTE_SECONDS };
