const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PAYOFF = {
  CC: [3, 3],
  DD: [1, 1],
  CD: [0, 5],
  DC: [5, 0],
};

function score(a, b) {
  return PAYOFF[a + b];
}

function emptySlot() {
  return { participantId: null, name: null, score: 0 };
}

let state = {
  teams: {},   // teamId -> { name, slots: { p1, p2 }, submissions: { p1, p2 }, history: [] }
  round: 0,
  revealed: false,
};

function broadcast() {
  io.emit('state_update', state);
}

function setupTeams(count) {
  const teams = {};
  for (let i = 1; i <= count; i++) {
    teams[i] = {
      name: `Team ${i}`,
      slots: { p1: emptySlot(), p2: emptySlot() },
      submissions: { p1: null, p2: null },
      history: [],
    };
  }
  state = { teams, round: 0, revealed: false };
  broadcast();
}

function findParticipant(participantId) {
  for (const teamId of Object.keys(state.teams)) {
    const team = state.teams[teamId];
    for (const slot of ['p1', 'p2']) {
      if (team.slots[slot].participantId === participantId) {
        return { teamId, slot };
      }
    }
  }
  return null;
}

function startRound() {
  state.round += 1;
  state.revealed = false;
  Object.values(state.teams).forEach((team) => {
    team.submissions = { p1: null, p2: null };
  });
  broadcast();
}

function allFullTeamsSubmitted() {
  const teams = Object.values(state.teams);
  const fullTeams = teams.filter((t) => t.slots.p1.participantId && t.slots.p2.participantId);
  if (fullTeams.length === 0) return false;
  return fullTeams.every((t) => t.submissions.p1 && t.submissions.p2);
}

function reveal() {
  Object.values(state.teams).forEach((team) => {
    const bothJoined = team.slots.p1.participantId && team.slots.p2.participantId;
    if (!bothJoined) return;
    const moveP1 = team.submissions.p1 || 'D';
    const moveP2 = team.submissions.p2 || 'D';
    const [pts1, pts2] = score(moveP1, moveP2);
    team.slots.p1.score += pts1;
    team.slots.p2.score += pts2;
    team.history.push({ round: state.round, moveP1, moveP2, pts1, pts2 });
  });
  state.revealed = true;
  broadcast();
}

io.on('connection', (socket) => {
  socket.emit('state_update', state);

  socket.on('facilitator:setup_teams', ({ count }) => setupTeams(count));
  socket.on('facilitator:start_round', () => startRound());
  socket.on('facilitator:reveal', () => {
    if (!allFullTeamsSubmitted()) return;
    reveal();
  });
  socket.on('facilitator:reset', () =>
    setupTeams(Object.keys(state.teams).length || 10)
  );

  socket.on('participant:join', ({ participantId, name, teamId }) => {
    const team = state.teams[teamId];
    if (!team) return;
    if (findParticipant(participantId)) return; // already joined somewhere
    const openSlot = ['p1', 'p2'].find((s) => !team.slots[s].participantId);
    if (!openSlot) return; // full
    team.slots[openSlot] = { participantId, name, score: 0 };
    broadcast();
  });

  socket.on('participant:submit', ({ participantId, choice }) => {
    if (state.revealed) return;
    const found = findParticipant(participantId);
    if (!found) return;
    const { teamId, slot } = found;
    const team = state.teams[teamId];
    if (team.submissions[slot]) return; // already locked
    team.submissions[slot] = choice;
    broadcast();
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`The Hidden Hand backend listening on ${PORT}`));