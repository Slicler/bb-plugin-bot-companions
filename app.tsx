// bot-companions — the bot that owns a chat lives in that chat as a little
// pixel-block liquid body (see softbody.ts). It sits by the message box and
// chills: watches the box while you type, thinks while the chat is thinking,
// and talks while it replies. It falls and splats under gravity, can be
// grabbed anywhere and hangs from that spot like a water balloon, swinging
// around your cursor, and sheds the odd bit that falls, sticks and crumbles.
// Where it comes to rest after you move it is remembered per chat.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { definePluginApp, experimental_useSidebarThreads, useRpc } from '@get-bb/plugin-sdk/app';
import type { Bot, rpcContract } from './server';
import { sprite, drawBody, drawDrops, drawFace, restParticles, PIXEL, screenScale, view, type Expression, type Mood } from './sprites';
import { SoftBody, type World } from './softbody';
import './style.css';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const STEP = 1 / 180; // fixed physics step
const SPACING = 11.5; // particle spacing in px (about 25% fewer particles than 10)

// ── Power ───────────────────────────────────────────────────────────────
// The sprites only ever draw solid blocks, so each frame is recorded first
// and the canvas is touched only when the blocks actually change. Most idle
// frames change nothing (the breath is far smaller than a block), so the GPU
// gets no new texture at all. The canvas is also only as big as the
// companion, not the whole window.
type Op = number | string;
class FrameRecorder {
  ops: Op[] = [];
  left = Infinity;
  top = Infinity;
  right = -Infinity;
  bottom = -Infinity;
  private scale = 1;
  reset(scale: number) {
    this.ops.length = 0;
    this.scale = scale;
    this.left = this.top = Infinity;
    this.right = this.bottom = -Infinity;
  }
  getTransform() {
    return { a: this.scale } as DOMMatrix;
  }
  set fillStyle(v: string) {
    this.ops.push('s', v);
  }
  set globalAlpha(v: number) {
    this.ops.push('a', v);
  }
  beginPath() {
    this.ops.push('b');
  }
  fill() {
    this.ops.push('f');
  }
  rect(x: number, y: number, w: number, h: number) {
    this.ops.push('r', x, y, w, h);
    this.grow(x, y, w, h);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.ops.push('R', x, y, w, h);
    this.grow(x, y, w, h);
  }
  private grow(x: number, y: number, w: number, h: number) {
    this.left = Math.min(this.left, x);
    this.top = Math.min(this.top, y);
    this.right = Math.max(this.right, x + w);
    this.bottom = Math.max(this.bottom, y + h);
  }
  same(other: Op[]) {
    const a = this.ops;
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== other[i]) return false;
    return true;
  }
  replay(ctx: CanvasRenderingContext2D) {
    const o = this.ops;
    for (let i = 0; i < o.length; ) {
      switch (o[i++]) {
        case 's': ctx.fillStyle = o[i++] as string; break;
        case 'a': ctx.globalAlpha = o[i++] as number; break;
        case 'b': ctx.beginPath(); break;
        case 'f': ctx.fill(); break;
        case 'r': ctx.rect(o[i++] as number, o[i++] as number, o[i++] as number, o[i++] as number); break;
        case 'R': ctx.fillRect(o[i++] as number, o[i++] as number, o[i++] as number, o[i++] as number); break;
      }
    }
    ctx.globalAlpha = 1;
  }
}
// Canvas edges snap to this many device pixels, so small moves don't resize it.
const TILE = 64;

// One switch for every bot character: the chat companions and the animated
// sidebar avatars. Per device, so energy can be compared on each machine.
// Set OFF_ON_HOST to true to start with them off on the machine that runs bb
// (it shows bb at localhost) and on everywhere else, e.g. to save power on a
// server that nobody sits at. A saved choice always wins.
// They're also off on every device while a rest plugin flags html[data-bb-resting].
const OFF_ON_HOST = false;
const OFF_KEY = 'bot-characters-off';
const RESTING_ATTR = 'data-bb-resting';
const isHost = () => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(location.hostname);
const readChoice = (): boolean => {
  try {
    const v = localStorage.getItem(OFF_KEY);
    return v === null ? OFF_ON_HOST && isHost() : v === 'true';
  } catch {
    return OFF_ON_HOST && isHost();
  }
};
const isResting = () => document.documentElement.hasAttribute(RESTING_ATTR);
const readOff = () => readChoice() || isResting();
const offListeners = new Set<() => void>();
const subscribeOff = (l: () => void) => {
  offListeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === OFF_KEY && l();
  window.addEventListener('storage', onStorage);
  const rest = new MutationObserver(l);
  rest.observe(document.documentElement, { attributes: true, attributeFilter: [RESTING_ATTR] });
  return () => {
    offListeners.delete(l);
    window.removeEventListener('storage', onStorage);
    rest.disconnect();
  };
};
const setOff = (v: boolean) => {
  try {
    localStorage.setItem(OFF_KEY, String(v));
  } catch {
    // Private mode.
  }
  offListeners.forEach((l) => l());
};

// Personality: how runny each kind of bot is. All of them are liquid in
// motion and only hold their true form at rest; nothing bounces.
function tuningFor(bot: Bot, k: number) {
  const shape = bot.avatar.shape;
  return {
    gravity: 1400 * k, // lengths shrink with the body, so gravity does too (same feel, smaller)
    softness: shape === 'cloud' ? 0.85 : shape === 'triangle' ? 0.55 : 0.7,
    firmness: 0.3,
    stretch: 0.5,
    friction: 0.5,
    bounce: 0,
    tearDistance: 30 * k,
  };
}

function Companion({ threadId, projectId }: { threadId: string; projectId: string | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const off = useSyncExternalStore(subscribeOff, readOff);
  const [bot, setBot] = useState<Bot | null>(null);
  // Size follows the screen: full on desktop, smaller on tablets and phones.
  const [scale, setScale] = useState(screenScale);
  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setScale(screenScale()), 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
    };
  }, []);
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem('bot-companions-hidden') !== 'true';
    } catch {
      return true;
    }
  });
  const anchor = useRef<HTMLButtonElement>(null);
  const actor = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const input = useRef<{ down: boolean; x: number; y: number; startX: number; startY: number; t: number; moved: boolean; greet: number; reset: boolean }>({
    down: false, x: 0, y: 0, startX: 0, startY: 0, t: 0, moved: false, greet: 0, reset: false,
  });
  const bodyRef = useRef<SoftBody | null>(null);
  // Is the chat working right now? (Thinking vs. talking is read from the
  // page: talking while new reply text is appearing.)
  const { threads } = experimental_useSidebarThreads();
  const status = threads.find((t) => t.id === threadId)?.status;
  const busy = useRef(false);
  busy.current = status === 'starting' || status === 'active';

  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (document.hidden) return;
      rpc.call('owner', { threadId, projectId }).then(
        (v) => live && setBot((old) => (JSON.stringify(old) === JSON.stringify(v) ? old : v)),
        () => {
          // A failed lookup keeps the bot it already has; only a real "no owner" answer removes it.
        },
      );
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [rpc, threadId, projectId]);

  useEffect(() => {
    if (!bot || !shown || off) return;
    const k = scale;
    view.k = k;
    const spacing = SPACING * k;
    const tune = tuningFor(bot, k);
    const key = 'bc-place-' + threadId;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const canvas = document.createElement('canvas');
    canvas.className = 'bc-trail';
    canvas.dataset.thread = threadId;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    const rec = new FrameRecorder();
    let shownOps: Op[] = [];
    let place = '';
    let actorBox = '';
    let lastDraw = 0;
    let lastWork = 0;
    let lively = false;
    let raf = 0;
    let last = 0;
    let acc = 0;
    let nextMeasure = 0;
    let world: World | null = null;
    let home = { x: 0, y: 0 };
    // Idle expressions: every several seconds it glances, widens, squints or
    // smiles for a moment, and blinks at random intervals.
    let expr: Expression = 'base';
    let exprUntil = 0;
    let nextExpr = performance.now() + 4000 + Math.random() * 4000;
    let nextBlink = performance.now() + 2500 + Math.random() * 4000;
    let blinkUntil = 0;
    const IDLE_EXPRESSIONS: Expression[] = ['lookL', 'lookR', 'lookUp', 'wide', 'narrow', 'happy', 'dot'];
    let typedAt = 0;
    let caret: { x: number; y: number } | null = null;
    let grewAt = 0;
    let watched: Element | null = null;
    // The message box grows and shrinks as you click in and type: re-measure
    // on the very next frame so the body never sits inside a box that moved.
    let boxed: Element | null = null;
    const boxWatcher = new ResizeObserver(() => (nextMeasure = 0));
    let forced: string | null = null;
    // Watch the reply grow without reading the whole transcript: only the nodes
    // that were added or removed are measured, and only while the chat is working.
    const watcher = new MutationObserver((records) => {
      if (!busy.current) return;
      let grown = 0;
      for (const m of records) {
        if (m.type === 'characterData') grown += (m.target.nodeValue?.length ?? 0) - (m.oldValue?.length ?? 0);
        else {
          m.addedNodes.forEach((n) => (grown += n.textContent?.length ?? 0));
          m.removedNodes.forEach((n) => (grown -= n.textContent?.length ?? 0));
        }
      }
      if (grown > 2) grewAt = performance.now();
    });
    const onType = (e: Event) => {
      const t = e.target instanceof Element ? e.target : null;
      const box = t?.closest('[data-promptbox]');
      if (!box || !anchor.current?.closest('[data-split-pane-id], main')?.contains(box)) return;
      typedAt = performance.now();
      const sel = window.getSelection();
      const r = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      const b = box.getBoundingClientRect();
      caret = r && r.width + r.height > 0 ? { x: r.right, y: r.top + r.height / 2 } : { x: b.left + 40, y: b.top + 24 };
    };
    document.addEventListener('input', onType, true);
    document.addEventListener('keyup', onType, true);
    let settleSince = 0;
    let wasMoved = false;
    let look: { x: number; y: number } | null = null;
    const onLook = (e: PointerEvent) => (look = { x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', onLook, { passive: true });

    const spawn = (at: { x: number; y: number }) => {
      bodyRef.current = new SoftBody(restParticles(bot.avatar.shape, spacing, k), at, spacing, tune);
    };
    const saved = (): { u: number; v: number } | null => {
      try {
        const p = JSON.parse(localStorage.getItem(key) || 'null');
        return p && Number.isFinite(p.u) && Number.isFinite(p.v) ? p : null;
      } catch {
        return null;
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const btn = actor.current;
      if (!btn || !anchor.current) return;
      if (document.hidden) {
        last = now;
        return;
      }
      // Quiet and settled: wake about 30 times a second instead of 60.
      if (!lively && now - lastWork < 30) return;
      lastWork = now;
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;

      // Measure the chat pane and the message box a few times a second.
      if (now > nextMeasure) {
        nextMeasure = now + 150;
        const pane = anchor.current.closest('[data-split-pane-id]') ?? anchor.current.closest('main');
        const r = pane?.getBoundingClientRect();
        if (!r || r.width < 120 || r.height < 200) {
          btn.style.display = 'none';
          return;
        }
        const composerEl = pane?.querySelector('[data-promptbox]') ?? null;
        if (composerEl !== boxed) {
          boxWatcher.disconnect();
          boxed = composerEl;
          if (composerEl) boxWatcher.observe(composerEl);
        }
        const composer = composerEl?.getBoundingClientRect();
        // Watch the reply text grow, to tell talking from thinking.
        const thread = pane?.querySelector('[data-thread-window]') ?? null;
        if (thread !== watched) {
          watcher.disconnect();
          watched = thread;
          if (thread) watcher.observe(thread, { childList: true, characterData: true, characterDataOldValue: true, subtree: true });
        }
        // localStorage 'bc-debug-mood' forces a mood, for screenshots and testing.
        try {
          forced = localStorage.getItem('bc-debug-mood');
        } catch {
          forced = null;
        }
        world = {
          bounds: { left: Math.max(0, r.left) + 4, top: Math.max(0, r.top) + 52, right: Math.min(innerWidth, r.right) - 4, bottom: Math.min(innerHeight, r.bottom) - 2 },
          solids: composer ? [{ left: composer.left, top: composer.top, right: composer.right, bottom: composer.bottom }] : [],
        };
        home = composer ? { x: composer.left + 70 * k, y: composer.top - 60 * k } : { x: r.left + 80 * k, y: r.bottom - 80 * k };
        btn.style.display = 'block';
        if (!bodyRef.current) {
          const p = saved();
          const b = world.bounds;
          spawn(p ? { x: b.left + p.u * (b.right - b.left), y: b.top + p.v * (b.bottom - b.top) - 20 } : home);
        }
      }
      const body = bodyRef.current;
      if (!body || !world) return;
      const still = reduced.matches || bot.avatar.motion === 'still' || document.documentElement.hasAttribute('data-calm');
      const ui = input.current;

      if (ui.reset) {
        ui.reset = false;
        try {
          localStorage.removeItem(key);
        } catch {
          // Private mode.
        }
        spawn({ x: home.x, y: home.y - 80 });
      }

      // Mood: what the chat (and you) are doing right now.
      const mood: Mood = forced === 'thinking' || forced === 'talking' ? forced : body.held
        ? 'held'
        : busy.current && now - grewAt < 600
          ? 'talking'
          : busy.current
            ? 'thinking'
            : now - typedAt < 1500
              ? 'watching'
              : 'idle';
      // Talking: a syllable rhythm (two beating waves) drives the mouth and
      // a little pulse through the body.
      const talk = mood === 'talking' ? Math.max(0, Math.sin(now / 85) * 0.6 + Math.sin(now / 211) * 0.5 + 0.15) : 0;
      // Life at rest is a slow, shallow breath (about one every 6 s).
      const breath = Math.sin(now / 950);
      body.restScale = still
        ? 1
        : 1 + (mood === 'idle' || mood === 'watching' ? 0.01 : 0.016) * breath + Math.min(1, talk) * 0.05;
      const v = body.velocity();
      const speed = Math.hypot(v.vx, v.vy);
      if (now < ui.greet) {
        body.restScale += 0.06; // a happy little swell when tapped
      }
      // Expression timing (idle only; other moods set their own faces).
      if (now > nextBlink) {
        blinkUntil = now + 140;
        nextBlink = now + 2500 + Math.random() * 5500;
      }
      if (mood !== 'idle') {
        expr = 'base';
        nextExpr = Math.max(nextExpr, now + 2500);
      } else if (expr !== 'base' && now > exprUntil) {
        expr = 'base';
        nextExpr = now + 4000 + Math.random() * 6000;
      } else if (expr === 'base' && now > nextExpr && !still) {
        expr = IDLE_EXPRESSIONS[Math.floor(Math.random() * IDLE_EXPRESSIONS.length)];
        exprUntil = now + 1200 + Math.random() * 2200;
      }
      if (now < ui.greet) expr = 'happy';

      // Physics at a fixed step, however fast the screen refreshes.
      acc = Math.min(acc + dt, STEP * 8);
      while (acc >= STEP) {
        body.step(STEP, world);
        acc -= STEP;
      }
      if (still) body.drops.length = 0;

      // Remember where it settles after you've moved it.
      if (ui.moved) wasMoved = true;
      if (wasMoved && !body.held && body.grounded && speed < 8) {
        if (!settleSince) settleSince = now;
        if (now - settleSince > 500) {
          const b = world.bounds;
          const c = body.center;
          try {
            localStorage.setItem(key, JSON.stringify({ u: clamp((c.x - b.left) / (b.right - b.left), 0, 1), v: clamp((c.y - b.top) / (b.bottom - b.top), 0, 1) }));
          } catch {
            // Private mode.
          }
          wasMoved = false;
          settleSince = 0;
        }
      } else settleSince = 0;

      // Draw: drops, body, face — all on the same screen-fixed block grid.
      // Lively moments draw at up to 60 fps, quiet ones at 30; physics keeps
      // its fixed step either way.
      lively = body.held || !body.grounded || body.drops.length > 0 || mood === 'talking' || ui.down || now < ui.greet;
      if (now - lastDraw >= (lively ? 15 : 32)) {
        lastDraw = now;
        const ratio = devicePixelRatio || 1;
        rec.reset(ratio);
        const r = rec as unknown as CanvasRenderingContext2D;
        drawDrops(r, body.drops, bot.avatar.color);
        drawBody(r, body, bot.avatar.color, world.solids);
        const gaze = mood === 'watching' ? caret : look;
        drawFace(r, bot, body, { mood, expr: now < blinkUntil && mood !== 'held' ? 'blink' : expr, gaze, talk: Math.min(1, talk), now });
        // Only the companion's own area, clipped to the pane, in device pixels.
        const b = world.bounds;
        const L = Math.floor((Math.max(rec.left, b.left) * ratio) / TILE) * TILE;
        const T = Math.floor((Math.max(rec.top, b.top) * ratio) / TILE) * TILE;
        const R = Math.ceil((Math.min(rec.right, b.right) * ratio) / TILE) * TILE;
        const B = Math.ceil((Math.min(rec.bottom, b.bottom) * ratio) / TILE) * TILE;
        const w = Math.max(0, R - L);
        const h = Math.max(0, B - T);
        const where = `${L},${T},${w},${h},${ratio}`;
        if (where !== place || !rec.same(shownOps)) {
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            canvas.style.width = `${w / ratio}px`;
            canvas.style.height = `${h / ratio}px`;
          }
          if (where !== place) canvas.style.transform = `translate(${L / ratio}px, ${T / ratio}px)`;
          place = where;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.setTransform(ratio, 0, 0, ratio, -L, -T);
          ctx.imageSmoothingEnabled = false;
          ctx.save();
          ctx.beginPath();
          ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top);
          ctx.clip();
          rec.replay(ctx);
          ctx.restore();
          shownOps = rec.ops.slice();
          canvas.dataset.drops = String(body.drops.length);
        }
      }

      // The invisible button follows the body for picking it up.
      const box = body.bbox(PIXEL * k);
      const nextBox = `${box.left},${box.top},${box.right - box.left},${box.bottom - box.top}`;
      if (nextBox !== actorBox) {
        actorBox = nextBox;
        btn.style.transform = `translate(${box.left}px, ${box.top}px)`;
        btn.style.width = `${box.right - box.left}px`;
        btn.style.height = `${box.bottom - box.top}px`;
      }
      const pose = body.held ? 'held' : body.grounded ? 'resting' : 'airborne';
      if (btn.dataset.pose !== pose) btn.dataset.pose = pose;
      if (bubble.current) {
        const greeting = now < ui.t + 1400 && !ui.moved && !ui.down;
        const text = greeting ? '♥' : bot.name;
        if (bubble.current.textContent !== text) bubble.current.textContent = text;
        if (bubble.current.dataset.visible !== String(greeting)) bubble.current.dataset.visible = String(greeting);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      watcher.disconnect();
      boxWatcher.disconnect();
      window.removeEventListener('pointermove', onLook);
      document.removeEventListener('input', onType, true);
      document.removeEventListener('keyup', onType, true);
      canvas.remove();
      bodyRef.current = null;
    };
  }, [bot, shown, off, threadId, scale]);

  if (!bot || off) return null;
  const ui = input.current;
  return (
    <>
      <button
        ref={anchor}
        className="bc-toggle"
        title={`${shown ? 'Hide' : 'Show'} ${bot.name}'s pixel companion`}
        aria-label={`${shown ? 'Hide' : 'Show'} ${bot.name}'s pixel companion`}
        aria-pressed={shown}
        onClick={() =>
          setShown((v) => {
            try {
              localStorage.setItem('bot-companions-hidden', String(v));
            } catch {
              // Private mode.
            }
            return !v;
          })
        }
      >
        <img src={sprite(bot)} alt="" />
      </button>
      {shown &&
        createPortal(
          <button
            ref={actor}
            className="bc-actor"
            data-thread={threadId}
            aria-label={`${bot.name} companion. Tap to greet, drag to pick up and throw, Escape to send home.`}
            title={`${bot.name} · drag to pick up · double-click to send home`}
            onDoubleClick={() => (ui.reset = true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') ui.reset = true;
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              Object.assign(ui, { down: true, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, t: performance.now(), moved: false });
              e.currentTarget.setPointerCapture(e.pointerId);
              bodyRef.current?.grab(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (!ui.down) return;
              ui.x = e.clientX;
              ui.y = e.clientY;
              ui.moved ||= Math.hypot(ui.x - ui.startX, ui.y - ui.startY) > 5;
              bodyRef.current?.moveHand(e.clientX, e.clientY);
            }}
            onPointerUp={(e) => {
              if (!ui.down) return;
              ui.down = false;
              bodyRef.current?.release();
              if (!ui.moved && performance.now() - ui.t < 350) ui.greet = performance.now() + 700;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              ui.down = false;
              bodyRef.current?.release();
            }}
            onLostPointerCapture={() => {
              ui.down = false;
              bodyRef.current?.release();
            }}
          >
            <span ref={bubble} className="bc-bubble" />
          </button>,
          document.body,
        )}
    </>
  );
}

function CharactersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 19c-1.5-1-2-3-2-5 0-5 4-9 9-9s9 4 9 9c0 2-.5 4-2 5Z" />
      <path d="M9 12h.01M15 12h.01" />
    </svg>
  );
}

function CharactersPanel({ dismiss }: { dismiss: () => void }) {
  useSyncExternalStore(subscribeOff, readOff);
  const off = readChoice();
  const resting = isResting();
  const chip = 'rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-accent data-[on]:border-primary data-[on]:bg-accent';
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Bot characters</span>
        <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={dismiss}>Done</button>
      </div>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Bot characters">
        <button type="button" role="radio" aria-checked={!off} data-on={!off ? '' : undefined} className={chip} onClick={() => setOff(false)}>On</button>
        <button type="button" role="radio" aria-checked={off} data-on={off ? '' : undefined} className={chip} onClick={() => setOff(true)}>Off</button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {resting ? 'bb is resting, so they\'re off everywhere until it wakes. ' : ''}
        Off removes the chat companions and freezes the sidebar avatars, so you can compare energy use. Saved on this device
        {OFF_ON_HOST && isHost() ? '; off by default here on the bb server.' : '.'}
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({ id: 'companion', title: 'Bot companion', component: Companion });
  app.experimental_icons.register({ name: 'bot-companions/characters', component: CharactersIcon });
  app.experimental_sidebarFooter.register({
    id: 'bot-characters',
    label: 'Bot characters',
    icon: 'bot-companions/characters',
    kind: 'disclosure',
    component: CharactersPanel,
  });
  // Off also freezes the sidebar avatars (html[data-bot-characters-off]; see style.css).
  app.contentScripts.register({
    id: 'bot-characters-off',
    mount(context) {
      const sync = () => document.documentElement.toggleAttribute('data-bot-characters-off', readOff());
      sync();
      const unsubscribe = subscribeOff(sync);
      const dispose = () => {
        unsubscribe();
        document.documentElement.removeAttribute('data-bot-characters-off');
      };
      context.signal.addEventListener('abort', dispose, { once: true });
      return dispose;
    },
  });
});
