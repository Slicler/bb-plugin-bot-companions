const PRESETS = [
  { name: 'BB Architect', shape: 'capsule', color: '#f08a24' },
  { name: 'Business Coach', shape: 'blob', color: '#2f9e6e' },
  { name: 'Reminder', shape: 'cloud', color: '#e8a33d' },
  { name: 'Tuthill Design', shape: 'capsule', color: '#e8e8e8' },
  { name: 'Studio C', shape: 'blob', color: '#e8483f' },
  { name: 'S2P Manager', shape: 'blob', color: '#e44f67' },
  { name: 'Pip', shape: 'triangle', color: '#5b8def' },
];
const FRIENDS = [
  { shape: 'round', color: '#5b8def' }, { shape: 'triangle', color: '#e44f67' }, { shape: 'hexagon', color: '#9b6bd6' },
];
const $ = (id) => document.getElementById(id);
const pane = $('pane'), canvas = $('stage'), composer = $('composer'), box = $('box'), readout = $('readout');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;
let W = 0, H = 0;
function fit() {
  W = pane.clientWidth; H = pane.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
}
fit(); window.addEventListener('resize', fit);

let preset = PRESETS[0];
let bot = null, body = null;
const STATE = {
  busy: false, work: null, workUntil: 0, stress: 0, queued: 0, context: 0.2, pending: false, talking: false,
  outcome: null, helpers: 0, guests: 0, typedAt: -1e9, lastActive: 0, grewAt: -1e9,
  reliefUntil: 0, chewUntil: 0, wakeUntil: 0, nextHop: 0, nextShake: 0,
};
const arrived = [];
let prevMood = 'idle', expr = 'base', nextBlink = 0, blinkUntil = 0, caret = null, look = null;
let held = false;

function spawn() {
  bot = { id: 'bot_' + preset.name, name: preset.name, avatar: { shape: preset.shape, color: preset.color, motion: 'playful', expression: 'neutral' } };
  const soft = preset.shape === 'cloud' ? 0.85 : preset.shape === 'triangle' ? 0.55 : 0.7;
  const tune = { gravity: 1400, softness: soft, firmness: 0.3, stretch: 0.5, friction: 0.5, bounce: 0, tearDistance: 30 };
  const c = composer.getBoundingClientRect(), p = pane.getBoundingClientRect();
  body = new SoftBody(restParticles(preset.shape, 11.5, 1), { x: c.left - p.left + 90, y: c.top - p.top - 140 }, 11.5, tune);
}
spawn();

function rectOf(el) {
  const r = el.getBoundingClientRect(), p = pane.getBoundingClientRect();
  return { left: r.left - p.left, top: r.top - p.top, right: r.right - p.left, bottom: r.bottom - p.top };
}

// ── Controls ──
const now0 = () => performance.now();
function wake() { STATE.lastActive = now0(); }
const act = {
  task: () => { STATE.busy = true; STATE.outcome = null; },
  work: (k) => { act.task(); STATE.work = k; STATE.workUntil = now0() + 6000; },
  fail: () => { act.task(); STATE.stress = Math.min(3, STATE.stress + 1); },
  pass: () => { if (STATE.stress > 0) STATE.reliefUntil = now0() + 1400; STATE.stress = 0; },
  ask: () => { act.task(); STATE.pending = true; },
  answer: () => { STATE.pending = false; },
  talk: () => { act.task(); STATE.talking = !STATE.talking; $('talk').classList.toggle('on', STATE.talking); },
  finish: (turn) => {
    STATE.busy = false; STATE.talking = false; $('talk').classList.remove('on');
    STATE.outcome = { at: now0(), turn }; STATE.work = null; STATE.stress = 0; STATE.queued = 0; STATE.pending = false;
  },
  queue: () => { act.task(); STATE.queued = Math.min(6, STATE.queued + 1); },
  send: () => { if (STATE.queued > 0) { STATE.queued--; STATE.chewUntil = now0() + 800; } },
  sleep: () => { STATE.lastActive = -1e9; STATE.busy = false; STATE.outcome = null; STATE.work = null; STATE.pending = false; STATE.talking = false; },
  home: () => spawn(),
};
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
  wake();
  const [name, arg] = b.dataset.act.split(':');
  act[name](arg);
}));
$('guest').onclick = () => { STATE.guests = (STATE.guests + 1) % 4; $('guest').textContent = 'Visitors: ' + STATE.guests; wake(); };
$('helper').onclick = () => { STATE.helpers = (STATE.helpers + 1) % 4; $('helper').textContent = 'Helpers: ' + STATE.helpers; wake(); };
$('ctx').oninput = (e) => { STATE.context = e.target.value / 100; $('ctxv').textContent = e.target.value + '%'; };
$('who').innerHTML = PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
$('who').onchange = (e) => { preset = PRESETS[+e.target.value]; spawn(); wake(); };
$('theme').onclick = () => document.body.classList.toggle('dark');
box.addEventListener('input', () => {
  STATE.typedAt = now0(); wake();
  const c = composer.getBoundingClientRect(), p = pane.getBoundingClientRect();
  const s = window.getSelection(), r = s && s.rangeCount ? null : null;
  caret = { x: c.left - p.left + 40 + Math.min(box.value.length * 7, c.width - 80), y: c.top - p.top + 28 };
});
box.addEventListener('focus', () => wake());

// ── Dragging ──
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  if (body.grab(e.clientX - r.left, e.clientY - r.top)) { held = true; canvas.setPointerCapture(e.pointerId); wake(); }
});
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  look = { x: e.clientX - r.left, y: e.clientY - r.top };
  if (held) body.moveHand(look.x, look.y);
});
const drop = () => { if (held) { held = false; body.release(); } };
canvas.addEventListener('pointerup', drop);
canvas.addEventListener('pointercancel', drop);

// ── Loop ──
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const world = { bounds: { left: 4, top: 4, right: W - 4, bottom: H - 4 }, solids: [rectOf(composer)] };
  acc = Math.min(acc + dt, STEP * 8);
  while (acc >= STEP) { body.step(STEP, world); acc -= STEP; }

  const S = STATE;
  if (S.talking) S.grewAt = now;
  const working = S.busy && now < S.workUntil && S.work;
  const ended = S.outcome && now - S.outcome.at < 2800 ? S.outcome.turn : 'none';
  const awake = body.held ? 'held' : S.pending ? 'needs' : working ? 'working' : S.busy && now - S.grewAt < 600 ? 'talking'
    : S.busy ? 'thinking' : ended === 'ok' ? 'done' : ended === 'failed' ? 'failed' : now - S.typedAt < 1500 ? 'watching' : 'idle';
  if (awake !== 'idle') S.lastActive = now;
  const hour = new Date().getHours();
  const mood = awake === 'idle' && now - S.lastActive > (hour >= 23 || hour < 6 ? 120000 : 360000) ? 'sleeping' : awake;
  if (prevMood === 'sleeping' && mood !== 'sleeping') S.wakeUntil = now + 700;
  if (mood !== prevMood) { if (mood === 'done') body.impulse(0, -340); prevMood = mood; }
  if (mood === 'needs' && now >= S.nextHop && body.grounded) { body.impulse(0, -260); S.nextHop = now + 1500; }
  if (mood === 'working' && S.stress >= 3 && now >= S.nextShake) { body.impulse((Math.random() - 0.5) * 160, -60); S.nextShake = now + 900; }

  const talk = mood === 'talking' ? Math.min(1, Math.max(0, Math.sin(now / 85) * 0.6 + Math.sin(now / 211) * 0.5 + 0.15)) : 0;
  let scale = 1 + (mood === 'idle' || mood === 'watching' ? 0.01 : 0.016) * Math.sin(now / 950) + talk * 0.05 + (mood === 'working' ? 0.018 * Math.sin(now / 130) : 0);
  if (mood === 'failed') scale *= 0.94;
  else if (mood === 'sleeping') scale = 1 + 0.025 * Math.sin(now / 1500);
  else if (now < S.wakeUntil) scale += 0.05;
  body.restScale = scale;
  if (now > nextBlink) { blinkUntil = now + 140; nextBlink = now + 2500 + Math.random() * 5500; }
  expr = now < S.wakeUntil ? 'wide' : now < blinkUntil && mood !== 'held' ? 'blink' : 'base';

  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W * dpr, H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false;
  drawDrops(ctx, body.drops, bot.avatar.color);
  drawBody(ctx, body, bot.avatar.color, world.solids);
  drawFace(ctx, bot, body, {
    mood, expr, gaze: mood === 'watching' ? caret : look, talk, now, work: mood === 'working' ? S.work : null,
    stress: S.busy ? S.stress : 0, relief: now < S.reliefUntil, context: S.context, queued: S.queued, chewing: now < S.chewUntil, waking: now < S.wakeUntil,
  });
  const baseY = world.solids[0].top - 3;
  const show = S.busy || S.pending;
  for (let i = 0; i < (show ? S.guests : 0); i++) {
    if (!arrived[i]) arrived[i] = now;
    const walk = Math.min(1, (now - arrived[i]) / 1200);
    const target = W - 4 - (24 + i * 30);
    const f = FRIENDS[i % FRIENDS.length];
    drawMini(ctx, target + (1 - walk) ** 2 * (W + 20 - target), baseY, f.shape, f.color, 1, now, i * 1.7, true);
  }
  if (!show || S.guests === 0) arrived.length = 0;
  for (let i = 0; i < S.helpers; i++) drawMini(ctx, 28 + i * 30, baseY, bot.avatar.shape, bot.avatar.color, 1, now, i * 2.3, true);

  readout.textContent = `mood: ${mood}${mood === 'working' ? ' (' + S.work + ')' : ''}  ·  failed commands: ${S.stress}  ·  queued: ${S.queued}  ·  context: ${Math.round(S.context * 100)}%`;
}
requestAnimationFrame(frame);

// A link like playground.html#work:run,fail,fail starts with those buttons already pressed.
for (const name of decodeURIComponent(location.hash.slice(1)).split(',').filter(Boolean)) {
  const b = document.querySelector('[data-act="' + name + '"]') || document.getElementById(name);
  if (b) b.click();
}
