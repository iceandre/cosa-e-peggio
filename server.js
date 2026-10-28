const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let rawEvents = fs.readFileSync(path.join(__dirname, 'events.json'));
const ALL_EVENTS = JSON.parse(rawEvents);

const rooms = {};

function getUnique5Events(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.eventPool.length < 5) {
    room.eventPool = [...ALL_EVENTS];
  }
  
  const selected = [];
  for (let i = 0; i < 5; i++) {
    const randomIndex = Math.floor(Math.random() * room.eventPool.length);
    selected.push(room.eventPool.splice(randomIndex, 1)[0]);
  }
  return selected;
}

function prepare5Events(roomCode) {
  const raw5 = getUnique5Events(roomCode);
  return raw5.map((text, idx) => ({ id: `evt_${idx}_${Date.now()}`, text: text }));
}

function evaluateRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const round = room.currentRound;
  const connectedPlayers = room.players.filter(p => p.connected);

  let totalPointsGainedByPlayers = 0;
  const roundSummary = [];
  const playerDetails = {};

  // Se per qualsiasi motivo il giudice non ha un ordine, usiamo l'ordine di default delle card
  if (!round.judgeOrder) {
    round.judgeOrder = round.events.map(e => e.id);
  }

  connectedPlayers.forEach(p => {
    let pointsGained = 0;
    if (p.id !== round.judgeId) {
      const userGuess = round.guesses[p.id] || [];
      playerDetails[p.id] = { name: p.name, order: userGuess };
      
      // Calcolo punti: 1 punto per ogni posizione identica a quella del Giudice
      for (let i = 0; i < 5; i++) {
        if (userGuess[i] && userGuess[i] === round.judgeOrder[i]) {
          pointsGained++;
        }
      }
      
      p.score += pointsGained;
      totalPointsGainedByPlayers += pointsGained;
      roundSummary.push({ id: p.id, name: p.name, pointsGained: pointsGained, totalScore: p.score });
    }
  });

  // Gestione Punteggio Giudice (-2 se nessuno fa punti)
  const judgePlayer = room.players.find(p => p.id === round.judgeId);
  let judgePoints = 0;
  if (judgePlayer) {
    if (totalPointsGainedByPlayers === 0 && connectedPlayers.length > 1) {
      judgePoints = -2;
      judgePlayer.score = Math.max(0, judgePlayer.score - 2);
    }
    roundSummary.unshift({ id: judgePlayer.id, name: `${judgePlayer.name} (Giudice)`, pointsGained: judgePoints, totalScore: judgePlayer.score });
  }

  // Invio risultati completi a tutti i client
  io.to(roomCode).emit('roundEnded', {
    results: roundSummary,
    scores: room.players,
    judgeOrder: round.judgeOrder,
    events: round.events,
    playerGuesses: playerDetails
  });
}

io.on('connection', (socket) => {

  socket.on('joinRoom', ({ roomCode, playerName, playerId }) => {
    roomCode = roomCode.toUpperCase();
    
    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        hostId: playerId,
        players: [],
        eventPool: [...ALL_EVENTS],
        currentRound: { judgeId: null, events: [], judgeOrder: null, guesses: {} },
        gameStarted: false
      };
    }

    const room = rooms[roomCode];
    let player = room.players.find(p => p.id === playerId);

    if (player) {
      player.socketId = socket.id;
      player.connected = true;
    } else {
      player = { id: playerId, socketId: socket.id, name: playerName, score: 0, connected: true };
      room.players.push(player);
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerId = playerId;

    io.to(roomCode).emit('roomUpdated', {
      players: room.players,
      hostId: room.hostId,
      gameStarted: room.gameStarted
    });
  });

  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.gameStarted = true;
    room.judgeIndex = 0;
    startNewRound(roomCode);
  });

  function startNewRound(roomCode) {
    const room = rooms[roomCode];
    const currentJudge = room.players[room.judgeIndex];

    room.currentRound = {
      judgeId: currentJudge.id,
      events: prepare5Events(roomCode),
      judgeOrder: null,
      guesses: {}
    };

    room.players.forEach(p => {
      io.to(p.socketId).emit('newRound', {
        judgeId: currentJudge.id,
        judgeName: currentJudge.name,
        events: room.currentRound.events,
        isJudge: p.id === currentJudge.id
      });
    });
  }

  socket.on('submitOrder', ({ roomCode, playerId, order }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const round = room.currentRound;

    if (playerId === round.judgeId) {
      round.judgeOrder = order;
    } else {
      round.guesses[playerId] = order;
    }

    const connectedPlayers = room.players.filter(p => p.connected);
    const totalGuessesNeeded = connectedPlayers.length - 1; // Tutti tranne il giudice
    
    if (round.judgeOrder && Object.keys(round.guesses).length >= totalGuessesNeeded) {
      evaluateRound(roomCode);
    }
  });

  socket.on('nextRound', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.judgeIndex = (room.judgeIndex + 1) % room.players.length;
    startNewRound(roomCode);
  });

  socket.on('endGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    io.to(roomCode).emit('gameOver', {
      leaderboard: room.players.map(p => ({ name: p.name, score: p.score }))
    });
  });

  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms[roomCode]) {
      const player = rooms[roomCode].players.find(p => p.id === socket.playerId);
      if (player) player.connected = false;

      io.to(roomCode).emit('roomUpdated', {
        players: rooms[roomCode].players,
        hostId: rooms[roomCode].hostId,
        gameStarted: rooms[roomCode].gameStarted
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`);
});