// ─────────────────────────────────────────────────────────────────────────────
// state.ts — shared types, act palettes & global tuning constants
// ─────────────────────────────────────────────────────────────────────────────

export type Phase =
  | 'menu'        // start screen
  | 'actbanner'   // short interstitial when a new act begins
  | 'playing'     // gameplay
  | 'stageclear'  // reached the safe house
  | 'gameover'    // died
  | 'victory'     // campaign complete
  | 'paused';     // paused overlay

export interface ActPalette {
  name: string;          // display name
  subtitle: string;
  skyTop: string;
  skyHorizon: string;
  fogColor: string;
  fogDensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  moonColor: string;
  moonIntensity: number;
  lampColor: string;     // streetlight warm tone
  signColors: string[];  // neon palette for signs
  accent: string;        // css accent
  exposure: number;
  bloom: number;
  skyline: string;       // distant silhouette colour
}

export const ACTS: ActPalette[] = [
  {
    name: 'ACT I',
    subtitle: 'ASHEN CITY',
    skyTop: '#05070c', skyHorizon: '#171d28',
    fogColor: '#0b0f16', fogDensity: 0.020,
    hemiSky: '#39445c', hemiGround: '#07080a', hemiIntensity: 0.5,
    moonColor: '#aebted', moonIntensity: 2.4,
    lampColor: '#ffb45e',
    signColors: ['#ff3040', '#37e0e8', '#ffa03a', '#b06bff'],
    accent: '#7fb4ff',
    exposure: 1.12, bloom: 0.75,
    skyline: '#04060a',
  },
  {
    name: 'ACT II',
    subtitle: 'EMBER DISTRICT',
    skyTop: '#0a0606', skyHorizon: '#24100a',
    fogColor: '#140c08', fogDensity: 0.022,
    hemiSky: '#5c4030', hemiGround: '#0a0605', hemiIntensity: 0.45,
    moonColor: '#ffb98a', moonIntensity: 2.1,
    lampColor: '#ff9c46',
    signColors: ['#ff5130', '#ffb03a', '#ff3040', '#ffd23a'],
    accent: '#ff7a2e',
    exposure: 1.1, bloom: 0.85,
    skyline: '#070403',
  },
  {
    name: 'ACT III',
    subtitle: 'TOXIC HOLLOW',
    skyTop: '#040806', skyHorizon: '#0f2113',
    fogColor: '#0a140c', fogDensity: 0.024,
    hemiSky: '#3a5c40', hemiGround: '#050a06', hemiIntensity: 0.45,
    moonColor: '#a8e8b0', moonIntensity: 2.0,
    lampColor: '#d8ff9a',
    signColors: ['#8dff5a', '#37e0a8', '#d8ff3a', '#ff3040'],
    accent: '#8dff6a',
    exposure: 1.08, bloom: 0.8,
    skyline: '#030704',
  },
  {
    name: 'ACT IV',
    subtitle: 'BLOOD MOON',
    skyTop: '#090408', skyHorizon: '#26090f',
    fogColor: '#160a0d', fogDensity: 0.02,
    hemiSky: '#5c2f3c', hemiGround: '#0a0507', hemiIntensity: 0.45,
    moonColor: '#ff6a70', moonIntensity: 2.5,
    lampColor: '#ff8a5e',
    signColors: ['#ff3040', '#ff5a70', '#ffa03a', '#b05aff'],
    accent: '#ff3355',
    exposure: 1.15, bloom: 0.9,
    skyline: '#060308',
  },
];

// ── weapon ───────────────────────────────────────────────────────────────────
export const MAG_SIZE = 15;            // Glock 19 magazine
export const RELOAD_TIME = 1.05;       // seconds
export const FIRE_COOLDOWN = 0.135;    // semi-auto rate cap
export const DMG_BODY = 30;
export const DMG_HEAD = 70;
export const MAX_RANGE = 34;

// ── player ───────────────────────────────────────────────────────────────────
export const PLAYER_HP = 100;
export const RUN_SPEED = 4.9;
export const SPRINT_SPEED = 6.6;
export const JUMP_VEL = 7.6;
export const GRAVITY = -21;

// ── zombies ─────────────────────────────────────────────────────────────────
export const Z_WALKER = { hp: 90, speed: 1.05, dmg: 12, radius: 0.5 };
export const Z_RUNNER = { hp: 60, speed: 3.5, dmg: 9, radius: 0.45 };
export const Z_EXPLODER = { hp: 45, speed: 1.35, dmg: 34, radius: 0.55, blast: 2.6 };

// stage length per (act, stage): world units
export function stageLength(act: number, stage: number): number {
  return 190 + act * 22 + stage * 12;
}

export interface HudState {
  phase: Phase;
  hp: number;
  maxHp: number;
  ammo: number;
  magSize: number;
  reloading: boolean;
  act: number;          // 1..4
  stage: number;        // 1..4
  actName: string;
  actSubtitle: string;
  kills: number;
  timeSec: number;
  progress: number;     // 0..1 towards safe house
  distLeft: number;     // metres remaining
  safeNear: boolean;    // safe house lit when in sight
  safeReached: boolean;
  surge: boolean;       // horde surge banner
  muted: boolean;
  hurtTick: number;     // increments every time the player is hit (for css flash)
  finalKills: number;
  finalTime: number;
}

export const initialHud: HudState = {
  phase: 'menu',
  hp: PLAYER_HP,
  maxHp: PLAYER_HP,
  ammo: MAG_SIZE,
  magSize: MAG_SIZE,
  reloading: false,
  act: 1, stage: 1,
  actName: ACTS[0].name,
  actSubtitle: ACTS[0].subtitle,
  kills: 0, timeSec: 0,
  progress: 0, distLeft: 0,
  safeNear: false, safeReached: false,
  surge: false,
  muted: false,
  hurtTick: 0,
  finalKills: 0, finalTime: 0,
};
