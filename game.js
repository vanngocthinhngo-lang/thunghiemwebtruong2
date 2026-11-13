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
 const RESPAWN=25000,SAFE_R=26,K=1.5,BALL_DRAG=.36;
 const cen=a=>[a.reduce((s,v)=>s+v[0],0)/a.length,a.reduce((s,v)=>s+v[1],0)/a.length];
 const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2], norm=v=>{const l=Math.hypot(v[0],v[1])||1;return[v[0]/l,v[1]/l]};
 const grow=(a,k)=>{const c=cen(a);return a.map(v=>[c[0]+(v[0]-c[0])*k,c[1]+(v[1]-c[1])*k])};
 function inside(x,z,p){let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if(((a[1]>z)!==(b[1]>z))&&(x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]))c=!c}return c}

 // ---- sân bóng & điểm an toàn ----
 const court=[[405,450],[603,340],[703,480],[482,589]].map(p=>g.world(p)),courtWide=grow(court,1.1),center=cen(court);
 const goalA=mid(court[3],court[0]),goalB=mid(court[1],court[2]),pitchCenter=mid(goalA,goalB);
 const longAxis=norm([goalB[0]-goalA[0],goalB[1]-goalA[1]]),shortAxis=[-longAxis[1],longAxis[0]];
 const halfLength=Math.hypot(goalB[0]-goalA[0],goalB[1]-goalA[1])/2,halfWidth=Math.hypot(court[0][0]-court[3][0],court[0][1]-court[3][1])/2,goalHalf=4.5;
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
 let fight=false,ballOn=false,matchQueue=false,matchJoinAt=0,matchQueueStartedAt=0,matchStartedAt=0,matchEnded=false,matchScoreA=0,matchScoreB=0,matchEndAt=0,lastBallSync=0,lastBotKick=0,lastBotSync=0,lastMatchSync=0;
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
  (api.peerList?.()||[]).forEach(p=>{if(p&&p.id!=='ute-campus-bot'&&p.queue&&(!matchStartedAt||!p.queueAt||p.queueAt<=matchStartedAt))all.push({id:p.id,name:p.name||'Người chơi',queueAt:p.queueAt||0,local:false})});
  const unique=[...new Map(all.map(p=>[p.id,p])).values()].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  // Never let the ten-slot client queue accidentally drop its own player.
  if(matchQueue){const self=unique.find(p=>p.id===localId);const others=unique.filter(p=>p.id!==localId);return (self?[self,...others]:others).slice(0,10).sort((a,b)=>String(a.id).localeCompare(String(b.id)));}
  return unique.slice(0,10);
 }
 function localTeam(){const list=queuedPlayers(),id=net.self()||'local-player';const i=list.findIndex(p=>p.id===id);return i<0?0:i%2}
 // Odd-sized human queues get one BOT on the smaller side, so teams stay even.
 function botNeeded(){const n=queuedPlayers().length;return matchQueue&&n>0&&(n%2===1)&&n<10}
 function matchPlayerCount(){return queuedPlayers().length+(botNeeded()?1:0)}
 function isMatchHost(){const list=queuedPlayers();return !net.live()||!list.length||list[0].id===(net.self()||'local-player')}
 function placeOnTeam(){
  if(!api.setPosition)return;const list=queuedPlayers(),id=net.self()||'local-player',ix=Math.max(0,list.findIndex(p=>p.id===id)),team=ix%2,lane=(Math.floor(ix/2)-2)*2.0;
  const u=team===0?-halfLength*.50:halfLength*.50,[x,z]=fromField(u,lane);
  const dir=team===0?longAxis:[-longAxis[0],-longAxis[1]],yaw=Math.atan2(-dir[0],-dir[1]);api.setPosition(x,z,yaw);
 }
 function startMatch(){
  if(matchQueue)return;
  const t=now(),alreadyQueued=queuedPlayers().length;
  if(alreadyQueued>=10){say('Trận đã đủ 10 người (5 đấu 5). Bạn hãy chờ trận kế tiếp.');return;}
  if(matchStartedAt&&!matchEnded&&t<matchEndAt){say('Trận 90 giây đã bắt đầu. Bạn hãy chờ trận kế tiếp nhé.');return;}
  if(!net.live()){say('Bạn chưa vào phòng chung. Hãy vào phòng chung để tìm đối thủ thật; hiện có thể đấu tập với BOT.');}
  const waiting=queuedPlayers();
  if(matchEnded||(matchEndAt&&t>=matchEndAt)||(!waiting.length&&!matchStartedAt)){
   matchQueueStartedAt=t;matchStartedAt=0;matchEndAt=0;matchEnded=false;matchScoreA=0;matchScoreB=0;
   ball={x:pitchCenter[0],z:pitchCenter[1],vx:0,vz:0,t};
   bot={x:pitchCenter[0]+longAxis[0]*9,z:pitchCenter[1]+longAxis[1]*9,yaw:0,last:t};
  }else if(!matchQueueStartedAt){
   const stamps=waiting.map(p=>+p.queueAt||0).filter(v=>v>0);matchQueueStartedAt=stamps.length?Math.min(...stamps):t;
  }
  if(!matchStartedAt&&t-matchQueueStartedAt>=60000){say('Đã hết thời gian ghép trận. Trận kế tiếp sẽ mở sau khi trận hiện tại kết thúc.');return;}
  matchQueue=true;ballOn=true;fight=false;weapon=null;ammo=0;reserve=0;firing=false;
  matchJoinAt=t;lastAssignedTeam=-1;placeOnTeam();net.setExtra({});
  net.emit('matchState',{kind:'queue',queueStartedAt:matchQueueStartedAt});
  say('Đã vào sảnh sân bóng! BOT sẽ bù đội khi thiếu người. Ghép đội trong tối đa 60 giây, sau đó đá trận 90 giây.');
 }
 function leaveMatch(){matchQueue=false;ballOn=false;firing=false;net.setExtra({queue:false,queueAt:0});say('Đã rời trận bóng');}
 function goalEvent(team){
  if(!isMatchHost()||matchEnded)return;
  if(team===0)matchScoreA++;else matchScoreB++;
  const data={team,scoreA:matchScoreA,scoreB:matchScoreB,startedAt:matchStartedAt};
  net.emit('goal',data);say(team===localTeam()?'⚽ ĐỘI BẠN GHI BÀN!':'⚽ ĐỐI THỦ GHI BÀN!');
  ball={x:pitchCenter[0],z:pitchCenter[1],vx:0,vz:0,t:now()};net.emit('ballstate',{x:ball.x,z:ball.z,vx:0,vz:0});
 }
 function advanceBall(t){
  const elapsed=Math.max(0,(t-ball.t)/1000),decay=Math.exp(-BALL_DRAG*elapsed),bp=ballPos(t),velX=ball.vx*decay,velZ=ball.vz*decay;
  let [u,v]=toField(bp[0],bp[1]),vu=velX*longAxis[0]+velZ*longAxis[1],vv=velX*shortAxis[0]+velZ*shortAxis[1];
  let reset=false;
  if(Math.abs(v)>halfWidth-.45){v=Math.sign(v)*(halfWidth-.45);vv=-vv*.68;reset=true;}
  if(Math.abs(u)>halfLength-.55){
   if(Math.abs(v)<goalHalf && Math.abs(u)<halfLength+2.5){goalEvent(u>0?0:1);return;}
   u=Math.sign(u)*(halfLength-.55);vu=-vu*.62;reset=true;
  }
  const pos=fromField(u,v),velocity=[longAxis[0]*vu+shortAxis[0]*vv,longAxis[1]*vu+shortAxis[1]*vv];
  ball={x:pos[0],z:pos[1],vx:velocity[0],vz:velocity[1],t};
  if(reset)net.emit('ballstate',{x:ball.x,z:ball.z,vx:ball.vx,vz:ball.vz});
  if(t-lastBallSync>180){lastBallSync=t;net.emit('ballstate',{x:ball.x,z:ball.z,vx:ball.vx,vz:ball.vz});}
 }
 function updateBot(t){
  if(!botNeeded()||matchEnded)return null;
  const dt=Math.min(.06,Math.max(.008,(t-(bot.last||t))/1000));bot.last=t;
  const bp=ballPos(t),dx=bp[0]-bot.x,dz=bp[1]-bot.z,d=Math.hypot(dx,dz)||1;
  const speed=3.3;bot.x+=dx/d*Math.min(d,speed*dt);bot.z+=dz/d*Math.min(d,speed*dt);
  bot.yaw=Math.atan2(-dx,-dz);
  if(d<1.65&&t-lastBotKick>1700&&isMatchHost()){
   lastBotKick=t;const dir=[-longAxis[0],-longAxis[1]];kick(dir[0]*24,dir[1]*24);
  }
  if(t-lastBotSync>120&&isMatchHost()){lastBotSync=t;net.emit('botstate',{x:+bot.x.toFixed(2),z:+bot.z.toFixed(2),yaw:+bot.yaw.toFixed(3)});}
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
  const base=Math.atan2(-Math.cos(p.yaw),-Math.sin(p.yaw)),d=[];
  for(let i=0;i<w.pel;i++)d.push(+(base+(Math.random()+Math.random()-1)*w.spread).toFixed(3));
  const m={x:+(p.x-Math.sin(p.yaw)*1.2).toFixed(2),z:+(p.z-Math.cos(p.yaw)*1.2).toFixed(2),d,w:weapon};
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
 function displayBallPos(t){const raw=ballPos(t),[u,v]=toField(raw[0],raw[1]);const du=Math.max(-halfLength-1.45,Math.min(halfLength+1.45,u)),dv=Math.max(-halfWidth+.28,Math.min(halfWidth-.28,v));return fromField(du,dv)}
 function kick(vx,vz){const bp=ballPos(now());ball={x:bp[0],z:bp[1],vx,vz,t:now()};net.emit('kick',{x:+bp[0].toFixed(2),z:+bp[1].toFixed(2),vx:+vx.toFixed(2),vz:+vz.toFixed(2)})}
 function ballTick(){
  if(!ballOn)return;
  const t=now(),p=api.position(),bp=ballPos(t);
  // Match physics and clock continue even while the host inspects the aerial map.
  // Only a player actually in walk mode can touch the ball.
  const d=Math.hypot(bp[0]-p.x,bp[1]-p.z);
  if(api.mode()==='walk'&&alive&&d<1.8&&t-lastKick>320){
   lastKick=t;let dx=bp[0]-p.x,dz=bp[1]-p.z;
   if(d<.05){dx=-Math.sin(p.yaw);dz=-Math.cos(p.yaw)}else{dx/=d;dz/=d}
   const sp=api.running()?25:18;kick(dx*sp,dz*sp);
  }
  if(matchQueue&&isMatchHost()&&!matchStartedAt&&matchQueueStartedAt&&t-matchQueueStartedAt>=60000){
   matchStartedAt=t;matchEndAt=t+90000;matchEnded=false;matchScoreA=0;matchScoreB=0;lastMatchSync=t;
   net.emit('matchState',{kind:'start',queueStartedAt:matchQueueStartedAt,startedAt:matchStartedAt,endsAt:matchEndAt,scoreA:matchScoreA,scoreB:matchScoreB});
   say('BẮT ĐẦU TRẬN! 90 giây thi đấu chính thức.');
  }
  if(matchQueue&&isMatchHost())advanceBall(t);
  if(matchQueue&&isMatchHost())updateBot(t);
  if(matchQueue&&matchStartedAt&&!matchEnded&&t>=matchEndAt){
   matchEnded=true;matchQueue=false;ballOn=false;matchQueueStartedAt=0;net.emit('matchState',{kind:'end',scoreA:matchScoreA,scoreB:matchScoreB});say('Hết 90 giây! Tỷ số '+matchScoreA+' - '+matchScoreB);}
 }

 // ---- sự kiện từ người khác ----
 net.on('shot',m=>onShot(m,false));
 net.on('hit',m=>{if(m&&m.s===net.self()){say('Trúng '+net.nameOf(m.from)+'! (còn '+(+m.hp||0)+' máu)')}});
 net.on('kill',m=>{if(m&&m.s===net.self()){kills++;say('Bạn hạ gục '+net.nameOf(m.from)+'! Tổng: '+kills)}});
 net.on('kick',m=>{if(m&&[m.x,m.z,m.vx,m.vz].every(finite)&&Math.hypot(m.vx,m.vz)<40)ball={x:m.x,z:m.z,vx:m.vx,vz:m.vz,t:now()}});
 net.on('botstate',m=>{if(m&&[m.x,m.z,m.yaw].every(finite)&&Math.abs(m.x)<190&&Math.abs(m.z)<190){bot.x=m.x;bot.z=m.z;bot.yaw=m.yaw;bot.last=now();}});
 net.on('ballreset',()=>{ball={x:center[0],z:center[1],vx:0,vz:0,t:now()}});
 net.on('ballstate',m=>{if(m&&[m.x,m.z,m.vx,m.vz].every(finite)&&Math.hypot(m.vx,m.vz)<30)ball={x:m.x,z:m.z,vx:m.vx,vz:m.vz,t:now()}});
 net.on('matchState',m=>{
  if(!m)return;
  if(m.kind==='queue'&&Number.isFinite(+m.queueStartedAt)){
   const incoming=+m.queueStartedAt;
   if(!matchQueueStartedAt||incoming<matchQueueStartedAt||(!matchQueue&&!matchStartedAt&&incoming>matchQueueStartedAt)||now()-matchQueueStartedAt>120000)matchQueueStartedAt=incoming;
  }
  if(m.kind==='start'&&Number.isFinite(+m.startedAt)){
   matchQueueStartedAt=+m.queueStartedAt||matchQueueStartedAt;matchStartedAt=+m.startedAt;matchEndAt=+m.endsAt||matchStartedAt+90000;
   matchScoreA=+m.scoreA||0;matchScoreB=+m.scoreB||0;matchEnded=false;
  }
  if(m.kind==='end'){
   matchEnded=true;matchScoreA=+m.scoreA||0;matchScoreB=+m.scoreB||0;matchQueue=false;ballOn=false;matchQueueStartedAt=0;
   say('Hết 90 giây! Tỷ số '+matchScoreA+' - '+matchScoreB);
  }
 });
 net.on('goal',m=>{if(!m)return;matchScoreA=+m.scoreA||0;matchScoreB=+m.scoreB||0;ball={x:pitchCenter[0],z:pitchCenter[1],vx:0,vz:0,t:now()};say('⚽ '+(m.team===localTeam()?'Đội bạn':'Đội đối thủ')+' ghi bàn!');});
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
  if(ballOn){const b=displayBallPos(t),h=Math.abs(Math.sin((t-ball.t)/260))*Math.min(1.2,Math.hypot(ball.vx,ball.vz)*.08)*Math.exp(-(t-ball.t)/900);g.ground(b[0],b[1],1.5,1.5,'#3c6445',.24);g.box(b[0],.2+h,b[1],1,1,1,'#f6f6f0')}
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
 }
 function tick(){
  const t=now();
  if(toastUntil&&t>toastUntil){toastUntil=0;$('toast').classList.remove('show')}
  nearItem=null;
  if(api.mode()==='walk'){
   const p=api.position();let best=1e9;
   if(fight&&alive)spawns.forEach((s,i)=>{if(isTaken(i))return;const d=Math.hypot(p.x-s.x,p.z-s.z);if(d<2.6&&d<best){best=d;nearItem=i}});
   if(firing||api.isDown(' ')||api.isDown('f'))fire();
  }
  ballTick();
  const team=localTeam();if(matchQueue&&team!==lastAssignedTeam){lastAssignedTeam=team;placeOnTeam();}
  if(matchQueue&&!matchEnded&&isMatchHost()&&t-lastMatchSync>650){lastMatchSync=t;if(!matchStartedAt)net.emit('matchState',{kind:'queue',queueStartedAt:matchQueueStartedAt});else net.emit('matchState',{kind:'start',queueStartedAt:matchQueueStartedAt,startedAt:matchStartedAt,endsAt:matchEndAt,scoreA:matchScoreA,scoreB:matchScoreB});}net.setExtra({f:fight?1:0,hp:Math.round(hp),w:weapon?1:0,weapon:weapon||'',moving:api.moving(),firing:!!firing,queue:!!matchQueue,queueAt:matchQueue?matchJoinAt:0,team});
  const walkingNow=api.mode()==='walk';const playerCounter=$('playerCounter'),playerCounterText=$('playerCounterText');if(playerCounter){playerCounter.hidden=!walkingNow||!!(fight||matchQueue||ballOn);if(playerCounterText)playerCounterText.textContent=(net.live()||(net.onlinePlayers&&net.onlinePlayers().length))?net.count()+' người trong phòng'+(!net.live()?' · đang đồng bộ':''):'Chưa vào phòng chung';}const arena=$('arenaPanel');if(arena)arena.hidden=!(walkingNow&&(fight||matchQueue||ballOn));const count=$('arenaCount');if(count)count.textContent=(net.count())+' online · '+matchPlayerCount()+'/10 trong trận'+(botNeeded()?' (có BOT)':'');
  const scorePanel=$('matchScore')?.parentElement;if(scorePanel)scorePanel.hidden=!(matchQueue||ballOn);
  const matchMeta=$('matchMeta'),matchClock=$('matchClock'),matchScore=$('matchScore');if(matchMeta)matchMeta.textContent=matchQueue?('ĐỘI '+(team===0?'XANH':'ĐỎ')+' · '+(botNeeded()?'BOT BÙ ĐỘI':'ĐỘI CÂN BẰNG')+(matchStartedAt?' · THI ĐẤU':' · ĐANG GHÉP')):(fight?'ĐẤU SÚNG REALTIME':'SÂN BÓNG UTE');
  if(matchClock){const remaining=matchStartedAt?Math.max(0,Math.ceil((matchEndAt-now())/1000)):0,queueLeft=Math.max(0,60-Math.floor((now()-matchQueueStartedAt)/1000));matchClock.textContent=matchQueue?(matchStartedAt?('TRẬN 90 GIÂY · CÒN '+remaining+'s'):('GHÉP ĐỘI · '+queueLeft+'s · TRẬN 90s')):'90 GIÂY / TRẬN';}
  if(matchScore)matchScore.textContent=matchScoreA+' : '+matchScoreB;
  const cross=$('crosshair');if(cross)cross.hidden=!(walkingNow&&fight&&!!weapon&&alive);
  updateHud();
 }
 $('fightBtn').onclick=()=>{fight=!fight;firing=false;if(fight){leaveMatch();weapon='pistol';ammo=WEAPONS.pistol.mag;reserve=WEAPONS.pistol.mag*2;reloadUntil=0;reloadTok++;say('Đã bật đấu súng và trang bị súng ngắn. Nhặt súng khác để đổi vũ khí.');}else{weapon=null;ammo=0;reserve=0;reloadUntil=0;reloadTok++;say('Đấu súng đã tắt. Súng được cất và hai tay trở về tư thế tự nhiên.');}};
 $('ballBtn').onclick=()=>{if(matchQueue)leaveMatch();else startMatch();};
 $('pickBtn').onclick=pick;$('reloadBtn').onclick=reload;
 $('exitWalk').onclick=()=>{firing=false;api.aerial()};
 const fb=$('fireBtn');fb.onpointerdown=e=>{firing=true;fb.setPointerCapture(e.pointerId)};fb.onpointerup=fb.onpointercancel=()=>{firing=false};
 addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||document.querySelector('dialog[open]'))return;
  const k=e.key.toLowerCase();if(k==='e')pick();else if(k==='r')reload();else if(k==='g')$('fightBtn').click();
 });
 setInterval(tick,33);
 window.campusGame={WEAPONS,spawns,inside,court,goalA,goalB,halfLength,halfWidth,state:()=>({fight,hp,weapon,ammo,reserve,kills,ball,matchQueue,matchQueueStartedAt,matchStartedAt,matchEnded,matchScoreA,matchScoreB,matchEndAt,team:localTeam()}),isFighting:()=>fight&&alive&&!!weapon,setFiring:v=>{firing=!!v},botPlayer:()=>{return botNeeded()?{id:'ute-campus-bot',name:'BOT UTE',color:'#d94d42',x:bot.x,z:bot.z,yaw:bot.yaw,weapon:'',moving:true,firing:false,hp:100,fighting:false,queue:true,queueAt:matchJoinAt,team:1,bot:true}:null;},renderState:()=>({taken:spawns.map((_,i)=>!!isTaken(i)),ball:{visible:ballOn,...(()=>{const b=displayBallPos(now());return{x:b[0],z:b[1],speed:Math.hypot(ball.vx,ball.vz)}})()}}),_test:{onShot,fire,pick,setFight:v=>{fight=v},setNear:i=>{nearItem=i},field:toField,queuedPlayers,botNeeded,localTeam,displayBallPos}};
})();
