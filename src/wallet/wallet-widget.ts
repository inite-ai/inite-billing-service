import * as QRCode from 'qrcode';

/**
 * The wallet as a card in the chat, for MCP clients that show tool results
 * as UI: MCP Apps (`_meta.ui.resourceUri`, Claude and others) and ChatGPT's
 * Apps SDK (`openai/outputTemplate`). The same HTML serves both: it reads the
 * tool's structuredContent from `window.openai.toolOutput` (ChatGPT) or from
 * the MCP Apps `ui/notifications/tool-result` message. Clients without UI
 * get the same data as text.
 */
export const WALLET_WIDGET_URI = 'ui://inite-wallet/wallet-v1.html';
export const WIDGET_MIME = 'text/html;profile=mcp-app';

/** What a tool sets on itself to be shown with the wallet card. */
export const walletWidgetMeta = {
  ui: { resourceUri: WALLET_WIDGET_URI },
  'openai/outputTemplate': WALLET_WIDGET_URI,
  'openai/widgetAccessible': false,
  'openai/toolInvocation/invoking': 'Opening the wallet…',
  'openai/toolInvocation/invoked': 'Wallet',
};

/** A scannable QR of a Base address (EIP-681), as inline SVG. */
export function addressQr(address: string): Promise<string> {
  return QRCode.toString(`ethereum:${address}@8453`, { type: 'svg', margin: 1, width: 168 });
}

export const WALLET_WIDGET_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#fff;--fg:#141414;--muted:#6b6b6b;--line:#e6e6e6;--accent:#2f6df6;--ok:#178a4c;--bad:#c2371f}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#f1f1f1;--muted:#9a9a9a;--line:#2b2b2b;--accent:#6c9bff;--ok:#4ac283;--bad:#ff7a63}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--fg)}
.card{padding:16px;display:grid;gap:14px}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.bal{font-size:28px;font-weight:650;letter-spacing:-.01em}
.row{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.qr{width:120px;height:120px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:4px}
.qr svg{width:100%;height:100%}
.addr{font:12px/1.4 ui-monospace,Menlo,monospace;word-break:break-all;color:var(--fg)}
.note{font-size:12px;color:var(--muted)}
button,a.btn{all:unset;cursor:pointer;font-size:13px;padding:7px 12px;border-radius:8px;border:1px solid var(--line)}
.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
ul{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
li{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
.paid{color:var(--ok)}.refused,.failed{color:var(--bad)}
.empty{color:var(--muted);font-size:13px}
</style></head><body><div class="card" id="root"><div class="empty">Loading the wallet…</div></div>
<script>
(function(){
  var root=document.getElementById('root'), nextId=1, pending={};
  function rpc(method,params){var id=nextId++;parent.postMessage({jsonrpc:'2.0',id:id,method:method,params:params||{}},'*');return new Promise(function(r){pending[id]=r})}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function open(url){ if(window.openai&&window.openai.openExternal){window.openai.openExternal({href:url})} else {rpc('ui/open-link',{url:url})} }
  function render(d){
    if(!d||!d.address){root.innerHTML='<div class="empty">'+esc(d&&d.message||'No wallet yet.')+'</div>';return}
    var pays=(d.payments||[]).slice(0,5).map(function(p){return '<li><span>'+esc(p.amount)+' '+esc(p.currency||'USDC')+' · '+esc((p.url||p.payTo||'').replace(/^https?:\\/\\//,'').slice(0,40))+'</span><span class="'+esc(p.status)+'">'+esc(p.status)+'</span></li>'}).join('');
    root.innerHTML=
      '<div class="top"><div><div class="label">INITE wallet · USDC on Base</div><div class="bal">'+(d.balance==null?'—':esc(d.balance))+' <span style="font-size:16px;color:var(--muted)">USDC</span></div></div>'+
      (d.limits?'<div class="note">'+esc(d.limits)+'</div>':'')+'</div>'+
      '<div class="row">'+(d.qrSvg?'<div class="qr">'+d.qrSvg+'</div>':'')+
      '<div style="flex:1;min-width:180px;display:grid;gap:8px"><div class="label">Address</div><div class="addr">'+esc(d.address)+'</div>'+
      '<div class="row"><button id="copy">Copy</button>'+(d.fundUrl?'<button class="primary" id="fund">Top up</button>':'')+'</div>'+
      '<div class="note">Only USDC on the Base network. INITE pays the network fee.</div></div></div>'+
      (pays?'<div><div class="label" style="margin-bottom:6px">Recent payments</div><ul>'+pays+'</ul></div>':'');
    var c=document.getElementById('copy'); if(c) c.onclick=function(){navigator.clipboard&&navigator.clipboard.writeText(d.address);c.textContent='Copied'};
    var f=document.getElementById('fund'); if(f) f.onclick=function(){open(d.fundUrl)};
  }
  window.addEventListener('message',function(e){
    var m=e.data; if(!m||m.jsonrpc!=='2.0') return;
    if(m.id&&pending[m.id]){pending[m.id](m.result);delete pending[m.id];return}
    if(m.method==='ui/notifications/tool-result'){render((m.params||{}).structuredContent)}
  });
  if(window.openai&&window.openai.toolOutput){render(window.openai.toolOutput)}
  else { rpc('ui/initialize',{appInfo:{name:'INITE wallet',version:'1'},appCapabilities:{},protocolVersion:'2026-01-26'}).then(function(){parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*')}) }
  window.addEventListener('openai:set_globals',function(){ if(window.openai&&window.openai.toolOutput) render(window.openai.toolOutput) });
})();
</script></body></html>`;
