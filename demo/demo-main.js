const CELLS = [
  { label: 'Idle', mood: 'idle', name: 'Pip' },
  { label: 'Watching you type', mood: 'watching', name: 'Pip' },
  { label: 'Thinking', mood: 'thinking', name: 'Pip' },
  { label: 'Talking', mood: 'talking', name: 'Pip' },
  { label: 'Picked up', mood: 'held', name: 'Pip' },
  { label: 'Running a command', mood: 'working', work: 'run', name: 'Pip' },
  { label: 'Reading a file', mood: 'working', work: 'read', name: 'Pip' },
  { label: 'Searching files', mood: 'working', work: 'search', name: 'Pip' },
  { label: 'Searching the web', mood: 'working', work: 'web', name: 'Pip' },
  { label: 'Editing a file', mood: 'working', work: 'edit', name: 'Pip' },
  { label: 'Using another tool', mood: 'working', work: 'tool', name: 'Pip' },
  { label: 'Needs you (a question or approval)', mood: 'needs', name: 'Pip' },
  { label: 'Finished', mood: 'done', name: 'Pip' },
  { label: 'Run failed', mood: 'failed', name: 'Pip' },
  { label: 'Commands keep failing', mood: 'working', work: 'run', stress: 2, name: 'Pip' },
  { label: 'Phew, a command passed', mood: 'working', work: 'run', relief: true, name: 'Pip' },
  { label: 'Context nearly full (yawns)', mood: 'idle', context: 0.95, name: 'Pip' },
  { label: 'Context filling up', mood: 'thinking', context: 0.72, name: 'Pip' },
  { label: 'Messages queued (nibbles them)', mood: 'thinking', queued: 4, chew: true, name: 'Pip' },
  { label: 'Asleep', mood: 'sleeping', name: 'Pip' },
  { label: 'Visitors and helpers join in', mood: 'thinking', minis: true, name: 'Pip' },
  { label: 'BB Architect: hard hat', mood: 'idle', name: 'BB Architect' },
  { label: 'Business Coach: tie', mood: 'idle', name: 'Business Coach' },
  { label: 'Reminder: bell', mood: 'idle', name: 'Reminder' },
  { label: 'Tuthill Design: beret', mood: 'idle', name: 'Tuthill Design' },
  { label: 'Studio C: headphones', mood: 'idle', name: 'Studio C' },
  { label: 'S2P Manager: glasses', mood: 'idle', name: 'S2P Manager' },
  { label: 'Others: antenna, sprout or bow', mood: 'idle', name: 'Zed' },
];
const SHAPES = ['blob', 'capsule', 'cloud', 'round', 'triangle', 'squircle', 'hexagon'];
const COLORS = ['#f08a24', '#2f9e6e', '#e8483f', '#e44f67', '#5b8def', '#9b6bd6', '#d1a62b'];
const W = 280, H = 300, dpr = window.devicePixelRatio || 1;
const grid = document.getElementById('grid');
const actors = CELLS.map((c, i) => {
  const wrap = document.createElement('figure');
  const cv = document.createElement('canvas');
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const cap = document.createElement('figcaption'); cap.textContent = c.label;
  wrap.append(cv, cap); grid.append(wrap);
  const shape = SHAPES[i % SHAPES.length], color = COLORS[i % COLORS.length];
  const bot = { id: 'bot_' + c.name, name: c.name, avatar: { shape, color, motion: 'playful', expression: 'neutral' } };
  const tune = { gravity: 1400, softness: shape === 'cloud' ? 0.85 : shape === 'triangle' ? 0.55 : 0.7, firmness: 0.3, stretch: 0.5, friction: 0.5, bounce: 0, tearDistance: 30 };
  const body = new SoftBody(restParticles(shape, 11.5, 1), { x: W / 2, y: H - 90 }, 11.5, tune);
  const world = { bounds: { left: 4, top: 4, right: W - 4, bottom: H - 4 }, solids: [] };
  if (c.mood === 'held') { body.grab(W / 2, H - 90); body.moveHand(W / 2, 70); }
  return { ...c, bot, body, world, ctx: cv.getContext('2d'), acc: 0, shape, color, born: performance.now() };
});
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (const a of actors) {
    a.acc = Math.min(a.acc + dt, STEP * 8);
    while (a.acc >= STEP) { a.body.step(STEP, a.world); a.acc -= STEP; }
    const talk = a.mood === 'talking' ? Math.min(1, Math.max(0, Math.sin(now / 85) * 0.6 + Math.sin(now / 211) * 0.5 + 0.15)) : 0;
    let scale = 1 + 0.016 * Math.sin(now / 950) + talk * 0.05 + (a.mood === 'working' ? 0.018 * Math.sin(now / 130) : 0);
    if (a.mood === 'failed') scale *= 0.94;
    if (a.mood === 'sleeping') scale = 1 + 0.025 * Math.sin(now / 1500);
    a.body.restScale = scale;
    if (a.mood === 'needs' && a.body.grounded && now > (a.hopAt || 0)) { a.body.impulse(0, -260); a.hopAt = now + 1500; }
    const c = a.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W * dpr, H * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = false;
    drawBody(c, a.body, a.color, []);
    drawFace(c, a.bot, a.body, {
      mood: a.mood, expr: 'base', gaze: a.mood === 'watching' ? { x: W - 20, y: H - 40 } : null, talk, now,
      work: a.work, stress: a.stress || 0, relief: !!a.relief, context: a.context ?? null,
      queued: a.queued ? Math.max(1, a.queued - (a.chew ? Math.floor(now / 2500) % 4 : 0)) : 0,
      chewing: !!a.chew && now % 2500 < 800,
    });
    if (a.minis) {
      const baseY = H - 20;
      drawMini(c, W - 40, baseY, 'round', '#5b8def', 1, now, 0, true);
      drawMini(c, W - 70, baseY, 'triangle', '#e44f67', 1, now, 1.7, true);
      drawMini(c, 40, baseY, a.shape, a.color, 1, now, 2.3, true);
    }
  }
}
requestAnimationFrame(frame);
document.getElementById('theme').onclick = () => document.body.classList.toggle('dark');
