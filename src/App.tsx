import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  BarChart3,
  Copy,
  Download,
  FolderKanban,
  LayoutDashboard,
  ListRestart,
  Plus,
  Settings,
  ShieldCheck,
  Swords,
  Trash2,
  Trophy,
  Upload,
  Users,
  WandSparkles,
} from 'lucide-react';

type NavigationTab = 'dashboard' | 'tournaments' | 'participants' | 'settings';
type ParticipantType = 'Pessoa' | 'Equipe' | 'Dupla';
type MatchStatus = 'pendente' | 'finalizada';
type TournamentStatus = 'rascunho' | 'ativo' | 'finalizado' | 'arquivado';

type TournamentMatch = {
  id: string;
  stage: 'group' | 'knockout';
  groupId: string;
  roundName: string;
  round: number;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  homeScore2: number;
  awayScore2: number;
  isAggregate: boolean;
  winnerId?: string;
  status: MatchStatus;
};

type Group = {
  id: string;
  name: string;
  participantIds: string[];
};

type Participant = {
  id: string;
  name: string;
  type: ParticipantType;
  alias: string;
  description: string;
};

type Tournament = {
  id: string;
  name: string;
  modality: string;
  description: string;
  startDate: string;
  endDate: string;
  status: TournamentStatus;
  participants: string[];
  groups: Group[];
  groupMatches: TournamentMatch[];
  knockoutMatches: TournamentMatch[];
  knockoutFormat: 'single' | 'aggregate';
  groupCount: number;
  groupRounds: number;
  qualifiersPerGroup: number;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  createdAt: string;
  updatedAt: string;
};

type StoredState = {
  participants: Participant[];
  tournaments: Tournament[];
};

const storageKey = 'x1-arena-state-v1';

const navigationItems: Array<{ id: NavigationTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'tournaments', label: 'Campeonatos', icon: Trophy },
  { id: 'participants', label: 'Participantes', icon: Users },
  { id: 'settings', label: 'Configurações', icon: Settings },
];

const defaultParticipantForm = {
  name: '',
  type: 'Pessoa' as ParticipantType,
  alias: '',
  description: '',
};

const defaultTournamentForm = {
  name: '',
  modality: 'Futebol',
  description: '',
  startDate: '',
  endDate: '',
  type: 'grupos',
  groupCount: 4,
  groupRounds: 1,
  qualifiersPerGroup: 2,
  knockoutFormat: 'single' as 'single' | 'aggregate',
};

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function readStorageState(): StoredState {
  if (typeof window === 'undefined') {
    return { participants: [], tournaments: [] };
  }

  try {
    const value = window.localStorage.getItem(storageKey);
    if (!value) {
      return { participants: [], tournaments: [] };
    }

    const parsed = JSON.parse(value) as Partial<StoredState>;
    return {
      participants: Array.isArray(parsed.participants) ? parsed.participants : [],
      tournaments: Array.isArray(parsed.tournaments) ? parsed.tournaments : [],
    };
  } catch {
    return { participants: [], tournaments: [] };
  }
}

function formatDate(dateValue: string) {
  if (!dateValue) {
    return 'Sem data';
  }

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return 'Sem data';
  }

  return parsed.toLocaleDateString('pt-BR');
}

function getParticipantName(participants: Participant[], participantId: string | undefined) {
  if (!participantId) {
    return 'A definir';
  }

  const participant = participants.find((item) => item.id === participantId);
  if (!participant) {
    return 'A definir';
  }
  return participant.alias || participant.name;
}

function resolveBracketParticipant(tournament: Tournament, participantRef: string | undefined, depth = 0): string | undefined {
  if (!participantRef || participantRef === 'bye' || depth > tournament.knockoutMatches.length) {
    return undefined;
  }

  if (!participantRef.startsWith('winner:')) {
    return tournament.participants.includes(participantRef) ? participantRef : undefined;
  }

  const [, roundText, indexText] = participantRef.split(':');
  const round = Number(roundText);
  const index = Number(indexText);
  if (!Number.isInteger(round) || !Number.isInteger(index) || index < 0) {
    return undefined;
  }

  const previousMatch = tournament.knockoutMatches.filter((match) => match.round === round)[index];
  if (!previousMatch?.winnerId) {
    return undefined;
  }

  return resolveBracketParticipant(tournament, previousMatch.winnerId, depth + 1);
}

function sanitizeTournamentParticipants(tournament: Tournament, validParticipantIds: Set<string>): Tournament {
  const normalizedGroups = tournament.groups.map((group) => ({
    ...group,
    participantIds: group.participantIds.filter((participantId) => validParticipantIds.has(participantId)),
  }));

  const normalizedGroupMatches = tournament.groupMatches.map((match) => {
    const homeIsValid = match.homeId && validParticipantIds.has(match.homeId);
    const awayIsValid = match.awayId && validParticipantIds.has(match.awayId);

    if (!homeIsValid || !awayIsValid) {
      return {
        ...match,
        homeId: homeIsValid ? match.homeId : '',
        awayId: awayIsValid ? match.awayId : '',
        winnerId: undefined,
        status: 'pendente' as MatchStatus,
        homeScore: 0,
        awayScore: 0,
        homeScore2: 0,
        awayScore2: 0,
      } as TournamentMatch;
    }

    if (match.winnerId && !validParticipantIds.has(match.winnerId) && !match.winnerId.startsWith('winner:')) {
      return {
        ...match,
        winnerId: undefined,
        status: 'pendente' as MatchStatus,
      } as TournamentMatch;
    }

    return match;
  });

  const normalizedKnockoutMatches = tournament.knockoutMatches.map((match) => {
    const isBracketReference = (participantId: string) =>
      participantId === 'bye' || participantId.startsWith('winner:') || validParticipantIds.has(participantId);
    const homeIsValid = match.homeId && isBracketReference(match.homeId);
    const awayIsValid = match.awayId && isBracketReference(match.awayId);

    if (!homeIsValid || !awayIsValid) {
      return {
        ...match,
        homeId: homeIsValid ? match.homeId : '',
        awayId: awayIsValid ? match.awayId : '',
        winnerId: undefined,
        status: 'pendente' as MatchStatus,
        homeScore: 0,
        awayScore: 0,
        homeScore2: 0,
        awayScore2: 0,
      } as TournamentMatch;
    }

    if (match.winnerId && !validParticipantIds.has(match.winnerId) && !match.winnerId.startsWith('winner:')) {
      return {
        ...match,
        winnerId: undefined,
        status: 'pendente' as MatchStatus,
      } as TournamentMatch;
    }

    return match;
  });

  return {
    ...tournament,
    participants: tournament.participants.filter((participantId) => validParticipantIds.has(participantId)),
    groups: normalizedGroups,
    groupMatches: normalizedGroupMatches,
    knockoutMatches: normalizedKnockoutMatches,
    updatedAt: new Date().toISOString(),
  };
}

function nextPowerOfTwo(size: number) {
  let value = 2;
  while (value < size) {
    value *= 2;
  }
  return value;
}

function buildGroupSchedule(participantIds: string[], roundsCount = 1) {
  const roster = [...participantIds];
  if (roster.length === 0) {
    return [] as TournamentMatch[];
  }

  const totalRounds = Math.max(1, roundsCount);
  const matches: TournamentMatch[] = [];

  for (let roundCycle = 0; roundCycle < totalRounds; roundCycle += 1) {
    const roundRoster = [...roster];
    if (roundRoster.length % 2 !== 0) {
      roundRoster.push('bye');
    }

    const seenPairs = new Set<string>();
    const rounds = roundRoster.length - 1;

    for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
      for (let index = 0; index < roundRoster.length / 2; index += 1) {
        const homeId = roundRoster[index];
        const awayId = roundRoster[roundRoster.length - 1 - index];

        if (homeId === 'bye' || awayId === 'bye') {
          continue;
        }

        const pairKey = [homeId, awayId].sort().join('|');
        if (seenPairs.has(pairKey)) {
          continue;
        }

        seenPairs.add(pairKey);
        matches.push({
          id: createId('match'),
          stage: 'group',
          groupId: '',
          roundName: `Rodada ${roundCycle + 1}.${roundIndex + 1}`,
          round: roundCycle + 1,
          homeId,
          awayId,
          homeScore: 0,
          awayScore: 0,
          homeScore2: 0,
          awayScore2: 0,
          isAggregate: false,
          status: 'pendente',
        });
      }

      roundRoster.splice(1, 0, roundRoster.pop() as string);
    }
  }

  return matches;
}

function calculateStandings(group: Group, tournament: Tournament, participants: Participant[]) {
  const participantMap = new Map(participants.map((participant) => [participant.id, participant]));
  const matches = tournament.groupMatches.filter((match) => match.groupId === group.id);
  const rows = group.participantIds.map((participantId) => {
    const participant = participantMap.get(participantId);

    return {
      id: participantId,
      name: participant ? participant.alias || participant.name : 'Participante',
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      goalDifference: 0,
    };
  });

  for (const match of matches) {
    if (match.status !== 'finalizada') {
      continue;
    }

    const home = rows.find((row) => row.id === match.homeId);
    const away = rows.find((row) => row.id === match.awayId);

    if (!home || !away) {
      continue;
    }

    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;

    if (match.homeScore > match.awayScore) {
      home.wins += 1;
      home.points += tournament.pointsWin ?? 3;
      away.losses += 1;
    } else if (match.homeScore < match.awayScore) {
      away.wins += 1;
      away.points += tournament.pointsWin ?? 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += tournament.pointsDraw ?? 1;
      away.points += tournament.pointsDraw ?? 1;
    }
  }

  for (const row of rows) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
  }

  return rows.sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    if (b.wins !== a.wins) {
      return b.wins - a.wins;
    }
    if (b.goalDifference !== a.goalDifference) {
      return b.goalDifference - a.goalDifference;
    }
    if (b.goalsFor !== a.goalsFor) {
      return b.goalsFor - a.goalsFor;
    }
    return a.name.localeCompare(b.name);
  });
}

function createTournamentGroups(participantIds: string[], groupCount: number) {
  const validGroupCount = Math.max(1, Math.min(groupCount, participantIds.length));
  const groups: Group[] = Array.from({ length: validGroupCount }, (_, index) => ({
    id: createId(`group-${index + 1}`),
    name: `Grupo ${String.fromCharCode(65 + index)}`,
    participantIds: [],
  }));

  const shuffled = [...participantIds].sort(() => Math.random() - 0.5);
  const counts = Array.from({ length: validGroupCount }, () => 0);

  for (const participantId of shuffled) {
    let targetGroupIndex = 0;
    let smallestCount = Number.POSITIVE_INFINITY;

    for (let index = 0; index < counts.length; index += 1) {
      if (counts[index] < smallestCount) {
        smallestCount = counts[index];
        targetGroupIndex = index;
      }
    }

    groups[targetGroupIndex].participantIds.push(participantId);
    counts[targetGroupIndex] += 1;
  }

  return groups.filter((group) => group.participantIds.length > 0);
}

function getRoundLabel(round: number, bracketSize: number) {
  const participantsInRound = bracketSize / 2 ** (round - 1);
  const roundLabels: Record<number, string> = {
    2: 'Final',
    4: 'Semifinal',
    8: 'Quartas de final',
    16: 'Oitavas de final',
    32: '16 avos de final',
    64: '32 avos de final',
  };
  return roundLabels[participantsInRound] ?? `Rodada ${round}`;
}

function generateKnockoutBracket(participantIds: string[], format: 'single' | 'aggregate' = 'single') {
  const validParticipants = participantIds.filter((participantId) => participantId && participantId !== 'bye');
  if (validParticipants.length < 2) {
    return [] as TournamentMatch[];
  }

  const size = nextPowerOfTwo(Math.max(2, validParticipants.length));
  const entrants = [...validParticipants];
  while (entrants.length < size) {
    entrants.push('bye');
  }

  let seedOrder = [1, 2];
  while (seedOrder.length < size) {
    const nextSize = seedOrder.length * 2;
    seedOrder = seedOrder.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }

  const matches: TournamentMatch[] = [];
  let currentRoundEntrants = seedOrder.map((seed) => entrants[seed - 1]);
  let round = 1;

  while (currentRoundEntrants.length > 1) {
    const roundMatches: TournamentMatch[] = [];
    for (let index = 0; index < currentRoundEntrants.length; index += 2) {
      const homeId = currentRoundEntrants[index];
      const awayId = currentRoundEntrants[index + 1];
      const byeWinner = homeId === 'bye' ? awayId : awayId === 'bye' ? homeId : undefined;

      roundMatches.push({
        id: createId('knockout'),
        stage: 'knockout',
        groupId: 'bracket',
        roundName: getRoundLabel(round, size),
        round,
        homeId,
        awayId,
        homeScore: 0,
        awayScore: 0,
        homeScore2: 0,
        awayScore2: 0,
        isAggregate: format === 'aggregate',
        winnerId: byeWinner === 'bye' ? undefined : byeWinner,
        status: byeWinner && byeWinner !== 'bye' ? 'finalizada' : 'pendente',
      });
    }

    if (roundMatches.length === 0) {
      break;
    }

    matches.push(...roundMatches);
    currentRoundEntrants = roundMatches.map((_, matchIndex) => `winner:${round}:${matchIndex}`);
    round += 1;
  }

  return matches;
}

function App() {
  const [participants, setParticipants] = useState<Participant[]>(() => readStorageState().participants);
  const [tournaments, setTournaments] = useState<Tournament[]>(() => readStorageState().tournaments);
  const [activeTab, setActiveTab] = useState<NavigationTab>('dashboard');
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [showCreateTournament, setShowCreateTournament] = useState(false);
  const [participantForm, setParticipantForm] = useState(defaultParticipantForm);
  const [tournamentForm, setTournamentForm] = useState(defaultTournamentForm);
  const [selectedParticipantForTournament, setSelectedParticipantForTournament] = useState('');
  const [importText, setImportText] = useState('');

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify({ participants, tournaments }));
  }, [participants, tournaments]);

  const selectedTournament = useMemo(
    () => tournaments.find((tournament) => tournament.id === selectedTournamentId) ?? tournaments[0] ?? null,
    [selectedTournamentId, tournaments],
  );

  useEffect(() => {
    if (!selectedTournamentId && tournaments[0]) {
      setSelectedTournamentId(tournaments[0].id);
    }
  }, [selectedTournamentId, tournaments]);

  const metrics = useMemo(() => {
    const total = tournaments.length;
    const active = tournaments.filter((tournament) => tournament.status === 'ativo').length;
    const finished = tournaments.filter((tournament) => tournament.status === 'finalizado').length;
    const totalParticipants = participants.length;

    return { total, active, finished, totalParticipants };
  }, [participants.length, tournaments]);

  const handleCreateParticipant = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!participantForm.name.trim()) {
      return;
    }

    const participant: Participant = {
      id: createId('participant'),
      name: participantForm.name.trim(),
      type: participantForm.type,
      alias: participantForm.alias.trim(),
      description: participantForm.description.trim(),
    };

    setParticipants((current) => [participant, ...current]);
    setParticipantForm(defaultParticipantForm);
  };

  const handleCreateTournament = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!tournamentForm.name.trim()) {
      return;
    }

    const tournament: Tournament = {
      id: createId('tournament'),
      name: tournamentForm.name.trim(),
      modality: tournamentForm.modality,
      description: tournamentForm.description.trim(),
      startDate: tournamentForm.startDate,
      endDate: tournamentForm.endDate,
      status: 'rascunho',
      participants: [],
      groups: [],
      groupMatches: [],
      knockoutMatches: [],
      knockoutFormat: tournamentForm.knockoutFormat,
      groupCount: Math.max(1, Number(tournamentForm.groupCount) || 1),
      groupRounds: Math.max(1, Number(tournamentForm.groupRounds) || 1),
      qualifiersPerGroup: Math.max(1, Number(tournamentForm.qualifiersPerGroup) || 1),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
    };

    setTournaments((current) => [tournament, ...current]);
    setSelectedTournamentId(tournament.id);
    setActiveTab('tournaments');
    setShowCreateTournament(false);
    setTournamentForm(defaultTournamentForm);
  };

  const handleDeleteTournament = (tournamentId: string) => {
    const tournament = tournaments.find((item) => item.id === tournamentId);
    if (!tournament) {
      return;
    }

    const shouldDelete = window.confirm(`Deseja excluir o campeonato "${tournament.name}"?`);
    if (!shouldDelete) {
      return;
    }

    setTournaments((current) => current.filter((item) => item.id !== tournamentId));
    if (selectedTournamentId === tournamentId) {
      const next = tournaments.find((item) => item.id !== tournamentId);
      setSelectedTournamentId(next ? next.id : null);
    }
  };

  const handleDuplicateTournament = (tournamentId: string) => {
    const tournament = tournaments.find((item) => item.id === tournamentId);
    if (!tournament) {
      return;
    }

    const clone: Tournament = {
      ...tournament,
      id: createId('tournament'),
      name: `${tournament.name} (Cópia)`,
      status: 'rascunho',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      groups: tournament.groups.map((group) => ({ ...group, id: createId('group') })),
      groupMatches: tournament.groupMatches.map((match) => ({ ...match, id: createId('match') })),
      knockoutMatches: tournament.knockoutMatches.map((match) => ({ ...match, id: createId('match') })),
    };

    setTournaments((current) => [clone, ...current]);
  };

  const handleAddParticipantToTournament = () => {
    if (!selectedTournament || !selectedParticipantForTournament) {
      return;
    }

    setTournaments((current) =>
      current.map((tournament) => {
        if (tournament.id !== selectedTournament.id) {
          return tournament;
        }

        if (tournament.participants.includes(selectedParticipantForTournament)) {
          return tournament;
        }

        return {
          ...tournament,
          participants: [...tournament.participants, selectedParticipantForTournament],
          updatedAt: new Date().toISOString(),
        };
      }),
    );

    setSelectedParticipantForTournament('');
  };

  const handleGenerateGroups = () => {
    if (!selectedTournament) {
      return;
    }

    setTournaments((current) =>
      current.map((tournament) => {
        if (tournament.id !== selectedTournament.id) {
          return tournament;
        }

        const effectiveGroupCount = Math.max(1, Math.min(tournament.groupCount || 4, tournament.participants.length || 1));
        const groups = createTournamentGroups(tournament.participants, effectiveGroupCount);
        const nextGroupMatches: TournamentMatch[] = [];

        for (const group of groups) {
          const matches = buildGroupSchedule(group.participantIds, tournament.groupRounds).map((match) => ({
            ...match,
            groupId: group.id,
          }));
          nextGroupMatches.push(...matches);
        }

        return {
          ...tournament,
          groups,
          groupMatches: nextGroupMatches,
          knockoutMatches: [],
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  };

  const handleGenerateBracket = () => {
    if (!selectedTournament) {
      return;
    }

    if (selectedTournament.groups.length === 0) {
      window.alert('Gere os grupos e as partidas antes de criar o mata-mata.');
      return;
    }

    if (selectedTournament.groupMatches.some((match) => match.status !== 'finalizada')) {
      window.alert('Finalize todas as partidas da fase de grupos antes de criar o mata-mata.');
      return;
    }

    if (selectedTournament.knockoutMatches.length > 0 && !window.confirm('Refazer o mata-mata vai apagar os resultados eliminatórios atuais. Deseja continuar?')) {
      return;
    }

    const standingsByGroup = selectedTournament.groups.map((group) =>
      calculateStandings(group, selectedTournament, participants),
    );
    const qualifiersPerGroup = Math.max(1, selectedTournament.qualifiersPerGroup ?? 2);
    const maxAvailablePerGroup = Math.min(...standingsByGroup.map((standings) => standings.length));
    const qualifierCount = Math.min(qualifiersPerGroup, maxAvailablePerGroup);
    const qualifiers = Array.from({ length: qualifierCount }, (_, rank) =>
      standingsByGroup.flatMap((standings) => standings[rank] ? [standings[rank]] : []),
    ).flat();

    if (qualifiers.length < 2) {
      window.alert('São necessários pelo menos dois classificados para criar o mata-mata.');
      return;
    }

    setTournaments((current) =>
      current.map((tournament) =>
        tournament.id === selectedTournament.id
          ? {
              ...tournament,
              knockoutFormat: tournament.knockoutFormat || 'single',
              knockoutMatches: generateKnockoutBracket(
                qualifiers.map((qualifier) => qualifier.id),
                tournament.knockoutFormat || 'single',
              ),
              updatedAt: new Date().toISOString(),
            }
          : tournament,
      ),
    );
  };

  const updateMatchScore = (matchId: string, homeScore: number, awayScore: number, secondLegHomeScore = 0, secondLegAwayScore = 0) => {
    if (!selectedTournament) {
      return;
    }

    setTournaments((current) =>
      current.map((tournament) => {
        if (tournament.id !== selectedTournament.id) {
          return tournament;
        }

        const groupMatches = tournament.groupMatches.map((match) => {
          if (match.id !== matchId) {
            return match;
          }

          const status: MatchStatus = 'finalizada';
          const matchWinner = homeScore === awayScore ? undefined : homeScore > awayScore ? match.homeId : match.awayId;

          return {
            ...match,
            homeScore,
            awayScore,
            homeScore2: secondLegHomeScore,
            awayScore2: secondLegAwayScore,
            winnerId: matchWinner,
            status,
          };
        });

        const isGroupMatch = tournament.groupMatches.some((match) => match.id === matchId);
        const editedKnockoutMatch = tournament.knockoutMatches.find((match) => match.id === matchId);
        let knockoutMatches = isGroupMatch ? [] : tournament.knockoutMatches.map((match) => {
          if (match.id !== matchId) {
            return match;
          }

          const homeParticipantId = resolveBracketParticipant(tournament, match.homeId);
          const awayParticipantId = resolveBracketParticipant(tournament, match.awayId);
          if (!homeParticipantId || !awayParticipantId) {
            return match;
          }

          const status: MatchStatus = 'finalizada';
          let matchWinner: string | undefined;

          if (match.isAggregate) {
            const totalHome = homeScore + secondLegHomeScore;
            const totalAway = awayScore + secondLegAwayScore;
            if (totalHome !== totalAway) {
              matchWinner = totalHome > totalAway ? homeParticipantId : awayParticipantId;
            }
          } else {
            matchWinner = homeScore === awayScore ? undefined : homeScore > awayScore ? homeParticipantId : awayParticipantId;
          }

          return {
            ...match,
            homeScore,
            awayScore,
            homeScore2: secondLegHomeScore,
            awayScore2: secondLegAwayScore,
            winnerId: matchWinner,
            status,
          };
        });

        if (editedKnockoutMatch) {
          knockoutMatches = knockoutMatches.map((match) =>
            match.round > editedKnockoutMatch.round
              ? {
                  ...match,
                  homeScore: 0,
                  awayScore: 0,
                  homeScore2: 0,
                  awayScore2: 0,
                  winnerId: undefined,
                  status: 'pendente',
                }
              : match,
          );
        }

        return {
          ...tournament,
          groupMatches,
          knockoutMatches,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  };

  const handleExportData = () => {
    const blob = new Blob([JSON.stringify({ participants, tournaments }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'x1-arena-backup.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImportData = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) {
      return;
    }

    const file = event.target.files[0];
    const text = await file.text();

    try {
      const parsed = JSON.parse(text) as Partial<StoredState>;
      if (!Array.isArray(parsed.participants) || !Array.isArray(parsed.tournaments)) {
        throw new Error('Arquivo inválido');
      }

      setParticipants(parsed.participants);
      setTournaments(parsed.tournaments);
      setSelectedTournamentId(parsed.tournaments[0]?.id ?? null);
      setImportText('Importação concluída com sucesso.');
    } catch {
      setImportText('Arquivo inválido ou incompatível com o formato do X1 Arena.');
    }
  };

  const handleResetStorage = () => {
    const confirmed = window.confirm('Deseja limpar todos os dados do navegador?');
    if (!confirmed) {
      return;
    }

    setParticipants([]);
    setTournaments([]);
    setSelectedTournamentId(null);
    window.localStorage.removeItem(storageKey);
  };

  const handleManualGroupAssignment = (groupId: string, participantId: string) => {
    if (!selectedTournament) {
      return;
    }

    if (
      selectedTournament.groupMatches.some((match) => match.status === 'finalizada')
      && !window.confirm('Alterar a distribuição dos grupos vai apagar os resultados de grupo e do mata-mata. Deseja continuar?')
    ) {
      return;
    }

    setTournaments((current) =>
      current.map((tournament) => {
        if (tournament.id !== selectedTournament.id) {
          return tournament;
        }

        const nextGroups = tournament.groups.map((group) => {
          const nextParticipantIds = group.participantIds.filter((id) => id !== participantId);
          if (group.id === groupId) {
            return {
              ...group,
              participantIds: [...new Set([...nextParticipantIds, participantId])],
            };
          }
          return { ...group, participantIds: nextParticipantIds };
        });

        const groupMatches = nextGroups.flatMap((group) =>
          buildGroupSchedule(group.participantIds, tournament.groupRounds).map((match) => ({
            ...match,
            groupId: group.id,
          })),
        );

        return {
          ...tournament,
          groups: nextGroups,
          groupMatches,
          knockoutMatches: [],
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="sport-stat rounded-2xl p-5 shadow-soft">
          <div className="flex items-center justify-between text-slate-300">
            <span>Total</span>
            <Trophy className="h-4 w-4 text-lime-400" />
          </div>
          <div className="mt-3 text-3xl font-bold text-white">{metrics.total}</div>
          <p className="mt-2 text-sm text-slate-400">Campeonatos cadastrados</p>
        </div>

        <div className="sport-stat rounded-2xl p-5 shadow-soft">
          <div className="flex items-center justify-between text-slate-300">
            <span>Em andamento</span>
            <FolderKanban className="h-4 w-4 text-lime-400" />
          </div>
          <div className="mt-3 text-3xl font-bold text-white">{metrics.active}</div>
          <p className="mt-2 text-sm text-slate-400">Competições ativas</p>
        </div>

        <div className="sport-stat rounded-2xl p-5 shadow-soft">
          <div className="flex items-center justify-between text-slate-300">
            <span>Finalizados</span>
            <ShieldCheck className="h-4 w-4 text-lime-400" />
          </div>
          <div className="mt-3 text-3xl font-bold text-white">{metrics.finished}</div>
          <p className="mt-2 text-sm text-slate-400">Competições concluídas</p>
        </div>

        <div className="sport-stat rounded-2xl p-5 shadow-soft">
          <div className="flex items-center justify-between text-slate-300">
            <span>Participantes</span>
            <Users className="h-4 w-4 text-lime-400" />
          </div>
          <div className="mt-3 text-3xl font-bold text-white">{metrics.totalParticipants}</div>
          <p className="mt-2 text-sm text-slate-400">Registros ativos</p>
        </div>
      </div>

      <div className="sport-card rounded-2xl border border-dashed border-lime-500/40 p-8">
        {tournaments.length === 0 ? (
          <div className="text-center">
            <Trophy className="mx-auto h-12 w-12 text-lime-400" />
            <h3 className="mt-4 text-2xl font-semibold text-white">Nenhum campeonato ainda</h3>
            <p className="mt-2 text-slate-400">Crie o primeiro campeonato para começar a gestão de grupos, partidas e classificações.</p>
            <button
              type="button"
              onClick={() => {
                setShowCreateTournament(true);
                setActiveTab('tournaments');
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-lime-400 px-4 py-2 font-semibold text-slate-900 transition hover:bg-lime-300"
            >
              <Plus className="h-4 w-4" />
              Novo campeonato
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-white">Campeonatos recentes</h3>
              <button
                type="button"
                onClick={() => setActiveTab('tournaments')}
                className="text-sm text-lime-300 underline-offset-4 hover:underline"
              >
                Ver todos
              </button>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {tournaments.slice(0, 4).map((tournament) => (
                <button
                  key={tournament.id}
                  type="button"
                  onClick={() => setSelectedTournamentId(tournament.id)}
                  className="rounded-2xl border border-white/10 bg-[#131f1d] p-4 text-left transition hover:border-lime-500/50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold text-white">{tournament.name}</p>
                      <p className="text-xs uppercase tracking-[0.22em] text-lime-300">{tournament.modality}</p>
                    </div>
                    <span className="rounded-full border border-lime-500/40 bg-lime-500/10 px-2 py-1 text-[11px] font-medium text-lime-200">
                      {tournament.status}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-slate-400">{tournament.description || 'Sem descrição.'}</p>
                  <p className="mt-4 text-xs text-slate-500">{formatDate(tournament.startDate)} · {tournament.participants.length} participantes</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderTournamentList = () => (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">Campeonatos</h2>
          <p className="text-sm text-slate-400">Gerencie competições, grupos e chaveamentos.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateTournament((current) => !current)}
          className="inline-flex items-center gap-2 rounded-xl bg-lime-400 px-4 py-2 font-semibold text-slate-900 transition hover:bg-lime-300"
        >
          <Plus className="h-4 w-4" />
          Criar campeonato
        </button>
      </div>

      {showCreateTournament && (
        <form onSubmit={handleCreateTournament} className="sport-card rounded-2xl p-5 shadow-soft">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-300">
              Nome do campeonato
              <input
                value={tournamentForm.name}
                onChange={(event) => setTournamentForm((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none ring-0 placeholder:text-slate-500"
                placeholder="Copa Regional"
              />
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              Modalidade
              <input
                value={tournamentForm.modality}
                onChange={(event) => setTournamentForm((current) => ({ ...current, modality: event.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none placeholder:text-slate-500"
                placeholder="Futsal"
              />
            </label>

            <label className="space-y-2 text-sm text-slate-300 md:col-span-2">
              Descrição
              <textarea
                value={tournamentForm.description}
                onChange={(event) => setTournamentForm((current) => ({ ...current, description: event.target.value }))}
                className="min-h-20 w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none placeholder:text-slate-500"
                placeholder="Detalhes da competição, regras e observações."
              />
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              Início
              <input
                type="date"
                value={tournamentForm.startDate}
                onChange={(event) => setTournamentForm((current) => ({ ...current, startDate: event.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none"
              />
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              Encerramento
              <input
                type="date"
                value={tournamentForm.endDate}
                onChange={(event) => setTournamentForm((current) => ({ ...current, endDate: event.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none"
              />
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              Quantidade de grupos
              <select
                value={tournamentForm.groupCount}
                onChange={(event) => setTournamentForm((current) => ({ ...current, groupCount: Number(event.target.value) }))}
                className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none"
              >
                {[1, 2, 3, 4, 5, 6].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              Quantidade de turnos
              <select
                value={tournamentForm.groupRounds}
                onChange={(event) => setTournamentForm((current) => ({ ...current, groupRounds: Number(event.target.value) }))}
                className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none"
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              Classificados por grupo
              <input
                type="number"
                min="1"
                value={tournamentForm.qualifiersPerGroup}
                onChange={(event) => setTournamentForm((current) => ({ ...current, qualifiersPerGroup: Math.max(1, Number(event.target.value) || 1) }))}
                className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none"
              />
              <span className="block text-xs text-slate-500">Escolha quantos avançam de cada grupo para o mata-mata.</span>
            </label>

            <label className="space-y-2 text-sm text-slate-300">
              Formato do mata-mata
              <select
                value={tournamentForm.knockoutFormat}
                onChange={(event) => setTournamentForm((current) => ({ ...current, knockoutFormat: event.target.value as 'single' | 'aggregate' }))}
                className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none"
              >
                <option value="single">Jogo único</option>
                <option value="aggregate">Ida e volta / agregado</option>
              </select>
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={() => setShowCreateTournament(false)} className="rounded-xl border border-white/10 px-4 py-2 text-slate-200">
              Cancelar
            </button>
            <button type="submit" className="rounded-xl bg-lime-400 px-4 py-2 font-semibold text-slate-900 hover:bg-lime-300">
              Salvar campeonato
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-4">
        {tournaments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-[#101b18] p-8 text-center text-slate-400">
            Nenhum campeonato criado até o momento.
          </div>
        ) : (
          tournaments.map((tournament) => (
            <div key={tournament.id} className={`rounded-2xl border p-4 ${selectedTournament?.id === tournament.id ? 'border-lime-500/60 bg-[#101b18]' : 'border-white/10 bg-[#101b18]'}`}>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <button type="button" onClick={() => setSelectedTournamentId(tournament.id)} className="text-left">
                    <div className="text-xl font-semibold text-white">{tournament.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.2em] text-lime-300">{tournament.modality}</div>
                  </button>
                  <p className="mt-2 text-sm text-slate-400">{tournament.description || 'Sem descrição.'}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setSelectedTournamentId(tournament.id)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">
                    Abrir
                  </button>
                  <button type="button" onClick={() => handleDuplicateTournament(tournament.id)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">
                    <span className="inline-flex items-center gap-2"><Copy className="h-4 w-4" />Duplicar</span>
                  </button>
                  <button type="button" onClick={() => handleDeleteTournament(tournament.id)} className="rounded-lg border border-red-500/60 px-3 py-2 text-sm text-red-200">
                    <span className="inline-flex items-center gap-2"><Trash2 className="h-4 w-4" />Excluir</span>
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                <span>Status: {tournament.status}</span>
                <span>Participantes: {tournament.participants.length}</span>
                <span>Início: {formatDate(tournament.startDate)}</span>
                <span>Encerramento: {formatDate(tournament.endDate)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderParticipants = () => (
    <div className="space-y-6">
      <form onSubmit={handleCreateParticipant} className="sport-card rounded-2xl p-5 shadow-soft">
        <div className="mb-4 flex items-center gap-3">
          <Users className="h-5 w-5 text-lime-400" />
          <h3 className="text-xl font-semibold text-white">Cadastrar participante</h3>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-300">
            Nome
            <input
              value={participantForm.name}
              onChange={(event) => setParticipantForm((current) => ({ ...current, name: event.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none placeholder:text-slate-500"
              placeholder="Equipe Alpha"
            />
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            Tipo
            <select
              value={participantForm.type}
              onChange={(event) => setParticipantForm((current) => ({ ...current, type: event.target.value as ParticipantType }))}
              className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none"
            >
              <option value="Pessoa">Pessoa</option>
              <option value="Equipe">Equipe</option>
              <option value="Dupla">Dupla</option>
            </select>
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            Apelido / identificação
            <input
              value={participantForm.alias}
              onChange={(event) => setParticipantForm((current) => ({ ...current, alias: event.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none placeholder:text-slate-500"
              placeholder="Alpha FC"
            />
          </label>

          <div className="hidden md:block" />

          <label className="space-y-2 text-sm text-slate-300 md:col-span-2">
            Observações
            <textarea
              value={participantForm.description}
              onChange={(event) => setParticipantForm((current) => ({ ...current, description: event.target.value }))}
              className="min-h-20 w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none placeholder:text-slate-500"
              placeholder="Descrição, categoria ou contexto do participante."
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end">
          <button type="submit" className="rounded-xl bg-lime-400 px-4 py-2 font-semibold text-slate-900 hover:bg-lime-300">
            Salvar participante
          </button>
        </div>
      </form>

      <div className="sport-card rounded-2xl p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">Participantes cadastrados</h3>
          <span className="text-sm text-slate-400">{participants.length} registros</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {participants.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-4 text-slate-400 md:col-span-2">
              Nenhum participante cadastrado.
            </div>
          ) : (
            participants.map((participant) => (
              <div key={participant.id} className="rounded-xl border border-white/10 bg-[#0d1715] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">{participant.name}</p>
                    <p className="text-xs uppercase tracking-[0.2em] text-lime-300">{participant.type}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const nextParticipants = participants.filter((item) => item.id !== participant.id);
                      setParticipants(nextParticipants);
                      setTournaments((current) =>
                        current.map((tournament) =>
                          sanitizeTournamentParticipants(tournament, new Set(nextParticipants.map((item) => item.id))),
                        ),
                      );
                    }}
                    className="rounded-lg border border-red-500/60 p-2 text-red-200"
                    aria-label="Excluir participante"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {participant.alias && <p className="mt-2 text-sm text-slate-300">{participant.alias}</p>}
                {participant.description && <p className="mt-2 text-sm text-slate-400">{participant.description}</p>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-6">
      <div className="sport-card rounded-2xl p-5 shadow-soft">
        <div className="mb-4 flex items-center gap-3">
          <Download className="h-5 w-5 text-lime-400" />
          <h3 className="text-xl font-semibold text-white">Backup e restauração</h3>
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={handleExportData} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d1715] px-4 py-2 text-slate-200">
            <Download className="h-4 w-4" />
            Exportar JSON
          </button>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-[#0d1715] px-4 py-2 text-slate-200">
            <Upload className="h-4 w-4" />
            Importar JSON
            <input type="file" accept="application/json" className="hidden" onChange={handleImportData} />
          </label>

          <button type="button" onClick={handleResetStorage} className="inline-flex items-center gap-2 rounded-xl border border-red-500/60 px-4 py-2 text-red-200">
            <ListRestart className="h-4 w-4" />
            Resetar dados
          </button>
        </div>

        {importText && <p className="mt-4 text-sm text-lime-300">{importText}</p>}
      </div>

      <div className="sport-card rounded-2xl p-5 shadow-soft">
        <div className="mb-4 flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-lime-400" />
          <h3 className="text-xl font-semibold text-white">Regras recomendadas</h3>
        </div>

        <ul className="space-y-2 text-sm text-slate-300">
          <li>• Vitória: 3 pontos | Empate: 1 ponto | Derrota: 0 pontos</li>
          <li>• Critérios de desempate: saldo de gols, gols marcados, confronto direto.</li>
          <li>• Grupos devem encaixar a quantidade disponível de participantes sem gerar vazios.</li>
          <li>• Chaves eliminatórias podem iniciar com BYEs quando houver quantidade ímpar.</li>
        </ul>
      </div>
    </div>
  );

  const tournamentContent = selectedTournament ? (() => {
    const knockoutRounds = Array.from(new Set(selectedTournament.knockoutMatches.map((match) => match.round))).sort((a, b) => a - b);
    const finalMatch = selectedTournament.knockoutMatches.reduce<TournamentMatch | undefined>(
      (latest, match) => (!latest || match.round > latest.round ? match : latest),
      undefined,
    );

    return (
    <div className="space-y-6">
      <div className="sport-card rounded-2xl p-5 shadow-soft">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-lime-300">{selectedTournament.modality}</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">{selectedTournament.name}</h2>
            <p className="mt-2 max-w-2xl text-slate-400">{selectedTournament.description || 'Sem descrição do campeonato.'}</p>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={handleGenerateGroups} className="rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-sm text-slate-200">
              Gerar grupos
            </button>
            <button type="button" onClick={handleGenerateBracket} className="rounded-xl border border-lime-500/30 bg-lime-500/10 px-3 py-2 text-sm text-lime-200">
              {selectedTournament.knockoutMatches.length > 0 ? 'Refazer mata-mata' : 'Gerar mata-mata'}
            </button>
            <span className="rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-xs text-slate-300">
              {selectedTournament.knockoutFormat === 'aggregate' ? 'Ida e volta' : 'Jogo único'}
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4 text-sm text-slate-300">
          <div className="rounded-xl border border-white/10 bg-[#0d1715] p-3">Início: {formatDate(selectedTournament.startDate)}</div>
          <div className="rounded-xl border border-white/10 bg-[#0d1715] p-3">Término: {formatDate(selectedTournament.endDate)}</div>
          <div className="rounded-xl border border-white/10 bg-[#0d1715] p-3">Participantes: {selectedTournament.participants.length}</div>
          <div className="rounded-xl border border-white/10 bg-[#0d1715] p-3">Status: {selectedTournament.status}</div>
        </div>
      </div>

      <div className="sport-card rounded-2xl p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">Inscrição de participantes</h3>
          <div className="flex gap-2">
            <select
              value={selectedParticipantForTournament}
              onChange={(event) => setSelectedParticipantForTournament(event.target.value)}
              className="rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-sm text-white"
            >
              <option value="">Escolha um participante</option>
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>{participant.name}</option>
              ))}
            </select>
            <button type="button" onClick={handleAddParticipantToTournament} className="rounded-xl bg-lime-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-lime-300">
              Adicionar
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {selectedTournament.participants.length === 0 ? (
            <span className="text-sm text-slate-400">Ainda não há participantes inscritos.</span>
          ) : (
            selectedTournament.participants.map((participantId) => (
              <span key={participantId} className="rounded-full border border-lime-500/30 bg-lime-500/10 px-3 py-1 text-sm text-lime-100">
                {getParticipantName(participants, participantId)}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="sport-card rounded-2xl p-5 shadow-soft">
        <div className="mb-4 flex items-center gap-2">
          <Swords className="h-5 w-5 text-lime-400" />
          <h3 className="text-xl font-semibold text-white">Configuração dos grupos</h3>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-2 text-sm text-slate-300">
            Quantidade de grupos
            <select
              value={selectedTournament.groupCount}
              onChange={(event) => {
                const nextGroupCount = Number(event.target.value);
                setTournaments((current) =>
                  current.map((tournament) =>
                    tournament.id === selectedTournament.id
                      ? { ...tournament, groupCount: nextGroupCount, updatedAt: new Date().toISOString() }
                      : tournament,
                  ),
                );
              }}
              className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none"
            >
              {[1, 2, 3, 4, 5, 6].map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            Turnos por grupo
            <select
              value={selectedTournament.groupRounds}
              onChange={(event) => {
                const nextGroupRounds = Number(event.target.value);
                setTournaments((current) =>
                  current.map((tournament) =>
                    tournament.id === selectedTournament.id
                      ? { ...tournament, groupRounds: nextGroupRounds, updatedAt: new Date().toISOString() }
                      : tournament,
                  ),
                );
              }}
              className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none"
            >
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            Classificados por grupo
            <input
              type="number"
              min="1"
              value={selectedTournament.qualifiersPerGroup ?? 2}
              onChange={(event) => {
                const nextQualifiersPerGroup = Math.max(1, Number(event.target.value) || 1);
                setTournaments((current) =>
                  current.map((tournament) =>
                    tournament.id === selectedTournament.id
                      ? { ...tournament, qualifiersPerGroup: nextQualifiersPerGroup, updatedAt: new Date().toISOString() }
                      : tournament,
                  ),
                );
              }}
              className="w-full rounded-xl border border-white/10 bg-[#0d1715] px-3 py-2 text-white outline-none"
            />
            <span className="block text-xs text-slate-500">A classificação é definida pela tabela de cada grupo.</span>
          </label>
        </div>

        {selectedTournament.groups.length > 0 && (
          <div className="mt-5 space-y-4">
            {selectedTournament.groups.map((group) => (
              <div key={group.id} className="rounded-xl border border-white/10 bg-[#0d1715] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-white">{group.name}</span>
                  <span className="text-xs text-slate-400">{group.participantIds.length} inscritos</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {selectedTournament.participants.map((participantId) => {
                    const isIncluded = group.participantIds.includes(participantId);
                    return (
                      <label key={participantId} className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#111c1a] px-2 py-2 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={isIncluded}
                          onChange={() => handleManualGroupAssignment(group.id, participantId)}
                          className="h-4 w-4 accent-lime-400"
                        />
                        {getParticipantName(participants, participantId)}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="sport-card rounded-2xl p-5 shadow-soft">
            <div className="mb-4 flex items-center gap-2">
              <Swords className="h-5 w-5 text-lime-400" />
              <h3 className="text-xl font-semibold text-white">Grupos</h3>
            </div>

            {selectedTournament.groups.length === 0 ? (
              <p className="text-sm text-slate-400">Os grupos ainda não foram gerados.</p>
            ) : (
              selectedTournament.groups.map((group) => {
                const standings = calculateStandings(group, selectedTournament, participants);
                return (
                  <div key={group.id} className="mb-5 rounded-xl border border-white/10 bg-[#0d1715] p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-white">{group.name}</h4>
                      <span className="text-xs text-slate-400">{group.participantIds.length} participantes</span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="text-slate-400">
                          <tr>
                            <th className="pb-2 pr-4">#</th>
                            <th className="pb-2 pr-4">Participante</th>
                            <th className="pb-2 pr-4">Pts</th>
                            <th className="pb-2 pr-4">J</th>
                            <th className="pb-2 pr-4">Vit</th>
                            <th className="pb-2 pr-4">SG</th>
                          </tr>
                        </thead>
                        <tbody className="text-slate-200">
                          {standings.map((row, index) => (
                            <tr key={row.id} className="border-t border-white/5">
                              <td className="py-2 pr-4">{index + 1}</td>
                              <td className="py-2 pr-4">{row.name}</td>
                              <td className="py-2 pr-4">{row.points}</td>
                              <td className="py-2 pr-4">{row.played}</td>
                              <td className="py-2 pr-4">{row.wins}</td>
                              <td className="py-2 pr-4">{row.goalDifference}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4 space-y-2">
                      {selectedTournament.groupMatches.filter((match) => match.groupId === group.id).map((match) => (
                        <div key={match.id} className="grid grid-cols-[1fr_auto_auto_1fr] items-center gap-2 rounded-lg border border-white/10 bg-[#111c1a] p-2 text-sm text-slate-200">
                          <span>{getParticipantName(participants, match.homeId)}</span>
                          <input
                            type="number"
                            value={match.homeScore}
                            onChange={(event) => updateMatchScore(match.id, Number(event.target.value), match.awayScore)}
                            className="w-12 rounded-md border border-white/10 bg-[#0d1715] px-1 py-1 text-center text-white"
                          />
                          <span className="font-semibold text-lime-200">x</span>
                          <input
                            type="number"
                            value={match.awayScore}
                            onChange={(event) => updateMatchScore(match.id, match.homeScore, Number(event.target.value))}
                            className="w-12 rounded-md border border-white/10 bg-[#0d1715] px-1 py-1 text-center text-white"
                          />
                          <span>{getParticipantName(participants, match.awayId)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-[#101b18] p-5 shadow-soft">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-lime-400" />
                <h3 className="text-xl font-semibold text-white">Mata-mata</h3>
              </div>
              <span className="rounded-full border border-lime-500/30 bg-lime-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-lime-200">
                {selectedTournament.knockoutFormat === 'aggregate' ? 'Agregado' : 'Único'}
              </span>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Avançam os {selectedTournament.qualifiersPerGroup ?? 2} melhores de cada grupo, conforme a classificação. Todas as partidas dos grupos precisam estar finalizadas.
            </p>

            {selectedTournament.knockoutMatches.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhuma chave gerada ainda.</p>
            ) : (
              <div className="space-y-4">
                {knockoutRounds.map((round) => (
                  <div key={round} className="space-y-3">
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-400">
                      {selectedTournament.knockoutMatches.find((match) => match.round === round)?.roundName ?? `Rodada ${round}`}
                    </div>
                    {selectedTournament.knockoutMatches
                      .filter((match) => match.round === round)
                      .map((match) => {
                        const homeParticipantId = resolveBracketParticipant(selectedTournament, match.homeId);
                        const awayParticipantId = resolveBracketParticipant(selectedTournament, match.awayId);
                        const isByeMatch = match.homeId === 'bye' || match.awayId === 'bye';
                        const canEnterScore = Boolean(homeParticipantId && awayParticipantId && !isByeMatch);

                        return (
                          <div key={match.id} className="rounded-xl border border-white/10 bg-[#0d1715] p-3">
                            <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">{match.roundName}</div>
                            <div className="space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <span>{match.homeId === 'bye' ? 'BYE' : getParticipantName(participants, homeParticipantId)}</span>
                                {isByeMatch ? (
                                  <span className="text-xs uppercase tracking-wider text-lime-300">Avança por bye</span>
                                ) : match.isAggregate ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      value={match.homeScore}
                                      onChange={(event) => updateMatchScore(match.id, Number(event.target.value), match.awayScore, match.homeScore2, match.awayScore2)}
                                      disabled={!canEnterScore}
                                      className="w-12 rounded-md border border-white/10 bg-[#0d1715] px-1 py-1 text-center text-white"
                                    />
                                    <span className="font-semibold text-lime-200">x</span>
                                    <input
                                      type="number"
                                      value={match.awayScore}
                                      onChange={(event) => updateMatchScore(match.id, match.homeScore, Number(event.target.value), match.homeScore2, match.awayScore2)}
                                      disabled={!canEnterScore}
                                      className="w-12 rounded-md border border-white/10 bg-[#0d1715] px-1 py-1 text-center text-white"
                                    />
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      value={match.homeScore}
                                      onChange={(event) => updateMatchScore(match.id, Number(event.target.value), match.awayScore)}
                                      disabled={!canEnterScore}
                                      className="w-12 rounded-md border border-white/10 bg-[#0d1715] px-1 py-1 text-center text-white"
                                    />
                                    <span className="font-semibold text-lime-200">x</span>
                                    <input
                                      type="number"
                                      value={match.awayScore}
                                      onChange={(event) => updateMatchScore(match.id, match.homeScore, Number(event.target.value))}
                                      disabled={!canEnterScore}
                                      className="w-12 rounded-md border border-white/10 bg-[#0d1715] px-1 py-1 text-center text-white"
                                    />
                                  </div>
                                )}
                                <span>{match.awayId === 'bye' ? 'BYE' : getParticipantName(participants, awayParticipantId)}</span>
                              </div>

                              {match.isAggregate && !isByeMatch && (
                                <div className="grid gap-2 rounded-lg border border-white/10 bg-[#111c1a] p-2 text-xs text-slate-300 md:grid-cols-2">
                                  <div className="space-y-1">
                                    <p className="uppercase tracking-[0.2em] text-slate-400">Ida</p>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="number"
                                        value={match.homeScore}
                                        onChange={(event) => updateMatchScore(match.id, Number(event.target.value), match.awayScore, match.homeScore2, match.awayScore2)}
                                        disabled={!canEnterScore}
                                        className="w-10 rounded-md border border-white/10 bg-[#0d1715] px-1 py-1 text-center text-white"
                                      />
                                      <span>x</span>
                                      <input
                                        type="number"
                                        value={match.awayScore}
                                        onChange={(event) => updateMatchScore(match.id, match.homeScore, Number(event.target.value), match.homeScore2, match.awayScore2)}
                                        disabled={!canEnterScore}
                                        className="w-10 rounded-md border border-white/10 bg-[#0d1715] px-1 py-1 text-center text-white"
                                      />
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="uppercase tracking-[0.2em] text-slate-400">Volta</p>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="number"
                                        value={match.homeScore2}
                                        onChange={(event) => updateMatchScore(match.id, match.homeScore, match.awayScore, Number(event.target.value), match.awayScore2)}
                                        disabled={!canEnterScore}
                                        className="w-10 rounded-md border border-white/10 bg-[#0d1715] px-1 py-1 text-center text-white"
                                      />
                                      <span>x</span>
                                      <input
                                        type="number"
                                        value={match.awayScore2}
                                        onChange={(event) => updateMatchScore(match.id, match.homeScore, match.awayScore, match.homeScore2, Number(event.target.value))}
                                        disabled={!canEnterScore}
                                        className="w-10 rounded-md border border-white/10 bg-[#0d1715] px-1 py-1 text-center text-white"
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#101b18] p-5 shadow-soft">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-lime-400" />
              <h3 className="text-xl font-semibold text-white">Estatísticas rápidas</h3>
            </div>
            <div className="space-y-2 text-sm text-slate-300">
              <p>Partidas registradas: {selectedTournament.groupMatches.filter((match) => match.status === 'finalizada').length}</p>
              <p>Partidas pendentes: {selectedTournament.groupMatches.filter((match) => match.status === 'pendente').length}</p>
              <p>Campeão da chave: {finalMatch?.status === 'finalizada' && finalMatch.winnerId ? getParticipantName(participants, finalMatch.winnerId) : 'A definir'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    );
  })() : null;

  return (
    <main className="sport-shell min-h-screen text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row">
        <aside className="sport-sidebar w-full rounded-2xl p-4 shadow-soft lg:max-w-72">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4">
            <div className="sport-badge flex h-12 w-12 items-center justify-center rounded-xl text-lime-300">
              <Trophy className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-lime-300">X1 Arena</p>
              <h1 className="text-xl font-semibold text-white">Gestão esportiva</h1>
            </div>
          </div>

          <nav className="mt-5 space-y-2">
            {navigationItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${activeTab === id ? 'bg-lime-500/12 text-lime-200 ring-1 ring-lime-500/30' : 'text-slate-300 hover:bg-white/5'}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>

          <div className="sport-badge mt-6 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-lime-200">
              <WandSparkles className="h-4 w-4" />
              Fluxo base
            </div>
            <p className="mt-2 text-sm text-slate-300">Crie campeonatos, cadastre participantes, gere grupos e acompanhe classificações em tempo real.</p>
          </div>
        </aside>

        <section className="flex-1 rounded-2xl border border-white/10 bg-[#0d1413] p-5 shadow-soft">
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'tournaments' && (
            <div className="space-y-6">
              {selectedTournament ? (
                <>
                  {renderTournamentList()}
                  {tournamentContent}
                </>
              ) : (
                renderTournamentList()
              )}
            </div>
          )}
          {activeTab === 'participants' && renderParticipants()}
          {activeTab === 'settings' && renderSettings()}
        </section>
      </div>
    </main>
  );
}

export default App;
