/* Satronho BoxFit · núcleo heredado de Boxfit Pro: timer, semáforo, ruletas, perfil, peso y ajustes.
   Antes vivía dentro de index.html; va antes de los módulos sf-*.js */
'use strict';
/* =========================================================
   0. UTILIDADES Y PUENTE NATIVO (Capacitor)
   ========================================================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const fmt = s => { s = Math.max(0, Math.round(s)); return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0'); };
const fmtShort = s => s < 60 ? s + 's' : (s % 60 ? fmt(s).replace(/^0/,'') : (s/60) + ' min');
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem('bfp2_' + k)); return v ?? d; } catch(e){ return d; } };
// Si guardar falla (casi siempre: almacenamiento lleno), se avisa en vez de perder datos en silencio
let saveWarnAt = 0;
const save = (k, v) => { try { localStorage.setItem('bfp2_' + k, JSON.stringify(v)); return true; } catch(e){
  if (Date.now() - saveWarnAt > 60000){ saveWarnAt = Date.now(); try { toast('⚠️ No se pudo guardar: el espacio de la app está lleno. Haz una copia de seguridad en Ajustes › Datos'); } catch(_){} }
  return false; } };
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const Cap = window.Capacitor;
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const plugin = n => { try { return (isNative && Cap.registerPlugin) ? Cap.registerPlugin(n) : null; } catch(e){ return null; } };
const AppP = plugin('App'), Haptics = plugin('Haptics'), Awake = plugin('KeepAwake');

/* =========================================================
   1. DATOS: ENTRENAMIENTOS Y AJUSTES
   ========================================================= */
const COLORS = ['#d98585','#dc9a6e','#d6a660','#cdb262','#7fb38a','#6fb39a','#6fb0b6','#7f9bd6','#8f8fd2','#9d8fd0','#c79bd0','#d08aa8'];
const EMOJIS = ['🥊','🏆','🤼','🦵','⚡','💥','🔥','🏃','💪','🥋','⏱️','🎯','🧘','🚴','🦾','👊'];
const DEFAULT_PROFILES = [
  { id:'amateur', name:'Boxeo Amateur', icon:'🥊', color:'#d98585', work:180, rest:60,  rounds:3,  prep:10, warn:30 },
  { id:'pro',     name:'Boxeo Pro',     icon:'🏆', color:'#d6a660', work:180, rest:60,  rounds:12, prep:10, warn:30 },
  { id:'mma',     name:'MMA',           icon:'🤼', color:'#9d8fd0', work:300, rest:60,  rounds:5,  prep:10, warn:30 },
  { id:'muay',    name:'Muay Thai',     icon:'🦵', color:'#6fb0b6', work:180, rest:120, rounds:5,  prep:10, warn:30 },
  { id:'tabata',  name:'Tabata',        icon:'⚡', color:'#7fb38a', work:20,  rest:10,  rounds:8,  prep:10, warn:5  },
  { id:'saco',    name:'Saco y Sombra', icon:'💥', color:'#d08aa8', work:120, rest:30,  rounds:6,  prep:10, warn:15 },
];
const DEFAULT_SETTINGS = { sound:true, volume:80, countdown:true, warnSound:true, vibrate:true, askAtStart:true, autoTraffic:false, keepAwake:true, flash:true, mode:'personal', theme:'dark', loud:false, guide:true, guideTips:true, guideTimer:true, guideName:'', seen:{} };

let profiles = load('profiles', null) || JSON.parse(JSON.stringify(DEFAULT_PROFILES));
// 4.3: los colores guardados antes (muy brillantes) pasan a su versión sobria
(function(){ const M = {'#ef4444':'#d98585','#f97316':'#dc9a6e','#f59e0b':'#d6a660','#eab308':'#cdb262','#22c55e':'#7fb38a','#10b981':'#6fb39a','#06b6d4':'#6fb0b6','#3b82f6':'#7f9bd6','#6366f1':'#8f8fd2','#8b5cf6':'#9d8fd0','#d946ef':'#c79bd0','#ec4899':'#d08aa8'};
  let ch = false; profiles.forEach(p => { const c = M[(p.color || '').toLowerCase()]; if (c){ p.color = c; ch = true; } }); if (ch) save('profiles', profiles); })();
let S = Object.assign({}, DEFAULT_SETTINGS, load('settings', {}));
// v4: el antiguo «modo gimnasio» (no guardar nada) ahora es el interruptor «Modo clase»; el modo Box House salió de la app
if (S.noSave === undefined) S.noSave = (S.mode === 'gym') || (!!S.gymMode && load('settings', {}).mode === undefined);
if (S.disc !== 'box' && S.disc !== 'gym') S.disc = 'box';
S.mode = 'personal';
const saving = () => !S.noSave;
let lastTrain = null;
// Registro único de entrenos (timer, sesiones guiadas, pesas, cardio y los que se anotan a mano)
function logTrain(rec){
  const h = Object.assign({ d: todayISO(), id: uid(), ts: Date.now(), r: 0, s: 0 }, rec);
  if (window.SF) SF.fillKcal(h);
  sessLog.push(h); if (sessLog.length > 4000) sessLog.shift(); save('history', sessLog);
  if (pmarks[h.d] === 'miss'){ delete pmarks[h.d]; savePM(); }
  lastTrain = h;
  if (window.SF) SF.onTrain(h);
  return h;
}
let stats = Object.assign({ sessions:0, rounds:0, workSec:0 }, load('stats', {}));
let currentId = load('current', profiles[0].id);
const getProfile = () => profiles.find(p => p.id === currentId) || profiles[0];
const saveProfiles = () => save('profiles', profiles);
const saveSettings = () => save('settings', S);
const totalOf = p => (p.prep||0) + p.work*p.rounds + p.rest*Math.max(0,p.rounds-1);

/* =========================================================
   2. AUDIO SINTETIZADO (sin archivos, funciona offline)
   ========================================================= */
let actx = null, master = null;
function audio(){
  if (!actx){
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    actx = new AC(); master = actx.createGain();
    // Limitador: permite subir mucho el volumen sin que el sonido se raspe
    limiter = actx.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 2; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    master.connect(limiter); limiter.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  master.gain.value = masterGain();
  return actx;
}
let limiter = null;
const masterGain = () => (S.volume/100) * (S.loud ? 3.2 : 1.15);
const LOUD = () => !!S.loud;
function tone(freq, start, dur, type='sine', vol=0.6, attack=0.005){
  const a = actx, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g); g.connect(master); o.start(start); o.stop(start + dur + 0.05);
}
// QUIET: mientras el timer se pone al día tras volver del segundo plano, nada suena ni vibra
let QUIET = false;
const Sound = {
  bell(times=1){ if (QUIET || !S.sound || !audio()) return; const t0 = actx.currentTime;
    for (let k=0;k<times;k++){ const t = t0 + k*0.42;
      [[1,0.5,2.4],[2.76,0.25,1.6],[5.4,0.12,1.0],[8.93,0.06,0.6],[1.5,0.15,1.8]].forEach(([m,v,d]) => tone(620*m, t, d, 'sine', v, 0.002));
      if (LOUD()){ [[1,0.35,2.6],[2,0.3,1.8],[3.2,0.18,1.2]].forEach(([m,v,d]) => tone(720*m, t, d, 'triangle', v, 0.002)); tone(1240, t, 0.25, 'square', 0.12, 0.001); } } },
  beep(high=false){ if (QUIET || !S.sound || !audio()) return;
    if (LOUD()){ const t = actx.currentTime; tone(high?1500:1050, t, high?0.6:0.22, 'square', 0.32); tone(high?3000:2100, t, high?0.5:0.18, 'square', 0.12); return; }
    tone(high?1320:880, actx.currentTime, high?0.5:0.16, 'square', 0.18); },
  whistle(){ if (QUIET || !S.sound || !S.warnSound || !audio()) return; const t0 = actx.currentTime;
    for (let k=0;k<3;k++){ const t = t0 + k*0.16, o = actx.createOscillator(), g = actx.createGain(), lfo = actx.createOscillator(), lg = actx.createGain();
      o.type='triangle'; o.frequency.value=2700; lfo.frequency.value=48; lg.gain.value=180; lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(LOUD()?0.8:0.45,t+0.02); g.gain.linearRampToValueAtTime(0.0001,t+0.12);
      o.connect(g); g.connect(master); o.start(t); lfo.start(t); o.stop(t+0.14); lfo.stop(t+0.14); } },
  tick(){ if (!S.sound || !audio()) return; tone(1800, actx.currentTime, 0.03, 'square', 0.12, 0.001); },
  win(){ if (QUIET || !S.sound || !audio()) return; const t = actx.currentTime; [523,659,784,1047].forEach((f,i)=>tone(f, t+i*0.09, 0.35, 'triangle', 0.35)); },
};
function vibrate(pattern){ if (QUIET || !S.vibrate) return;
  const ms = Array.isArray(pattern) ? pattern.reduce((a,b)=>a+b,0) : pattern;
  if (Haptics && Haptics.vibrate) Haptics.vibrate({ duration: ms }).catch(()=>{});
  else if (navigator.vibrate) navigator.vibrate(pattern);
}
function hapticTap(){ if (!S.vibrate) return; if (Haptics && Haptics.impact) Haptics.impact({ style:'LIGHT' }).catch(()=>{}); else if (navigator.vibrate) navigator.vibrate(8); }

/* Pantalla encendida */
let wakeLock = null;
async function keepAwake(on){
  try {
    if (on && S.keepAwake){
      if (Awake) await Awake.keepAwake();
      else if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    } else {
      if (Awake) await Awake.allowSleep();
      if (wakeLock){ await wakeLock.release(); wakeLock = null; }
    }
  } catch(e){}
}

/* =========================================================
   3. MOTOR DEL TIMER (máquina de estados limpia)
   ---------------------------------------------------------
   phase: idle | prep | work | rest | done
   paused es independiente de la fase: pausar NUNCA cambia
   la fase ni el round (esto corrige el bug del 2/3).
   ========================================================= */
const T = { phase:'idle', paused:false, round:1, endAt:0, remMs:0, dur:0, lastSec:-1, doneRounds:0, workDone:0, restDone:0 };
const PHASE_TEXT = { idle:'LISTO', prep:'PREPÁRATE', work:'¡PELEA!', rest:'DESCANSO', done:'FIN' };
const isActive = () => T.phase !== 'idle' && T.phase !== 'done';

function enterPhase(phase, base){
  const p = getProfile();
  T.phase = phase; T.lastSec = -1;
  T.dur = phase === 'prep' ? p.prep : phase === 'work' ? p.work : phase === 'rest' ? p.rest : 0;
  T.endAt = base + T.dur*1000;
  if (phase === 'work'){ Sound.bell(1); vibrate([300]); flash('work'); }
  else if (phase === 'rest'){ Sound.bell(2); vibrate([200,120,200]); flash('rest'); }
  else if (phase === 'prep'){ flash('prep'); }
  swapPhaseLabel();
}
// elapsed: segundos que de verdad duró la fase (si se saltó); si no se pasa, la fase se completó entera
function advance(base, elapsed){
  const p = getProfile(), full = elapsed == null, sec = full ? T.dur : Math.max(0, Math.min(T.dur, elapsed));
  if (T.phase === 'prep') return enterPhase('work', base);
  if (T.phase === 'work'){
    // Solo cuenta lo que se entrenó: un round saltado suma sus segundos y cuenta como round si pasó de la mitad
    const counts = full || sec >= T.dur / 2;
    T.workDone += sec; if (counts) T.doneRounds++;
    if (saving()){ if (counts) stats.rounds++; stats.workSec += sec; save('stats', stats); }
    if (T.round >= p.rounds) return finish();
    if (p.rest > 0) return enterPhase('rest', base);
    T.round++; return enterPhase('work', base);
  }
  if (T.phase === 'rest'){ T.restDone += sec; T.round++; return enterPhase('work', base); }
}
function start(){
  audio();
  const p = getProfile();
  T.round = 1; T.paused = false; T.doneRounds = 0; T.workDone = 0; T.restDone = 0;
  $('#doneCard').classList.remove('show');
  if (p.prep > 0) enterPhase('prep', Date.now()); else enterPhase('work', Date.now());
  keepAwake(true); render(true);
  if (S.autoTraffic && current !== 'traffic') go('traffic');
}
function pause(){ if (!isActive() || T.paused) return; T.remMs = Math.max(0, T.endAt - Date.now()); T.paused = true; keepAwake(false); hapticTap(); render(true); }
function resume(){ if (!isActive() || !T.paused) return; audio(); T.endAt = Date.now() + T.remMs; T.paused = false; keepAwake(true); hapticTap(); render(true); }
function toggle(){ if (!isActive()) start(); else if (T.paused) resume(); else pause(); }
function reset(){ T.phase = 'idle'; T.paused = false; T.round = 1; T.lastSec = -1; keepAwake(false); $('#doneCard').classList.remove('show'); swapPhaseLabel(); render(true); }
function skip(){
  if (!isActive()) return;
  const wasPaused = T.paused, ms = T.paused ? T.remMs : Math.max(0, T.endAt - Date.now());
  advance(Date.now(), T.dur - ms/1000);
  if (wasPaused && isActive()){ T.remMs = T.dur*1000; }
  render(true);
}
function finish(){
  const p = getProfile();
  T.phase = 'done'; T.paused = false;
  lastTrain = null;
  // Se guarda lo que de verdad se entrenó (rounds saltados no suman); menos de 30 s de trabajo no se guarda
  const work = Math.round(T.workDone || 0), logged = saving() && work >= 30;
  if (logged){ stats.sessions++; save('stats', stats); logTrain({ p: p.name, r: T.doneRounds || 0, s: work, m: Math.max(1, Math.round((work + (T.restDone || 0))/60)), t: 'box', a: p.act || 'box_timer' }); }
  Sound.bell(3); vibrate([400,150,400,150,600]); flash('work');
  keepAwake(false);
  $('#doneSummary').textContent = `${T.doneRounds || 0} rounds · ${fmtShort(work)} de ${p.name}` + (lastTrain && lastTrain.k ? ` · ≈${lastTrain.k} kcal` : '') + (!saving() ? ' · modo clase: no se guardó' : !logged ? ' · muy corto: no se guardó' : '');
  if (current === 'timer') { $('#doneCard').classList.add('show'); confetti(); }
  swapPhaseLabel(); renderStats();
}
function remainingSec(){
  if (T.phase === 'idle') return getProfile().work;
  if (T.phase === 'done') return 0;
  const ms = T.paused ? T.remMs : T.endAt - Date.now();
  return Math.max(0, Math.ceil(ms/1000));
}
function totalRemaining(){
  const p = getProfile();
  if (T.phase === 'idle') return totalOf(p);
  if (T.phase === 'done') return 0;
  let s = remainingSec();
  const after = p.rounds - T.round; // rounds completos que faltan después del actual
  if (T.phase === 'prep') s += p.work*p.rounds + p.rest*(p.rounds-1);
  else if (T.phase === 'work') s += after*(p.work + p.rest);
  else if (T.phase === 'rest') s += p.work + (p.rounds - T.round - 1)*(p.work+p.rest);
  return s;
}
function update(){
  if (isActive() && !T.paused){
    const now = Date.now();
    let guard = 0;
    // Si la app estuvo en segundo plano, se pone al día en silencio (antes sonaban todas las campanas juntas)
    QUIET = now - T.endAt > 1500;
    try { while (isActive() && T.endAt <= now && guard++ < 200) advance(T.endAt); } finally { QUIET = false; }
    if (isActive()){
      const sec = remainingSec();
      if (sec !== T.lastSec){
        T.lastSec = sec;
        const p = getProfile();
        if (T.phase === 'work' && p.warn > 0 && sec === p.warn && p.warn < p.work){ Sound.whistle(); vibrate([80,60,80]); flash('warn'); }
        if ((T.phase === 'prep' || T.phase === 'rest') && sec <= 3 && sec >= 1 && S.countdown){ Sound.beep(false); bump(); }
        else if (T.phase === 'work' && sec <= 3 && sec >= 1){ bump(); }
      }
    }
  }
  render();
}
let rafOn = false;
function loop(){ update(); requestAnimationFrame(loop); }
setInterval(update, 250); // respaldo cuando la animación está en pausa

/* =========================================================
   4. RENDER DEL TIMER Y DEL SEMÁFORO
   ========================================================= */
const RING_C = 2*Math.PI*130;
const PCOL = { prep:'#38bdf8', work:'#22c55e', warn:'#facc15', rest:'#ef4444', done:'#a1a1aa' };
let lastDotsKey = '';
function phaseColorKey(){
  if (T.phase === 'work'){ const p = getProfile(); if (p.warn>0 && remainingSec() <= p.warn) return 'warn'; return 'work'; }
  if (T.phase === 'idle') return 'idle';
  return T.phase;
}
function render(force){
  const p = getProfile();
  const key = phaseColorKey();
  const color = key === 'idle' ? p.color : PCOL[key];
  document.documentElement.style.setProperty('--phase', color);
  document.documentElement.style.setProperty('--accent', p.color);

  const sec = remainingSec();
  const tstr = fmt(sec);
  $('#bigTime').textContent = tstr;
  $('#roundNum').textContent = T.round; $('#roundTot').textContent = p.rounds;
  const pl = T.paused ? 'PAUSADO' : (key === 'warn' ? 'ÚLTIMOS ' + p.warn + 's' : PHASE_TEXT[T.phase]);
  if ($('#phaseLbl').textContent !== pl) $('#phaseLbl').textContent = pl;

  // anillo
  let prog = 0;
  if (isActive() && T.dur > 0){ const ms = T.paused ? T.remMs : Math.max(0, T.endAt - Date.now()); prog = 1 - ms/(T.dur*1000); }
  else if (T.phase === 'done') prog = 1;
  $('#ringFg').style.strokeDashoffset = (RING_C * prog).toFixed(1);
  $('#ringwrap').classList.toggle('danger', isActive() && !T.paused && sec <= 10 && T.phase !== 'prep');

  // puntos de rounds
  const dk = p.rounds + '-' + T.round + '-' + T.phase;
  if (dk !== lastDotsKey){
    lastDotsKey = dk;
    const n = p.rounds;
    $('#dots').innerHTML = n > 24 ? '' : Array.from({length:n}, (_,i) => {
      const r = i+1; const cls = (T.phase==='done' || r < T.round) ? 'done' : (r === T.round && isActive() ? 'cur' : '');
      return `<i class="${cls}"></i>`; }).join('');
  }
  // info
  let next = '—';
  if (T.phase === 'idle') next = `${p.rounds} × ${fmt(p.work)}`;
  else if (T.phase === 'prep') next = `Round 1 · ${fmt(p.work)}`;
  else if (T.phase === 'work') next = T.round < p.rounds ? (p.rest>0 ? `Descanso ${fmt(p.rest)}` : `Round ${T.round+1}`) : '¡Final!';
  else if (T.phase === 'rest') next = `Round ${T.round+1} · ${fmt(p.work)}`;
  else if (T.phase === 'done') next = '¡Completado!';
  $('#nextLbl').textContent = next;
  $('#totalLbl').textContent = fmt(totalRemaining());

  // botones
  const playing = isActive() && !T.paused;
  const btn = $('#btnPlay');
  btn.classList.toggle('idle', !isActive());
  const icon = playing ? '<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>' : '<path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.7L9.5 4.6A1 1 0 0 0 8 5.5z"/>';
  if (btn.dataset.st !== String(playing)){ $('#playIcon').innerHTML = icon; btn.dataset.st = String(playing); }
  $('#btnSkip').disabled = !isActive();

  // semáforo
  const tv = $('#traffic');
  if (tv.dataset.c !== key) tv.dataset.c = key;
  $('#tTime').textContent = tstr;
  $('#tStatus').textContent = key === 'warn' ? 'ÚLTIMOS ' + p.warn + 's' : PHASE_TEXT[T.phase];
  $('#tRound').textContent = T.round; $('#tTotal').textContent = p.rounds;
  $('#tPaused').classList.toggle('show', T.paused);
  if (window.mascotSync) mascotSync(T.paused ? 'idle' : key);
  $('#tHint').textContent = !isActive() ? (T.phase==='done' ? 'TOCA PARA REPETIR' : 'TOCA LA PANTALLA PARA EMPEZAR') : 'TOCA PARA PAUSAR';

  // banner en inicio
  const rb = $('#runningBanner');
  rb.classList.toggle('show', isActive());
  if (isActive()){ $('#rbTime').textContent = `${tstr} · R${T.round}/${p.rounds}`; $('#rbLabel').textContent = (T.paused ? 'En pausa · ' : PHASE_TEXT[T.phase].replace(/[¡!]/g,'') + ' · ') + p.name; }
}
function swapPhaseLabel(){ const el = $('#phaseLbl'); el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
function bump(){ ['#bigTime','#tTime'].forEach(s => { const el = $(s); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }); }
function flash(key){
  if (QUIET || !S.flash) return;
  const f = $('#flash'); f.style.background = PCOL[key];
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}

$('#btnPlay').addEventListener('click', toggle);
$('#btnReset').addEventListener('click', () => { if (isActive()) confirmDlg('¿Reiniciar?', 'Se perderá el progreso de este entrenamiento.', 'REINICIAR').then(ok => ok && reset()); else reset(); });
$('#btnSkip').addEventListener('click', skip);
$('#doneAgain').addEventListener('click', start);
$('#doneChange').addEventListener('click', () => { reset(); go('home'); });
$('#profileChip').addEventListener('click', () => go('home'));

let tLock = false;
$('#traffic').addEventListener('click', e => {
  if (e.target.closest('#tClose')) return;
  if (tLock) return; tLock = true; setTimeout(() => tLock = false, 380); // evita dobles toques fantasma
  toggle();
});
$('#tClose').addEventListener('click', e => { e.stopPropagation(); go('timer', true); });

/* =========================================================
   5. NAVEGACIÓN + BOTÓN ATRÁS DE ANDROID
   ========================================================= */
let NAV_ORDER = ['home','train','nutri','progress','settings'];
const NAV_HIDE = ['traffic','editor','warmupPlay'];
let current = null;
function go(view, backAnim=false){
  if (view === current) return;
  const prev = current;
  $$('.view').forEach(v => v.classList.remove('active','back-anim'));
  const el = $('#' + view);
  if (backAnim) el.classList.add('back-anim');
  el.classList.add('active');
  current = view;
  $('#nav').classList.toggle('hide', NAV_HIDE.includes(view));
  renderNav();
  if (view === 'home') renderHome();
  if (view === 'settings') renderSettings();
  if (VIEW_RENDER[view]) VIEW_RENDER[view]();
  el.scrollTop = 0;
  if (window.secTabs) secTabs(view);
  if (window.guideOnView) guideOnView(view);
  if (view === 'roulette') { requestAnimationFrame(() => { sizeWheel(); placePill(); }); startBulbs(); } else stopBulbs();
  if (view === 'timer' && T.phase === 'done') $('#doneCard').classList.add('show');
  if (prev === 'timer') $('#doneCard').classList.remove('show');
  render(true);
}
function positionNavInd(idx){
  const nav = $('#nav'), ind = $('#navInd'); const w = (nav.clientWidth - 12) / Math.max(1, $$('#navBtns button').length);
  ind.style.width = w + 'px'; ind.style.transform = `translateX(${idx*w}px)`;
}
window.addEventListener('resize', () => { renderNav(); if (current==='roulette') sizeWheel(); });
$$('[data-go]').forEach(b => b.addEventListener('click', () => { hapticTap(); go(b.dataset.go); }));

let lastBack = 0;
function handleBack(){
  if ($('#confirmModal').classList.contains('show')) return closeConfirm(false);
  if ($('#resultModal').classList.contains('show')) return closeResult();
  if ($('#formModal').classList.contains('show')) return closeForm();
  if (current === 'warmupPlay') return exitWarmup();
  if (BACK_TO[current]) return go(typeof BACK_TO[current] === 'function' ? BACK_TO[current]() : BACK_TO[current], true);
  if (current === 'editor') return go(editorReturn, true);
  if (window.SFBack && SFBack()) return;
  if (current === 'traffic') return go('timer', true);
  if (current === 'roulette' || current === 'timer') return go('train', true);
  if (current === 'settings' || current === 'train' || current === 'nutri' || current === 'progress') return go('home', true);
  // en Inicio: doble toque para salir
  const now = Date.now();
  if (now - lastBack < 2000){ if (AppP) AppP.exitApp(); return; }
  lastBack = now; toast('Presiona atrás otra vez para salir');
}
if (AppP){ AppP.addListener('backButton', handleBack); }
else { // navegador: emula el botón atrás con el historial
  history.pushState({b:1}, ''); window.addEventListener('popstate', () => { handleBack(); history.pushState({b:1}, ''); });
}

/* =========================================================
   6. INICIO: SELECCIÓN DE ENTRENAMIENTO
   ========================================================= */
function renderStats(){}
function renderHome(){ if (window.SFToday) SFToday.render(); }
// Tarjetas de las rutinas del timer (se pintan en Entrenar › Boxeo)
function renderProfileGrid(g){
  if (!g) return;
  g.innerHTML = profiles.map((p,i) => `
    <button class="card ${p.id===currentId?'sel':''}" style="--c:${p.color};--i:${i}" data-pick="${p.id}">
      <span class="glow"></span>
      <span class="tot">${Math.round(totalOf(p)/60)} min</span>
      <span class="ic">${p.icon}</span>
      <h3>${esc(p.name)}</h3>
      <p>${p.rounds} × ${fmtShort(p.work)} · ${p.rest ? 'desc. ' + fmtShort(p.rest) : 'sin descanso'}</p>
      <span class="edit" data-edit="${p.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></span>
    </button>`).join('') + `<button class="card add" style="--i:${profiles.length}" data-addcard><span class="plus">+</span><b>CREAR PROPIO</b></button>`;
  g.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]'); if (ed){ e.stopPropagation(); return openEditor(ed.dataset.edit, 'train'); }
    pickProfile(b.dataset.pick);
  }));
  g.querySelector('[data-addcard]').addEventListener('click', () => openEditor(null, 'train'));
}
async function pickProfile(id){
  hapticTap();
  if (isActive() && id !== currentId){
    const ok = await confirmDlg('¿Cambiar rutina?', 'Hay un entrenamiento en curso. Si cambias, se reinicia.', 'CAMBIAR'); if (!ok) return;
  }
  if (id !== currentId || T.phase === 'done'){ currentId = id; save('current', id); reset(); }
  updateChip(); go('timer');
}
function updateChip(){ const p = getProfile(); $('#chipIcon').textContent = p.icon; $('#chipName').textContent = p.name; }
$('#runningBanner').addEventListener('click', () => go('timer'));

/* =========================================================
   7. AJUSTES
   ========================================================= */
function renderSettings(){
  $('#profList').innerHTML = profiles.map(p => `
    <button class="row" style="width:100%;text-align:left;--c:${p.color}" data-ep="${p.id}">
      <span class="pic">${p.icon}</span>
      <span class="l"><b>${esc(p.name)}</b><small>${p.rounds} × ${fmt(p.work)} · descanso ${fmt(p.rest)} · prep ${p.prep}s</small></span>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" style="opacity:.4"><path d="M9 5l7 7-7 7"/></svg>
    </button>`).join('');
  $$('#profList [data-ep]').forEach(b => b.addEventListener('click', () => openEditor(b.dataset.ep, 'settings')));
  $$('[data-set]').forEach(sw => sw.classList.toggle('on', !!S[sw.dataset.set]));
  $('#volume').value = S.volume;
  if (window.SFSettings) SFSettings.render();
  $('#statsLine').textContent = `${stats.sessions} sesiones · ${stats.rounds} rounds · ${Math.round((stats.workSec + (stats.trainSec||0))/60)} min`;
  renderSettingsExtra();
}
$$('[data-set]').forEach(sw => sw.addEventListener('click', () => {
  const k = sw.dataset.set; S[k] = !S[k]; saveSettings(); sw.classList.toggle('on', S[k]); hapticTap();
  if (k === 'keepAwake') keepAwake(isActive() && !T.paused);
  if (k === 'loud'){ if (master) master.gain.value = masterGain(); if (S.loud){ const s = S.sound; S.sound = true; Sound.bell(1); S.sound = s; } }
  if (k === 'guide' || k === 'guideTimer') window.guideRefresh && guideRefresh();
}));
$('#volume').addEventListener('input', e => { S.volume = +e.target.value; saveSettings(); if (master) master.gain.value = masterGain(); });
$('#testSound').addEventListener('click', () => { const s = S.sound; S.sound = true; Sound.bell(1); S.sound = s; });
$('#btnNewProfile').addEventListener('click', () => openEditor(null, 'settings'));
$('#resetStats').addEventListener('click', async () => { if (await confirmDlg('¿Borrar estadísticas?', 'Sesiones, rounds y minutos volverán a cero.', 'BORRAR')){ stats = {sessions:0,rounds:0,workSec:0,trainSec:0}; save('stats', stats); renderSettings(); toast('Estadísticas borradas'); } });
$('#resetProfiles').addEventListener('click', async () => { if (await confirmDlg('¿Restaurar?', 'Se reemplazarán tus entrenamientos por los originales.', 'RESTAURAR')){ profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES)); saveProfiles(); currentId = profiles[0].id; save('current', currentId); reset(); updateChip(); renderSettings(); toast('Entrenamientos restaurados'); } });

/* =========================================================
   8. EDITOR DE ENTRENAMIENTO
   ========================================================= */
let draft = null, editorReturn = 'home';
const LIMITS = { work:[5,1800], rest:[0,600], rounds:[1,50], prep:[0,60], warn:[0,120] };
const isTimeKey = k => k !== 'rounds';
function stepFor(k, v, dir){
  if (k === 'rounds') return 1;
  if (k === 'prep' || k === 'warn') return 5;
  const base = dir > 0 ? v : v - 1;
  return base < 60 ? 5 : base < 300 ? 15 : 30;
}
function openEditor(id, from){
  editorReturn = from;
  const src = id ? profiles.find(p => p.id === id) : null;
  draft = src ? Object.assign({}, src) : { id:'c' + Date.now().toString(36), name:'Mi rutina', icon:'🔥', color:'#dc9a6e', work:120, rest:45, rounds:4, prep:10, warn:15, _new:true };
  $('#edTitle').textContent = src ? 'EDITAR' : 'NUEVO';
  $('#edDelete').style.display = (src && profiles.length > 1) ? '' : 'none';
  $('#edName').value = draft.name;
  $('#edSwatches').innerHTML = COLORS.map(c => `<button style="--s:${c}" data-c="${c}"></button>`).join('');
  $('#edEmojis').innerHTML = EMOJIS.map(e => `<button data-e="${e}">${e}</button>`).join('');
  $$('#edSwatches button').forEach(b => b.addEventListener('click', () => { draft.color = b.dataset.c; hapticTap(); paintEditor(); }));
  $$('#edEmojis button').forEach(b => b.addEventListener('click', () => { draft.icon = b.dataset.e; hapticTap(); paintEditor(); }));
  paintEditor(); go('editor');
}
function paintEditor(){
  const ed = $('#editor'); ed.style.setProperty('--c', draft.color);
  $('#edPreview').style.setProperty('--c', draft.color);
  $('#edIcon').textContent = draft.icon;
  $('#edSummary').textContent = `${draft.rounds} × ${fmt(draft.work)} · descanso ${fmt(draft.rest)} · total ${fmt(totalOf(draft))}`;
  $$('#edSwatches button').forEach(b => b.classList.toggle('on', b.dataset.c === draft.color));
  $$('#edEmojis button').forEach(b => b.classList.toggle('on', b.dataset.e === draft.icon));
  $$('#editor .stepper').forEach(st => { const k = st.dataset.k; st.querySelector('output').textContent = isTimeKey(k) ? (k==='prep'||k==='warn' ? draft[k] + 's' : fmt(draft[k])) : draft[k]; });
  $('#edSave').style.setProperty('--bc', draft.color);
}
$$('#editor .stepper').forEach(st => {
  const k = st.dataset.k;
  st.innerHTML = `<button data-d="-1">−</button><output></output><button data-d="1">+</button>`;
  st.querySelectorAll('button').forEach(b => {
    let timer = null, delay = 0;
    const step = () => {
      const d = +b.dataset.d; const [mn, mx] = LIMITS[k];
      let max = mx; if (k === 'warn') max = Math.min(mx, draft.work - 5);
      draft[k] = clamp(draft[k] + d*stepFor(k, draft[k], d), mn, Math.max(mn, max));
      if (k === 'work' && draft.warn >= draft.work) draft.warn = Math.max(0, draft.work - 5);
      paintEditor();
    };
    const stop = () => { clearTimeout(timer); timer = null; };
    b.addEventListener('pointerdown', e => { e.preventDefault(); step(); hapticTap(); delay = 420; const rep = () => { step(); delay = Math.max(60, delay*0.8); timer = setTimeout(rep, delay); }; timer = setTimeout(rep, delay); });
    ['pointerup','pointerleave','pointercancel'].forEach(ev => b.addEventListener(ev, stop));
  });
});
$('#edName').addEventListener('input', e => { draft.name = e.target.value; });
$('#edBack').addEventListener('click', () => go(editorReturn, true));
$('#edSave').addEventListener('click', () => {
  draft.name = (draft.name || '').trim() || 'Mi rutina';
  const isNew = draft._new; delete draft._new;
  const i = profiles.findIndex(p => p.id === draft.id);
  if (i >= 0) profiles[i] = draft; else profiles.push(draft);
  saveProfiles();
  if (draft.id === currentId){ if (!isActive()) reset(); updateChip(); }
  toast(isNew ? 'Entrenamiento creado' : 'Cambios guardados');
  go(editorReturn, true);
});
$('#edDelete').addEventListener('click', async () => {
  if (!await confirmDlg('¿Eliminar?', `Se borrará “${draft.name}”.`, 'ELIMINAR')) return;
  profiles = profiles.filter(p => p.id !== draft.id); saveProfiles();
  if (currentId === draft.id){ currentId = profiles[0].id; save('current', currentId); reset(); updateChip(); }
  go(editorReturn, true);
});

/* =========================================================
   9. RULETAS
   ========================================================= */
const R_DEFAULTS = {
  sparring:   ['Solo jab','Combinación 1-2','Pelea en corto','Solo defensa','Sombra ligera','Solo cuerpo','Contragolpe','Presión total'],
  combos:     ['1-2','1-2-3','1-1-2','1-2-3-2','Jab al cuerpo','2-3-2','1-6-3-2','Upper-Hook','1-2-Esquiva-2','3-2-3'],
  penitencia: ['20 burpees','1 min plancha','30 flexiones','50 sentadillas','40 abdominales','1 min de lazo','20 zancadas','30 s sprint'],
};
// Términos de Colombia (Quindío): "soga" → "lazo" también en lo que ya estaba guardado
const toLazo = t => typeof t === 'string' ? t.replace(/soga/g, 'lazo').replace(/Soga/g, 'Lazo').replace(/SOGA/g, 'LAZO') : t;
(() => { try {
  ['bfp2_roulettes','bfp2_bh_warmups'].forEach(k => { const v = localStorage.getItem(k); if (v && /soga/i.test(v)) localStorage.setItem(k, toLazo(v)); });
} catch(e){} })();
const R_META = {
  sparring:   { label:'SPARRING', color:'#7f9bd6', pal:['#7b93cf','#5fa5b0','#9a8bd0','#5ea69c','#8a86c9','#6a9fbf'] },
  combos:     { label:'COMBO',    color:'#7fb38a', pal:['#6fa87c','#b89a4e','#5ea69c','#8fae66','#5fa58a','#b48252'] },
  penitencia: { label:'CASTIGO',  color:'#d98585', pal:['#c97a7a','#d38d66','#cf9a5c','#bb6f7e','#bf7f5e','#b86a6a'] },
};
// migra listas de la versión anterior
const oldSp = (() => { try { return JSON.parse(localStorage.getItem('boxfit_sparring')); } catch(e){ return null; } })();
const oldPe = (() => { try { return JSON.parse(localStorage.getItem('boxfit_penitencia')); } catch(e){ return null; } })();
let rLists = load('roulettes', null) || { sparring: oldSp || R_DEFAULTS.sparring.slice(), combos: R_DEFAULTS.combos.slice(), penitencia: oldPe || R_DEFAULTS.penitencia.slice() };
let rMode = 'sparring';
const rList = () => rLists[rMode];
const saveR = () => save('roulettes', rLists);

const wheel = $('#wheel'), wctx = wheel.getContext('2d');
let wSize = 300, dpr = 1, rot = 0, spinning = false, bulbPhase = 0, bulbTimer = null, lastSeg = -1;

function segColor(i, n){ const pal = R_META[rMode].pal; let c = pal[i % pal.length]; if (i === n-1 && n % pal.length === 1 && n > 1) c = pal[(i+1) % pal.length]; return c; }
function sizeWheel(){
  const box = $('#wheelbox'); wSize = box.clientWidth || 300; dpr = Math.min(3, window.devicePixelRatio || 1);
  wheel.width = Math.round(wSize*dpr); wheel.height = Math.round(wSize*dpr); drawWheel();
}
function shade(hex, amt){ let c = parseInt(hex.slice(1),16); let r=(c>>16)+amt, g=((c>>8)&255)+amt, b=(c&255)+amt; r=clamp(r,0,255); g=clamp(g,0,255); b=clamp(b,0,255); return `rgb(${r},${g},${b})`; }
function fitText(text, maxW, maxH, baseSize){
  let size = baseSize, lines = [text];
  const fontOf = s => `700 ${s}px ${getComputedStyle(document.body).fontFamily}`;
  for (; size >= 10; size -= 1){
    wctx.font = fontOf(size);
    if (wctx.measureText(text).width <= maxW && size <= maxH){ lines = [text]; break; }
    const words = text.split(' ');
    if (words.length > 1){
      let best = null;
      for (let k=1;k<words.length;k++){ const a = words.slice(0,k).join(' '), b = words.slice(k).join(' '); const w = Math.max(wctx.measureText(a).width, wctx.measureText(b).width); if (!best || w < best.w) best = {a,b,w}; }
      if (best.w <= maxW && size*2.05 <= maxH*1.9){ lines = [best.a, best.b]; break; }
    }
  }
  wctx.font = fontOf(size);
  return { size, lines };
}
function drawWheel(){
  const items = rList(), n = items.length, s = wSize, c = s/2;
  wctx.setTransform(dpr,0,0,dpr,0,0); wctx.clearRect(0,0,s,s);
  const R = c - 2, rimW = Math.max(14, s*0.065), r = R - rimW;
  // aro exterior metálico
  let g = wctx.createLinearGradient(0,0,s,s); g.addColorStop(0,'#52525b'); g.addColorStop(.5,'#18181b'); g.addColorStop(1,'#3f3f46');
  wctx.beginPath(); wctx.arc(c,c,R,0,Math.PI*2); wctx.fillStyle = g; wctx.fill();
  wctx.beginPath(); wctx.arc(c,c,R-1.5,0,Math.PI*2); wctx.strokeStyle = 'rgba(255,255,255,.18)'; wctx.lineWidth = 1.5; wctx.stroke();
  if (!n){ wctx.beginPath(); wctx.arc(c,c,r,0,Math.PI*2); wctx.fillStyle='#1d1d25'; wctx.fill(); return; }
  const arc = Math.PI*2/n;
  for (let i=0;i<n;i++){
    const a0 = rot + i*arc, a1 = a0 + arc, col = segColor(i,n);
    const rg = wctx.createRadialGradient(c,c,r*0.15,c,c,r);
    rg.addColorStop(0, shade(col,-50)); rg.addColorStop(.65, col); rg.addColorStop(1, shade(col,35));
    wctx.beginPath(); wctx.moveTo(c,c); wctx.arc(c,c,r,a0,a1); wctx.closePath(); wctx.fillStyle = rg; wctx.fill();
    wctx.strokeStyle = 'rgba(0,0,0,.35)'; wctx.lineWidth = 2; wctx.stroke();
    // texto radial
    wctx.save(); wctx.translate(c,c); wctx.rotate(a0 + arc/2);
    const inner = r*0.30, outerPad = r*0.07, maxW = r - inner - outerPad;
    const chord = 2*Math.sin(Math.min(arc,Math.PI)/2)*(inner + maxW*0.45);
    const fit = fitText((window.SFI18n ? SFI18n.t(items[i]) : items[i]).toUpperCase(), maxW, chord*0.8, Math.round(s*0.058));
    wctx.textAlign = 'right'; wctx.textBaseline = 'middle'; wctx.fillStyle = '#fff';
    wctx.shadowColor = 'rgba(0,0,0,.55)'; wctx.shadowBlur = 4; wctx.shadowOffsetY = 1;
    const lh = fit.size*1.02;
    fit.lines.forEach((ln, li) => wctx.fillText(ln, r - outerPad, (li - (fit.lines.length-1)/2)*lh));
    wctx.restore();
  }
  // brillo interior
  const sh = wctx.createRadialGradient(c, c*0.6, 0, c, c, r);
  sh.addColorStop(0,'rgba(255,255,255,.10)'); sh.addColorStop(.6,'rgba(255,255,255,0)'); sh.addColorStop(1,'rgba(0,0,0,.25)');
  wctx.beginPath(); wctx.arc(c,c,r,0,Math.PI*2); wctx.fillStyle = sh; wctx.fill();
  // bombillos del aro
  const nb = Math.max(18, Math.min(32, n*3)), br = Math.max(2.6, rimW*0.2);
  for (let k=0;k<nb;k++){
    const a = k/nb*Math.PI*2 + rot*0.0, x = c + Math.cos(a)*(r + rimW/2), y = c + Math.sin(a)*(r + rimW/2);
    const lit = (k + bulbPhase) % 2 === 0;
    wctx.beginPath(); wctx.arc(x,y,br,0,Math.PI*2);
    wctx.fillStyle = lit ? '#fff7d6' : '#52525b';
    wctx.shadowColor = lit ? R_META[rMode].color : 'transparent'; wctx.shadowBlur = lit ? 10 : 0; wctx.fill(); wctx.shadowBlur = 0;
  }
}
function winnerIndex(){ const n = rList().length, arc = Math.PI*2/n; const a = (((-Math.PI/2 - rot) % (Math.PI*2)) + Math.PI*2) % (Math.PI*2); return Math.floor(a/arc) % n; }
function kickPointer(){ const p = $('#pointer'); p.classList.add('kick'); clearTimeout(p._t); p._t = setTimeout(() => p.classList.remove('kick'), 70); }
function spin(power=1){
  const items = rList();
  if (spinning || items.length < 2){ if (items.length < 2) toast('Agrega al menos 2 opciones'); return; }
  audio(); spinning = true; $('#btnSpin').classList.add('spinning'); $('#btnSpin').textContent = '···';
  const n = items.length, arc = Math.PI*2/n, win = Math.floor(Math.random()*n);
  const jitter = (Math.random()-0.5)*arc*0.7;
  const desired = -Math.PI/2 - (win + 0.5)*arc - jitter;
  const delta = (((desired - rot) % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  const turns = Math.round(4 + power*3 + Math.random()*2);
  const from = rot, to = rot + turns*Math.PI*2 + delta;
  const dur = 4200 + power*900 + Math.random()*600, t0 = performance.now();
  const ease = t => 1 - Math.pow(1-t, 4);
  lastSeg = winnerIndex();
  function anim(now){
    const t = Math.min(1, (now - t0)/dur);
    rot = from + (to - from)*ease(t);
    const seg = winnerIndex();
    if (seg !== lastSeg){ lastSeg = seg; Sound.tick(); kickPointer(); bulbPhase ^= 1; if (t > .6) hapticTap(); }
    drawWheel();
    if (t < 1) requestAnimationFrame(anim); else done(win);
  }
  requestAnimationFrame(anim);
}
function done(win){
  spinning = false; $('#btnSpin').classList.remove('spinning'); $('#btnSpin').textContent = 'GIRAR';
  const items = rList(), txt = items[winnerIndex()] ?? items[win], col = segColor(winnerIndex(), items.length);
  Sound.win(); vibrate([60,40,120]);
  $('#rLast').innerHTML = `Último: <span style="color:${col}">${esc(txt.toUpperCase())}</span>`;
  const sheet = $('#resultSheet'); sheet.style.setProperty('--rc', col);
  $('#resTag').textContent = R_META[rMode].label;
  $('#resText').textContent = txt.toUpperCase();
  const longest = Math.max(...txt.split(' ').map(w => w.length));
  $('#resText').style.fontSize = clamp(Math.floor(300/Math.max(longest,5)), 30, 58) + 'px';
  $('#resSub').textContent = rMode === 'penitencia' ? '¡Sin excusas, a cumplir!' : rMode === 'combos' ? 'Repítelo hasta que salga limpio.' : '¡Al ring con esa consigna!';
  $('#resAgain').style.setProperty('--bc', R_META[rMode].color);
  $('#resultModal').classList.add('show');
  confetti(col);
}
function closeResult(){ $('#resultModal').classList.remove('show'); }
$('#resClose').addEventListener('click', closeResult);
$('#resAgain').addEventListener('click', () => { closeResult(); setTimeout(() => spin(1), 250); });
$('#btnSpin').addEventListener('click', () => spin(1));

// deslizar la ruleta con el dedo para girarla
(() => {
  let sx=0, sy=0, st=0;
  wheel.addEventListener('pointerdown', e => { sx=e.clientX; sy=e.clientY; st=performance.now(); });
  wheel.addEventListener('pointerup', e => {
    const dx=e.clientX-sx, dy=e.clientY-sy, dist=Math.hypot(dx,dy), dt=performance.now()-st;
    if (dist > 40 && dt < 700) spin(clamp(dist/dt, 0.3, 2));
  });
})();
function startBulbs(){ stopBulbs(); bulbTimer = setInterval(() => { if (!spinning){ bulbPhase ^= 1; drawWheel(); } }, 600); }
function stopBulbs(){ clearInterval(bulbTimer); bulbTimer = null; }

function renderChips(){
  const items = rList();
  $('#rChips').innerHTML = items.map((t,i) => `<span class="ritem" style="--ic:${segColor(i,items.length)}">${esc(t)}<button data-del="${i}" aria-label="Quitar">×</button></span>`).join('');
  $$('#rChips [data-del]').forEach(b => b.addEventListener('click', () => { rList().splice(+b.dataset.del,1); saveR(); renderChips(); drawWheel(); hapticTap(); }));
  $('#rCount').textContent = `${items.length} opciones`;
}
function addItem(){
  const inp = $('#rInput'), v = inp.value.trim(); if (!v) return;
  if (rList().length >= 20) return toast('Máximo 20 opciones');
  rList().push(v); inp.value = ''; saveR(); renderChips(); drawWheel(); hapticTap();
}
$('#rAdd').addEventListener('click', addItem);
$('#rInput').addEventListener('keydown', e => { if (e.key === 'Enter'){ addItem(); e.target.blur(); } });
$('#rRestore').addEventListener('click', async () => { if (await confirmDlg('¿Restaurar ruleta?', `Volverán las opciones originales de ${R_META[rMode].label.toLowerCase()}.`, 'RESTAURAR')){ rLists[rMode] = R_DEFAULTS[rMode].slice(); saveR(); renderChips(); drawWheel(); } });
function placePill(){ const idx = Object.keys(R_META).indexOf(rMode), w = ($('#rTabs').clientWidth - 8)/3; if (w > 0){ $('#rPill').style.width = w + 'px'; $('#rPill').style.transform = `translateX(${idx*w}px)`; } }
function setMode(m){
  if (spinning) return;
  rMode = m; const idx = Object.keys(R_META).indexOf(m);
  $$('#rTabs button').forEach(b => b.classList.toggle('on', b.dataset.r === m));
  const pill = $('#rPill'), w = ($('#rTabs').clientWidth - 8)/3;
  pill.style.width = w + 'px'; pill.style.transform = `translateX(${idx*w}px)`;
  $('#roulette').style.setProperty('--tabc', R_META[m].color);
  document.documentElement.style.setProperty('--tabc', R_META[m].color);
  renderChips(); drawWheel();
  $('#rLast').textContent = 'Toca GIRAR o desliza la ruleta';
}
$$('#rTabs button').forEach(b => b.addEventListener('click', () => { hapticTap(); setMode(b.dataset.r); }));

/* =========================================================
   10. EXTRAS: CONFETI, TOAST, CONFIRMACIÓN
   ========================================================= */
const cf = $('#confetti'), cfx = cf.getContext('2d'); let parts = [], cfRun = false;
function confetti(color){
  const W = cf.width = innerWidth*dpr, H = cf.height = innerHeight*dpr;
  const cols = color ? [color,'#ffffff','#d8c06e', color] : ['#d98585','#7fb38a','#d8c06e','#7f9bd6','#d08aa8','#ffffff'];
  for (let i=0;i<140;i++) parts.push({ x: W/2, y: H*0.42, vx:(Math.random()-0.5)*16*dpr, vy:(-Math.random()*16-4)*dpr, s:(Math.random()*6+4)*dpr, r:Math.random()*6, vr:(Math.random()-0.5)*0.4, c: cols[i%cols.length], life: 1 });
  if (!cfRun){ cfRun = true; requestAnimationFrame(cfStep); }
}
function cfStep(){
  cfx.clearRect(0,0,cf.width,cf.height);
  parts.forEach(p => { p.vy += 0.45*dpr; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 0.007;
    cfx.save(); cfx.globalAlpha = Math.max(0,p.life); cfx.translate(p.x,p.y); cfx.rotate(p.r); cfx.fillStyle = p.c; cfx.fillRect(-p.s/2,-p.s/4,p.s,p.s/2); cfx.restore(); });
  parts = parts.filter(p => p.life > 0 && p.y < cf.height + 40);
  if (parts.length) requestAnimationFrame(cfStep); else { cfRun = false; cfx.clearRect(0,0,cf.width,cf.height); }
}
let toastT = null;
function toast(msg){ const t = $('#toast'); t.textContent = TT(String(msg)); t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1900); }
let cfResolve = null;
function confirmDlg(title, msg, yes='SÍ'){
  $('#cfTitle').textContent = title; $('#cfMsg').textContent = msg; $('#cfYes').textContent = yes;
  $('#confirmModal').classList.add('show');
  return new Promise(res => cfResolve = res);
}
function closeConfirm(v){ $('#confirmModal').classList.remove('show'); if (cfResolve){ const r = cfResolve; cfResolve = null; r(v); } }
$('#cfYes').addEventListener('click', () => closeConfirm(true));
$('#cfNo').addEventListener('click', () => closeConfirm(false));
$('#confirmModal').addEventListener('click', e => { if (e.target.id === 'confirmModal') closeConfirm(false); });
$('#resultModal').addEventListener('click', e => { if (e.target.id === 'resultModal') closeResult(); });

/* =========================================================
   10b. MODOS DE USO, CALENDARIO, CLASES, CALENTAMIENTOS
   ========================================================= */
const pad2 = n => String(n).padStart(2,'0');
const iso = d => d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
const todayISO = () => iso(new Date());
const parseISO = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const WD = ['D','L','M','X','J','V','S'];
const WD_LONG = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
// Nombres de meses y días en el idioma de la app
if (SF_LG !== 'es'){
  for (let i = 0; i < 12; i++){ const t = new Date(2024, i, 1).toLocaleDateString(LOCALE, { month: 'long' }); MONTHS[i] = t.charAt(0).toUpperCase() + t.slice(1); }
  for (let i = 0; i < 7; i++){ const d = new Date(2024, 0, 7 + i), l = d.toLocaleDateString(LOCALE, { weekday: 'long' }); WD_LONG[i] = l.charAt(0).toUpperCase() + l.slice(1); WD[i] = WD_LONG[i].charAt(0); }
}
const niceDate = s => { const d = parseISO(s);
  if (SF_LG !== 'es'){ const t = d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); }
  return `${WD_LONG[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()].toLowerCase()}`; };
const shortDate = s => { const d = parseISO(s); return SF_LG === 'en' ? `${pad2(d.getMonth()+1)}/${pad2(d.getDate())}` : `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);

/* ---- Datos ---- */
const DEFAULT_WARMUPS = [
  { id:'wg', name:'Calentamiento general', color:'#dc9a6e', items:[
    {n:'Saltar lazo',s:120},{n:'Movilidad articular',s:60},{n:'Jumping jacks',s:45},{n:'Rodillas arriba',s:30},{n:'Sombra suave',s:120},{n:'Estiramiento dinámico',s:60},{n:'Desplazamientos',s:45}] },
  { id:'wr', name:'Activación rápida', color:'#7fb38a', items:[
    {n:'Trote en el sitio',s:60},{n:'Rotación de hombros',s:30},{n:'Sentadillas',s:30},{n:'Burpees',s:30},{n:'Sombra rápida',s:60}] },
  { id:'wt', name:'Técnico con sombra', color:'#7f9bd6', items:[
    {n:'Guardia y desplazamientos',s:60},{n:'Solo jab',s:60},{n:'Combinación 1-2',s:60},{n:'Esquivas y bloqueos',s:60},{n:'Combos libres',s:90}] },
];
const EV_TYPES = {
  personal: [['entreno','Entreno','#7fb38a'],['competencia','Competencia','#d6a660'],['cita','Cita','#7f9bd6'],['otro','Otro','#71717a']],
};
const evColor = (mode, type) => (EV_TYPES[mode].find(t => t[0] === type) || EV_TYPES[mode][EV_TYPES[mode].length-1])[2];
const evLabel = (mode, type) => (EV_TYPES[mode].find(t => t[0] === type) || ['','Otro'])[1];

let events = { personal: load('events_personal', []) };
let sessLog = load('history', []);           // entrenos completados (timer, sesiones, pesas, cardio, a mano)
let bhWarmups = load('bh_warmups', null) || JSON.parse(JSON.stringify(DEFAULT_WARMUPS));   // calentamientos
const saveEvents = () => save('events_personal', events.personal);
const saveBH = () => save('bh_warmups', bhWarmups);
const calMode = () => 'personal';
const warmTotal = w => w.items.reduce((a,b) => a + b.s, 0);

/* ---- Inicio según el modo ---- */
function nextEvent(mode){
  const t = todayISO();
  return events[mode].filter(e => e.date >= t).sort((a,b) => (a.date + (a.time||'')).localeCompare(b.date + (b.time||'')))[0];
}

/* ---- Pasos genéricos (+/−) ---- */
function makeStepper(el, cfg){
  // cfg.input = true → el número también se puede escribir a mano
  el.innerHTML = `<button type="button" data-d="-1">−</button>${cfg.input ? `<input class="numin" inputmode="decimal" enterkeyhint="done" aria-label="${cfg.label || 'Valor'}">` : '<output></output>'}<button type="button" data-d="1">+</button>`;
  const out = el.querySelector(cfg.input ? 'input' : 'output');
  const paint = () => { const t = (cfg.fmt || (v => v))(cfg.get()); if (cfg.input){ if (document.activeElement !== out) out.value = t; } else out.textContent = t; };
  if (cfg.input){
    const commit = () => { const raw = String(out.value).replace(/\s/g,'').replace(',', '.'); const v = parseFloat(raw); if (isFinite(v)){ cfg.set(clamp(v, cfg.min, cfg.max)); cfg.onChange && cfg.onChange(); } out.value = (cfg.fmt || (v => v))(cfg.get()); };
    out.addEventListener('focus', () => setTimeout(() => out.select(), 30));
    out.addEventListener('change', commit); out.addEventListener('blur', commit);
    out.addEventListener('keydown', e => { if (e.key === 'Enter'){ commit(); out.blur(); } });
  }
  el._paint = paint;
  el.querySelectorAll('button').forEach(b => {
    let timer = null, delay = 0;
    const step = () => { if (cfg.input && document.activeElement === out) out.blur(); const d = +b.dataset.d, v = cfg.get(); const st = typeof cfg.step === 'function' ? cfg.step(v, d) : (cfg.step || 1); cfg.set(clamp(v + d*st, cfg.min, cfg.max)); paint(); cfg.onChange && cfg.onChange(); };
    const stop = () => { clearTimeout(timer); timer = null; };
    b.addEventListener('pointerdown', e => { e.preventDefault(); step(); hapticTap(); delay = 420; const rep = () => { step(); delay = Math.max(60, delay*0.8); timer = setTimeout(rep, delay); }; timer = setTimeout(rep, delay); });
    ['pointerup','pointerleave','pointercancel'].forEach(ev => b.addEventListener(ev, stop));
  });
  paint();
}
const secStep = (v, d) => { const base = d > 0 ? v : v - 1; return base < 60 ? 5 : base < 300 ? 15 : 30; };

/* ---- Modal de formularios ---- */
function openForm(html, onReady){
  $('#formSheet').innerHTML = html; $('#formModal').classList.add('show');
  $('#formSheet').scrollTop = 0; onReady && onReady($('#formSheet'));
}
function closeForm(){ $('#formModal').classList.remove('show'); }
$('#formModal').addEventListener('click', e => { if (e.target.id === 'formModal') closeForm(); });

/* =========================================================
   CALENDARIO
   ========================================================= */
let calYM = (() => { const d = new Date(); return [d.getFullYear(), d.getMonth()]; })();
let calSel = todayISO();
$('#calPrev').addEventListener('click', () => { let [y,m] = calYM; m--; if (m<0){m=11;y--;} calYM=[y,m]; renderCalendar(); });
$('#calNext').addEventListener('click', () => { let [y,m] = calYM; m++; if (m>11){m=0;y++;} calYM=[y,m]; renderCalendar(); });
$('#calToday').addEventListener('click', () => { const d = new Date(); calYM = [d.getFullYear(), d.getMonth()]; calSel = todayISO(); renderCalendar(); });
$('#calAdd').addEventListener('click', () => openEventForm(null));

function openEventForm(id){
  const mode = calMode(), src = id ? events[mode].find(e => e.id === id) : null;
  const ev = src ? Object.assign({}, src) : { id: uid(), title:'', type: EV_TYPES[mode][0][0], date: calSel, time:'', participants:0, athletes:'', notes:'' };
  openForm(`
    <h3 class="ftitle">${src ? 'EDITAR EVENTO' : 'NUEVO EVENTO'}</h3>
    <label class="field"><span>Nombre</span><input id="fTitle" maxlength="40" placeholder="Ej: Sparring con Juan" value="${esc(ev.title)}"></label>
    <div class="field"><span>Tipo</span><div class="typechips">${EV_TYPES[mode].map(t => `<button type="button" data-type="${t[0]}" style="--c:${t[2]}" class="${ev.type===t[0]?'on':''}">${t[1]}</button>`).join('')}</div></div>
    <div class="frow"><label class="field"><span>Fecha</span><input type="date" id="fDate" value="${ev.date}"></label><label class="field"><span>Hora</span><input type="time" id="fTime" value="${ev.time}"></label></div>
    <div class="field"><span>Número de participantes</span><div class="stepper" id="fPart"></div></div>
    <label class="field"><span>Deportistas (uno por línea, opcional)</span><textarea id="fAth" rows="3" placeholder="Ana Gómez&#10;Carlos Ruiz">${esc(ev.athletes)}</textarea></label>
    <label class="field"><span>Notas</span><textarea id="fNotes" rows="2" placeholder="Lugar, categorías, lo que haga falta…">${esc(ev.notes)}</textarea></label>
    <div class="btnrow">${src ? '<button class="btn" id="fDel" style="color:#dc9696">BORRAR</button>' : '<button class="btn" id="fCancel">CANCELAR</button>'}<button class="btn pri" id="fSave">GUARDAR</button></div>`, sh => {
    makeStepper(sh.querySelector('#fPart'), { get:() => ev.participants, set:v => ev.participants = v, min:0, max:500 });
    sh.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { ev.type = b.dataset.type; sh.querySelectorAll('[data-type]').forEach(x => x.classList.toggle('on', x === b)); }));
    // al escribir nombres, sugiere el número de participantes
    sh.querySelector('#fAth').addEventListener('input', e => { const n = e.target.value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length; if (n > ev.participants){ ev.participants = n; sh.querySelector('#fPart output').textContent = n; } });
    sh.querySelector('#fSave').addEventListener('click', () => {
      ev.title = sh.querySelector('#fTitle').value.trim() || evLabel(mode, ev.type);
      ev.date = sh.querySelector('#fDate').value || calSel; ev.time = sh.querySelector('#fTime').value;
      ev.athletes = sh.querySelector('#fAth').value.trim(); ev.notes = sh.querySelector('#fNotes').value.trim();
      const i = events[mode].findIndex(e => e.id === ev.id); if (i >= 0) events[mode][i] = ev; else events[mode].push(ev);
      saveEvents(); closeForm(); calSel = ev.date; const d = parseISO(ev.date); calYM = [d.getFullYear(), d.getMonth()]; renderCalendar(); toast('Evento guardado');
    });
    const del = sh.querySelector('#fDel'); if (del) del.addEventListener('click', async () => { closeForm(); if (await confirmDlg('¿Borrar evento?', `Se eliminará “${ev.title}”.`, 'BORRAR')){ events[mode] = events[mode].filter(e => e.id !== ev.id); saveEvents(); renderCalendar(); } });
    const cn = sh.querySelector('#fCancel'); if (cn) cn.addEventListener('click', closeForm);
  });
}

/* =========================================================
   BOX HOUSE: CALENTAMIENTOS (lista, editor y reproductor)
   ========================================================= */
let editingWarm = null, playReturn = 'warmups';
function renderWarmups(){
  $('#warmList').innerHTML = bhWarmups.map((w,i) => `
    <div class="wcard" style="--c:${w.color};--i:${i}">
      <button class="wmain" data-we="${w.id}"><b>${esc(w.name)}</b><small>${w.items.length} ejercicios · ${fmt(warmTotal(w))}</small>
        <span class="wbar">${w.items.map(it => `<i style="flex:${it.s}"></i>`).join('')}</span></button>
      <button class="wplay" data-wp="${w.id}" aria-label="Iniciar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.7L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg></button>
    </div>`).join('') || '<p class="empty">Sin calentamientos. Crea uno.</p>';
  $$('#warmList [data-we]').forEach(b => b.addEventListener('click', () => { editingWarm = bhWarmups.find(w => w.id === b.dataset.we); go('warmupEdit'); }));
  $$('#warmList [data-wp]').forEach(b => b.addEventListener('click', () => { playReturn = 'warmups'; startWarmup(b.dataset.wp); }));
}
$('#warmNew').addEventListener('click', () => { const w = { id: uid(), name:'Nuevo calentamiento', color:'#dc9a6e', items:[{n:'Saltar lazo',s:60},{n:'Sombra',s:60}] }; bhWarmups.push(w); saveBH(); editingWarm = w; go('warmupEdit'); });
function renderWarmEdit(){
  const w = editingWarm; if (!w) return;
  const body = $('#warmEditBody');
  body.innerHTML = `
    <div class="preview" style="--c:${w.color}"><div class="ic">🔥</div><div style="flex:1;min-width:0"><input id="wName" maxlength="30" value="${esc(w.name)}"><small id="wSum"></small></div></div>
    <div class="sect"><h4>COLOR</h4><div class="swatches">${COLORS.map(c => `<button style="--s:${c}" data-wc="${c}" class="${c===w.color?'on':''}"></button>`).join('')}</div></div>
    <div class="sect"><h4>EJERCICIOS</h4><div id="wItems"></div>
      <div class="addrow" style="padding:10px 0 12px"><input id="wIn" maxlength="40" placeholder="Agregar ejercicio…" enterkeyhint="done"><button id="wAdd" style="--tabc:${w.color}">+</button></div></div>
    <div class="btnrow" style="margin-bottom:8px"><button class="btn" id="wDel" style="color:#dc9696">ELIMINAR</button><button class="btn pri" id="wPlay" style="--bc:${w.color}">▶ PROBAR</button></div>`;
  const sv = () => { saveBH(); body.querySelector('#wSum').textContent = `${w.items.length} ejercicios · ${fmt(warmTotal(w))}`; };
  body.querySelector('#wName').addEventListener('input', e => { w.name = e.target.value || 'Calentamiento'; saveBH(); });
  body.querySelectorAll('[data-wc]').forEach(b => b.addEventListener('click', () => { w.color = b.dataset.wc; saveBH(); renderWarmEdit(); }));
  const draw = () => {
    const el = body.querySelector('#wItems');
    el.innerHTML = w.items.map((it,i) => `<div class="row blk"><span class="num" style="background:${w.color}">${i+1}</span><span class="l"><b>${esc(it.n)}</b></span><div class="stepper sm" data-wi="${i}"></div><button class="xbtn" data-wr="${i}">×</button></div>`).join('') || '<p class="empty">Agrega ejercicios abajo.</p>';
    el.querySelectorAll('[data-wi]').forEach(st => { const i = +st.dataset.wi; makeStepper(st, { get:() => w.items[i].s, set:v => w.items[i].s = v, min:5, max:600, step:secStep, fmt:v => fmtShort(v), onChange:sv }); });
    el.querySelectorAll('[data-wr]').forEach(b => b.addEventListener('click', () => { w.items.splice(+b.dataset.wr, 1); sv(); draw(); }));
    sv();
  };
  draw();
  const add = () => { const inp = body.querySelector('#wIn'), v = inp.value.trim(); if (!v) return; w.items.push({ n:v, s:45 }); inp.value = ''; draw(); };
  body.querySelector('#wAdd').addEventListener('click', add);
  body.querySelector('#wIn').addEventListener('keydown', e => { if (e.key === 'Enter'){ add(); e.target.blur(); } });
  body.querySelector('#wPlay').addEventListener('click', () => { playReturn = 'warmupEdit'; startWarmup(w.id); });
  body.querySelector('#wDel').addEventListener('click', async () => { if (await confirmDlg('¿Eliminar?', `Se borrará “${w.name}”.`, 'ELIMINAR')){ bhWarmups = bhWarmups.filter(x => x.id !== w.id); saveBH(); go('warmups', true); } });
}

/* Reproductor de calentamiento */
const W = { w:null, idx:0, endAt:0, remMs:0, paused:false, on:false, lastSec:-1, label:'', opts:{} };
function startWarmup(id, label){
  const w = bhWarmups.find(x => x.id === id); if (!w || !w.items.length) return toast('Este calentamiento no tiene ejercicios');
  startPlayer(w, label, {});
}
function startPlayer(w, label, opts){
  audio(); W.w = w; W.opts = opts || {}; W.idx = 0; W.paused = false; W.on = true; W.label = label || ''; W.lastSec = -1;
  W.spent = 0; W.workSpent = 0; W.rounds = 0;
  W.endAt = Date.now() + w.items[0].s*1000; Sound.bell(1); keepAwake(true);
  $('#wpDone').classList.remove('show');
  go('warmupPlay'); renderWarmPlay(true);
}
// Suma lo que de verdad se hizo del ejercicio actual (si se salta, solo los segundos que se alcanzaron a hacer)
function warmCredit(sec, full){
  const it = W.w.items[W.idx]; if (!it) return;
  sec = Math.max(0, Math.min(it.s, sec)); W.spent += sec;
  if (!it.rest){ W.workSpent += sec; if (full || sec >= it.s / 2) W.rounds++; }
}
function warmGoto(i){
  const w = W.w;
  if (i > W.idx){ const ms = W.paused ? W.remMs : Math.max(0, W.endAt - Date.now()); warmCredit(w.items[W.idx].s - ms/1000, false); }
  if (i >= w.items.length) return warmFinish(); if (i < 0) i = 0;
  W.idx = i; W.lastSec = -1; const ms = w.items[i].s*1000;
  if (W.paused) W.remMs = ms; else W.endAt = Date.now() + ms;
  Sound.bell(1); vibrate([150]); renderWarmPlay(true);
}
function warmFinish(){
  W.on = false; W.paused = false; keepAwake(false); Sound.win(); vibrate([300,100,300]); confetti(W.w.color);
  $('#wpDoneTitle').innerHTML = W.opts.doneTitle || '¡CALENTAMIENTO<br>LISTO!';
  $('#wpDoneSub').textContent = W.opts.doneSub || 'Cuerpo activado. A entrenar.';
  $('#wpDoneIcon').textContent = W.opts.doneIcon || '🔥';
  if (W.opts.onFinish) W.opts.onFinish();
  else if (saving() && W.spent >= 30){ const sec = Math.round(W.spent); logTrain({ p: W.w.name, m: Math.max(1, Math.round(sec/60)), t: 'box', a: 'warm', manual: true }); stats.sessions++; stats.trainSec = (stats.trainSec || 0) + sec; save('stats', stats); }
  $('#wpDoneNext').textContent = 'LISTO';
  $('#wpDone').classList.add('show');
}
function warmTick(){
  if (!W.on || current !== 'warmupPlay') return;
  if (!W.paused){
    let g = 0; QUIET = Date.now() - W.endAt > 1500;
    try { while (W.on && Date.now() >= W.endAt && g++ < 50){ const nextAt = W.endAt; warmCredit(W.w.items[W.idx].s, true); if (W.idx + 1 >= W.w.items.length){ warmFinish(); break; } W.idx++; W.lastSec = -1; W.endAt = nextAt + W.w.items[W.idx].s*1000; Sound.bell(1); vibrate([150]); } } finally { QUIET = false; }
    const sec = Math.ceil(Math.max(0, W.endAt - Date.now())/1000);
    if (W.on && sec !== W.lastSec){ W.lastSec = sec; if (sec <= 3 && sec >= 1 && S.countdown) Sound.beep(false); }
  }
  renderWarmPlay();
}
setInterval(warmTick, 200);
function renderWarmPlay(force){
  const w = W.w; if (!w) return;
  const it = w.items[W.idx], ms = W.paused ? W.remMs : Math.max(0, W.endAt - Date.now());
  const view = $('#warmupPlay'); view.style.setProperty('--c', it.c || w.color);
  $('#wpLabel').textContent = (W.label ? W.label + ' · ' : '') + w.name;
  if (force || $('#wpName').dataset.i !== String(W.idx)){
    $('#wpName').dataset.i = W.idx; $('#wpName').textContent = it.n;
    $('#wpDesc').textContent = it.d || ''; $('#wpDesc').style.display = it.d ? '' : 'none';
    const el = $('#wpName'); el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
    $('#wpSteps').innerHTML = w.items.map((x,i) => `<i class="${i<W.idx?'done':i===W.idx?'cur':''}"></i>`).join('');
    $('#wpNext').textContent = w.items[W.idx+1] ? `Siguiente: ${w.items[W.idx+1].n} · ${fmtShort(w.items[W.idx+1].s)}` : 'Último ejercicio';
  }
  $('#wpTime').textContent = fmt(Math.ceil(ms/1000));
  $('#wpCount').textContent = `${W.idx+1} / ${w.items.length}`;
  const prog = 1 - ms/(it.s*1000);
  $('#wpRing').style.strokeDashoffset = (RING_C*prog).toFixed(1);
  $('#wpPause').innerHTML = W.paused ? '<path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.7L9.5 4.6A1 1 0 0 0 8 5.5z"/>' : '<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>';
}
$('#wpToggle').addEventListener('click', () => { if (!W.on) return; if (W.paused){ W.endAt = Date.now() + W.remMs; W.paused = false; keepAwake(true); } else { W.remMs = Math.max(0, W.endAt - Date.now()); W.paused = true; keepAwake(false); } hapticTap(); renderWarmPlay(true); });
$('#wpSkip').addEventListener('click', () => W.on && warmGoto(W.idx + 1));
$('#wpPrev').addEventListener('click', () => W.on && warmGoto(W.idx - 1));
$('#wpClose').addEventListener('click', () => exitWarmup());
$('#wpDoneNext').addEventListener('click', () => { $('#wpDone').classList.remove('show'); go(playReturn, true); });
function exitWarmup(){ W.on = false; keepAwake(isActive() && !T.paused); go(playReturn, true); }

/* =========================================================
   10c. PERSONAL: CONTROL DE PESO Y MIS SESIONES DE BOXEO
   ========================================================= */
/* ---- Catálogo de ejercicios de boxeo ---- */
const DRILLS = {
  escuelita:  { n:'Escuelita de boxeo', ic:'🥊', c:'#d98585', d:'Fundamentos: guardia, postura, jab y cross frente al espejo.', cues:['Mentón abajo, manos arriba','Pies a la anchura de los hombros','Regresa la mano a la guardia','Gira la cadera en el cross','Codos pegados al cuerpo'] },
  combos:     { n:'Combos', ic:'👊', c:'#dc9a6e', d:'Encadena golpes con técnica y velocidad.', combos:true },
  pasosL:     { n:'Pasos en L', ic:'📐', c:'#cdb262', d:'Paso al frente y salida lateral formando una L para cambiar el ángulo.', cues:['Adelante con el pie delantero, luego sal al lado','Nunca cruces los pies','Termina en guardia, listo para golpear','Alterna salida izquierda y derecha'] },
  pasosV:     { n:'Pasos en V', ic:'✌️', c:'#7fb38a', d:'Salidas en diagonal adelante-afuera y regreso al centro, dibujando una V.', cues:['Diagonal izquierda, regresa al centro','Diagonal derecha, regresa al centro','Peso en la punta de los pies','Mantén la guardia alta en cada salida'] },
  laterales:  { n:'Pasos laterales', ic:'↔️', c:'#6fb0b6', d:'Desplazamiento lateral sin cruzar los pies, manteniendo la guardia.', cues:['Mueve primero el pie del lado hacia donde vas','Pasos cortos y rápidos','No juntes los pies','Mirada al frente'] },
  adelante:   { n:'Adelante y atrás', ic:'↕️', c:'#7f9bd6', d:'Entradas y salidas en línea recta con pasos cortos.', cues:['Empuja con el pie de atrás para entrar','Empuja con el pie de adelante para salir','Entra con jab, sal con guardia'] },
  pivotes:    { n:'Pivotes', ic:'🔄', c:'#8f8fd2', d:'Gira sobre el pie delantero para salir de la línea de ataque.', cues:['Pivota sobre la punta del pie delantero','Gira un cuarto de vuelta','Golpea al terminar el giro'] },
  esquivas:   { n:'Esquivas y bloqueos', ic:'🛡️', c:'#9d8fd0', d:'Slip, rolling y bloqueos con los antebrazos.', cues:['Slip: mueve la cabeza fuera de la línea','Rolling: flexiona rodillas, dibuja una U','Bloquea y contraataca','Ojos siempre al frente'] },
  sombra:     { n:'Sombra', ic:'👤', c:'#ad95d6', d:'Boxeo libre contra un rival imaginario: golpes, defensa y pies.', cues:['Combina golpes y desplazamientos','Imagina a tu rival','Respira al golpear'] },
  saco:       { n:'Saco', ic:'💥', c:'#d08aa8', d:'Potencia y combinaciones sobre el saco.', cues:['Golpea y muévete','Combinaciones de 3 a 4 golpes','Gira el puño al impactar','No te quedes quieto frente al saco'] },
  manoplas:   { n:'Manoplas', ic:'🎯', c:'#c79bd0', d:'Precisión y reacción con tu compañero o entrenador.', cues:['Golpea al centro de la manopla','Reacciona rápido a la señal','Vuelve a la guardia'] },
  soga:       { n:'Saltar lazo', ic:'🪢', c:'#6fb39a', d:'Ritmo, coordinación y resistencia.', cues:['Saltos bajos, en la punta de los pies','Muñecas, no brazos','Alterna pies cuando agarres ritmo'] },
  core:       { n:'Core', ic:'🔥', c:'#d6a660', d:'Abdomen y zona media para aguantar y golpear más fuerte.', cues:['Plancha firme','Giros rusos','Abdominales bicicleta','Aprieta el abdomen'] },
  estira:     { n:'Estiramiento', ic:'🧘', c:'#64748b', d:'Baja pulsaciones y estira hombros, espalda y piernas.', cues:['Respira lento y profundo','Mantén cada estiramiento 20 s','Sin rebotes'] },
};
const LEVELS = { principiante:{ n:'Principiante', s:90, rest:45 }, intermedio:{ n:'Intermedio', s:120, rest:45 }, avanzado:{ n:'Avanzado', s:180, rest:60 } };
const DEFAULT_PSESSIONS = [
  { id:'ps1', name:'Técnica de pies', color:'#6fb0b6', level:'principiante', goal:'Moverme mejor y no cruzar los pies',
    blocks:[{k:'soga',s:120,r:1,rest:30},{k:'escuelita',s:90,r:2,rest:30},{k:'pasosL',s:90,r:2,rest:30},{k:'pasosV',s:90,r:2,rest:30},{k:'laterales',s:90,r:2,rest:30},{k:'estira',s:120,r:1,rest:0}] },
  { id:'ps2', name:'Combos y saco', color:'#dc9a6e', level:'intermedio', goal:'Velocidad y potencia',
    blocks:[{k:'sombra',s:120,r:2,rest:30},{k:'combos',s:120,r:3,rest:45},{k:'saco',s:180,r:3,rest:60},{k:'core',s:120,r:1,rest:0}] },
];
let pSessions = load('psessions', null) || JSON.parse(JSON.stringify(DEFAULT_PSESSIONS));
let weights = load('weights', []);           // [{id,date,kg}]
let wGoal = load('weight_goal', 0);
const savePS = () => save('psessions', pSessions);
const saveW = () => { save('weights', weights); save('weight_goal', wGoal); };
const blockWork = b => b.s * b.r;
const psTotal = ps => ps.blocks.reduce((a,b,i) => a + b.s*b.r + b.rest*Math.max(0, b.r - 1) + (i < ps.blocks.length-1 ? b.rest : 0), 0);
const psWork = ps => ps.blocks.reduce((a,b) => a + blockWork(b), 0);
const lastWeight = () => weights.slice().sort((a,b) => a.date.localeCompare(b.date)).slice(-1)[0];

/* ---- Inicio personal: accesos ---- */
/* =========================================================
   MIS SESIONES (preparar clase personal)
   ========================================================= */
let editingPS = null;
function renderPSessions(){
  $('#psList').innerHTML = pSessions.map((ps,i) => `
    <div class="wcard" style="--c:${ps.color};--i:${i}">
      <button class="wmain" data-pse="${ps.id}"><b>${esc(ps.name)}</b>
        <small>${LEVELS[ps.level]?.n || ''} · ${ps.blocks.length} ejercicios · ${fmt(psTotal(ps))}</small>
        <span class="drillrow">${ps.blocks.map(b => `<i title="${esc(DRILLS[b.k]?.n||'')}">${DRILLS[b.k]?.ic || '•'}</i>`).join('')}</span>
        ${ps.goal ? `<small class="goal">🎯 ${esc(ps.goal)}</small>` : ''}</button>
      <button class="wplay" data-psp="${ps.id}" aria-label="Entrenar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.7L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg></button>
    </div>`).join('') || '<p class="empty">Prepara tu primera sesión.</p>';
  $$('#psList [data-pse]').forEach(b => b.addEventListener('click', () => { editingPS = pSessions.find(x => x.id === b.dataset.pse); go('psessionEdit'); }));
  $$('#psList [data-psp]').forEach(b => b.addEventListener('click', () => playPSession(b.dataset.psp, 'psessions')));
}
$('#psNew').addEventListener('click', () => {
  const ps = { id: uid(), name:'Mi sesión', color:'#d98585', level:'principiante', goal:'', blocks:[] };
  pSessions.push(ps); savePS(); editingPS = ps; go('psessionEdit'); setTimeout(openDrillPicker, 350);
});
function renderPSEdit(){
  const ps = editingPS; if (!ps) return;
  const body = $('#psEditBody');
  body.innerHTML = `
    <div class="preview" style="--c:${ps.color}"><div class="ic">🥊</div><div style="flex:1;min-width:0"><input id="psName" maxlength="30" value="${esc(ps.name)}"><small id="psSum"></small></div></div>
    <div class="sect"><h4>MI NIVEL</h4><div class="typechips" style="padding-bottom:12px">${Object.entries(LEVELS).map(([k,v]) => `<button type="button" data-lv="${k}" class="${ps.level===k?'on':''}" style="--c:${ps.color}">${v.n}</button>`).join('')}</div>
      <label class="field" style="padding-bottom:6px"><span>Mi objetivo</span><input id="psGoal" maxlength="60" placeholder="Ej: mejorar la defensa, bajar de peso…" value="${esc(ps.goal)}"></label></div>
    <div class="sect"><h4>EJERCICIOS DE LA SESIÓN</h4><div id="psBlocks"></div>
      <button class="btn" id="psAddDrill" style="width:100%;margin:10px 0 12px;border-style:dashed">+ AGREGAR EJERCICIO DE BOXEO</button></div>
    <div class="sect"><h4>COLOR</h4><div class="swatches">${COLORS.map(c => `<button style="--s:${c}" data-psc="${c}" class="${c===ps.color?'on':''}"></button>`).join('')}</div></div>
    <div class="btnrow" style="margin-bottom:8px"><button class="btn" id="psDel" style="color:#dc9696">ELIMINAR</button><button class="btn pri" id="psPlay" style="--bc:${ps.color}">▶ ENTRENAR</button></div>`;
  const sum = () => { body.querySelector('#psSum').textContent = `${ps.blocks.length} ejercicios · ${fmt(psTotal(ps))} · ${Math.round(psWork(ps)/60)} min de trabajo`; savePS(); };
  body.querySelector('#psName').addEventListener('input', e => { ps.name = e.target.value || 'Mi sesión'; savePS(); });
  body.querySelector('#psGoal').addEventListener('input', e => { ps.goal = e.target.value; savePS(); });
  body.querySelectorAll('[data-lv]').forEach(b => b.addEventListener('click', () => { ps.level = b.dataset.lv; body.querySelectorAll('[data-lv]').forEach(x => x.classList.toggle('on', x === b)); savePS(); hapticTap(); }));
  body.querySelectorAll('[data-psc]').forEach(b => b.addEventListener('click', () => { ps.color = b.dataset.psc; savePS(); renderPSEdit(); }));
  const draw = () => {
    const el = body.querySelector('#psBlocks');
    el.innerHTML = ps.blocks.map((b,i) => { const d = DRILLS[b.k] || { n:b.k, ic:'•', c:'#71717a', d:'' }; return `
      <div class="drillblk" style="--c:${d.c}">
        <div class="dbtop"><span class="dic">${d.ic}</span><span class="l"><b>${esc(d.n)}</b><small>${esc(d.d)}</small></span>
          <span class="dbord"><button data-up="${i}" ${i===0?'disabled':''}>▲</button><button data-dn="${i}" ${i===ps.blocks.length-1?'disabled':''}>▼</button></span><button class="xbtn" data-rm="${i}">×</button></div>
        <div class="dbctl"><div><small>Rounds</small><div class="stepper sm" data-st="r" data-i="${i}"></div></div><div><small>Tiempo</small><div class="stepper sm" data-st="s" data-i="${i}"></div></div><div><small>Descanso</small><div class="stepper sm" data-st="rest" data-i="${i}"></div></div></div>
      </div>`; }).join('') || '<p class="empty">Agrega ejercicios: escuelita, combos, pasos en L, en V, laterales…</p>';
    el.querySelectorAll('[data-st]').forEach(st => { const i = +st.dataset.i, k = st.dataset.st;
      const cfg = k === 'r' ? { min:1, max:20, step:1 } : k === 's' ? { min:10, max:900, step:secStep, fmt:v => v < 60 ? v + 's' : fmt(v).replace(/^0/,'') } : { min:0, max:300, step:(v,d) => 15, fmt:v => v ? fmtShort(v) : '—' };
      makeStepper(st, Object.assign(cfg, { get:() => ps.blocks[i][k], set:v => ps.blocks[i][k] = v, onChange:sum })); });
    el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { ps.blocks.splice(+b.dataset.rm, 1); draw(); }));
    el.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.up; [ps.blocks[i-1], ps.blocks[i]] = [ps.blocks[i], ps.blocks[i-1]]; draw(); }));
    el.querySelectorAll('[data-dn]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.dn; [ps.blocks[i+1], ps.blocks[i]] = [ps.blocks[i], ps.blocks[i+1]]; draw(); }));
    sum();
  };
  draw(); renderPSEdit.redraw = draw;
  body.querySelector('#psAddDrill').addEventListener('click', openDrillPicker);
  body.querySelector('#psPlay').addEventListener('click', () => playPSession(ps.id, 'psessionEdit'));
  body.querySelector('#psDel').addEventListener('click', async () => { if (await confirmDlg('¿Eliminar sesión?', `Se borrará “${ps.name}”.`, 'ELIMINAR')){ pSessions = pSessions.filter(x => x.id !== ps.id); savePS(); go('psessions', true); } });
}
function openDrillPicker(){
  const ps = editingPS; if (!ps) return;
  openForm(`<h3 class="ftitle">EJERCICIOS DE BOXEO</h3><p style="color:var(--muted);margin-bottom:10px">Toca para agregar. Puedes elegir varios.</p>
    <div class="drillgrid">${Object.entries(DRILLS).map(([k,d]) => `<button type="button" class="drillpick" data-dk="${k}" style="--c:${d.c}"><span>${d.ic}</span><b>${d.n}</b><small>${d.d}</small><em></em></button>`).join('')}</div>
    <button class="btn pri" id="dpDone" style="width:100%;margin-top:12px;--bc:${ps.color}">LISTO</button>`, sh => {
    sh.querySelectorAll('[data-dk]').forEach(b => b.addEventListener('click', () => {
      const lv = LEVELS[ps.level] || LEVELS.principiante, k = b.dataset.dk;
      const isFlex = k === 'soga' || k === 'estira' || k === 'core';
      ps.blocks.push({ k, s: isFlex ? 120 : lv.s, r: isFlex ? 1 : 2, rest: isFlex ? 30 : lv.rest });
      savePS(); hapticTap();
      const em = b.querySelector('em'); em.textContent = (+(em.textContent || 0) + 1); b.classList.add('added');
      b.classList.remove('bounce'); void b.offsetWidth; b.classList.add('bounce');
    }));
    sh.querySelector('#dpDone').addEventListener('click', () => { closeForm(); if (current === 'psessionEdit' && renderPSEdit.redraw) renderPSEdit.redraw(); });
  });
}
const _closeForm = closeForm;
closeForm = function(){ _closeForm(); if (current === 'psessionEdit' && renderPSEdit.redraw) renderPSEdit.redraw(); };
function playPSession(id, from){
  const ps = pSessions.find(x => x.id === id); if (!ps) return;
  if (!ps.blocks.length) return toast('Agrega ejercicios a la sesión');
  const combos = (rLists && rLists.combos && rLists.combos.length) ? rLists.combos : R_DEFAULTS.combos;
  const items = [];
  ps.blocks.forEach((b, bi) => {
    const d = DRILLS[b.k] || { n:b.k, c:ps.color, d:'' };
    for (let r = 1; r <= b.r; r++){
      let cue = d.d;
      if (d.combos) cue = 'Combo: ' + combos[Math.floor(Math.random()*combos.length)] + ' · luego ' + combos[Math.floor(Math.random()*combos.length)];
      else if (d.cues) cue = d.cues[(r-1) % d.cues.length];
      items.push({ n: d.n + (b.r > 1 ? ` · ${r}/${b.r}` : ''), s: b.s, c: d.c, d: cue });
      const last = r === b.r && bi === ps.blocks.length - 1;
      if (b.rest > 0 && !last) items.push({ n:'Descanso', rest: true, s: b.rest, c:'#d98585', d: r === b.r && ps.blocks[bi+1] ? 'Prepárate: viene ' + (DRILLS[ps.blocks[bi+1].k]?.n || 'el siguiente') : 'Respira, hidrátate y vuelve a la guardia.' });
    }
  });
  playReturn = from;
  startPlayer({ name: ps.name, color: ps.color, items }, LEVELS[ps.level]?.n || '', {
    kind:'personal', doneIcon:'🏆', doneTitle:'¡SESIÓN<br>COMPLETA!', doneSub:`${ps.name} · ${Math.round(psWork(ps)/60)} min de trabajo`,
    onFinish: () => {
      // Solo cuenta lo que se hizo: los ejercicios saltados no suman
      const work = Math.round(W.workSpent || 0); if (!saving() || work < 30) return;
      stats.sessions++; stats.rounds += W.rounds; stats.workSec += work; save('stats', stats);
      logTrain({ p: ps.name, r: W.rounds, s: work, m: Math.max(1, Math.round(W.spent/60)), t: 'box', a: 'box_session' });
    }
  });
}

/* =========================================================
   CONTROL DE PESO
   ========================================================= */
$('#wtAdd').addEventListener('click', openWeightForm);
$('#wtGoal').addEventListener('click', openGoalForm);

const NAV_PARENT = { timer:'train', traffic:'train', roulette:'train', editor:'train', psessions:'train', psessionEdit:'train', warmups:'train', warmupEdit:'train', weight:'progress', calendar:'progress' };
const BACK_TO = { psessions:'train', psessionEdit:'psessions', weight:'progress', calendar:'progress', warmups:'train', warmupEdit:'warmups' };
const VIEW_RENDER = { psessions: renderPSessions, psessionEdit: renderPSEdit, weight: renderWeight, calendar: renderCalendar, warmups: renderWarmups, warmupEdit: renderWarmEdit };
$$('[data-back]').forEach(b => b.addEventListener('click', () => { hapticTap(); handleBack(); }));



/* =========================================================
   v3 · BASES: DINERO, EDAD, IMC (OMS) Y CATEGORÍAS DE BOXEO
   ========================================================= */
const WHO_BFA={b:[-0.7151,15.2679,0.08366,-0.7387,15.2641,0.0839,-0.7621,15.2616,0.08414,-0.7856,15.2604,0.08439,-0.8089,15.2605,0.08464,-0.8322,15.2619,0.0849,-0.8554,15.2645,0.08516,-0.8785,15.2684,0.08543,-0.9015,15.2737,0.0857,-0.9243,15.2801,0.08597,-0.9471,15.2877,0.08625,-0.9697,15.2965,0.08653,-0.9921,15.3062,0.08682,-1.0144,15.3169,0.08711,-1.0365,15.3285,0.08741,-1.0584,15.3408,0.08771,-1.0801,15.354,0.08802,-1.1017,15.3679,0.08833,-1.123,15.3825,0.08865,-1.1441,15.3978,0.08898,-1.1649,15.4137,0.08931,-1.1856,15.4302,0.08964,-1.206,15.4473,0.08998,-1.2261,15.465,0.09033,-1.246,15.4832,0.09068,-1.2656,15.5019,0.09103,-1.2849,15.521,0.09139,-1.304,15.5407,0.09176,-1.3228,15.5608,0.09213,-1.3414,15.5814,0.09251,-1.3596,15.6023,0.09289,-1.3776,15.6237,0.09327,-1.3953,15.6455,0.09366,-1.4126,15.6677,0.09406,-1.4297,15.6903,0.09445,-1.4464,15.7133,0.09486,-1.4629,15.7368,0.09526,-1.479,15.7606,0.09567,-1.4947,15.7848,0.09609,-1.5101,15.8094,0.09651,-1.5252,15.8344,0.09693,-1.5399,15.8597,0.09735,-1.5542,15.8855,0.09778,-1.5681,15.9116,0.09821,-1.5817,15.9381,0.09864,-1.5948,15.9651,0.09907,-1.6076,15.9925,0.09951,-1.6199,16.0205,0.09994,-1.6318,16.049,0.10038,-1.6433,16.0781,0.10082,-1.6544,16.1078,0.10126,-1.6651,16.1381,0.1017,-1.6753,16.1692,0.10214,-1.6851,16.2009,0.10259,-1.6944,16.2333,0.10303,-1.7032,16.2665,0.10347,-1.7116,16.3004,0.10391,-1.7196,16.3351,0.10435,-1.7271,16.3704,0.10478,-1.7341,16.4065,0.10522,-1.7407,16.4433,0.10566,-1.7468,16.4807,0.10609,-1.7525,16.5189,0.10652,-1.7578,16.5578,0.10695,-1.7626,16.5974,0.10738,-1.767,16.6376,0.1078,-1.771,16.6786,0.10823,-1.7745,16.7203,0.10865,-1.7777,16.7628,0.10906,-1.7804,16.8059,0.10948,-1.7828,16.8497,0.10989,-1.7847,16.8941,0.1103,-1.7862,16.9392,0.1107,-1.7873,16.985,0.1111,-1.7881,17.0314,0.1115,-1.7884,17.0784,0.11189,-1.7884,17.1262,0.11228,-1.788,17.1746,0.11266,-1.7873,17.2236,0.11304,-1.7861,17.2734,0.11342,-1.7846,17.324,0.11379,-1.7828,17.3752,0.11415,-1.7806,17.4272,0.11451,-1.778,17.4799,0.11487,-1.7751,17.5334,0.11522,-1.7719,17.5877,0.11556,-1.7684,17.6427,0.1159,-1.7645,17.6985,0.11623,-1.7604,17.7551,0.11656,-1.7559,17.8124,0.11688,-1.7511,17.8704,0.1172,-1.7461,17.9292,0.11751,-1.7408,17.9887,0.11781,-1.7352,18.0488,0.11811,-1.7293,18.1096,0.11841,-1.7232,18.171,0.11869,-1.7168,18.233,0.11898,-1.7102,18.2955,0.11925,-1.7033,18.3586,0.11952,-1.6962,18.4221,0.11979,-1.6888,18.486,0.12005,-1.6811,18.5502,0.1203,-1.6732,18.6148,0.12055,-1.6651,18.6795,0.12079,-1.6568,18.7445,0.12102,-1.6482,18.8095,0.12125,-1.6394,18.8746,0.12148,-1.6304,18.9398,0.1217,-1.6211,19.005,0.12191,-1.6116,19.0701,0.12212,-1.602,19.1351,0.12233,-1.5921,19.2,0.12253,-1.5821,19.2648,0.12272,-1.5719,19.3294,0.12291,-1.5615,19.3937,0.1231,-1.551,19.4578,0.12328,-1.5403,19.5217,0.12346,-1.5294,19.5853,0.12363,-1.5185,19.6486,0.1238,-1.5074,19.7117,0.12396,-1.4961,19.7744,0.12412,-1.4848,19.8367,0.12428,-1.4733,19.8987,0.12443,-1.4617,19.9603,0.12458,-1.45,20.0215,0.12473,-1.4382,20.0823,0.12487,-1.4263,20.1427,0.12501,-1.4143,20.2026,0.12514,-1.4022,20.2621,0.12528,-1.39,20.3211,0.12541,-1.3777,20.3796,0.12554,-1.3653,20.4376,0.12567,-1.3529,20.4951,0.12579,-1.3403,20.5521,0.12591,-1.3277,20.6085,0.12603,-1.3149,20.6644,0.12615,-1.3021,20.7197,0.12627,-1.2892,20.7745,0.12638,-1.2762,20.8287,0.1265,-1.2631,20.8824,0.12661,-1.2499,20.9355,0.12672,-1.2366,20.9881,0.12683,-1.2233,21.04,0.12694,-1.2098,21.0914,0.12704,-1.1962,21.1423,0.12715,-1.1826,21.1925,0.12726,-1.1688,21.2423,0.12736,-1.155,21.2914,0.12746,-1.141,21.34,0.12756,-1.127,21.388,0.12767,-1.1129,21.4354,0.12777,-1.0986,21.4822,0.12787,-1.0843,21.5285,0.12797,-1.0699,21.5742,0.12807,-1.0553,21.6193,0.12816,-1.0407,21.6638,0.12826,-1.026,21.7077,0.12836,-1.0112,21.751,0.12845,-0.9962,21.7937,0.12855,-0.9812,21.8358,0.12864,-0.9661,21.8773,0.12874,-0.9509,21.9182,0.12883,-0.9356,21.9585,0.12893,-0.9202,21.9982,0.12902,-0.9048,22.0374,0.12911,-0.8892,22.076,0.1292,-0.8735,22.114,0.1293,-0.8578,22.1514,0.12939,-0.8419,22.1883,0.12948,-0.8419,22.1883,0.12948],g:[-0.8702,15.2453,0.09646,-0.8886,15.2441,0.09692,-0.9068,15.2434,0.09738,-0.9248,15.2433,0.09783,-0.9427,15.2438,0.09829,-0.9605,15.2448,0.09875,-0.978,15.2464,0.0992,-0.9954,15.2487,0.09966,-1.0126,15.2516,0.10012,-1.0296,15.2551,0.10058,-1.0464,15.2592,0.10104,-1.063,15.2641,0.10149,-1.0794,15.2697,0.10195,-1.0956,15.276,0.10241,-1.1115,15.2831,0.10287,-1.1272,15.2911,0.10333,-1.1427,15.2998,0.10379,-1.1579,15.3095,0.10425,-1.1728,15.32,0.10471,-1.1875,15.3314,0.10517,-1.2019,15.3439,0.10562,-1.216,15.3572,0.10608,-1.2298,15.3717,0.10654,-1.2433,15.3871,0.107,-1.2565,15.4036,0.10746,-1.2693,15.4211,0.10792,-1.2819,15.4397,0.10837,-1.2941,15.4593,0.10883,-1.306,15.4798,0.10929,-1.3175,15.5014,0.10974,-1.3287,15.524,0.1102,-1.3395,15.5476,0.11065,-1.3499,15.5723,0.1111,-1.36,15.5979,0.11156,-1.3697,15.6246,0.11201,-1.379,15.6523,0.11246,-1.388,15.681,0.11291,-1.3966,15.7107,0.11335,-1.4047,15.7415,0.1138,-1.4125,15.7732,0.11424,-1.4199,15.8058,0.11469,-1.427,15.8394,0.11513,-1.4336,15.8738,0.11557,-1.4398,15.909,0.11601,-1.4456,15.9451,0.11644,-1.4511,15.9818,0.11688,-1.4561,16.0194,0.11731,-1.4607,16.0575,0.11774,-1.465,16.0964,0.11816,-1.4688,16.1358,0.11859,-1.4723,16.1759,0.11901,-1.4753,16.2166,0.11943,-1.478,16.258,0.11985,-1.4803,16.2999,0.12026,-1.4823,16.3425,0.12067,-1.4838,16.3858,0.12108,-1.485,16.4298,0.12148,-1.4859,16.4746,0.12188,-1.4864,16.52,0.12228,-1.4866,16.5663,0.12268,-1.4864,16.6133,0.12307,-1.4859,16.6612,0.12346,-1.4851,16.71,0.12384,-1.4839,16.7595,0.12422,-1.4825,16.81,0.1246,-1.4807,16.8614,0.12497,-1.4787,16.9136,0.12534,-1.4763,16.9667,0.12571,-1.4737,17.0208,0.12607,-1.4708,17.0757,0.12643,-1.4677,17.1316,0.12678,-1.4642,17.1883,0.12713,-1.4606,17.2459,0.12748,-1.4567,17.3044,0.12782,-1.4526,17.3637,0.12816,-1.4482,17.4238,0.12849,-1.4436,17.4847,0.12882,-1.4389,17.5464,0.12914,-1.4339,17.6088,0.12946,-1.4288,17.6719,0.12978,-1.4235,17.7357,0.13009,-1.418,17.8001,0.1304,-1.4123,17.8651,0.1307,-1.4065,17.9306,0.13099,-1.4006,17.9966,0.13129,-1.3945,18.063,0.13158,-1.3883,18.1297,0.13186,-1.3819,18.1967,0.13214,-1.3755,18.2639,0.13241,-1.3689,18.3312,0.13268,-1.3621,18.3986,0.13295,-1.3553,18.466,0.13321,-1.3483,18.5333,0.13347,-1.3413,18.6006,0.13372,-1.3341,18.6677,0.13397,-1.3269,18.7346,0.13421,-1.3195,18.8012,0.13445,-1.3121,18.8675,0.13469,-1.3046,18.9335,0.13492,-1.297,18.9991,0.13514,-1.2894,19.0642,0.13537,-1.2816,19.1289,0.13559,-1.2739,19.1931,0.1358,-1.2661,19.2567,0.13601,-1.2583,19.3197,0.13622,-1.2504,19.382,0.13642,-1.2425,19.4437,0.13662,-1.2345,19.5045,0.13681,-1.2266,19.5647,0.137,-1.2186,19.624,0.13719,-1.2107,19.6824,0.13738,-1.2027,19.74,0.13756,-1.1947,19.7966,0.13774,-1.1867,19.8523,0.13791,-1.1788,19.907,0.13808,-1.1708,19.9607,0.13825,-1.1629,20.0133,0.13841,-1.1549,20.0648,0.13858,-1.147,20.1152,0.13873,-1.139,20.1644,0.13889,-1.1311,20.2125,0.13904,-1.1232,20.2595,0.1392,-1.1153,20.3053,0.13934,-1.1074,20.3499,0.13949,-1.0996,20.3934,0.13963,-1.0917,20.4357,0.13977,-1.0838,20.4769,0.13991,-1.076,20.517,0.14005,-1.0681,20.556,0.14018,-1.0603,20.5938,0.14031,-1.0525,20.6306,0.14044,-1.0447,20.6663,0.14057,-1.0368,20.7008,0.1407,-1.029,20.7344,0.14082,-1.0212,20.7668,0.14094,-1.0134,20.7982,0.14106,-1.0055,20.8286,0.14118,-0.9977,20.858,0.1413,-0.9898,20.8863,0.14142,-0.9819,20.9137,0.14153,-0.974,20.9401,0.14164,-0.9661,20.9656,0.14176,-0.9582,20.9901,0.14187,-0.9503,21.0138,0.14198,-0.9423,21.0367,0.14208,-0.9344,21.0587,0.14219,-0.9264,21.0801,0.1423,-0.9184,21.1007,0.1424,-0.9104,21.1206,0.1425,-0.9024,21.1399,0.14261,-0.8944,21.1586,0.14271,-0.8863,21.1768,0.14281,-0.8783,21.1944,0.14291,-0.8703,21.2116,0.14301,-0.8623,21.2282,0.14311,-0.8542,21.2444,0.1432,-0.8462,21.2603,0.1433,-0.8382,21.2757,0.1434,-0.8301,21.2908,0.14349,-0.8221,21.3055,0.14359,-0.814,21.32,0.14368,-0.806,21.3341,0.14377,-0.798,21.348,0.14386,-0.7899,21.3617,0.14396,-0.7819,21.3752,0.14405,-0.7738,21.3884,0.14414,-0.7658,21.4014,0.14423,-0.7577,21.4143,0.14432,-0.7496,21.4269,0.14441,-0.7496,21.4269,0.14441]}; // OMS 2007, IMC para la edad, 60–229 meses (L,M,S)
const money = n => '$' + Math.round(n || 0).toLocaleString('es-CO');
const parseMoney = s => +String(s || '').replace(/[^\d]/g, '') || 0;
const fmtKg = v => (Math.round(v*10)/10).toLocaleString(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const fmt1 = v => (Math.round(v*10)/10).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const monthKey = ds => ds.slice(0, 7);
const monthName = k => { const [y, m] = k.split('-').map(Number); return MONTHS[m-1] + ' ' + y; };
const shiftMonth = (k, d) => { let [y, m] = k.split('-').map(Number); m += d; while (m < 1){ m += 12; y--; } while (m > 12){ m -= 12; y++; } return y + '-' + pad2(m); };
const addDays = (ds, n) => { const d = parseISO(ds); d.setDate(d.getDate() + n); return iso(d); };
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const SEXES = [['M', 'Masculino'], ['F', 'Femenino']];
const sexColor = s => s === 'F' ? '#d08aa8' : s === 'M' ? '#7f9bd6' : '#71717a';

/* Edad: con fecha de nacimiento (exacta) o con la edad en años (se va actualizando sola) */
function ageOf(p, at){
  at = at || todayISO();
  if (!p) return null;
  if (p.birth){
    const b = parseISO(p.birth), d = parseISO(at);
    let m = (d.getFullYear() - b.getFullYear())*12 + d.getMonth() - b.getMonth(); if (d.getDate() < b.getDate()) m--;
    if (m < 0) return null;
    return { y: Math.floor(m/12), m, approx:false, compY: d.getFullYear() - b.getFullYear() };
  }
  if (p.age !== null && p.age !== undefined && p.age !== ''){
    const base = parseISO(p.ageAt || at), d = parseISO(at);
    const yrs = Math.max(0, (d - base) / (365.25*864e5));
    const y = +p.age + Math.floor(yrs);
    return { y, m: Math.round((+p.age + 0.5 + yrs)*12), approx:true, compY: y };
  }
  return null;
}
const ageText = a => a ? `${a.y} año${a.y === 1 ? '' : 's'}${a.approx ? '' : ''}` : 'Sin edad';

/* IMC para la edad, OMS 2007 (5 a 19 años), con el ajuste oficial para valores extremos */
function whoZ(bmi, sex, months){
  const t = WHO_BFA[sex === 'F' ? 'g' : 'b'], i = clamp(Math.round(months) - 60, 0, 169)*3;
  const L = t[i], M = t[i+1], Sd = t[i+2];
  const sd = k => M*Math.pow(1 + L*Sd*k, 1/L);
  let z = (Math.pow(bmi/M, L) - 1)/(L*Sd);
  if (z > 3){ const s3 = sd(3); z = 3 + (bmi - s3)/(s3 - sd(2)); }
  else if (z < -3){ const s3 = sd(-3); z = -3 + (bmi - s3)/(sd(-2) - s3); }
  return z;
}
const BMI_ADULT = [[16,'Delgadez severa','#7f9bd6'],[17,'Delgadez moderada','#8aaedb'],[18.5,'Delgadez leve','#93c5fd'],[25,'Peso normal','#7fb38a'],[30,'Sobrepeso','#d8c06e'],[35,'Obesidad grado I','#dc9a6e'],[40,'Obesidad grado II','#d98585'],[Infinity,'Obesidad grado III','#b86a6a']];
const GAUGE_ADULT = 'linear-gradient(90deg,#8aaedb 0 16%,#7fb38a 16% 39%,#d8c06e 39% 57%,#dc9a6e 57% 75%,#d98585 75%)';
const GAUGE_CHILD = 'linear-gradient(90deg,#7f9bd6 0 0%,#8aaedb 0 16.7%,#7fb38a 16.7% 66.7%,#d8c06e 66.7% 83.3%,#d98585 83.3%)';
function bmiInfo(kg, cm, sex, age){
  if (!kg || !cm) return null;
  const bmi = kg/Math.pow(cm/100, 2);
  if (age && age.m < 60) return { bmi, label:'No aplica', color:'#71717a', kind:'na', note:'La tabla de la OMS para niños empieza a los 5 años.' };
  if (age && age.m < 228){
    if (!sex) return { bmi, label:'Falta el género', color:'#71717a', kind:'need', note:'Para menores de 19 años la OMS usa tablas distintas para niños y niñas. Indica el género.' };
    const z = whoZ(bmi, sex, age.m);
    const [label, color] = z < -3 ? ['Delgadez severa','#7f9bd6'] : z < -2 ? ['Delgadez','#8aaedb'] : z <= 1 ? ['Peso normal','#7fb38a'] : z <= 2 ? ['Sobrepeso','#d8c06e'] : ['Obesidad','#d98585'];
    return { bmi, z, label, color, kind:'child', pos: clamp((z + 3)/6, 0, 1), gauge: GAUGE_CHILD,
      note:`Menor de 19 años: se compara con ${sex === 'F' ? 'niñas' : 'niños'} de su misma edad (tablas OMS 2007). Puntaje z: ${z.toFixed(1).replace('.', ',')}.${age.approx ? ' Edad aproximada.' : ''}` };
  }
  const r = BMI_ADULT.find(x => bmi < x[0]);
  return { bmi, label: r[1], color: r[2], kind:'adult', pos: clamp((bmi - 14)/28, 0, 1), gauge: GAUGE_ADULT,
    note: age ? 'Clasificación de la OMS para adultos.' : 'Clasificación de la OMS para adultos. Si es menor de 19 años, agrega la edad para usar las tablas por edad.' };
}
function bmiCardHTML(info, opts){
  opts = opts || {};
  if (!info) return `<div class="catcard" style="--cc:#71717a"><small>ÍNDICE DE MASA CORPORAL</small><p style="margin-top:6px">${opts.missing || 'Registra peso y altura para calcularlo.'}</p>${opts.action || ''}</div>`;
  return `<div class="catcard" style="--cc:${info.color}"><small>ÍNDICE DE MASA CORPORAL · IMC</small>
    <div class="bmibig"><b>${fmt1(info.bmi)}</b><span class="tagpill" style="--pc:${info.color}">${info.label}</span></div>
    ${info.pos !== undefined ? `<div class="gauge" style="background:${info.gauge}"><i style="left:${(info.pos*100).toFixed(1)}%"></i></div>
    <div class="gaugelbl">${info.kind === 'child' ? '<span>Delgadez</span><span>Normal</span><span>Sobrepeso</span><span>Obesidad</span>' : '<span>Bajo</span><span>Normal</span><span>Sobrepeso</span><span>Obesidad</span>'}</div>` : ''}
    <p style="margin-top:8px">${info.note}</p>
    <button class="linkbtn" data-bmihelp="${info.kind}">¿Cómo se calcula y qué significa?</button></div>`;
}
function openBMIHelp(kind){
  openForm(`<h3 class="ftitle">EL IMC EXPLICADO</h3>
    <div class="gbody"><p>El <b>índice de masa corporal</b> relaciona el peso con la estatura: <b>peso (kg) ÷ estatura (m)²</b>. Ejemplo: 70 kg y 1,75 m → 70 ÷ (1,75 × 1,75) = <b>22,9</b>.</p>
    <p><b>Adultos (19 años o más)</b>, según la Organización Mundial de la Salud:</p>
    <table class="cattable"><tbody>
      <tr><td>Delgadez severa</td><td>menos de 16</td></tr><tr><td>Delgadez moderada</td><td>16 a 16,9</td></tr><tr><td>Delgadez leve</td><td>17 a 18,4</td></tr>
      <tr><td>Peso normal</td><td>18,5 a 24,9</td></tr><tr><td>Sobrepeso</td><td>25 a 29,9</td></tr><tr><td>Obesidad grado I</td><td>30 a 34,9</td></tr>
      <tr><td>Obesidad grado II</td><td>35 a 39,9</td></tr><tr><td>Obesidad grado III</td><td>40 o más</td></tr></tbody></table>
    <p><b>Niños y jóvenes de 5 a 18 años:</b> el mismo número no sirve, porque el cuerpo cambia al crecer. La OMS compara el IMC con el de otros niños o niñas de la <b>misma edad y sexo</b> (puntaje z):</p>
    <table class="cattable"><tbody><tr><td>Delgadez severa</td><td>z menor de −3</td></tr><tr><td>Delgadez</td><td>z menor de −2</td></tr><tr><td>Peso normal</td><td>z entre −2 y +1</td></tr><tr><td>Sobrepeso</td><td>z entre +1 y +2</td></tr><tr><td>Obesidad</td><td>z mayor de +2</td></tr></tbody></table>
    <p class="tip">Ojo en el boxeo: el IMC no distingue músculo de grasa. Un boxeador con mucho músculo puede salir en “sobrepeso” estando en forma. Úsalo como guía, no como diagnóstico; ante dudas, consulta a un profesional de la salud.</p></div>
    <button class="btn pri" style="width:100%;margin-top:10px" onclick="closeForm()">ENTENDIDO</button>`);
}

/* Categorías oficiales. Aficionado: World Boxing (reglas vigentes desde 2025). Profesional: las 17 divisiones de los organismos mundiales. */
const CAT = {
  eliteM: { name:'Aficionado · Élite y Sub-19 · Hombres', min:47, l:[[50,'Mosca'],[55,'Gallo'],[60,'Ligero'],[65,'Wélter'],[70,'Superwélter'],[75,'Mediano'],[80,'Semipesado'],[85,'Crucero'],[90,'Pesado'],[null,'Superpesado']] },
  eliteF: { name:'Aficionado · Élite y Sub-19 · Mujeres', min:45, l:[[48,'Minimosca'],[51,'Mosca'],[54,'Gallo'],[57,'Pluma'],[60,'Ligero'],[65,'Wélter'],[70,'Superwélter'],[75,'Mediano'],[80,'Semipesado'],[null,'Pesado']] },
  u17:    { name:'Aficionado · Sub-17 (15 y 16 años) · Hombres y mujeres', min:44, l:[[46,'Alfiler'],[48,'Minimosca'],[50,'Mosca'],[52,'Gallo ligero'],[54,'Gallo'],[57,'Pluma'],[60,'Ligero'],[63,'Superligero'],[66,'Wélter'],[70,'Superwélter'],[75,'Mediano'],[80,'Semipesado'],[null,'Pesado']] },
  pro:    { name:'Profesional · Hombres y mujeres', min:0, l:[[47.6,'Mínimo',105],[49,'Minimosca',108],[50.8,'Mosca',112],[52.2,'Supermosca',115],[53.5,'Gallo',118],[55.3,'Supergallo',122],[57.2,'Pluma',126],[59,'Superpluma',130],[61.2,'Ligero',135],[63.5,'Superligero',140],[66.7,'Wélter',147],[69.9,'Superwélter',154],[72.6,'Mediano',160],[76.2,'Supermediano',168],[79.4,'Semipesado',175],[90.7,'Crucero',200],[null,'Pesado']] },
};
const CAT_COLORS = ['#7aa9d1','#80c3cc','#7ec0b5','#82c0a2','#8cc59a','#b6cc80','#d8c06e','#dcbd78','#e0a57c','#dc9a6e','#dc9696','#d98585','#cf8090','#c98399','#b98cc4','#a58fcf','#9a8bd0'];
function catGroupName(sys, ageY){
  if (sys === 'pro') return 'Profesional';
  if (ageY == null) return 'Élite (19 a 40 años)';
  if (ageY < 15) return 'Sub-15 (referencia Sub-17)';
  if (ageY < 17) return 'Sub-17 (15 y 16 años)';
  if (ageY < 19) return 'Sub-19 (17 y 18 años)';
  return 'Élite (19 a 40 años)';
}
function catInfo(kg, sex, age, sys){
  const ageY = age ? age.compY : null, notes = [];
  if (sys === 'pro'){ if (ageY != null && ageY < 18) notes.push('El boxeo profesional es solo para mayores de 18 años: se muestra como referencia.'); }
  else {
    if (ageY != null && ageY < 13) return { key:null, notes:['Los menores de 13 años no compiten en categorías oficiales de World Boxing; cada liga maneja sus propias divisiones por edad y peso.'] };
    if (ageY != null && ageY < 15) notes.push('De 13 y 14 años (Sub-15) las categorías las fija la Federación Colombiana de Boxeo; se muestran las Sub-17 como referencia.');
    if ((ageY == null || ageY >= 17) && !sex) return { key:null, need:'sex', notes:['Indica el género: en aficionado, hombres y mujeres tienen categorías distintas.'] };
    if (ageY == null) notes.push('Sin edad registrada se muestran las categorías Élite.');
    if (ageY != null && ageY > 40) notes.push('En aficionado la categoría Élite va hasta los 40 años; se muestra como referencia.');
  }
  const key = sys === 'pro' ? 'pro' : (ageY != null && ageY < 17) ? 'u17' : (sex === 'F' ? 'eliteF' : 'eliteM');
  const T = CAT[key]; let idx = -1, below = false;
  if (kg){ if (T.min && kg <= T.min) below = true; else idx = T.l.findIndex(x => x[0] == null || kg <= x[0]); }
  return { key, T, idx, below, notes, group: catGroupName(sys, ageY) };
}
function catRange(T, i){
  const up = T.l[i][0], lo = i ? T.l[i-1][0] : T.min, lb = T.l[i][2];
  if (up == null) return `más de ${fmtKg(lo)} kg${T === CAT.pro ? ' (más de 200 lb)' : ''}`;
  if (!lo) return `hasta ${fmtKg(up)} kg${lb ? ` (${lb} lb)` : ''}`;
  return `más de ${fmtKg(lo)} hasta ${fmtKg(up)} kg${lb ? ` (${lb} lb)` : ''}`;
}
function catCardHTML(kg, sex, age, sys, opts){
  opts = opts || {};
  const ci = catInfo(kg, sex, age, sys);
  const seg = opts.noSeg ? '' : `<div class="seg" style="margin-top:8px">${[['amateur','AFICIONADO'],['pro','PROFESIONAL']].map(([k,l]) => `<button type="button" data-catsys="${k}" class="${sys === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (!ci.key) return `<div class="catcard" style="--cc:#71717a"><small>CATEGORÍA DE PESO</small>${seg}<p>${ci.notes.join(' ')}</p>${opts.action || ''}<button class="linkbtn" data-catall="${sys}">Ver todas las categorías</button></div>`;
  let main = '', detail = '';
  if (!kg){ main = '—'; detail = 'Registra un peso para ver la categoría.'; }
  else if (ci.below){ main = 'Bajo el mínimo'; detail = `El peso mínimo de esta tabla es más de ${fmtKg(ci.T.min)} kg.`; }
  else {
    const i = ci.idx, row = ci.T.l[i], up = row[0], prev = i > 0 ? ci.T.l[i-1] : null;
    main = row[1];
    detail = `Rango: ${catRange(ci.T, i)}.`;
    if (up != null) detail += ` Margen hasta el límite: ${fmtKg(up - kg)} kg.`;
    if (prev && (!ci.T.min || i > 0)) detail += ` Para bajar a ${prev[1]} hay que bajar ${fmtKg(kg - prev[0])} kg.`;
  }
  const col = ci.idx >= 0 ? CAT_COLORS[Math.round(ci.idx/(ci.T.l.length - 1)*(CAT_COLORS.length - 1))] : '#71717a';
  return `<div class="catcard" style="--cc:${col}"><small>CATEGORÍA DE PESO · ${esc(ci.group.toUpperCase())}</small>${seg}
    <div class="nm">${esc(main)}</div><p>${detail}</p>${ci.notes.length ? `<p style="margin-top:6px;color:var(--dim);font-size:14px">${ci.notes.join(' ')}</p>` : ''}
    <button class="linkbtn" data-catall="${sys}" data-cats="${sex || ''}" data-cata="${age ? age.compY : ''}" data-kg="${kg || ''}">Ver todas las categorías explicadas</button></div>`;
}
function openCatTable(sys, sex, ageY, kg){
  const st = { sys: sys || 'amateur', key: null };
  const pick = () => sys === 'pro' ? 'pro' : (ageY !== '' && ageY != null && +ageY < 17) ? 'u17' : (sex === 'F' ? 'eliteF' : 'eliteM');
  st.key = st.sys === 'pro' ? 'pro' : pick();
  const draw = sh => {
    const T = CAT[st.key];
    const idx = kg ? (T.min && kg <= T.min ? -1 : T.l.findIndex(x => x[0] == null || kg <= x[0])) : -1;
    sh.querySelector('#ctBody').innerHTML = `<p class="hint" style="padding-top:6px">${esc(T.name)}${T.min ? ` · peso mínimo: más de ${T.min} kg` : ''}</p>
      <table class="cattable"><tbody>${T.l.map((r, i) => `<tr class="${i === idx ? 'me' : ''}"><td><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${CAT_COLORS[Math.round(i/(T.l.length-1)*(CAT_COLORS.length-1))]};margin-right:8px"></span>${r[1]}</td><td>${catRange(T, i)}</td></tr>`).join('')}</tbody></table>`;
    sh.querySelectorAll('[data-ck]').forEach(b => b.classList.toggle('on', b.dataset.ck === st.key));
  };
  openForm(`<h3 class="ftitle">CATEGORÍAS DE PESO</h3>
    <div class="gbody"><p>En boxeo se compite contra personas de peso parecido. Cada categoría tiene un <b>límite</b>: en el pesaje hay que dar ese peso o menos, y más que el límite de la categoría anterior.</p></div>
    <div class="tagsel">${[['eliteM','Aficionado · Hombres'],['eliteF','Aficionado · Mujeres'],['u17','Aficionado · Sub-17'],['pro','Profesional']].map(([k,l]) => `<button type="button" data-ck="${k}">${l}</button>`).join('')}</div>
    <div id="ctBody"></div>
    <div class="gbody"><p class="tip"><b>Aficionado</b> (reglas de World Boxing, que siguen las ligas y la Federación Colombiana): Élite de 19 a 40 años y Sub-19 de 17 y 18 años usan la misma tabla; Sub-17 (15 y 16 años) tiene la suya, igual para hombres y mujeres; para 13 y 14 años las define la Federación. <b>Profesional</b>: 17 divisiones iguales para hombres y mujeres, medidas en libras.</p></div>
    <button class="btn pri" style="width:100%;margin-top:10px" id="ctOk">LISTO</button>`, sh => {
    sh.querySelectorAll('[data-ck]').forEach(b => b.addEventListener('click', () => { st.key = b.dataset.ck; hapticTap(); draw(sh); }));
    sh.querySelector('#ctOk').addEventListener('click', closeForm);
    draw(sh);
  });
}
/* Delegación: enlaces de ayuda en cualquier pantalla o formulario */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-bmihelp]'); if (a){ e.preventDefault(); return openBMIHelp(a.dataset.bmihelp); }
  const c = e.target.closest('[data-catall]'); if (c){ e.preventDefault(); return openCatTable(c.dataset.catall, c.dataset.cats, c.dataset.cata, +(c.dataset.kg || 0) || (c.closest('#weight') ? lastWeight()?.kg : 0)); }
});

/* Guardar / compartir archivos (copias de seguridad y Excel) */
async function saveFile(name, text, mime){
  const FS = plugin('Filesystem'), SH = plugin('Share');
  if (FS && SH){
    try {
      const r = await FS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      await SH.share({ title: name, files: [r.uri], dialogTitle: 'Guardar o enviar ' + name });
      return true;
    } catch(e){ if (/cancel/i.test(String(e && (e.message || e)))) return false; }
  }
  try {
    const blob = new Blob([text], { type: mime || 'text/plain' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000); toast(TF('Archivo listo: {s}', name)); return true;
  } catch(e){ toast('No se pudo guardar el archivo'); return false; }
}
const csvCell = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCSV = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');

/* =========================================================
   v3 · PERSONAL: MI PERFIL, PESO/IMC/CATEGORÍA, ASISTENCIA LIBRE
   ========================================================= */
let me = Object.assign({ name:'', sex:'', birth:'', age:null, ageAt:'', height:0, cat:'amateur', plan:[], planSince:'' }, load('me', {}));
let pmarks = load('pmarks', {});   // { 'AAAA-MM-DD': 'miss' | 'rest' }
const saveMe = () => save('me', me);
const savePM = () => save('pmarks', pmarks);
const trainedOn = ds => sessLog.some(h => h.d === ds);
function dayStatus(ds){
  const t = todayISO();
  if (trainedOn(ds)) return 'tr';
  if (pmarks[ds] === 'miss') return 'ms';
  if (pmarks[ds] === 'rest') return 'rs';
  const planned = me.plan.includes(parseISO(ds).getDay());
  if (planned && ds < t && me.planSince && ds >= me.planSince) return 'auto';
  if (planned && ds >= t) return 'pl';
  return '';
}
function monthTrainSummary(k){
  const [y, m] = k.split('-').map(Number), n = new Date(y, m, 0).getDate(), t = todayISO();
  let tr = 0, ms = 0, plannedPast = 0, plannedOk = 0;
  for (let d = 1; d <= n; d++){
    const ds = `${k}-${pad2(d)}`; if (ds > t) break;
    const st = dayStatus(ds);
    if (st === 'tr') tr++;
    if (st === 'ms' || st === 'auto') ms++;
    // Cumplimiento: cuentan los días de entreno con registro (entrené / falté, aunque sean de antes de elegir
    // los días) y las faltas automáticas; hoy solo cuenta si ya entrenaste, nunca resta.
    const planned = me.plan.includes(parseISO(ds).getDay());
    if (planned && pmarks[ds] !== 'rest'){
      const counts = st === 'tr' || st === 'ms' || st === 'auto' || (ds < t && me.planSince && ds >= me.planSince);
      if (counts && !(ds === t && st !== 'tr')){ plannedPast++; if (st === 'tr') plannedOk++; }
    }
  }
  return { tr, ms, pct: plannedPast ? Math.round(plannedOk/plannedPast*100) : null };
}
function addPersonalAttendance(rec){
  logTrain(Object.assign({ r: 0, s: 0, m: 0, note: '', manual: true }, rec));
  stats.sessions++; stats.rounds += rec.r || 0; stats.trainSec = (stats.trainSec || 0) + (rec.m || 0)*60; save('stats', stats);
  if (pmarks[rec.d] === 'miss'){ delete pmarks[rec.d]; savePM(); }
}
function removeSessLog(h){
  const i = sessLog.indexOf(h); if (i < 0) return;
  sessLog.splice(i, 1); save('history', sessLog);
  stats.sessions = Math.max(0, stats.sessions - 1); stats.rounds = Math.max(0, stats.rounds - (h.r || 0));
  if (h.manual) stats.trainSec = Math.max(0, (stats.trainSec || 0) - (h.m || 0)*60); else stats.workSec = Math.max(0, stats.workSec - (h.s || 0));
  save('stats', stats);
}
function openAttendPersonal(date){ SFAct.openForm(date); }

/* ---- Mi perfil ---- */
function renderMe(){
  const body = $('#meBody'), a = ageOf(me), lw = lastWeight();
  const mode = me.birth ? 'birth' : (me.age !== null && me.age !== '' ? 'age' : 'birth');
  body.innerHTML = `
    <div class="preview" style="--c:var(--mode)"><div class="ic">👤</div><div style="flex:1;min-width:0"><input id="meName" maxlength="30" placeholder="Tu nombre" value="${esc(me.name)}"><small>${a ? ageText(a) : 'Completa tus datos'}${me.height ? ' · ' + me.height + ' cm' : ''}${lw ? ' · ' + fmtKg(lw.kg) + ' kg' : ''}</small><small style="color:var(--dim)">Los cambios se guardan solos</small></div></div>
    <div class="sect"><h4>GÉNERO</h4><p class="hint">Se usa para tu categoría de boxeo y para el IMC si eres menor de 19 años.</p>
      <div class="seg">${SEXES.map(([k,l]) => `<button type="button" data-sx="${k}" class="${me.sex === k ? 'on' : ''}">${l.toUpperCase()}</button>`).join('')}</div></div>
    <div class="sect"><h4>EDAD</h4><p class="hint">Pon tu fecha de nacimiento (más exacto) o solo tu edad; la app la va actualizando con el tiempo.</p>
      <div class="seg" id="meAgeMode">${[['birth','FECHA DE NACIMIENTO'],['age','EDAD EN AÑOS']].map(([k,l]) => `<button type="button" data-am="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="meAgeIn" style="padding-bottom:12px"></div></div>
    <div class="sect"><h4>ALTURA</h4><div class="row" style="border:0"><div class="l"><b>Estatura</b><small>${me.height ? 'En centímetros. Toca el número para escribirlo.' : 'Sin guardar: escríbela o usa + y −.'}</small></div><div class="stepper" id="meH"></div></div></div>
    <div class="sect"><h4>PESO</h4><div class="row" style="border:0"><div class="l"><b>${lw ? fmtKg(lw.kg) + ' kg' : 'Sin registrar'}</b><small>${lw ? 'Último registro: ' + niceDate(lw.date).toLowerCase() : 'Con tu peso se calculan tus calorías, tu IMC y tu categoría.'}</small></div><button class="smallbtn ${lw ? '' : 'go'}" id="meW">${lw ? 'ACTUALIZAR' : '+ REGISTRAR'}</button></div>
      ${lw ? '<button class="linkbtn" id="meWAll" style="padding-bottom:10px">Ver mi historial de peso</button>' : ''}</div>
    <div class="sect"><h4>MIS DÍAS DE ENTRENO</h4><p class="hint">Marca los días que entrenas normalmente. Así el calendario cuenta solo tus faltas y tu cumplimiento.</p>
      <div class="daypick" id="mePlan">${[1,2,3,4,5,6,0].map(d => `<button type="button" data-pd="${d}" class="${me.plan.includes(d) ? 'on' : ''}">${WD[d]}</button>`).join('')}</div>
      <p class="hint" id="mePlanTxt"></p></div>
    <div id="meCards"></div>`;
  const paintAge = () => {
    const m = body.querySelector('#meAgeMode .on').dataset.am, box = body.querySelector('#meAgeIn');
    if (m === 'birth'){ box.innerHTML = `<label class="field"><span>Fecha de nacimiento</span><input type="date" id="meBirth" max="${todayISO()}" value="${me.birth}"></label>`;
      box.querySelector('#meBirth').addEventListener('change', e => { me.birth = e.target.value; if (me.birth){ me.age = null; me.ageAt = ''; } saveMe(); paintCards(); }); }
    else { const tmp = { v: a ? a.y : 20 };
      box.innerHTML = `<div class="row" style="border:0"><div class="l"><b>Edad</b><small>${me.age !== null && me.age !== '' ? 'Guardada' : 'Toca para escribirla'}</small></div><div class="stepper" id="meAge"></div></div>`;
      makeStepper(box.querySelector('#meAge'), { get:() => tmp.v, set:v => tmp.v = Math.round(v), min:3, max:99, input:true, label:'Edad', onChange:() => { me.age = tmp.v; me.ageAt = todayISO(); me.birth = ''; saveMe(); paintCards(); } }); }
  };
  const planTxt = () => { body.querySelector('#mePlanTxt').textContent = me.plan.length ? `${me.plan.length} día${me.plan.length === 1 ? '' : 's'} por semana · las faltas se cuentan desde ${niceDate(me.planSince || todayISO()).toLowerCase()}.` : 'Sin días marcados: solo cuentan las faltas que marques a mano.'; };
  const paintCards = () => {
    const ag = ageOf(me), w = lastWeight();
    body.querySelector('#meCards').innerHTML = bmiCardHTML(w && me.height ? bmiInfo(w.kg, me.height, me.sex, ag) : null, { missing: !w ? 'Registra tu peso en <b>Mi peso</b> para calcular tu IMC.' : 'Agrega tu altura arriba para calcular tu IMC.' })
      + catCardHTML(w ? w.kg : 0, me.sex, ag, me.cat);
    body.querySelectorAll('[data-catsys]').forEach(b => b.addEventListener('click', () => { me.cat = b.dataset.catsys; saveMe(); hapticTap(); paintCards(); }));
  };
  body.querySelector('#meName').addEventListener('input', e => { me.name = e.target.value; saveMe(); });
  body.querySelectorAll('[data-sx]').forEach(b => b.addEventListener('click', () => { me.sex = b.dataset.sx; saveMe(); hapticTap(); body.querySelectorAll('[data-sx]').forEach(x => x.classList.toggle('on', x === b)); paintCards(); }));
  body.querySelectorAll('[data-am]').forEach(b => b.addEventListener('click', () => { body.querySelectorAll('[data-am]').forEach(x => x.classList.toggle('on', x === b)); paintAge(); }));
  const h = { v: me.height || 165 };
  makeStepper(body.querySelector('#meH'), { get:() => h.v, set:v => h.v = Math.round(v), min:80, max:230, input:true, label:'Altura en centímetros', fmt:v => me.height ? v : '—', onChange:() => { me.height = h.v; saveMe(); paintCards(); const st = body.querySelector('#meH'); if (st._paint) st._paint(); } });
  body.querySelectorAll('[data-pd]').forEach(b => b.addEventListener('click', () => { const d = +b.dataset.pd; me.plan = me.plan.includes(d) ? me.plan.filter(x => x !== d) : me.plan.concat(d); if (!me.planSince) me.planSince = todayISO(); b.classList.toggle('on'); saveMe(); hapticTap(); planTxt(); }));
  body.querySelector('#meW').addEventListener('click', openWeightForm);
  const wa = body.querySelector('#meWAll'); if (wa) wa.addEventListener('click', () => go('weight'));
  paintAge(); planTxt(); paintCards();
}

/* ---- Mi peso (con IMC y categoría) ---- */
function renderWeight(){
  const list = weights.slice().sort((a,b) => a.date.localeCompare(b.date));
  const lw = list[list.length-1], first = list[0];
  const prev = list.length > 1 ? list[list.length-2] : null;
  const diffT = lw && first ? lw.kg - first.kg : 0, diffP = lw && prev ? lw.kg - prev.kg : 0;
  const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtKg(Math.abs(v));
  let goalHTML = '';
  if (wGoal && lw && first){
    const totalNeed = first.kg - wGoal, done = first.kg - lw.kg;
    const pct = totalNeed === 0 ? 100 : clamp(done/totalNeed*100, 0, 100);
    const left = lw.kg - wGoal;
    goalHTML = `<div class="goalbar"><i style="width:${pct.toFixed(0)}%"></i></div><small>${Math.abs(left) < 0.05 ? '¡Meta alcanzada! 🎉' : `Faltan ${fmtKg(Math.abs(left))} kg para tu meta de ${fmtKg(wGoal)} kg`}</small>`;
  }
  $('#wtHero').innerHTML = lw ? `
    <div class="wthero"><div><small>PESO ACTUAL</small><b>${fmtKg(lw.kg)}<span> kg</span></b><small>${niceDate(lw.date)}</small></div>
      <div class="wtdiffs"><div class="${diffP>0?'up':diffP<0?'down':''}"><b>${prev ? sign(diffP) : '—'}</b><small>vs anterior</small></div><div class="${diffT>0?'up':diffT<0?'down':''}"><b>${list.length>1 ? sign(diffT) : '—'}</b><small>desde el inicio</small></div></div></div>
    ${goalHTML}` : `<p class="empty" style="padding:20px 0">Registra tu peso para empezar a ver tu progreso, tu IMC y tu categoría.</p>`;
  const a = ageOf(me);
  const need = [];
  if (!me.height) need.push('altura'); if (!me.sex) need.push('género'); if (!a) need.push('edad');
  $('#wtCards').innerHTML = (need.length ? `<button class="calcard" data-open="me" style="--c:#9d8fd0"><span class="calic">👤</span><span class="l"><b>COMPLETA TU PERFIL</b><small>Falta: ${need.join(', ')}. Así el IMC y la categoría salen exactos.</small></span><span class="arrow">›</span></button>` : '')
    + bmiCardHTML(lw && me.height ? bmiInfo(lw.kg, me.height, me.sex, a) : null, { missing: !lw ? 'Registra tu peso para calcular el IMC.' : 'Agrega tu altura en Mi perfil para calcular el IMC.' })
    + catCardHTML(lw ? lw.kg : 0, me.sex, a, me.cat);
  $('#wtCards').querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => go(b.dataset.open)));
  $('#wtCards').querySelectorAll('[data-catsys]').forEach(b => b.addEventListener('click', () => { me.cat = b.dataset.catsys; saveMe(); hapticTap(); renderWeight(); }));
  // gráfico de línea
  const pts = list.slice(-30);
  if (pts.length >= 2){
    const W0 = 340, H0 = 150, padX = 26, padY = 18;
    const vals = pts.map(p => p.kg).concat(wGoal ? [wGoal] : []);
    let mn = Math.min(...vals), mx = Math.max(...vals); if (mx - mn < 2){ mn -= 1; mx += 1; }
    const x = i => padX + i*(W0 - padX*2)/(pts.length-1), y = v => padY + (mx - v)/(mx - mn)*(H0 - padY*2);
    const d = pts.map((p,i) => (i?'L':'M') + x(i).toFixed(1) + ' ' + y(p.kg).toFixed(1)).join(' ');
    const area = d + ` L${x(pts.length-1).toFixed(1)} ${H0-padY} L${x(0).toFixed(1)} ${H0-padY} Z`;
    $('#wtChart').innerHTML = `<svg viewBox="0 0 ${W0} ${H0}" class="wtsvg">
      <defs><linearGradient id="wtg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb38a" stop-opacity=".35"/><stop offset="1" stop-color="#7fb38a" stop-opacity="0"/></linearGradient></defs>
      ${wGoal ? `<line x1="${padX}" x2="${W0-padX}" y1="${y(wGoal)}" y2="${y(wGoal)}" stroke="#d8c06e" stroke-dasharray="5 5" stroke-width="1.5"/><text x="${padX}" y="${y(wGoal)-5}" text-anchor="start" fill="#b89a4e" font-size="11" font-weight="700">META ${fmtKg(wGoal)}</text>` : ''}
      <path d="${area}" fill="url(#wtg)"/>
      <path d="${d}" fill="none" stroke="#7fb38a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="wtline"/>
      ${pts.map((p,i) => `<circle cx="${x(i)}" cy="${y(p.kg)}" r="${i===pts.length-1?5:3}" fill="${i===pts.length-1?'var(--text)':'#7fb38a'}"/>`).join('')}
      <text x="${padX}" y="${H0-3}" fill="#71717a" font-size="11" font-weight="700">${shortDate(pts[0].date)}</text>
      <text x="${W0-padX}" y="${H0-3}" text-anchor="end" fill="#71717a" font-size="11" font-weight="700">${shortDate(pts[pts.length-1].date)}</text>
    </svg>`;
  } else $('#wtChart').innerHTML = '<p class="empty">Con 2 registros o más verás tu gráfico.</p>';
  $('#wtLog').innerHTML = list.slice().reverse().map((w,i,arr) => { const nx = arr[i+1]; const df = nx ? w.kg - nx.kg : 0;
    return `<div class="row"><span class="l"><b>${fmtKg(w.kg)} kg</b><small>${niceDate(w.date)}</small></span>${nx ? `<span class="chg ${df>0?'up':df<0?'down':''}">${df>0?'▲':df<0?'▼':'='} ${fmtKg(Math.abs(df))}</span>` : ''}<button class="xbtn" data-wd="${w.id}">×</button></div>`; }).join('') || '<p class="empty">Sin registros.</p>';
  $$('#wtLog [data-wd]').forEach(b => b.addEventListener('click', async () => { if (await confirmDlg('¿Borrar registro?', 'Se quitará este peso del historial.', 'BORRAR')){ weights = weights.filter(w => w.id !== b.dataset.wd); saveW(); renderWeight(); } }));
}
function openWeightForm(){
  const lw = lastWeight();
  const rec = { kg: lw ? lw.kg : 70, date: todayISO(), h: me.height || 165 };
  openForm(`<h3 class="ftitle">REGISTRAR PESO</h3>
    <div class="field"><span>Peso (kg)</span><div class="stepper big" id="wkNum"></div></div>
    <p class="hint" style="margin-top:-4px">Toca el número para escribirlo, o usa + y − (mantén presionado para avanzar rápido).</p>
    ${me.height ? '' : `<div class="field"><span>Tu altura (cm) · para el IMC</span><div class="stepper" id="wkH"></div></div>`}
    <label class="field"><span>Fecha</span><input type="date" id="wkDate" value="${rec.date}" max="${todayISO()}"></label>
    <div class="btnrow"><button class="btn" id="wkCancel">CANCELAR</button><button class="btn pri" id="wkSave" style="--bc:#7fb38a">GUARDAR</button></div>`, sh => {
    makeStepper(sh.querySelector('#wkNum'), { get:() => rec.kg, set:v => rec.kg = Math.round(v*10)/10, min:15, max:300, step:0.1, fmt:v => fmt1(v), input:true, label:'Peso en kilos' });
    if (!me.height) makeStepper(sh.querySelector('#wkH'), { get:() => rec.h, set:v => rec.h = Math.round(v), min:80, max:230, input:true, label:'Altura' });
    sh.querySelector('#wkCancel').addEventListener('click', closeForm);
    sh.querySelector('#wkSave').addEventListener('click', () => {
      const inp = sh.querySelector('#wkNum input'); if (inp) inp.blur();
      rec.date = sh.querySelector('#wkDate').value || todayISO();
      if (!me.height){ me.height = rec.h; saveMe(); }
      weights = weights.filter(w => w.date !== rec.date); // un registro por día
      weights.push({ id: uid(), date: rec.date, kg: rec.kg }); saveW(); closeForm(); renderWeight(); if (current === 'me') renderMe(); else if (current === 'home' && window.SFToday) SFToday.render(); Sound.win(); toast(`Peso guardado: ${fmtKg(rec.kg)} kg`);
    });
  });
}
function openGoalForm(){
  const g = { v: wGoal || (lastWeight()?.kg ?? 70) };
  openForm(`<h3 class="ftitle">MI META DE PESO</h3>
    <div class="field"><span>Meta (kg)</span><div class="stepper big" id="wgNum"></div></div>
    <p class="hint">Tip: si quieres dar una categoría, pon como meta su límite. Mira las categorías en Mi peso.</p>
    <div class="btnrow">${wGoal ? '<button class="btn" id="wgClear" style="color:#dc9696">QUITAR META</button>' : '<button class="btn" id="wgCancel">CANCELAR</button>'}<button class="btn pri" id="wgSave" style="--bc:#d8c06e;color:#111">GUARDAR</button></div>`, sh => {
    makeStepper(sh.querySelector('#wgNum'), { get:() => g.v, set:v => g.v = Math.round(v*10)/10, min:15, max:300, step:0.1, fmt:v => fmt1(v), input:true, label:'Meta en kilos' });
    sh.querySelector('#wgSave').addEventListener('click', () => { const inp = sh.querySelector('#wgNum input'); if (inp) inp.blur(); wGoal = g.v; saveW(); closeForm(); renderWeight(); toast('Meta guardada'); });
    const c = sh.querySelector('#wgCancel'); if (c) c.addEventListener('click', closeForm);
    const cl = sh.querySelector('#wgClear'); if (cl) cl.addEventListener('click', () => { wGoal = 0; saveW(); closeForm(); renderWeight(); });
  });
}


/* =========================================================
   CALENDARIO (personal con días entrenados/faltados · Box House con listas y personalizadas)
   ========================================================= */
function dayItems(mode, ds){
  const out = [];
  events.personal.filter(e => e.date === ds).sort((a,b) => (a.time||'').localeCompare(b.time||'')).forEach(e => out.push({ kind:'event', e, color: evColor('personal', e.type) }));
  sessLog.filter(h => h.d === ds).forEach(h => out.push({ kind:'session', h, color:'#7fb38a' }));
  weights.filter(w => w.date === ds).forEach(w => out.push({ kind:'weight', w, color:'#d8c06e' }));
  return out;
}
function sessLine(h){
  const kc = h.k ? ` · ≈${h.k} kcal` : '';
  if (h.t === 'gym') return `Pesas${h.m ? ' · ' + h.m + ' min' : ''}${h.sets ? ' · ' + h.sets + ' series' : ''}${kc}`;
  if (h.manual) return `${h.t === 'cardio' ? 'Actividad' : 'Entreno'}${h.m ? ' · ' + h.m + ' min' : ''}${h.r ? ' · ' + h.r + ' rounds' : ''}${kc}${h.note ? ' · ' + esc(h.note) : ''}`;
  return `Entreno completado · ${h.r} rounds · ${fmtShort(h.s)}${kc}`;
}
function renderCalendar(){
  const mode = 'personal', [y, m] = calYM, t = todayISO(), k = `${y}-${pad2(m+1)}`;
  $('#calTitle').textContent = 'MI CALENDARIO';
  $('#calMonth').textContent = `${MONTHS[m]} ${y}`;
  const first = new Date(y, m, 1), startDow = (first.getDay() + 6) % 7, nDays = new Date(y, m+1, 0).getDate();
  let html = ['L','M','X','J','V','S','D'].map(d => `<i class="wd">${d}</i>`).join('');
  for (let i=0;i<startDow;i++) html += '<i></i>';
  for (let d=1; d<=nDays; d++){
    const ds = `${y}-${pad2(m+1)}-${pad2(d)}`, items = dayItems(mode, ds);
    const st = dayStatus(ds), cls = st === 'auto' ? 'ms auto' : st;
    const dots = items.filter(it => it.kind !== 'session').slice(0,3).map(it => `<b style="background:${it.color}"></b>`).join('');
    html += `<button class="day ${cls} ${ds===t?'today':''} ${ds===calSel?'sel':''}" data-day="${ds}" style="--i:${d}"><span>${d}</span><em>${dots}</em></button>`;
  }
  $('#calGrid').innerHTML = html;
  $$('#calGrid [data-day]').forEach(b => b.addEventListener('click', () => { calSel = b.dataset.day; hapticTap(); renderCalendar(); }));
  // resumen del mes
  const s = monthTrainSummary(k);
  $('#calSummary').innerHTML = `<div class="kpis" style="margin-top:12px"><div class="kpi" style="--kc:#7fb38a"><b>${s.tr}</b><span>Días entrenados</span></div><div class="kpi" style="--kc:#d98585"><b>${s.ms}</b><span>Faltas</span></div>
    ${s.pct != null ? `<div class="kpi wide" style="--kc:var(--mode)"><b>${s.pct}%</b><span>Cumplimiento de tus días de entreno</span></div>` : ''}</div>
    <div class="legend"><span><i style="background:#7fb38a"></i>Entrené</span><span><i style="background:#d98585"></i>Falté</span><span><i style="background:#64748b"></i>Descanso</span><span><i style="border:1.5px dashed #7fb38a;background:transparent"></i>Día de entreno</span></div>
    ${me.plan.length ? '' : `<button class="linkbtn" data-open="me">Elige tus días de entreno para que se cuenten las faltas solas</button>`}`;
  $('#calSummary').querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => go(b.dataset.open)));
  // panel del día
  const items = dayItems(mode, calSel);
  $('#calDayTitle').textContent = niceDate(calSel).toUpperCase();
  const st = dayStatus(calSel), fut = calSel > t;
  const pre = `<div class="daymarks">
      <button data-mk="tr" style="--c:#7fb38a" class="${st === 'tr' ? 'on' : ''}" ${fut ? 'disabled' : ''}>✓ ENTRENÉ</button>
      <button data-mk="miss" style="--c:#d98585" class="${st === 'ms' ? 'on' : ''}" ${fut ? 'disabled' : ''}>✗ FALTÉ</button>
      <button data-mk="rest" style="--c:#64748b" class="${st === 'rs' ? 'on' : ''}">😴 DESCANSO</button></div>
      ${st === 'auto' ? '<p class="hint">Falta automática: era uno de tus días de entreno y no hay registro. Márcalo como descanso si no tocaba.</p>' : ''}
      ${window.SF && !fut ? SF.dayStripHTML(calSel) : ''}`;
  $('#calDayList').innerHTML = pre + (items.length ? items.map(it => {
    if (it.kind === 'event'){ const e = it.e; return `<button class="evrow" data-ev="${e.id}" style="--c:${it.color}"><i></i><span class="l"><b>${esc(e.title)}</b><small>${evLabel(mode,e.type)}${e.time?' · '+e.time:''}${e.participants?' · '+e.participants+' participantes':''}${e.notes?' · '+esc(e.notes):''}</small></span><span class="arrow">›</span></button>`; }
    if (it.kind === 'session') return `<div class="evrow" style="--c:${it.h.t === 'gym' ? '#9d8fd0' : it.h.t === 'cardio' ? '#6fb0b6' : '#7fb38a'}"><i></i><span class="l"><b>✓ ${esc(it.h.p)}</b><small>${sessLine(it.h)}</small></span><button class="xbtn" data-hl="${sessLog.indexOf(it.h)}">×</button></div>`;
    return `<div class="evrow" style="--c:#d8c06e"><i></i><span class="l"><b>⚖️ ${fmtKg(it.w.kg)} kg</b><small>Peso registrado</small></span></div>`;
  }).join('') : `<p class="empty">Nada para este día. Toca “+ EVENTO” para agregar algo.</p>`);
  const dl = $('#calDayList');
  dl.querySelectorAll('[data-ev]').forEach(b => b.addEventListener('click', () => openEventForm(b.dataset.ev)));
  dl.querySelectorAll('[data-hl]').forEach(b => b.addEventListener('click', async () => { const h = sessLog[+b.dataset.hl]; if (h && await confirmDlg('¿Quitar este entreno?', 'Se descontará de tus estadísticas y de las calorías de ese día.', 'QUITAR')){ removeSessLog(h); renderCalendar(); } }));
  dl.querySelectorAll('[data-mk]').forEach(b => b.addEventListener('click', async () => {
    const mk = b.dataset.mk; hapticTap();
    if (mk === 'tr'){ if (dayStatus(calSel) === 'tr') return toast('Ya hay un entreno ese día. Puedes sumar otro desde Hoy o quitarlo con ×.'); return openAttendPersonal(calSel); }
    if (trainedOn(calSel)){ if (!await confirmDlg('Ese día entrenaste', 'Para marcarlo como falta o descanso primero quita el entreno de la lista (×).', 'ENTENDIDO')) return; return; }
    if (pmarks[calSel] === mk) delete pmarks[calSel]; else pmarks[calSel] = mk;
    savePM(); renderCalendar();
  }));
}


/* =========================================================
   GUÍA BOXEADOR: PERSONAJE, ANIMACIÓN Y EXPLICACIONES
   ========================================================= */
function boxerFace(){ return boxerSVG('talk').replace('viewBox="0 0 124 162"', 'viewBox="34 14 64 64"'); }
/* MechaRidds boxeador: el guía que boxea en el timer (se viste en Ajustes → Guía) */
const LOOK_OPTS = {
  shirt:  { t:'Camiseta',    o:[['negro','Negra','#1d1b24'],['rojo','Roja','#cf7c7c'],['azul','Azul','#7b93cf'],['blanco','Blanca','#f4f4f5'],['morado','Morada','#9d8fd0'],['dorado','Dorada','#cdb262']] },
  shorts: { t:'Pantaloneta', o:[['morado','Morada','#9285c4'],['negro','Negra','#111827'],['azul','Azul','#6f83b8'],['rojo','Roja','#b86a6a'],['blanco','Blanca','#e5e7eb'],['dorado','Dorada','#b89a4e']] },
  gloves: { t:'Guantes',     o:[['verde','Verdes','#8cbf72'],['rojo','Rojos','#cf7c7c'],['azul','Azules','#7b93cf'],['negro','Negros','#27272a'],['blanco','Blancos','#f4f4f5'],['dorado','Dorados','#cdb262']] },
};
const LOOK_DEFAULT = { shirt:'negro', shorts:'morado', gloves:'verde' };
const lookOf = () => { const l = Object.assign({}, LOOK_DEFAULT, S.look || {}); Object.keys(LOOK_OPTS).forEach(k => { if (!LOOK_OPTS[k].o.some(o => o[0] === l[k])) l[k] = LOOK_DEFAULT[k]; }); return l; };
const lookColor = (part, key) => { const o = LOOK_OPTS[part].o.find(x => x[0] === key) || LOOK_OPTS[part].o[0]; return o[2]; };
const shade2 = (hex, amt) => { if (!hex) return hex; let c = parseInt(hex.slice(1), 16); let r = (c >> 16) + amt, g = ((c >> 8) & 255) + amt, b = (c & 255) + amt; const f = v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'); return '#' + f(r) + f(g) + f(b); };
const isLight = hex => { const c = parseInt(hex.slice(1), 16); return ((c >> 16)*299 + ((c >> 8) & 255)*587 + (c & 255)*114)/1000 > 170; };
function boxerFace(){ return SFArt.MECHA.mechaHead('MechaRidds'); }
function boxerSVG(cls, lk){
  lk = lk || lookOf();
  const M = SFArt.MECHA, skin = M.SKIN, skin2 = shade2(skin, -22), metal = M.METAL, metal2 = M.METAL_D, glow = M.GLOW;
  const shirt = lookColor('shirt', lk.shirt), shorts = lookColor('shorts', lk.shorts), glove = lookColor('gloves', lk.gloves), glove2 = shade2(glove, -34);
  const trim = isLight(shirt) ? '#a1a1aa' : glow, boxTxt = isLight(shirt) ? '#1f1f23' : '#fff', cuff = isLight(glove) ? '#a1a1aa' : '#fff', stripe = isLight(shorts) ? '#1f1f23' : glow;
  return `<svg class="boxer ${cls || ''}" viewBox="0 0 124 162" aria-hidden="true">
  <ellipse class="bx-shadow" cx="60" cy="156" rx="30" ry="4.5" fill="#000" opacity=".35"/>
  <g class="bx-body">
    <path d="M50 112 L43 144" stroke="${metal2}" stroke-width="10" stroke-linecap="round"/>
    <path d="M70 112 L77 144" stroke="${skin}" stroke-width="10" stroke-linecap="round"/>
    <circle cx="46.5" cy="128" r="3" fill="${glow}"/>
    <rect x="37" y="139" width="13" height="8" rx="2" fill="#fff"/><rect x="71" y="139" width="13" height="8" rx="2" fill="#fff"/>
    <path d="M33 147 h18 a3 3 0 0 1 3 3 v4 h-23 v-3 a4 4 0 0 1 2-4z" fill="#18181b"/>
    <path d="M69 147 h15 a7 7 0 0 1 7 7 h-24 v-5 a2 2 0 0 1 2-2z" fill="#18181b"/>
    <path d="M42 96 H80 L84 121 H64 L61 112 L58 121 H38 Z" fill="${shorts}"/>
    <rect x="41" y="93" width="40" height="7" rx="3" fill="${stripe}"/>
    <path d="M40 117 L43 101" stroke="${stripe}" stroke-width="2.6"/><path d="M82 117 L79 101" stroke="${stripe}" stroke-width="2.6"/>
    <g class="bx-armB"><g transform="translate(52 76) rotate(-12.5)"><line class="bx-limb" x1="0" y1="0" x2="18.4" y2="0" stroke="${metal2}" stroke-width="9"/></g></g>
    <path d="M47 66 Q61 60 75 66 L80 95 H42 Z" fill="${shirt}"/>
    <path d="M47 66 Q49 74 45 80" stroke="${trim}" stroke-width="2" fill="none" opacity=".85"/><path d="M75 66 Q73 74 77 80" stroke="${trim}" stroke-width="2" fill="none" opacity=".85"/>
    <circle cx="61" cy="74" r="4.6" fill="${glow}" opacity=".25"/><circle cx="61" cy="74" r="2.8" fill="${glow}"/>
    <text x="61" y="90" text-anchor="middle" font-family="Bebas Neue,Impact,sans-serif" font-size="10" fill="${boxTxt}" opacity=".9">BOX</text>
    <circle cx="52" cy="74" r="5.5" fill="${metal}" stroke="${metal2}"/>
    <g class="bx-armB"><g class="bx-glove"><circle cx="70" cy="70" r="9.5" fill="${glove2}"/><path d="M63 74 q7 5 14 0" stroke="${cuff}" stroke-width="2.4" fill="none"/><ellipse cx="67" cy="66" rx="3" ry="2" fill="#fff" opacity=".3"/></g></g>
    <g class="bx-head">
      <rect x="56" y="54" width="12" height="12" rx="3" fill="${metal}" stroke="${metal2}"/>
      <g transform="translate(31 6.8) scale(.62)">${M.head()}</g>
      <path class="bx-sweat" d="M40 26 q-3 5 0 7 q3 -2 0 -7z" fill="#a3c7de"/>
    </g>
    <g class="bx-armF"><g transform="translate(70 74) rotate(-29.7)"><line class="bx-limb" x1="0" y1="0" x2="16.1" y2="0" stroke="${skin}" stroke-width="9"/></g>
      <circle cx="70" cy="74" r="5.5" fill="${skin}"/>
      <g class="bx-glove"><circle cx="84" cy="66" r="10.5" fill="${glove}"/><path d="M76 71 q8 5.5 16 0" stroke="${cuff}" stroke-width="2.6" fill="none"/><ellipse cx="80" cy="61" rx="3.6" ry="2.4" fill="#fff" opacity=".35"/></g></g>
  </g></svg>`;
}
// El acompañante fijo (botón flotante y explicaciones): MechaRidds por defecto, o el que elija la persona
const companion = () => (window.SFArt && SFArt.GUIDES[S.companion]) ? S.companion : 'mecha';
const gName = () => companion() === 'mecha' ? (((S.guideName && S.guideName !== 'Tito') ? S.guideName : 'MechaRidds').trim() || 'MechaRidds') : SFArt.GUIDES[companion()].name;
const companionArt = () => companion() === 'mecha' ? boxerSVG('talk') : `<div class="gpet">${SFArt.badge(companion(), 96)}</div>`;
const userFirst = () => me.name ? me.name.trim().split(/\s+/)[0] : '';
const GUIDE = {
  home: () => ({ t:'tu día', b:[`<p>Aquí ves <b>cómo vas hoy</b>: calorías que quemaste, minutos activos, pasos, lo que comiste y tu racha.</p>`,
      `<ul><li><b>Anillos:</b> se llenan con tus metas del día. Tócalos para cambiarlas.</li><li><b>Balance:</b> lo que comes menos lo que gastas (tu cuerpo en reposo + lo que entrenas).</li><li><b>Racha 🔥:</b> días seguidos cumpliendo. Los descansos que planeas no la rompen.</li><li><b>Diario:</b> todo lo que hiciste hoy. Con “+ Actividad” anotas lo que no pasó por la app.</li></ul>`,
      `<p class="tip">Completa tu perfil (peso, altura, edad y género) para que las calorías salgan bien.</p>`] }),
  train: d => d === 'gym' ? { t:'el gimnasio', b:[`<p>Entrena con pesas: elige una <b>rutina</b> o arma la tuya, y anota cada serie con su peso y repeticiones.</p>`,
      `<ul><li>Al marcar una serie arranca solo el <b>descanso</b>.</li><li>Te muestro lo que hiciste la vez pasada para que lo superes.</li><li>Guardo tus <b>récords</b>, el volumen y las calorías.</li></ul>`,
      `<p class="tip">En la barra de abajo cambias entre Boxeo, Gimnasio y Cardio. Todo suma a tu día.</p>`] }
    : { t:'el boxeo', b:[`<p>Todo lo de boxeo en un solo lugar: <b>timer de rounds</b>, semáforo, ruletas, sesiones guiadas, calentamientos y la escuelita.</p>`,
      `<ul><li>Elige una rutina del timer y dale play.</li><li><b>Sesiones:</b> arma tu clase y te guío paso a paso.</li><li><b>Modo clase:</b> para prestar el celular o dar clase a todos sin guardar nada en tus datos.</li></ul>`,
      `<p class="tip">Cada round que terminas suma calorías y cuida tu racha.</p>`] },
  timer: () => ({ t:'el timer', b:[`<p>Dale <b>play</b> y yo boxeo contigo: tiro golpes en el round, descanso en la pausa y celebro al final.</p>`,
      `<ul><li><b>Azul:</b> prepárate. <b>Verde:</b> ¡pelea! <b>Amarillo:</b> últimos segundos. <b>Rojo:</b> descanso.</li><li>El botón de la izquierda reinicia y el de la derecha salta a la siguiente fase.</li><li>Arriba a la derecha está el <b>semáforo</b>: pantalla completa que se ve desde lejos.</li><li>Toca el nombre del entrenamiento para cambiarlo.</li></ul>`,
      `<p class="tip">¿No se oye bien con el ruido del gimnasio? En Más activa <b>Gimnasio ruidoso</b>.</p>`] }),
  roulette: () => ({ t:'las ruletas', b:[`<p>Tres ruletas: <b>sparring</b> (consigna para el round), <b>combos</b> y <b>castigo</b>.</p>`, `<ul><li>Toca GIRAR o desliza la ruleta con el dedo.</li><li>Abajo agregas o quitas opciones (máximo 20).</li><li>“Restaurar originales” vuelve a las de fábrica.</li></ul>`] }),
  settings: () => ({ t:'los ajustes', b:[`<p>Aquí está lo tuyo y cómo funciona la app:</p>`, `<ul><li><b>Mi perfil y metas:</b> de ahí salen tus calorías.</li><li><b>Satronho Somnia:</b> cruza tu sueño con tus entrenos.</li><li><b>Apariencia:</b> oscuro, claro o automático.</li><li><b>Sonido:</b> volumen, pitidos y <b>Gimnasio ruidoso</b>.</li><li><b>Guía:</b> mostrarme, cambiar mi nombre y mi pinta.</li><li><b>Datos:</b> copia de seguridad para no perder nada.</li></ul>`,
      `<p class="tip">Haz una copia de seguridad cada cierto tiempo y guárdala en el correo o en Drive.</p>`] }),
  editor: () => ({ t:'cómo editar un entrenamiento', b:[`<p>Ajusta el tiempo de round, descanso, número de rounds, la preparación y el aviso final (pantalla amarilla y silbato).</p>`, `<p>Elige color e ícono para reconocerlo rápido. Mantén presionado + o − para avanzar rápido.</p>`] }),
  calendar: () => ({ t:'tu calendario', b:[`<p>Los días se pintan solos: <b>verde</b> entrenaste, <b>rojo</b> faltaste, <b>gris</b> descanso.</p>`, `<ul><li>Toca un día y márcalo: <b>Entrené</b>, <b>Falté</b> o <b>Descanso</b>.</li><li>Si eliges tus días de entreno en Mi perfil, las faltas se cuentan solas (borde punteado) y ves tu <b>% de cumplimiento</b>.</li><li>Los días de <b>descanso</b> no rompen tu racha.</li></ul>`] }),
  warmups: () => ({ t:'los calentamientos', b:[`<p>Rutinas de calentamiento que se reproducen paso a paso con tiempo y campana. Toca ▶ para empezar o la tarjeta para editarla.</p>`] }),
  warmupEdit: () => ({ t:'cómo editar un calentamiento', b:[`<p>Cambia el nombre, el color y los ejercicios con su tiempo. “Probar” lo reproduce de una.</p>`] }),
  psessions: () => ({ t:'tus sesiones', b:[`<p>Arma tu propia clase: escuelita, combos, pasos en L y en V, laterales, saco, lazo y más.</p>`, `<p>Toca ▶ y te guío ejercicio por ejercicio con tiempo, descanso y consejos.</p>`] }),
  psessionEdit: () => ({ t:'cómo preparar tu sesión', b:[`<p>Elige tu nivel y tu objetivo, agrega ejercicios y ajusta rounds, tiempo y descanso de cada uno. Ordénalos con las flechas.</p>`] }),
  weight: () => ({ t:'tu peso', b:[`<p>Registra tu peso <b>escribiéndolo</b> o con + y −. Ves tu cambio, tu meta y tu gráfico.</p>`,
      `<ul><li><b>IMC:</b> se calcula con tu altura. Si eres menor de 19 años uso las tablas de la OMS para tu edad y género.</li><li><b>Categoría:</b> te digo en qué categoría de boxeo estás (aficionado o profesional), su rango y cuánto margen tienes.</li><li>Con tu peso al día, las calorías de cada entreno salen más exactas.</li></ul>`] }),
  me: () => ({ t:'tu perfil', b:[`<p>Con tu <b>género, edad, altura y peso</b> calculo tu IMC, tu categoría y las calorías que gastas.</p>`, `<p>En <b>Mis días de entreno</b> marca los días que sueles entrenar: así el calendario cuenta tus faltas y los demás días son descanso que no rompe la racha.</p>`] }),
  traffic: () => ({ t:'el semáforo', b:[`<p>Toca la pantalla para iniciar o pausar.</p>`] }),
};

function guideContent(view){
  const f = GUIDE[view] || GUIDE.home; return f(S.disc);
}
function openGuide(view){
  view = view || current;
  const g = guideContent(view);
  openForm(`<div class="gtop">${companionArt()}<div class="speech"><small>¡QUIUBO<span data-notr>${userFirst() ? ', ' + esc(userFirst().toUpperCase()) : ''}</span>! <span data-notr>${esc(gName().toUpperCase())}</span> TE EXPLICA</small><b>${g.t.toUpperCase()}</b></div></div>
    <div class="gbody">${g.b.join('')}</div>
    <button class="btn pri" style="width:100%;margin-top:12px;--bc:var(--mode)" id="gOk">¡LISTO, A DARLE! 👊</button>
    <button class="linkbtn" id="gLook" style="width:100%;text-align:center">Cambiar de acompañante o vestir a MechaRidds</button>`, sh => { sh.querySelector('#gOk').addEventListener('click', closeForm); sh.querySelector('#gLook').addEventListener('click', () => { closeForm(); setTimeout(() => SFPets.openCompanion(), 250); }); });
  hideBubble();
}
let bubbleT = null;
function hideBubble(){ $('#guideBubble').classList.remove('show'); clearTimeout(bubbleT); }
const NO_FAB = ['timer','traffic','warmupPlay'];
function guideOnView(view){
  hideBubble();
  const show = S.guide && !NO_FAB.includes(view);
  $('#guideBtn').classList.toggle('show', !!show);
  if (!show || !S.guideTips) return;
  const key = view;
  S.seen = S.seen || {};
  if (S.seen[key]) return;
  S.seen[key] = 1; saveSettings();
  setTimeout(() => {
    if (current !== view) return;
    const g = guideContent(view);
    $('#guideBubble').innerHTML = `¡Quiubo<span data-notr>${userFirst() ? ', ' + esc(userFirst()) : ''}</span>! Soy <span data-notr>${esc(gName())}</span>. ¿Choquemos guantes y te explico <u>${esc(g.t.toLowerCase())}</u>? 👊`;
    $('#guideBubble').classList.add('show');
    bubbleT = setTimeout(hideBubble, 5200);
  }, 650);
}
$('#guideBtn').addEventListener('click', () => { hapticTap(); openGuide(); });
$('#guideBubble').addEventListener('click', () => openGuide());
$('#mSlot').addEventListener('click', () => openGuide('timer'));
/* Animación del guía con el timer y el semáforo */
let mascotState = '';
const MSTATE = { idle:'', prep:'prep', work:'fight', warn:'fight fast', rest:'rest', done:'win' };
function mascotSync(key){
  const st = MSTATE[key] ?? '';
  if (st === mascotState) return;
  mascotState = st;
  $$('#mSlot .boxer, #tMascot .boxer').forEach(svg => svg.setAttribute('class', 'boxer ' + st));
}
function guideRefresh(){
  const on = S.guide && S.guideTimer;
  $('#mSlot').classList.toggle('show', !!on); $('#tMascot').classList.toggle('show', !!on);
  if (current) guideOnView(current);
}
function paintMascots(){ mascotState = '__'; $('#mSlot').innerHTML = boxerSVG(); $('#tMascot').innerHTML = boxerSVG(); $('#guideBtn').innerHTML = companion() === 'mecha' ? boxerFace() : SFArt.headSVG(companion()); const f = $('#setGuideFace'); if (f) f.innerHTML = companionArt(); }
paintMascots();
function openLookForm(){
  const lk = lookOf();
  const draw = sh => {
    sh.querySelector('#lkPrev').innerHTML = boxerSVG('win', lk);
    sh.querySelectorAll('[data-lp]').forEach(b => b.classList.toggle('on', lk[b.dataset.lp] === b.dataset.lv));
  };
  let nm = ((S.guideName && S.guideName !== 'Tito') ? S.guideName : 'MechaRidds');
  openForm(`<h3 class="ftitle">ASÍ SE VE <span id="lkTitle">${esc(nm.toUpperCase())}</span></h3>
    <div id="lkPrev" style="width:150px;margin:0 auto 4px"></div>
    <label class="field"><span>Nombre del guía</span><input id="lkName" maxlength="16" value="${esc(nm)}" placeholder="MechaRidds" autocomplete="off"></label>
    ${Object.entries(LOOK_OPTS).map(([p, def]) => `<div class="field"><span>${def.t}</span><div class="lookrow">${def.o.map(([k, l, c]) => `<button type="button" data-lp="${p}" data-lv="${k}" title="${l}" aria-label="${def.t}: ${l}" style="--s:${c || 'transparent'}" class="${c ? '' : 'none'}"><i></i><small>${l}</small></button>`).join('')}</div></div>`).join('')}
    <div class="btnrow" style="margin-top:8px"><button class="btn" id="lkReset">ORIGINAL</button><button class="btn pri" id="lkOk" style="--bc:var(--mode)">GUARDAR</button></div>`, sh => {
    sh.querySelectorAll('[data-lp]').forEach(b => b.addEventListener('click', () => { lk[b.dataset.lp] = b.dataset.lv; hapticTap(); draw(sh); }));
    sh.querySelector('#lkName').addEventListener('input', e => { nm = e.target.value; sh.querySelector('#lkTitle').textContent = (nm.trim() || 'MechaRidds').toUpperCase(); });
    sh.querySelector('#lkReset').addEventListener('click', () => { Object.assign(lk, LOOK_DEFAULT); nm = 'MechaRidds'; sh.querySelector('#lkName').value = nm; sh.querySelector('#lkTitle').textContent = 'MECHARIDDS'; draw(sh); });
    sh.querySelector('#lkOk').addEventListener('click', () => { S.look = Object.assign({}, lk); S.guideName = (nm.trim() || 'MechaRidds').slice(0, 16); saveSettings(); const gi = $('#gName'); if (gi) gi.value = S.guideName; paintMascots(); closeForm(); toast(TF('¡{s} estrena pinta! 🥊', gName())); });
    draw(sh);
  });
}

/* =========================================================
   MODO: NAVEGACIÓN PROPIA Y COLOR
   ========================================================= */
const NAV_ICONS = {
  home:'<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  train:'<path d="M6.5 7.5v9M3.5 10v4M17.5 7.5v9M20.5 10v4M6.5 12h11"/>',
  nutri:'<path d="M12 7.2c-1.3-1.7-3.2-2.2-4.8-1.5-2.3 1-3.2 3.6-2.6 6.300.7 3.300 3 7.500 5.400 7.500.8 0 1.300-.4 2-.4s1.200.4 2 .4c2.400 0 4.700-4.200 5.400-7.500.6-2.700-.3-5.300-2.600-6.300-1.600-.7-3.500-.2-4.800 1.500z"/><path d="M12 7.2c0-2 .9-3.400 2.600-4.200"/>',
  progress:'<path d="M4 20V11M10 20V4M16 20v-6M21 20H3"/>',
  settings:'<circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/>',
};
const NAV_LABELS = { home:'HOY', train:'ENTRENAR', nutri:'COMIDA', progress:'PROGRESO', settings:'MÁS' };
function renderNav(){
  $('#navBtns').innerHTML = NAV_ORDER.map(v => `<button data-nav="${v}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${NAV_ICONS[v]}</svg>${NAV_LABELS[v]}</button>`).join('');
  $$('#navBtns [data-nav]').forEach(b => b.addEventListener('click', () => { hapticTap(); go(b.dataset.nav); }));
  const idx = NAV_ORDER.indexOf(NAV_PARENT[current] || current);
  $$('#nav button').forEach((b, i) => b.classList.toggle('on', i === idx));
  $('#navInd').style.opacity = idx >= 0 ? '1' : '0';
  if (idx >= 0) requestAnimationFrame(() => positionNavInd(idx));
}
// La disciplina activa (boxeo o gimnasio) solo cambia el color y lo que Entrenar muestra primero: todo se guarda igual
function applyModeUI(){
  document.documentElement.dataset.mode = S.disc === 'gym' ? 'gym' : 'box';
  renderNav();
}
function setDisc(d){
  if (S.disc === d) return;
  S.disc = d; saveSettings(); hapticTap(); applyModeUI();
}

const pl = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const hsecHead = (ic, t, sub, c) => `<div class="hh" style="--c:${c}"><span class="hic">${ic}</span><span><b>${t}</b><small>${sub}</small></span></div>`;
const hsec = (ic, t, sub, c, inner) => `<section class="hsec" style="--c:${c}">${hsecHead(ic, t, sub, c)}${inner}</section>`;
const toolTiles = () => `<button class="tile" style="--c:#d98585;--i:1" data-open="timer"><span>⏱️</span><b>TIMER</b><small>Rounds y descansos</small></button>
  <button class="tile" style="--c:#6fa87c;--i:2" data-open="traffic"><span>🚦</span><b>SEMÁFORO</b><small>Se ve de lejos</small></button>
  <button class="tile" style="--c:#9d8fd0;--i:3" data-open="roulette"><span>🎡</span><b>RULETAS</b><small>Sparring, combos, castigo</small></button>`;

/* =========================================================
   AJUSTES EXTRA: GUÍA, COPIA DE SEGURIDAD
   ========================================================= */
function renderSettingsExtra(){
  $('#gName').value = gName(); $('#gName').disabled = companion() !== 'mecha';
  $('#setGuideFace').innerHTML = companionArt();
}
$('#gName').addEventListener('input', e => { if (companion() === 'mecha'){ S.guideName = e.target.value.slice(0, 16); saveSettings(); } });
$('#gLookBtn').addEventListener('click', () => SFPets.openCompanion());
$('#gReset').addEventListener('click', () => { S.seen = {}; saveSettings(); toast(TF('{s} volverá a explicarte cada sección', gName())); });
$('#bkExport').addEventListener('click', () => {
  const data = {}; for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (k && k.startsWith('bfp2_')) data[k] = localStorage.getItem(k); }
  saveFile(`satronho-boxfit-respaldo-${todayISO()}.json`, JSON.stringify({ app:'BoxfitPro', name:'Satronho BoxFit', v:4, date: new Date().toISOString(), data }), 'application/json');
});
$('#bkImport').addEventListener('click', () => $('#bkFile').click());
$('#bkFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); if (!j || j.app !== 'BoxfitPro' || !j.data) throw 0;
    if (!await confirmDlg('¿Restaurar copia?', `Copia del ${niceDate(j.date.slice(0,10)).toLowerCase()}. Se reemplazarán TODOS los datos actuales de la app.`, 'RESTAURAR')) return;
    Object.keys(localStorage).filter(k => k.startsWith('bfp2_')).forEach(k => localStorage.removeItem(k));
    Object.entries(j.data).forEach(([k, v]) => { if (k.startsWith('bfp2_')) localStorage.setItem(k, v); });
    toast('Copia restaurada. Reiniciando…'); setTimeout(() => location.reload(), 900);
  } catch(err){ toast('Ese archivo no es una copia de Satronho BoxFit'); }
});

/* ---- Registro de vistas nuevas ---- */
Object.assign(NAV_PARENT, { me:'settings' });
Object.assign(BACK_TO, { me:'settings' });
Object.assign(VIEW_RENDER, { me: renderMe });
applyModeUI();
guideRefresh();

/* =========================================================
   TEMA: OSCURO / CLARO / AUTOMÁTICO
   ========================================================= */
const SysBars = plugin('SystemBars');
const darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
const resolvedTheme = () => S.theme === 'auto' ? (darkMQ && !darkMQ.matches ? 'light' : 'dark') : S.theme;
const ICON_SUN = '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/>';
const ICON_MOON = '<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/>';
function paintTheme(){
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = t === 'light' ? '#f2f3f7' : '#09090c';
  if (SysBars && SysBars.setStyle) SysBars.setStyle({ style: t === 'light' ? 'LIGHT' : 'DARK' }).catch(()=>{});
  $('#themeIcon').innerHTML = t === 'light' ? ICON_MOON : ICON_SUN;
  $$('#themeSeg [data-theme-set]').forEach(b => b.classList.toggle('on', b.dataset.themeSet === S.theme));
  if (current === 'roulette') drawWheel();
}
function applyTheme(next){
  S.theme = next; saveSettings(); hapticTap();
  const before = document.documentElement.dataset.theme, willBe = resolvedTheme();
  if (before === willBe || matchMedia('(prefers-reduced-motion: reduce)').matches){ paintTheme(); return; }
  // Cambio de un solo golpe (sin que cada tarjeta cambie de color a destiempo) y un fundido corto encima.
  // Antes era un círculo con View Transitions: en Android se sentía lento y raro.
  const veil = document.createElement('div');
  veil.style.cssText = `position:fixed;inset:0;z-index:99999;pointer-events:none;background:${getComputedStyle(document.body).backgroundColor};opacity:1;transition:opacity .24s ease-out`;
  document.body.appendChild(veil);
  document.documentElement.classList.add('notrans');
  paintTheme(); void document.body.offsetWidth;
  requestAnimationFrame(() => { document.documentElement.classList.remove('notrans'); veil.style.opacity = '0'; setTimeout(() => veil.remove(), 300); });
}
$('#themeBtn').addEventListener('click', () => applyTheme(resolvedTheme() === 'light' ? 'dark' : 'light'));
$$('#themeSeg [data-theme-set]').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.themeSet)));
// Tamaño de letra: agranda toda la interfaz (zoom de CSS), se guarda en los ajustes
function paintZoom(){ const z = +S.zoom || 1; document.documentElement.style.zoom = z === 1 ? '' : z; $$('#zoomSeg [data-zoom]').forEach(b => b.classList.toggle('on', +b.dataset.zoom === z)); }
$$('#zoomSeg [data-zoom]').forEach(b => b.addEventListener('click', () => { S.zoom = +b.dataset.zoom; saveSettings(); hapticTap(); paintZoom(); window.dispatchEvent(new Event('resize')); }));
paintZoom();
if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', () => { if (S.theme === 'auto') paintTheme(); });
paintTheme();

/* =========================================================
   11. ARRANQUE
   ========================================================= */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible'){ update(); if (isActive() && !T.paused) keepAwake(true); } });
document.addEventListener('pointerdown', () => audio(), { once:true });
updateChip();
render(true);
// El arranque lo llama el último script (js/sf-boot.js), cuando ya cargaron todos los módulos
function bootApp(){ setMode('sparring'); go(S.askAtStart ? 'home' : 'train'); requestAnimationFrame(loop); }
