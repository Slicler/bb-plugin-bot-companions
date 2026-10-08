import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
const avatar = z.object({ color: z.string().regex(/^#[\da-f]{6}$/i), shape: z.string(), expression: z.string(), motion: z.string() });
const bot = z.object({ id: z.string(), name: z.string(), avatar, mainThreadId: z.string().nullable() });
const registry = z.object({ bots: z.array(bot), threadBindings: z.array(z.object({threadId:z.string(),botId:z.string()})), projectOwners: z.array(z.object({projectId:z.string(),botId:z.string()})).optional() });
export const rpcContract = defineRpcContract({ owner: { input: z.object({threadId:z.string(),projectId:z.string().nullable()}), output: bot.nullable() } });
export type Bot = z.infer<typeof bot>;
export default function plugin(bb: BbPluginApi) {
  let cached: z.infer<typeof registry> | null = null, expires = 0;
  let pending: Promise<z.infer<typeof registry>> | null = null;
  const read = async () => {
    if (cached && Date.now() < expires) return cached;
    if (!pending) pending = bb.sdk.plugins.callRpc({pluginId:'bots-sidebar',method:'bots_list',input:null,outputSchema:registry}).then(value => { cached=value; expires=Date.now()+5000; return value; }).finally(()=>{pending=null;});
    return pending;
  };
  bb.rpc.register(rpcContract, { owner: async ({threadId,projectId}) => {
    const r = await read();
    const id = r.threadBindings.find(b=>b.threadId===threadId)?.botId
      ?? r.bots.find(b=>b.mainThreadId===threadId)?.id
      ?? r.projectOwners?.find(p=>p.projectId===projectId)?.botId;
    return r.bots.find(b=>b.id===id) ?? null;
  }});
}
