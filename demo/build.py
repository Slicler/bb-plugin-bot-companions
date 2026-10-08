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
