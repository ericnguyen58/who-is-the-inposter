'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Game, MAX_ROUNDS } = require('../game');

function setup(n = 4) {
  const g = new Game();
  for (let i = 1; i <= n; i++) g.addPlayer('p' + i, 'P' + i);
  return g;
}

const crew = (g) => g.current.participants.filter((p) => p !== g.current.imposterId);

// Everyone votes for `target` (the target votes for someone else).
function voteAll(g, target) {
  for (const p of g.current.participants) {
    if (g.phase !== 'voting') return;
    g.vote(p, p === target ? (target === 'skip' ? 'skip' : g.current.participants.find((x) => x !== p)) : target);
  }
}

test('everyone is imposter exactly once per rotation', () => {
  for (let run = 0; run < 50; run++) {
    const g = setup(6);
    g.start();
    const seen = [];
    while (g.phase !== 'done') {
      seen.push(g.current.imposterId);
      g.startVote();
      voteAll(g, g.current.imposterId);
      g.next();
    }
    assert.deepStrictEqual([...seen].sort(), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  }
});

test('late joiner gets a turn in the current rotation; leaver is skipped', () => {
  const g = setup(4);
  g.start();
  const first = g.current.imposterId;
  g.addPlayer('p5', 'P5');
  const leaver = g.queue[0];
  g.removePlayer(leaver);
  const seen = [first];
  assert.ok(!g.current.participants.includes('p5'), 'late joiner waits for next game');
  g.startVote();
  voteAll(g, g.current.imposterId);
  while (g.phase !== 'done') {
    g.next();
    if (g.phase === 'done') break;
    seen.push(g.current.imposterId);
    g.startVote();
    voteAll(g, g.current.imposterId);
  }
  const expected = ['p1', 'p2', 'p3', 'p4', 'p5'].filter((p) => p !== leaver).sort();
  assert.deepStrictEqual(seen.sort(), expected);
});

test('imposter only sees a different word', () => {
  const g = setup(4);
  g.start();
  const imp = g.current.imposterId;
  const words = g.current.participants.map((p) => g.playerView(p).word);
  const impWord = g.playerView(imp).word;
  assert.strictEqual(words.filter((w) => w === impWord).length, 1);
  assert.notStrictEqual(g.current.crewWord, g.current.imposterWord);
  assert.ok(!('imposterId' in g.playerView(imp)), 'player view does not reveal the imposter');
});

test('catching the imposter gives +1 to everyone else', () => {
  const g = setup(4);
  g.start();
  const imp = g.current.imposterId;
  g.startVote();
  voteAll(g, imp);
  assert.strictEqual(g.phase, 'result');
  assert.strictEqual(g.current.result.winner, 'crew');
  for (const p of g.players.values()) assert.strictEqual(p.score, p.id === imp ? 0 : 1);
});

test('wrong vote: imposter wins at once with points = round number', () => {
  const g = setup(4);
  g.start();
  const imp = g.current.imposterId;
  g.startVote();
  voteAll(g, 'skip'); // round 1: skip
  assert.strictEqual(g.phase, 'clues');
  assert.strictEqual(g.current.round, 2);
  assert.strictEqual(g.roundNote.reason, 'skip');
  g.startVote();
  voteAll(g, crew(g)[0]); // round 2: wrong person
  assert.strictEqual(g.current.result.winner, 'imposter');
  assert.strictEqual(g.players.get(imp).score, 2);
  for (const id of crew(g)) assert.strictEqual(g.players.get(id).score, 0);
});

test('tie means nobody out; surviving all 5 rounds gives 5 points', () => {
  const g = setup(4);
  g.start();
  const imp = g.current.imposterId;
  const [a, b] = crew(g);
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    g.startVote();
    g.vote(a, b);
    g.vote(b, a);
    g.closeVote(); // 1-1 tie, others did not vote
    if (r < MAX_ROUNDS) {
      assert.strictEqual(g.phase, 'clues');
      assert.strictEqual(g.roundNote.reason, 'tie');
    }
  }
  assert.strictEqual(g.phase, 'result');
  assert.strictEqual(g.current.result.winner, 'imposter');
  assert.strictEqual(g.current.result.votedOutId, null);
  assert.strictEqual(g.players.get(imp).score, 5);
});

test('votes: no self vote, voting closes when all have voted', () => {
  const g = setup(3);
  g.start();
  g.startVote();
  assert.throws(() => g.vote('p1', 'p1'));
  assert.throws(() => g.vote('p1', 'nobody'));
  g.vote('p1', 'skip');
  g.vote('p1', 'p2'); // changing a vote is allowed
  assert.strictEqual(g.current.votes.get('p1'), 'p2');
  g.vote('p2', 'p3');
  assert.strictEqual(g.phase, 'voting');
  g.vote('p3', 'p2');
  assert.notStrictEqual(g.phase, 'voting');
});

test('imposter leaving mid-game cancels it with no points', () => {
  const g = setup(4);
  g.start();
  g.removePlayer(g.current.imposterId);
  assert.strictEqual(g.phase, 'result');
  assert.ok(g.current.result.cancelled);
  for (const p of g.players.values()) assert.strictEqual(p.score, 0);
});

test('names must be unique and start needs 3 players', () => {
  const g = new Game();
  g.addPlayer('a', 'Ann');
  assert.throws(() => g.addPlayer('b', ' ann '));
  g.addPlayer('b', 'Bob');
  assert.throws(() => g.start());
  g.addPlayer('c', 'Cat');
  g.start();
  assert.strictEqual(g.phase, 'clues');
});

test('vote lasts 10 seconds; only the current vote timer closes it', () => {
  const g = setup(4);
  g.start();
  const ms = g.startVote(1000);
  assert.strictEqual(ms, 10000);
  assert.strictEqual(g.boardView(new Set(), 4000).voteTimerMs, 7000);
  const first = g.voteNo;
  const imp = g.current.imposterId;
  const [a, b] = crew(g);
  g.vote(a, imp);
  g.vote(b, imp); // 2 of 4 voted when time runs out
  g.voteTimeUp(first - 1); // stale timer: ignored
  assert.strictEqual(g.phase, 'voting');
  g.voteTimeUp(first);
  assert.strictEqual(g.current.result.winner, 'crew', 'votes already in are counted');
  assert.strictEqual(g.boardView().voteTimerMs, null);
});

test('host sets rounds per game', () => {
  const g = setup(4);
  g.setSettings({ maxRounds: 3 });
  g.start();
  assert.throws(() => g.setSettings({ maxRounds: 2 }), /Wait/);
  const imp = g.current.imposterId;
  for (let r = 1; r <= 3; r++) {
    g.startVote();
    g.closeVote(); // no votes = nobody out
  }
  assert.strictEqual(g.current.result.winner, 'imposter');
  assert.strictEqual(g.players.get(imp).score, 3);
  g.setSettings({ maxRounds: 99 });
  assert.strictEqual(g.settings.maxRounds, 10); // clamped
});

test('host sets number of games; rotation continues fairly past one cycle', () => {
  const g = setup(3);
  g.setSettings({ games: 7 });
  g.start();
  const seen = [];
  while (g.phase !== 'done') {
    seen.push(g.current.imposterId);
    assert.strictEqual(g.boardView().totalGames, 7);
    g.startVote();
    voteAll(g, g.current.imposterId);
    g.next();
  }
  assert.strictEqual(seen.length, 7);
  assert.deepStrictEqual(seen.slice(0, 3).sort(), ['p1', 'p2', 'p3']);
  assert.deepStrictEqual(seen.slice(3, 6).sort(), ['p1', 'p2', 'p3']);
  for (let i = 1; i < seen.length; i++) assert.notStrictEqual(seen[i], seen[i - 1], 'no imposter twice in a row');

  const h = setup(5);
  h.setSettings({ games: 2 });
  h.start();
  h.startVote(); voteAll(h, h.current.imposterId); h.next();
  h.startVote(); voteAll(h, h.current.imposterId); h.next();
  assert.strictEqual(h.phase, 'done', 'fewer games than players ends early');
});

test('reset stops the game, zeroes scores, keeps players and settings', () => {
  const g = setup(4);
  g.setSettings({ maxRounds: 3 });
  g.start();
  g.startVote();
  voteAll(g, g.current.imposterId);
  assert.ok([...g.players.values()].some((p) => p.score > 0));
  g.next();
  g.reset();
  assert.strictEqual(g.phase, 'lobby');
  assert.strictEqual(g.players.size, 4);
  assert.ok([...g.players.values()].every((p) => p.score === 0 && !p.wasImposter));
  assert.strictEqual(g.settings.maxRounds, 3);
  g.start(); // can play again
  assert.strictEqual(g.phase, 'clues');
});

test('test words are used while test bots are on', () => {
  const testPairs = require('../words-test');
  const g = setup(4);
  g.useTestWords = true;
  g.start();
  const words = [g.current.crewWord, g.current.imposterWord].sort();
  assert.ok(testPairs.some((p) => [...p].sort().join() === words.join()));
});
