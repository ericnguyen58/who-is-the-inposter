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

// Every other team submits a word; returns to 'ready'.
function writeAll(g) {
  for (const t of writers(g)) g.submitWord(t.members[0], 'word' + t.id);
}

test('random teams of 2, one team of 3 when odd', () => {
  const even = setup(6);
  even.start();
  assert.deepStrictEqual(even.teams.map((t) => t.members.length), [2, 2, 2]);
  const odd = setup(5);
  odd.start();
  assert.deepStrictEqual(odd.teams.map((t) => t.members.length).sort(), [2, 3]);
  assert.throws(() => setup(3).start());
});

test('word is picked once every other team has submitted', () => {
  const g = setup(6);
  g.start();
  const [a, b] = writers(g);
  assert.throws(() => g.submitWord(teamById(g, g.turn.teamId).members[0], 'x'), /playing/);
  g.submitWord(a.members[0], 'cat');
  g.submitWord(a.members[1], 'dog'); // teammate overwrites
  assert.strictEqual(g.phase, 'writing');
  g.submitWord(b.members[0], 'fish');
  assert.strictEqual(g.phase, 'ready');
  assert.ok(['dog', 'fish'].includes(g.turn.word));
  assert.strictEqual(g.turn.words.get(g.turn.chosenTeamId).word, g.turn.word);
});

test('only the actor sees the word in the playing team; only the writing team judges', () => {
  const g = setup(4);
  g.start();
  writeAll(g);
  const playing = teamById(g, g.turn.teamId);
  const guesser = playing.members.find((m) => m !== g.turn.actorId);
  assert.strictEqual(g.playerView(g.turn.actorId).word, g.turn.word);
  assert.strictEqual(g.playerView(guesser).word, null);
  assert.throws(() => g.startTimer(guesser));
  g.startTimer(g.turn.actorId, 0);
  assert.throws(() => g.judge(guesser, true), /Only the team/);
  const judge = teamById(g, g.turn.chosenTeamId).members[0];
  assert.strictEqual(g.playerView(judge).role, 'judge');
  assert.strictEqual(g.playerView(judge).word, g.turn.word);
});

test('correct guess: +1 to the playing team', () => {
  const g = setup(4);
  g.start();
  writeAll(g);
  g.startTimer(null);
  const playing = g.turn.teamId;
  g.judge(teamById(g, g.turn.chosenTeamId).members[0], true);
  assert.strictEqual(teamById(g, playing).score, 1);
  assert.strictEqual(g.phase, 'turnResult');
});

test('fail or time up: +1 to the team that wrote the word', () => {
  const g = setup(4);
  g.start();
  writeAll(g);
  g.startTimer(null);
  const writer = g.turn.chosenTeamId;
  g.judge(teamById(g, writer).members[1], false);
  assert.strictEqual(teamById(g, writer).score, 1);

  g.next();
  writeAll(g);
  g.startTimer(null);
  const writer2 = g.turn.chosenTeamId;
  g.timeUp(g.turnNo - 1); // stale timer from an old turn does nothing
  assert.strictEqual(g.phase, 'acting');
  g.timeUp(g.turnNo);
  assert.strictEqual(g.turn.result.outcome, 'timeout');
  assert.strictEqual(teamById(g, writer2).score, 1 + (writer2 === writer ? 1 : 0));
});

test('teams take turns and teammates swap acting', () => {
  const g = setup(4);
  g.start();
  const order = [];
  for (let i = 0; i < 4; i++) {
    order.push([g.turn.teamId, g.turn.actorId]);
    writeAll(g);
    g.startTimer(null);
    g.judge(teamById(g, g.turn.chosenTeamId).members[0], i % 2 === 0); // alternate outcomes
    g.next();
  }
  assert.notStrictEqual(order[0][0], order[1][0]);
  assert.strictEqual(order[0][0], order[2][0]);
  assert.notStrictEqual(order[0][1], order[2][1], 'actor swaps on the team\'s next turn');
});

test('game lasts the chosen number of rounds; every team plays once per round', () => {
  const g = setup(6, { rounds: 2, seconds: 45 });
  assert.strictEqual(g.settings.seconds, 45);
  g.setSettings({ seconds: 5, rounds: 0 });
  assert.deepStrictEqual(g.settings, { seconds: 10, rounds: 1 }); // clamped
  g.setSettings({ seconds: 30, rounds: 2 });
  g.start();
  const played = [];
  let ms;
  while (g.phase !== 'done') {
    played.push([g.round, g.turn.teamId]);
    writeAll(g);
    ms = g.startTimer(null);
    g.judge(teamById(g, g.turn.chosenTeamId).members[0], played.length % 2 === 1);
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
});

test('actor leaving cancels the turn; a lone player joins another team', () => {
  const g = setup(6);
  g.start();
  writeAll(g);
  const actor = g.turn.actorId;
  const playing = g.turn.teamId;
  g.removePlayer(actor);
  assert.strictEqual(g.turn.result.outcome, 'cancelled');
  assert.ok(!g.teams.some((t) => t.id === playing), 'team of 1 is dissolved');
  assert.strictEqual(g.teams.reduce((n, t) => n + t.members.length, 0), 5);
  g.next();
  assert.strictEqual(g.phase, 'writing');
});

test('late joiner goes to the smallest team', () => {
  const g = setup(5);
  g.start();
  g.players.set('p6', { name: 'P6' });
  g.addPlayer('p6');
  assert.deepStrictEqual(g.teams.map((t) => t.members.length).sort(), [3, 3]);
});
