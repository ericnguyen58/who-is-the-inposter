'use strict';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function resultHtml(r) {
  if (r.cancelled) {
    return `<div class="banner muted">Game cancelled</div><p>The imposter (${esc(r.imposterName)}) left. No points.</p>`;
  }
  const head = r.winner === 'imposter'
    ? `<div class="banner bad">Imposter wins! +${r.points}</div>`
    : `<div class="banner good">Imposter caught! Everyone else +1</div>`;
  const how = r.winner === 'crew'
    ? `Caught in round ${r.round}.`
    : r.votedOutName
      ? `${esc(r.votedOutName)} was voted out by mistake in round ${r.round}.`
      : `Survived all ${r.round} rounds.`;
  return `${head}${voteBoardHtml(r.tally)}
    <p class="big">Imposter: <b>${esc(r.imposterName)}</b></p>
    <p>Everyone's word: <b>${esc(r.crewWord)}</b> &middot; Imposter's word: <b>${esc(r.imposterWord)}</b></p>
    <p>${how}</p>`;
}

// Vote reveal: a leaderboard when votes went to more than one choice,
// otherwise only the one who was voted out.
function voteBoardHtml(tally) {
  if (!tally || !tally.length) return '<p class="muted">No votes</p>';
  if (tally.length === 1) {
    const t = tally[0];
    return t.name === 'Skip'
      ? '<div class="voted-out"><span>Everyone skipped</span></div>'
      : `<div class="voted-out"><span>Voted out</span><b>${esc(t.name)}</b></div>`;
  }
  const max = tally[0].count;
  const rows = tally.map((t, i) => `<li class="${t.count === max ? 'top' : ''}">
      <span class="rank">${i + 1}</span>
      <span class="who">${esc(t.name)}</span>
      <span class="bar"><i style="width:${Math.round((t.count / max) * 100)}%"></i></span>
      <b>${t.count}</b>
    </li>`).join('');
  return `<ol class="leaderboard">${rows}</ol>`;
}

function roundNoteHtml(n) {
  if (!n) return '';
  const why = n.reason === 'skip' ? 'Skip won' : 'Tie';
  return `<p class="note">Round ${n.round}: ${why}, nobody is out.</p>${voteBoardHtml(n.tally)}`;
}

function trackConnection(socket) {
  const el = document.getElementById('offline');
  socket.on('connect', () => { el.hidden = true; });
  socket.on('disconnect', () => { el.hidden = false; });
}

function teamResultHtml(r) {
  if (!r) return '';
  const head = {
    guessed: `<div class="banner good">Guessed! +1 ${esc(r.pointTeam)}</div>`,
    failed: `<div class="banner bad">Failed. +1 ${esc(r.pointTeam)}</div>`,
    timeout: `<div class="banner bad">Time's up! +1 ${esc(r.pointTeam)}</div>`,
    cancelled: `<div class="banner muted">Turn cancelled, no points</div>`,
  }[r.outcome];
  const word = r.word ? `<p class="big">The word was <b>${esc(r.word)}</b>${r.writerTeam ? ` (from ${esc(r.writerTeam)})` : ''}</p>` : '';
  return head + word;
}

// Counts down every element with class "timer" to the given remaining time.
// The timer turns red for the last `lowAt` seconds.
let countdownEnd = null;
let countdownLoop = null;
let countdownLow = 10;
function startCountdown(ms, lowAt = 10) {
  countdownEnd = ms == null ? null : performance.now() + ms;
  countdownLow = lowAt;
  const tick = () => {
    if (countdownEnd == null) return;
    const left = Math.max(0, Math.ceil((countdownEnd - performance.now()) / 1000));
    document.querySelectorAll('.timer').forEach((el) => {
      el.textContent = `${left}s`;
      el.classList.toggle('low', left <= countdownLow);
    });
  };
  tick();
  if (!countdownLoop) countdownLoop = setInterval(tick, 250);
}

// "How to play" panel. forHost = true on the laptop scoreboard.
function helpHtml(mode, forHost) {
  const list = (items) => `<ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
  if (mode === 'teams') {
    const steps = forHost
      ? [
        'Set <b>Timer</b> and <b>Rounds</b>, then tap <b>Make random teams &amp; start</b> (4+ players).',
        'Every team writes one word per round on their phones. Turns start when all teams are done (or tap <b>Start now with the words in</b>).',
        'The actor picks a face-down card on their phone. Here it only shows <b>Picked!</b> and the team that wrote it.',
        'The actor taps <b>Start timer</b> on their phone (or tap it here).',
        'The actor acts or draws on paper. The teammate guesses out loud.',
        'The team that wrote the word taps <b>Correct</b> or <b>Fail</b>. Time running out = fail.',
        'Tap <b>Next turn</b>. A round = every team plays once. Most points after the last round wins.',
      ]
      : [
        'Before the first turn, your team writes one word per round. Only your team sees them.',
        'When your team plays, the actor picks a face-down card from the other teams\u2019 words, sees the word and taps <b>Start timer</b>.',
        'The actor acts or draws it on paper. No saying it, no pointing at it. The teammate guesses out loud.',
        'If your team’s word is picked, you judge: tap <b>Correct</b> or <b>Fail</b>.',
      ];
    return `<div class="help"><h2>Act &amp; Draw</h2>${list(steps)}
      <p><b>Points:</b> guessed = +1 to the playing team. Fail or time up = +1 to the team that wrote the word.</p></div>`;
  }
  const steps = forHost
    ? [
      'Tap <b>Start game</b> (3+ players). Each phone shows a word.',
      'Everyone says one clue about their word out loud.',
      'Tap <b>Start vote</b>. Music plays and phones vote for a player or Skip. The vote lasts 10 seconds.',
      'Tie or Skip = nobody out, next round (up to the rounds per game).',
      'Tap <b>Next game</b>. Everyone is the imposter once per rotation.',
    ]
    : [
      'Your word is on the screen. Tap it to hide it.',
      'One player has a different word: the imposter. Nobody is told who, maybe not even you.',
      'Each round, say one clue about your word out loud. Don’t say the word.',
      'When the vote starts, tap the tile of who you think has the different word, or Skip. You have 10 seconds.',
    ];
  return `<div class="help"><h2>Imposter</h2>${list(steps)}
    <p><b>Points:</b> imposter caught = +1 to everyone else. Wrong player voted out, or last round survived = imposter wins points equal to the round number.</p></div>`;
}

// ---------- Act & Draw word cards ----------

// A playing card with a back (face down) and a front. Classes on the card:
//   flipped = shows the front, flip = flips over once right after render (see runFlips),
//   deal = slides in (staggered by `delay` ms), fade = a card that was not picked.
function cardHtml(id, front, { cls = '', delay = 0 } = {}) {
  return `<div class="card ${cls}" data-card="${id}" style="--d:${delay}ms">
    <div class="card-inner">
      <div class="card-back"><span>\u{1F342}</span></div>
      <div class="card-front">${front}</div>
    </div>
  </div>`;
}

// Starts the flip animation on cards rendered with class "flip".
function runFlips() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('.card.flip').forEach((c) => c.classList.add('flipped'));
  }));
}
