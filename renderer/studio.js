// Charm Line Studio: the app window. Talks to the charms only through window.studio (preload-studio.js).
(()=>{
'use strict';
const api=window.studio||null;
const $=id=>document.getElementById(id);
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

if(!api||!api.line||!api.settings){
  $('app').hidden=true;$('nostudio').hidden=false;document.body.classList.remove('booting');
  return;
}

// ---------- tiny DOM helpers ----------
const SVGNS='http://www.w3.org/2000/svg';
function h(tag,attrs,...kids){
  const el=document.createElement(tag);
  if(attrs)for(const [k,v] of Object.entries(attrs)){
    if(v==null||v===false)continue;
    if(k==='class')el.className=v;
    else if(k==='text')el.textContent=v;
    else if(k==='style'&&typeof v==='object'){for(const [sk,sv] of Object.entries(v)){if(sk.startsWith('--'))el.style.setProperty(sk,sv);else el.style[sk]=sv}}
    else if(k.startsWith('on')&&typeof v==='function')el.addEventListener(k.slice(2),v);
    else if(k in el&&typeof v!=='string'&&k!=='list')el[k]=v;
    else el.setAttribute(k,v===true?'':String(v));
  }
  for(const c of kids.flat()){if(c==null||c===false)continue;el.append(c.nodeType?c:document.createTextNode(String(c)))}
  return el;
}
function ic(name,cls){const s=document.createElementNS(SVGNS,'svg');s.setAttribute('class','ic'+(cls?' '+cls:''));s.setAttribute('aria-hidden','true');const u=document.createElementNS(SVGNS,'use');u.setAttribute('href','#i-'+name);s.append(u);return s}
function art(markup){const t=document.createElement('template');t.innerHTML=markup.trim();return t.content.firstElementChild} // static, trusted markup only
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const plural=(n,one,many)=>n+' '+(n===1?one:(many||one+'s'));
function setRangeFill(r){const min=+r.min||0,max=+r.max||100;r.style.setProperty('--p',((+r.value-min)/(max-min||1)*100)+'%')}
function keepFocus(fn){const a=document.activeElement,k=a&&a.dataset?a.dataset.k:null;fn();if(k){const n=document.querySelector('[data-k="'+CSS.escape(k)+'"]');if(n&&n!==a&&!n.disabled)n.focus({preventScroll:true})}}

// ---------- state ----------
const PLAT=typeof api.platform==='string'?api.platform:'';
const MAC=PLAT==='darwin';
document.body.classList.add('plat-'+(PLAT||'web'));
const EMPTY_CAT={collections:[],capDesigns:[],capStyles:[],teams:[],jerseyStyles:[],jerseyPresets:[],jerseyTypes:['jersey','kitpendant']};
let LS={S:{rope:'thread',size:1,sound:true,wind:true,cap:'gold',capDesign:'signature'},charms:[],imports:[],catalog:EMPTY_CAT};
let ACT={},SET=null,SHOWN=true,page=null,selCid=null,lineReady=false;
const TYPES={};  // id -> {name, collection}
const PAGES=['line','catalogue','images','style','pulls','settings','about'];
const TITLES={welcome:'Welcome',line:'My line',catalogue:'Catalogue',images:'Your images',style:'Style',pulls:'Pull actions',settings:'Settings',about:'About'};

const okId=id=>typeof id==='string'&&/^[a-z0-9_-]{1,40}$/i.test(id);
const okCid=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{8,64}$/.test(v);
const okData=u=>typeof u==='string'&&u.length<2e6&&/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(u);
const charmSrc=t=>okId(t)?'charms/'+t+'.webp':'';
const str=(v,n)=>typeof v==='string'?v.slice(0,n||200):'';
function pairs(list){return Array.isArray(list)?list.map(x=>Array.isArray(x)?[String(x[0]),String(x[1]!=null?x[1]:x[0])]:typeof x==='string'?[x,x.charAt(0).toUpperCase()+x.slice(1)]:null).filter(Boolean):[]}

function normalize(s){
  const cat=Object.assign({},EMPTY_CAT,s&&s.catalog||{});
  cat.collections=(Array.isArray(cat.collections)?cat.collections:[]).map(c=>({name:str(c&&c.name,60),items:(Array.isArray(c&&c.items)?c.items:[]).map(it=>Array.isArray(it)?{id:it[0],name:it[1]}:it).filter(it=>it&&okId(it.id)).map(it=>({id:it.id,name:str(it.name,60)||it.id}))})).filter(c=>c.items.length);
  cat.capDesigns=pairs(cat.capDesigns);cat.capStyles=pairs(cat.capStyles);cat.teams=pairs(cat.teams);cat.jerseyStyles=pairs(cat.jerseyStyles);
  cat.jerseyPresets=(Array.isArray(cat.jerseyPresets)?cat.jerseyPresets:[]).filter(p=>Array.isArray(p)&&p.length>=2).map(p=>[String(p[0]),String(p[1])]);
  cat.jerseyTypes=Array.isArray(cat.jerseyTypes)?cat.jerseyTypes.map(String):['jersey','kitpendant'];
  for(const k of Object.keys(TYPES))delete TYPES[k];
  cat.collections.forEach(c=>c.items.forEach(it=>{TYPES[it.id]={name:it.name,collection:c.name}}));
  const S=Object.assign({},LS.S,s&&s.S||{});
  const charms=(Array.isArray(s&&s.charms)?s.charms:[]).filter(c=>c&&okCid(c.cid)).map(c=>({cid:c.cid,type:String(c.type||''),name:str(c.name,80),collection:str(c.collection,60),len:+c.len||150,lenMax:+c.lenMax||420,opts:c.opts&&typeof c.opts==='object'?c.opts:{}}));
  const imports=(Array.isArray(s&&s.imports)?s.imports:[]).filter(i=>i&&typeof i.key==='string').map(i=>({key:i.key,name:str(i.name,60)||'Your image',thumb:okData(i.thumb)?i.thumb:''}));
  return{S,charms,imports,catalog:cat};
}
const importOf=key=>LS.imports.find(i=>i.key===key)||null;
const isJersey=ch=>LS.catalog.jerseyTypes.includes(ch.type);
function nameOf(ch){if(ch.name)return ch.name;if(ch.type==='img'){const im=importOf(ch.opts.key);return im?im.name:'Your image'}return TYPES[ch.type]?TYPES[ch.type].name:ch.type}
function collOf(ch){if(ch.type==='img')return 'Your image';return ch.collection||(TYPES[ch.type]&&TYPES[ch.type].collection)||''}
function srcOf(ch){if(ch.type==='img'){const im=importOf(ch.opts.key);return im&&im.thumb?im.thumb:''}return charmSrc(ch.type)}
function imgEl(src,cls){const i=h('img',{alt:'',class:cls||null,draggable:'false',decoding:'async'});i.addEventListener('error',()=>i.classList.add('broken'),{once:true});if(src)i.src=src;else i.classList.add('broken');return i}
function thumbEl(ch){const im=ch.type==='img';return h('div',{class:'thumb'+(im?' imp':'')},imgEl(srcOf(ch)))}
const byType=()=>{const m={};for(const c of LS.charms)m[c.type]=(m[c.type]||0)+1;return m};
const byKey=()=>{const m={};for(const c of LS.charms)if(c.type==='img')m[c.opts.key]=(m[c.opts.key]||0)+1;return m};

// ---------- keys ----------
function accParts(acc){
  if(!acc)return[];
  const parts=String(acc).split('+');
  if(MAC){const m={CommandOrControl:'\u2318',CmdOrCtrl:'\u2318',Command:'\u2318',Cmd:'\u2318',Control:'\u2303',Ctrl:'\u2303',Alt:'\u2325',Option:'\u2325',Shift:'\u21e7',Super:'\u2318',Meta:'\u2318'};return parts.map(p=>m[p]||p)}
  const m={CommandOrControl:'Ctrl',CmdOrCtrl:'Ctrl',Control:'Ctrl',Ctrl:'Ctrl',Command:'Win',Cmd:'Win',Super:'Win',Meta:'Win',Option:'Alt'};
  if(PLAT==='linux'){m.Command=m.Cmd=m.Super=m.Meta='Super'}
  return parts.map(p=>m[p]||p);
}
const prettyAcc=acc=>accParts(acc).join(MAC?'':'+');
function kbds(acc,emptyText){const p=accParts(acc);if(!p.length)return[h('span',{class:'none',text:emptyText||'None'})];return p.map(x=>h('kbd',{text:x}))}
const shortcut=w=>SET&&SET.shortcuts&&SET.shortcuts[w]||'';

// ---------- action text (same wording as the overlay) ----------
const quote=t=>'\u201c'+(t.length>24?t.slice(0,23)+'\u2026':t)+'\u201d';
function actText(info,doing){
  if(!info)return '';const L=String(info.label||'').trim();
  if(info.kind==='toggle')return doing?'Hiding charms\u2026':'Hide charms';
  if(info.kind==='copy'){if(/^copy\b/i.test(L))return L;return doing?(L?'Copied '+quote(L):'Copied'):(L?'Copy '+quote(L):'Copy text')}
  const noun=L||{url:'website',app:'app',file:'file',folder:'folder'}[info.kind]||'it';
  if(/^open\b/i.test(noun))return doing?noun.replace(/^open\b/i,'Opening')+'\u2026':noun;
  return doing?'Opening '+noun+'\u2026':'Open '+noun;
}
const KIND_IC={url:'url',app:'app',file:'file',folder:'folder',copy:'copy',toggle:'toggle'};
function kindIcon(info){if(info&&info.icon&&/^data:image\/(png|jpeg|webp|x-icon|vnd\.microsoft\.icon);base64,/i.test(info.icon)){return imgEl(info.icon)}return ic(KIND_IC[info&&info.kind]||'pull')}

// ---------- toasts / confirm ----------
let lastToast={m:'',t:0};
function toast(msg,o){
  o=o||{};const now=Date.now();if(msg===lastToast.m&&now-lastToast.t<1500)return;lastToast={m:msg,t:now};
  const box=$('toasts');
  const t=h('div',{class:'toast'+(o.bad?' bad':'')},o.img?imgEl(o.img):ic(o.bad?'alert':'check'),h('span',{text:msg}));
  if(o.action)t.append(h('button',{type:'button',text:o.action.label,onclick:()=>{o.action.fn();close()}}));
  let gone=false;const close=()=>{if(gone)return;gone=true;t.classList.add('out');setTimeout(()=>t.remove(),reduce?0:200)};
  box.append(t);while(box.children.length>3)box.firstElementChild.remove();
  let timer=setTimeout(close,o.ms||(o.bad?4200:3000));
  t.addEventListener('mouseenter',()=>clearTimeout(timer));t.addEventListener('mouseleave',()=>{timer=setTimeout(close,1500)});
}
function confirmDlg(o){
  const d=$('dlg');$('dlgT').textContent=o.title;$('dlgM').textContent=o.msg||'';$('dlgOk').textContent=o.ok||'OK';
  return new Promise(res=>{
    const done=v=>{d.removeEventListener('cancel',onCancel);$('dlgOk').onclick=$('dlgNo').onclick=null;if(d.open)d.close();res(v)};
    const onCancel=e=>{e.preventDefault();done(false)};
    d.addEventListener('cancel',onCancel);
    $('dlgOk').onclick=()=>done(true);$('dlgNo').onclick=()=>done(false);
    d.showModal();$('dlgNo').focus();
  });
}

// ---------- talking to the charms ----------
async function cmd(op,args,quiet){
  let r;try{r=await api.line.cmd(op,args||{})}catch(e){r={ok:false,error:'Charms are not responding'}}
  if(!r||typeof r!=='object')r={ok:false,error:'That didn\u2019t work.'};
  if(!r.ok&&!quiet)toast(r.error||'That didn\u2019t work.',{bad:true});
  return r;
}
async function refreshLine(){try{setLS(await api.line.getState())}catch(e){}}
async function refreshActs(){try{const l=await api.actions.list();ACT=l&&typeof l==='object'?l:{}}catch(e){}onActs()}
function setLS(s){
  if(!s||typeof s!=='object')return;
  LS=normalize(s);lineReady=true;
  if(selCid&&!LS.charms.some(c=>c.cid===selCid))selCid=null;
  updateBadge();
  if(page==='line')renderLine();
  else if(page==='catalogue')renderCatGrid();
  else if(page==='images')renderImages();
  else if(page==='style')renderStyle();
  else if(page==='pulls')renderPulls();
}
function onActs(){
  if(page==='line'){renderList();renderActs()}
  else if(page==='pulls')renderPulls();
}
function updateBadge(){const n=LS.charms.length,b=$('lineCount');b.textContent=n?String(n):'';b.setAttribute('aria-label',plural(n,'charm'));}

// ---------- shell: navigation, titlebar, shown switch ----------
const scroller=$('scroller'),tbar=$('tbar');
scroller.addEventListener('scroll',()=>tbar.classList.toggle('scrolled',scroller.scrollTop>36),{passive:true});
function go(p,o){
  o=o||{};
  if(SET&&!SET.firstRunDone&&p!=='welcome'){if(o.cid)selCid=o.cid;return}
  if(!TITLES[p])p='line';
  if(o.cid&&p==='line')selCid=o.cid;
  const changed=p!==page;page=p;
  document.querySelectorAll('.nav-i').forEach(b=>{if(b.dataset.page===p)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  document.querySelectorAll('.page').forEach(s=>{s.hidden=s.dataset.page!==p});
  const side=$('side'),welcome=p==='welcome';side.classList.toggle('dim',welcome);side.inert=welcome;
  $('tbarTitle').textContent=TITLES[p];document.title=welcome?'Charm Line':TITLES[p]+' \u2014 Charm Line';
  if(changed){scroller.scrollTop=0;const sec=$('p-'+p);sec.style.animation='none';void sec.offsetWidth;sec.style.animation=''}
  render(p);
  if(o.focus==='acts'){const a=$('dActs');if(a){a.scrollIntoView({block:'start',behavior:reduce?'auto':'smooth'});const s=a.querySelector('select');if(s)s.focus({preventScroll:true})}}
  else if(changed&&o.fromNav){const hd=$('h-'+p);if(hd)hd.focus({preventScroll:true})}
}
function render(p){
  if(p==='welcome')renderWelcome();else if(p==='line')renderLine();else if(p==='catalogue')renderCatalogue();else if(p==='images')renderImages();
  else if(p==='style')renderStyle();else if(p==='pulls')renderPulls();else if(p==='settings')renderSettings();else if(p==='about')renderAbout();
}
$('nav').addEventListener('click',e=>{const b=e.target.closest('.nav-i');if(b)go(b.dataset.page,{fromNav:true})});
$('nav').addEventListener('keydown',e=>{
  if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;const items=[...document.querySelectorAll('.nav-i')],i=items.indexOf(document.activeElement);if(i<0)return;
  e.preventDefault();items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();
});
function setShown(v){SHOWN=!!v;$('shownSw').checked=SHOWN;$('onscreen').classList.toggle('on',SHOWN);$('onscreen').title=SHOWN?'Charms are on screen':'Charms are hidden'}
$('shownSw').addEventListener('change',async e=>{const want=e.target.checked;try{setShown(await api.charms.toggle())}catch(er){setShown(!want);toast('Couldn\u2019t reach the charms.',{bad:true})}});
function renderShortcutHints(){
  const k=$('osKey');k.textContent=prettyAcc(shortcut('toggle'));
}

function pageHead(id,title,desc,actions,eyebrow){
  return h('div',{class:'ph'},
    h('div',{class:'ph-t'},eyebrow?h('div',{class:'eyebrow',text:eyebrow}):null,h('h1',{id:'h-'+id,tabindex:'-1',text:title}),h('p',{class:'ph-d',text:desc||''})),
    actions&&actions.length?h('div',{class:'ph-a'},actions):null);
}

// ---------- line preview strip ----------
function strip(charms,o){
  o=o||{};const rope=['thread','chain','neon'].includes(o.rope)?o.rope:'thread';
  const el=h('div',{class:'strip'+(o.cls?' '+o.cls:'')});
  el.append(h('div',{class:'strip-rope rope-'+rope}));
  const row=h('div',{class:'strip-row',role:o.onPick?'group':null,'aria-label':o.onPick?'Your line, left to right':null});
  const H=o.height||(innerHeight<=680?124:150),n=charms.length,size=clamp(+o.size||1,.6,1.6);
  const crowd=Math.min(1,9/Math.max(1,n)),maxLen=Math.max(120,...charms.map(c=>c.len||150));
  const imgH=clamp((o.base||70)*size*(.55+.45*crowd),22,H*.62);
  charms.forEach((ch,i)=>{
    const strLen=clamp(((ch.len||150)/maxLen)*(H-imgH-30),8,H-imgH-24);
    const im=ch.type==='img';
    const attrs={class:'hang',style:{'--h':imgH+'px',animationDelay:(-i*.83)+'s'}};
    let b;
    if(o.onPick){b=h('button',Object.assign(attrs,{type:'button','aria-label':nameOf(ch),'aria-pressed':String(o.sel===ch.cid),title:nameOf(ch),onclick:()=>o.onPick(ch.cid)}))}
    else b=h('div',attrs);
    b.append(h('span',{class:'hang-str',style:{height:(im?strLen+10:strLen)+'px'}}),imgEl(srcOf(ch),im?'imp':null));
    row.append(b);
  });
  el.append(row);
  if(!n&&o.empty)el.append(h('div',{class:'strip-empty',text:o.empty}));
  return el;
}

// ---------- empty-state art (static) ----------
const ART_LINE=`<svg class="empty-art" viewBox="0 0 180 120" aria-hidden="true"><path d="M6 14 Q90 26 174 14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M50 19v30"/><path d="M90 20v44"/><path d="M130 19v22"/></g><g fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.6" stroke-dasharray="4 4"><circle cx="50" cy="62" r="13"/><rect x="77" y="66" width="26" height="34" rx="11"/><circle cx="130" cy="53" r="12"/></g><circle cx="90" cy="20" r="3.2" fill="currentColor"/><circle cx="50" cy="19" r="3" fill="currentColor"/><circle cx="130" cy="19" r="3" fill="currentColor"/></svg>`;
const ART_PULL=`<svg class="empty-art" viewBox="0 0 180 120" aria-hidden="true"><path d="M6 12h168" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M90 12v58" stroke="currentColor" stroke-width="1.5"/><circle cx="90" cy="84" r="14" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="90" cy="84" r="21" fill="none" stroke="currentColor" stroke-opacity=".4" stroke-width="2" stroke-dasharray="5 5"/><path d="M130 50v40m-7-7 7 7 7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ART_IMG=`<svg class="empty-art" viewBox="0 0 180 120" aria-hidden="true"><path d="M6 12 Q90 22 174 12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M90 17v20" stroke="currentColor" stroke-width="1.5"/><rect x="62" y="40" width="56" height="62" rx="10" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="78" cy="58" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M64 94l16-16 11 11 8-8 17 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

// =====================================================================
// My line
// =====================================================================
let lenDrag=false,lenT=0,jT=0;
function renderLine(){
  const P=$('p-line');
  if(!P.dataset.built){
    P.dataset.built='1';
    P.append(pageHead('line','My line','',[
      h('button',{type:'button',class:'btn',id:'lNudge',onclick:()=>cmd('nudge',{})},ic('wind'),'Nudge'),
      h('button',{type:'button',class:'btn danger',id:'lClear',onclick:clearLine},ic('clear'),'Clear line')
    ]),h('div',{id:'lStrip'}),h('div',{id:'lBody'}));
  }
  const n=LS.charms.length;
  P.querySelector('.ph-d').textContent=n?'The charms hanging on your screen, left to right. Pick one to change its rope, cap or what happens when you pull it.':'Nothing is hanging yet. Pick a charm to start your line.';
  P.querySelector('.ph-a').hidden=!n;$('lStrip').hidden=!n;
  $('lStrip').replaceChildren(strip(LS.charms,{rope:LS.S.rope,size:1,sel:selCid,onPick:c=>selectCharm(c,true),empty:''}));
  const body=$('lBody');
  if(!n){
    body.replaceChildren(h('div',{class:'card empty'},art(ART_LINE),h('h2',{text:'Your line is empty'}),h('p',{text:'Hang a charm from the catalogue, or turn one of your own pictures into a charm.'}),
      h('div',{class:'w-go'},h('button',{type:'button',class:'btn primary',onclick:()=>go('catalogue',{fromNav:true})},ic('cat'),'Browse the catalogue'),h('button',{type:'button',class:'btn',onclick:()=>go('images',{fromNav:true})},ic('img'),'Use my own image'))));
    delete body.dataset.grid;return;
  }
  if(!body.dataset.grid){
    body.dataset.grid='1';
    body.replaceChildren(h('div',{class:'lgrid'},h('div',{class:'card llist',id:'lList'}),h('div',{id:'lDetailHost'})));
  }
  renderList();renderDetail();
}
function renderList(){
  const L=$('lList');if(!L)return;
  const a=document.activeElement,hadFocus=L.contains(a);
  const box=h('div',{role:'listbox','aria-label':'Charms on your line, left to right',id:'lBox'});
  const tabCid=selCid||(LS.charms[0]&&LS.charms[0].cid);
  LS.charms.forEach((ch,i)=>{
    const acts=ACT[ch.cid]||{},sel=ch.cid===selCid;
    const bd=h('div',{class:'bdg'});
    if(acts.pull)bd.append(h('span',{class:'tag',title:'When pulled: '+actText(acts.pull)},ic('pull'),h('span',{text:actText(acts.pull)})));
    if(acts.long)bd.append(h('span',{class:'tag',title:'Long pull: '+actText(acts.long)},ic('long'),h('span',{text:actText(acts.long)})));
    const sub=[collOf(ch)];if(isJersey(ch)&&(ch.opts.name||ch.opts.number!=null))sub.push([ch.opts.name,ch.opts.number].filter(x=>x!==''&&x!=null).join(' \u00b7 '));
    const row=h('div',{class:'lrow',role:'option','aria-selected':String(sel),tabindex:ch.cid===tabCid?'0':'-1','data-cid':ch.cid,'data-k':'row-'+ch.cid},
      h('span',{class:'idx',text:String(i+1)}),thumbEl(ch),h('div',{class:'nm'},h('b',{text:nameOf(ch)}),h('span',{text:sub.filter(Boolean).join(' \u00b7 ')})),bd);
    row.addEventListener('click',()=>selectCharm(ch.cid,false));
    box.append(row);
  });
  box.addEventListener('keydown',e=>{
    const rows=[...box.querySelectorAll('.lrow')],i=rows.indexOf(document.activeElement);if(i<0)return;
    let j=null;if(e.key==='ArrowDown')j=i+1;else if(e.key==='ArrowUp')j=i-1;else if(e.key==='Home')j=0;else if(e.key==='End')j=rows.length-1;
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCharm(rows[i].dataset.cid,false);return}
    if(j==null)return;e.preventDefault();j=clamp(j,0,rows.length-1);selectCharm(rows[j].dataset.cid,false,true);
  });
  const n=LS.charms.length,withAct=LS.charms.filter(c=>ACT[c.cid]&&(ACT[c.cid].pull||ACT[c.cid].long)).length;
  L.replaceChildren(h('div',{class:'llist-h'},h('span',{text:plural(n,'charm')+' on your line'}),h('span',{text:withAct?plural(withAct,'pull action'):''})),box);
  if(hadFocus){const r=L.querySelector('[data-k="row-'+(a&&a.dataset.cid||selCid)+'"]')||L.querySelector('.lrow[tabindex="0"]');if(r)r.focus({preventScroll:true})}
}
function selectCharm(cid,fromStrip,keyNav){
  if(!LS.charms.some(c=>c.cid===cid))return;
  selCid=cid;
  document.querySelectorAll('#lStrip .hang').forEach((b,i)=>b.setAttribute('aria-pressed',String(LS.charms[i]&&LS.charms[i].cid===cid)));
  renderList();
  if(keyNav){const r=document.querySelector('#lList [data-cid="'+CSS.escape(cid)+'"]');if(r)r.focus()}
  renderDetail();
  const d=$('lDetail');
  if(d&&d.getBoundingClientRect().top>innerHeight-120)d.scrollIntoView({block:'start',behavior:reduce?'auto':'smooth'});
}
const selCh=()=>LS.charms.find(c=>c.cid===selCid)||null;

// ----- detail pane -----
let D=null; // built detail for one cid
function renderDetail(){
  const host=$('lDetailHost');if(!host)return;
  const ch=selCh();
  if(!ch){D=null;host.replaceChildren(h('div',{class:'card detail',id:'lDetail'},h('div',{class:'empty sm'},art(ART_PULL),h('h2',{text:'Pick a charm'}),h('p',{text:'Choose a charm on the left or on the line above to change its rope length, cap and pull actions.'}))));return}
  if(!D||D.cid!==ch.cid||!host.contains(D.el))buildDetail(ch,host);
  syncDetail(ch);
}
function buildDetail(ch,host){
  const cat=LS.catalog;D={cid:ch.cid};
  const name=h('h2',{id:'dName'}),sub=h('p',{id:'dSub'});
  const show=h('button',{type:'button',class:'btn sm',onclick:showMe},ic('spark'),'Show me');
  const head=h('div',{class:'d-head'},h('div',{id:'dThumb'}),h('div',{class:'d-title'},name,sub,show));
  // rope
  const len=h('input',{type:'range',id:'dLen',min:'60',max:'420',step:'5','aria-describedby':'dLenOut'});
  const out=h('output',{id:'dLenOut',for:'dLen'});
  len.addEventListener('input',()=>{lenDrag=true;setRangeFill(len);out.textContent=len.value+' px';clearTimeout(lenT);lenT=setTimeout(()=>sendLen(ch.cid,+len.value),70)});
  len.addEventListener('change',()=>{clearTimeout(lenT);sendLen(ch.cid,+len.value).then(()=>{lenDrag=false})});
  const rope=h('div',{class:'d-sec'},h('h3',{class:'sub-h',text:'Rope'}),h('div',{class:'field'},h('label',{for:'dLen',text:'Length'}),h('div',{class:'rng'},len,out)));
  // cap
  const capD=h('select',{class:'select',id:'dCapD'}),capF=h('select',{class:'select',id:'dCapF'});
  capD.append(h('option',{value:'',text:'Same as Style'}),...cat.capDesigns.map(([id,n])=>h('option',{value:id,text:n})));
  capF.append(h('option',{value:'',text:'Same as Style'}),...cat.capStyles.map(([id,n])=>h('option',{value:id,text:n})));
  capD.addEventListener('change',()=>upd({capDesign:capD.value}));
  capF.addEventListener('change',()=>upd({capStyle:capF.value}));
  const capOn=h('input',{type:'checkbox',class:'switch',role:'switch',id:'dCapOn'});
  capOn.addEventListener('change',()=>upd({cap:capOn.checked}));
  const capSec=h('div',{class:'d-sec'},h('h3',{class:'sub-h',text:'Bead cap'}),
    ch.type==='img'?h('label',{class:'inline-sw',for:'dCapOn'},h('span',{text:'Wear a bead cap'}),capOn):null,
    h('div',{class:'field',id:'dCapDRow'},h('label',{for:'dCapD',text:'Design'}),capD),
    h('div',{class:'field',id:'dCapFRow'},h('label',{for:'dCapF',text:'Finish'}),capF));
  // jersey
  let jer=null;
  if(isJersey(ch)){
    const jn=h('input',{type:'text',class:'input',id:'dJName',maxlength:'12',placeholder:'On the back',autocomplete:'off',spellcheck:'false'});
    const jnum=h('input',{type:'number',class:'input',id:'dJNum',min:'0',max:'99',inputmode:'numeric'});
    const jteam=h('select',{class:'select',id:'dJTeam'},h('option',{value:'',text:'Custom colors'}),...cat.teams.map(([id,n])=>h('option',{value:id,text:n+' colors'})));
    const jedit=()=>{clearTimeout(jT);jT=setTimeout(()=>{const o={name:jn.value.slice(0,12)};if(jnum.value!=='')o.number=clamp(parseInt(jnum.value,10)||0,0,99);upd(o)},300)};
    jn.addEventListener('input',jedit);jnum.addEventListener('input',jedit);
    jnum.addEventListener('blur',()=>{if(jnum.value!==''){const v=clamp(parseInt(jnum.value,10)||0,0,99);if(String(v)!==jnum.value)jnum.value=v}});
    jteam.addEventListener('change',()=>upd({team:jteam.value}));
    const pat=h('div',{class:'jpat',id:'dJPat',role:'radiogroup','aria-label':'Pattern'});
    const cols=h('div',{class:'swatches',id:'dJCol',role:'radiogroup','aria-label':'Colors'});
    jer=h('div',{class:'d-sec'},h('h3',{class:'sub-h',text:'Jersey'}),
      h('div',{class:'field'},h('label',{for:'dJName',text:'Name'}),jn),
      h('div',{class:'field'},h('label',{for:'dJNum',text:'Number'}),jnum),
      h('div',{class:'field'},h('label',{for:'dJTeam',text:'Kit'}),jteam),
      h('div',{id:'dJCustom'},h('div',{class:'field'},h('span',{class:'fl',text:'Pattern'}),pat),h('div',{class:'field'},h('span',{class:'fl',text:'Colors'}),cols)));
  }
  // actions
  const acts=h('div',{class:'d-sec',id:'dActs'},h('h3',{class:'sub-h',text:'When you pull it'}),h('div',{id:'dActRows'}),
    h('button',{type:'button',class:'btn ghost sm addlong',id:'dAddLong',onclick:()=>{D.longOpen=true;renderActs();D.rows.long.kind.focus()}},ic('plus'),'Add a long-pull action'),
    h('div',{class:'hint',id:'dHint',hidden:true},ic('pull'),h('span',{id:'dHintT'})));
  // footer
  const foot=h('div',{class:'d-foot'},
    h('button',{type:'button',class:'btn danger',onclick:removeSel},ic('trash'),'Remove from line'),
    ch.type==='img'?h('button',{type:'button',class:'btn ghost sm',onclick:()=>forgetImage(ch.opts.key)},'Delete image from library'):null);
  D.el=h('div',{class:'card detail',id:'lDetail','aria-labelledby':'dName'},head,rope,capSec,jer,acts,foot);
  host.replaceChildren(D.el);
  D.rows={pull:actRow('pull'),long:actRow('long')};D.longOpen=false;
  $('dActRows').append(D.rows.pull.n,D.rows.long.n);
}
function syncDetail(ch){
  if(!D)return;const cat=LS.catalog,S=LS.S,o=ch.opts||{},act=document.activeElement;
  $('dName').textContent=nameOf(ch);
  const pos=LS.charms.indexOf(ch)+1;$('dSub').textContent=[collOf(ch),'Number '+pos+' of '+LS.charms.length+' from the left'].filter(Boolean).join(' \u00b7 ');
  const th=$('dThumb');if(th.dataset.src!==srcOf(ch)){th.dataset.src=srcOf(ch);th.replaceChildren(thumbEl(ch))}
  const len=$('dLen');len.max=String(Math.max(180,Math.round(ch.lenMax||420),Math.round(ch.len)));
  if(!lenDrag&&act!==len){len.value=String(Math.round(ch.len));}
  if(!lenDrag){setRangeFill(len);$('dLenOut').textContent=len.value+' px'}
  const capD=$('dCapD'),capF=$('dCapF');
  if(act!==capD)capD.value=o.capDesign&&cat.capDesigns.some(x=>x[0]===o.capDesign)?o.capDesign:'';
  if(act!==capF)capF.value=o.capStyle&&cat.capStyles.some(x=>x[0]===o.capStyle)?o.capStyle:'';
  const eff=o.capDesign||S.capDesign,capOff=ch.type==='img'&&o.cap===false;
  $('dCapFRow').hidden=eff==='signature'||capOff;$('dCapDRow').hidden=capOff;
  const sd=S.capDesign&&cat.capDesigns.find(x=>x[0]===S.capDesign),sf=S.cap&&cat.capStyles.find(x=>x[0]===S.cap);
  capD.options[0].textContent='Same as Style'+(sd?' ('+sd[1]+')':'');capF.options[0].textContent='Same as Style'+(sf?' ('+sf[1]+')':'');
  if($('dCapOn'))$('dCapOn').checked=o.cap!==false;
  if(isJersey(ch)&&$('dJName')){
    const pre=cat.jerseyPresets[0]||['#c8102e','#ffffff'];
    const j=Object.assign({name:'',number:10,style:'stripes',c1:pre[0],c2:pre[1],team:''},o);
    if(act!==$('dJName'))$('dJName').value=j.name||'';
    if(act!==$('dJNum'))$('dJNum').value=j.number!=null?j.number:'';
    if(act!==$('dJTeam'))$('dJTeam').value=cat.teams.some(t=>t[0]===j.team)?j.team:'';
    $('dJCustom').hidden=!!j.team;
    keepFocus(()=>{
      $('dJPat').replaceChildren(...cat.jerseyStyles.map(([id,n])=>h('button',{type:'button',role:'radio','aria-checked':String(j.style===id),'data-k':'jp-'+id,text:n,onclick:()=>upd({style:id})})));
      $('dJCol').replaceChildren(...cat.jerseyPresets.map(([a,b])=>h('button',{type:'button',class:'sw',role:'radio','aria-checked':String(j.c1===a&&j.c2===b),'aria-label':a+' and '+b,title:a+' / '+b,'data-k':'jc-'+a+b,style:{background:'linear-gradient(135deg,'+a+' 50%,'+b+' 50%)'},onclick:()=>upd({c1:a,c2:b})})));
    });
  }
  renderActs();
}
async function sendLen(cid,v){const r=await cmd('update',{cid,len:v},true);if(!r.ok)toast(r.error||'That didn\u2019t work.',{bad:true});return r}
function upd(opts){const ch=selCh();if(!ch)return;Object.assign(ch.opts,opts);syncDetail(ch);return cmd('update',{cid:ch.cid,opts})}
async function showMe(){
  const ch=selCh();if(!ch)return;
  if(!SHOWN){toast('Your charms are hidden right now.',{action:{label:'Show them',fn:async()=>{try{setShown(await api.charms.toggle())}catch(e){}cmd('highlight',{cid:ch.cid},true)}}});return}
  cmd('highlight',{cid:ch.cid});
}
async function removeSel(){
  const ch=selCh();if(!ch)return;
  const i=LS.charms.indexOf(ch),a=ACT[ch.cid];
  if(a&&(a.pull||a.long)){if(!await confirmDlg({title:'Remove '+nameOf(ch)+'?',msg:'Its pull actions are removed too.',ok:'Remove'}))return}
  const r=await cmd('remove',{cid:ch.cid});if(!r.ok)return;
  const next=LS.charms[i+1]||LS.charms[i-1];selCid=next&&next.cid!==ch.cid?next.cid:null;
  toast(nameOf(ch)+' is off your line.',{img:srcOf(ch)});
  await refreshLine();
  const f=selCid&&document.querySelector('#lList [data-cid="'+CSS.escape(selCid)+'"]');if(f)f.focus();
}
async function clearLine(){
  const n=LS.charms.length;if(!n)return;
  if(!await confirmDlg({title:'Clear your line?',msg:'This takes all '+plural(n,'charm')+' off your screen. Any pull actions go with them. Your images stay in Your images.',ok:'Clear line'}))return;
  const r=await cmd('clear',{});if(r.ok){selCid=null;toast('Your line is clear.');refreshLine()}
}
async function forgetImage(key){
  const im=importOf(key);if(!im)return;const n=byKey()[key]||0;
  if(!await confirmDlg({title:'Delete \u201c'+im.name+'\u201d?',msg:n?'The image is removed from your library and '+plural(n,'charm')+' made from it '+(n===1?'comes':'come')+' off your line.':'The image is removed from your library.',ok:'Delete image'}))return;
  const r=await cmd('forgetImage',{key});if(r.ok){toast('\u201c'+im.name+'\u201d deleted.');refreshLine()}
}

// ----- pull action rows (the v1.1 action UI) -----
function actRow(slot){
  const kind=h('select',{class:'select',id:'ak-'+slot,'aria-label':slot==='pull'?'When pulled':'Long pull'},
    h('option',{value:'',text:'Nothing (just swings)'}),h('option',{value:'url',text:'Open a website'}),h('option',{value:'app',text:'Open an app'}),
    h('option',{value:'file',text:'Open a file'}),h('option',{value:'folder',text:'Open a folder'}),h('option',{value:'copy',text:'Copy text'}),h('option',{value:'toggle',text:'Hide charms'}));
  const infoIc=h('span',{class:'ai-ic'}),infoT=h('span');
  const info=h('div',{class:'ainfo',hidden:true},h('span',{class:'dot'}),infoIc,infoT);
  const urlIn=h('input',{type:'text',class:'input',inputmode:'url',placeholder:'https://example.com',autocomplete:'off',spellcheck:'false',maxlength:'2048','aria-label':'Website address'});
  const urlBtn=h('button',{type:'button',class:'btn',text:'Save'});
  const url=h('div',{class:'act-f',hidden:true},urlIn,urlBtn);
  const pickBtn=h('button',{type:'button',class:'btn wide'});
  const pick=h('div',{class:'act-f',hidden:true},pickBtn);
  const ta=h('textarea',{class:'input',maxlength:'500',rows:'3',placeholder:'Text to copy when you pull','aria-label':'Text to copy'});
  const cnt=h('span',{class:'note'}),copyBtn=h('button',{type:'button',class:'btn sm',text:'Save'});
  const copy=h('div',{hidden:true,style:{marginTop:'8px'}},ta,h('div',{class:'acnt'},cnt,copyBtn));
  const tryBtn=h('button',{type:'button',class:'btn sm'},ic('play'),'Try it');
  const tryRow=h('div',{class:'act-f',hidden:true},tryBtn);
  const msg=h('p',{class:'note amsg',role:'status'});
  const n=h('div',{class:'act'},h('div',{class:'act-h'},ic(slot==='pull'?'pull':'long'),h('b',{text:slot==='pull'?'When pulled':'Long pull'}),h('small',{text:slot==='pull'?'Pull down, let go':'Pull down, hold a second'})),kind,info,url,pick,copy,tryRow,msg);
  const r={slot,n,kind,info,infoIc,infoT,url,urlIn,urlBtn,pick,pickBtn,copy,ta,cnt,copyBtn,tryRow,tryBtn,msg,draft:null,busy:false,cid:null};
  kind.addEventListener('change',()=>onKind(r));
  urlIn.addEventListener('keydown',e=>{if(e.key==='Enter')saveUrl(r)});
  urlBtn.addEventListener('click',()=>saveUrl(r));
  pickBtn.addEventListener('click',()=>runAct(r,cid=>api.actions.pick(cid,slot,r.draft||(cur(r)||{}).kind)));
  ta.addEventListener('input',()=>{cnt.textContent=ta.value.length+' / 500'});
  copyBtn.addEventListener('click',()=>saveCopy(r));
  tryBtn.addEventListener('click',()=>runAct(r,cid=>api.actions.test(cid,slot),true));
  return r;
}
const cur=r=>{const a=ACT[selCid];return a&&a[r.slot]||null};
function say(r,t,bad){r.msg.textContent=t||'';r.msg.classList.toggle('err',!!bad)}
async function runAct(r,fn,isTest){
  const cid=selCid;if(!cid||r.busy)return;
  say(r,isTest?'Trying\u2026':'');r.busy=true;renderActs();
  let res;try{res=await fn(cid)}catch(e){res={ok:false,error:'Something went wrong. Try again.'}}
  r.busy=false;
  if(selCid===cid){
    if(res&&res.ok){say(r,isTest?'Done.':'');if(!isTest){r.draft=null;r.urlIn.value='';r.ta.value='';r.cnt.textContent=''}}
    else if(res&&(res.canceled||res.declined))say(r,'');
    else say(r,res&&res.error||'That didn\u2019t work.',true);
  }
  await refreshActs();return res;
}
function onKind(r){
  const v=r.kind.value,info=cur(r);say(r,'');
  if(v===''){r.draft=null;if(info)runAct(r,cid=>api.actions.clear(cid,r.slot));else{if(r.slot==='long')D.longOpen=false;renderActs()}return}
  if(v==='toggle'){r.draft=null;runAct(r,cid=>api.actions.setToggle(cid,r.slot));return}
  r.draft=v;renderActs();
  const f=v==='url'?r.urlIn:v==='copy'?r.ta:null;if(f)f.focus();
}
function saveUrl(r){
  let v=r.urlIn.value.trim();
  if(!v){say(r,'Type a web address first.',true);return}
  if(!/^[a-z][a-z0-9+.-]*:/i.test(v))v='https://'+v;
  runAct(r,cid=>api.actions.setUrl(cid,r.slot,v));
}
function saveCopy(r){
  const v=r.ta.value;
  if(!v.trim()){say(r,'Type the text to copy first.',true);return}
  runAct(r,cid=>api.actions.setCopy(cid,r.slot,v.slice(0,500)));
}
function renderActs(){
  if(!D||!D.rows||D.cid!==selCid)return;
  const a=ACT[selCid]||{};
  for(const r of [D.rows.pull,D.rows.long]){
    if(r.cid!==selCid){r.cid=selCid;r.draft=null;say(r,'');r.urlIn.value='';r.ta.value='';r.cnt.textContent=''}
    const info=a[r.slot]||null,k=r.draft||(info?info.kind:''),saved=!!(info&&info.kind===k);
    if(document.activeElement!==r.kind||!r.busy)r.kind.value=k;
    r.info.hidden=!saved;
    if(saved){r.infoIc.replaceChildren(kindIcon(info));r.infoT.textContent=info.label||actText(info);r.info.title=actText(info)}
    r.url.hidden=k!=='url';r.urlIn.placeholder=saved?'Type a new address to change it':'https://example.com';
    r.pick.hidden=!(k==='app'||k==='file'||k==='folder');
    r.pickBtn.textContent=saved?'Choose another\u2026':'Choose '+({app:'an app',file:'a file',folder:'a folder'}[k]||'')+'\u2026';
    r.copy.hidden=k!=='copy';r.ta.placeholder=saved?'Type new text to change it':'Text to copy when you pull';
    r.tryRow.hidden=!saved;
    r.n.querySelectorAll('select,button,input,textarea').forEach(el=>{el.disabled=r.busy});
  }
  const showLong=D.longOpen||!!a.long||!!D.rows.long.draft;
  D.rows.long.n.hidden=!showLong;$('dAddLong').hidden=showLong||!a.pull;
  const hint=a.pull||a.long?'Pull this charm down and let go.'+(a.long?' Hold it there for a second for the long pull.':''):'';
  $('dHint').hidden=!hint;$('dHintT').textContent=hint;
}

// =====================================================================
// Catalogue
// =====================================================================
let catQ='',catColl='all';
function renderCatalogue(){
  const P=$('p-catalogue');
  if(!P.dataset.built){
    P.dataset.built='1';
    const q=h('input',{type:'search',class:'input',id:'catQ',placeholder:'Search charms',autocomplete:'off',spellcheck:'false','aria-label':'Search charms'});
    q.addEventListener('input',()=>{catQ=q.value;renderCatGrid()});
    q.addEventListener('keydown',e=>{if(e.key==='Escape'&&q.value){e.stopPropagation();q.value='';catQ='';renderCatGrid()}});
    P.append(pageHead('catalogue','Catalogue',''),h('div',{class:'tools'},h('div',{class:'search'},ic('search'),q),h('div',{class:'chips',id:'catChips',role:'group','aria-label':'Collections'})),h('div',{id:'catGrid'}));
  }
  const cols=LS.catalog.collections,total=cols.reduce((a,c)=>a+c.items.length,0);
  P.querySelector('.ph-d').textContent=total?total+' charms in '+cols.length+' collections. Hang as many as you like, even the same one twice.':'The charm catalogue loads from the charms. Is Charm Line running?';
  if(catColl!=='all'&&!cols.some(c=>c.name===catColl))catColl='all';
  keepFocus(()=>{
    $('catChips').replaceChildren(...[['all','All',total],...cols.map(c=>[c.name,c.name,c.items.length])].map(([v,l,n])=>h('button',{type:'button',class:'chip','aria-pressed':String(catColl===v),'data-k':'chip-'+v,onclick:()=>{catColl=v;renderCatalogue()}},l,h('small',{text:String(n)}))));
  });
  renderCatGrid();
}
function renderCatGrid(){
  const G=$('catGrid');if(!G)return;
  const q=catQ.trim().toLowerCase(),counts=byType();
  const cols=LS.catalog.collections.filter(c=>catColl==='all'||c.name===catColl)
    .map(c=>({name:c.name,items:c.items.filter(it=>!q||it.name.toLowerCase().includes(q)||c.name.toLowerCase().includes(q)||it.id.includes(q))})).filter(c=>c.items.length);
  keepFocus(()=>{
    if(!cols.length){
      G.replaceChildren(h('div',{class:'card empty'},art(ART_LINE),h('h2',{text:q?'No charms match \u201c'+catQ.trim()+'\u201d':'No charms here yet'}),h('p',{text:q?'Try another word, like \u201clucky\u201d or \u201cchai\u201d.':'The catalogue comes from the charms themselves.'}),
        q?h('button',{type:'button',class:'btn',onclick:()=>{$('catQ').value='';catQ='';renderCatGrid();$('catQ').focus()}},'Clear search'):null));
      return;
    }
    const grouped=catColl==='all'&&!q;
    const card=(it,coll)=>{
      const n=counts[it.id]||0;
      const hu=hungCls(it.id);
      const c=h('article',{class:'ccard'+(hu?hu.cls:''),style:hu?{'--hd':hu.delay}:null,'aria-label':it.name},
        n?h('span',{class:'onl-badge','aria-hidden':'true',text:'On your line \u00d7'+n}):null,
        h('div',{class:'pic'},imgEl(charmSrc(it.id))),
        h('div',{class:'body'},h('b',{text:it.name}),
          h('div',{class:'row'},h('span',{text:coll}),
            h('button',{type:'button',class:'btn primary sm','data-k':'hang-'+it.id,'aria-label':'Hang '+it.name+(n?' (on your line \u00d7'+n+')':''),onclick:e=>hang(it,coll,e.currentTarget.closest('.ccard'))},ic('plus'),'Hang'))));
      return c;
    };
    if(grouped)G.replaceChildren(...cols.map(c=>h('section',{class:'cgroup','aria-label':c.name},h('div',{class:'sect-h'},h('h2',{text:c.name}),h('span',{class:'n',text:plural(c.items.length,'charm')})),h('div',{class:'cgrid'},c.items.map(it=>card(it,c.name))))));
    else G.replaceChildren(h('div',{class:'cgrid'},cols.flatMap(c=>c.items.map(it=>card(it,c.name)))));
  });
}
let HUNG={id:null,t:0};
function hungCls(id){const dt=Date.now()-HUNG.t;return HUNG.id===id&&dt<900?{cls:' hung',delay:-dt+'ms'}:null}
async function hang(it,coll,cardEl){
  HUNG={id:it.id,t:Date.now()};if(cardEl){cardEl.classList.remove('hung');void cardEl.offsetWidth;cardEl.classList.add('hung')}
  const r=await cmd('add',{type:it.id});
  if(!r.ok)return;
  const cid=okCid(r.cid)?r.cid:null;
  toast(it.name+' is on your line.',{img:charmSrc(it.id),action:cid?{label:'Edit',fn:()=>go('line',{cid,fromNav:true})}:null});
  refreshLine();
}

// =====================================================================
// Your images
// =====================================================================
const MAX_IMG=15*1024*1024;
const MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml'};
let importing=false;
function renderImages(){
  const P=$('p-images');
  if(!P.dataset.built){
    P.dataset.built='1';
    const file=h('input',{type:'file',id:'imgFile',accept:'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg',multiple:true,hidden:true});
    file.addEventListener('change',()=>{const fs=[...(file.files||[])];file.value='';importFiles(fs)});
    const drop=h('div',{class:'drop',id:'drop'},
      h('div',{class:'drop-art'},ic('upload')),
      h('div',{style:{flex:'1',minWidth:'0'}},h('h2',{text:'Drop pictures here'}),h('p',{text:'PNG, JPG, WebP or SVG, up to 15 MB each. Each one becomes a charm and joins your line.'}),
        h('button',{type:'button',class:'btn primary',id:'imgChoose',onclick:()=>file.click()},ic('img'),'Choose images\u2026'),
        h('p',{class:'note progress',id:'imgMsg',role:'status'})),file);
    ['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{if(![...(e.dataTransfer&&e.dataTransfer.types||[])].includes('Files'))return;e.preventDefault();drop.classList.add('over')}));
    ['dragleave','dragend'].forEach(t=>drop.addEventListener(t,e=>{if(!drop.contains(e.relatedTarget))drop.classList.remove('over')}));
    drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');importFiles([...(e.dataTransfer&&e.dataTransfer.files||[])])});
    const tips=h('aside',{class:'card tips','aria-label':'Tips'},h('h3',{class:'sub-h',text:'Tips'}),
      h('ul',null,
        h('li',null,ic('check'),h('span',{text:'Transparent PNGs look best: the charm takes the shape of your picture.'})),
        h('li',null,ic('spark'),h('span',{text:'A plain background around the edges is removed for you.'})),
        h('li',null,ic('img'),h('span',{text:'Big pictures are scaled down. Your images stay on this computer.'}))),
      h('div',{class:'tips-sw','aria-hidden':'true'},h('div',{class:'good',text:'Transparent'}),h('div',{class:'ok',text:'Plain white'})));
    P.append(pageHead('images','Your images','Turn any picture into a charm: a pet, a logo, a sticker you love.'),
      h('div',{class:'igrid'},h('div',null,drop,h('div',{id:'imgList',style:{marginTop:'26px'}})),tips));
  }
  const L=$('imgList'),counts=byKey();
  keepFocus(()=>{
    if(!LS.imports.length){L.replaceChildren(h('div',{class:'card empty sm'},art(ART_IMG),h('h2',{text:'No images yet'}),h('p',{text:'Pictures you import show up here, so you can hang them again or delete them.'})));return}
    L.replaceChildren(h('div',{class:'sect-h'},h('h2',{text:'In your library'}),h('span',{class:'n',text:plural(LS.imports.length,'image')})),
      h('div',{class:'cgrid'},LS.imports.map(im=>{const n=counts[im.key]||0,hu=hungCls('img:'+im.key);return h('article',{class:'ccard'+(hu?hu.cls:''),style:hu?{'--hd':hu.delay}:null,'aria-label':im.name},
        n?h('span',{class:'onl-badge','aria-hidden':'true',text:'On your line \u00d7'+n}):null,
        h('div',{class:'pic'},imgEl(im.thumb,'imp')),
        h('div',{class:'body'},h('b',{text:im.name}),h('span',{text:n?'Your image':'Not on your line'}),
          h('div',{class:'row'},
            h('button',{type:'button',class:'btn primary sm','data-k':'ih-'+im.key,'aria-label':'Hang '+im.name,onclick:e=>hangImage(im,e.currentTarget.closest('.ccard'))},ic('plus'),'Hang'),
            h('button',{type:'button',class:'btn ghost icon sm','data-k':'id-'+im.key,'aria-label':'Delete '+im.name,title:'Delete image',onclick:()=>forgetImage(im.key)},ic('trash')))))})));
  });
}
async function hangImage(im,cardEl){
  HUNG={id:'img:'+im.key,t:Date.now()};if(cardEl){cardEl.classList.remove('hung');void cardEl.offsetWidth;cardEl.classList.add('hung')}
  const r=await cmd('addImage',{key:im.key});if(!r.ok)return;
  const cid=okCid(r.cid)?r.cid:null;
  toast('\u201c'+im.name+'\u201d is on your line.',{img:im.thumb||null,action:cid?{label:'Edit',fn:()=>go('line',{cid,fromNav:true})}:null});refreshLine();
}
const readAs=(f,how)=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r[how](f)});
async function importFiles(files){
  if(importing||!files.length)return;importing=true;
  const msg=$('imgMsg'),btn=$('imgChoose');btn.disabled=true;msg.classList.remove('err');
  let ok=0,last=null;const errs=[];
  for(let i=0;i<files.length;i++){
    const f=files[i],ext=(f.name.match(/\.([a-z0-9]+)$/i)||[])[1];const mime=MIME[(ext||'').toLowerCase()]||(Object.values(MIME).includes(f.type)?f.type:'');
    const nm=(f.name.replace(/\.[^.]+$/,'')||'Your image').slice(0,60);
    msg.textContent=files.length>1?'Adding '+(i+1)+' of '+files.length+'\u2026':'Adding \u201c'+nm+'\u201d\u2026';
    if(!mime){errs.push(f.name+' isn\u2019t a PNG, JPG, WebP or SVG.');continue}
    if(f.size>MAX_IMG){errs.push(f.name+' is over 15 MB. Use a smaller image.');continue}
    let url;try{url=await readAs(f,'readAsDataURL')}catch(e){errs.push(f.name+' could not be read.');continue}
    if(typeof url!=='string'){errs.push(f.name+' could not be read.');continue}
    url=url.replace(/^data:[^;,]*/,'data:'+mime);
    const r=await cmd('import',{name:nm,dataUrl:url},true);
    if(r.ok){ok++;last=nm}else errs.push(r.error||(f.name+' could not be added.'));
  }
  importing=false;btn.disabled=false;
  if(errs.length){msg.textContent=errs.join(' ');msg.classList.add('err');toast(errs[0],{bad:true})}else msg.textContent='';
  if(ok)toast(ok===1?'\u201c'+last+'\u201d is on your line.':ok+' images are on your line.');
  refreshLine();
}

// =====================================================================
// Style
// =====================================================================
const FIN_COL={gold:'#e0ae55',silver:'#dfe3e8',rose:'#e7a98c',pearl:'#f6efe4',onyx:'#1a1a1f',crystal:'#dfeeff',wood:'#7a3f22'};
const ROPES=[['thread','Golden thread'],['chain','Silver chain'],['neon','Neon']];
const ROPE_ART={
  thread:`<svg viewBox="0 0 160 46" aria-hidden="true"><path d="M6 10 Q80 34 154 10" fill="none" stroke="#8e6a22" stroke-width="3.4" stroke-linecap="round"/><path d="M6 10 Q80 34 154 10" fill="none" stroke="#f3d68f" stroke-width="1.1" stroke-linecap="round" stroke-dasharray="3 3"/><circle cx="80" cy="22" r="3.4" fill="#e0b96c"/></svg>`,
  chain:`<svg viewBox="0 0 160 46" aria-hidden="true"><path d="M6 10 Q80 34 154 10" fill="none" stroke="#5f6a76" stroke-width="4.4" stroke-linecap="round" stroke-dasharray="6 2.5"/><path d="M6 10 Q80 34 154 10" fill="none" stroke="#e3e9ef" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="6 2.5"/><circle cx="80" cy="22" r="3.4" fill="#c7ced6"/></svg>`,
  neon:`<svg viewBox="0 0 160 46" aria-hidden="true"><rect class="ropt-bg neon-bg" x="0" y="0" width="160" height="46" rx="8"/><path d="M6 10 Q80 34 154 10" fill="none" stroke="#62f2ff" stroke-width="2.8" stroke-linecap="round" filter="url(#neonGlow)"/><path d="M6 10 Q80 34 154 10" fill="none" stroke="#eaffff" stroke-width="1" stroke-linecap="round"/></svg>`
};
const DEMO_LINE=[['nimbu',140],['bommai',210],['kitpendant',120],['nazar',175],['lantern',130],['bell',185],['luckycat',150]];
let sizeT=0,sizeDrag=false;
function styleCmd(p){Object.assign(LS.S,p);renderStyle();return cmd('style',p)}
function renderStyle(){
  const P=$('p-style'),S=LS.S,cat=LS.catalog;
  if(!P.dataset.built){
    P.dataset.built='1';
    const size=h('input',{type:'range',id:'stSize',min:'0.6',max:'1.6',step:'0.05','aria-label':'Charm size'});
    size.addEventListener('input',()=>{sizeDrag=true;setRangeFill(size);$('stSizeOut').textContent=Math.round(+size.value*100)+'%';LS.S.size=+size.value;$('stStrip').replaceChildren(styleStrip());clearTimeout(sizeT);sizeT=setTimeout(()=>cmd('style',{size:+size.value},true),80)});
    size.addEventListener('change',()=>{clearTimeout(sizeT);cmd('style',{size:+size.value}).then(()=>{sizeDrag=false})});
    const snd=h('input',{type:'checkbox',class:'switch',role:'switch',id:'stSound'}),wind=h('input',{type:'checkbox',class:'switch',role:'switch',id:'stWind'});
    snd.addEventListener('change',()=>styleCmd({sound:snd.checked}));wind.addEventListener('change',()=>styleCmd({wind:wind.checked}));
    P.append(pageHead('style','Style','How every charm on your line looks and moves. Changes show up on your screen right away.',[h('button',{type:'button',class:'btn',onclick:()=>cmd('nudge',{})},ic('wind'),'Nudge everything')]),
      h('div',{id:'stStrip'}),
      h('div',{class:'stgrid'},
        h('section',{class:'card stcard full','aria-labelledby':'stRopeH'},h('h3',{class:'sub-h',id:'stRopeH',text:'Rope'}),h('div',{class:'ropes',id:'stRopes',role:'radiogroup','aria-labelledby':'stRopeH'})),
        h('section',{class:'card stcard full','aria-labelledby':'stCapH'},h('h3',{class:'sub-h',id:'stCapH',text:'Bead cap'}),h('div',{class:'capd',id:'stCapD',role:'radiogroup','aria-label':'Bead cap design'}),
          h('div',{class:'fins',id:'stFins',role:'radiogroup','aria-label':'Bead cap finish'}),h('p',{class:'note capnote',id:'stCapNote'})),
        h('section',{class:'card stcard','aria-labelledby':'stSizeH'},h('h3',{class:'sub-h',id:'stSizeH',text:'Size'}),
          h('div',{class:'size-row'},h('span',{class:'lo'},imgEl(charmSrc('nazar'))),size,h('span',{class:'hi'},imgEl(charmSrc('nazar'))),h('output',{id:'stSizeOut',for:'stSize'})),
          h('p',{class:'note',style:{marginTop:'10px'},text:'Applies to every charm on your line.'})),
        h('section',{class:'card stcard','aria-labelledby':'stMoveH'},h('h3',{class:'sub-h',id:'stMoveH',text:'Motion and sound'}),
          h('label',{class:'tg',for:'stSound'},h('span',{class:'tg-t'},h('b',{text:'Sound'}),h('span',{text:'Soft chimes when charms touch, and temple bells ring.'})),snd),
          h('label',{class:'tg',for:'stWind'},h('span',{class:'tg-t'},h('b',{text:'Mouse breeze'}),h('span',{text:'Charms sway a little when your pointer passes by.'})),wind))));
    ['stRopes','stCapD','stFins'].forEach(id=>$(id).addEventListener('keydown',radioKeys));
  }
  if(!sizeDrag)$('stStrip').replaceChildren(styleStrip());
  keepFocus(()=>{
    $('stRopes').replaceChildren(...ROPES.map(([id,n])=>{const b=h('button',{type:'button',class:'ropt',role:'radio','aria-checked':String(S.rope===id),'data-k':'rope-'+id,onclick:()=>styleCmd({rope:id})},art(ROPE_ART[id]),h('b',null,n,ic('check')));return b}));
    $('stCapD').replaceChildren(...cat.capDesigns.map(([id,n])=>h('button',{type:'button',role:'radio','aria-checked':String(S.capDesign===id),'data-k':'capd-'+id,title:n,text:n,onclick:()=>styleCmd({capDesign:id})})));
    $('stFins').replaceChildren(...cat.capStyles.map(([id,n])=>h('button',{type:'button',class:'fin',role:'radio','aria-checked':String(S.cap===id),'data-k':'fin-'+id,onclick:()=>styleCmd({cap:id})},h('i',{style:{background:FIN_COL[id]||'linear-gradient(135deg,#e0ae55,#8e6420)'}}),n)));
  });
  const sig=S.capDesign==='signature';
  $('stFins').hidden=sig;
  $('stCapNote').textContent=sig?'Each charm wears a cap made for it. Pick a design to put the same cap on every charm.':'You can still give one charm its own cap from My line.';
  const size=$('stSize');if(!sizeDrag&&document.activeElement!==size)size.value=String(S.size||1);if(!sizeDrag){setRangeFill(size);$('stSizeOut').textContent=Math.round(+size.value*100)+'%'}
  $('stSound').checked=!!S.sound;$('stWind').checked=!!S.wind;
}
function styleStrip(){
  const list=LS.charms.length?LS.charms.slice(0,9):DEMO_LINE.map(([t,l],i)=>({cid:'demo'+i,type:t,len:l,lenMax:420,opts:{}}));
  return strip(list,{rope:LS.S.rope,size:LS.S.size,empty:''});
}
function radioKeys(e){
  if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(e.key))return;
  const g=e.currentTarget,items=[...g.querySelectorAll('[role=radio]:not(:disabled)')],i=items.indexOf(document.activeElement);if(i<0)return;
  e.preventDefault();const j=(i+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[j].focus();items[j].click();
}

// =====================================================================
// Pull actions
// =====================================================================
const ART_EXPLAIN=`<svg viewBox="0 0 230 190" role="img" aria-label="A charm pulled down on its thread past the line, with a ring filling around it">
<path d="M8 16h214" stroke="#b8862f" stroke-width="4" stroke-linecap="round"/>
<rect x="107" y="11" width="16" height="9" rx="4" fill="#c79a3a"/>
<g stroke="#b8862f" stroke-opacity=".35" stroke-width="1.4" stroke-dasharray="3 4" fill="none"><path d="M115 20v40"/><circle cx="115" cy="74" r="14"/></g>
<path d="M115 20v96" stroke="#e0b96c" stroke-width="1.6"/>
<path d="M30 104h170" stroke="currentColor" stroke-opacity=".28" stroke-width="1.2" stroke-dasharray="5 5"/>
<circle cx="115" cy="136" r="27" fill="none" stroke="currentColor" stroke-opacity=".12" stroke-width="4"/>
<path d="M115 109 A27 27 0 1 1 90.6 147.6" fill="none" stroke="#e1b45c" stroke-width="4" stroke-linecap="round"/>
<circle cx="115" cy="136" r="17" fill="#1f4bd1"/><circle cx="115" cy="136" r="10.5" fill="#fff"/><circle cx="115" cy="136" r="6.2" fill="#7fb4ef"/><circle cx="115" cy="136" r="3" fill="#111"/>
<path d="M172 60v58m-8-8 8 8 8-8" fill="none" stroke="#c63a22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="150" y="124" width="72" height="24" rx="12" fill="currentColor" fill-opacity=".08"/><circle cx="162" cy="136" r="3.5" fill="#e1b45c"/><text x="171" y="140.5" font-size="11.5" font-weight="600" fill="currentColor" font-family="Baloo Thambi 2, sans-serif">Open it</text>
</svg>`;
function renderPulls(){
  const P=$('p-pulls');
  if(!P.dataset.built){
    P.dataset.built='1';
    P.append(pageHead('pulls','Pull actions','Pull a charm down and let go to open a website, an app, a file or a folder, copy some text, or hide the charms.'),
      h('div',{class:'card explain'},art(ART_EXPLAIN),
        h('ol',{class:'steps'},
          h('li',null,h('div',null,h('b',{text:'Pick a charm'}),h('span',{text:'In My line, choose any charm on your screen.'}))),
          h('li',null,h('div',null,h('b',{text:'Choose what it does'}),h('span',{text:'Under \u201cWhen you pull it\u201d, pick a website, an app, a file, a folder, some text to copy, or hiding the charms.'}))),
          h('li',null,h('div',null,h('b',{text:'Pull it down and let go'}),h('span',{text:'Drag the charm straight down until the ring fills, then let go. Hold it a second longer for a long pull.'}))))),
      h('div',{id:'pullList'}));
  }
  const L=$('pullList');
  const rows=LS.charms.filter(c=>ACT[c.cid]&&(ACT[c.cid].pull||ACT[c.cid].long));
  keepFocus(()=>{
    if(!rows.length){
      L.replaceChildren(h('div',{class:'card empty'},art(ART_PULL),h('h2',{text:'No pulls set up yet'}),h('p',{text:LS.charms.length?'Give a charm something to do when you pull it: open your music app, your mail, a folder you use every day.':'Hang a charm first, then give it something to do when you pull it.'}),
        LS.charms.length?h('button',{type:'button',class:'btn primary',onclick:()=>go('line',{cid:LS.charms[0].cid,focus:'acts'})},ic('pull'),'Set up a pull'):h('button',{type:'button',class:'btn primary',onclick:()=>go('catalogue',{fromNav:true})},ic('cat'),'Browse the catalogue')));
      return;
    }
    const cell=(ch,slot)=>{
      const info=ACT[ch.cid][slot];
      return h('div',{class:'pt-a'},h('span',{class:'pt-k',text:slot==='pull'?'Pull':'Long'}),
        info?[h('span',{class:'lbl',title:actText(info)},kindIcon(info),h('span',{text:actText(info)})),
          h('button',{type:'button',class:'btn ghost icon sm','data-k':'try-'+slot+ch.cid,'aria-label':'Try the '+(slot==='pull'?'pull':'long pull')+' action of '+nameOf(ch),title:'Try it',onclick:()=>tryAct(ch,slot)},ic('play','s'))]
          :h('span',{class:'none',text:'\u2014'}));
    };
    L.replaceChildren(h('div',{class:'sect-h'},h('h2',{text:'Charms with actions'}),h('span',{class:'n',text:String(rows.length)})),
      h('div',{class:'card ptable',role:'list'},
        h('div',{class:'pt-h','aria-hidden':'true'},h('span',{text:'Charm'}),h('span',{text:'When pulled'}),h('span',{text:'Long pull'}),h('span')),
        rows.map(ch=>h('div',{class:'pt-r',role:'listitem'},
          h('div',{class:'pt-c'},thumbEl(ch),h('b',{text:nameOf(ch)})),cell(ch,'pull'),cell(ch,'long'),
          h('div',{class:'pt-e'},h('button',{type:'button',class:'btn sm','data-k':'edit-'+ch.cid,'aria-label':'Edit '+nameOf(ch),onclick:()=>go('line',{cid:ch.cid,focus:'acts'})},ic('edit'),'Edit'))))));
  });
}
async function tryAct(ch,slot){
  let r;try{r=await api.actions.test(ch.cid,slot)}catch(e){r={ok:false,error:'Something went wrong. Try again.'}}
  if(r&&r.ok){const info=ACT[ch.cid]&&ACT[ch.cid][slot];toast(info?actText(info,true):'Done.',{img:srcOf(ch)})}
  else if(r&&(r.canceled||r.declined))return;
  else toast(r&&r.error||'That didn\u2019t work.',{bad:true});
}

// =====================================================================
// Settings
// =====================================================================
let rec=null;
const FKEY=/^F([1-9]|1[0-9]|2[0-4])$/;
const CODEKEY={Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/',Backquote:'`',Space:'Space',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',Home:'Home',End:'End',PageUp:'PageUp',PageDown:'PageDown',Insert:'Insert',Delete:'Delete',Backspace:'Backspace',Enter:'Enter',Tab:'Tab'};
function keyOf(e){const c=e.code||'';if(/^Key[A-Z]$/.test(c))return c.slice(3);if(/^Digit[0-9]$/.test(c))return c.slice(5);if(/^Numpad[0-9]$/.test(c))return 'num'+c.slice(6);if(FKEY.test(c))return c;return CODEKEY[c]||null}
function modsOf(e){const m=[];if(MAC){if(e.metaKey)m.push('CommandOrControl');if(e.ctrlKey)m.push('Control')}else{if(e.ctrlKey)m.push('CommandOrControl');if(e.metaKey)m.push('Super')}if(e.altKey)m.push('Alt');if(e.shiftKey)m.push('Shift');return m}
const SC=[['toggle','Show or hide charms','Works from anywhere, even when this window is closed.'],['panel','Open Charm Line','Brings this window back.']];
const ART_TOP=`<svg viewBox="0 0 150 84" aria-hidden="true"><rect width="150" height="84" rx="8" fill="#cfe0f0"/><rect x="18" y="16" width="100" height="58" rx="5" fill="#fbf6ec" stroke="#d5c6ab"/><rect x="18" y="16" width="100" height="10" rx="5" fill="#ebe2d0"/><path d="M4 5h142" stroke="#b8862f" stroke-width="2.4" stroke-linecap="round"/><path d="M52 5v22M98 5v30" stroke="#b8862f" stroke-width="1.2"/><circle cx="52" cy="33" r="7" fill="#1f4bd1"/><circle cx="52" cy="33" r="3.6" fill="#fff"/><circle cx="52" cy="33" r="1.8" fill="#111"/><rect x="92" y="35" width="12" height="16" rx="5" fill="#c63a22"/></svg>`;
const ART_DESK=`<svg viewBox="0 0 150 84" aria-hidden="true"><rect width="150" height="84" rx="8" fill="#cfe0f0"/><path d="M4 5h142" stroke="#b8862f" stroke-width="2.4" stroke-linecap="round"/><path d="M52 5v22M98 5v30" stroke="#b8862f" stroke-width="1.2"/><circle cx="52" cy="33" r="7" fill="#1f4bd1"/><circle cx="52" cy="33" r="3.6" fill="#fff"/><circle cx="52" cy="33" r="1.8" fill="#111"/><rect x="92" y="35" width="12" height="16" rx="5" fill="#c63a22"/><rect x="40" y="22" width="100" height="56" rx="5" fill="#fbf6ec" stroke="#d5c6ab"/><rect x="40" y="22" width="100" height="10" rx="5" fill="#ebe2d0"/></svg>`;
function renderSettings(){
  const P=$('p-settings');P.classList.add('narrow');
  if(!P.dataset.built){
    P.dataset.built='1';
    const scRows=SC.map(([w,l,d])=>{
      const keys=h('button',{type:'button',class:'keys',id:'rec-'+w,'aria-pressed':'false','aria-describedby':'scl-'+w,onclick:()=>{if(rec===w)stopRec();else startRec(w)}});
      const clr=h('button',{type:'button',class:'btn ghost sm',id:'clr-'+w,'aria-label':'Clear the \u201c'+l+'\u201d shortcut',onclick:()=>{stopRec();patchSettings({shortcuts:Object.assign({},SET&&SET.shortcuts,{[w]:''})})}},'Clear');
      return h('div',{class:'srow'},h('div',{class:'srow-t'},h('b',{id:'scl-'+w,text:l}),h('span',{text:d})),h('div',{class:'rec'},keys,clr),h('p',{class:'note err',id:'scErr-'+w,role:'alert'}));
    });
    const vis=h('div',{class:'vis',role:'radiogroup','aria-label':'Where charms appear',id:'setVis'},
      h('button',{type:'button',class:'vopt',role:'radio','data-v':'top',onclick:()=>setVis('top')},art(ART_TOP),h('div',null,h('b',{text:'Over everything'}),h('span',{text:'Charms stay on top of every window.'}))),
      h('button',{type:'button',class:'vopt',role:'radio','data-v':'desktop',onclick:()=>setVis('desktop')},art(ART_DESK),h('div',null,h('b',{text:'Desktop only'}),h('span',{text:'Charms sit behind your windows.'}))));
    vis.addEventListener('keydown',radioKeys);
    const sw=(id,t,d,key)=>{const i=h('input',{type:'checkbox',class:'switch',role:'switch',id});i.addEventListener('change',()=>patchSettings({[key]:i.checked}));return h('label',{class:'srow',for:id,id:id+'Row'},h('div',{class:'srow-t'},h('b',{text:t}),d?h('span',{text:d}):null),i)};
    P.append(pageHead('settings','Settings','Shortcuts, where your charms appear, and how Charm Line starts.'),
      h('section',{class:'card scard','aria-labelledby':'sKeysH'},h('div',{class:'scard-h'},ic('key'),h('h2',{id:'sKeysH',text:'Shortcuts'})),scRows,
        h('div',{class:'srow'},h('p',{class:'note',style:{margin:'0'},text:'Click a shortcut, then press the new keys: two of Ctrl, Alt and Shift plus a key, or one of them with an F-key. Esc stops.'}))),
      h('section',{class:'card scard','aria-labelledby':'sVisH'},h('div',{class:'scard-h'},ic('eye'),h('h2',{id:'sVisH',text:'Where charms appear'})),vis,h('p',{class:'note vis-note',id:'visNote'})),
      h('section',{class:'card scard',id:'sWork','aria-labelledby':'sWorkH'},h('div',{class:'scard-h'},ic('toggle'),h('h2',{id:'sWorkH',text:'While you work'})),
        sw('setAutoHide','Hide when an app is fullscreen','Charms step aside for games, films and presentations.','autoHideFullscreen'),
        sw('setHideCap','Hide from screen sharing and recordings','Others on a call won\u2019t see your charms.','hideFromCapture')),
      h('section',{class:'card scard',id:'sStart','aria-labelledby':'sStartH'},h('div',{class:'scard-h'},ic('play'),h('h2',{id:'sStartH',text:'Startup'})),
        sw('setLogin','Start Charm Line when I sign in','Your charms are waiting each time you turn on your computer.','openAtLogin'),h('p',{class:'note',id:'loginNote',style:{padding:'0 20px 16px'}})),
      h('p',{class:'note err',id:'setErr',role:'alert'}));
  }
  if(!SET)return;
  const sc=SET.shortcuts||{},er=SET.shortcutErrors||{},caps=SET.caps||{};
  for(const [w] of SC){
    const b=$('rec-'+w);
    if(rec!==w){b.replaceChildren(...kbds(sc[w],'Not set'));b.setAttribute('aria-label',SC.find(x=>x[0]===w)[1]+': '+(prettyAcc(sc[w])||'not set')+'. Click to change.');$('scErr-'+w).textContent=er[w]||''}
    $('clr-'+w).hidden=!sc[w];
  }
  document.querySelectorAll('#setVis .vopt').forEach(b=>{b.setAttribute('aria-checked',String(SET.visibility===b.dataset.v));b.disabled=b.dataset.v==='desktop'&&!caps.desktopOnly;b.tabIndex=SET.visibility===b.dataset.v?0:-1});
  $('visNote').textContent=caps.desktopOnly?(SET.visibility==='desktop'?'Charms sit behind your windows and come forward when you show the desktop.':''):'Desktop only isn\u2019t available on this computer.';
  $('setAutoHideRow').hidden=!caps.autoHide;$('setAutoHide').checked=!!SET.autoHideFullscreen;
  $('setHideCapRow').hidden=!caps.capture;$('setHideCap').checked=!!SET.hideFromCapture;
  $('sWork').hidden=!caps.autoHide&&!caps.capture;
  $('sStart').hidden=!caps.login&&!caps.loginNote;
  $('setLogin').disabled=!caps.login;$('setLoginRow').classList.toggle('off',!caps.login);$('setLogin').checked=!!SET.openAtLogin;
  $('loginNote').textContent=caps.loginNote||'';
}
function setVis(v){if(!SET||SET.visibility===v)return;const caps=SET.caps||{};if(v==='desktop'&&!caps.desktopOnly)return;patchSettings({visibility:v})}
function startRec(w){stopRec();rec=w;const b=$('rec-'+w);b.setAttribute('aria-pressed','true');b.replaceChildren(h('span',{class:'pulse'}),'Press keys\u2026');$('scErr-'+w).textContent=''}
function stopRec(){if(!rec)return;const b=$('rec-'+rec);rec=null;if(b)b.setAttribute('aria-pressed','false');renderSettings()}
function onRecKey(e){
  e.preventDefault();e.stopPropagation();
  const w=rec;
  if(e.key==='Escape'&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey){stopRec();return}
  if(e.key==='Tab'&&!e.ctrlKey&&!e.altKey&&!e.metaKey){stopRec();return}
  const mods=modsOf(e),key=/^(Control|Shift|Alt|Meta|OS|AltGraph)$/.test(e.key)?null:keyOf(e);
  const b=$('rec-'+w);
  if(!key){b.replaceChildren(h('span',{class:'pulse'}),mods.length?prettyAcc(mods.join('+'))+(MAC?'':'+')+'\u2026':'Press keys\u2026');return}
  if(!(mods.length>=2||(mods.length>=1&&FKEY.test(key)))){$('scErr-'+w).textContent='Use two of Ctrl, Alt and Shift plus a key, or one of them with an F-key.';b.replaceChildren(h('span',{class:'pulse'}),'Press keys\u2026');return}
  const acc=[...mods,key].join('+');
  stopRec();patchSettings({shortcuts:Object.assign({},SET&&SET.shortcuts,{[w]:acc})});
}
addEventListener('keydown',e=>{if(rec)onRecKey(e)},true);
addEventListener('blur',()=>stopRec());
document.addEventListener('pointerdown',e=>{if(rec&&!e.target.closest('#rec-'+rec))stopRec()},true);
async function patchSettings(p){
  const er=$('setErr');if(er)er.textContent='';
  try{const s=await api.settings.patch(p);if(s)applySettings(s);return s}catch(e){if(er)er.textContent='That setting could not be saved.';toast('That setting could not be saved.',{bad:true});return null}
}
function applySettings(s){
  if(!s||typeof s!=='object')return;SET=s;
  renderShortcutHints();
  if(!SET.firstRunDone){if(page!=='welcome')go('welcome');else renderWelcome()}
  else if(page==='welcome'||page==null)go('line');
  else if(page==='settings')renderSettings();
  else if(page==='about')renderAbout();
}

// =====================================================================
// About
// =====================================================================
function renderAbout(){
  const P=$('p-about');P.classList.add('narrow');
  const ver=typeof api.version==='string'?api.version.slice(0,20):'';
  P.replaceChildren(pageHead('about','About',''),
    h('div',{class:'card ahero'},h('div',{class:'ahero-mark'},art('<svg aria-hidden="true"><use href="#mark"/></svg>')),
      h('div',null,h('h2',{text:'Charm Line'}),h('p',{text:(ver?'Version '+ver+' \u00b7 ':'')+'Luck, on a line.'}),
        h('button',{type:'button',class:'btn primary',onclick:()=>{try{api.openWebsite()}catch(e){}}},ic('ext'),'Visit luckonaline.netlify.app'))),
    h('div',{class:'agrid'},
      h('section',{class:'card acard','aria-labelledby':'abK'},h('h3',{class:'sub-h',id:'abK',text:'Shortcuts'}),
        h('ul',{class:'cheat'},
          h('li',null,h('span',{text:'Show or hide charms'}),h('span',{class:'k'},kbds(shortcut('toggle'),'Not set'))),
          h('li',null,h('span',{text:'Open Charm Line'}),h('span',{class:'k'},kbds(shortcut('panel'),'Not set'))),
          h('li',null,h('span',{text:'Jump to a section'}),h('span',{class:'k'},kbds((MAC?'Command':'Ctrl')+'+1'),h('span',{class:'none',text:'\u2013'}),h('kbd',{text:'7'}))),
          h('li',null,h('span',{text:'Open a charm here'}),h('span',{class:'k'},h('span',{class:'none',text:'Double-click it'}))),
          h('li',null,h('span',{text:'Swing a charm'}),h('span',{class:'k'},h('span',{class:'none',text:'Drag it'}))))),
      h('section',{class:'card acard prose','aria-labelledby':'abP'},h('h3',{class:'sub-h',id:'abP',text:'How pulling works'}),
        h('p',{text:'Give a charm an action in My line. Then drag it straight down until a ring fills around it and a little label appears. Let go, and the action runs.'}),
        h('p',{text:'Hold it down for a second longer and the ring fills again for the long pull. Swinging, nudging and the breeze never set anything off.'}),
        h('p',{text:'The first time a charm opens something, Charm Line asks you to confirm.'}))),
    h('p',{class:'madeby'},ic('heart'),h('span',null,'Made by ',h('b',{text:'Manoj'}))),h('p',{class:'note',style:{textAlign:'center',marginTop:'6px'},text:'Page titles are set in Fraunces, under the SIL Open Font License.'}));
}

// =====================================================================
// Welcome (first run)
// =====================================================================
let wChoice=null;
const WELCOME_LINE=[['lantern',120],['nazar',260],['luckycat',170],['bell',300],['lotus',150]];
function renderWelcome(){
  const P=$('p-welcome');if(!SET)return;
  const caps=SET.caps||{},t=shortcut('toggle'),p=shortcut('panel');
  const seg=caps.login?h('div',{class:'seg',role:'radiogroup','aria-label':'Start Charm Line when you sign in'},
    h('button',{type:'button',role:'radio','aria-checked':String(wChoice==='yes'),'data-k':'wy',onclick:()=>{wChoice='yes';patchSettings({openAtLogin:true}).then(renderWelcome)}},'Yes'),
    h('button',{type:'button',role:'radio','aria-checked':String(wChoice==='no'),'data-k':'wn',onclick:()=>{wChoice='no';if(SET.openAtLogin)patchSettings({openAtLogin:false}).then(renderWelcome);else renderWelcome()}},'Not now')):null;
  if(seg)seg.addEventListener('keydown',radioKeys);
  const wl=WELCOME_LINE.map(([t2,l],i)=>({cid:'w'+i,type:t2,len:l,lenMax:420,opts:{}}));
  keepFocus(()=>P.replaceChildren(h('div',{class:'welcome'},
    h('div',{class:'w-copy'},
      h('div',{class:'eyebrow',text:'Welcome to Charm Line'}),
      h('h1',{id:'h-welcome',tabindex:'-1'},'Luck, ',h('em',{text:'on a line.'})),
      h('p',{text:'Little 3D charms hang from the top of your screen. Drag one to swing it. Give one a job, and pulling it down opens an app, a website or a folder.'}),
      h('div',{class:'w-keys'},
        t?h('div',null,h('span',{class:'k'},kbds(t)),h('span',{text:'shows or hides the charms'})):null,
        p?h('div',null,h('span',{class:'k'},kbds(p)),h('span',{text:'opens this window'})):null,
        h('div',null,h('span',{class:'k'},h('span',{class:'none',text:'Tray icon'})),h('span',{text:'always works too'}))),
      caps.login||caps.loginNote?h('div',{class:'card w-login'},h('b',{text:'Start Charm Line when you sign in?'}),h('p',{text:caps.login?(caps.loginNote||'Your charms will be waiting each time you turn on your computer.'):caps.loginNote}),seg):null,
      h('div',{class:'w-go'},h('button',{type:'button',class:'btn primary lg','data-k':'wgo',onclick:finishWelcome},'Go to my line',ic('chev')),h('span',{class:'note',text:'You can change all of this later in Settings.'}))),
    h('div',{class:'w-art'},strip(wl,{rope:'thread',size:1.35,base:80,height:innerHeight<=680?340:420})))));
}
async function finishWelcome(){
  const s=await patchSettings({firstRunDone:true});
  if(s&&s.firstRunDone)go('line',{fromNav:true});
}

// ---------- keyboard: Ctrl/Cmd + 1..7 ----------
addEventListener('keydown',e=>{
  if(rec||e.altKey||e.shiftKey)return;const mod=MAC?e.metaKey:e.ctrlKey;if(!mod)return;
  if(/^[1-7]$/.test(e.key)&&SET&&SET.firstRunDone){e.preventDefault();go(PAGES[+e.key-1],{fromNav:true});return}
  if(e.key.toLowerCase()==='f'&&page==='catalogue'){e.preventDefault();const q=$('catQ');if(q){q.focus();q.select()}}
});
addEventListener('resize',()=>{clearTimeout(window.__rz);window.__rz=setTimeout(()=>{if(page==='line'&&LS.charms.length)$('lStrip').replaceChildren(strip(LS.charms,{rope:LS.S.rope,size:1,sel:selCid,onPick:c=>selectCharm(c,true)}))},150)});

// ---------- boot ----------
async function boot(){
  if(api.onLine)api.onLine(setLS);
  if(api.onSettings)api.onSettings(applySettings);
  if(api.onActionsChanged)api.onActionsChanged(()=>refreshActs());
  if(api.onShown)api.onShown(setShown);
  if(api.onNavigate)api.onNavigate(m=>{
    if(!m||typeof m!=='object')return;
    const p=PAGES.includes(m.page)?m.page:'line',cid=okCid(m.cid)?m.cid:null;
    if(cid&&!LS.charms.some(c=>c.cid===cid)){selCid=cid;refreshLine().then(()=>go(p,{cid}));return}
    go(p,{cid});
  });
  const [st,acts,set,shown]=await Promise.all([
    api.line.getState().catch(()=>null),api.actions.list().catch(()=>({})),api.settings.get().catch(()=>null),api.charms.shown().catch(()=>true)]);
  if(st){LS=normalize(st);lineReady=true;updateBadge()}
  ACT=acts&&typeof acts==='object'?acts:{};
  setShown(shown!==false);
  if(set)applySettings(set);
  if(!page)go('line');
  const done=()=>document.body.classList.remove('booting');
  (document.fonts?Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,600))]):Promise.resolve()).then(done,done);
}
boot().catch(e=>{console.error('Studio failed to start',e&&e.stack||e);document.body.classList.remove('booting')});
})();
