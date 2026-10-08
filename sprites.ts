import type { Bot } from './server';
import type { Drop, SoftBody } from './softbody';
export const SIZE=112.5;
const BODY_UNIT_PX=9.375; // Original 6.25-unit silhouette × 1.5, independent of block pitch.
export const PIXEL=7.94; // ~15% bigger blocks for ~25% fewer of them; eyes stay the same size.
/** Everything drawn is multiplied by view.k: 1 on desktop, smaller on phones. */
export const view = { k: 1 };
/** Screen-size scale: full size on desktop, about 60% on a phone. */
export function screenScale(): number {
  const w = Math.min(window.innerWidth, window.innerHeight * 1.2);
  return w <= 640 ? 0.6 : w <= 1000 ? 0.8 : 1;
}
export function shapeDistance(shape:string,u:number,v:number,phase:number,fluid:number){
  u-=Math.sin(v*.7+phase)*fluid*.32;v-=Math.cos(u*.6-phase)*fluid*.23;
  switch(shape){
    case 'triangle':return Math.max((Math.abs(u)-.54*(v+4.4))/.88,v-3.7,-v-4.4);
    case 'cloud':return Math.min(Math.hypot(u+2.8,v-.7)-2.1,Math.hypot(u+.8,v+1.1)-2.6,Math.hypot(u-2,v+.1)-2.4,Math.hypot(u-.1,v-1.7)-2.3);
    case 'blob':return Math.hypot(u/.91,v/1.07)-3.8-fluid*.2*Math.sin(Math.atan2(v,u)*3+phase);
    case 'squircle':return Math.pow(Math.abs(u)**4+Math.abs(v)**4,.25)-3.7;
    case 'capsule':return Math.hypot(Math.max(0,Math.abs(u)-1.5),v)-2.6;
    case 'hexagon':return Math.max(Math.abs(u)*.866+Math.abs(v)*.5,Math.abs(v))-3.5;
    default:return Math.hypot(u,v)-3.8;
  }
}
export function sprite(bot:Bot):string{
  let marks='';for(let y=0;y<12;y++)for(let x=0;x<12;x++)if(shapeDistance(bot.avatar.shape,x-5.5,y-5.5,0,0)<=0)marks+=`<rect x="${x}" y="${y}" width="1" height="1" fill="${bot.avatar.color}"/>`;
  marks+='<path d="M4 6h1v1H4zm3 0h1v1H7z" fill="#101713"/>';
  return 'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" shape-rendering="crispEdges">${marks}</svg>`);
}

// ── Soft-body rendering ─────────────────────────────────────────────────

/** Particle rest positions filling the bot's silhouette, in px from its center. */
export function restParticles(shape: string, spacing: number, k = 1): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const BODY_UNIT = BODY_UNIT_PX * k;
  const reach = 6 * BODY_UNIT;
  for (let y = -reach; y <= reach; y += spacing)
    for (let x = -reach; x <= reach; x += spacing * 0.866) {
      // Hex-ish packing: offset alternate columns for an even fill.
      const col = Math.round((x + reach) / (spacing * 0.866));
      const yy = y + (col % 2 ? spacing / 2 : 0);
      if (shapeDistance(shape, x / BODY_UNIT, yy / BODY_UNIT, 0, 0) <= -0.35) out.push({ x, y: yy });
    }
  return out;
}

/**
 * Fill every grid cell whose metaball field (summed from the particles)
 * crosses the threshold. The grid is fixed to the screen, so the body is
 * always made of the same square blocks and its edge crawls cell by cell as
 * it moves and deforms, like liquid pixels.
 */
export function drawBody(ctx: CanvasRenderingContext2D, body: SoftBody, color: string, solids: { left: number; top: number; right: number; bottom: number }[] = []) {
  const cell = PIXEL * view.k;
  const R = body.spacing * 1.35;
  const R2 = R * R;
  const box = body.bbox(R);
  const scale = ctx.getTransform().a;
  const snap = (n: number) => Math.round(n * scale) / scale;
  const x0 = Math.floor(box.left / cell);
  const x1 = Math.ceil(box.right / cell);
  const y0 = Math.floor(box.top / cell);
  const y1 = Math.ceil(box.bottom / cell);
  const ps = body.particles;
  // Hysteresis: a cell turns on above ON and only turns off below OFF, so
  // edges don't flicker from tiny jiggles.
  const ON = 0.46;
  const OFF = 0.33;
  const was = body.cells;
  const now = new Set<number>();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let iy = y0; iy <= y1; iy++) {
    const cy = (iy + 0.5) * cell;
    for (let ix = x0; ix <= x1; ix++) {
      const cx = (ix + 0.5) * cell;
      let field = 0;
      for (const p of ps) {
        const dx = cx - p.x;
        const dy = cy - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R2) continue;
        const f = 1 - d2 / R2;
        field += f * f;
        if (field >= ON) break;
      }
      // Strands between neighbours keep a stretched body continuous (until
      // it actually tears).
      if (field < ON) {
        for (const [i, j] of body.links) {
          const a = ps[i];
          const b = ps[j];
          const sx = b.x - a.x;
          const sy = b.y - a.y;
          const len2 = sx * sx + sy * sy;
          if (len2 < body.spacing * body.spacing * 1.6 || len2 > body.spacing * body.spacing * 36) continue;
          const t = Math.max(0, Math.min(1, ((cx - a.x) * sx + (cy - a.y) * sy) / len2));
          const dx = cx - (a.x + sx * t);
          const dy = cy - (a.y + sy * t);
          const d2 = dx * dx + dy * dy;
          if (d2 >= R2) continue;
          const f = 1 - d2 / R2;
          field = Math.max(field, f * f * 0.75);
          if (field >= ON) break;
        }
      }
      // Never draw into a solid surface (no stray block poking into the box).
      if (solids.some((r) => cx > r.left && cx < r.right && cy > r.top && cy < r.bottom)) continue;
      const key = iy * 100003 + ix;
      if (field >= ON || (field >= OFF && was.has(key))) {
        now.add(key);
        const a = snap(ix * cell);
        const b = snap(iy * cell);
        ctx.rect(a, b, snap((ix + 1) * cell) - a, snap((iy + 1) * cell) - b);
      }
    }
  }
  body.cells = now;
  ctx.fill();
}

/** Shed bits: full cells while fresh, then crumbling into smaller pieces. */
export function drawDrops(ctx: CanvasRenderingContext2D, drops: Drop[], color: string) {
  const cell = PIXEL * view.k;
  const scale = ctx.getTransform().a;
  const snap = (n: number) => Math.round(n * scale) / scale;
  ctx.fillStyle = color;
  for (const q of drops) {
    const life = q.age / q.life;
    const gx = Math.floor(q.x / cell) * cell;
    const gy = Math.floor(q.y / cell) * cell;
    ctx.globalAlpha = life < 0.6 ? 1 : 1 - (life - 0.6) / 0.4;
    if (life < 0.45) {
      // Splatted drops spread sideways into a short puddle.
      for (let i = 0; i < q.size; i++) ctx.fillRect(snap(gx + (i - Math.floor(q.size / 2)) * cell), snap(gy), snap(cell), snap(cell));
    } else {
      // Crumbling: quarter-cells that drift apart and vanish one by one.
      const bits = Math.max(1, Math.round((1 - life) * 4 * q.size));
      const half = cell / 2;
      for (let i = 0; i < bits; i++) {
        const ox = ((i * 37) % 3) - 1;
        const oy = (i * 53) % 2;
        ctx.fillRect(snap(gx + ox * half * (1 + life)), snap(gy + oy * half), snap(half), snap(half));
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ── Faces ───────────────────────────────────────────────────────────────
// Eyes and mouths are tiny pixel patterns ('#' = a dark block), drawn at a
// fixed 3.125px unit so they stay the same size whatever the body does. Left
// eye patterns are mirrored for the right eye.

export type Mood = 'idle' | 'watching' | 'thinking' | 'talking' | 'held';
export type Expression = 'base' | 'dot' | 'wide' | 'narrow' | 'happy' | 'blink' | 'lookL' | 'lookR' | 'lookUp' | 'surprised' | 'focused' | 'up';

const EYES: Record<string, string[]> = {
  dot: ['##', '##'],
  wide: ['.##.', '####', '####', '.##.'],
  narrow: ['####'],
  happy: ['.##.', '#..#'],
  blink: ['###'],
  sleepy: ['###'],
  mischief: ['#..', '##.', '.##', '..#'],
  surprised: ['###', '#.#', '###'],
  focused: ['###', '###'],
  up: ['##', '##'],
};
const MOUTHS: Record<string, string[]> = {
  closed: ['####'],
  small: ['##', '##'],
  open: ['.##.', '####', '####', '.##.'],
  o: ['.#.', '#.#', '.#.'],
  smile: ['#..#', '.##.'],
};

/** The bot's resting eyes, from its avatar shape. */
export function baseEyes(bot: Bot): string {
  const shape = bot.avatar.shape;
  return shape === 'round' ? 'happy' : shape === 'cloud' ? 'dot' : shape === 'triangle' ? 'mischief' : 'sleepy';
}

export interface FaceState {
  mood: Mood;
  expr: Expression;
  gaze: { x: number; y: number } | null;
  talk: number; // 0..1 mouth openness
  now: number;
}

export function drawFace(ctx: CanvasRenderingContext2D, bot: Bot, body: SoftBody, face: FaceState) {
  const f = body.frame;
  const scale = ctx.getTransform().a;
  const snap = (n: number) => Math.round(n * scale) / scale;
  const k = view.k;
  const U = 3.125 * k;
  const ek = 0.45 + 0.55 * k; // eye spacing eases off a little less than the body
  const block = (x: number, y: number) => ctx.fillRect(snap(x), snap(y), snap(x + U) - snap(x), snap(y + U) - snap(y));
  const pattern = (rows: string[], cx: number, cy: number, mirror = false, u = U) => {
    const w = rows[0].length;
    const h = rows.length;
    const x0 = cx - (w * u) / 2;
    const y0 = cy - (h * u) / 2;
    rows.forEach((row, r) =>
      [...row].forEach((c, k) => {
        if (c !== '#') return;
        const x = x0 + (mirror ? w - 1 - k : k) * u;
        const y = y0 + r * u;
        ctx.fillRect(snap(x), snap(y), snap(x + u) - snap(x), snap(y + u) - snap(y));
      }),
    );
  };

  const held = body.held;
  const shape = bot.avatar.shape;
  const at = body.faceAt;
  const lift = held ? 0 : shape === 'triangle' ? 9 * k : 0;
  // Squash the face spacing a little with the body, but never rotate it.
  const wide = held ? 1 : Math.max(0.8, Math.min(1.3, Math.hypot(f.a, f.c)));

  // Which eyes: mood first, then the idle expression, then the bot's own.
  let eyes = baseEyes(bot);
  let dx = 0;
  let dy = 0;
  if (face.mood === 'held') eyes = 'surprised';
  else if (face.mood === 'thinking') {
    eyes = 'up';
    dx = 1.4 * U;
    dy = -1.6 * U;
  } else if (face.mood === 'watching') eyes = 'focused';
  else if (face.mood === 'talking') eyes = face.talk > 0.6 ? 'happy' : baseEyes(bot);
  if (face.expr === 'blink') eyes = 'blink';
  else if (face.mood === 'idle' && face.expr !== 'base') {
    if (face.expr === 'lookL') {
      eyes = 'dot';
      dx = -1.6 * U;
    } else if (face.expr === 'lookR') {
      eyes = 'dot';
      dx = 1.6 * U;
    } else if (face.expr === 'lookUp') {
      eyes = 'dot';
      dy = -1.4 * U;
    } else eyes = face.expr;
  }
  // Gaze: eyes drift toward what it's looking at (the caret, your cursor).
  if (face.gaze && (face.mood === 'watching' || (face.mood === 'idle' && face.expr === 'base') || face.mood === 'talking')) {
    const gx = face.gaze.x - at.x;
    const gy = face.gaze.y - at.y;
    const l = Math.hypot(gx, gy) || 1;
    const reach = face.mood === 'watching' ? 1.4 : 0.8;
    dx += (gx / l) * reach * U;
    dy += (gy / l) * reach * U;
  }

  ctx.fillStyle = '#101713';
  const rows = EYES[eyes] ?? EYES.dot;
  const mirrorRight = eyes === 'mischief';
  pattern(rows, at.x - 12 * ek * wide + dx, at.y + lift - 2 * k + dy);
  pattern(rows, at.x + 12 * ek * wide + dx, at.y + lift - 2 * k + dy, mirrorRight);

  // Mouth: talking flaps through three shapes; happy idle smiles.
  let mouth: string | null = null;
  if (face.mood === 'talking') mouth = face.talk > 0.66 ? 'open' : face.talk > 0.3 ? 'small' : 'closed';
  else if (face.mood === 'idle' && face.expr === 'happy') mouth = 'smile';
  if (mouth) pattern(MOUTHS[mouth], at.x + dx * 0.4, at.y + lift + 11 * k + dy * 0.3);

  // Thinking: a cloud-shaped thought bubble that bobs, with dots filling in.
  if (face.mood === 'thinking') {
    const top = body.bbox().top;
    const bob = Math.sin(face.now / 650) * 3 * k;
    const C = U * 1.5; // the bubble is drawn in bigger blocks
    const bx = at.x + 44 * k;
    const by = top - 40 * k + bob;
    ctx.fillStyle = 'rgba(236, 242, 237, 0.94)';
    // trail of blocks rising to the cloud, getting bigger
    pattern(['#'], at.x + 12 * k, top - 6 * k + bob * 0.3, false, U);
    pattern(['##', '##'], at.x + 20 * k, top - 15 * k + bob * 0.6, false, U);
    // the cloud: a lumpy 11×6 shape
    const cloud = ['..###.###..', '.#########.', '###########', '###########', '.#########.', '...#####...'];
    pattern(cloud, bx, by, false, C);
    const step = Math.floor(face.now / 420) % 4;
    ctx.fillStyle = '#101713';
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = i < step ? 0.9 : 0.22;
      pattern(['#'], bx - 3 * C + i * 3 * C, by + C * 0.5, false, C);
    }
    ctx.globalAlpha = 1;
  }
}
