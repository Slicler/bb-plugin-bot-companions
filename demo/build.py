"""Rebuild demo/animations.html from the plugin's own sprites.ts and softbody.ts.

Run from the plugin folder:  python demo/build.py
Needs `npx tsc` (from the plugin's dev dependencies); the page itself needs nothing.
"""
import re
import shutil
import subprocess

subprocess.run(
    'npx tsc sprites.ts softbody.ts --outDir demo/js --module es2022 --target es2022 --moduleResolution bundler --skipLibCheck',
    shell=True,
    check=False,
)


def strip(src):
    src = re.sub(r'^import .*?;\s*$', '', src, flags=re.M)
    return re.sub(r'^export (default )?', '', src, flags=re.M)


sprites = strip(open('demo/js/sprites.js', encoding='utf-8').read())
softbody = strip(open('demo/js/softbody.js', encoding='utf-8').read())
main = open('demo/demo-main.js', encoding='utf-8').read()
interactive = open('demo/interactive-main.js', encoding='utf-8').read()
shutil.rmtree('demo/js')

html = """<!doctype html><meta charset="utf-8"><title>Bot companions: animation demo</title>
<style>
body{margin:0;padding:24px;font:14px system-ui,sans-serif;background:#f4f4f2;color:#222}
body.dark{background:#1b1f1d;color:#ddd}
h1{font-size:18px;margin:0 0 4px} p{margin:0 0 16px;opacity:.7}
button{font:inherit;padding:4px 12px;border-radius:999px;border:1px solid #888;background:transparent;color:inherit;cursor:pointer}
#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
figure{margin:0;border:1px solid rgba(128,128,128,.3);border-radius:12px;overflow:hidden;background:rgba(128,128,128,.06)}
figcaption{padding:6px 12px;font-weight:600;border-top:1px solid rgba(128,128,128,.2)}
</style>
<h1>Bot companions: every animation</h1>
<p>Live, using the plugin's own drawing code. <button id="theme">Light / dark</button></p>
<div id="grid"></div>
<script>
const STEP = 1 / 180;
"""
html += sprites + '\n' + softbody + '\n' + main + '\n</script>\n'
open('demo/animations.html', 'w', encoding='utf-8').write(html)
print('wrote demo/animations.html', len(html), 'bytes')


shell = """<!doctype html><meta charset="utf-8"><title>Bot companion: playground</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:20px;font:14px system-ui,sans-serif;background:#f4f4f2;color:#222}
body.dark{background:#1b1f1d;color:#ddd}
h1{font-size:18px;margin:0 0 4px} p.sub{margin:0 0 14px;opacity:.7}
button,select{font:inherit;padding:5px 12px;border-radius:999px;border:1px solid #8888;background:transparent;color:inherit;cursor:pointer}
button:hover{background:rgba(128,128,128,.15)} button.on{background:#2f9e6e;color:#fff;border-color:#2f9e6e}
.layout{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
#pane{position:relative;width:680px;height:560px;border:1px solid rgba(128,128,128,.4);border-radius:14px;overflow:hidden;background:rgba(128,128,128,.07);display:flex;flex-direction:column}
.msgs{flex:1;padding:16px;overflow:hidden;display:flex;flex-direction:column;gap:10px;opacity:.85}
.msg{max-width:70%;padding:8px 12px;border-radius:12px;background:rgba(128,128,128,.18)} .msg.me{align-self:flex-end;background:rgba(91,141,239,.35)}
#stage{position:absolute;inset:0;z-index:1;touch-action:none}
#composer{position:relative;z-index:2;margin:0 14px 14px;border:1px solid rgba(128,128,128,.5);border-radius:12px;background:Canvas;overflow:hidden}
body.dark #composer{background:#262b28}
#box{display:block;width:100%;height:46px;border:0;outline:0;resize:none;padding:12px;font:inherit;background:transparent;color:inherit;transition:height .12s}
#box:focus{height:170px}
.side{flex:1;min-width:300px;max-width:420px}
.group{border:1px solid rgba(128,128,128,.3);border-radius:12px;padding:10px 12px;margin-bottom:10px}
.group h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;opacity:.65;margin:0 0 8px}
.row{display:flex;flex-wrap:wrap;gap:6px}
#readout{margin-top:8px;font:12px ui-monospace,monospace;opacity:.8}
</style>
<h1>Bot companion: playground</h1>
<p class="sub">A fake chat with the real companion code. Drag the bot, click into the message box (it grows), and press buttons to trigger what the agent might do.</p>
<div class="layout">
<div><div id="pane"><div class="msgs">
<div class="msg me">Can you tidy up the plugin and run the tests?</div>
<div class="msg">Sure. I'll look at the files first, then run the test suite.</div>
<div class="msg me">Thanks. Tell me if anything looks risky.</div>
</div><canvas id="stage"></canvas>
<div id="composer"><textarea id="box" placeholder="Click here and type: the bot watches, and the box grows under it"></textarea></div></div>
<div id="readout"></div></div>
<div class="side">
<div class="group"><h2>Agent is working</h2><div class="row">
<button data-act="task">Thinking</button><button id="talk" data-act="talk">Streaming a reply</button>
<button data-act="work:run">Run a command</button><button data-act="work:read">Read a file</button>
<button data-act="work:search">Search files</button><button data-act="work:web">Search the web</button>
<button data-act="work:edit">Edit a file</button><button data-act="work:tool">Other tool</button></div></div>
<div class="group"><h2>Things go wrong, or right</h2><div class="row">
<button data-act="fail">A command fails</button><button data-act="pass">A command passes</button>
<button data-act="ask">Ask me a question</button><button data-act="answer">I answered</button>
<button data-act="finish:ok">Finish OK</button><button data-act="finish:failed">Finish: failed</button></div></div>
<div class="group"><h2>Queue and company</h2><div class="row">
<button data-act="queue">Queue a message</button><button data-act="send">Send one</button>
<button id="guest">Visitors: 0</button><button id="helper">Helpers: 0</button></div>
<p style="margin:10px 0 2px">Context used: <b id="ctxv">20%</b></p><input id="ctx" type="range" min="0" max="100" value="20" style="width:100%"></div>
<div class="group"><h2>The bot</h2><div class="row"><select id="who"></select>
<button data-act="sleep">Put to sleep</button><button data-act="home">Send home</button><button id="theme">Light / dark</button></div></div>
</div></div>
<script>
const STEP = 1 / 180;
"""
page = chr(10).join([shell + sprites, softbody, interactive, '</script>', ''])
open('demo/playground.html', 'w', encoding='utf-8').write(page)
print('wrote demo/playground.html', len(page), 'bytes')
