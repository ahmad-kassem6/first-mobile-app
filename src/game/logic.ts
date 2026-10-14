
export type Player = 'X' | 'O';
export type Cell = Player | null;
export type Scores = { X: number; O: number; draws: number };

export type Outcome =
  | { kind: 'playing' }
  | { kind: 'draw' }
  | { kind: 'win'; winner: Player; line: readonly number[] };

export type Game = {
  board: Cell[];
  turn: Player;
  starter: Player;
  round: number;
  roundId: number;
  scores: Scores;
};

export type Action =
  | { type: 'play'; index: number; expectedTurn: Player; roundId: number }
  | { type: 'next'; roundId: number }
  | { type: 'restart'; roundId: number }
  | { type: 'reset' };

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

function otherPlayer(player: Player): Player {
  return player === 'X' ? 'O' : 'X';
}

export function getOutcome(board: readonly Cell[]): Outcome {
  for (const line of LINES) {
    const [a, b, c] = line;
    const player = board[a];

    if (player != null && player === board[b] && player === board[c]) {
      return { kind: 'win', winner: player, line };
    }
  }

  return board.every((cell) => cell !== null)
    ? { kind: 'draw' }
    : { kind: 'playing' };
}

export function createGame(roundId = 0): Game {
  return {
    board: Array<Cell>(9).fill(null),
    turn: 'X',
    starter: 'X',
    round: 1,
    roundId,
    scores: { X: 0, O: 0, draws: 0 },
  };
}

export function gameReducer(game: Game, action: Action): Game {
  if (action.type === 'reset') {
    return createGame(game.roundId + 1);
  }

  if (action.roundId !== game.roundId) return game;

  const outcome = getOutcome(game.board);

  if (action.type === 'play') {
    if (
      outcome.kind !== 'playing' ||
      action.expectedTurn !== game.turn ||
      !Number.isInteger(action.index) ||
      action.index < 0 ||
      action.index > 8 ||
      game.board[action.index] !== null
    ) {
      return game;
    }

    const board = [...game.board];
    board[action.index] = game.turn;

    const result = getOutcome(board);
    const scores = { ...game.scores };

    if (result.kind === 'win') scores[result.winner] += 1;
    if (result.kind === 'draw') scores.draws += 1;

    return {
      ...game,
      board,
      scores,
      turn: result.kind === 'playing' ? otherPlayer(game.turn) : game.turn,
    };
  }

  if (action.type === 'next') {
    if (outcome.kind === 'playing') return game;

    const starter = otherPlayer(game.starter);

    return {
      ...game,
      board: Array<Cell>(9).fill(null),
      starter,
      turn: starter,
      round: game.round + 1,
      roundId: game.roundId + 1,
    };
  }

  if (outcome.kind !== 'playing' || game.board.every((cell) => cell === null)) {
    return game;
  }

  return {
    ...game,
    board: Array<Cell>(9).fill(null),
    turn: game.starter,
    roundId: game.roundId + 1,
  };
}
