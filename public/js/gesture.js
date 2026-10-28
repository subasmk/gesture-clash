// Local webcam input only. No external-game/OS input injection.
window.GestureControl = (() => {
  let running=false, neutral=null, lastAt=0, active=false, lastSeen=false;
  let aim={x:0,y:0}, move={x:0,z:0}, handlers=null, armed=false, openSince=0;
  let wantCalibration=true, stableSince=0, stable=null, latest=null;
  let cameraState='not started', detected=0, detail='Click JOIN to start camera', fatal=false, starting=false;
  function report(message){if(message)detail=message;handlers?.onStatus(`Camera: ${cameraState} | Hands: ${detected}/2 | ${detail}`);}
  function capture(){
    if(!latest||performance.now()-lastAt>400||detected!==2){report('Need TWO visible hands before setting neutral');return false;}
    neutral={a:{...latest.a},m:{...latest.m}};wantCalibration=false;lastSeen=false;clear();report('Neutral saved. Move left hand; aim/pinch right. C recenter');return true;
  }
  const center=p=>[0,5,9,13,17].reduce((a,i)=>({x:a.x+p[i].x/5,y:a.y+p[i].y/5}),{x:0,y:0});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const axis=(v,span)=> Math.abs(v)<.045?0:Math.max(-1,Math.min(1,(v-Math.sign(v)*.045)/span));
  function clear(message) {
    aim={x:0,y:0};move={x:0,z:0};active=false;armed=false;openSince=0;
    handlers?.onAim(0,0);handlers?.onMove(0,0);
    if(message)report(message);
  }
  function calibrate(){wantCalibration=true;neutral=null;stableSince=0;stable=null;clear('Hold TWO hands comfortably still. Auto-neutral 1s, or click SET NEUTRAL.');}
  function start(videoEl,h) {
    handlers=h;
    if(running||starting){report();return;}
    fatal=false;cameraState='checking';report('Starting camera...');
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){fatal=true;cameraState='blocked';clear('Camera needs secure HTTPS. Check host URL/certificate on this device.');return;}
    if(typeof Hands==='undefined'||typeof Camera==='undefined'){fatal=true;cameraState='model unavailable';clear('Camera model missing. Reinstall npm packages.');return;}
    starting=true;
    const hands=new Hands({locateFile:f=>`/vendor/hands/${f}`});
    hands.setOptions({maxNumHands:2,modelComplexity:0,minDetectionConfidence:.65,minTrackingConfidence:.65});
    hands.onResults(results=>{
      lastAt=performance.now();cameraState='live + model OK';fatal=false;
      if(document.hidden||!document.hasFocus()){clear('Paused: focus this game window');return;}
      const all=results.multiHandLandmarks||[],labels=results.multiHandedness||[];detected=all.length;
      if(all.length!==2){stableSince=0;stable=null;lastSeen=false;clear('Show BOTH hands. Missing hand = STOP. C to recenter.');return;}
      // MediaPipe handedness assumes mirrored input. Camera input is NOT mirrored,
      // so flip its labels: model Left = user's physical Right.
      const idx=labels.findIndex(x=>x?.label==='Left');
      // If labels are absent/duplicated, raw image-left is normally physical right.
      const chosen=idx>=0?idx:(center(all[0]).x<center(all[1]).x?0:1);
      const right=all[chosen],left=all[1-chosen],ac=center(right),mc=center(left);
      const a={x:1-ac.x,y:ac.y},m={x:1-mc.x,y:mc.y};latest={a,m};
      if(wantCalibration||!neutral){
        const now=performance.now();
        if(!stable||Math.hypot(a.x-stable.ax,a.y-stable.ay,m.x-stable.mx,m.y-stable.my)>.12){stable={ax:a.x,ay:a.y,mx:m.x,my:m.y};stableSince=now;}
        if(now-stableSince<1000){clear(`Neutral calibration ${Math.min(99,Math.round((now-stableSince)/10))}%: keep TWO hands steady. Or click SET NEUTRAL.`);return;}
        neutral={a,m};wantCalibration=false;armed=false;openSince=0;
      }
      if(!lastSeen){clear();lastSeen=true;}
      aim.x+=.28*(axis(a.x-neutral.a.x,.20)-aim.x);aim.y+=.28*(axis(neutral.a.y-a.y,.20)-aim.y);
      move.x+=.35*(axis(m.x-neutral.m.x,.18)-move.x);move.z+=.35*(axis(neutral.m.y-m.y,.18)-move.z);
      // Snap neutral to exact zero so smoothing cannot leave residual creep.
      if(Math.abs(m.x-neutral.m.x)<.045)move.x=0;if(Math.abs(neutral.m.y-m.y)<.045)move.z=0;
      if(Math.abs(a.x-neutral.a.x)<.045)aim.x=0;if(Math.abs(neutral.a.y-a.y)<.045)aim.y=0;
      handlers.onAim(aim.x,aim.y);handlers.onMove(move.x,move.z);active=true;
      const scale=Math.max(.03,distance(right[0],right[9]));const pinch=distance(right[4],right[8])/scale;
      // Reacquisition never fires: open first, then one pinch per shot.
      if(pinch>.65){if(!openSince)openSince=performance.now();if(performance.now()-openSince>180)armed=true;}
      else openSince=0;
      if(armed&&pinch<.35){armed=false;handlers.onShoot();}
      report(`L MOVE ${move.z>0?'FORWARD':move.z<0?'BACK':'STOP'} ${move.x>0?'RIGHT':move.x<0?'LEFT':''} | R AIM + pinch | C recenter`);
    });
    const camera=new Camera(videoEl,{onFrame:async()=>{try{await hands.send({image:videoEl});}catch(e){fatal=true;cameraState='model error';clear(`Tracking error: ${e?.message||e}. Reload and check network/model files.`);}},width:640,height:480});
    cameraState='requesting permission';report('Allow camera in browser prompt');
    camera.start().then(()=>{running=true;starting=false;cameraState='live; model loading';calibrate();videoEl.srcObject?.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{fatal=true;running=false;cameraState='stopped';clear('Camera stopped. Reload after reconnecting webcam.');}));}).catch(e=>{fatal=true;starting=false;cameraState='denied/unavailable';clear(`Camera error: ${e?.name||''} ${e?.message||''}. Allow camera; close other camera apps; reload.`);});
    const startedAt=performance.now();
    setInterval(()=>{
      if(fatal||!running)return;
      if(!lastAt){if(performance.now()-startedAt>15000)clear('No model results yet. Check model downloads/network, then reload.');return;}
      if(performance.now()-lastAt>400){detected=0;lastSeen=false;clear('Tracking stale: stopped. Show both hands / check webcam.');}
    },100);
    addEventListener('blur',()=>{lastSeen=false;clear('Paused: return to this game window');});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){lastSeen=false;clear('Paused: tab hidden');}});
  }
  return {start,calibrate,capture};
})();
