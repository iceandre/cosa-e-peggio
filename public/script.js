const socket = io();

let playerId = localStorage.getItem('cosa_e_peggio_player_id');
if (!playerId) {
  playerId = 'player_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('cosa_e_peggio_player_id', playerId);
}

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

let currentRoom = null;
let isHost = false;
let draggedItem = null;

const joinScreen = document.getElementById('joinScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const endScreen = document.getElementById('endScreen');

document.getElementById('joinBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim();
  const room = document.getElementById('roomCode').value.trim().toUpperCase();

  if (!name || !room) return alert('Inserisci sia il nome che il codice stanza!');

  currentRoom = room;
  socket.emit('joinRoom', { roomCode: room, playerName: name, playerId: playerId });
});

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

document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('startGame', { roomCode: currentRoom });
});

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

    // Pulsanti Up/Down
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

document.getElementById('submitOrderBtn').addEventListener('click', () => {
  const orderedIds = [...document.querySelectorAll('.sortable-item')].map(li => li.dataset.id);
  
  socket.emit('submitOrder', { roomCode: currentRoom, playerId: playerId, order: orderedIds });
  
  document.getElementById('submitOrderBtn').classList.add('hidden');
  document.getElementById('waitingMessage').classList.remove('hidden');
});

socket.on('roundEnded', ({ results, scores, isHost }) => {
  document.getElementById('waitingMessage').classList.add('hidden');
  const resultsDiv = document.getElementById('roundResults');
  resultsDiv.classList.remove('hidden');

  let html = '<ul class="results-list">';
  results.forEach(r => {
    html += `<li><span><b>${r.name}:</b> +${r.pointsGained} pt</span> <span>Totale: <b>${r.totalScore} pt</b></span></li>`;
  });
  html += '</ul>';
  document.getElementById('resultsDetails').innerHTML = html;

  if (isHost) {
    const nextBtn = document.getElementById('nextRoundBtn');
    nextBtn.classList.remove('hidden');
    nextBtn.onclick = () => socket.emit('nextRound', { roomCode: currentRoom });
  }
});

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