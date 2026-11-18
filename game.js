'use strict';
// Mini-game trong khuôn viên: ⚽ đá bóng ở sân bóng + 🔫 súng trên mặt đất (nhặt, bắn, hồi sinh).
// Tên súng/hình dạng do mình tự đặt (low-poly), lấy cảm hứng theo nhóm súng trong game bắn súng sinh tồn.
(()=>{
 const api=window.campusBridge,net=window.campusNet,g=api.gfx,$=id=>document.getElementById(id);
 const now=()=>Date.now(),finite=Number.isFinite;
 const WEAPONS={
  pistol :{n:'Súng ngắn Đom Đóm',dmg:14,rate:3,  mag:12,range:34, pel:1,spread:.02, col:'#aeb8bd',len:1.0},
  smg    :{n:'Tiểu liên Chớp',   dmg:8, rate:11, mag:30,range:28, pel:1,spread:.07, col:'#d9a04c',len:1.3},
  ar     :{n:'Súng trường Bão',  dmg:15,rate:6,  mag:30,range:55, pel:1,spread:.035,col:'#639a5a',len:1.8},
  lmg    :{n:'Liên thanh Gấu',   dmg:12,rate:8,  mag:60,range:48, pel:1,spread:.06, col:'#92705a',len:2.0},
  shotgun:{n:'Shotgun Sấm',      dmg:9, rate:1.2,mag:6, range:17, pel:7,spread:.16, col:'#c2604d',len:1.6},
  sniper :{n:'Bắn tỉa Diều Hâu', dmg:75,rate:.8, mag:5, range:110,pel:1,spread:.003,col:'#5a7aa6',len:2.3}
 };
 const ORDER=['pistol','smg','ar','shotgun','sniper','lmg','pistol','smg','ar','shotgun','ar','smg'];
 const RESPAWN=25000,SAFE_R=26,K=1.5,BALL_DRAG=.48,MATCH_MS=90000,JOIN_MS=60000;
 const cen=a=>[a.reduce((s,v)=>s+v[0],0)/a.length,a.reduce((s,v)=>s+v[1],0)/a.length];
 const shrink=(poly,k)=>{const c=cen(poly);return poly.map(v=>[c[0]+(v[0]-c[0])*k,c[1]+(v[1]-c[1])*k])};
 const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2], norm=v=>{const l=Math.hypot(v[0],v[1])||1;return[v[0]/l,v[1]/l]};
 const grow=(a,k)=>{const c=cen(a);return a.map(v=>[c[0]+(v[0]-c[0])*k,c[1]+(v[1]-c[1])*k])};
 function inside(x,z,p){let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if(((a[1]>z)!==(b[1]>z))&&(x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]))c=!c}return c}

 // ---- sân bóng & điểm an toàn ----
 const rawPitch=[[405,450],[603,340],[703,480],[482,589]].map(p=>g.world(p)),rawPitchCenter=cen(rawPitch);
 const rawGoalA=mid(rawPitch[3],rawPitch[0]),rawGoalB=mid(rawPitch[1],rawPitch[2]),rawLong=Math.hypot(rawGoalB[0]-rawGoalA[0],rawGoalB[1]-rawGoalA[1]),longAxis=norm([rawGoalB[0]-rawGoalA[0],rawGoalB[1]-rawGoalA[1]]),shortAxis=[-longAxis[1],longAxis[0]];
 const halfLength=rawLong*.27,halfWidth=Math.min(...rawPitch.map(p=>Math.abs((p[0]-rawPitchCenter[0])*shortAxis[0]+(p[1]-rawPitchCenter[1])*shortAxis[1])))*.54,pitchCenter=rawPitchCenter;
 const fromPitch=(u,v)=>[pitchCenter[0]+longAxis[0]*u+shortAxis[0]*v,pitchCenter[1]+longAxis[1]*u+shortAxis[1]*v],court=[fromPitch(-halfLength,-halfWidth),fromPitch(halfLength,-halfWidth),fromPitch(halfLength,halfWidth),fromPitch(-halfLength,halfWidth)],courtWide=grow(court,1.045),center=cen(court);
 const goalA=mid(court[3],court[0]),goalB=mid(court[1],court[2]),goalHalf=3.0;
 const toField=(x,z)=>[(x-pitchCenter[0])*longAxis[0]+(z-pitchCenter[1])*longAxis[1],(x-pitchCenter[0])*shortAxis[0]+(z-pitchCenter[1])*shortAxis[1]];
 const fromField=(u,v)=>[pitchCenter[0]+longAxis[0]*u+shortAxis[0]*v,pitchCenter[1]+longAxis[1]*u+shortAxis[1]*v];
 const safeC=g.world([525,803]),inSafe=(x,z)=>Math.hypot(x-safeC[0],z-safeC[1])<SAFE_R;

 // ---- điểm súng trên đất (cố định, ai cũng thấy giống nhau) ----
 const spawns=[];
 for(const poly of [[[579,714],[793,603],[1000,951],[920,1051],[698,899]],[[655,806],[765,747],[903,922],[819,981]],[[593,601],[745,521],[779,552],[626,640]]]){
  const w=poly.map(p=>g.world(p)),c=cen(w);
  for(const v of [...w.map(v=>[c[0]+(v[0]-c[0])*.55,c[1]+(v[1]-c[1])*.55]),c]){
   if(g.clear(v[0],v[1])&&!inSafe(v[0],v[1])&&Math.abs(v[0])<180&&Math.abs(v[1])<180)spawns.push({x:v[0],z:v[1]});
  }
 }
 spawns.forEach((s,i)=>s.w=ORDER[i%ORDER.length]);

 // ---- trạng thái ----
 let fight=false,ballOn=false,matchQueue=false,matchJoinAt=0,matchQueueStartedAt=0,matchStartedAt=0,matchEnded=false,matchScoreA=0,matchScoreB=0,matchEndAt=0,lastBallSync=0,lastBotKick=0,lastBotSync=0,lastMatchSync=0,matchHostId='',lastGoalAt=0,kickoffLockUntil=0;
 let bot={x:pitchCenter[0]+longAxis[0]*9,z:pitchCenter[1]+longAxis[1]*9,yaw:0},lastAssignedTeam=-1;
 let hp=100,weapon=null,ammo=0,reserve=0,reloadUntil=0,reloadTok=0,nextShot=0,alive=true,shield=0,kills=0,firing=false,nearItem=null,lastKick=0,toastUntil=0;
 const taken={},tracers=[];
 let ball={x:center[0],z:center[1],vx:0,vz:0,t:now()};
 const isTaken=i=>taken[i]&&now()-taken[i]<RESPAWN;
 const ballPos=t=>{const f=(1-Math.exp(-BALL_DRAG*(t-ball.t)/1000))/BALL_DRAG;return[ball.x+ball.vx*f,ball.z+ball.vz*f]};
 const say=s=>{const el=$('toast');if(!el)return;el.textContent=s;el.classList.add('show');toastUntil=now()+2600};
 function queuedPlayers(){
  const all=[];const localId=net.self()||'local-player';
  if(matchQueue)all.push({id:localId,name:'Bạn',queueAt:matchJoinAt,local:true});
  const joinDeadline=matchStartedAt?matchStartedAt+JOIN_MS:Infinity;
  (api.peerList?.()||[]).forEach(p=>{if(p&&p.id!=='ute-campus-bot'&&p.queue&&(!matchStartedAt||!p.queueAt||p.queueAt<=joinDeadline))all.push({id:p.id,name:p.name||'Người chơi',queueAt:p.queueAt||0,local:false})});
  const unique=[...new Map(all.map(p=>[p.id,p])).values()].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  // Never let the ten-slot client queue accidentally drop its own player.
  if(matchQueue){const self=unique.find(p=>p.id===localId);const others=unique.filter(p=>p.id!==localId);return (self?[self,...others]:others).slice(0,10).sort((a,b)=>String(a.id).localeCompare(String(b.id)));}
  return unique.slice(0,10);
 }
 function localTeam(){const list=queuedPlayers(),id=net.self()||'local-player';const i=list.findIndex(p=>p.id===id);return i<0?0:i%2}
 // Odd-sized human queues get one BOT on the smaller side, so teams stay even.
 function botNeeded(){const n=queuedPlayers().length;return matchQueue&&n>0&&(n%2===1)&&n<10}
 function matchPlayerCount(){return queuedPlayers().length+(botNeeded()?1:0)}
 function isMatchHost(){const list=queuedPlayers(),self=net.self()||'local-player';const next=list[0]?.id||self;if(matchHostId!==next)matchHostId=next;return net.live()&&next===self;}
 function placeOnTeam(){
  if(!api.setPosition)return;const list=queuedPlayers(),id=net.self()||'local-player',ix=Math.max(0,list.findIndex(p=>p.id===id)),team=ix%2,lane=(Math.floor(ix/2)-2)*2.0;
  const u=team===0?-halfLength*.50:halfLength*.50,[x,z]=fromField(u,lane);
  const dir=team===0?longAxis:[-longAxis[0],-longAxis[1]],yaw=Math.atan2(-dir[0],-dir[1]);api.setPosition(x,z,yaw);
 }
 function startMatch(){
  if(matchQueue){leaveMatch();return;}
  if(!net?.live?.()){say('Bạn chưa kết nối phòng UTE. Hãy bấm “Vào phòng chung”, chờ Realtime kết nối rồi mới tìm trận.');$('openSocial')?.click();return;}
  const t=now(),self=net.self()||'local-player';
  const active=!!(matchStartedAt&&!matchEnded&&t<matchEndAt);
  if(active){
   if(t>matchStartedAt+JOIN_MS){say('Trận đã khóa đội sau 60 giây ghép. Hãy chờ trận tiếp theo nhé.');return;}
   const waiting=queuedPlayers();
   if(waiting.length>=10){say('Trận đã đủ 10 người (5 đấu 5).');return;}
   matchQueue=true;ballOn=true;fight=false;weapon=null;ammo=0;reserve=0;firing=false;matchJoinAt=t;
   placeOnTeam();net.setExtra({queue:true,queueAt:matchJoinAt,team:localTeam()});
   net.emit('matchState',{kind:'start',queueStartedAt:matchQueueStartedAt,startedAt:matchStartedAt,endsAt:matchEndAt,scoreA:matchScoreA,scoreB:matchScoreB,hostId:matchHostId});
   say('Đã vào trận! Bạn được ghép vào đội cân bằng. Trận còn '+Math.max(0,Math.ceil((matchEndAt-t)/1000))+' giây.');
   return;
  }
  const waiting=queuedPlayers();
  if(waiting.length>=10){say('Trận đã đủ 10 người (5 đấu 5). Bạn hãy chờ trận kế tiếp.');return;}
  matchQueueStartedAt=t;matchStartedAt=t;matchEndAt=t+MATCH_MS;matchEnded=false;matchScoreA=0;matchScoreB=0;matchHostId=self;
  lastGoalAt=0;kickoffLockUntil=t+850;
  ball={x:pitchCenter[0],z:pitchCenter[1],vx:0,vz:0,t};
  bot={x:pitchCenter[0]+longAxis[0]*7,z:pitchCenter[1]+longAxis[1]*7,yaw:0,last:t};
  matchQueue=true;ballOn=true;fight=false;weapon=null;ammo=0;reserve=0;firing=false;matchJoinAt=t;
  placeOnTeam();net.setExtra({queue:true,queueAt:matchJoinAt,team:localTeam()});
  net.emit('matchState',{kind:'start',queueStartedAt:matchQueueStartedAt,startedAt:matchStartedAt,endsAt:matchEndAt,scoreA:0,scoreB:0,hostId:matchHostId});
  say('⚽ Trận bắt đầu! Bạn đấu với BOT ngay; người chơi khác có 60 giây để vào ghép đội. Trận kéo dài 90 giây.');
 }
 function leaveMatch(){matchQueue=false;ballOn=false;firing=false;net.setExtra({queue:false,queueAt:0});say('Đã rời trận bóng');}
 function goalEvent(team){
  const t=now();
  if(!isMatchHost()||matchEnded||!matchStartedAt||t>=matchEndAt||t-lastGoalAt<1800)return;
  lastGoalAt=t;kickoffLockUntil=t+1250;
  if(team===0)matchScoreA++;else matchScoreB++;
  const data={team,scoreA:matchScoreA,scoreB:matchScoreB,startedAt:matchStartedAt,hostId:matchHostId};
  say('⚽ GHI BÀN! TỶ SỐ '+matchScoreA+' - '+matchScoreB);
  // Reset to the true centre spot and replicate both the score and kickoff position.
  ball={x:pitchCenter[0],z:pitchCenter[1],vx:0,vz:0,t};
  net.emit('goal',data);
  net.emit('ballreset',{x:pitchCenter[0],z:pitchCenter[1],vx:0,vz:0,scoreA:matchScoreA,scoreB:matchScoreB,kickoffUntil:kickoffLockUntil});
  lastBallSync=t;
 }
 function advanceBall(t){
  const previous=toField(ball.x,ball.z),bp=ballPos(t),current=toField(bp[0],bp[1]);
  const elapsed=Math.max(0,(t-ball.t)/1000),decay=Math.exp(-BALL_DRAG*elapsed),velX=ball.vx*decay,velZ=ball.vz*decay;
  let [u,v]=current,vu=velX*longAxis[0]+velZ*longAxis[1],vv=velX*shortAxis[0]+velZ*shortAxis[1];
  const prevU=previous[0],prevV=previous[1];
  const BALL_RADIUS=.18,goalPlane=halfLength+BALL_RADIUS*.92,insideMouth=(v0)=>Math.abs(v0)<goalHalf-BALL_RADIUS*1.35;
  // Swept crossing avoids missing a goal when a fast ball moves across the line between frames.
  if(matchStartedAt&&t<matchEndAt&&t>=kickoffLockUntil){
   const crossedPositive=prevU<goalPlane&&u>=goalPlane;
   const crossedNegative=prevU>-goalPlane&&u<=-goalPlane;
   if(crossedPositive||crossedNegative){
    const plane=crossedPositive?goalPlane:-goalPlane,den=u-prevU;
    const alpha=Math.abs(den)>.0001?Math.max(0,Math.min(1,(plane-prevU)/den)):1;
    const crossingV=prevV+(v-prevV)*alpha;
    if(insideMouth(crossingV)){goalEvent(crossedPositive?0:1);return;}
   }
  }
  let reset=false;
  if(Math.abs(v)>halfWidth-BALL_RADIUS){v=Math.sign(v)*(halfWidth-BALL_RADIUS);vv=-vv*.72;reset=true;}
  if(Math.abs(u)>halfLength-BALL_RADIUS){
   const canRollIntoGoal=insideMouth(v)&&((u>0&&vu>0)||(u<0&&vu<0));
   if(!canRollIntoGoal){u=Math.sign(u)*(halfLength-BALL_RADIUS);vu=-vu*.72;reset=true;}
  }
  const pos=fromField(u,v),velocity=[longAxis[0]*vu+shortAxis[0]*vv,longAxis[1]*vu+shortAxis[1]*vv];
  ball={x:pos[0],z:pos[1],vx:velocity[0],vz:velocity[1],t};
  if(reset)net.emit('ballstate',{x:ball.x,z:ball.z,vx:ball.vx,vz:ball.vz});
  if(t-lastBallSync>300){lastBallSync=t;net.emit('ballstate',{x:ball.x,z:ball.z,vx:ball.vx,vz:ball.vz});}
 }
 function updateBot(t){
  if(!botNeeded()||matchEnded)return null;
  const dt=Math.min(.06,Math.max(.008,(t-(bot.last||t))/1000));bot.last=t;
  const bp=ballPos(t),dx=bp[0]-bot.x,dz=bp[1]-bot.z,d=Math.hypot(dx,dz)||1;
  const speed=3.3;bot.x+=dx/d*Math.min(d,speed*dt);bot.z+=dz/d*Math.min(d,speed*dt);
  bot.yaw=Math.atan2(-dx,-dz);
  if(d<1.65&&t-lastBotKick>1700&&t>=kickoffLockUntil&&isMatchHost()){
   lastBotKick=t;const dir=[-longAxis[0],-longAxis[1]];kick(dir[0]*10.0,dir[1]*10.0);
  }
  if(t-lastBotSync>250&&isMatchHost()){lastBotSync=t;net.emit('botstate',{x:+bot.x.toFixed(2),z:+bot.z.toFixed(2),yaw:+bot.yaw.toFixed(3)});}
  return {id:'ute-campus-bot',name:'BOT UTE',color:'#d94d42',x:bot.x,z:bot.z,yaw:bot.yaw,weapon:'',moving:d>1.2,firing:false,hp:100,fighting:false,queue:true,queueAt:matchJoinAt,team:1,bot:true};
 }


 // ---- bắn ----
 function reload(){
  if(!weapon||!alive)return;const w=WEAPONS[weapon],t=now();
  if(reserve<=0||ammo>=w.mag||t<reloadUntil)return;
  reloadUntil=t+1600;const tok=++reloadTok;say('Đang nạp đạn…');
  setTimeout(()=>{if(tok!==reloadTok||!weapon)return;const take=Math.min(w.mag-ammo,reserve);ammo+=take;reserve-=take},1600);
 }
 function fire(){
  const t=now();
  if(!fight||!alive||!weapon||t<nextShot||t<reloadUntil)return;
  const p=api.position();
  if(inSafe(p.x,p.z)){say('Khu vực cổng là khu an toàn, không bắn được');nextShot=t+800;return}
  const w=WEAPONS[weapon];
  if(ammo<=0){reload();nextShot=t+300;return}
  ammo--;nextShot=t+1000/w.rate;
  const aim=api.aimRay?.()||{x:p.x-Math.sin(p.yaw)*1.2,z:p.z-Math.cos(p.yaw)*1.2,yaw:Math.atan2(-Math.cos(p.yaw),-Math.sin(p.yaw))};
  const base=aim.yaw,d=[];
  for(let i=0;i<w.pel;i++)d.push(+(base+(Math.random()+Math.random()-1)*w.spread).toFixed(3));
  const m={x:+aim.x.toFixed(2),z:+aim.z.toFixed(2),d,w:weapon};
  onShot(m,true);net.emit('shot',m);
  if(ammo<=0)reload();
 }
 // điểm dừng của tia đạn (gặp tường thì dừng)
 function rayEnd(m,th,range){
  const dx=Math.cos(th),dz=Math.sin(th);let s=1;
  for(;s<range;s+=1)if(!g.clear(m.x+dx*s,m.z+dz*s))break;
  return[m.x+dx*Math.min(s,range),m.z+dz*Math.min(s,range)];
 }
 function hitCount(m,w){
  const p=api.position();if(inSafe(p.x,p.z))return 0;let hits=0;
  for(const th of m.d){
   const dx=Math.cos(th),dz=Math.sin(th),rx=p.x-m.x,rz=p.z-m.z,along=rx*dx+rz*dz;
   if(along<0||along>w.range||Math.abs(rx*dz-rz*dx)>.9)continue;
   let blocked=false;for(let s=1;s<along;s+=1)if(!g.clear(m.x+dx*s,m.z+dz*s)){blocked=true;break}
   if(!blocked)hits++;
  }
  return hits;
 }
 function onShot(m,mine){
  if(!m||!finite(m.x)||!finite(m.z)||!Array.isArray(m.d)||m.d.length>10||!m.d.every(finite)||!WEAPONS[m.w])return;
  const w=WEAPONS[m.w];
  for(const th of m.d){const end=rayEnd(m,th,w.range);tracers.push({a:[m.x,m.z],b:end,t:now()});if(api.addTracer)api.addTracer(m.x,m.z,end[0],end[1],w.col);}
  if(api.fireVisual)api.fireVisual(m.w,!!mine,m.from);
  if(mine||!fight||!alive||now()<shield)return;
  const hits=hitCount(m,w);if(!hits)return;
  hp=Math.max(0,hp-hits*w.dmg);say('Bạn trúng đạn! ♥ '+Math.round(hp));
  net.emit('hit',{s:m.from,hp:Math.round(hp)});
  if(hp<=0)die(m.from);
 }
 function die(shooter){
  alive=false;weapon=null;ammo=0;reserve=0;firing=false;
  net.emit('kill',{s:shooter});say('Bạn bị '+net.nameOf(shooter)+' hạ gục! Hồi sinh sau 3 giây…');
  setTimeout(()=>{hp=100;alive=true;shield=now()+2500;api.gate();say('Đã hồi sinh ở cổng')},3000);
 }

 // ---- nhặt súng ----
 function pick(){
  if(nearItem==null||!fight||!alive)return;
  const s=spawns[nearItem],w=WEAPONS[s.w];
  weapon=s.w;ammo=w.mag;reserve=w.mag*2;reloadUntil=0;reloadTok++;
  taken[nearItem]=now();net.emit('pick',{i:nearItem});say('Đã nhặt '+w.n);nearItem=null;
 }

 // ---- bóng ----
 function displayBallPos(t){const raw=ballPos(t),[u,v]=toField(raw[0],raw[1]);const du=Math.max(-halfLength-.25,Math.min(halfLength+.25,u)),dv=Math.max(-halfWidth+.15,Math.min(halfWidth-.15,v));return fromField(du,dv)}
 function kick(vx,vz){const bp=ballPos(now());ball={x:bp[0],z:bp[1],vx,vz,t:now()};net.emit('kick',{x:+bp[0].toFixed(2),z:+bp[1].toFixed(2),vx:+vx.toFixed(2),vz:+vz.toFixed(2)})}
 function kickBall(){
  if(!ballOn||!matchQueue||fight||!alive)return;
  if(now()<kickoffLockUntil){say('⚽ Bóng đang đặt lại giữa sân, chờ giao bóng…');return;}
  const p=api.position(),bp=ballPos(now()),dist=Math.hypot(bp[0]-p.x,bp[1]-p.z);
  if(dist>2.25){say('Hãy di chuyển sát bóng rồi nhấn R hoặc nút Sút.');return;}
  const dir=[-Math.sin(p.yaw),-Math.cos(p.yaw)],power=api.running()?12.2:11.1;
  lastKick=now();kick(dir[0]*power,dir[1]*power);say('⚽ Đã sút bóng!');
 }
 function ballTick(){
  if(!ballOn)return;
  const t=now();
  if(matchQueue&&isMatchHost()&&!matchEnded)advanceBall(t);
  if(matchQueue&&isMatchHost()&&!matchEnded)updateBot(t);
  if(matchStartedAt&&!matchEnded&&t>=matchEndAt&&isMatchHost()){
   matchEnded=true;matchQueue=false;ballOn=false;matchQueueStartedAt=0;
   net.setExtra({queue:false,queueAt:0});
   net.emit('matchState',{kind:'end',scoreA:matchScoreA,scoreB:matchScoreB,hostId:matchHostId});
   say('Hết 90 giây! Tỷ số cuối cùng '+matchScoreA+' - '+matchScoreB);
  }
 }

 // ---- sự kiện từ người khác ----
 net.on('shot',m=>onShot(m,false));
 net.on('hit',m=>{if(m&&m.s===net.self()){const reticle=$('crosshair');reticle?.classList.add('hit-confirm');setTimeout(()=>reticle?.classList.remove('hit-confirm'),220);say('🎯 BẮN TRÚNG '+net.nameOf(m.from)+'! (còn '+(+m.hp||0)+' máu)')}});
 net.on('kill',m=>{if(m&&m.s===net.self()){kills++;say('Bạn hạ gục '+net.nameOf(m.from)+'! Tổng: '+kills)}});
 net.on('kick',m=>{if(m&&[m.x,m.z,m.vx,m.vz].every(finite)&&Math.hypot(m.vx,m.vz)<16){ball={x:m.x,z:m.z,vx:m.vx,vz:m.vz,t:now()};kickoffLockUntil=0;}});
 net.on('botstate',m=>{if(m&&[m.x,m.z,m.yaw].every(finite)&&Math.abs(m.x)<190&&Math.abs(m.z)<190){bot.x=m.x;bot.z=m.z;bot.yaw=m.yaw;bot.last=now();}});
 net.on('ballreset',m=>{const t=now();ball={x:finite(m?.x)?m.x:pitchCenter[0],z:finite(m?.z)?m.z:pitchCenter[1],vx:0,vz:0,t};if(finite(m?.scoreA))matchScoreA=+m.scoreA;if(finite(m?.scoreB))matchScoreB=+m.scoreB;kickoffLockUntil=finite(m?.kickoffUntil)?+m.kickoffUntil:t+1000;});
 net.on('ballstate',m=>{if(m&&[m.x,m.z,m.vx,m.vz].every(finite)&&Math.hypot(m.vx,m.vz)<30)ball={x:m.x,z:m.z,vx:m.vx,vz:m.vz,t:now()}});
 net.on('matchState',m=>{
  if(!m)return;
  if(m.kind==='queue'&&Number.isFinite(+m.queueStartedAt)){
   const incoming=+m.queueStartedAt;
   if(!matchQueueStartedAt||incoming<matchQueueStartedAt||(!matchQueue&&!matchStartedAt&&incoming>matchQueueStartedAt)||now()-matchQueueStartedAt>120000)matchQueueStartedAt=incoming;
  }
  if(m.kind==='start'&&Number.isFinite(+m.startedAt)){
   matchQueueStartedAt=+m.queueStartedAt||matchQueueStartedAt;matchStartedAt=+m.startedAt;matchEndAt=+m.endsAt||matchStartedAt+MATCH_MS;
   matchHostId=String(m.hostId||m.from||matchHostId);matchScoreA=+m.scoreA||0;matchScoreB=+m.scoreB||0;matchEnded=false;
  }
  if(m.kind==='end'){
   matchEnded=true;matchScoreA=+m.scoreA||0;matchScoreB=+m.scoreB||0;matchQueue=false;ballOn=false;matchQueueStartedAt=0;matchStartedAt=0;matchEndAt=0;
   say('Hết 90 giây! Tỷ số '+matchScoreA+' - '+matchScoreB);
  }
 });
 net.on('goal',m=>{if(!m)return;matchScoreA=+m.scoreA||0;matchScoreB=+m.scoreB||0;ball={x:pitchCenter[0],z:pitchCenter[1],vx:0,vz:0,t:now()};say('⚽ GHI BÀN! TỶ SỐ '+matchScoreA+' - '+matchScoreB);});
 net.on('pick',m=>{if(m&&Number.isInteger(m.i)&&spawns[m.i])taken[m.i]=now()});
 net.decorate=(p,e)=>{const name=String(p?.name||'Người chơi');return e&&e.f?name.slice(0,13)+(e.w?' 🔫':' ')+'♥'+e.hp:name};

 // ---- vẽ (dùng bộ vẽ có sẵn của app.js) ----
 api.hook(()=>{
  const t=now(),p=api.position();
  spawns.forEach((s,i)=>{
   if(isTaken(i)||Math.hypot(p.x-s.x,p.z-s.z)>70)return;
   const w=WEAPONS[s.w],y=.7+.15*Math.sin(t/300+i);
   g.ground(s.x,s.z,2.6,2.6,'#f2d77a',.15);
   g.box(s.x,y,s.z,.35,.35,w.len,w.col);g.box(s.x,y-.4,s.z+w.len*.3,.3,.45,.3,'#4a4a45');g.box(s.x,0,s.z,.1,3.2,.1,w.col);
  });
  if(ballOn){const b=displayBallPos(t),h=Math.min(.08,Math.hypot(ball.vx,ball.vz)*.006);g.ground(b[0],b[1],1.3,1.3,'#3c6445',.24);g.box(b[0],.24+h,b[1],.72,.72,.72,'#f6f6f0')}
 });
 api.overlay(ctx=>{
  const t=now();
  ctx.save();
  ctx.lineCap='round';
  for(let i=tracers.length-1;i>=0;i--){
   const k=tracers[i],a=(t-k.t)/110;if(a>=1){tracers.splice(i,1);continue}
   const A=g.project([k.a[0],1.5,k.a[1]]),B=g.project([k.b[0],1.5,k.b[1]]);if(A.d<1||B.d<1)continue;
   ctx.strokeStyle='rgba(255,226,122,'+(1-a)+')';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();
  }
  if(api.mode()==='walk'){
   const p=api.position();ctx.font='600 12px sans-serif';ctx.textAlign='center';
   spawns.forEach((s,i)=>{if(isTaken(i))return;const d=Math.hypot(p.x-s.x,p.z-s.z);if(d>14)return;const q=g.project([s.x,3.8,s.z]);if(q.d<2)return;ctx.fillStyle='#18362fdd';const txt=WEAPONS[s.w].n,w=ctx.measureText(txt).width+16;ctx.fillRect(q.x-w/2,q.y-16,w,22);ctx.fillStyle='#fff';ctx.fillText(txt,q.x,q.y)});
  }
  ctx.restore();
 });

 // ---- giao diện ----
 const hud=$('gameHud');
 function setBtn(el,show){if(el&&el.hidden===show)el.hidden=!show}
 function updateHud(){
  const walking=api.mode()==='walk';hud.hidden=!walking;if(!walking)return;
  const p=api.position(),onCourt=inside(p.x,p.z,courtWide);
  setBtn($('ballBtn'),onCourt||ballOn);
  $('ballBtn').classList.toggle('on',ballOn);$('ballBtn').textContent=ballOn?'⚽ Rời trận':'⚽ Tìm trận bóng';
  $('fightBtn').classList.toggle('on',fight);$('fightBtn').textContent='⚔ Đấu súng: '+(fight?'Bật':'Tắt');
  const w=weapon?WEAPONS[weapon]:null;
  $('hpBox').hidden=!fight;$('hpText').textContent='♥ '+Math.round(hp);$('hpBar').firstElementChild.style.width=hp+'%';
  $('wText').textContent=!alive?'Đã bị hạ gục…':w?(w.n+' · '+ammo+'/'+reserve+(now()<reloadUntil?' · đang nạp':'')):'Tay không · đi tới súng trên đất để nhặt';
  $('killText').textContent=kills?'Hạ gục: '+kills:'';
  setBtn($('fireBtn'),fight&&!!w&&alive);setBtn($('reloadBtn'),fight&&!!w&&alive);
  setBtn($('pickBtn'),nearItem!=null);if(nearItem!=null)$('pickBtn').textContent='Lượm '+WEAPONS[spawns[nearItem].w].n;
  const bp=ballOn?ballPos(now()):null,nearBall=!!(bp&&Math.hypot(bp[0]-p.x,bp[1]-p.z)<2.25);setBtn($('kickBtn'),!!(ballOn&&matchQueue&&nearBall&&!fight));
 }
 function tick(){
  const t=now();
  if(toastUntil&&t>toastUntil){toastUntil=0;$('toast').classList.remove('show')}
  nearItem=null;
  if(api.mode()==='walk'){
   const p=api.position();let best=1e9;
   if(fight&&alive)spawns.forEach((s,i)=>{if(isTaken(i))return;const d=Math.hypot(p.x-s.x,p.z-s.z);if(d<2.6&&d<best){best=d;nearItem=i}});
   if(firing||api.isDown('f'))fire();
  }
  ballTick();
  const team=localTeam();if(matchQueue&&team!==lastAssignedTeam){lastAssignedTeam=team;placeOnTeam();}
  if(matchQueue&&!matchEnded&&isMatchHost()&&t-lastMatchSync>1000){lastMatchSync=t;net.emit('matchState',{kind:'start',queueStartedAt:matchQueueStartedAt,startedAt:matchStartedAt,endsAt:matchEndAt,scoreA:matchScoreA,scoreB:matchScoreB,hostId:matchHostId});}net.setExtra({f:fight?1:0,hp:Math.round(hp),w:(fight&&weapon)?1:0,weapon:(fight&&weapon)?weapon:'',fighting:!!(fight&&alive&&weapon),moving:api.moving(),firing:!!(fight&&firing),queue:!!matchQueue,queueAt:matchQueue?matchJoinAt:0,team});
  const walkingNow=api.mode()==='walk';const playerCounter=$('playerCounter'),playerCounterText=$('playerCounterText');if(playerCounter){playerCounter.hidden=!walkingNow||!!(fight||matchQueue||ballOn);if(playerCounterText)playerCounterText.textContent=(net.live()||(net.onlinePlayers&&net.onlinePlayers().length))?net.count()+' người trong phòng'+(!net.live()?' · đang đồng bộ':''):'Chưa vào phòng chung';}const arena=$('arenaPanel');if(arena)arena.hidden=!(walkingNow&&(fight||matchQueue||ballOn));const count=$('arenaCount');if(count)count.textContent=(net.count())+' online · '+matchPlayerCount()+'/10 trong trận'+(botNeeded()?' (có BOT)':'');
  const scorePanel=$('matchScore')?.parentElement;if(scorePanel)scorePanel.hidden=!(matchQueue||ballOn);
  const matchMeta=$('matchMeta'),matchClock=$('matchClock'),matchScore=$('matchScore');if(matchMeta)matchMeta.textContent=matchQueue?('ĐỘI '+(team===0?'XANH':'ĐỎ')+' · '+(botNeeded()?'BOT BÙ ĐỘI':'ĐỘI CÂN BẰNG')+(matchStartedAt?(now()<matchStartedAt+JOIN_MS?' · ĐANG GHÉP':' · ĐÃ KHÓA ĐỘI'):' · ĐANG GHÉP')):(fight?'ĐẤU SÚNG REALTIME':'SÂN BÓNG UTE');
  if(matchClock){const remaining=matchStartedAt?Math.max(0,Math.ceil((matchEndAt-now())/1000)):0,queueLeft=matchStartedAt?Math.max(0,60-Math.floor((now()-matchStartedAt)/1000)):0;matchClock.textContent=matchQueue?(matchStartedAt?('CÒN '+remaining+'s · GHÉP THÊM '+queueLeft+'s'):'90 GIÂY / TRẬN'):'90 GIÂY / TRẬN';}
  if(matchScore)matchScore.textContent=matchScoreA+' : '+matchScoreB;
  const cross=$('crosshair');if(cross)cross.hidden=!(walkingNow&&fight&&!!weapon&&alive);
  updateHud();
 }
 $('fightBtn').onclick=()=>{if(!fight&&!net?.live?.()){say('Bạn chưa kết nối phòng UTE. Hãy vào phòng chung trước khi đấu súng.');$('openSocial')?.click();return;}fight=!fight;firing=false;if(fight){leaveMatch();weapon='pistol';ammo=WEAPONS.pistol.mag;reserve=WEAPONS.pistol.mag*2;reloadUntil=0;reloadTok++;say('Đã bật đấu súng và trang bị súng ngắn. Nhặt súng khác để đổi vũ khí.');}else{weapon=null;ammo=0;reserve=0;reloadUntil=0;reloadTok++;say('Đấu súng đã tắt. Súng được cất và hai tay trở về tư thế tự nhiên.');}};
 $('ballBtn').onclick=()=>{if(matchQueue)leaveMatch();else startMatch();};
 $('pickBtn').onclick=pick;$('reloadBtn').onclick=reload;$('kickBtn').onclick=kickBall;$('jumpBtn').onclick=()=>api.jump?.();
 $('exitWalk').onclick=()=>{firing=false;api.aerial()};
 const fb=$('fireBtn');fb.onpointerdown=e=>{firing=true;fb.setPointerCapture(e.pointerId)};fb.onpointerup=fb.onpointercancel=()=>{firing=false};
 addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||document.querySelector('dialog[open]'))return;
  const k=e.key.toLowerCase();if(k==='e')pick();else if(k==='r'){if(ballOn&&!fight)kickBall();else reload();}else if(e.code==='Space'){e.preventDefault();if(!e.repeat)api.jump?.();}else if(k==='g')$('fightBtn').click();
 });
 setInterval(tick,33);
 window.campusGame={WEAPONS,spawns,inside,court,goalA,goalB,halfLength,halfWidth,state:()=>({fight,hp,weapon:fight?weapon:null,ammo,reserve,kills,ball,matchQueue,matchQueueStartedAt,matchStartedAt,matchEnded,matchScoreA,matchScoreB,matchEndAt,team:localTeam()}),isFighting:()=>fight&&alive&&!!weapon,setFiring:v=>{firing=!!v},botPlayer:()=>{return botNeeded()?{id:'ute-campus-bot',name:'BOT UTE',color:'#d94d42',x:bot.x,z:bot.z,yaw:bot.yaw,weapon:'',moving:true,firing:false,hp:100,fighting:false,queue:true,queueAt:matchJoinAt,team:1,bot:true}:null;},renderState:()=>({taken:spawns.map((_,i)=>!!isTaken(i)),ball:{visible:ballOn,...(()=>{const b=displayBallPos(now());return{x:b[0],z:b[1],speed:Math.hypot(ball.vx,ball.vz)}})()}}),_test:{onShot,fire,pick,kickBall,advanceBall,goalEvent,startMatch,setFight:v=>{fight=v},setNear:i=>{nearItem=i},field:toField,queuedPlayers,botNeeded,localTeam,displayBallPos}};
})();
