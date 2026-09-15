import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000';
const socket = io(BACKEND_URL);

function getParticipantId() {
  let id = localStorage.getItem('hidden_hand_participant_id');
  if (!id) {
    id = window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('hidden_hand_participant_id', id);
  }
  return id;
}

function useGameState() {
  const [state, setState] = useState(null);
  useEffect(() => {
    socket.on('state_update', setState);
    return () => socket.off('state_update', setState);
  }, []);
  return state;
}

function getView() {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') || 'participant';
}

function findParticipant(state, participantId) {
  for (const teamId of Object.keys(state.teams)) {
    const team = state.teams[teamId];
    for (const slot of ['p1', 'p2']) {
      if (team.slots[slot].participantId === participantId) {
        return { teamId, slot, team };
      }
    }
  }
  return null;
}

export default function App() {
  const view = getView();
  const state = useGameState();

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className={view === 'dashboard' ? 'topbar topbar-wide' : 'topbar'}>
        <div className="topbar-left">
          <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="Carnelian Co" className="logo" />
          <div className="titleblock">
            <h1>The Hidden Hand</h1>
            <p>A live Prisoner's Dilemma, played in pairs</p>
          </div>
        </div>
        {view === 'dashboard' && (
          <div className="topbar-tagline">Convey meaning, create significance</div>
        )}
      </header>

      {!state && <div className="card">Connecting...</div>}
      {state && view === 'dashboard' && <Dashboard state={state} />}
      {state && view === 'facilitator' && <Facilitator state={state} />}
      {state && view === 'participant' && <Participant state={state} />}
    </div>
  );
}

function Participant({ state }) {
  const [participantId] = useState(getParticipantId);
  const [nameInput, setNameInput] = useState('');

  const found = findParticipant(state, participantId);

  if (!found) {
    const teamList = Object.entries(state.teams);
    return (
      <div className="card">
        <h2>Join a team</h2>
        <input
          className="text-input"
          placeholder="Your name"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
        />
        <div className="team-join-grid">
          {teamList.map(([teamId, team]) => {
            const filled = ['p1', 'p2'].filter((s) => team.slots[s].participantId).length;
            const full = filled >= 2;
            return (
              <button
                key={teamId}
                className={full ? 'team-join-btn full' : 'team-join-btn'}
                disabled={full || !nameInput.trim()}
                onClick={() =>
                  socket.emit('participant:join', {
                    participantId,
                    name: nameInput.trim(),
                    teamId,
                  })
                }
              >
                <span>{team.name}</span>
                <span className="team-join-status">{full ? 'Full' : `${filled}/2`}</span>
              </button>
            );
          })}
        </div>
        {teamList.length === 0 && <p className="note">Waiting for the facilitator to create teams.</p>}
      </div>
    );
  }

  const { team, slot } = found;
  const partnerSlot = slot === 'p1' ? 'p2' : 'p1';
  const partner = team.slots[partnerSlot];
  const myScore = team.slots[slot].score;
  const myChoice = team.submissions[slot];
  const bothJoined = team.slots.p1.participantId && team.slots.p2.participantId;

  const lastRound = team.history[team.history.length - 1];
  const showResult = state.revealed && lastRound && lastRound.round === state.round;

  return (
    <div className="card">
      <h2>{team.name}</h2>
      <p className="note">
        Round {state.round} · you are {slot === 'p1' ? 'Player 1' : 'Player 2'} ·{' '}
        {partner.participantId ? `playing against ${partner.name}` : 'waiting for your partner to join'}
      </p>
      <div className="score">{myScore} pts</div>

      {bothJoined && !state.revealed && (
        <div className="choice-row">
          <button
            className={myChoice === 'C' ? 'choice good active' : 'choice good'}
            disabled={!!myChoice}
            onClick={() => socket.emit('participant:submit', { participantId, choice: 'C' })}
          >
            Cooperate
          </button>
          <button
            className={myChoice === 'D' ? 'choice bad active' : 'choice bad'}
            disabled={!!myChoice}
            onClick={() => socket.emit('participant:submit', { participantId, choice: 'D' })}
          >
            Defect
          </button>
        </div>
      )}

      {myChoice && !state.revealed && (
        <p className="pending-flag">Choice locked in. Waiting on the room.</p>
      )}

      {showResult && (
        <div className="reveal-box">
          <p>You: {slot === 'p1' ? lastRound.moveP1 : lastRound.moveP2}</p>
          <p>{partner.name}: {slot === 'p1' ? lastRound.moveP2 : lastRound.moveP1}</p>
          <p className="score">+{slot === 'p1' ? lastRound.pts1 : lastRound.pts2} this round</p>
        </div>
      )}
    </div>
  );
}

function Dashboard({ state }) {
  const [showQr, setShowQr] = useState(false);
  const participantUrl = `${window.location.origin}${window.location.pathname}`;

  const leaderboard = Object.values(state.teams)
    .filter((team) => team && team.slots)
    .flatMap((team) =>
      ['p1', 'p2']
        .filter((s) => team.slots[s].participantId)
        .map((s) => ({ name: team.slots[s].name, team: team.name, score: team.slots[s].score }))
    )
    .sort((a, b) => b.score - a.score);

  return (
    <div className="dashboard-card">
      <div className="dashboard-col">
        <h2>Round {state.round}</h2>
        <table className="history">
          <thead>
            <tr>
              <th>Team</th>
              <th>Player 1</th>
              <th>Player 2</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(state.teams).filter((team) => team && team.slots).map((team) => {
              const lastRound = team.history[team.history.length - 1];
              const showResult = state.revealed && lastRound && lastRound.round === state.round;
              const p1 = team.slots.p1;
              const p2 = team.slots.p2;
              return (
                <tr key={team.name}>
                  <td>{team.name}</td>
                  <td className={showResult ? (lastRound.moveP1 === 'C' ? 'good' : 'bad') : ''}>
                    {p1.name || '—'}
                    {showResult ? ` (${lastRound.moveP1})` : team.submissions.p1 ? ' · submitted' : ''}
                  </td>
                  <td className={showResult ? (lastRound.moveP2 === 'C' ? 'good' : 'bad') : ''}>
                    {p2.name || '—'}
                    {showResult ? ` (${lastRound.moveP2})` : team.submissions.p2 ? ' · submitted' : ''}
                  </td>
                  <td>{showResult ? `${lastRound.pts1} / ${lastRound.pts2}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="dashboard-col">
        <h2>Leaderboard</h2>
        <table className="history">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Name</th>
              <th>Team</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((p, i) => (
              <tr key={p.name + p.team} className={i === 0 && p.score > 0 ? 'leader-row' : ''}>
                <td>{i + 1}</td>
                <td>{p.name}</td>
                <td>{p.team}</td>
                <td>{p.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="qr-fab" onClick={() => setShowQr(true)}>
        Show QR
      </button>

      {showQr && (
        <div className="qr-overlay">
          <div className="qr-modal">
            <button className="qr-close" onClick={() => setShowQr(false)}>
              ✕
            </button>
            <QRCodeSVG value={participantUrl} size={320} bgColor="#ffffff" fgColor="#0a1a33" />
            <p className="qr-url">{participantUrl}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Facilitator({ state }) {
  const [count, setCount] = useState(10);
  const teams = Object.values(state.teams).filter((team) => team && team.slots);
  const fullTeams = teams.filter((t) => t.slots.p1.participantId && t.slots.p2.participantId);
  const submittedCount = fullTeams.filter(
    (t) => t.submissions.p1 && t.submissions.p2
  ).length;

  return (
    <div className="card">
      <h2>Facilitator controls</h2>

      <div className="actions">
        <label className="rounds-label">
          Number of teams
          <input
            type="number"
            min="1"
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
          />
        </label>
        <button className="btn primary" onClick={() => socket.emit('facilitator:setup_teams', { count })}>
          Create teams
        </button>
      </div>

      <div className="actions">
        <button className="btn primary" onClick={() => socket.emit('facilitator:start_round')}>
          Start round {state.round + 1}
        </button>
        <button
          className="btn primary"
          onClick={() => socket.emit('facilitator:reveal')}
          disabled={state.revealed}
        >
          Reveal ({submittedCount}/{fullTeams.length} teams ready)
        </button>
        <button className="btn ghost" onClick={() => socket.emit('facilitator:reset')}>
          Reset
        </button>
      </div>

      <table className="history">
        <thead>
          <tr>
            <th>Team</th>
            <th>Player 1</th>
            <th>Player 2</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team) => (
            <tr key={team.name}>
              <td>{team.name}</td>
              <td>{team.slots.p1.name || 'Empty'}</td>
              <td>{team.slots.p2.name || 'Empty'}</td>
              <td>
                {!team.slots.p1.participantId || !team.slots.p2.participantId
                  ? 'Waiting for players'
                  : team.submissions.p1 && team.submissions.p2
                  ? 'Both submitted'
                  : team.submissions.p1 || team.submissions.p2
                  ? 'One submitted'
                  : 'Waiting'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CSS = `
:root {
  --bg: #0a1a33;
  --panel: #10233f;
  --border: #23385c;
  --white: #ffffff;
  --muted: #b9c6de;
  --orange: #f2994a;
  --orange-dark: #d1602f;
  --good: #4caf7d;
  --bad: #e0684a;
}
* { box-sizing: border-box; }
.app { min-height: 100vh; background: var(--bg); color: var(--white); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px 24px 64px; }
.topbar { display: flex; align-items: center; justify-content: space-between; max-width: 860px; margin: 0 auto 24px; }
.topbar-wide { max-width: 1400px; }
.topbar-left { display: flex; align-items: center; gap: 16px; }
.topbar-tagline { color: var(--orange); font-size: 15px; font-weight: 600; letter-spacing: 0.02em; text-align: right; }
.logo { height: 40px; width: auto; }
.titleblock h1 { font-size: 28px; margin: 0; letter-spacing: -0.02em; color: var(--orange); }
.titleblock p { margin: 2px 0 0; color: var(--muted); font-size: 14px; }
.card { max-width: 860px; margin: 0 auto; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 28px 32px; }
.dashboard-card { max-width: 1400px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.dashboard-col { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 28px 32px; }
.leader-row td { color: var(--orange); font-weight: 700; }
@media (max-width: 900px) {
  .dashboard-card { grid-template-columns: 1fr; }
}
.card h2 { margin-top: 0; font-size: 20px; color: var(--white); }
.note { color: var(--muted); font-size: 14px; line-height: 1.6; }
.text-input { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--white); font-size: 15px; margin-bottom: 16px; }
.team-join-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.team-join-btn { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px; border-radius: 8px; border: 1px solid var(--border); background: none; color: var(--white); cursor: pointer; font-size: 14px; }
.team-join-btn:disabled:not(.full) { opacity: 0.5; cursor: not-allowed; }
.team-join-btn.full { opacity: 0.35; cursor: not-allowed; border-color: var(--bad); }
.team-join-status { font-size: 12px; color: var(--orange); }
.score { font-size: 28px; font-weight: 700; margin: 12px 0; color: var(--orange); }
.choice-row { display: flex; gap: 8px; margin: 16px 0; }
.choice { flex: 1; padding: 14px; border-radius: 6px; border: 1px solid var(--border); background: none; color: var(--white); cursor: pointer; font-size: 15px; }
.choice.good.active { background: var(--good); border-color: var(--good); }
.choice.bad.active { background: var(--bad); border-color: var(--bad); }
.choice:disabled { opacity: 0.5; cursor: not-allowed; }
.pending-flag { font-size: 13px; color: var(--muted); }
.reveal-box { background: var(--bg); border-radius: 8px; padding: 16px; margin-top: 12px; }
.actions { display: flex; align-items: center; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
.btn { padding: 10px 18px; border-radius: 6px; border: 1px solid var(--border); font-size: 14px; cursor: pointer; color: var(--white); }
.btn.primary { background: var(--orange-dark); border-color: var(--orange-dark); color: white; }
.btn.primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.ghost { background: none; color: var(--white); }
.history { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
.history th, .history td { border-bottom: 1px solid var(--border); padding: 8px 10px; text-align: left; color: var(--white); }
.history th { color: var(--muted); font-weight: 500; }
.good { color: var(--good); }
.bad { color: var(--bad); }
.rounds-label { font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.rounds-label input { width: 60px; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--white); }
.qr-fab { position: fixed; bottom: 24px; right: 24px; background: var(--orange-dark); border: none; color: white; padding: 14px 22px; border-radius: 999px; font-size: 15px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
.qr-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 100; }
.qr-modal { position: relative; background: #ffffff; border-radius: 12px; padding: 40px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.qr-close { position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 20px; color: var(--bg); cursor: pointer; line-height: 1; padding: 6px 10px; }
.qr-url { color: var(--bg); font-size: 13px; word-break: break-all; text-align: center; max-width: 320px; }
`;