// Local responsive test harness only. Build client, run this script, then open
// http://localhost:4520/bpmn-mobile-preview.html with the isolated preview running.
// A same-origin iframe creates a real 390 CSS-pixel viewport; this is not device emulation.
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const dist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
if (!existsSync(dist)) throw Error('Build client first');
writeFileSync(dist + 'bpmn-mobile-preview.html', `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BPMN · 390px 响应式验收</title>
<style>html,body{margin:0;height:100%;background:#e7ebf1}iframe{display:block;width:390px;height:100vh;max-width:100%;border:0;margin:0 auto;background:white}</style></head>
<body><iframe id="bpmn-mobile" title="390px 流程设计器" src="/?page=workflow"></iframe></body></html>\n`);
console.log('Created client/dist/bpmn-mobile-preview.html (390 CSS-pixel iframe, no emulated device claims)');
