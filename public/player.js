'use strict';

const socket = io();
const app = document.getElementById('app');
const urlCode = new URLSearchParams(location.search).get('code') || '';

let playerId = load('playerId');
let state = null;
let hideWord = false;
let lastWord = null;
let joinError = '';
let showHelp = false;

trackConnection(socket);

socket.on('connect', () => {
  if (!playerId) return render();
  socket.emit('join', { playerId }, (res) => {
    if (!res.ok) forget(res.error);
  });
});

socket.on('state', (s) => {
  state = s;
  const word = s.mode === 'teams' ? s.team.word : s.word;
  if (word !== lastWord) {
    lastWord = word;
    hideWord = false;
  }
  render();
});

socket.on('kicked', () => forget('You were removed by the host.'));

function forget(msg) {
  playerId = null;
  state = null;
  save('playerId', null);
  joinError = msg || '';
  render();
}

function render() {
  if (!playerId || !state) return renderJoin();
  const s = state;
  let body = '';
  const draft = app.querySelector('#word');
  const draftValue = draft ? draft.value : '';
  const draftFocused = draft && document.activeElement === draft;

  if (s.mode === 'teams') {
    body = s.team.phase === 'lobby'
      ? `<p class="big">You're in!</p><p>Mode: Act &amp; Draw. Waiting for the host to start.</p>${namesList(s.players)}`
      : teamBody(s.team);
  } else if (s.phase === 'lobby') {
    body = `<p class="big">You're in!</p><p>Waiting for the host to start.</p>${namesList(s.players)}`;
  } else if (s.phase === 'done') {
    body = `<p class="big">Rotation complete</p><p>Everyone has been the imposter once.</p>${scoreList(s.players)}`;
  } else if (s.phase === 'result') {
    body = `${resultHtml(s.result)}<p class="muted">Waiting for the next game…</p>`;
  } else if (!s.inGame) {
    body = `<p class="big">Game in progress</p><p>You'll play from the next game.</p>`;
  } else {
    body = `<p class="round">Round ${s.round} / ${s.maxRounds}</p>
      ${wordCard(s.word)}
      ${roundNoteHtml(s.roundNote)}
      ${s.phase === 'clues' ? '<p>Say one thing about your word. The host starts the vote.</p>' : voteHtml(s)}`;
  }

  const pts = s.mode === 'teams' ? (s.team.myTeam ? s.team.myTeam.score : 0) : s.me.score;
  app.innerHTML = `<header class="me"><span>${esc(s.me.name)}</span>
    <span>${pts} pts <button class="help-btn" data-help>${showHelp ? '&times;' : '?'}</button></span></header>
    ${showHelp ? helpHtml(s.mode, false) : ''}${body}`;

  app.querySelector('[data-help]').onclick = () => { showHelp = !showHelp; render(); };
  const card = app.querySelector('.word');
  if (card) card.onclick = () => { hideWord = !hideWord; render(); };
  app.querySelectorAll('[data-vote]').forEach((b) => {
    b.onclick = () => socket.emit('vote', b.dataset.vote, (res) => { if (!res.ok) alert(res.error); });
  });

  // Act & Draw controls
  const input = app.querySelector('#word');
  if (input) {
    if (draftValue) input.value = draftValue;
    if (draftFocused) input.focus();
  }
  const form = app.querySelector('#wordForm');
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const value = input.value;
      input.value = '';
      send('team:word', value);
    };
  }
  const go = app.querySelector('[data-go]');
  if (go) go.onclick = () => send('team:go');
  app.querySelectorAll('[data-judge]').forEach((b) => {
    b.onclick = () => send('team:judge', b.dataset.judge === '1');
  });
  startCountdown(s.mode === 'teams' && s.team.turn ? s.team.turn.timerMs : null);
}

function send(event, arg = null) {
  socket.emit(event, arg, (res) => { if (!res.ok) alert(res.error); });
}

// ---------- Act & Draw ----------

function teamBody(t) {
  const scores = `<ol class="scores">${t.teams.map((x) => `<li><span>${esc(x.name)}</span><b>${x.score}</b></li>`).join('')}</ol>`;
  const myTeam = t.myTeam ? `<p class="muted">Your team: ${esc(t.myTeam.name)}</p>` : '';
  if (t.phase === 'done') {
    return `<p class="big">Game over</p>${teamResultHtml(t.result)}
      <p class="big">Winner: <b>${t.winners.map(esc).join(', ') || '-'}</b></p>${scores}`;
  }
  if (t.phase === 'turnResult') {
    return `${teamResultHtml(t.result)}${scores}<p class="muted">Waiting for the next turn&hellip;</p>`;
  }
  const turn = t.turn;
  const timer = t.phase === 'acting' ? '<p class="timer"></p>' : '';
  const progress = `Other teams are writing your word&hellip; ${turn.wordsIn} / ${turn.wordsNeeded}`;
  const rules = `<p>Act or draw it. Don't say it, don't point at it.</p>`;

  switch (t.role) {
    case 'actor':
      if (t.phase === 'writing') return `${myTeam}<p class="big">You act / draw this turn!</p><p>${progress}</p>`;
      if (t.phase === 'ready') return `${myTeam}${wordCard(t.word)}${rules}<button data-go>Start timer</button>`;
      return `${timer}${wordCard(t.word)}${rules}`;
    case 'guesser':
      if (t.phase === 'writing') return `${myTeam}<p class="big">You guess this turn!</p><p>${esc(turn.actorName)} will act or draw. ${progress}</p>`;
      if (t.phase === 'ready') return `${myTeam}<p class="big">Get ready to guess!</p><p>${esc(turn.actorName)} is about to start.</p>`;
      return `${timer}<p class="big">Guess out loud!</p>`;
    case 'writer':
      return `${myTeam}<p class="big">Write a word for ${esc(turn.playingTeam)}</p>
        <form id="wordForm"><input id="word" maxlength="30" autocomplete="off" placeholder="A word or short phrase" required><button type="submit">Submit</button></form>
        <p class="muted">${t.myTeamWord ? `Your team's word: <b>${esc(t.myTeamWord)}</b> (you can change it)` : 'One word per team. Any teammate can submit.'}</p>`;
    case 'judge':
      if (t.phase === 'ready') return `${myTeam}<p class="big">Your team's word was picked!</p>${wordCard(t.word)}<p>Waiting for ${esc(turn.actorName)} to start.</p>`;
      return `${timer}${wordCard(t.word)}<p class="big">Did ${esc(turn.playingTeam)} guess it?</p>
        <div class="judge"><button class="ok" data-judge="1">Correct</button><button class="fail" data-judge="0">Fail</button></div>
        <p class="muted">Fail = they broke the rules or gave up. Time running out also counts as a fail.</p>`;
    default:
      return `${myTeam}${timer}<p class="big">${esc(turn.playingTeam)} is playing</p><p>${esc(turn.actorName)} acts / draws.</p>`;
  }
}

function wordCard(word) {
  return `<button class="word">${hideWord ? 'Tap to show your word' : esc(word)}<small>${hideWord ? '' : 'tap to hide'}</small></button>`;
}

function voteHtml(s) {
  const btn = (id, label) => `<button data-vote="${esc(id)}" class="${s.myVote === id ? 'picked' : ''}">${esc(label)}</button>`;
  return `<p class="big">Who is the imposter?</p>
    <div class="votes">${s.options.map((o) => btn(o.id, o.name)).join('')}${btn('skip', 'Skip')}</div>
    <p class="muted">${s.myVote ? 'Vote sent. You can change it until voting closes.' : 'Tap a name.'}</p>`;
}

function renderJoin() {
  const prev = {
    code: app.querySelector('#code')?.value ?? urlCode,
    name: app.querySelector('#name')?.value ?? load('name') ?? '',
  };
  app.innerHTML = `<h1>Who is the Imposter?</h1>
    <form id="join">
      <label>Room code<input id="code" maxlength="4" autocomplete="off" autocapitalize="characters" value="${esc(prev.code)}" required></label>
      <label>Your name<input id="name" maxlength="16" autocomplete="off" value="${esc(prev.name)}" required></label>
      <button type="submit">Join</button>
      <p class="error">${esc(joinError)}</p>
    </form>`;
  app.querySelector('#join').onsubmit = (e) => {
    e.preventDefault();
    const code = app.querySelector('#code').value;
    const name = app.querySelector('#name').value;
    socket.emit('join', { code, name }, (res) => {
      if (!res.ok) {
        joinError = res.error;
        return renderJoin();
      }
      playerId = res.playerId;
      joinError = '';
      save('playerId', playerId);
      save('name', name);
    });
  };
}

const namesList = (players) => `<ul class="names">${players.map((p) => `<li>${esc(p.name)}</li>`).join('')}</ul>`;
const scoreList = (players) => `<ol class="scores">${players.map((p) => `<li><span>${esc(p.name)}</span><b>${p.score}</b></li>`).join('')}</ol>`;

function load(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function save(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ }
}
