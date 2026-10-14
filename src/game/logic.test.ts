
import { describe, expect, it } from 'vitest';
import { createGame, gameReducer, getOutcome } from './logic';
import type { Game } from './logic';

function play(game: Game, index: number): Game {
  return gameReducer(game, {
    type: 'play',
    index,
    expectedTurn: game.turn,
    roundId: game.roundId,
  });
}

function sequence(...positions: number[]): Game {
  return positions.reduce(play, createGame());
}

describe('XO Game Logic', () => {
  it('initializes an empty game', () => {
    const game = createGame();

    expect(game.board).toEqual(Array(9).fill(null));
    expect(game.turn).toBe('X');
    expect(game.round).toBe(1);
    expect(game.scores).toEqual({ X: 0, O: 0, draws: 0 });
  });

  it('alternates players after valid moves', () => {
    const first = play(createGame(), 0);
    const second = play(first, 1);

    expect(first.turn).toBe('O');
    expect(second.turn).toBe('X');
  });

  it('detects an X victory and increments the score', () => {
    const game = sequence(0, 3, 1, 4, 2);

    expect(getOutcome(game.board)).toEqual({
      kind: 'win',
      winner: 'X',
      line: [0, 1, 2],
    });
    expect(game.scores.X).toBe(1);
  });

  it('detects an O victory and increments the score', () => {
    const game = sequence(0, 3, 1, 4, 8, 5);

    expect(getOutcome(game.board)).toMatchObject({
      kind: 'win',
      winner: 'O',
    });
    expect(game.scores.O).toBe(1);
  });

  it('detects a draw without awarding a victory', () => {
    const game = sequence(0, 1, 2, 4, 3, 5, 7, 6, 8);

    expect(getOutcome(game.board)).toEqual({ kind: 'draw' });
    expect(game.scores).toEqual({ X: 0, O: 0, draws: 1 });
  });

  it('rejects moves on occupied cells', () => {
    const game = play(createGame(), 0);

    expect(play(game, 0)).toBe(game);
  });

  it('rejects moves after a game finishes', () => {
    const game = sequence(0, 3, 1, 4, 2);

    expect(play(game, 5)).toBe(game);
    expect(game.scores.X).toBe(1);
  });

  it('rejects invalid cell indices', () => {
    const game = createGame();

    for (const index of [-1, 9, 1.5, NaN]) {
      expect(play(game, index)).toBe(game);
    }
  });

  it('rejects actions with an incorrect turn', () => {
    const game = play(createGame(), 0);

    const result = gameReducer(game, {
      type: 'play',
      index: 1,
      expectedTurn: 'X',
      roundId: game.roundId,
    });

    expect(result).toBe(game);
  });

  it('only starts the next round after completion', () => {
    const game = play(createGame(), 0);

    expect(
      gameReducer(game, { type: 'next', roundId: game.roundId }),
    ).toBe(game);
  });

  it('alternates the starting player in the next round', () => {
    const finished = sequence(0, 3, 1, 4, 2);

    const next = gameReducer(finished, {
      type: 'next',
      roundId: finished.roundId,
    });

    expect(next.round).toBe(2);
    expect(next.starter).toBe('O');
    expect(next.turn).toBe('O');
    expect(next.board.every((cell) => cell === null)).toBe(true);
    expect(next.scores.X).toBe(1);
  });

  it('restarts a round without clearing scores', () => {
    const finished = sequence(0, 3, 1, 4, 2);

    const next = gameReducer(finished, {
      type: 'next',
      roundId: finished.roundId,
    });

    const inProgress = play(next, 0);

    const restarted = gameReducer(inProgress, {
      type: 'restart',
      roundId: inProgress.roundId,
    });

    expect(restarted.board).toEqual(Array(9).fill(null));
    expect(restarted.scores.X).toBe(1);
    expect(restarted.round).toBe(2);
    expect(restarted.turn).toBe('O');
  });

  it('rejects actions from previous rounds', () => {
    const finished = sequence(0, 3, 1, 4, 2);

    const next = gameReducer(finished, {
      type: 'next',
      roundId: finished.roundId,
    });

    const result = gameReducer(next, {
      type: 'play',
      index: 0,
      expectedTurn: 'O',
      roundId: finished.roundId,
    });

    expect(result).toBe(next);
  });

  it('resets the entire match and scores', () => {
    const game = sequence(0, 3, 1, 4, 2);
    const reset = gameReducer(game, { type: 'reset' });

    expect(reset.board).toEqual(Array(9).fill(null));
    expect(reset.scores).toEqual({ X: 0, O: 0, draws: 0 });
    expect(reset.turn).toBe('X');
    expect(reset.round).toBe(1);
    expect(reset.roundId).toBeGreaterThan(game.roundId);
  });
});
