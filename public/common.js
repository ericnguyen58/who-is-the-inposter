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
