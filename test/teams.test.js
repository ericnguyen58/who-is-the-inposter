'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { TeamGame } = require('../teams');

function setup(n = 4, settings) {
  const players = new Map();
  for (let i = 1; i <= n; i++) players.set('p' + i, { name: 'P' + i });
  const g = new TeamGame({ players });
  if (settings) g.setSettings(settings);
  return g;
}

const teamById = (g, id) => g.teams.find((t) => t.id === id);
const writers = (g) => g.teams.filter((t) => t.id !== g.turn.teamId);

// Every team writes one word per round.
function fillDeck(g) {
  for (const t of g.teams) {
    for (let i = 0; i < g.settings.rounds; i++) g.addWord(t.members[i % t.members.length], `t${t.id}w${i}`);
  }
}

// Live-writing fallback: every other team submits a word.
function writeAll(g) {
  for (const t of writers(g)) g.submitWord(t.members[0], 'word' + t.id);
}

// Gets the current turn to 'ready': word from the deck (or live fallback), then the dice roll.
function getWord(g) {
  if (g.phase === 'picking') g.pickCard(g.turn.actorId, g.playerView(g.turn.actorId).cards[0]);
  else writeAll(g);
  g.roll(g.turn.actorId);
}

const judgeOf = (g) => teamById(g, g.turn.chosenTeamId).members[0];

test('random teams of 2, one team of 3 when odd', () => {
  const even = setup(6);
  even.start();
  assert.deepStrictEqual(even.teams.map((t) => t.members.length), [2, 2, 2]);
  const odd = setup(5);
  odd.start();
  assert.deepStrictEqual(odd.teams.map((t) => t.members.length).sort(), [2, 3]);
  assert.throws(() => setup(3).start());
});

test('teams write one word per round before the first turn', () => {
  const g = setup(4, { rounds: 2 });
  g.start();
  assert.strictEqual(g.phase, 'collecting');
  const [a, b] = g.teams;
  g.addWord(a.members[0], 'Cat');
  assert.throws(() => g.addWord(a.members[1], 'cat'), /already/);
  g.addWord(a.members[1], 'Dog');
  assert.throws(() => g.addWord(a.members[0], 'Fish'), /all its words/);
  assert.deepStrictEqual(g.playerView(a.members[1]).myWords.map((w) => w.word), ['Cat', 'Dog']);
  assert.deepStrictEqual(g.playerView(b.members[0]).myWords, [], 'teams only see their own words');
  const dog = g.deck.find((c) => c.word === 'Dog');
  assert.throws(() => g.removeWord(b.members[0], dog.id), /Not your word/);
  g.removeWord(a.members[0], dog.id);
  g.addWord(a.members[0], 'Dog');
  g.addWord(b.members[0], 'Sun');
  assert.strictEqual(g.phase, 'collecting');
  g.addWord(b.members[1], 'Moon');
  assert.strictEqual(g.phase, 'picking', 'turns start once every team is done');
  assert.deepStrictEqual(g.collectingView(), null);
});

test('cards offered never include the playing team\'s own words; picked cards leave the deck', () => {
  const g = setup(6, { rounds: 2 });
  g.start();
  fillDeck(g);
  const actor = g.turn.actorId;
  const offered = g.playerView(actor).cards;
  assert.ok(offered.length > 0);
  for (const id of offered) assert.notStrictEqual(g.deck.find((c) => c.id === id).teamId, g.turn.teamId);
  const guesser = teamById(g, g.turn.teamId).members.find((m) => m !== actor);
  assert.deepStrictEqual(g.playerView(guesser).cards, [], 'only the actor gets the cards');
  assert.throws(() => g.pickCard(guesser, offered[0]), /actor/);
  const card = g.deck.find((c) => c.id === offered[0]);
  g.pickCard(actor, card.id);
  assert.strictEqual(g.phase, 'rolling');
  assert.strictEqual(g.turn.word, card.word);
  assert.strictEqual(g.turn.chosenTeamId, card.teamId, 'the team that wrote it judges');
  assert.ok(!g.deck.includes(card));
  assert.strictEqual(g.deck.length, 5);
  assert.strictEqual(g.playerView(actor).word, card.word);
  assert.strictEqual(g.playerView(guesser).word, null);
  assert.strictEqual(g.boardView().deck.left, 5);
});

test('the deck always covers every turn with another team\'s card', () => {
  for (let run = 0; run < 200; run++) {
    const n = 4 + 2 * (run % 4); // 2..5 teams
    const g = setup(n, { rounds: 1 + (run % 3) });
    g.start();
    fillDeck(g);
    let turns = 0;
    while (g.phase !== 'done') {
      assert.strictEqual(g.phase, 'picking', 'never falls back to live writing');
      const cards = g.playerView(g.turn.actorId).cards;
      g.pickCard(g.turn.actorId, cards[Math.floor(Math.random() * cards.length)]);
      assert.notStrictEqual(g.turn.chosenTeamId, g.turn.teamId);
      g.roll(null);
      g.startTimer(null);
      g.judge(judgeOf(g), Math.random() < 0.5);
      turns++;
      if (g.phase === 'turnResult') g.next();
    }
    assert.strictEqual(turns, g.teams.length * g.settings.rounds);
    assert.strictEqual(g.deck.length, 0, 'every card used once');
  }
});

test('host can start before all words are in; missing cards fall back to live writing', () => {
  const g = setup(4, { rounds: 2 });
  g.start();
  g.begin(); // no words at all
  assert.strictEqual(g.phase, 'writing');
  writeAll(g);
  assert.strictEqual(g.phase, 'rolling');
  const h = setup(4, { rounds: 1 });
  h.start();
  h.addWord(h.teams[0].members[0], 'Only');
  h.begin();
  if (h.turn.teamId === h.teams[0].id) assert.strictEqual(h.phase, 'writing');
  else {
    assert.strictEqual(h.phase, 'picking');
    h.pickRandom();
    assert.strictEqual(h.turn.word, 'Only');
  }
});

test('correct guess: +1 to the playing team', () => {
  const g = setup(4);
  g.start();
  fillDeck(g);
  getWord(g);
  g.startTimer(null);
  const playing = g.turn.teamId;
  g.judge(judgeOf(g), true);
  assert.strictEqual(teamById(g, playing).score, 1);
  assert.strictEqual(g.phase, 'turnResult');
});

test('fail or time up: +1 to the team that wrote the word', () => {
  const g = setup(4);
  g.start();
  fillDeck(g);
  getWord(g);
  g.startTimer(null);
  const writer = g.turn.chosenTeamId;
  assert.throws(() => g.judge(teamById(g, g.turn.teamId).members[0], true), /Only the team/);
  g.judge(teamById(g, writer).members[1], false);
  assert.strictEqual(teamById(g, writer).score, 1);

  g.next();
  getWord(g);
  g.startTimer(null);
  const writer2 = g.turn.chosenTeamId;
  g.timeUp(g.turnNo - 1); // stale timer from an old turn does nothing
  assert.strictEqual(g.phase, 'acting');
  g.timeUp(g.turnNo);
  assert.strictEqual(g.phase, 'judging', 'time up waits for the writing team');
  g.judge(teamById(g, writer2).members[0], false);
  assert.strictEqual(g.turn.result.outcome, 'timeout');
  assert.strictEqual(teamById(g, writer2).score, 1 + (writer2 === writer ? 1 : 0));
});

test('teams take turns and teammates swap acting', () => {
  const g = setup(4, { rounds: 2 });
  g.start();
  fillDeck(g);
  const order = [];
  for (let i = 0; i < 4; i++) {
    order.push([g.turn.teamId, g.turn.actorId]);
    getWord(g);
    g.startTimer(null);
    g.judge(judgeOf(g), i % 2 === 0);
    if (g.phase === 'turnResult') g.next();
  }
  assert.notStrictEqual(order[0][0], order[1][0]);
  assert.strictEqual(order[0][0], order[2][0]);
  assert.notStrictEqual(order[0][1], order[2][1], 'actor swaps on the team\'s next turn');
});

test('game lasts the chosen number of rounds; settings are clamped', () => {
  const g = setup(6, { rounds: 2, seconds: 45 });
  assert.strictEqual(g.settings.seconds, 45);
  g.setSettings({ seconds: 5, rounds: 0 });
  assert.deepStrictEqual(g.settings, { seconds: 10, rounds: 1 });
  g.setSettings({ seconds: 30, rounds: 2 });
  g.start();
  fillDeck(g);
  const played = [];
  let ms;
  while (g.phase !== 'done') {
    played.push([g.round, g.turn.teamId]);
    getWord(g);
    ms = g.startTimer(null);
    g.judge(judgeOf(g), played.length % 2 === 1);
    if (g.phase === 'turnResult') g.next();
  }
  assert.strictEqual(ms, 30000);
  assert.strictEqual(played.length, 6, '3 teams x 2 rounds');
  for (const r of [1, 2]) {
    const teams = played.filter(([round]) => round === r).map(([, id]) => id).sort();
    assert.deepStrictEqual(teams, g.teams.map((t) => t.id).sort(), `each team once in round ${r}`);
  }
  const top = Math.max(...g.teams.map((t) => t.score));
  assert.deepStrictEqual(g.winners().sort(), g.teams.filter((t) => t.score === top).map((t) => g.teamName(t)).sort());
  g.toLobby();
  assert.strictEqual(g.phase, 'lobby');
  assert.strictEqual(g.deck.length, 0);
});

test('actor leaving cancels the turn; a dissolved team\'s cards leave the deck', () => {
  const g = setup(6);
  g.start();
  fillDeck(g);
  const actor = g.turn.actorId;
  const playing = g.turn.teamId;
  g.removePlayer(actor);
  assert.strictEqual(g.turn.result.outcome, 'cancelled');
  assert.ok(!g.teams.some((t) => t.id === playing), 'team of 1 is dissolved');
  assert.ok(!g.deck.some((c) => c.teamId === playing), 'its cards are gone');
  assert.strictEqual(g.teams.reduce((n, t) => n + t.members.length, 0), 5);
  g.next();
  assert.ok(['picking', 'writing'].includes(g.phase));
});

test('late joiner goes to the smallest team', () => {
  const g = setup(5);
  g.start();
  g.players.set('p6', { name: 'P6' });
  g.addPlayer('p6');
  assert.deepStrictEqual(g.teams.map((t) => t.members.length).sort(), [3, 3]);
});

test('reset clears teams, deck and scores and goes back to the lobby', () => {
  const g = setup(4, { rounds: 2 });
  g.start();
  fillDeck(g);
  getWord(g);
  g.startTimer(null);
  g.judge(judgeOf(g), true);
  g.reset();
  assert.strictEqual(g.phase, 'lobby');
  assert.strictEqual(g.teams.length, 0);
  assert.strictEqual(g.deck.length, 0);
  assert.strictEqual(g.settings.rounds, 2);
  g.start();
  assert.ok(g.teams.every((t) => t.score === 0));
});

test('actor rolls act-or-draw after picking; the teammate starts the timer', () => {
  const g = setup(4);
  g.start();
  fillDeck(g);
  const actor = g.turn.actorId;
  const mate = teamById(g, g.turn.teamId).members.find((m) => m !== actor);
  g.pickCard(actor, g.playerView(actor).cards[0]);
  assert.strictEqual(g.phase, 'rolling');
  assert.throws(() => g.startTimer(mate), /Not ready/);
  assert.throws(() => g.roll(mate), /Only the actor/);
  g.roll(actor);
  assert.strictEqual(g.phase, 'ready');
  const dice = g.boardView().turn.dice;
  assert.ok(dice.face >= 0 && dice.face < 6);
  assert.strictEqual(dice.style, dice.face % 2 === 0 ? 'act' : 'draw');
  assert.deepStrictEqual(g.playerView(judgeOf(g)).turn.dice, dice, 'every device gets the roll');
  assert.throws(() => g.startTimer(actor), /teammate/);
  assert.throws(() => g.startTimer(judgeOf(g)), /teammate/);
  g.startTimer(mate);
  assert.strictEqual(g.phase, 'acting');
});

test('dice lands on act and draw about half the time each', () => {
  const counts = { act: 0, draw: 0 };
  for (let i = 0; i < 600; i++) {
    const g = setup(4);
    g.start();
    g.begin();
    writeAll(g);
    g.roll(null);
    counts[g.turn.dice.style]++;
  }
  assert.ok(counts.act > 220 && counts.draw > 220, JSON.stringify(counts));
});

test('after time is up the writing team can still approve; the host can judge for bots', () => {
  const g = setup(4);
  g.start();
  fillDeck(g);
  getWord(g);
  g.startTimer(null);
  g.timeUp(g.turnNo);
  assert.strictEqual(g.phase, 'judging');
  assert.strictEqual(g.boardView().turn.timerMs, null);
  const playing = g.turn.teamId;
  assert.throws(() => g.judge(teamById(g, playing).members[0], true), /Only the team/);
  g.judge(judgeOf(g), true);
  assert.strictEqual(g.turn.result.outcome, 'guessed');
  assert.strictEqual(teamById(g, playing).score, 1);

  g.next();
  getWord(g);
  g.startTimer(null);
  g.judge(null, false); // host
  assert.strictEqual(g.turn.result.outcome, 'failed');
});
