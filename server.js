const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Carichiamo il pool di eventi dal file JSON
let rawEvents = fs.readFileSync(path.join(__dirname, 'events.json'));
const ALL_EVENTS = JSON.parse(rawEvents);

// Memoria dello stato delle stanze: { roomCode: { players: [], eventPool: [], gameState: ... } }
const rooms = {};

// Helper: Estrae 5 eventi casuali e li rimuove dal pool della stanza
function getUnique5Events(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.eventPool.length < 5) {
    // Se finiscono gli eventi, ricarica il mazzo iniziale
    room.eventPool = [...ALL_EVENTS];
  }
  
  const selected = [];
  for (let i = 0; i < 5; i++) {
    const randomIndex = Math.floor(Math.random() * room.eventPool.length);
    selected.push(room.eventPool.splice(randomIndex, 1)[0]);
  }
  return selected;
}

io.on('connection', (socket) => {
  console.log('Un utente si è connesso:', socket.id);

  // 1. Creazione / Accesso alla Stanza con Reconnection
  socket.on('joinRoom', ({ roomCode, playerName, playerId }) => {
    roomCode = roomCode.toUpperCase();
    
    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        hostId: playerId,
        players: [],
        eventPool: [...ALL_EVENTS],
        currentRound: {
          judgeId: null,
          events: [],
          judgeOrder: null,
          guesses: {} // { playerId: [order] }
        },
        gameStarted: false
      };
    }

    const room = rooms[roomCode];
    let player = room.players.find(p => p.id === playerId);

    if (player) {
      // Giocatore riconnesso! Aggiorniamo il socket.id corrente
      player.socketId = socket.id;
      player.connected = true;
    } else {
      // Nuovo giocatore
      player = {
        id: playerId,
        socketId: socket.id,
        name: playerName,
        score: 0,
        connected: true
      };
      room.players.push(player);
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerId = playerId;

    // Notifica la stanza dell'aggiornamento lista giocatori
    io.to(roomCode).emit('roomUpdated', {
      players: room.players,
      hostId: room.hostId,
      gameStarted: room.gameStarted
    });
  });

  // Gestione Disconnessione Temporanea
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
// ... [MANTIENI IL CODICE DEL PASSO 1] ...

// Helper per trasformare l'array di stringhe in oggetti con ID unico
function prepare5Events(roomCode) {
  const raw5 = getUnique5Events(roomCode);
  return raw5.map((text, idx) => ({ id: `evt_${idx}_${Date.now()}`, text: text }));
}

io.on('connection', (socket) => {
  // ... [MANTIENI joinRoom e disconnect del PASSO 1] ...

  // INIZIA PARTITA
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

  // RICEVI ORDINE INVIATO
  socket.on('submitOrder', ({ roomCode, playerId, order }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const round = room.currentRound;

    if (playerId === round.judgeId) {
      round.judgeOrder = order;
    } else {
      round.guesses[playerId] = order;
    }

    // Verifica se tutti i giocatori connessi hanno inviato la scelta
    const connectedPlayers = room.players.filter(p => p.connected);
    const totalGuessesNeeded = connectedPlayers.length - 1; // Tutti tranne il giudice
    
    if (round.judgeOrder && Object.keys(round.guesses).length >= totalGuessesNeeded) {
      // CALCOLO PUNTEGGI
      let totalPointsGainedByPlayers = 0;
      const roundSummary = [];

      connectedPlayers.forEach(p => {
        let pointsGained = 0;
        if (p.id !== round.judgeId) {
          const userGuess = round.guesses[p.id];
          if (userGuess) {
            // Compare position by position
            for (let i = 0; i < 5; i++) {
              if (userGuess[i] === round.judgeOrder[i]) pointsGained++;
            }
          }
          p.score += pointsGained;
          totalPointsGainedByPlayers += pointsGained;
          roundSummary.push({ name: p.name, pointsGained: pointsGained, totalScore: p.score });
        }
      });

      // Regola Giudice: se NESSUNO ha fatto almeno 1 punto, il giudice perde 2 punti
      const judgePlayer = room.players.find(p => p.id === round.judgeId);
      let judgePoints = 0;
      if (totalPointsGainedByPlayers === 0) {
        judgePoints = -2;
        judgePlayer.score = Math.max(0, judgePlayer.score - 2);
      }
      roundSummary.unshift({ name: `${judgePlayer.name} (Giudice)`, pointsGained: judgePoints, totalScore: judgePlayer.score });

      io.to(roomCode).emit('roundEnded', {
        results: roundSummary,
        scores: room.players,
        isHost: true // Inviamo la notifica all'host per attivare il tasto prossimo round
      });
    }
  });

  // PROSSIMO ROUND
  socket.on('nextRound', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    // Ruota il giudice
    room.judgeIndex = (room.judgeIndex + 1) % room.players.length;
    startNewRound(roomCode);
  });

  // TERMINA PARTITA
  socket.on('endGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    io.to(roomCode).emit('gameOver', {
      leaderboard: room.players.map(p => ({ name: p.name, score: p.score }))
    });
  });
});