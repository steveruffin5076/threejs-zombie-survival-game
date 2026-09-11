// ─────────────────────────────────────────────────────────────────────────────
// cards.ts — level-up card pool for endless mode: the three new weapons first,
// then an infinite stat-perk pool once the arsenal is complete.
// ─────────────────────────────────────────────────────────────────────────────
import { WEAPON_IDS, WEAPONS, type WeaponId } from './weapons';
import type { Player } from './player';
import type { HudCard } from './state';

export type PerkId = 'dmg' | 'hp' | 'reload' | 'mag' | 'speed' | 'rate';

interface PerkDef {
  id: PerkId;
  title: string;
  sub: string;
  capped?: (mods: Player['mods']) => boolean;
  apply: (p: Player) => void;
  stat: (p: Player) => string;
}

const PERKS: PerkDef[] = [
  {
    id: 'dmg', title: 'HOLLOW POINTS', sub: 'Increase weapon damage',
    apply: p => { p.mods.dmgMul += 0.12; },
    stat: p => `+12% DMG (now ${Math.round(p.mods.dmgMul * 100)}%)`,
  },
  {
    id: 'hp', title: 'FIELD MEDKIT', sub: 'Increase max health and heal',
    apply: p => { p.mods.hpBonus += 20; p.heal(20); },
    stat: p => `+20 MAX HP (now ${p.maxHp()})`,
  },
  {
    id: 'reload', title: 'QUICK HANDS', sub: 'Faster reloads',
    capped: mods => mods.reloadMul <= 0.45,
    apply: p => { p.mods.reloadMul = Math.max(0.45, p.mods.reloadMul * 0.88); },
    stat: p => `RELOAD ×${p.mods.reloadMul.toFixed(2)}`,
  },
  {
    id: 'mag', title: 'EXTENDED MAGS', sub: 'Bigger magazines',
    capped: mods => mods.magMul >= 2.0,
    apply: p => {
      p.mods.magMul = Math.min(2.0, p.mods.magMul + 0.2);
      for (const id of WEAPON_IDS) {
        if (p.slots.includes(id)) p.mags[id] = Math.round(WEAPONS[id].mag * p.mods.magMul);
      }
    },
    stat: p => `MAG SIZE ×${p.mods.magMul.toFixed(2)}`,
  },
  {
    id: 'speed', title: 'ADRENALINE', sub: 'Move and sprint faster',
    capped: mods => mods.speedMul >= 1.45,
    apply: p => { p.mods.speedMul = Math.min(1.45, p.mods.speedMul + 0.06); },
    stat: p => `SPEED ×${p.mods.speedMul.toFixed(2)}`,
  },
  {
    id: 'rate', title: 'STEADY GRIP', sub: 'Faster fire rate',
    capped: mods => mods.rateMul >= 1.9,
    apply: p => { p.mods.rateMul = Math.min(1.9, p.mods.rateMul + 0.08); },
    stat: p => `RATE ×${p.mods.rateMul.toFixed(2)}`,
  },
];

export interface Card {
  kind: 'weapon' | 'perk';
  id: string;
  title: string;
  sub: string;
  stat: string;
  apply: (p: Player) => void;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** weapons the player doesn't have yet come first (shuffled); once the arsenal is
 * complete, cards are drawn from the perk pool (capped perks excluded once maxed). */
export function rollCards(player: Player): Card[] {
  const missing: WeaponId[] = WEAPON_IDS.filter(id => !player.slots.includes(id));
  const weaponCards: Card[] = shuffle(missing).map(id => ({
    kind: 'weapon', id,
    title: WEAPONS[id].name, sub: 'Add to arsenal',
    stat: `${WEAPONS[id].mag} RD MAG`,
    apply: p => p.giveWeapon(id),
  }));
  if (weaponCards.length >= 3) return weaponCards.slice(0, 3);

  const available = PERKS.filter(pk => !pk.capped || !pk.capped(player.mods));
  const perkCards: Card[] = shuffle(available).map(pk => ({
    kind: 'perk', id: pk.id,
    title: pk.title, sub: pk.sub,
    stat: pk.stat(player),
    apply: pk.apply,
  }));
  const need = 3 - weaponCards.length;
  return [...weaponCards, ...perkCards.slice(0, need)];
}

export function toHudCards(cards: Card[]): HudCard[] {
  return cards.map(c => ({ id: c.id, kind: c.kind, title: c.title, sub: c.sub, stat: c.stat }));
}
