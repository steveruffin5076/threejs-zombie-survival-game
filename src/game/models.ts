// ─────────────────────────────────────────────────────────────────────────────
// models.ts — procedural character rigs built from primitives with PBR
// materials (they read as "real" under the moody lighting + fog + shadows):
//   • buildPlayer  — survivor figure with two-hand Glock 19 aim rig
//   • buildZombie  — walker / runner / exploder variants
//   • buildSilhouette — cheap background walkers for depth
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { bloodSpriteTexture } from './textures';
import { WEAPON_IDS, type WeaponId } from './weapons';

const box = (w: number, h: number, d: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

function std(color: number, rough = 0.85, metal = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

// shared material palettes
const M = {
  jeans: std(0x23262c),
  boots: std(0x191714, 0.7),
  jacket: std(0x33373f),
  jacketDark: std(0x272b32),
  skin: std(0xb08a6e, 0.65),
  hair: std(0x17130f, 0.95),
  pack: std(0x3a3f33, 0.95),
  gunMetal: std(0x15171b, 0.32, 0.78),
  gunPoly: std(0x1e2126, 0.6, 0.2),
  blood: new THREE.MeshBasicMaterial({ map: bloodSpriteTexture(), color: 0x6a0d12, transparent: true, depthWrite: false }),
  eye: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
};
const Z_SKIN = [0x76826b, 0x7e8a72, 0x6a7a66, 0x84907a, 0x707d70].map(c => std(c, 0.9));
const Z_SHIRT = [0x2f3540, 0x40323a, 0x37402f, 0x3a3a34, 0x322e3c, 0x453a2e].map(c => std(c, 0.95));
const Z_PANTS = [0x22252c, 0x2a2526, 0x242a26].map(c => std(c, 0.95));

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Glock 19 (blocks, but correctly proportioned) ────────────────────────────
export interface GunRig { group: THREE.Group; muzzle: THREE.Object3D; eject: THREE.Object3D }
function buildGlock(): GunRig {
  const g = new THREE.Group();
  const slide = box(0.24, 0.05, 0.042, M.gunMetal); slide.position.set(0.02, 0.032, 0);
  const frame = box(0.2, 0.034, 0.04, M.gunPoly); frame.position.set(0, -0.006, 0);
  const grip = box(0.05, 0.125, 0.04, M.gunPoly); grip.position.set(-0.05, -0.082, 0); grip.rotation.z = 0.28;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.02, 8), M.gunMetal);
  barrel.rotation.z = Math.PI / 2; barrel.position.set(0.145, 0.032, 0);
  const sight = box(0.012, 0.014, 0.01, M.gunMetal); sight.position.set(0.12, 0.064, 0);
  const guard = box(0.07, 0.012, 0.042, M.gunPoly); guard.position.set(0.035, -0.035, 0);
  g.add(slide, frame, grip, barrel, sight, guard);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.17, 0.032, 0);
  const eject = new THREE.Object3D(); eject.position.set(-0.02, 0.055, 0.03);
  g.add(muzzle, eject);
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { group: g, muzzle, eject };
}

// ── MP5 (fast full-auto SMG) ──────────────────────────────────────────────────
function buildMP5(): GunRig {
  const g = new THREE.Group();
  const receiver = box(0.3, 0.075, 0.05, M.gunMetal); receiver.position.set(0.02, 0.03, 0);
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8), M.gunMetal);
  shroud.rotation.z = Math.PI / 2; shroud.position.set(0.21, 0.03, 0);
  const grip = box(0.05, 0.13, 0.045, M.gunPoly); grip.position.set(-0.06, -0.075, 0); grip.rotation.z = 0.22;
  const mag = box(0.045, 0.16, 0.04, M.gunPoly); mag.position.set(0.02, -0.09, 0); mag.rotation.z = 0.12;
  const stock = box(0.14, 0.05, 0.04, M.gunMetal); stock.position.set(-0.17, 0.02, 0);
  const foregrip = box(0.05, 0.09, 0.045, M.gunPoly); foregrip.position.set(0.17, -0.04, 0);
  g.add(receiver, shroud, grip, mag, stock, foregrip);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.3, 0.03, 0);
  const eject = new THREE.Object3D(); eject.position.set(0.06, 0.06, 0.035);
  g.add(muzzle, eject);
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { group: g, muzzle, eject };
}

// ── Shotgun (pump, 7-shell tube) ───────────────────────────────────────────────
function buildShotgun(): GunRig {
  const g = new THREE.Group();
  const receiver = box(0.26, 0.08, 0.055, M.gunMetal); receiver.position.set(0, 0.03, 0);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 8), M.gunMetal);
  barrel.rotation.z = Math.PI / 2; barrel.position.set(0.36, 0.04, 0);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.38, 8), M.gunPoly);
  tube.rotation.z = Math.PI / 2; tube.position.set(0.34, -0.005, 0);
  const pump = box(0.12, 0.055, 0.055, M.gunPoly); pump.position.set(0.26, -0.005, 0);
  const wrist = box(0.06, 0.11, 0.05, M.gunPoly); wrist.position.set(-0.08, -0.06, 0); wrist.rotation.z = 0.3;
  const stock = box(0.24, 0.09, 0.05, M.gunPoly); stock.position.set(-0.24, -0.01, 0); stock.rotation.z = -0.06;
  g.add(receiver, barrel, tube, pump, wrist, stock);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.58, 0.04, 0);
  const eject = new THREE.Object3D(); eject.position.set(0.02, 0.05, 0.035);
  g.add(muzzle, eject);
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { group: g, muzzle, eject };
}

// ── M4A1 (full-auto rifle) ─────────────────────────────────────────────────────
function buildM4A1(): GunRig {
  const g = new THREE.Group();
  const upper = box(0.36, 0.06, 0.05, M.gunMetal); upper.position.set(0.06, 0.045, 0);
  const handguard = box(0.2, 0.055, 0.05, M.gunPoly); handguard.position.set(0.3, 0.04, 0);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.14, 8), M.gunMetal);
  barrel.rotation.z = Math.PI / 2; barrel.position.set(0.46, 0.04, 0);
  const optic = box(0.1, 0.035, 0.03, M.gunMetal); optic.position.set(0.06, 0.085, 0);
  const mag = box(0.05, 0.17, 0.04, M.gunPoly); mag.position.set(-0.01, -0.09, 0); mag.rotation.z = 0.1;
  const grip = box(0.05, 0.12, 0.045, M.gunPoly); grip.position.set(-0.09, -0.07, 0); grip.rotation.z = 0.28;
  const stock = box(0.22, 0.07, 0.045, M.gunMetal); stock.position.set(-0.22, 0.02, 0);
  g.add(upper, handguard, barrel, optic, mag, grip, stock);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.54, 0.04, 0);
  const eject = new THREE.Object3D(); eject.position.set(0.14, 0.065, 0.035);
  g.add(muzzle, eject);
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { group: g, muzzle, eject };
}

const HAND_L_POS: Record<WeaponId, [number, number, number]> = {
  glock: [0.36, -0.03, -0.04],
  mp5: [0.55, -0.05, -0.03],
  shotgun: [0.64, -0.03, -0.03],
  m4a1: [0.68, -0.02, -0.03],
};
const ARM_L_SCALE: Record<WeaponId, number> = { glock: 1.0, mp5: 1.35, shotgun: 1.5, m4a1: 1.55 };

/** switches the visible gun mesh + repositions the support hand/arm for its length */
export function setWeaponVisual(rig: PlayerRig, id: WeaponId) {
  for (const k of WEAPON_IDS) rig.guns[k].group.visible = k === id;
  rig.gun = rig.guns[id];
  rig.handL.position.set(...HAND_L_POS[id]);
  rig.armL.scale.x = ARM_L_SCALE[id];
}

// ── Survivor ─────────────────────────────────────────────────────────────────
export interface PlayerRig {
  group: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  torso: THREE.Group; head: THREE.Group;
  aim: THREE.Group;        // rotate.z = aim pitch (built facing +x)
  handL: THREE.Mesh; armL: THREE.Mesh;
  guns: Record<WeaponId, GunRig>;
  gun: GunRig;              // active gun, repointed by setWeaponVisual
}
export function buildPlayer(): PlayerRig {
  const group = new THREE.Group();

  const mkLeg = (z: number) => {
    const hip = new THREE.Group(); hip.position.set(0, 0.92, z);
    const thigh = box(0.17, 0.5, 0.18, M.jeans); thigh.position.y = -0.25;
    const shin = box(0.15, 0.42, 0.16, M.jeans); shin.position.y = -0.66;
    const boot = box(0.26, 0.1, 0.18, M.boots); boot.position.set(0.05, -0.9, 0);
    hip.add(thigh, shin, boot);
    return hip;
  };
  const legL = mkLeg(-0.09), legR = mkLeg(0.09);

  const torso = new THREE.Group(); torso.position.y = 0.92;
  const chest = box(0.42, 0.58, 0.3, M.jacket); chest.position.y = 0.31;
  const collar = box(0.3, 0.1, 0.26, M.jacketDark); collar.position.y = 0.62;
  const pack = box(0.16, 0.4, 0.26, M.pack); pack.position.set(-0.26, 0.32, 0);
  const strap = box(0.46, 0.08, 0.32, M.jacketDark); strap.position.y = 0.36; strap.rotation.z = 0.5;
  torso.add(chest, collar, pack, strap);

  const head = new THREE.Group(); head.position.y = 1.66;
  const skull = box(0.24, 0.26, 0.24, M.skin);
  const capTop = box(0.26, 0.07, 0.26, M.hair); capTop.position.y = 0.15;
  const brim = box(0.12, 0.03, 0.24, M.hair); brim.position.set(0.16, 0.12, 0);
  const beard = box(0.06, 0.1, 0.2, M.hair); beard.position.set(0.11, -0.08, 0);
  head.add(skull, capTop, brim, beard);

  // aim rig — both arms + the active gun rotate as one around the shoulder pivot
  const aim = new THREE.Group(); aim.position.set(0.04, 1.4, 0);
  const armR = box(0.36, 0.11, 0.12, M.jacket); armR.position.set(0.18, -0.02, 0.16);
  const handR = box(0.09, 0.1, 0.1, M.skin); handR.position.set(0.38, -0.02, 0.16);
  const armL = box(0.34, 0.11, 0.12, M.jacket); armL.position.set(0.17, -0.06, -0.15); armL.rotation.y = 0.16;
  const handL = box(0.09, 0.1, 0.1, M.skin); handL.position.set(0.36, -0.03, -0.04);

  // all four guns are built up front (models.ts never disposes geometry) and toggled by
  // .visible so switching weapons at runtime is allocation-free
  const guns: Record<WeaponId, GunRig> = {
    glock: buildGlock(),
    mp5: buildMP5(),
    shotgun: buildShotgun(),
    m4a1: buildM4A1(),
  };
  guns.glock.group.position.set(0.42, 0.03, 0.03);
  guns.mp5.group.position.set(0.38, 0.01, 0.03);
  guns.shotgun.group.position.set(0.38, 0.01, 0.03);
  guns.m4a1.group.position.set(0.38, 0.01, 0.03);
  for (const id of WEAPON_IDS) guns[id].group.visible = id === 'glock';

  aim.add(armR, handR, armL, handL, guns.glock.group, guns.mp5.group, guns.shotgun.group, guns.m4a1.group);

  group.add(legL, legR, torso, head, aim);
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return { group, legL, legR, torso, head, aim, handL, armL, guns, gun: guns.glock };
}

// ── Zombies ─────────────────────────────────────────────────────────────────
export type ZombieType = 'walker' | 'runner' | 'exploder';
export interface ZombieRig {
  group: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  armL: THREE.Group; armR: THREE.Group;
  torso: THREE.Group; head: THREE.Group;
  glowMats: THREE.MeshBasicMaterial[]; // exploder pustules + eyes pulse targets
}
export function buildZombie(type: ZombieType): ZombieRig {
  const group = new THREE.Group();
  const skin = pick(Z_SKIN), shirt = pick(Z_SHIRT), pants = pick(Z_PANTS);
  const glowMats: THREE.MeshBasicMaterial[] = [];

  const mkLeg = (z: number) => {
    const hip = new THREE.Group(); hip.position.set(0, 0.9, z);
    const leg = box(0.16, 0.56, 0.17, pants); leg.position.y = -0.28;
    const shin = box(0.14, 0.36, 0.15, pants); shin.position.y = -0.72;
    const foot = box(0.22, 0.08, 0.15, M.boots); foot.position.set(0.05, -0.88, 0);
    hip.add(leg, shin, foot);
    return hip;
  };
  const legL = mkLeg(-0.1), legR = mkLeg(0.1);

  const torso = new THREE.Group(); torso.position.y = 0.9;
  const chest = box(0.44, 0.6, 0.32, shirt); chest.position.y = 0.3;
  torso.add(chest);

  // gore decals
  if (Math.random() > 0.35) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), M.blood);
    d.position.set(0.05 + Math.random() * 0.1, 0.28 + Math.random() * 0.2, 0.17);
    d.rotation.z = Math.random() * Math.PI * 2;
    torso.add(d);
  }
  if (type === 'exploder') { // bloated, glowing pustules
    chest.scale.set(1.42, 1.12, 1.35);
    for (let i = 0; i < 4; i++) {
      const pm = new THREE.MeshBasicMaterial({ color: 0xff6a1a });
      const p = box(0.1, 0.1, 0.06, pm);
      p.position.set((Math.random() - 0.3) * 0.4, 0.1 + Math.random() * 0.4, 0.24);
      chest.add(p);
      glowMats.push(pm);
    }
    const throat = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
    chest.add(box(0.2, 0.08, 0.36, throat));
    glowMats.push(throat);
  }

  const head = new THREE.Group(); head.position.y = 1.58;
  const skull = box(0.25, 0.25, 0.25, skin);
  const jaw = box(0.1, 0.08, 0.2, skin); jaw.position.set(0.1, -0.14, 0);
  head.add(skull, jaw);
  for (const ez of [-0.06, 0.06]) { // glowing eyes on the +x face
    const em = new THREE.MeshBasicMaterial({ color: type === 'runner' ? 0xff7a00 : 0xff2418 });
    const eye = box(0.03, 0.04, 0.05, em);
    eye.position.set(0.125, 0.04, ez);
    head.add(eye);
    glowMats.push(em);
  }
  if (Math.random() > 0.5) {
    const hd = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), M.blood);
    hd.position.set(0.13, 0.02, 0.02); hd.rotation.y = Math.PI / 2; hd.rotation.z = Math.random() * 3;
    head.add(hd);
  }

  // arms reaching forward (classic lurch)
  const mkArm = (z: number, reach: number) => {
    const sh = new THREE.Group(); sh.position.set(0.04, 0.5, z);
    const a = box(0.13, 0.5, 0.12, shirt); a.position.y = -0.25;
    const hand = box(0.12, 0.14, 0.1, skin); hand.position.y = -0.55;
    sh.add(a, hand);
    sh.rotation.z = -reach; // raise towards horizontal
    return sh;
  };
  const armL = mkArm(-0.22, type === 'runner' ? 0.9 : 1.3 + Math.random() * 0.25);
  const armR = mkArm(0.22, type === 'runner' ? 1.1 : 1.35 + Math.random() * 0.2);
  torso.add(armL, armR);

  group.add(legL, legR, torso, head);
  if (type === 'runner') { torso.rotation.z = -0.35; head.position.y = 1.5; group.scale.setScalar(0.96); }
  if (type === 'exploder') { group.scale.setScalar(1.08); head.position.y = 1.62; }
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
  return { group, legL, legR, armL, armR, torso, head, glowMats };
}

// ── cheap distant silhouettes for environmental depth ────────────────────────
export function buildSilhouette(): { group: THREE.Group; legL: THREE.Group; legR: THREE.Group } {
  const mat = new THREE.MeshBasicMaterial({ color: 0x030507 });
  const group = new THREE.Group();
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(0, 0.85, -0.05); legR.position.set(0, 0.85, 0.05);
  const l1 = box(0.13, 0.85, 0.12, mat); l1.position.y = -0.42;
  const l2 = box(0.13, 0.85, 0.12, mat); l2.position.y = -0.42;
  legL.add(l1); legR.add(l2);
  const body = box(0.34, 0.62, 0.24, mat); body.position.y = 1.16;
  body.rotation.z = -0.18;
  const head = box(0.2, 0.2, 0.2, mat); head.position.set(0.1, 1.6, 0);
  group.add(legL, legR, body, head);
  return { group, legL, legR };
}
