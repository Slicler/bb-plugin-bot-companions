import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
const avatar = z.object({ color: z.string().regex(/^#[\da-f]{6}$/i), shape: z.string(), expression: z.string(), motion: z.string() });
const bot = z.object({ id: z.string(), name: z.string(), avatar, mainThreadId: z.string().nullable() });
// Bots are parsed one by one, so a single odd avatar can't blank every companion.
const registry = z.object({ bots: z.array(z.unknown()), threadBindings: z.array(z.object({threadId:z.string(),botId:z.string()})), projectOwners: z.array(z.object({projectId:z.string(),botId:z.string()})).optional() });
// What the agent is doing right now, from its open (started, not yet completed) work items.
const work = z.enum(['none', 'run', 'read', 'search', 'web', 'edit', 'tool']);
export type Work = Exclude<z.infer<typeof work>, 'none'>;
export const rpcContract = defineRpcContract({
  owner: { input: z.object({threadId:z.string(),projectId:z.string().nullable()}), output: bot.nullable() },
  activity: { input: z.object({threadId:z.string()}), output: z.object({ kind: work }) },
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
    const rows = await bb.sdk.threads.events.list({ threadId, order: 'desc', limit: '60', types: ['item/started', 'item/completed', 'turn/completed', 'system/thread/interrupted'] });
    const done = new Set<string>();
    for (const row of rows) {
      // Newest first: a finished or interrupted turn closes everything older than it.
      if (row.type === 'turn/completed' || row.type === 'system/thread/interrupted') break;
      const item = (row.data as { item?: { id?: string; type?: string } }).item;
      if (!item?.id) continue;
      if (row.type === 'item/completed') done.add(item.id);
      else if (!done.has(item.id) && item.type && KIND[item.type]) return { kind: KIND[item.type] };
    }
    return { kind: 'none' as const };
  };
  bb.rpc.register(rpcContract, { activity: ({threadId}) => activity(threadId), owner: async ({threadId,projectId}) => {
    const r = await read();
    const id = r.threadBindings.find(b=>b.threadId===threadId)?.botId
      ?? r.bots.find(b=>b.mainThreadId===threadId)?.id
      ?? r.projectOwners?.find(p=>p.projectId===projectId)?.botId;
    return r.bots.find(b=>b.id===id) ?? null;
  }});
}
