// node --test renderer/_test
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const PullGesture=require('../gesture.js');

const LEN=200; // rope length; pull threshold = max(250, 240) = 250, exit < 230
const ACT={hasPull:true,hasLong:false};

// Drive a gesture through key frames: [t, x, y] (target relative to anchor). Samples every 16 ms in between,
// with tick() calls like the renderer's animation frame. Returns the machine so the caller can end/cancel.
function run(g,frames,opt){
  const o=Object.assign({cid:'charm-0001',len:LEN},ACT,opt);
  const [t0,x0,y0]=frames[0];
  g.start({t:t0,x:x0,y:y0,cid:o.cid,len:o.len,hasPull:o.hasPull,hasLong:o.hasLong});
  const phases=new Set();
  for(let i=1;i<frames.length;i++){
    const [ta,xa,ya]=frames[i-1],[tb,xb,yb]=frames[i];
    for(let t=ta+16;t<tb;t+=16){const k=(t-ta)/(tb-ta);phases.add(g.move({t,x:xa+(xb-xa)*k,y:ya+(yb-ya)*k}).phase);g.tick(t+8)}
    phases.add(g.move({t:tb,x:xb,y:yb}).phase);
  }
  return phases;
}
const pull=(t=0,depth=1.4)=>[[t,0,LEN],[t+500,0,LEN*depth],[t+900,0,LEN*depth]]; // down over 500 ms, hold 400 ms

test('straight pull, hold past 300 ms, release -> pull',()=>{
  const g=PullGesture.create();
  const ph=run(g,pull());
  assert.ok(ph.has('past')&&ph.has('armed'));
  assert.equal(g.end(900),'pull');
});

test('hold with no pointer moves is timed by tick()',()=>{
  const g=PullGesture.create();
  run(g,[[0,0,LEN],[200,0,LEN*1.4]]);
  assert.equal(g.tick(400).phase,'past');
  assert.equal(g.tick(520).phase,'armed');
  assert.equal(g.end(530),'pull');
});

test('slightly angled pull (15 deg) still fires',()=>{
  // (the swing guard compares travel from pointerdown, so a pull from rest leaning ~20 deg or more reads as a swing)
  const g=PullGesture.create();
  const a=15*Math.PI/180,d=LEN*1.4;
  run(g,[[0,0,LEN],[400,Math.sin(a)*d,Math.cos(a)*d],[800,Math.sin(a)*d,Math.cos(a)*d]]);
  assert.equal(g.end(800),'pull');
});

test('flick under 250 ms -> nothing',()=>{
  const g=PullGesture.create();
  run(g,[[0,0,LEN],[120,0,LEN*1.6],[230,0,LEN*1.6]]);
  assert.equal(g.end(240),null);
});

test('released before 300 ms past threshold -> nothing',()=>{
  const g=PullGesture.create();
  // crosses 250 px at about t=312, released at 560 (about 250 ms past threshold)
  run(g,[[0,0,LEN],[500,0,LEN*1.4]]);
  assert.equal(g.tick(560).phase,'past');
  assert.equal(g.end(560),null);
});

test('horizontal swing -> disqualified, even if it ends straight down past threshold',()=>{
  const g=PullGesture.create();
  const ph=run(g,[[0,0,LEN],[250,220,LEN*1.1],[500,-220,LEN*1.1],[700,0,LEN*1.4],[1300,0,LEN*1.4]]);
  assert.ok(!ph.has('armed'));
  assert.equal(g.state.phase,'off');
  assert.equal(g.state.reason,'swing');
  assert.equal(g.end(1300),null);
});

test('too far sideways (40 deg) never arms',()=>{
  const g=PullGesture.create();
  const a=40*Math.PI/180,d=LEN*1.5;
  // go straight down first so the swing guard does not trip, then lean over
  run(g,[[0,0,LEN],[300,0,LEN*1.2],[600,Math.sin(a)*d,Math.cos(a)*d],[1200,Math.sin(a)*d,Math.cos(a)*d]]);
  assert.equal(g.end(1200),null);
});

test('moved back up (hysteresis) resets the hold timer -> nothing',()=>{
  const g=PullGesture.create();
  run(g,[[0,0,LEN],[150,0,LEN*1.4],[330,0,LEN*1.4],[380,0,LEN*1.05],[450,0,LEN*1.4],[650,0,LEN*1.4]]);
  // 200 ms past threshold after coming back: not armed yet
  assert.equal(g.end(650),null);
});

test('hysteresis band keeps it armed (1.15..1.25 x len)',()=>{
  const g=PullGesture.create();
  run(g,[[0,0,LEN],[150,0,LEN*1.4],[500,0,LEN*1.4],[560,0,LEN*1.18],[700,0,LEN*1.18]]);
  assert.equal(g.state.phase,'armed');
  assert.equal(g.end(700),'pull');
});

test('pointercancel -> nothing',()=>{
  const g=PullGesture.create();
  run(g,pull());
  g.cancel('pointercancel');
  assert.equal(g.end(900),null);
});

test('Esc while armed -> nothing, and stays off for the drag',()=>{
  const g=PullGesture.create();
  run(g,[[0,0,LEN],[200,0,LEN*1.4],[600,0,LEN*1.4]]);
  assert.equal(g.state.phase,'armed');
  g.cancel('escape');
  assert.equal(g.move({t:700,x:0,y:LEN*1.5}).phase,'off');
  assert.equal(g.tick(1500).phase,'off');
  assert.equal(g.end(1500),null);
});

test('cooldown 1.5 s per charm; other charms unaffected',()=>{
  const g=PullGesture.create();
  run(g,pull(0));assert.equal(g.end(900),'pull');
  run(g,pull(1000));assert.equal(g.end(1900),null,'second pull 1 s after the first is ignored');
  run(g,pull(1000),{cid:'charm-0002'});assert.equal(g.end(1900),'pull','a different charm still fires');
  run(g,pull(2500));assert.equal(g.end(3400),'pull','after the cooldown it fires again');
});

test('long pull (held 1 s) -> long',()=>{
  const g=PullGesture.create();
  const ph=run(g,[[0,0,LEN],[200,0,LEN*1.4],[1400,0,LEN*1.4]],{hasLong:true});
  assert.ok(ph.has('armed')&&ph.has('long'));
  assert.equal(g.end(1400),'long');
});

test('with a long action, a short hold still fires pull',()=>{
  const g=PullGesture.create();
  run(g,[[0,0,LEN],[200,0,LEN*1.4],[800,0,LEN*1.4]],{hasLong:true});
  assert.equal(g.state.phase,'armed');
  assert.equal(g.end(800),'pull');
});

test('no long action -> never long, however long it is held',()=>{
  const g=PullGesture.create();
  const ph=run(g,[[0,0,LEN],[200,0,LEN*1.4],[4000,0,LEN*1.4]]);
  assert.ok(!ph.has('long'));
  assert.equal(g.end(4000),'pull');
});

test('only a long action: short hold fires nothing, long hold fires long',()=>{
  const g=PullGesture.create();
  run(g,[[0,0,LEN],[200,0,LEN*1.4],[800,0,LEN*1.4]],{hasPull:false,hasLong:true});
  assert.equal(g.end(800),null);
  run(g,[[5000,0,LEN],[5200,0,LEN*1.4],[6400,0,LEN*1.4]],{hasPull:false,hasLong:true});
  assert.equal(g.end(6400),'long');
});

test('charm without actions -> inert',()=>{
  const g=PullGesture.create();
  const ph=run(g,pull(),{hasPull:false,hasLong:false});
  assert.deepEqual([...ph],['off']);
  assert.equal(g.end(900),null);
});

test('short rope uses len+40 threshold',()=>{
  const g=PullGesture.create();const len=100; // threshold max(125,140)=140
  run(g,[[0,0,len],[200,0,135],[700,0,135]],{len});
  assert.equal(g.end(700),null);
  run(g,[[5000,0,len],[5200,0,145],[5700,0,145]],{len});
  assert.equal(g.end(5700),'pull');
});

test('progress fills 0..1 over the hold',()=>{
  const g=PullGesture.create();
  run(g,[[0,0,LEN],[16,0,LEN*1.4]]); // one sample: past at t=16
  const a=g.tick(166);assert.equal(a.phase,'past');assert.ok(Math.abs(a.progress-.5)<.01);
  const b=g.tick(316);assert.equal(b.phase,'armed');assert.equal(b.progress,1);
});
