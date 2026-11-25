'use strict';

const socket = io();
const app = document.getElementById('app');
const urlCode = new URLSearchParams(location.search).get('code') || '';

let playerId = load('playerId');
let state = null;
let hideWord = false;
let lastWord = null;
let joinError = '';

trackConnection(socket);

socket.on('connect', () => {
  if (!playerId) return render();
  socket.emit('join', { playerId }, (res) => {
    if (!res.ok) forget(res.error);
  });
});

socket.on('state', (s) => {
  state = s;
  if (s.word !== lastWord) {
    lastWord = s.word;
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

  if (s.phase === 'lobby') {
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

  app.innerHTML = `<header class="me"><span>${esc(s.me.name)}</span><span>${s.me.score} pts</span></header>${body}`;

  const card = app.querySelector('.word');
  if (card) card.onclick = () => { hideWord = !hideWord; render(); };
  app.querySelectorAll('[data-vote]').forEach((b) => {
    b.onclick = () => socket.emit('vote', b.dataset.vote, (res) => { if (!res.ok) alert(res.error); });
  });
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
