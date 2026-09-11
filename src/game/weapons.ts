// ─────────────────────────────────────────────────────────────────────────────
// weapons.ts — weapon spec table. state.ts re-exports the Glock numbers as
// aliases so existing call sites keep working; Player/Game read specs from
// here for all four guns.
// ─────────────────────────────────────────────────────────────────────────────

export type WeaponId = 'glock' | 'mp5' | 'shotgun' | 'm4a1';

export const WEAPON_IDS: WeaponId[] = ['glock', 'mp5', 'shotgun', 'm4a1'];

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  short: string;
  mag: number;
  reload: number;
  cooldown: number;
  dmgBody: number;
  dmgHead: number;
  pellets: number;
  spread: number;      // radians, half-angle
  auto: boolean;
  range: number;
  kick: number;        // visual recoil added per shot
  trauma: number;       // camera shake added per shot
  muzzleScale: number;
  tracerW: number;
  tracerColor: number;
  audio: 'pistol' | 'smg' | 'shotgun' | 'rifle';
  guardMs: number;      // audio voice-guard interval for this weapon
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  glock: {
    id: 'glock', name: 'GLOCK 19', short: 'G19',
    mag: 15, reload: 1.05, cooldown: 0.135,
    dmgBody: 30, dmgHead: 70,
    pellets: 1, spread: 0.012, auto: true, range: 34,
    kick: 0.55, trauma: 0.07,
    muzzleScale: 1, tracerW: 0.016, tracerColor: 0xffe8b0,
    audio: 'pistol', guardMs: 45,
  },
  mp5: {
    id: 'mp5', name: 'MP5', short: 'MP5',
    mag: 30, reload: 1.5, cooldown: 0.075,
    dmgBody: 20, dmgHead: 46,
    pellets: 1, spread: 0.03, auto: true, range: 28,
    kick: 0.34, trauma: 0.045,
    muzzleScale: 0.9, tracerW: 0.014, tracerColor: 0xffe8b0,
    audio: 'smg', guardMs: 28,
  },
  shotgun: {
    id: 'shotgun', name: 'SHOTGUN', short: 'SHGN',
    mag: 7, reload: 2.1, cooldown: 0.62,
    dmgBody: 15, dmgHead: 30,
    pellets: 8, spread: 0.105, auto: false, range: 17,
    kick: 1.0, trauma: 0.24,
    muzzleScale: 1.5, tracerW: 0.02, tracerColor: 0xffcf8a,
    audio: 'shotgun', guardMs: 120,
  },
  m4a1: {
    id: 'm4a1', name: 'M4A1', short: 'M4',
    mag: 45, reload: 1.85, cooldown: 0.1,
    dmgBody: 34, dmgHead: 78,
    pellets: 1, spread: 0.018, auto: true, range: 40,
    kick: 0.5, trauma: 0.09,
    muzzleScale: 1.15, tracerW: 0.018, tracerColor: 0xffe8b0,
    audio: 'rifle', guardMs: 40,
  },
};
