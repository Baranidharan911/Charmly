// Pull-to-trigger gesture: a pure state machine, no DOM, no timers.
// Fed samples {t,x,y}: t in ms, x/y = drag target (pointer minus grab offset) relative to the rope anchor,
// y positive downwards. The caller calls tick(t) every frame so holds are timed without pointer moves.
// UMD: window.PullGesture in the renderer, require('./gesture.js') in node tests.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PullGesture=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const DEFAULTS={
    enterK:1.25,enterAdd:40,   // past threshold: d >= max(len*enterK, len+enterAdd)
    enterDeg:25,               // ...and |angle from straight down| <= enterDeg
    exitK:1.15,exitDeg:30,     // hysteresis: leave when d < len*exitK or |angle| > exitDeg
    armMs:300,longMs:1000,     // both measured from the moment the threshold was crossed
    swingRatio:1.5,            // horizontal travel > swingRatio * vertical travel -> not a pull
    swingMinTravel:10,         // px of total travel before the swing guard judges (ignores grab jitter)
    cooldownMs:1500            // per charm, from the last fire
  };
  const DEG=180/Math.PI;

  function create(options){
    const cfg=Object.assign({},DEFAULTS,options||{});
    const fired=new Map(); // cid -> t of last fire
    let s=null;

    const cooling=(cid,t)=>fired.has(cid)&&t-fired.get(cid)<cfg.cooldownMs;
    const snap=()=>{
      if(!s)return{phase:'idle',progress:0,d:0,angle:0,reason:null};
      let progress=0;const el=s.since==null?0:s.t-s.since;
      if(s.phase==='past')progress=Math.min(1,el/cfg.armMs);
      else if(s.phase==='armed')progress=s.hasLong?Math.min(1,(el-cfg.armMs)/(cfg.longMs-cfg.armMs)):1;
      else if(s.phase==='long')progress=1;
      return{phase:s.phase,progress,d:s.d,angle:s.angle,reason:s.reason,cid:s.cid};
    };
    const off=reason=>{if(s&&s.phase!=='off'){s.phase='off';s.reason=reason;s.since=null}};

    function evaluate(t){
      if(!s||s.phase==='off')return;
      s.t=Math.max(s.t,t);
      if(cooling(s.cid,s.t)){off('cooldown');return}
      const d=Math.hypot(s.x,s.y),angle=Math.atan2(s.x,s.y)*DEG,a=Math.abs(angle);
      s.d=d;s.angle=angle;
      const enter=Math.max(s.len*cfg.enterK,s.len+cfg.enterAdd),exit=s.len*cfg.exitK;
      if(s.phase==='track'){
        if(d>=enter&&a<=cfg.enterDeg){s.phase='past';s.since=s.t}
        else return;
      }else if(d<exit||a>cfg.exitDeg){s.phase='track';s.since=null;return}
      const el=s.t-s.since;
      if(s.hasLong&&el>=cfg.longMs)s.phase='long';
      else if(el>=cfg.armMs)s.phase=s.phase==='long'?'long':'armed';
      else s.phase='past';
    }

    return{
      config:cfg,
      // p: {t,x,y,cid,len,hasPull,hasLong}
      start(p){
        s={cid:p.cid,len:p.len,hasPull:!!p.hasPull,hasLong:!!p.hasLong,t:p.t,x:p.x,y:p.y,sx:0,sy:0,
          phase:'track',since:null,d:Math.hypot(p.x,p.y),angle:0,reason:null};
        if(!(s.hasPull||s.hasLong)||!(p.len>0))off('no-action');
        else if(cooling(s.cid,p.t))off('cooldown');
        return snap();
      },
      move(p){
        if(!s)return snap();
        if(s.phase!=='off'){
          s.sx+=Math.abs(p.x-s.x);s.sy+=Math.abs(p.y-s.y);
          if(s.sx+s.sy>=cfg.swingMinTravel&&s.sx>cfg.swingRatio*s.sy){s.x=p.x;s.y=p.y;off('swing');return snap()}
        }
        s.x=p.x;s.y=p.y;evaluate(p.t);return snap();
      },
      tick(t){evaluate(t);return snap()},
      // Pointer released. Returns 'pull' | 'long' | null and ends the drag.
      end(t){
        if(!s)return null;
        evaluate(t);
        let out=null;
        if(s.phase==='long')out='long';
        else if(s.phase==='armed'&&s.hasPull)out='pull';
        if(out&&cooling(s.cid,s.t))out=null;
        if(out)fired.set(s.cid,s.t);
        s=null;return out;
      },
      // Esc, pointercancel, blur, panel open: nothing fires for the rest of this drag.
      cancel(reason){off(reason||'cancel');return snap()},
      reset(){s=null},
      get active(){return !!s},
      get state(){return snap()}
    };
  }
  return{create,DEFAULTS};
});
