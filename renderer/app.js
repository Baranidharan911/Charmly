(()=>{
const $=id=>document.getElementById(id);
const cv=$('c'),ctx=cv.getContext('2d'),glc=$('g');
const hasFilter='filter' in ctx;
const KEY='charmline:v3';
// The overlay only draws charms. Every control lives in the Studio window, which drives this page
// through line commands (CL.onLineCmd) and gets the line back as LineState pushes (CL.lineState).
// ?demo=1 is the website's embedded preview: no saving, no app, charms picked by the page (postMessage).
const Q=new URLSearchParams(location.search),DEMO=Q.has('demo');
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
let W=0,H=0,DPR=1,topY=30;
const S={rope:'thread',size:1,sound:true,wind:!reduce,cap:'gold',capDesign:'signature',v:5};
let charms=[],imports={},drag=null,audio=null,awake=120,uid=1;
const mouse={x:-1,y:-1};
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas:glc,alpha:true,antialias:true,premultipliedAlpha:true})}catch(e){$('err').hidden=false;return}
renderer.setClearColor(0x000000,0);renderer.outputEncoding=THREE.sRGBEncoding;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
const LIB=createCharmLib(renderer);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.environment=LIB.env;const LT=LIB.lights(scene);
const KEY_DIR=new THREE.Vector3(-.8,1.2,1.4).normalize();LT.key.castShadow=true;LT.key.shadow.mapSize.set(2048,2048);LT.key.shadow.bias=-.0004;LT.key.shadow.normalBias=1.2;LT.key.shadow.radius=4;
function shadowable(g){g.traverse(o=>{if(o.isMesh){const m=[].concat(o.material)[0];o.castShadow=!m.transparent;o.receiveShadow=true}})}
const camera=new THREE.OrthographicCamera(0,1,0,-1,1,4000);camera.position.z=2000;
const R=()=>(W<600?40:54)*S.size;
const FLAT=new Set(['kitpendant','om','hamsa','fortune','clover','horseshoe','nazar','moonstar','omamori']);

function buildFor(type,opts){let b;if(type==='img'){const im=imports[opts.key];const cd=opts.capDesign||S.capDesign,cs=opts.capStyle||S.cap;b=LIB.imageCharm(im.tex,im.img.naturalWidth,im.img.naturalHeight,opts.cap!==false,cs,cd)}else b=LIB.build(type,Object.assign({},opts,{capStyle:opts.capStyle||S.cap,capDesign:opts.capDesign||S.capDesign}));shadowable(b.g);return b}
function makeCharm(type,axf,len,opts){
  opts=opts||{};if(!validCid(opts.cid))opts.cid=newCid();const b=buildFor(type,opts);
  const outer=new THREE.Group();outer.add(b.g);scene.add(outer);
  const c={id:uid++,type,axf,len,opts,pts:[],clap:0,pth:0,vs:0,vmax:0,tink:0,yaw:(Math.random()-.5)*.5,yawV:0,obj:outer,inner:b.g,cyU:b.cy,rcU:b.rc,clapper:b.clapper};
  c.ax=axf*W;const n=14,seg=len/(n-1);
  for(let i=0;i<n;i++){const x=c.ax+i*1.2,y=topY+i*seg;c.pts.push({x,y,px:x,py:y})}
  return c;
}
const nameOf=c=>c.type==='img'?(imports[c.opts.key]&&imports[c.opts.key].name)||'Your image':LIB.TYPES[c.type].name;
function gapAxf(){const xs=[0,...charms.map(c=>c.axf).sort((a,b)=>a-b),1];let best=.5,g=0;for(let i=0;i<xs.length-1;i++){const d=xs[i+1]-xs[i];if(d>g){g=d;best=(xs[i]+xs[i+1])/2}}return Math.min(.95,Math.max(.05,best))}
function addCharm(type,opts){const c=makeCharm(type,gapAxf(),150+Math.random()*120,opts);c.pts.at(-1).px-=2;charms.push(c);wake();save();return c}
function removeCharm(c){scene.remove(c.obj);LIB.dispose(c.obj);charms=charms.filter(x=>x!==c);if(drag&&drag.c===c){pullCancel('removed');drag=null;cv.style.cursor='default'}if(pillC===c)hidePill();if(NEW&&c.opts&&validCid(c.opts.cid))CL.actions.forget(c.opts.cid).then(refreshActs,()=>{})}

function dirOf(c){const p=c.pts,e=p[p.length-1],b=p[p.length-3];let dx=e.x-b.x,dy=e.y-b.y;const d=Math.hypot(dx,dy)||1;return{dx:dx/d,dy:dy/d}}
function center(c,r){const e=c.pts.at(-1),{dx,dy}=dirOf(c);return{x:e.x+dx*c.cyU*r,y:e.y+dy*c.cyU*r,rc:c.rcU*r}}

const G=1900,DAMP=.996,ITER=12,DT=1/120;
function step(){
  const r=R();
  for(const c of charms){
    const p=c.pts;p[0].x=p[0].px=c.ax;p[0].y=p[0].py=topY;
    const held=drag&&drag.mode==='charm'&&drag.c===c;
    for(let i=1;i<p.length;i++){if(held&&i===p.length-1)continue;const q=p[i],vx=(q.x-q.px)*DAMP,vy=(q.y-q.py)*DAMP;q.px=q.x;q.py=q.y;q.x+=vx;q.y+=vy+G*DT*DT}
    if(held){const e=p.at(-1);let tx=drag.x-drag.ox,ty=drag.y-drag.oy;const dx=tx-c.ax,dy=ty-topY,d=Math.hypot(dx,dy),mx=c.len*1.06;if(drag.stretch){if(d>c.len){const ext=c.len*.32,nd=c.len+ext*(1-Math.exp(-(d-c.len)/ext));tx=c.ax+dx/d*nd;ty=topY+dy/d*nd}}else if(d>mx){tx=c.ax+dx/d*mx;ty=topY+dy/d*mx}e.px=e.x;e.py=e.y;e.x=tx;e.y=Math.max(topY+4,ty)}
    const e=p.at(-1);c.yawV+=(e.x-e.px)*.0035-c.yaw*.004;c.yawV*=.985;c.yaw+=c.yawV;
    const ym=c.type==='img'?.35:FLAT.has(c.type)?.7:1.3;if(c.yaw>ym){c.yaw=ym;c.yawV*=-.5}if(c.yaw<-ym){c.yaw=-ym;c.yawV*=-.5}
  }
  for(let k=0;k<ITER;k++){
    for(const c of charms){
      const p=c.pts,n=p.length,seg=c.len/(n-1),held=drag&&drag.mode==='charm'&&drag.c===c;
      for(let i=0;i<n-1;i++){const a=p[i],b=p[i+1],wa=i===0?0:1,wb=i+1===n-1?(held?0:.3):1,ws=wa+wb;if(!ws)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1e-6,df=(d-seg)/d;a.x+=dx*df*wa/ws;a.y+=dy*df*wa/ws;b.x-=dx*df*wb/ws;b.y-=dy*df*wb/ws}
      for(let i=1;i<n;i++){const q=p[i];if(q.y<topY+1)q.y=topY+1;if(q.x<0)q.x=0;if(q.x>W)q.x=W;if(q.y>H-4)q.y=H-4}
    }
    collide(r,k===ITER-1);
  }
}
function collide(r,sound){
  const now=performance.now();
  for(let i=0;i<charms.length;i++)for(let j=i+1;j<charms.length;j++){
    const A=charms[i],B=charms[j],ca=center(A,r),cb=center(B,r),dx=cb.x-ca.x,dy=cb.y-ca.y,d=Math.hypot(dx,dy)||.01,min=ca.rc+cb.rc;
    if(d>=min)continue;
    const ea=A.pts.at(-1),eb=B.pts.at(-1);
    if(sound){const rv=Math.hypot((ea.x-ea.px)-(eb.x-eb.px),(ea.y-ea.py)-(eb.y-eb.py));if(rv>1.1&&now-A.tink>160&&now-B.tink>160){A.tink=B.tink=now;tink(Math.min(1,rv/5));A.yawV+=(Math.random()-.5)*.05;B.yawV+=(Math.random()-.5)*.05}}
    const wa=drag&&drag.c===A&&drag.mode==='charm'?0:1,wb=drag&&drag.c===B&&drag.mode==='charm'?0:1,ws=wa+wb;if(!ws)continue;
    const o=(min-d)/d;ea.x-=dx*o*wa/ws;ea.y-=dy*o*wa/ws;eb.x+=dx*o*wb/ws;eb.y+=dy*o*wb/ws;
  }
}

function ensureAudio(){if(!audio){try{audio=new(window.AudioContext||window.webkitAudioContext)()}catch(e){audio=null}}if(audio&&audio.state==='suspended')audio.resume()}
function tone(base,parts,vol,len){
  if(!S.sound||!audio||audio.state!=='running')return;
  const t=audio.currentTime,out=audio.createGain();out.gain.value=vol;out.connect(audio.destination);
  parts.forEach(([m,a])=>{const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=base*m;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(a,t+.004);g.gain.exponentialRampToValueAtTime(.0001,t+len/Math.sqrt(m));o.connect(g);g.connect(out);o.start(t);o.stop(t+len+.1)});
}
const ringBell=v=>tone(880,[[1,1],[2.76,.45],[5.4,.22],[8.93,.1]],.18*v,2.4);
const tink=v=>tone(2300,[[1,1],[2.3,.4]],.07*v,.35);

function ropePath(p){ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);for(let i=1;i<p.length-1;i++)ctx.quadraticCurveTo(p[i].x,p[i].y,(p[i].x+p[i+1].x)/2,(p[i].y+p[i+1].y)/2);const l=p.at(-1);ctx.lineTo(l.x,l.y)}
function drawRope(c){
  const p=c.pts;ctx.lineCap='round';ctx.lineJoin='round';
  if(pullHot(c)){ropePath(p);ctx.shadowColor='rgba(255,214,120,.9)';ctx.shadowBlur=8*DPR;ctx.strokeStyle='#fff1c2';ctx.lineWidth=1.3;ctx.stroke();ctx.shadowBlur=0;return}
  if(S.rope==='thread'){ropePath(p);ctx.strokeStyle='#8e6a22';ctx.lineWidth=2.2;ctx.stroke();ctx.strokeStyle='rgba(255,228,150,.85)';ctx.lineWidth=.8;ctx.stroke()}
  else if(S.rope==='neon'){ropePath(p);ctx.shadowColor='#4ff0ff';ctx.shadowBlur=14*DPR;ctx.strokeStyle='#62f2ff';ctx.lineWidth=2.6;ctx.stroke();ctx.shadowBlur=4*DPR;ctx.strokeStyle='#eaffff';ctx.lineWidth=1.1;ctx.stroke();ctx.shadowBlur=0}
  else{
    let carry=0,k=0;
    for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1],dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy);if(L<.01)continue;const ang=Math.atan2(dy,dx);let t=carry;
      while(t<L){ctx.save();ctx.translate(a.x+dx*t/L,a.y+dy*t/L);ctx.rotate(ang);ctx.beginPath();
        if(k%2===0){ctx.ellipse(0,0,4.2,2.4,0,0,7);ctx.strokeStyle='#5f6a76';ctx.lineWidth=2.4;ctx.stroke();ctx.strokeStyle='#e3e9ef';ctx.lineWidth=1.1;ctx.stroke()}
        else{ctx.moveTo(-3.6,0);ctx.lineTo(3.6,0);ctx.strokeStyle='#5f6a76';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='#c7ced6';ctx.lineWidth=1.3;ctx.stroke()}
        ctx.restore();t+=6;k++}
      carry=t-L}
  }
}
function drawHook(c){ctx.fillStyle='#c79a3a';ctx.strokeStyle='#6b4712';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect?ctx.roundRect(c.ax-6,topY-3,12,6,3):ctx.rect(c.ax-6,topY-3,12,6);ctx.fill();ctx.stroke();
  if(hasAct(c)){ctx.beginPath();ctx.arc(c.ax,topY,1.9,0,7);ctx.fillStyle='#fff4cf';ctx.shadowColor='rgba(255,220,130,.9)';ctx.shadowBlur=4*DPR;ctx.fill();ctx.shadowBlur=0}}
// "Show me" (Studio highlight): a warm halo behind the charm for a moment.
function drawGlow(r){
  const now=performance.now();
  for(const c of charms){
    if(!(c.glow>now))continue;
    const k=Math.min(1,(c.glow-now)/500),ce=center(c,r),rad=ce.rc*2.1;
    const g=ctx.createRadialGradient(ce.x,ce.y,ce.rc*.3,ce.x,ce.y,rad);
    g.addColorStop(0,`rgba(255,222,140,${.55*k})`);g.addColorStop(.55,`rgba(255,196,90,${.25*k})`);g.addColorStop(1,'rgba(255,196,90,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(ce.x,ce.y,rad,0,7);ctx.fill();
    ctx.beginPath();ctx.arc(ce.x,ce.y,ce.rc*1.25+4,0,7);ctx.strokeStyle=`rgba(255,236,180,${.8*k})`;ctx.lineWidth=2;ctx.shadowColor='rgba(255,210,110,.9)';ctx.shadowBlur=8*DPR;ctx.stroke();ctx.shadowBlur=0;
  }
}
function draw(){
  ctx.clearRect(0,0,W,H);const r=R();
  drawGlow(r);
  if(hasFilter)for(const c of charms){const ce=center(c,r);ctx.save();ctx.filter=`blur(${Math.round(r*.28)}px)`;ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.ellipse(ce.x+r*.22,ce.y+r*.34,ce.rc*.85,ce.rc*.95,0,0,7);ctx.fill();ctx.restore()}
  for(const c of charms)drawRope(c);
  for(const c of charms){
    drawHook(c);
  }
  drawPullRing(r);
  const zs=Math.min(r*3,1600/Math.max(1,charms.length));
  charms.forEach((c,i)=>{
    const e=c.pts.at(-1),{dx,dy}=dirOf(c),th=Math.atan2(dx,dy);
    if(c.clapper){const d=th-c.pth;c.clap+=(Math.max(-.6,Math.min(.6,d*16))-c.clap)*.25;c.clapper.rotation.z=c.clap}
    c.pth=th;c.obj.position.set(e.x,-e.y,i*zs);c.obj.rotation.z=th;c.inner.rotation.y=c.yaw;c.obj.scale.setScalar(r);
  });
  renderer.render(scene,camera);
  placePill(r);
}
function bells(){for(const c of charms){if(c.type!=='bell')continue;const e=c.pts.at(-1),vx=e.x-e.px,sp=Math.hypot(vx,e.y-e.py);c.vmax=Math.max(c.vmax,sp);const s=Math.sign(vx);if(s&&c.vs&&s!==c.vs){if(c.vmax>.9)ringBell(Math.min(1,c.vmax/4));c.vmax=0}if(Math.abs(vx)>.05)c.vs=s}}
function wake(){awake=120}
let last=performance.now(),acc=0,glowUntil=0;
function frame(t){
  requestAnimationFrame(frame);
  const el=Math.min((t-last)/1000,.05);last=t;
  if(awake<=0&&!drag)return;
  acc+=el;let n=0;while(acc>=DT&&n<8){step();bells();acc-=DT;n++}
  if(drag&&drag.pull)pullFeed(drag.c,GS.tick(performance.now()));
  draw();
  let m=0;for(const c of charms){m+=Math.abs(c.yawV)*40;for(const q of c.pts)m+=Math.abs(q.x-q.px)+Math.abs(q.y-q.py)}
  if(drag||glowUntil>t||m>.02*Math.max(1,charms.length)*14)awake=120;else awake--;
}

function hitCharm(x,y){const r=R();for(let i=charms.length-1;i>=0;i--){const c=charms[i],ce=center(c,r);if(Math.hypot(x-ce.x,y-ce.y)<Math.max(26,ce.rc*1.2))return c}return null}
function hitHook(x,y){for(const c of charms)if(Math.abs(x-c.ax)<12&&Math.abs(y-topY)<14)return c;return null}
cv.addEventListener('pointerdown',e=>{
  ensureAudio();const x=e.clientX,y=e.clientY,h=hitHook(x,y);
  if(h){drag={mode:'hook',c:h}}
  else{const c=hitCharm(x,y);
    if(c){const en=c.pts.at(-1);drag={mode:'charm',c,x,y,ox:x-en.x,oy:y-en.y};pullStart(e,c,en);charms.splice(charms.indexOf(c),1);charms.push(c);}}
  if(drag){cv.setPointerCapture(e.pointerId);cv.style.cursor=drag.mode==='hook'?'ew-resize':'grabbing'}
  wake();
});
cv.addEventListener('pointermove',e=>{
  const x=e.clientX,y=e.clientY,mvx=mouse.x<0?0:x-mouse.x,mvy=mouse.y<0?0:y-mouse.y;mouse.x=x;mouse.y=y;
  if(drag){if(drag.mode==='charm'){drag.x=x;drag.y=y;if(drag.pull&&e.isTrusted)pullFeed(drag.c,GS.move({t:performance.now(),x:x-drag.ox-drag.c.ax,y:y-drag.oy-topY}))}else{drag.c.axf=Math.min(.98,Math.max(.02,x/W));drag.c.ax=drag.c.axf*W}wake();return}
  cv.style.cursor=hitHook(x,y)?'ew-resize':hitCharm(x,y)?'grab':'default';
  if(S.wind&&e.pointerType==='mouse'&&Math.hypot(mvx,mvy)>4){let hit=false;for(const c of charms)for(let i=1;i<c.pts.length;i++){const q=c.pts[i];if(Math.hypot(q.x-x,q.y-y)<70){q.px-=Math.max(-3,Math.min(3,mvx*.05));q.py-=Math.max(-2,Math.min(2,mvy*.03));hit=true}}if(hit)wake()}
});
const end=()=>{if(drag){if(drag.mode==='hook')save();drag=null;cv.style.cursor='default';wake()}};
cv.addEventListener('pointerup',()=>{if(drag&&drag.pull)pullEnd();end()});cv.addEventListener('pointercancel',()=>{pullCancel('pointercancel');end()});
cv.addEventListener('pointerleave',()=>{mouse.x=mouse.y=-1});

// Double-click a charm: open the Studio on "My line" with that charm selected.
cv.addEventListener('dblclick',e=>{if(!e.isTrusted||!LINE)return;const c=hitCharm(e.clientX,e.clientY);if(c&&validCid(c.opts.cid))CL.openStudio(c.opts.cid)});

function rebuild(c){
  c.obj.remove(c.inner);LIB.dispose(c.inner);const b=buildFor(c.type,c.opts);c.inner=b.g;c.obj.add(b.g);c.cyU=b.cy;c.rcU=b.rc;c.clapper=b.clapper;wake();save();
}
function forgetImage(k){charms.filter(x=>x.type==='img'&&x.opts.key===k).forEach(removeCharm);if(imports[k])imports[k].tex.dispose();delete imports[k];IDB.del(k);wake();save()}
const IDB={
  open(){return new Promise((res,rej)=>{try{const r=indexedDB.open('charmline',2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('images'))r.result.createObjectStore('images')};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}})},
  async put(k,v){try{const d=await this.open();await new Promise(r=>{const t=d.transaction('images','readwrite');t.objectStore('images').put(v,k);t.oncomplete=t.onerror=r})}catch(e){}},
  async all(){try{const d=await this.open();return await new Promise(res=>{const out={},q=d.transaction('images','readonly').objectStore('images').openCursor();q.onsuccess=()=>{const c=q.result;if(c){out[c.key]=c.value;c.continue()}else res(out)};q.onerror=()=>res(out)})}catch(e){return{}}},
  async del(k){try{const d=await this.open();d.transaction('images','readwrite').objectStore('images').delete(k)}catch(e){}}
};
function loadImport(key,url,name){
  return new Promise(res=>{const img=new Image();img.onload=()=>{const t=new THREE.Texture(img);t.encoding=THREE.sRGBEncoding;t.anisotropy=renderer.capabilities.getMaxAnisotropy();t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;imports[key]={url,name,img,tex:t};res(true)};img.onerror=()=>res(false);img.src=url});
}
// Studio sends images as base64 data URLs (png / jpeg / webp / svg+xml). SVGs are re-rendered at 1024 px.
async function dataUrlToImage(url,isSvg){
  if(isSvg){
    let txt;try{txt=decodeURIComponent(escape(atob(url.slice(url.indexOf(',')+1))))}catch(e){throw new Error('That SVG file could not be read.')}
    const doc=new DOMParser().parseFromString(txt,'image/svg+xml'),el=doc.documentElement;
    if(!el||el.nodeName.toLowerCase()!=='svg')throw new Error('That SVG file could not be read.');
    const vb=(el.getAttribute('viewBox')||'').split(/[\s,]+/).map(Number);
    let w=parseFloat(el.getAttribute('width')),h=parseFloat(el.getAttribute('height'));
    if(!(w>0&&h>0)||/%/.test(el.getAttribute('width')||'')){if(vb.length===4&&vb[2]>0&&vb[3]>0){w=vb[2];h=vb[3]}else{w=h=512}}
    const k=1024/Math.max(w,h);el.setAttribute('width',Math.round(w*k));el.setAttribute('height',Math.round(h*k));
    const out=new XMLSerializer().serializeToString(el);url='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(out)));
  }
  return await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('That image could not be opened.'));i.src=url});
}
function processImage(img){
  const max=1024,s=Math.min(max/Math.max(img.naturalWidth,img.naturalHeight),2);
  const w=Math.max(1,Math.round(img.naturalWidth*s)),h=Math.max(1,Math.round(img.naturalHeight*s));
  const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.drawImage(img,0,0,w,h);
  let d;try{d=x.getImageData(0,0,w,h)}catch(e){return c.toDataURL('image/png')}
  const px=d.data,corners=[0,w-1,(h-1)*w,h*w-1];
  if(corners.every(i=>px[i*4+3]>250)){
    const avg=[0,1,2].map(ch=>corners.reduce((a,i)=>a+px[i*4+ch],0)/4);
    const spread=Math.max(...corners.map(i=>Math.hypot(px[i*4]-avg[0],px[i*4+1]-avg[1],px[i*4+2]-avg[2])));
    if(spread<60){
      const tol=42,seen=new Uint8Array(w*h),st=[];
      for(let i=0;i<w;i++)st.push(i,(h-1)*w+i);for(let j=0;j<h;j++)st.push(j*w,j*w+w-1);
      while(st.length){const i=st.pop();if(seen[i])continue;seen[i]=1;const o=i*4,dist=Math.hypot(px[o]-avg[0],px[o+1]-avg[1],px[o+2]-avg[2]);if(dist>tol)continue;
        px[o+3]=dist>tol*.6?Math.round(255*(dist-tol*.6)/(tol*.4)):0;const xx=i%w,yy=(i/w)|0;
        if(xx>0)st.push(i-1);if(xx<w-1)st.push(i+1);if(yy>0)st.push(i-w);if(yy<h-1)st.push(i+w)}
      x.putImageData(d,0,0);
    }
  }
  let x0=w,y0=h,x1=-1,y1=-1;
  for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)if(px[(yy*w+xx)*4+3]>12){if(xx<x0)x0=xx;if(xx>x1)x1=xx;if(yy<y0)y0=yy;if(yy>y1)y1=yy}
  if(x1<0)return null;
  const o=document.createElement('canvas');o.width=x1-x0+1;o.height=y1-y0+1;o.getContext('2d').drawImage(c,x0,y0,o.width,o.height,0,0,o.width,o.height);
  return o.toDataURL('image/png');
}
function nudge(){ensureAudio();for(const c of charms){const e=c.pts.at(-1);e.px+=(Math.random()<.5?-1:1)*(1.6+Math.random()*1.6);c.yawV+=(Math.random()-.5)*.08}wake()}
function rebuildAll(){charms.forEach(c=>{c.obj.remove(c.inner);LIB.dispose(c.inner);const bb=buildFor(c.type,c.opts);c.inner=bb.g;c.obj.add(bb.g);c.cyU=bb.cy;c.rcU=bb.rc;c.clapper=bb.clapper});wake();save()}
function normCaps(){if(S.cap==='minimal'){S.cap='gold';S.capDesign='ring'}}

function renderThumbs(k=1){
  const tw=128*k,th=164*k,ts=new THREE.Scene();ts.environment=LIB.env;LIB.lights(ts);
  renderer.setPixelRatio(1);renderer.setSize(tw,th,false);
  const out={};
  for(const id of Object.keys(LIB.TYPES)){
    const b=LIB.build(id);b.g.rotation.y=-.35;ts.add(b.g);
    const hh=Math.max(b.height+.15,(b.width+.25)*th/tw),cam=new THREE.OrthographicCamera(-hh*tw/th/2,hh*tw/th/2,.08,-hh+.08,-50,50);cam.position.z=10;
    renderer.setClearColor(0,0);renderer.clear();renderer.render(ts,cam);
    out[id]=glc.toDataURL('image/png');ts.remove(b.g);LIB.dispose(b.g);
  }
  return out;
}
function save(){if(DEMO)return;clearTimeout(save.t);save.t=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify({S,charms:charms.map(c=>({type:c.type,axf:c.axf,len:c.len,opts:c.opts}))}))}catch(e){}},300);pushState()}
function load(){if(DEMO)return null;try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){return null}}

function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2);W=innerWidth;H=innerHeight;
  cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR);cv.style.width=W+'px';cv.style.height=H+'px';ctx.setTransform(DPR,0,0,DPR,0,0);
  renderer.setPixelRatio(DPR);renderer.setSize(W,H,false);glc.style.width=W+'px';glc.style.height=H+'px';
  camera.left=0;camera.right=W;camera.top=0;camera.bottom=-H;camera.updateProjectionMatrix();
  {const D=3000,sc=LT.key.shadow.camera,m=Math.max(W,H)*.75;LT.key.target.position.set(W/2,-H/2,0);LT.key.position.set(W/2+KEY_DIR.x*D,-H/2+KEY_DIR.y*D,KEY_DIR.z*D);sc.left=-m;sc.right=m;sc.top=m;sc.bottom=-m;sc.near=10;sc.far=D*2;sc.updateProjectionMatrix();LT.key.target.updateMatrixWorld()}
  const nt=TOPINSET+2,dy=nt-topY;topY=nt;
  for(const c of charms){const ox=c.ax;c.ax=c.axf*W;for(const q of c.pts){q.x+=c.ax-ox;q.px+=c.ax-ox;q.y+=dy;q.py+=dy}}
  wake();pushState();
}
const CL=window.charmline||null;let TOPINSET=+(new URLSearchParams(location.search).get('top')||0),passOver=null;const lastPt={x:-1,y:-1};
function overAt(x,y){if(drag)return true;return !!(hitHook(x,y)||hitCharm(x,y))}
function pass(x,y){lastPt.x=x;lastPt.y=y;if(!CL)return;const o=overAt(x,y);if(o!==passOver){passOver=o;CL.setIgnore(!o)}}
window.addEventListener('pointermove',e=>pass(e.clientX,e.clientY),true);
window.addEventListener('pointerup',e=>setTimeout(()=>pass(e.clientX,e.clientY),0),true);
setInterval(()=>{if(lastPt.x>=0)pass(lastPt.x,lastPt.y)},120);
if(CL){CL.onCursor(p=>pass(p.x,p.y));CL.onTopInset(v=>{TOPINSET=v;resize()})}

// ---- stable charm ids, pull actions, Studio line commands. All of it needs the app's preload (CL.actions, CL.onLineCmd);
// in the browser and in ?demo=1 (the website preview) NEW / LINE are false and none of it runs.
const NEW=!!(CL&&!DEMO&&CL.settings&&CL.actions);
const LINE=NEW&&typeof CL.onLineCmd==='function'&&typeof CL.lineReply==='function';
function validCid(v){return typeof v==='string'&&/^[a-zA-Z0-9-]{8,64}$/.test(v)}
function newCid(){try{if(crypto.randomUUID)return crypto.randomUUID()}catch(e){}const b=new Uint8Array(16);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}

// Actions known to main, by charm id. Only kind/label/icon ever reach the renderer.
let ACT={};
const actOf=c=>c&&c.opts&&ACT[c.opts.cid]||null;
function hasAct(c){if(!NEW)return false;const a=actOf(c);return !!(a&&(a.pull||a.long))}
async function refreshActs(){if(!NEW)return;try{const l=await CL.actions.list();ACT=l&&typeof l==='object'?l:{}}catch(e){}wake()}
const quote=t=>'\u201c'+(t.length>24?t.slice(0,23)+'\u2026':t)+'\u201d';
function actText(info,doing){
  if(!info)return '';const L=String(info.label||'').trim();
  if(info.kind==='toggle')return doing?'Hiding charms\u2026':'Hide charms';
  if(info.kind==='copy'){if(/^copy\b/i.test(L))return L;return doing?(L?'Copied '+quote(L):'Copied'):(L?'Copy '+quote(L):'Copy text')}
  const noun=L||{url:'website',app:'app',file:'file',folder:'folder'}[info.kind]||'it';
  if(/^open\b/i.test(noun))return doing?noun.replace(/^open\b/i,'Opening')+'\u2026':noun;
  return doing?'Opening '+noun+'\u2026':'Open '+noun;
}

// ---- pull gesture (renderer/gesture.js holds the state machine; this is the wiring + feedback)
const GS=NEW&&window.PullGesture?window.PullGesture.create():null;
const PF={c:null,phase:'idle',progress:0,hasLong:false};
const pillEl=$('pill'),toastEl=$('toast');let pillC=null,pillT=0,toastT=0;
const tick1=()=>tone(1320,[[1,1],[2.4,.3]],.05,.14),tick2=()=>tone(1760,[[1,1],[2.4,.3]],.055,.16);
function pullHot(c){return PF.c===c&&(PF.phase==='past'||PF.phase==='armed'||PF.phase==='long')}
function pullStart(e,c,en){
  if(!GS||!hasAct(c))return;
  drag.stretch=true;
  if(!(e.isTrusted&&e.button===0&&e.isPrimary))return;
  const a=actOf(c);drag.pull=true;PF.hasLong=!!a.long;
  pullFeed(c,GS.start({t:performance.now(),cid:c.opts.cid,len:c.len,hasPull:!!a.pull,hasLong:!!a.long,x:en.x-c.ax,y:en.y-topY}));
}
function pullFeed(c,st){
  const prev=PF.phase;PF.c=c;PF.phase=st.phase;PF.progress=st.progress;
  if(st.phase===prev)return;
  if(st.phase==='armed'){tick1();showPill(c,'pull')}
  else if(st.phase==='long'){tick2();showPill(c,'long')}
  else if(prev==='armed'||prev==='long')hidePill();
  wake();
}
function pullEnd(){
  const c=drag.c,slot=GS.end(performance.now());drag.pull=false;PF.c=null;PF.phase='idle';
  if(slot)firePull(c,slot);else hidePill();
}
function pullCancel(reason){
  if(!GS||!drag||!drag.pull)return;
  pullFeed(drag.c,GS.cancel(reason));GS.reset();drag.pull=false;PF.c=null;PF.phase='idle';hidePill();wake();
}
function showPill(c,slot,done){
  const a=actOf(c)||{};let txt;
  if(slot==='pull'&&!a.pull)txt='Keep holding: '+actText(a.long);
  else txt=actText(a[slot]);
  pillEl.firstChild.textContent=txt;pillEl.classList.toggle('long',slot==='long');pillEl.classList.toggle('done',!!done);
  pillC=c;clearTimeout(pillT);placePill(R());pillEl.classList.add('on');
}
function hidePill(){pillEl.classList.remove('on');clearTimeout(pillT);pillT=setTimeout(()=>{pillC=null},250)}
function placePill(r){
  if(!pillC||charms.indexOf(pillC)<0)return;
  const ce=center(pillC,r),w=pillEl.offsetWidth,h=pillEl.offsetHeight,gap=ce.rc*1.2+18;
  let x=ce.x+gap;if(x+w>W-8)x=ce.x-gap-w;x=Math.max(8,Math.min(W-w-8,x));
  const y=Math.max(topY+4,Math.min(H-h-8,ce.y-h/2));
  pillEl.style.transform=`translate(${Math.round(x)}px,${Math.round(y)}px)`;
}
function toast(msg,c,bad){
  const r=R(),x0=c.ax,y0=topY+c.len+c.cyU*r+c.rcU*r+18;
  toastEl.textContent=msg;toastEl.classList.toggle('bad',!!bad);
  const w=toastEl.offsetWidth,h=toastEl.offsetHeight;
  toastEl.style.transform=`translate(${Math.round(Math.max(8,Math.min(W-w-8,x0-w/2)))}px,${Math.round(Math.max(topY+4,Math.min(H-h-8,y0)))}px)`;
  toastEl.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>toastEl.classList.remove('on'),bad?3200:1800);
}
function firePull(c,slot){
  const a=actOf(c)||{},info=a[slot];
  showPill(c,slot,true);pillT=setTimeout(hidePill,900);
  toast(actText(info,true),c);
  CL.actions.trigger(c.opts.cid,slot).then(res=>{
    if(res&&res.ok)return;
    if(res&&(res.canceled||res.declined)){toastEl.classList.remove('on');return}
    toast(res&&res.error||'That didn\u2019t work.',c,true);
  },()=>toast('That didn\u2019t work.',c,true));
}
function drawPullRing(r){
  const c=PF.c;if(!pullHot(c))return;
  const ce=center(c,r),rad=ce.rc*1.2+6,A0=-Math.PI/2;
  ctx.save();ctx.lineCap='round';
  const ring=(rr,p,col,w)=>{ctx.beginPath();ctx.arc(ce.x,ce.y,rr,0,7);ctx.strokeStyle='rgba(20,16,12,.35)';ctx.lineWidth=w+2;ctx.stroke();ctx.strokeStyle='rgba(255,241,200,.22)';ctx.lineWidth=w;ctx.stroke();
    if(p>0){ctx.beginPath();ctx.arc(ce.x,ce.y,rr,A0,A0+Math.PI*2*Math.min(1,p));ctx.strokeStyle=col;ctx.lineWidth=w;ctx.shadowColor='rgba(255,210,110,.8)';ctx.shadowBlur=6*DPR;ctx.stroke();ctx.shadowBlur=0}};
  if(PF.phase==='past')ring(rad,PF.progress,'#e1b45c',3);
  else{ring(rad,1,PF.phase==='long'?'#ffe39a':'#e1b45c',3);if(PF.hasLong)ring(rad+7,PF.phase==='long'?1:PF.progress,'#ffe39a',2.5)}
  ctx.restore();
}
addEventListener('keydown',e=>{if(e.key==='Escape')pullCancel('escape')},true);
addEventListener('blur',()=>pullCancel('blur'));

// ---- Studio line commands (CL.onLineCmd) and LineState pushes (CL.lineState).
// Main validated every command already (src/linecmd.js); this checks again against the charm library.
const JERSEY_TYPES=['jersey','kitpendant'],ROPES=['thread','chain','neon'];
const OPT_KEYS=['name','number','team','style','c1','c2','c3','capDesign','capStyle','cap','key'];
const bad=error=>({ok:false,error});
const lenMax=()=>Math.max(180,Math.round((H-topY)*.75));
const byCid=cid=>validCid(cid)&&charms.find(c=>c.opts&&c.opts.cid===cid)||null;
const validKey=k=>typeof k==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(k)&&Object.prototype.hasOwnProperty.call(imports,k);
const inList=(v,list)=>typeof v==='string'&&list.some(x=>(Array.isArray(x)?x[0]:x)===v);
const isObj=o=>!!o&&typeof o==='object'&&!Array.isArray(o);
let CATALOG=null;
function catalog(){
  if(!CATALOG)CATALOG={
    collections:LIB.COLLECTIONS.map(c=>({name:c.name,items:c.items.map(([id,name])=>({id,name}))})),
    capDesigns:LIB.CAP_DESIGNS.map(([id,n])=>[id,n]),capStyles:LIB.CAP_STYLES.map(([id,n])=>[id,n]),
    teams:LIB.TEAMS.map(([id,n])=>[id,n]),jerseyStyles:LIB.JERSEY_STYLES.map(s=>[s,s[0].toUpperCase()+s.slice(1)]),
    jerseyPresets:LIB.JERSEY_PRESETS.map(([a,b])=>[a,b]),jerseyTypes:JERSEY_TYPES.slice()
  };
  return CATALOG;
}
function thumbOf(k){
  const im=imports[k];if(!im)return '';
  if(!im.thumb){try{const iw=im.img.naturalWidth||1,ih=im.img.naturalHeight||1,s=Math.min(1,96/Math.max(iw,ih)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(iw*s));c.height=Math.max(1,Math.round(ih*s));c.getContext('2d').drawImage(im.img,0,0,c.width,c.height);im.thumb=c.toDataURL('image/png')}catch(e){im.thumb=''}}
  return im.thumb;
}
function lineState(){
  const lm=lenMax();
  return{
    S:{rope:S.rope,size:S.size,sound:S.sound,wind:S.wind,cap:S.cap,capDesign:S.capDesign},
    charms:charms.slice().sort((a,b)=>a.axf-b.axf).map(c=>{const o={};for(const k of OPT_KEYS)if(c.opts[k]!==undefined)o[k]=c.opts[k];
      return{cid:c.opts.cid,type:c.type,name:nameOf(c),collection:c.type==='img'?'Your images':LIB.TYPES[c.type].collection,len:Math.round(c.len),lenMax:Math.max(lm,Math.round(c.len)),opts:o}}),
    imports:Object.keys(imports).map(k=>({key:k,name:imports[k].name,thumb:thumbOf(k)})),
    catalog:catalog()
  };
}
// Debounced ~100 ms. A hidden overlay's timers are throttled, so then it goes out at the end of the task.
let lineReady=false,pushT=0,pushQ=false;
function sendState(){pushQ=false;clearTimeout(pushT);try{CL.lineState(lineState())}catch(e){}}
function pushState(){
  if(!LINE||!lineReady)return;
  if(document.hidden){if(!pushQ){pushQ=true;Promise.resolve().then(sendState)}return}
  clearTimeout(pushT);pushT=setTimeout(sendState,100);
}
/** Check charm opts against the library. Returns {key:value|null} or an error string; null (sent as '') = remove the per-charm override. */
function checkOpts(type,o){
  if(o===undefined)return{};
  if(!isObj(o))return 'Bad charm options.';
  const n={},jersey=JERSEY_TYPES.includes(type);
  if(['name','number','team','style','c1','c2','c3'].some(k=>k in o)&&!jersey)return 'Only jerseys have a name, number and kit.';
  if('name' in o){if(typeof o.name!=='string')return 'Name must be text.';n.name=Array.from(o.name).slice(0,12).join('')}
  if('number' in o){if(!Number.isInteger(o.number)||o.number<0||o.number>99)return 'Number must be 0 to 99.';n.number=o.number}
  if('team' in o){if(o.team!==''&&!inList(o.team,LIB.TEAMS))return 'Unknown kit.';n.team=o.team===''?null:o.team}
  if('style' in o){if(!inList(o.style,LIB.JERSEY_STYLES))return 'Unknown pattern.';n.style=o.style}
  for(const k of ['c1','c2','c3'])if(k in o){if(!(typeof o[k]==='string'&&/^#[0-9a-f]{6}$/i.test(o[k])))return 'Colours must look like #rrggbb.';n[k]=o[k]}
  for(const [k,list] of [['capDesign',LIB.CAP_DESIGNS],['capStyle',LIB.CAP_STYLES]])if(k in o){if(o[k]===''||o[k]===null)n[k]=null;else if(inList(o[k],list))n[k]=o[k];else return 'Unknown cap.'}
  if('cap' in o){if(type!=='img')return 'Only images have a bead cap switch.';if(typeof o.cap!=='boolean')return 'Bead cap must be on or off.';n.cap=o.cap}
  return n;
}
function highlight(c){
  const e=c.pts.at(-1),dir=e.x>c.ax?-1:1;
  e.px-=dir*(reduce?2:7);c.yawV+=(reduce?.03:.12)*dir;
  c.glow=performance.now()+1400;glowUntil=Math.max(glowUntil,c.glow);
  charms.splice(charms.indexOf(c),1);charms.push(c);wake();
}
async function importImage(name,url){
  if(typeof url!=='string'||url.length>15*1024*1024)return bad('That image is over 15 MB. Use a smaller one.');
  const m=/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.exec(url);if(!m)return bad('Use a PNG, JPEG, WebP or SVG image.');
  try{
    const img=await dataUrlToImage(url,m[1]==='svg+xml'),out=processImage(img);
    if(!out)return bad('That image is fully transparent, so there is nothing to hang.');
    let k='img'+Date.now(),i=0;while(imports[k])k='img'+Date.now()+'-'+(++i);
    const nm=Array.from(String(name||'').replace(/\.(png|jpe?g|webp|svg)$/i,'').trim()).slice(0,60).join('')||'Your image';
    if(!await loadImport(k,out,nm))return bad('That image could not be opened.');
    IDB.put(k,{url:out,name:nm});
    const c=addCharm('img',{key:k,cap:true});
    return{ok:true,key:k,cid:c.opts.cid};
  }catch(er){return bad(er&&er.message?er.message:'That image could not be opened.')}
}
async function runCmd(op,a){
  if(!isObj(a))a={};
  switch(op){
    case 'getState':return{ok:true,state:lineState()};
    case 'add':{
      if(typeof a.type!=='string'||a.type==='img'||!LIB.TYPES[a.type])return bad('Unknown charm.');
      const n=checkOpts(a.type,a.opts);if(typeof n==='string')return bad(n);
      const opts={};for(const k in n)if(n[k]!==null)opts[k]=n[k];
      const c=addCharm(a.type,opts);return{ok:true,cid:c.opts.cid};
    }
    case 'addImage':{if(!validKey(a.key))return bad('That image is no longer in your library.');const c=addCharm('img',{key:a.key,cap:true});return{ok:true,cid:c.opts.cid}}
    case 'remove':{const c=byCid(a.cid);if(!c)return bad('That charm is no longer on the line.');removeCharm(c);wake();save();return{ok:true}}
    case 'update':{
      const c=byCid(a.cid);if(!c)return bad('That charm is no longer on the line.');
      const n=checkOpts(c.type,a.opts);if(typeof n==='string')return bad(n);
      if('len' in a){if(typeof a.len!=='number'||!Number.isFinite(a.len))return bad('Rope length is out of range.');c.len=Math.round(Math.max(60,Math.min(Math.max(lenMax(),c.len),a.len)))}
      const keys=Object.keys(n);
      for(const k of keys){if(n[k]===null)delete c.opts[k];else c.opts[k]=n[k]}
      if(keys.length)rebuild(c);else{wake();save()}
      return{ok:true};
    }
    case 'highlight':{const c=byCid(a.cid);if(!c)return bad('That charm is no longer on the line.');highlight(c);return{ok:true}}
    case 'style':{
      if('rope' in a&&!ROPES.includes(a.rope))return bad('Unknown rope.');
      if('size' in a&&!(typeof a.size==='number'&&a.size>=.6&&a.size<=1.6))return bad('Size must be 0.6 to 1.6.');
      for(const k of ['sound','wind'])if(k in a&&typeof a[k]!=='boolean')return bad(k+' must be on or off.');
      if('cap' in a&&!inList(a.cap,LIB.CAP_STYLES))return bad('Unknown cap finish.');
      if('capDesign' in a&&!inList(a.capDesign,LIB.CAP_DESIGNS))return bad('Unknown cap design.');
      if('rope' in a)S.rope=a.rope;
      if('size' in a)S.size=a.size;
      if('sound' in a){S.sound=a.sound;if(S.sound)ensureAudio()}
      if('wind' in a)S.wind=a.wind;
      const caps=('cap' in a&&a.cap!==S.cap)||('capDesign' in a&&a.capDesign!==S.capDesign);
      if('cap' in a)S.cap=a.cap;if('capDesign' in a)S.capDesign=a.capDesign;
      normCaps();if(caps)rebuildAll();else{wake();save()}
      return{ok:true};
    }
    case 'nudge':nudge();return{ok:true};
    case 'clear':charms.slice().forEach(removeCharm);wake();save();return{ok:true};
    case 'import':return importImage(a.name,a.dataUrl);
    case 'forgetImage':{if(!validKey(a.key))return bad('That image is no longer in your library.');forgetImage(a.key);return{ok:true}}
  }
  return bad('Unknown command.');
}
// Commands can arrive while the line is still loading: hold them until it's ready.
const cmdQueue=[];
function onCmd(m){
  if(!isObj(m))return;
  if(!lineReady){if(cmdQueue.length<50)cmdQueue.push(m);return}
  const id=m.id;
  Promise.resolve().then(()=>runCmd(String(m.op),m.args)).catch(()=>bad('Something went wrong.')).then(r=>{try{CL.lineReply(id,r)}catch(e){}});
}
if(LINE)CL.onLineCmd(onCmd);

// ---- shown / hidden
function dropIn(){if(reduce)return;for(const c of charms){const e=c.pts.at(-1);e.y-=14+Math.random()*8;e.py=e.y;e.px=e.x+(Math.random()<.5?-1:1)*(1+Math.random()*1.2);c.yawV+=(Math.random()-.5)*.06}wake()}

async function initApp(){
  if(CL.onShown)CL.onShown(v=>{if(v)dropIn();else pullCancel('hidden')});
  if(CL.onActionsChanged)CL.onActionsChanged(refreshActs);
  try{const l=await CL.actions.list();ACT=l&&typeof l==='object'?l:{}}catch(e){}
  // bindings for charms that no longer exist (removed while the app was closed, or lost images) are dropped
  const live=new Set(charms.map(c=>c.opts.cid));
  for(const cid of Object.keys(ACT))if(!live.has(cid)&&validCid(cid)){delete ACT[cid];CL.actions.forget(cid).catch(()=>{})}
  wake();
  if(LINE){lineReady=true;sendState();cmdQueue.splice(0).forEach(onCmd)}
}

// "nazar:170,bell" -> evenly spaced charms; length after the colon is optional.
function demoList(str){const ids=str.split(',').map(x=>x.split(':')).filter(([id])=>LIB.TYPES[id]);return ids.map(([type,len],i)=>({type,axf:(i+1)/(ids.length+1),len:+len||120+((i*53)%90)}))}
if(DEMO){
  addEventListener('message',e=>{
    if(e.origin!==location.origin)return;const m=e.data||{};
    if(m.type==='charms'){charms.slice().forEach(removeCharm);charms=demoList(m.charms).map(c=>{const x=makeCharm(c.type,c.axf,c.len);x.pts.at(-1).px-=2+Math.random()*2;return x});wake()}
    if(m.type==='nudge')nudge();
    if(m.type==='add'&&LIB.TYPES[m.charm]){const c=makeCharm(m.charm,gapAxf(),m.len||140+Math.random()*110);c.pts.at(-1).px-=3;charms.push(c);wake()}
    if(m.type==='remove'){const c=charms.find(x=>x.type===m.charm);if(c){removeCharm(c);wake()}}
    if(m.type==='clear'){charms.slice().forEach(removeCharm)}
    if(m.type==='sway'){for(const c of charms){const e=c.pts.at(-1);e.px+=m.v*(.6+Math.random()*.4)}wake()}
    if(m.type==='rope'){S.rope=m.rope;wake()}
    if(m.type==='cap'){if(m.design)S.capDesign=m.design;if(m.finish)S.cap=m.finish;normCaps();rebuildAll()}
  });
  window.charmThumbs=k=>{const t=renderThumbs(k);resize();return t};
  cv.style.touchAction='pan-y';
}
async function init(){
  // No thumbnail rendering at startup any more: the Studio uses charms/<id>.webp (renderThumbs stays for DEMO's charmThumbs).
  const stored=DEMO?{}:await IDB.all();for(const [k,v] of Object.entries(stored))await loadImport(k,v.url,v.name);
  resize();
  const d=load();
  if(d&&d.S){const v=d.S.v;Object.assign(S,d.S);if(v!==5){if(S.capDesign==='beads'&&S.cap==='gold')S.capDesign='signature';S.v=5}}
  if(DEMO&&Q.get('size'))S.size=+Q.get('size');
  if(DEMO&&Q.get('rope'))S.rope=Q.get('rope');
  normCaps();
  const list=DEMO&&Q.get('charms')?demoList(Q.get('charms')):d&&Array.isArray(d.charms)&&d.charms.length?d.charms.filter(c=>c.type==='img'?c.opts&&imports[c.opts.key]:LIB.TYPES[c.type]):
    W<600?[{type:'bommai',axf:.3,len:150},{type:'nazar',axf:.72,len:110}]:
    [{type:'nimbu',axf:.3,len:140},{type:'bommai',axf:.42,len:200},{type:'kitpendant',axf:.54,len:120,opts:{team:'india',name:'Your name',number:7}},{type:'nazar',axf:.65,len:170},{type:'lantern',axf:.76,len:130},{type:'bell',axf:.87,len:180}];
  charms=list.map(c=>{const m=makeCharm(c.type,c.axf,c.len,c.opts);m.pts.at(-1).px-=1+Math.random()*1.5;return m});
  if(!DEMO&&d&&Array.isArray(d.charms)&&d.charms.some(c=>!c.opts||!validCid(c.opts.cid)))save(); // persist ids given to v1.0 charms
  if(NEW)initApp();
  addEventListener('resize',resize);
  requestAnimationFrame(t=>{last=t;frame(t);try{performance.mark('charmline-ready')}catch(e){}});
}
(document.fonts?Promise.race([Promise.all([document.fonts.ready,document.fonts.load('700 100px Oswald')]),new Promise(r=>setTimeout(r,2500))]):Promise.resolve()).then(init,init);
})();
