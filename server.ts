import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
const avatar = z.object({ color: z.string().regex(/^#[\da-f]{6}$/i), shape: z.string(), expression: z.string(), motion: z.string() });
const bot = z.object({ id: z.string(), name: z.string(), avatar, mainThreadId: z.string().nullable() });
// Bots are parsed one by one, so a single odd avatar can't blank every companion.
const registry = z.object({ bots: z.array(z.unknown()), threadBindings: z.array(z.object({threadId:z.string(),botId:z.string()})), projectOwners: z.array(z.object({projectId:z.string(),botId:z.string()})).optional() });
// What the agent is doing right now, from its open (started, not yet completed) work items.
const work = z.enum(['none', 'run', 'read', 'search', 'web', 'edit', 'tool']);
export type Work = Exclude<z.infer<typeof work>, 'none'>;
const turnEnd = z.enum(['none', 'ok', 'failed', 'interrupted']);
const friend = z.object({ id: z.string(), name: z.string(), color: z.string(), shape: z.string(), mainThreadId: z.string().nullable() });
export type Friend = z.infer<typeof friend>;
export const rpcContract = defineRpcContract({
  owner: { input: z.object({threadId:z.string(),projectId:z.string().nullable()}), output: bot.nullable() },
  activity: {
    input: z.object({threadId:z.string()}),
    output: z.object({
      kind: work,
      /** Commands that failed in a row, newest first, in the current turn. */
      failed: z.number(),
      /** Share of the context window used, 0..1, or null if not reported lately. */
      context: z.number().nullable(),
      /** Messages queued behind the running turn. */
      queued: z.number(),
      /** How the newest finished turn ended. */
      turn: turnEnd,
    }),
  },
  bots: { input: z.object({}), output: z.array(friend) },
});
const KIND: Record<string, Exclude<z.infer<typeof work>, 'none'>> = { commandExecution: 'run', fileRead: 'read', search: 'search', webSearch: 'web', fileChange: 'edit', toolCall: 'tool', imageGeneration: 'tool' };
export type Bot = z.infer<typeof bot>;
export default function plugin(bb: BbPluginApi) {
  type Registry = { bots: Bot[]; threadBindings: { threadId: string; botId: string }[]; projectOwners?: { projectId: string; botId: string }[] };
  let cached: Registry | null = null, expires = 0;
  let pending: Promise<Registry> | null = null;
  const load = async (): Promise<Registry> => {
    const raw = await bb.sdk.plugins.callRpc({pluginId:'bots-sidebar',method:'bots_list',input:null,outputSchema:registry});
    return { ...raw, bots: raw.bots.flatMap(b => { const p = bot.safeParse(b); return p.success ? [p.data] : []; }) };
  };
  const read = async () => {
    if (cached && Date.now() < expires) return cached;
    if (!pending) pending = load().then(value => { cached=value; expires=Date.now()+5000; return value; })
      // Keep serving the last good list if the bots plugin hiccups.
      .catch(err => { if (cached) { expires = Date.now() + 2000; return cached; } throw err; })
      .finally(()=>{pending=null;});
    return pending;
  };
  const activity = async (threadId: string) => {
    const rows = await bb.sdk.threads.events.list({ threadId, order: 'desc', limit: '100', types: ['item/started', 'item/completed', 'turn/completed', 'system/thread/interrupted', 'thread/contextWindowUsage/updated'] });
    const done = new Set<string>();
    let kind: z.infer<typeof work> = 'none';
    let failed = 0, streak = true, context: number | null = null, turn: z.infer<typeof turnEnd> = 'none', closed = false;
    for (const row of rows) {
      // Newest first: a finished or interrupted turn closes everything older than it.
      if (row.type === 'turn/completed' || row.type === 'system/thread/interrupted') {
        if (!closed) {
          turn = row.type === 'system/thread/interrupted' ? 'interrupted' : (row.data as { status?: string }).status === 'completed' ? 'ok' : 'failed';
          closed = true;
        }
        if (kind !== 'none' || context !== null || done.size || failed) break;
        continue;
      }
      if (closed && row.type !== 'thread/contextWindowUsage/updated') break;
      if (row.type === 'thread/contextWindowUsage/updated') {
        const u = (row.data as { contextWindowUsage?: { usedTokens?: number; modelContextWindow?: number } }).contextWindowUsage;
        if (context === null && u?.usedTokens != null && u.modelContextWindow) context = Math.min(1, u.usedTokens / u.modelContextWindow);
        continue;
      }
      const item = (row.data as { item?: { id?: string; type?: string; status?: string } }).item;
      if (!item?.id) continue;
      if (row.type === 'item/completed') {
        done.add(item.id);
        if (streak && item.type === 'commandExecution') {
          if (item.status === 'failed') failed++;
          else streak = false;
        }
      } else if (kind === 'none' && !done.has(item.id) && item.type && KIND[item.type] && !closed) kind = KIND[item.type];
    }
    let queued = 0;
    try {
      const q = (await bb.sdk.threads.queuedMessages.list({ threadId })) as unknown as Record<string, unknown>;
      const list = Object.values(q).find(Array.isArray) as unknown[] | undefined;
      queued = list?.length ?? 0;
    } catch {
      // Queue unavailable: no blocks to show.
    }
    return { kind, failed, context, queued, turn };
  };
  const friends = async () => (await read()).bots.map(b => ({ id: b.id, name: b.name, color: b.avatar.color, shape: b.avatar.shape, mainThreadId: b.mainThreadId }));
  bb.rpc.register(rpcContract, { activity: ({threadId}) => activity(threadId), bots: () => friends(), owner: async ({threadId,projectId}) => {
    const r = await read();
    const id = r.threadBindings.find(b=>b.threadId===threadId)?.botId
      ?? r.bots.find(b=>b.mainThreadId===threadId)?.id
      ?? r.projectOwners?.find(p=>p.projectId===projectId)?.botId;
    return r.bots.find(b=>b.id===id) ?? null;
  }});
}
