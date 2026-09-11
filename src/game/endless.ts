// ─────────────────────────────────────────────────────────────────────────────
// endless.ts — the fixed-arena "hold the line" director: escalating wave
// tuning (extends past the campaign's Act IV numbers, uncapped HP scaling
// countered by the perk pool), timed waves + intermissions, and the XP/level
// curve. Palette cycling lives in Game (it needs the renderer/scene refs).
// ─────────────────────────────────────────────────────────────────────────────
import type { ZombieTuning } from './zombies';

export const ARENA_LENGTH = 104;

export interface EndlessState {
  wave: number;          // 0-indexed internally, shown as wave+1
  waveT: number;         // seconds left in the current wave
  intermission: number;  // seconds left in the between-wave lull (0 = not in one)
  surgeTimer: number;
  level: number;
  xp: number;
  xpNext: number;
  kills: number;
}

export function newEndlessState(): EndlessState {
  return {
    wave: 0,
    waveT: waveDuration(0),
    intermission: 0,
    surgeTimer: 14,
    level: 1,
    xp: 0,
    xpNext: xpForLevel(1),
  kills: 0,
  };
}

export function waveDuration(wave: number): number {
  return 34 + wave * 1.5;
}

export function endlessTuning(wave: number): ZombieTuning {
  return {
    interval: Math.max(0.28, 1.55 * Math.pow(0.94, wave)),
    maxAlive: Math.min(38, 12 + wave * 1.6),
    runnerP: Math.min(0.55, 0.06 + wave * 0.035),
    exploderP: wave < 3 ? 0 : Math.min(0.26, 0.02 * (wave - 2)),
    speedMul: Math.min(1.85, 1 + wave * 0.035),
    hpMul: 1 + wave * 0.11,
    sideMix: wave < 2 ? 0 : Math.min(0.45, 0.12 + wave * 0.04),
  };
}

export function surgeInterval(wave: number): number {
  return 18 - Math.min(8, wave * 0.5);
}

export function surgeSize(wave: number): number {
  return 3 + Math.floor(wave * 0.8);
}

/** xp required to go from `level` to `level + 1` */
export function xpForLevel(level: number): number {
  return Math.round(60 * Math.pow(level, 1.28) + 40);
}

export const XP_KILL: Record<'walker' | 'runner' | 'exploder', number> = {
  walker: 10, runner: 16, exploder: 22,
};
export const XP_HEADSHOT_MUL = 1.35;
export const XP_CHAIN_MUL = 0.5;
