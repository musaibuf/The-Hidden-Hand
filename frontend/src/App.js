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
  const myMove = showResult ? (slot === 'p1' ? lastRound.moveP1 : lastRound.moveP2) : null;
  const partnerMove = showResult ? (slot === 'p1' ? lastRound.moveP2 : lastRound.moveP1) : null;
  const myPts = showResult ? (slot === 'p1' ? lastRound.pts1 : lastRound.pts2) : null;

  function statusLine() {
    const finalPrefix = state.finalRoundActive && !showResult ? 'Final round — ' : '';
    if (!partner.participantId) return finalPrefix + 'Waiting for your partner to join';
    if (showResult) return `Round ${state.round} complete` + (state.gameOver ? ' — workshop finished' : '');
    if (state.round === 0) return 'Waiting for the facilitator to start round 1';
    if (myChoice) return finalPrefix + `Choice locked in — waiting on ${partner.name}`;
    return finalPrefix + `Playing against ${partner.name}`;
  }

  return (
    <div className="card">
      <h2>{team.name}</h2>
      <p className="note">{statusLine()}</p>
      <div className="score-row">
        <div className="score-block">
          <span className="score-label">Your score</span>
          <span className="score">{myScore} pts</span>
        </div>
        {partner.participantId && (
          <div className="score-block">
            <span className="score-label">{partner.name}'s score</span>
            <span className="score score-partner">{partner.score} pts</span>
          </div>
        )}
      </div>

      {bothJoined && state.round > 0 && !state.revealed && (
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

      {showResult && (
        <div className="reveal-box">
          <div className="reveal-row">
            <span>You</span>
            <span className={myMove === 'C' ? 'tag tag-good' : 'tag tag-bad'}>
              {myMove === 'C' ? 'Cooperated' : 'Defected'}
            </span>
          </div>
          <div className="reveal-row">
            <span>{partner.name}</span>
            <span className={partnerMove === 'C' ? 'tag tag-good' : 'tag tag-bad'}>
              {partnerMove === 'C' ? 'Cooperated' : 'Defected'}
            </span>
          </div>
          <p className="reveal-points">+{myPts} this round</p>
        </div>
      )}
    </div>
  );
}

function PlayerCell({ name, submitted, showResult, move }) {
  if (!name) {
    return <span className="player-name muted">Empty</span>;
  }
  return (
    <div className="player-cell">
      <span className="player-name">{name}</span>
      {showResult && (
        <span className={move === 'C' ? 'tag tag-good' : 'tag tag-bad'}>
          {move === 'C' ? 'Cooperated' : 'Defected'}
        </span>
      )}
      {!showResult && submitted && <span className="tag tag-neutral">Submitted</span>}
      {!showResult && !submitted && <span className="tag tag-waiting">Waiting</span>}
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

  const teamsSorted = Object.values(state.teams)
    .filter((team) => team && team.slots)
    .map((team) => ({ ...team, totalScore: team.slots.p1.score + team.slots.p2.score }))
    .sort((a, b) => b.totalScore - a.totalScore);

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
              <th>Team Score</th>
            </tr>
          </thead>
          <tbody>
            {teamsSorted.map((team, i) => {
              const lastRound = team.history[team.history.length - 1];
              const showResult = state.revealed && lastRound && lastRound.round === state.round;
              const p1 = team.slots.p1;
              const p2 = team.slots.p2;
              return (
                <tr key={team.name} className={i === 0 && team.totalScore > 0 ? 'leader-row' : ''}>
                  <td data-label="Team">{team.name}</td>
                  <td data-label="Player 1">
                    <PlayerCell
                      name={p1.name}
                      submitted={!!team.submissions.p1}
                      showResult={showResult}
                      move={lastRound && lastRound.moveP1}
                    />
                  </td>
                  <td data-label="Player 2">
                    <PlayerCell
                      name={p2.name}
                      submitted={!!team.submissions.p2}
                      showResult={showResult}
                      move={lastRound && lastRound.moveP2}
                    />
                  </td>
                  <td className="team-score-cell" data-label="Team Score">{team.totalScore}</td>
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
                <td data-label="Rank">{i + 1}</td>
                <td data-label="Name">{p.name}</td>
                <td data-label="Team">{p.team}</td>
                <td data-label="Score">{p.score}</td>
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
  const [countText, setCountText] = useState('10');
  const count = Math.min(50, Math.max(1, parseInt(countText, 10) || 1));
  const teams = Object.values(state.teams).filter((team) => team && team.slots);
  const fullTeams = teams.filter((t) => t.slots.p1.participantId && t.slots.p2.participantId);
  const submittedCount = fullTeams.filter(
    (t) => t.submissions.p1 && t.submissions.p2
  ).length;
  const allSubmitted = fullTeams.length > 0 && submittedCount === fullTeams.length;
  const allTeamsFull = teams.length > 0 && fullTeams.length === teams.length;

  let advanceLabel;
  let advanceDisabled;
  if (state.gameOver) {
    advanceLabel = 'Workshop complete';
    advanceDisabled = true;
  } else if (state.round === 0) {
    advanceLabel = 'Start Round 1';
    advanceDisabled = !allTeamsFull;
  } else if (state.revealed) {
    advanceLabel = state.finalRoundActive
      ? 'Final round revealed'
      : `Revealed — Round ${state.round + 1} starting automatically…`;
    advanceDisabled = true;
  } else {
    advanceLabel = state.finalRoundActive
      ? `Final Round — waiting on submissions (${submittedCount}/${fullTeams.length})`
      : `Reveal Score & Round ${state.round + 1} (${submittedCount}/${fullTeams.length} ready)`;
    advanceDisabled = !allSubmitted;
  }

  return (
    <div className="card">
      <h2>Facilitator controls</h2>

      <div className="actions">
        <label className="rounds-label">
          Number of teams
          <input
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            min="1"
            max="50"
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
          />
        </label>
        <button className="btn primary" onClick={() => socket.emit('facilitator:setup_teams', { count })}>
          Create teams
        </button>
      </div>

      {state.round === 0 && !allTeamsFull && teams.length > 0 && (
        <p className="note">
          Waiting for all teams to fill up ({fullTeams.length}/{teams.length} full) before Round 1 can start.
        </p>
      )}

      <div className="actions">
        <button
          className="btn primary"
          onClick={() => socket.emit('facilitator:advance')}
          disabled={advanceDisabled}
        >
          {advanceLabel}
        </button>
        {state.round >= 1 && !state.finalRoundActive && !state.gameOver && (
          <button className="btn ghost" onClick={() => socket.emit('facilitator:mark_last_round')}>
            Proceed to Last Round
          </button>
        )}
        <button className="btn ghost" onClick={() => socket.emit('facilitator:reset')}>
          Reset
        </button>
      </div>

      {state.finalRoundActive && !state.gameOver && (
        <p className="note">This is the final round. Scores lock automatically the moment everyone submits.</p>
      )}
      {state.gameOver && (
        <p className="note">Workshop complete. Final scores are locked on the dashboard.</p>
      )}
      {state.revealed && !state.gameOver && (
        <p className="note">Scores are on screen now. The next round opens automatically in a few seconds.</p>
      )}

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
          {teams.map((team) => {
            const bothIn = team.slots.p1.participantId && team.slots.p2.participantId;
            const bothSubmitted = team.submissions.p1 && team.submissions.p2;
            const oneSubmitted = team.submissions.p1 || team.submissions.p2;
            let statusClass = 'tag-waiting';
            let statusText = 'Waiting for players';
            if (bothIn) {
              if (bothSubmitted) {
                statusClass = 'tag-good';
                statusText = 'Both submitted';
              } else if (oneSubmitted) {
                statusClass = 'tag-neutral';
                statusText = 'One submitted';
              } else {
                statusClass = 'tag-waiting';
                statusText = 'Waiting';
              }
            }
            return (
              <tr key={team.name}>
                <td data-label="Team">{team.name}</td>
                <td data-label="Player 1">{team.slots.p1.name || 'Empty'}</td>
                <td data-label="Player 2">{team.slots.p2.name || 'Empty'}</td>
                <td data-label="Status">
                  <span className={`tag ${statusClass}`}>{statusText}</span>
                </td>
              </tr>
            );
          })}
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
.card { max-width: 860px; margin: 0 auto; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 32px 36px; box-shadow: 0 8px 24px rgba(0,0,0,0.25); }
.dashboard-card { max-width: 1400px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.dashboard-col { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 28px 32px; }
.leader-row td { color: var(--orange); font-weight: 700; }
.team-score-cell { font-size: 16px; font-weight: 700; color: var(--orange); }
.player-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.player-name { font-weight: 600; }
.player-name.muted { color: var(--muted); font-weight: 400; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; }
.tag-good { background: rgba(76, 175, 125, 0.18); color: var(--good); }
.tag-bad { background: rgba(224, 104, 74, 0.18); color: var(--bad); }
.tag-neutral { background: rgba(242, 153, 74, 0.18); color: var(--orange); }
.tag-waiting { background: rgba(185, 198, 222, 0.12); color: var(--muted); }
@media (max-width: 900px) {
  .dashboard-card { grid-template-columns: 1fr; }
}
@media (max-width: 600px) {
  .app { padding: 20px 14px 48px; }
  .topbar { flex-direction: column; text-align: center; gap: 10px; margin-bottom: 20px; }
  .topbar-left { flex-direction: column; gap: 8px; }
  .card, .dashboard-col { padding: 20px; }
  .card h2 { text-align: center; }
  .note { text-align: center; }
  .score-row { justify-content: center; }
  .actions { justify-content: center; }
  .rounds-label { justify-content: space-between; width: 100%; }
  .btn { width: 100%; }
  .actions { flex-direction: column; align-items: stretch; }
  .team-join-grid { grid-template-columns: repeat(2, 1fr); }

  .history thead { display: none; }
  .history, .history tbody, .history tr, .history td { display: block; width: 100%; }
  .history tr { border: 1px solid var(--border); border-radius: 10px; margin-bottom: 12px; padding: 10px 14px; }
  .history td { border: none; padding: 6px 0; display: flex; justify-content: space-between; align-items: center; text-align: right; }
  .history td::before { content: attr(data-label); color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; text-align: left; }
}
.card h2 { margin: 0 0 4px; font-size: 22px; color: var(--white); letter-spacing: -0.01em; }
.note { color: var(--muted); font-size: 14px; line-height: 1.6; }
.text-input { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--white); font-size: 15px; margin-bottom: 16px; }
.team-join-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.team-join-btn { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px; border-radius: 8px; border: 1px solid var(--border); background: none; color: var(--white); cursor: pointer; font-size: 14px; }
.team-join-btn:disabled:not(.full) { opacity: 0.5; cursor: not-allowed; }
.team-join-btn.full { opacity: 0.35; cursor: not-allowed; border-color: var(--bad); }
.team-join-status { font-size: 12px; color: var(--orange); }
.score-row { display: flex; gap: 32px; margin: 16px 0 24px; }
.score-block { display: flex; flex-direction: column; gap: 2px; }
.score-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.score { font-size: 34px; font-weight: 700; color: var(--orange); }
.score-partner { color: var(--muted); font-size: 28px; }
.choice-row { display: flex; gap: 12px; margin: 20px 0; }
.choice { flex: 1; padding: 24px 16px; border-radius: 10px; border: 1px solid var(--border); background: none; color: var(--white); cursor: pointer; font-size: 19px; font-weight: 700; letter-spacing: 0.01em; transition: transform 0.1s ease, background 0.15s ease; }
.choice:not(:disabled):active { transform: scale(0.97); }
.choice.good.active { background: var(--good); border-color: var(--good); }
.choice.bad.active { background: var(--bad); border-color: var(--bad); }
.choice:disabled { opacity: 0.5; cursor: not-allowed; }
.pending-flag { font-size: 13px; color: var(--muted); }
.reveal-box { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-top: 20px; }
.reveal-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-size: 15px; }
.reveal-row + .reveal-row { border-top: 1px solid var(--border); }
.reveal-points { margin: 12px 0 0; font-size: 20px; font-weight: 700; color: var(--orange); text-align: center; }
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