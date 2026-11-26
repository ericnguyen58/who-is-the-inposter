'use strict';

const socket = io();
const app = document.getElementById('app');
let board = null;
let showHelp = false;

trackConnection(socket);

socket.on('connect', () => {
  socket.emit('host:hello', (res) => {
    if (!res.ok) app.innerHTML = `<p class="error big">${esc(res.error)}</p>`;
  });
});

// Act & Draw deck animation state (so cards deal / flip only once, not on every update).
let lastOffered = [];
let dealtKey = '';
let flippedCard = null;
let coinShownTurn = null;
let soundTurn = null; // Act & Draw turn whose result sound already played

socket.on('board', (b) => {
  if (b.mode === 'teams' && b.team.phase === 'picking') lastOffered = b.team.deck.offered;
  // Act & Draw: announce the result once with a sound.
  const tr = b.mode === 'teams' && ['turnResult', 'done'].includes(b.team.phase) ? b.team.result : null;
  if (tr && b.team.turn && b.team.turn.turnNo !== soundTurn) {
    soundTurn = b.team.turn.turnNo;
    if (board && board.mode === 'teams' && ['acting', 'judging'].includes(board.team.phase)) {
      if (tr.outcome === 'guessed') VoteMusic.correct();
      else if (tr.outcome !== 'cancelled') VoteMusic.wrong();
    }
  }
  const cm = b.customMusic || {};
  VoteMusic.setCustom(cm.vote ? `/custom-music/vote?v=${cm.vote.version}` : null);
  LobbyMusic.setSource(cm.lobby ? `/custom-music/lobby?v=${cm.lobby.version}` : null);
  // Music plays while an Imposter vote is open.
  const voting = b.mode === 'imposter' && b.phase === 'voting';
  const wasVoting = !!board && board.mode === 'imposter' && board.phase === 'voting';
  if (voting && !wasVoting) VoteMusic.start();
  if (!voting && wasVoting) {
    VoteMusic.stop();
    if (b.phase !== 'lobby') VoteMusic.sting(); // no chord after Reset
  }
  board = b;
  render();
});

// Secret dev shortcut: Cmd + Shift + B (Mac) / Ctrl + Shift + B (Windows)
// adds 10 idle bots for testing. Press again to remove them.
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    act('host:bots');
  }
});

// Browsers only allow sound after a click on the page.
document.addEventListener('click', () => {
  VoteMusic.unlock();
  LobbyMusic.retry();
}, true);

function act(event, arg = null) {
  socket.emit(event, arg, (res) => { if (!res.ok) alert(res.error); });
}

function render() {
  const b = board;
  const teams = b.mode === 'teams';
  app.innerHTML = `
    <section class="join">
      <img src="${b.qr}" alt="QR code to join">
      <p>Scan or open<br><b>${esc(b.joinUrl.replace(/\?.*/, ''))}</b></p>
      <p class="code">${esc(b.code)}</p>
      <button class="secondary" data-help>${showHelp ? 'Hide help' : 'How to play'}</button>
      <button class="secondary" data-sound>${VoteMusic.isMuted() ? 'Sound: off' : 'Sound: on'}</button>
      <button class="secondary" data-reset>Reset</button>
      ${b.testing ? testPanelHtml() : ''}
      ${showHelp ? helpHtml(b.mode, true) : ''}
    </section>
    <section class="stage">${b.canSwitch ? modeSwitch(b) : ''}${teams ? teamStage(b.team, b.players.length) : stage(b)}</section>
    <section class="scoreboard">${teams ? teamScoreboard(b) : `
      <h2>Scores</h2>
      <ol class="scores">${(() => { const r = scoreRanks(b.players); return b.players.map((p, i) => row(p, r[i])).join(''); })()}</ol>`}
    </section>`;

  app.querySelectorAll('[data-act]').forEach((el) => { el.onclick = () => act(el.dataset.act); });
  app.querySelector('[data-help]').onclick = () => { showHelp = !showHelp; render(); };
  app.querySelector('[data-sound]').onclick = () => {
    VoteMusic.setMuted(!VoteMusic.isMuted());
    if (!VoteMusic.isMuted() && b.mode === 'imposter' && b.phase === 'voting') VoteMusic.start();
    render();
  };
  app.querySelector('[data-reset]').onclick = () => {
    if (confirm('Reset? This stops the game, sets all scores to 0 and goes back to the lobby. Players stay joined.')) {
      stopMusicTest();
      act('host:reset');
    }
  };
  const musicBtn = app.querySelector('[data-music-test]');
  if (musicBtn) musicBtn.onclick = () => (musicTestEnd ? stopMusicTest() : startMusicTest());
  app.querySelectorAll('[data-host-judge]').forEach((el) => { el.onclick = () => act('team:hostJudge', el.dataset.hostJudge === '1'); });
  app.querySelectorAll('[data-mode]').forEach((el) => { el.onclick = () => act('host:mode', el.dataset.mode); });
  app.querySelectorAll('[data-set]').forEach((el) => {
    el.onclick = () => {
      const key = el.dataset.set;
      if (el.dataset.scope === 'imposter') act('host:settings', { [key]: b.settings[key] + Number(el.dataset.delta) });
      else act('team:settings', { [key]: b.team.settings[key] + Number(el.dataset.delta) });
    };
  });
  app.querySelectorAll('[data-kick]').forEach((el) => {
    el.onclick = () => { if (confirm(`Remove ${el.dataset.name}?`)) act('host:kick', el.dataset.kick); };
  });
  startCountdown(teams ? b.team.turn && b.team.turn.timerMs : b.voteTimerMs, teams ? 10 : 3);
  runFlips();
  runCoins();
  // Lobby music loops on the lobby screen until a game starts (paused during the music test).
  const inLobby = (teams ? b.team.phase : b.phase) === 'lobby';
  LobbyMusic.set(inLobby && !musicTestEnd);
}

// ---------- Testing panel (shown while test bots are on) ----------

let musicTestEnd = null;
let musicTestLoop = null;

function testPanelHtml() {
  const cm = (board && board.customMusic) || {};
  const source = `Vote music: ${cm.vote ? `your file (${esc(cm.vote.name)})` : 'built-in'}<br>
    Lobby music: ${cm.lobby ? `your file (${esc(cm.lobby.name)})` : 'none'}`;
  const label = VoteMusic.isMuted()
    ? 'Sound is off'
    : musicTestEnd ? `Stop music (${Math.max(0, Math.ceil((musicTestEnd - Date.now()) / 1000))}s)` : 'Play vote music (10s)';
  return `<div class="help test-panel">
    <h2>Testing</h2>
    <button data-music-test ${VoteMusic.isMuted() ? 'disabled' : ''}>${label}</button>
    <p class="muted">${source}</p>
    <p class="muted">Test words are on (easy pairs like Red / Blue).<br>Cmd/Ctrl + Shift + B removes the bots.</p>
  </div>`;
}

// Plays the vote music for 10 seconds without starting a vote.
function startMusicTest() {
  VoteMusic.start();
  musicTestEnd = Date.now() + 10000;
  musicTestLoop = setInterval(() => {
    if (Date.now() >= musicTestEnd) {
      stopMusicTest();
      VoteMusic.sting();
      return;
    }
    const btn = document.querySelector('[data-music-test]');
    if (btn) btn.textContent = `Stop music (${Math.ceil((musicTestEnd - Date.now()) / 1000)}s)`;
  }, 250);
  render();
}

function stopMusicTest() {
  if (!musicTestEnd) return;
  clearInterval(musicTestLoop);
  musicTestEnd = null;
  // Keep the music if a real vote is running.
  if (!(board && board.mode === 'imposter' && board.phase === 'voting')) VoteMusic.stop();
  if (board) render();
}

function modeSwitch(b) {
  const btn = (m, label) => `<button class="${b.mode === m ? '' : 'secondary'}" data-mode="${m}">${label}</button>`;
  return `<div class="modes">${btn('imposter', 'Imposter')}${btn('teams', 'Act &amp; Draw')}</div>`;
}

// ---------- Act & Draw ----------

function teamStage(t, playerCount) {
  const turnLine = t.turn
    ? `<p class="round">Round ${t.round} / ${t.settings.rounds} &middot; Playing: ${esc(t.turn.playingTeam)} &middot; ${esc(t.turn.actorName)} acts / draws</p>`
    : '';
  switch (t.phase) {
    case 'lobby': {
      const enough = playerCount >= t.minPlayers;
      return `<h1>Act &amp; Draw</h1>
        <p class="big">${playerCount} player${playerCount === 1 ? '' : 's'} joined</p>
        ${settingsHtml(t.settings)}
        <button data-act="team:start" ${enough ? '' : 'disabled'}>Make random teams &amp; start</button>
        ${enough ? '' : `<p class="muted">Need at least ${t.minPlayers} players.</p>`}`;
    }
    case 'collecting': {
      const n = t.settings.rounds;
      return `<h1>Write your words</h1>
        <p class="big">Each team writes ${n} word${n === 1 ? '' : 's'} on their phones.</p>
        <ol class="scores progress">${t.collecting.map((c) => `<li><span>${esc(c.name)}</span>
          <b>${c.count} / ${c.need}${c.count >= c.need ? ' &#10003;' : ''}</b></li>`).join('')}</ol>
        <p class="muted">The game starts by itself when every team is done.</p>
        <button class="secondary" data-act="team:begin">Start now with the words in</button>
        ${settingsHtml(t.settings)}`;
    }
    case 'picking': {
      const key = t.deck.offered.join(',');
      const deal = key !== dealtKey;
      dealtKey = key;
      return `${turnLine}
        <p class="big">${esc(t.turn.actorName)} is picking a card&hellip;</p>
        <div class="cards">${t.deck.offered.map((id, i) => cardHtml(id, '', { cls: deal ? 'deal' : '', delay: i * 60 })).join('')}</div>
        <p class="muted">${t.deck.left} card${t.deck.left === 1 ? '' : 's'} left in the deck &middot; showing the ${t.deck.offered.length} this team can pick</p>
        <button class="secondary" data-act="team:pickRandom">Pick a random card</button>`;
    }
    case 'writing':
      return `${turnLine}
        <p class="big">Other teams are writing a word&hellip; ${t.turn.wordsIn} / ${t.turn.wordsNeeded}</p>
        <button class="secondary" data-act="team:pick" ${t.turn.wordsIn ? '' : 'disabled'}>Pick from the words in now</button>
        ${settingsHtml(t.settings)}`;
    case 'flipping': {
      let cards = '';
      if (t.turn.cardId) {
        // The picked card flips to show "Picked!" (never the word); the others fade.
        const anim = t.turn.cardId !== flippedCard;
        flippedCard = t.turn.cardId;
        const ids = lastOffered.includes(t.turn.cardId) ? lastOffered : [t.turn.cardId];
        const front = `<b>Picked!</b><small>from ${esc(t.turn.writerTeam)}</small>`;
        cards = `<div class="cards">${ids.map((id) => (id === t.turn.cardId
          ? cardHtml(id, front, { cls: `chosen ${anim ? 'flip' : 'flipped'}` })
          : cardHtml(id, '', { cls: 'fade' }))).join('')}</div>`;
      }
      return `${turnLine}${cards}
        <p class="big">Word picked from <b>${esc(t.turn.writerTeam)}</b>.</p>
        <p>${esc(t.turn.actorName)} is flipping the coin: act or draw?</p>
        ${coinHtml(null)}
        <button class="secondary" data-act="team:hostFlip">Flip for ${esc(t.turn.actorName)}</button>`;
    }
    case 'ready': {
      // The coin spins once, then stays on its side.
      const animate = t.turn.turnNo !== coinShownTurn;
      coinShownTurn = t.turn.turnNo;
      return `${turnLine}
        ${coinHtml(t.turn.coin, animate, t.turn.actorName)}
        <p>${esc(t.turn.guesserName)} starts the timer on their phone.</p>
        <button class="secondary" data-act="team:hostGo">Start timer</button>`;
    }
    case 'acting':
      return `${turnLine}
        ${coinStyleLine(t.turn.coin, t.turn.actorName)}
        <p class="timer huge"></p>
        <p class="big">Guess out loud! <b>${esc(t.turn.writerTeam)}</b> confirms on their phone.</p>`;
    case 'judging':
      return `${turnLine}
        <p class="timer huge low">0s</p>
        <p class="big">Time's up! Waiting for <b>${esc(t.turn.writerTeam)}</b> to decide on their phone.</p>
        <div class="judge"><button class="secondary" data-host-judge="1">Correct</button><button class="secondary" data-host-judge="0">Fail</button></div>
        <p class="muted">Host buttons, e.g. when the writing team are bots.</p>`;
    case 'turnResult':
      return `${teamResultHtml(t.result)}
        <button data-act="team:next">Next turn</button>
        ${settingsHtml(t.settings)}`;
    case 'done':
      return `<h1>Game over</h1>
        ${t.result ? teamResultHtml(t.result) : ''}
        <p class="big">Winner: <b>${t.winners.map(esc).join(', ') || '-'}</b></p>
        <button data-act="team:lobby">Back to lobby</button>`;
    default:
      return '';
  }
}

// One "title  − value +" control. scope picks which mode's settings it changes.
function stepper(scope, key, delta, title, value) {
  const btn = (d, sign) => `<button class="step" data-scope="${scope}" data-set="${key}" data-delta="${d}">${sign}</button>`;
  return `<div><span>${title}</span>${btn(-delta, '&minus;')}<b>${value}</b>${btn(delta, '+')}</div>`;
}

function settingsHtml(s) {
  return `<div class="settings">
    ${stepper('team', 'seconds', 10, 'Timer', `${s.seconds}s`)}
    ${stepper('team', 'rounds', 1, 'Rounds', s.rounds)}
  </div>`;
}

function imposterSettingsHtml(s) {
  return `<div class="settings">
    ${stepper('imposter', 'maxRounds', 1, 'Rounds per game', s.maxRounds)}
    ${stepper('imposter', 'games', 1, 'Games', s.games || 'Everyone once')}
  </div>`;
}

function teamScoreboard(b) {
  const t = b.team;
  const teams = t.teams.length
    ? `<h2>Teams</h2><ol class="scores">${scoreRowsHtml(t.teams)}</ol>
       <p class="muted">Round ${t.round} / ${t.settings.rounds} &middot; most points wins</p>`
    : '';
  const players = b.players.map((p) => `<li class="${p.connected || p.bot ? '' : 'away'}">
      <span>${esc(p.name)}</span>
      <button class="kick" data-kick="${esc(p.id)}" data-name="${esc(p.name)}" title="Remove">&times;</button>
    </li>`).join('');
  return `${teams}<h2>Players</h2><ol class="scores">${players}</ol>`;
}

function stage(b) {
  const gameLine = `<p class="round">Game ${b.gameNo} / ${b.totalGames} &middot; Round ${b.round} / ${b.maxRounds}</p>`;
  switch (b.phase) {
    case 'lobby': {
      const enough = b.players.length >= b.minPlayers;
      return `<h1>Who is the Imposter?</h1>
        <p class="big">${b.players.length} player${b.players.length === 1 ? '' : 's'} joined</p>
        ${imposterSettingsHtml(b.settings)}
        <button data-act="host:start" ${enough ? '' : 'disabled'}>Start game</button>
        ${enough ? '' : `<p class="muted">Need at least ${b.minPlayers} players.</p>`}`;
    }
    case 'clues':
      return `${gameLine}${roundNoteHtml(b.roundNote)}
        <p class="big">Everyone say one clue about their word.</p>
        <button data-act="host:startVote">Start vote</button>`;
    case 'voting':
      return `${gameLine}
        <p class="timer huge"></p>
        <p class="big">Voting&hellip; ${b.votesIn} / ${b.votesNeeded}</p>
        <button class="secondary" data-act="host:closeVote">Close vote now</button>`;
    case 'result': {
      const last = b.gameNo >= b.totalGames;
      return `<p class="round">Game ${b.gameNo} / ${b.totalGames}</p>${resultHtml(b.result)}
        <button data-act="host:next">${last ? 'Show final scores' : 'Next game'}</button>
        ${imposterSettingsHtml(b.settings)}`;
    }
    case 'done': {
      const top = b.players.length ? b.players[0].score : 0;
      const winners = b.players.filter((p) => p.score === top).map((p) => esc(p.name)).join(', ');
      return `<h1>${b.settings.games ? 'All games played' : 'Rotation complete'}</h1>
        <p class="big">Leader: <b>${winners}</b> (${top} pts)</p>
        ${imposterSettingsHtml(b.settings)}
        <button data-act="host:start">Play again</button>`;
    }
    default:
      return '';
  }
}

function row(p, rank) {
  const top = podium(rank, p.score);
  const status = board.phase === 'voting' && p.inGame ? (p.voted ? ' <span class="good">voted</span>' : '') : '';
  return `<li class="${p.connected || p.bot ? '' : 'away'} ${top.cls}">
    <span>${top.medal}${esc(p.name)}${status}</span>
    <b>${p.score}</b>
    <button class="kick" data-kick="${esc(p.id)}" data-name="${esc(p.name)}" title="Remove">&times;</button>
  </li>`;
}
