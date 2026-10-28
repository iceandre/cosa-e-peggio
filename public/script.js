const socket = io();

// 1. Gestione ID Giocatore (Reconnection)
let playerId = localStorage.getItem('cosa_e_peggio_player_id');
if (!playerId) {
  playerId = 'player_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('cosa_e_peggio_player_id', playerId);
}

// 2. Modale Regole
const rulesModal = document.getElementById('rulesModal');
const dontShowRules = document.getElementById('dontShowRules');
if (localStorage.getItem('hideRules') === 'true') {
  rulesModal.classList.add('hidden');
}
document.getElementById('closeRulesBtn').addEventListener('click', () => {
  if (dontShowRules.checked) {
    localStorage.setItem('hideRules', 'true');
  }
  rulesModal.classList.add('hidden');
});

// Stato Locale
let currentRoom = null;
let isHost = false;
let draggedItem = null;

// Elementi DOM
const joinScreen = document.getElementById('joinScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const endScreen = document.getElementById('endScreen');

// Join / Creazione Stanza
document.getElementById('joinBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim();
  const room = document.getElementById('roomCode').value.trim().toUpperCase();

  if (!name || !room) return alert('Inserisci sia il nome che il codice stanza!');

  currentRoom = room;
  socket.emit('joinRoom', { roomCode: room, playerName: name, playerId: playerId });
});

// Aggiornamento Lobby
socket.on('roomUpdated', ({ players, hostId, gameStarted }) => {
  if (!gameStarted) {
    joinScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    document.getElementById('displayRoomCode').innerText = currentRoom;

    const playerList = document.getElementById('playerList');
    playerList.innerHTML = '';
    
    players.forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${p.name} ${p.id === hostId ? '👑' : ''} ${!p.connected ? '(Disconnesso)' : ''}</span> <span><b>${p.score} pt</b></span>`;
      playerList.appendChild(li);
    });

    isHost = (hostId === playerId);
    if (isHost) {
      document.getElementById('hostControls').classList.remove('hidden');
    }
  }
});

// Inizio Partita dall'Host
document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('startGame', { roomCode: currentRoom });
});

// Inizio Nuovo Round
socket.on('newRound', ({ judgeId, judgeName, events, isJudge }) => {
  lobbyScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  document.getElementById('roundResults').classList.add('hidden');
  document.getElementById('submitOrderBtn').classList.remove('hidden');
  document.getElementById('waitingMessage').classList.add('hidden');

  const roleBadge = document.getElementById('roleBadge');
  const instructionText = document.getElementById('instructionText');

  if (isHost) document.getElementById('hostEndGameArea').classList.remove('hidden');

  if (isJudge) {
    roleBadge.innerText = "👨‍⚖️ SEI IL GIUDICE";
    roleBadge.className = "badge judge";
    instructionText.innerText = "Ordina gli eventi dal PEGGIORE (1) al MENO PEGGIO (5):";
  } else {
    roleBadge.innerText = `🎮 GIOCATORE (Giudice: ${judgeName})`;
    roleBadge.className = "badge";
    instructionText.innerText = `Indovina come ${judgeName} ordinerà questi 5 eventi:`;
  }

  renderSortableList(events);
});

// Render della Lista Trascina/Frecce
function renderSortableList(events) {
  const list = document.getElementById('sortableList');
  list.innerHTML = '';

  events.forEach((evt, idx) => {
    const li = document.createElement('li');
    li.className = 'sortable-item';
    li.draggable = true;
    li.dataset.id = evt.id;
    li.innerHTML = `
      <span class="rank-num">${idx + 1}.</span>
      <span class="evt-text">${evt.text}</span>
      <div class="move-btns">
        <button class="btn-arrow up-btn">⬆️</button>
        <button class="btn-arrow down-btn">⬇️</button>
      </div>
    `;
    
    // Drag & Drop
    li.addEventListener('dragstart', () => {
      draggedItem = li;
      li.classList.add('dragging');
    });

    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      updateRankNumbers();
    });

    // Frecce Mobile
    li.querySelector('.up-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const prev = li.previousElementSibling;
      if (prev) {
        list.insertBefore(li, prev);
        updateRankNumbers();
      }
    });

    li.querySelector('.down-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const next = li.nextElementSibling;
      if (next) {
        list.insertBefore(next, li);
        updateRankNumbers();
      }
    });

    list.appendChild(li);
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(list, e.clientY);
    if (afterElement == null) {
      list.appendChild(draggedItem);
    } else {
      list.insertBefore(draggedItem, afterElement);
    }
  });
}

function updateRankNumbers() {
  const items = document.querySelectorAll('.sortable-item');
  items.forEach((item, index) => {
    item.querySelector('.rank-num').innerText = `${index + 1}.`;
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.sortable-item:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Invio dell'ordine
document.getElementById('submitOrderBtn').addEventListener('click', () => {
  const orderedIds = [...document.querySelectorAll('.sortable-item')].map(li => li.dataset.id);
  
  socket.emit('submitOrder', { roomCode: currentRoom, playerId: playerId, order: orderedIds });
  
  document.getElementById('submitOrderBtn').classList.add('hidden');
  document.getElementById('waitingMessage').classList.remove('hidden');
});

// --- RICEZIONE RISULTATI E SHOWDOWN FINE ROUND ---
socket.on('roundEnded', ({ results, judgeOrder, events, playerGuesses }) => {
  document.getElementById('waitingMessage').classList.add('hidden');
  const resultsDiv = document.getElementById('roundResults');
  resultsDiv.classList.remove('hidden');

  // Mappa id -> testo evento
  const eventsMap = {};
  events.forEach(e => eventsMap[e.id] = e.text);

  // 1. PUNTI OTTENUTI NEL ROUND
  let html = '<h3 style="color:#ffd32a; margin-bottom:10px;">📊 Punti del Round:</h3><ul class="results-list">';
  results.forEach(r => {
    html += `<li><span><b>${r.name}:</b> +${r.pointsGained} pt</span> <span>Totale: <b>${r.totalScore} pt</b></span></li>`;
  });
  html += '</ul>';

  // 2. CLASSIFICA UFFICIALE DEL GIUDICE
  html += `<div class="showdown-box">
    <h4 class="showdown-title">👑 Ordine del Giudice (dal 1° al 5°):</h4>
    <ol style="padding-left:20px; margin:8px 0; text-align:left;">`;
  
  judgeOrder.forEach(id => {
    html += `<li style="margin:6px 0; font-size:14px;"><b>${eventsMap[id]}</b></li>`;
  });
  html += `</ol></div>`;

  // 3. COMPARAZIONE DELLE SCELTE DEI GIOCATORI
  const guessKeys = Object.keys(playerGuesses || {});
  
  if (guessKeys.length > 0) {
    html += `<div class="showdown-box">
      <h4 class="showdown-title">🔍 Confronta la scelta di un giocatore:</h4>
      <select id="playerGuessSelect" class="player-tab-select">`;
    guessKeys.forEach(pId => {
      html += `<option value="${pId}">${playerGuesses[pId].name}</option>`;
    });
    html += `</select>
    <div id="playerGuessDetail"></div>
    </div>`;
  }

  document.getElementById('resultsDetails').innerHTML = html;

  // Renderizza la lista del giocatore selezionato dal menu a tendina
  const selectElem = document.getElementById('playerGuessSelect');
  if (selectElem && guessKeys.length > 0) {
    const renderGuessDetail = (pId) => {
      const pData = playerGuesses[pId];
      const detailDiv = document.getElementById('playerGuessDetail');
      if (!pData || !pData.order) return;

      let detailHtml = '<div style="margin-top:10px;">';
      pData.order.forEach((evtId, idx) => {
        const isCorrect = (evtId === judgeOrder[idx]);
        detailHtml += `<div class="showdown-item ${isCorrect ? 'correct' : 'wrong'}">
          <span><b>${idx + 1}.</b> ${eventsMap[evtId] || 'Non impostato'}</span> ${isCorrect ? '✅ (+1 pt)' : '❌'}
        </div>`;
      });
      detailHtml += '</div>';
      detailDiv.innerHTML = detailHtml;
    };

    selectElem.addEventListener('change', (e) => renderGuessDetail(e.target.value));
    renderGuessDetail(guessKeys[0]); // Mostra subito il primo giocatore
  }

  // Gestione Tasto Prossimo Round per Host
  if (isHost) {
    const nextBtn = document.getElementById('nextRoundBtn');
    nextBtn.classList.remove('hidden');
    nextBtn.onclick = () => socket.emit('nextRound', { roomCode: currentRoom });
  }
});

// Termina Partita
document.getElementById('endGameBtn')?.addEventListener('click', () => {
  if (confirm('Vuoi davvero terminare la partita e mostrare la classifica finale?')) {
    socket.emit('endGame', { roomCode: currentRoom });
  }
});

socket.on('gameOver', ({ leaderboard }) => {
  gameScreen.classList.add('hidden');
  endScreen.classList.remove('hidden');

  const board = document.getElementById('finalLeaderboard');
  board.innerHTML = '';
  leaderboard.sort((a,b) => b.score - a.score).forEach((p, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>#${idx+1} <b>${p.name}</b></span> <span><b>${p.score} pt</b></span>`;
    board.appendChild(li);
  });
});