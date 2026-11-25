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
  const tally = r.tally.length
    ? `<ul class="tally">${r.tally.map((t) => `<li>${esc(t.name)} <b>${t.count}</b></li>`).join('')}</ul>`
    : '';
  return `${head}
    <p class="big">Imposter: <b>${esc(r.imposterName)}</b></p>
    <p>Everyone's word: <b>${esc(r.crewWord)}</b> &middot; Imposter's word: <b>${esc(r.imposterWord)}</b></p>
    <p>${how}</p>${tally}`;
}

function roundNoteHtml(n) {
  if (!n) return '';
  const why = n.reason === 'skip' ? 'Skip won' : 'Tie';
  return `<p class="note">Round ${n.round}: ${why}, nobody is out.</p>`;
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
let countdownEnd = null;
let countdownLoop = null;
function startCountdown(ms) {
  countdownEnd = ms == null ? null : performance.now() + ms;
  const tick = () => {
    if (countdownEnd == null) return;
    const left = Math.max(0, Math.ceil((countdownEnd - performance.now()) / 1000));
    document.querySelectorAll('.timer').forEach((el) => {
      el.textContent = `${left}s`;
      el.classList.toggle('low', left <= 10);
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
        'Set <b>Timer</b> and <b>Win at</b>, then tap <b>Make random teams &amp; start</b> (4+ players).',
        'Other teams type a word on their phones. To stop waiting, tap <b>Pick from the words in now</b>.',
        'The actor taps <b>Start timer</b> on their phone (or tap it here).',
        'The actor acts or draws on paper. The teammate guesses out loud.',
        'The team that wrote the word taps <b>Correct</b> or <b>Fail</b>. Time running out = fail.',
        'Tap <b>Next turn</b>. First team to the win score wins.',
      ]
      : [
        'When another team plays, your team types one word for them and taps <b>Submit</b>.',
        'When your team plays, the actor sees the word and taps <b>Start timer</b>.',
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
      'Tap <b>Start vote</b>. Phones vote for a player or Skip. Tap <b>Close vote now</b> to end it early.',
      'Tie or Skip = nobody out, next round (max 5 rounds).',
      'Tap <b>Next game</b>. Everyone is the imposter once per rotation.',
    ]
    : [
      'Your word is on the screen. Tap it to hide it.',
      'One player has a different word: the imposter. Nobody is told who, maybe not even you.',
      'Each round, say one clue about your word out loud. Don’t say the word.',
      'Vote for who you think has the different word, or Skip.',
    ];
  return `<div class="help"><h2>Imposter</h2>${list(steps)}
    <p><b>Points:</b> imposter caught = +1 to everyone else. Wrong player voted out, or 5 rounds survived = imposter wins points equal to the round number.</p></div>`;
}
