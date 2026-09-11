// ─────────────────────────────────────────────────────────────────────────────
// App.tsx — React shell: mounts the Three.js game canvas, renders the HUD
// (ammo / health / act+stage / progress / safe-house chip / kills) and all
// phase overlays: start menu, act banners, stage-clear, pause, death, victory.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import {
  Heart, Skull, Volume2, VolumeX, Pause, Play, RotateCcw,
  Flag, Home, ChevronRight, Radiation, Crosshair as CrosshairIcon,
  Zap, Target, Flame, Package, Wind, Gauge, Swords,
} from 'lucide-react';
import { Game } from './game/game';
import { ACTS, HudState, initialHud, type HudCard } from './game/state';

function fmtTime(s: number) {
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const crossRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<HudState>(initialHud);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || gameRef.current) return;
    const game = new Game(canvas);
    game.onHudState(setHud);
    gameRef.current = game;
    const onMove = (e: MouseEvent) => {
      if (crossRef.current) crossRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const pal = ACTS[hud.act - 1];
  const playing = hud.phase === 'playing';
  const inGame = hud.phase !== 'menu';
  const endless = hud.mode === 'endless';

  const WEAPON_ICON: Record<string, typeof Zap> = { mp5: Zap, shotgun: Target, m4a1: Swords };
  const PERK_ICON: Record<string, typeof Flame> = { dmg: Flame, hp: Heart, reload: Wind, mag: Package, speed: Gauge, rate: Zap };
  function cardIcon(c: HudCard) {
    const Icon = c.kind === 'weapon' ? (WEAPON_ICON[c.id] ?? CrosshairIcon) : (PERK_ICON[c.id] ?? Target);
    return <Icon size={26} color={c.kind === 'weapon' ? '#ff8089' : '#b06bff'} />;
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-black select-none" style={{ cursor: 'none' }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {/* film overlays (scanlines + dust speckle) */}
      <div className="scanlines" />
      <div className="noise-overlay" />

      {/* custom crosshair */}
      <div ref={crossRef} className="fixed left-0 top-0 z-50 pointer-events-none crosshair">
        <CrosshairIcon size={30} strokeWidth={1.4} color="#e8e4da" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[3px] h-[3px] rounded-full bg-red-500" />
      </div>

      {/* ── HUD ─────────────────────────────────────────────────────────── */}
      {inGame && (
        <>
          {/* top-left: act/stage + progress to safe house (campaign) or wave + timer (endless) */}
          <div className="absolute top-5 left-6 z-40 flex flex-col gap-2.5 pointer-events-none">
            {endless ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="hud-font text-xs tracking-[0.3em] px-2 py-1 border" style={{ borderColor: pal.accent + '66', color: pal.accent }}>
                    WAVE {hud.wave}
                  </span>
                  {hud.intermission && (
                    <span className="hud-font text-xs tracking-[0.25em] text-emerald-400 border border-emerald-700/60 px-2 py-1 blink">
                      NEXT WAVE INBOUND
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 w-[300px]">
                  <span className="hud-font text-[10px] text-neutral-500 tracking-widest w-10">{hud.waveTimeLeft}s</span>
                  <div className="relative flex-1 h-[5px] bg-neutral-800/80 border border-neutral-700/60">
                    <div className="absolute inset-y-0 right-0 transition-all duration-300"
                      style={{ width: `${hud.intermission ? 100 : Math.min(100, (hud.waveTimeLeft / (34 + hud.wave * 1.5)) * 100)}%`, background: `linear-gradient(90deg, ${pal.accent}, #5a1216)` }} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="hud-font text-xs tracking-[0.3em] px-2 py-1 border" style={{ borderColor: pal.accent + '66', color: pal.accent }}>
                    {hud.actName}&thinsp;/&thinsp;IV
                  </span>
                  <span className="font-type text-lg text-neutral-200 tracking-widest">{hud.actSubtitle}</span>
                  <span className="hud-font text-xs tracking-[0.25em] text-neutral-400 border border-neutral-700 px-2 py-1">
                    STAGE {hud.stage}/4
                  </span>
                </div>
                {/* progress rail */}
                <div className="flex items-center gap-2 w-[300px]">
                  <span className="hud-font text-[10px] text-neutral-500 tracking-widest w-10">{hud.distLeft}m</span>
                  <div className="relative flex-1 h-[5px] bg-neutral-800/80 border border-neutral-700/60">
                    <div className="absolute inset-y-0 left-0 transition-all duration-300"
                      style={{ width: `${hud.progress * 100}%`, background: `linear-gradient(90deg, #5a1216, ${pal.accent})` }} />
                    <Flag size={13} className="absolute -right-1 -top-[7px]"
                      color={hud.safeNear ? '#51ff7a' : '#6b6b6b'}
                      style={hud.safeNear ? { filter: 'drop-shadow(0 0 6px #51ff7a)' } : undefined} />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* top-right: kills + clock + controls */}
          <div className="absolute top-5 right-6 z-40 flex items-center gap-2.5">
            <div className="chip">
              <Skull size={14} color="#ff4152" />
              <span className="hud-font text-sm text-neutral-200 w-8 text-right">{hud.kills}</span>
            </div>
            <div className="chip hud-font text-sm text-neutral-300">{fmtTime(hud.timeSec)}</div>
            <button className="chip chip-btn" onClick={() => gameRef.current?.toggleMute()} title="Mute (M)">
              {hud.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            {(playing || hud.phase === 'paused') && (
              <button className="chip chip-btn" onClick={() => gameRef.current?.togglePause()} title="Pause (P)">
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
            )}
          </div>

          {/* safe-house status chip (campaign) or level + XP bar (endless) */}
          {endless ? (
            <div className="absolute top-[74px] right-6 z-40 chip flex-col items-end gap-1.5 py-2.5">
              <span className="hud-font text-[11px] tracking-[0.3em] text-neutral-300">LVL {hud.level}</span>
              <div className="w-[160px] h-[5px] bg-neutral-800/80 border border-neutral-700/60">
                <div className="xp-fill h-full transition-all duration-300"
                  style={{ width: `${Math.min(100, (hud.xp / hud.xpNext) * 100)}%`, background: 'linear-gradient(90deg,#3a1a4a,#b06bff)' }} />
              </div>
            </div>
          ) : (
            <div className={`absolute top-[74px] right-6 z-40 safe-chip ${hud.safeReached ? 'reached' : hud.safeNear ? 'near' : ''}`}>
              <span className="dot" />
              <span className="hud-font text-[11px] tracking-[0.3em]">
                {hud.safeReached ? 'SAFE HOUSE — REACHED' : hud.safeNear ? 'SAFE HOUSE IN SIGHT' : 'SAFE HOUSE — UNKNOWN'}
              </span>
            </div>
          )}

          {/* bottom-left: health */}
          <div className="absolute bottom-6 left-6 z-40 pointer-events-none">
            <div className="flex items-center gap-2 mb-1.5">
              <Heart size={15} color={hud.hp <= 30 ? '#ff4152' : '#d8d4c8'} fill={hud.hp <= 30 ? '#ff4152' : 'none'} />
              <span className="hud-font text-[11px] tracking-[0.3em] text-neutral-400">VITALS</span>
              <span className={`hud-font text-sm ${hud.hp <= 30 ? 'text-red-500' : 'text-neutral-200'}`}>{hud.hp}</span>
            </div>
            <div className="w-[240px] h-[10px] bg-neutral-900/90 border border-neutral-700/70 skew-x-[-12deg] overflow-hidden">
              <div className="hp-fill h-full transition-all duration-200"
                style={{ width: `${hud.hp}%`, background: hud.hp <= 30 ? 'linear-gradient(90deg,#7a0d12,#ff2438)' : 'linear-gradient(90deg,#5c1114,#c22030)' }} />
            </div>
            <div className="flex gap-[3px] mt-1.5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className={`w-[18px] h-[3px] skew-x-[-12deg] ${i < Math.ceil(hud.hp / 10) ? 'bg-red-800' : 'bg-neutral-800'}`} />
              ))}
            </div>
          </div>

          {/* bottom-right: weapon strip (endless) + active weapon ammo */}
          <div className="absolute bottom-6 right-6 z-40 text-right">
            {endless && (
              <div className="flex gap-1.5 justify-end mb-2 pointer-events-auto">
                {hud.slots.map((s, i) => (
                  <button key={i} className={`wslot ${s.owned ? 'owned' : ''} ${i === hud.slotIdx ? 'active' : ''}`}
                    onClick={() => gameRef.current?.selectWeapon(i)}
                    title={s.owned ? `${s.name} (${i + 1})` : `Empty (${i + 1})`} disabled={!s.owned}>
                    <span className="text-[9px] tracking-widest leading-none">{i + 1}</span>
                    <span className="text-[10px] font-bold leading-none mt-0.5">{s.owned ? s.name : '—'}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end justify-end gap-2 pointer-events-none">
              <span className="hud-font text-[11px] tracking-[0.3em] text-neutral-500 mb-2">{hud.weaponName}</span>
            </div>
            <div className="font-type text-5xl leading-none text-neutral-100 pointer-events-none" style={{ textShadow: '0 0 18px rgba(255,60,60,0.25)' }}>
              {String(hud.ammo).padStart(2, '0')}
              <span className="text-2xl text-neutral-500"> / —</span>
            </div>
            <div className="flex gap-[3px] justify-end mt-2 pointer-events-none">
              {Array.from({ length: Math.min(15, hud.magSize) }).map((_, i) => {
                const filled = Math.round((hud.ammo / Math.max(1, hud.magSize)) * Math.min(15, hud.magSize));
                return <div key={i} className={`pip ${i < filled ? 'live' : ''}`} />;
              })}
            </div>
            <div className={`hud-font text-[11px] tracking-[0.35em] mt-2 pointer-events-none ${hud.reloading ? 'text-amber-400 blink' : hud.ammo <= Math.max(1, Math.round(hud.magSize * 0.25)) ? 'text-red-500 blink' : 'text-neutral-600'}`}>
              {hud.reloading ? 'RELOADING' : hud.ammo === 0 ? 'PRESS R — EMPTY' : hud.ammo <= Math.max(1, Math.round(hud.magSize * 0.25)) ? 'LOW — R TO RELOAD' : 'MAG READY'}
            </div>
          </div>

          {/* horde surge warning */}
          {hud.surge && playing && (
            <div className="absolute top-[20%] left-1/2 -translate-x-1/2 z-40 surge-banner">
              <Radiation size={18} />
              <span>HORDE SURGE — HOLD THE LINE</span>
            </div>
          )}

          {/* stage-1 controls hint */}
          {playing && !endless && hud.act === 1 && hud.stage === 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 hint-bar">
              <span><b>A/D</b> MOVE</span><span><b>SPACE</b> JUMP</span><span><b>MOUSE</b> AIM</span>
              <span><b>LMB</b> FIRE</span><span><b>R</b> RELOAD</span><ChevronRight size={14} className="text-red-500" />
              <span className="text-red-400">REACH THE SAFE HOUSE</span>
            </div>
          )}
          {playing && endless && hud.wave === 1 && hud.waveTimeLeft > 28 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 hint-bar">
              <span><b>A/D</b> MOVE</span><span><b>SPACE</b> JUMP</span><span><b>MOUSE</b> AIM</span>
              <span><b>LMB</b> FIRE</span><span><b>1-4</b> SWITCH GUN</span><ChevronRight size={14} className="text-red-500" />
              <span className="text-red-400">HOLD THE LINE</span>
            </div>
          )}
        </>
      )}

      {/* ── PHASE OVERLAYS ──────────────────────────────────────────────── */}
      {hud.phase === 'menu' && (
        <StartMenu onStart={() => gameRef.current?.start()} onStartEndless={() => gameRef.current?.startEndless()} />
      )}
      {hud.phase === 'actbanner' && (
        <div className="overlay-screen">
          <div className="banner-kicker">{hud.actName} OF IV</div>
          <div className="font-display banner-title" style={{ color: pal.accent }}>{hud.actSubtitle}</div>
          <div className="banner-sub">STAGE 1/4 — GET TO THE SAFE HOUSE.</div>
        </div>
      )}
      {hud.phase === 'stageclear' && (
        <div className="overlay-screen">
          <Flag size={40} color="#51ff7a" style={{ filter: 'drop-shadow(0 0 14px #51ff7a)' }} />
          <div className="font-display banner-title text-neutral-100">STAGE {hud.stage} CLEAR</div>
          <div className="banner-sub">SAFE HOUSE SECURED — {hud.stage === 4 ? 'NEXT ACT INBOUND' : 'ADVANCING…'}</div>
        </div>
      )}
      {hud.phase === 'paused' && (
        <div className="overlay-screen">
          <div className="font-display banner-title text-neutral-100">PAUSED</div>
          <div className="flex flex-col gap-3 mt-4">
            <button className="btn btn-primary" onClick={() => gameRef.current?.resume()}><Play size={16} /> RESUME</button>
            <button className="btn" onClick={() => gameRef.current?.restartStage()}><RotateCcw size={16} /> {endless ? 'RESTART RUN' : 'RESTART STAGE'}</button>
            <button className="btn" onClick={() => gameRef.current?.backToMenu()}><Home size={16} /> QUIT TO MENU</button>
          </div>
        </div>
      )}
      {hud.phase === 'levelup' && (
        <div className="overlay-screen">
          <div className="banner-kicker text-violet-400">LEVEL UP</div>
          <div className="font-display banner-title text-neutral-100" style={{ fontSize: 'clamp(32px, 5vw, 56px)' }}>LEVEL {hud.level}</div>
          <div className="banner-sub">CHOOSE ONE</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 px-4">
            {hud.cards.map((c, i) => (
              <button key={c.id} className="pick-card" onClick={() => gameRef.current?.pickCard(i)}>
                <span className="kbd">{i + 1}</span>
                {cardIcon(c)}
                <span className="pick-card-title">{c.title}</span>
                <span className="pick-card-sub">{c.sub}</span>
                <span className="pick-card-stat">{c.stat}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {hud.phase === 'gameover' && (
        <div className="overlay-screen">
          <div className="font-display banner-title dead text-red-600">YOU DIED</div>
          <div className="font-type text-neutral-400 tracking-widest">
            {endless ? `WAVE ${hud.wave} · LVL ${hud.level}` : `${hud.actName} — STAGE ${hud.stage}/4`} · {hud.kills} KILLS · {fmtTime(hud.timeSec)}
          </div>
          <div className="flex gap-3 mt-5">
            <button className="btn btn-primary" onClick={() => gameRef.current?.restartStage()}><RotateCcw size={16} /> {endless ? 'RUN IT AGAIN' : 'RETRY STAGE'}</button>
            <button className="btn" onClick={() => gameRef.current?.backToMenu()}><Home size={16} /> MENU</button>
          </div>
        </div>
      )}
      {hud.phase === 'victory' && (
        <div className="overlay-screen">
          <Flag size={40} color="#51ff7a" style={{ filter: 'drop-shadow(0 0 14px #51ff7a)' }} />
          <div className="font-display banner-title" style={{ color: '#51ff7a' }}>YOU SURVIVED</div>
          <div className="font-type text-neutral-300 tracking-widest text-center">
            ALL 4 ACTS CLEARED — {hud.finalKills} ZOMBIES DOWN · {fmtTime(hud.finalTime)}
          </div>
          <button className="btn btn-primary mt-5" onClick={() => gameRef.current?.backToMenu()}><RotateCcw size={16} /> RUN IT AGAIN</button>
        </div>
      )}
    </div>
  );
}

// ── start menu ────────────────────────────────────────────────────────────────
function StartMenu({ onStart, onStartEndless }: { onStart: () => void; onStartEndless: () => void }) {
  return (
    <div className="overlay-screen menu-bg">
      <div className="menu-blood" />
      <div className="banner-kicker text-red-600">A SIDE-SCROLL SURVIVAL CAMPAIGN</div>
      <h1 className="font-display menu-title glitch" data-text="DEAD MILE">DEAD MILE</h1>
      <div className="font-type text-neutral-400 tracking-[0.25em] text-sm md:text-base text-center max-w-xl leading-relaxed">
        FOUR ACTS. FOUR STAGES EACH. ONE SMOKING GLOCK 19.<br />
        WALK IN — CRAWL OUT. THE SAFE HOUSE IS ALL THAT MATTERS.
      </div>
      <div className="flex flex-col sm:flex-row gap-3 mt-3">
        <button className="btn btn-primary text-lg px-10 py-4" onClick={onStart}>
          <CrosshairIcon size={18} /> START CAMPAIGN <span className="kbd">ENTER</span>
        </button>
        <button className="btn text-lg px-10 py-4" onClick={onStartEndless}>
          <Radiation size={18} /> ENDLESS MODE <span className="kbd">E</span>
        </button>
      </div>
      <div className="font-type text-neutral-600 tracking-[0.2em] text-xs text-center max-w-xl -mt-1">
        FIXED ARENA · INFINITE WAVES · EARN GUNS
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2 mt-8 font-type text-[13px] text-neutral-500 tracking-wider">
        <span><b className="text-neutral-300">A / D</b> — MOVE</span>
        <span><b className="text-neutral-300">SPACE / W</b> — JUMP</span>
        <span><b className="text-neutral-300">SHIFT</b> — SPRINT</span>
        <span><b className="text-neutral-300">MOUSE</b> — AIM</span>
        <span><b className="text-neutral-300">LMB</b> — FIRE</span>
        <span><b className="text-neutral-300">R</b> — RELOAD (15 RD MAG)</span>
        <span><b className="text-neutral-300">P</b> — PAUSE · <b className="text-neutral-300">M</b> — MUTE</span>
        <span><b className="text-neutral-300">`</b> — DEBUG ORBIT CAM</span>
      </div>
      <div className="absolute bottom-5 hud-font text-[10px] tracking-[0.4em] text-neutral-700">
        ALL VISUALS + AUDIO PROCEDURALLY GENERATED · THREE.JS
      </div>
    </div>
  );
}
