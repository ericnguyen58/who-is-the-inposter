'use strict';

const socket = io();
const app = document.getElementById('app');
const urlCode = new URLSearchParams(location.search).get('code') || '';

let playerId = load('playerId');
let state = null;
let hideWord = false;
let lastTeamPhase = null;
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
  // Act & Draw: words hide by themselves when the timer starts (tap to peek).
  const teamPhase = s.mode === 'teams' ? s.team.phase : null;
  if (teamPhase === 'acting' && lastTeamPhase !== 'acting') hideWord = true;
  lastTeamPhase = teamPhase;
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
    body = `<p class="big">All games played</p><p>Final scores:</p>${scoreList(s.players)}`;
  } else if (s.phase === 'result') {
    body = `${resultHtml(s.result)}<p class="muted">Waiting for the next game…</p>`;
  } else if (!s.inGame) {
    body = `<p class="big">Game in progress</p><p>You'll play from the next game.</p>`;
  } else if (s.phase === 'voting') {
    body = `<p class="round">Round ${s.round} / ${s.maxRounds} &middot; Your word: <b>${hideWord ? '&bull;&bull;&bull;' : esc(s.word)}</b></p>
      ${voteHtml(s)}`;
  } else {
    body = `<p class="round">Round ${s.round} / ${s.maxRounds}</p>
      ${wordCard(s.word)}
      ${roundNoteHtml(s.roundNote)}
      <p>Say one thing about your word. The host starts the vote.</p>`;
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
  const deckForm = app.querySelector('#deckForm');
  if (deckForm) {
    deckForm.onsubmit = (e) => {
      e.preventDefault();
      const value = input.value;
      input.value = '';
      input.focus();
      send('team:addWord', value);
    };
  }
  app.querySelectorAll('[data-unword]').forEach((b) => { b.onclick = () => send('team:removeWord', b.dataset.unword); });
  app.querySelectorAll('.card.pickable').forEach((c) => { c.onclick = () => send('team:pickCard', c.dataset.card); });
  runFlips();
  const rollBtn = app.querySelector('[data-roll]');
  if (rollBtn) rollBtn.onclick = () => send('team:roll');
  runDice();
  const go = app.querySelector('[data-go]');
  if (go) go.onclick = () => send('team:go');
  app.querySelectorAll('[data-judge]').forEach((b) => {
    b.onclick = () => send('team:judge', b.dataset.judge === '1');
  });
  startCountdown(s.mode === 'teams' ? (s.team.turn ? s.team.turn.timerMs : null) : s.voteTimerMs, s.mode === 'teams' ? 10 : 3);
}

function send(event, arg = null) {
  socket.emit(event, arg, (res) => { if (!res.ok) alert(res.error); });
}

// ---------- Act & Draw ----------

// Deck animation state (so cards deal / flip only once, not on every update).
let phoneDealtKey = '';
let phoneFlipped = null;
let phoneDiceTurn = null;

function teamBody(t) {
  const scores = `<ol class="scores">${scoreRowsHtml(t.teams)}</ol>`;
  const myTeam = `<p class="muted">${t.myTeam ? `Your team: ${esc(t.myTeam.name)} &middot; ` : ''}Round ${t.round} / ${t.settings.rounds}</p>`;
  if (t.phase === 'done') {
    return `<p class="big">Game over</p>${teamResultHtml(t.result)}
      <p class="big">Winner: <b>${t.winners.map(esc).join(', ') || '-'}</b></p>${scores}`;
  }
  if (t.phase === 'turnResult') {
    return `${teamResultHtml(t.result)}${scores}<p class="muted">Waiting for the next turn&hellip;</p>`;
  }
  if (t.phase === 'collecting') {
    const need = t.settings.rounds;
    const done = t.myWords.length >= need;
    const others = t.collecting.map((c) => `<li><span>${esc(c.name)}</span><b>${c.count} / ${c.need}</b></li>`).join('');
    return `${myTeam}
      <p class="big">${done ? 'Your team is done!' : `Write ${need} word${need === 1 ? '' : 's'} for the other teams`}</p>
      ${done ? '<p>Waiting for the other teams&hellip;</p>' : `<form id="deckForm">
        <input id="word" maxlength="30" autocomplete="off" placeholder="A word or short phrase" required>
        <button type="submit">Add word</button></form>`}
      <p class="muted">${t.myWords.length} / ${need} &middot; only your team sees these</p>
      <ul class="my-words">${t.myWords.map((w) => `<li><span>${esc(w.word)}</span>
        <button class="kick" data-unword="${w.id}" title="Remove">&times;</button></li>`).join('')}</ul>
      <h2>All teams</h2><ol class="scores">${others}</ol>`;
  }
  const turn = t.turn;
  const timer = t.phase === 'acting' ? '<p class="timer"></p>' : '';
  const progress = `Other teams are writing your word&hellip; ${turn.wordsIn} / ${turn.wordsNeeded}`;
  const rules = `<p>Act or draw it. Don't say it, don't point at it.</p>`;

  // Dice: tumbles once per roll on every phone, then stays on its face.
  const rolled = !!turn.dice;
  let dice = '';
  if (t.phase === 'rolling') dice = diceHtml(null);
  if (t.phase === 'ready' && rolled) {
    dice = diceHtml(turn.dice, turn.turnNo !== phoneDiceTurn, t.role === 'actor' ? null : turn.actorName);
    phoneDiceTurn = turn.turnNo;
  }
  const style = t.phase === 'acting' ? diceStyleLine(turn.dice, t.role === 'actor' ? null : turn.actorName) : '';
  const timesUp = `<p class="timer low">0s</p><p class="big">Time's up!</p>`;
  const waitJudge = `<p>Waiting for ${esc(turn.writerTeam || '')} to decide.</p>`;

  switch (t.role) {
    case 'actor':
      if (t.phase === 'picking') {
        const key = t.cards.join(',');
        const deal = key !== phoneDealtKey;
        phoneDealtKey = key;
        return `${myTeam}<p class="big">You act / draw! Pick a card</p>
          <div class="cards">${t.cards.map((id, i) => cardHtml(id, '', { cls: `pickable${deal ? ' deal' : ''}`, delay: i * 50 })).join('')}</div>
          <p class="muted">Words from the other teams. Only you will see it.</p>`;
      }
      if (t.phase === 'writing') return `${myTeam}<p class="big">You act / draw this turn!</p><p>${progress}</p>`;
      if (t.phase === 'rolling') {
        let card = wordCard(t.word);
        if (turn.cardId) {
          const anim = turn.cardId !== phoneFlipped;
          phoneFlipped = turn.cardId;
          card = `<div class="cards single">${cardHtml(turn.cardId, `<span class="card-word">${esc(t.word)}</span>`, { cls: `big ${anim ? 'flip' : 'flipped'}` })}</div>`;
        }
        return `${myTeam}${card}${dice}<p class="big">Act or draw? Roll the dice!</p><button data-roll>Roll the dice</button>`;
      }
      if (t.phase === 'ready') return `${myTeam}${wordCard(t.word)}${dice}<p>Wait for ${esc(turn.guesserName)} to start the timer.</p>`;
      if (t.phase === 'judging') return `${timesUp}${wordCard(t.word)}${waitJudge}`;
      return `${timer}${style}${wordCard(t.word)}${rules}`;
    case 'guesser':
      if (t.phase === 'picking') return `${myTeam}<p class="big">You guess this turn!</p><p>${esc(turn.actorName)} is picking a card&hellip;</p>`;
      if (t.phase === 'writing') return `${myTeam}<p class="big">You guess this turn!</p><p>${esc(turn.actorName)} will act or draw. ${progress}</p>`;
      if (t.phase === 'rolling') return `${myTeam}<p class="big">Get ready to guess!</p><p>${esc(turn.actorName)} is rolling the dice&hellip;</p>${dice}`;
      if (t.phase === 'ready') return `${myTeam}${dice}<p>Start the timer when ${esc(turn.actorName)} is ready.</p><button data-go>Start timer</button>`;
      if (t.phase === 'judging') return `${timesUp}${waitJudge}`;
      return `${timer}${style}<p class="big">Guess out loud!</p>`;
    case 'writer':
      return `${myTeam}<p class="big">Write a word for ${esc(turn.playingTeam)}</p>
        <form id="wordForm"><input id="word" maxlength="30" autocomplete="off" placeholder="A word or short phrase" required><button type="submit">Submit</button></form>
        <p class="muted">${t.myTeamWord ? `Your team's word: <b>${esc(t.myTeamWord)}</b> (you can change it)` : 'One word per team. Any teammate can submit.'}</p>`;
    case 'judge':
      if (t.phase === 'rolling') return `${myTeam}<p class="big">Your team's word was picked!</p>${wordCard(t.word)}<p>${esc(turn.actorName)} is rolling the dice&hellip;</p>${dice}`;
      if (t.phase === 'ready') return `${myTeam}${wordCard(t.word)}${dice}<p>Waiting for ${esc(turn.guesserName)} to start the timer.</p>`;
      return `${t.phase === 'judging' ? timesUp : `${timer}${style}`}${wordCard(t.word)}<p class="big">Did ${esc(turn.playingTeam)} guess it?</p>
        <div class="judge"><button class="ok" data-judge="1">Correct</button><button class="fail" data-judge="0">Fail</button></div>
        <p class="muted">${t.phase === 'judging'
          ? 'Correct if they got it in time, otherwise Fail.'
          : 'Tap Correct the moment they guess it. Fail = they broke the rules or gave up. You can also decide after the time is up.'}</p>`;
    default:
      if (t.phase === 'rolling') return `${myTeam}<p class="big">${esc(turn.playingTeam)} is playing</p><p>${esc(turn.actorName)} is rolling the dice&hellip;</p>${dice}`;
      if (t.phase === 'judging') return `${myTeam}${timesUp}${waitJudge}`;
      return `${myTeam}${timer}${style}${dice}<p class="big">${esc(turn.playingTeam)} is playing</p><p>${esc(turn.actorName)} acts / draws.</p>`;
  }
}

function wordCard(word) {
  return `<button class="word">${hideWord ? 'Tap to show your word' : esc(word)}<small>${hideWord ? '' : 'tap to hide'}</small></button>`;
}

// Game-show vote screen: one big colored tile per player, plus Skip.
const TILE_ICONS = ['\u{1F341}', '\u{1F383}', '\u{1F33D}', '\u{1F967}', '\u{1F983}', '\u{1F330}', '\u{1F34E}', '\u{1F342}'];

function voteHtml(s) {
  const state = (id) => (s.myVote === id ? 'picked' : s.myVote ? 'dim' : '');
  const tiles = s.options.map((o, i) => `<button data-vote="${esc(o.id)}" class="tile t${i % 8} ${state(o.id)}">
      <span class="icon">${TILE_ICONS[i % TILE_ICONS.length]}</span><span>${esc(o.name)}</span>
    </button>`).join('');
  return `<div class="vote-head"><span class="timer ring"></span><p class="big">Who is the imposter?</p></div>
    <div class="tiles">${tiles}</div>
    <button data-vote="skip" class="tile skip ${state('skip')}">Skip</button>
    <p class="muted">${s.myVote ? 'Vote locked in. Tap another tile to change it.' : 'Tap a tile before time runs out!'}</p>`;
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
const scoreList = (players) => `<ol class="scores">${scoreRowsHtml(players)}</ol>`;

function load(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function save(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ }
}
