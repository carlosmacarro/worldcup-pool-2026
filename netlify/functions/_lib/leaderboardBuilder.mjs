import { fetchAll } from './db.mjs';
import { scorePrediction, pointType } from './scoring.mjs';

function createParticipantSummary(participant) {
  return {
    participantKey: participant.participant_key,
    name: participant.name,
    fileName: participant.file_name,
    total: 0,
    exact: 0,
    goalDifference: 0,
    winner: 0,
    miss: 0,
    played: 0,
    pending: 0,
    breakdown: []
  };
}

function compareLeaders(a, b) {
  return (
    b.total - a.total ||
    b.exact - a.exact ||
    b.goalDifference - a.goalDifference ||
    b.winner - a.winner ||
    a.name.localeCompare(b.name)
  );
}

export async function buildLeaderboard() {
  const [participants, predictions, matches, logs] = await Promise.all([
    fetchAll('participants', { orderBy: 'name' }),
    fetchAll('predictions', { orderBy: 'match_no' }),
    fetchAll('matches', { orderBy: 'match_no' }),
    fetchAll('sync_logs', { orderBy: 'started_at', ascending: false })
  ]);

  const participantMap = new Map(participants.map((p) => [p.participant_key, createParticipantSummary(p)]));
  const matchMap = new Map(matches.map((m) => [m.match_no, m]));

  for (const prediction of predictions) {
    const participant = participantMap.get(prediction.participant_key);
    if (!participant) continue;
    const match = matchMap.get(prediction.match_no);

    const isScorable = Boolean(match?.is_scorable);
    let points = 0;
    let type = 'pending';

    if (isScorable) {
      points = scorePrediction(prediction.pred_home, prediction.pred_away, match.real_home, match.real_away);
      type = pointType(points);
      participant.total += points;
      participant.played += 1;
      if (points === 3) participant.exact += 1;
      else if (points === 2) participant.goalDifference += 1;
      else if (points === 1) participant.winner += 1;
      else participant.miss += 1;
    } else {
      participant.pending += 1;
    }

    participant.breakdown.push({
      matchNo: prediction.match_no,
      kickoff: match?.kickoff || prediction.kickoff,
      status: match?.status || 'PENDING',
      homeTeam: match?.home_team || prediction.home_team,
      awayTeam: match?.away_team || prediction.away_team,
      predicted: { home: prediction.pred_home, away: prediction.pred_away },
      actual: {
        home: match?.real_home ?? null,
        away: match?.real_away ?? null,
        source: match?.score_source || null
      },
      points,
      type
    });
  }

  const leaderboard = [...participantMap.values()].sort(compareLeaders).map((entry, index, arr) => {
    const previous = arr[index - 1];
    const tied = previous && compareLeaders({ ...previous, name: entry.name }, { ...entry, name: previous.name }) === 0;
    return { ...entry, rank: tied ? previous.rank : index + 1 };
  });

  const latestLog = logs[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    lastSync: latestLog
      ? {
          startedAt: latestLog.started_at,
          finishedAt: latestLog.finished_at,
          ok: latestLog.ok,
          source: latestLog.source,
          participantsCount: latestLog.participants_count,
          predictionsCount: latestLog.predictions_count,
          matchesCount: latestLog.matches_count,
          warnings: latestLog.warnings || [],
          error: latestLog.error
        }
      : null,
    summary: {
      participants: participants.length,
      predictions: predictions.length,
      matches: matches.length,
      scorableMatches: matches.filter((m) => m.is_scorable).length,
      finishedMatches: matches.filter((m) => m.status === 'FINISHED').length
    },
    matches: matches.map((m) => ({
      matchNo: m.match_no,
      kickoff: m.kickoff,
      status: m.status,
      stage: m.stage,
      groupName: m.group_name,
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      realHome: m.real_home,
      realAway: m.real_away,
      isScorable: m.is_scorable
    })),
    leaderboard
  };
}
