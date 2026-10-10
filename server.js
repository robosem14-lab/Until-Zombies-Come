const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{WebSocketServer}=require('ws');
const ADMIN_SECRET=process.env.ADMIN_SECRET||'';
function validSecret(value){if(!ADMIN_SECRET||typeof value!=='string'||value.length>256)return false;const a=crypto.createHash('sha256').update(value).digest(),b=crypto.createHash('sha256').update(ADMIN_SECRET).digest();return crypto.timingSafeEqual(a,b)}
const PORT=process.env.PORT||3000,root=path.join(__dirname,'public');
const server=http.createServer((req,res)=>{let file=req.url.split('?')[0];file=file==='/'?'/index.html':file;let full=path.resolve(root,'.'+decodeURIComponent(file));if(!full.startsWith(root+path.sep)){res.writeHead(403);return res.end()}fs.readFile(full,(e,data)=>{if(e){res.writeHead(404);return res.end('Not found')}res.setHeader('Content-Type',full.endsWith('.html')?'text/html':full.endsWith('.js')?'application/javascript':'text/plain');res.end(data)})});
const wss=new WebSocketServer({server});const players=new Map(),parties=new Map(),invites=new Map();let nextId=1;
const guns=[{name:'Pistol',cost:0,damage:15,rate:3.5,mag:12},{name:'SMG',cost:1500,damage:9,rate:11,mag:35},{name:'Shotgun',cost:3500,damage:12,rate:1.4,mag:8,pellets:6},{name:'AK-47',cost:7500,damage:22,rate:7,mag:30},{name:'Minigun',cost:20000,damage:12,rate:19,mag:150},{name:'Revolver',cost:2500,damage:60,rate:2.1,mag:6},{name:'Burst Rifle',cost:5500,damage:27,rate:8,mag:24},{name:'LMG',cost:12500,damage:18,rate:13,mag:90}];const prices=[5000,15000,30000],rewards={green:100,blue:200,red:750,cyan:300};
function send(p,obj){if(p.ws.readyState===1)p.ws.send(JSON.stringify(obj))}function fail(p,msg){send(p,{type:'error',message:msg})}function partyState(party){let members=party.ids.map(id=>players.get(id)).filter(Boolean);members.forEach(p=>send(p,{type:'party',code:party.code,host:party.host,members:members.map(m=>({id:m.id,nick:m.nick})),running:party.running}))}function newParty(host){let code;do{code=Math.random().toString(36).slice(2,8).toUpperCase()}while(parties.has(code));let party={code,host:host.id,ids:[host.id],running:false,wave:1,remaining:0,spawnClock:0,nextWave:-1,zombies:[],bombs:[],seq:0,doors:{storage:false,courtyard:false}};parties.set(code,party);host.party=code;partyState(party);return party}function leave(p){let party=parties.get(p.party);if(!party)return;party.ids=party.ids.filter(id=>id!==p.id);p.party=null;if(!party.ids.length)parties.delete(party.code);else{if(party.host===p.id)party.host=party.ids[0];partyState(party)}}function join(p,party){if(p.party)leave(p);if(party.running)return fail(p,'Матч уже начался');if(party.ids.length>=4)return fail(p,'Комната заполнена');party.ids.push(p.id);p.party=party.code;partyState(party)}function aliveMembers(room){return room.ids.map(id=>players.get(id)).filter(p=>p&&p.hp>0)}function begin(room){room.running=true;room.wave=1;room.zombies=[];room.bombs=[];room.nextWave=-1;room.remaining=0;room.doors={storage:false,courtyard:false};for(let i=0;i<room.ids.length;i++){let p=players.get(room.ids[i]);if(!p)continue;Object.assign(p,{x:330+i*34,y:260,zone:0,portalCooldown:0,perks:{extra:false,bigg:false,illusion:false},illusionClock:3,hp:100,cash:0,kills:0,gun:0,ammo:12,owned:guns.map((_,i)=>i===0),levels:guns.map(()=>0),cool:0,reload:0,inv:0,streak:0,streakTime:0,aim:0,moveX:0,moveY:0,fire:false});send(p,{type:'started'})}startWave(room)}function startWave(room){room.remaining=(6+room.wave*5+Math.floor(room.wave*room.wave*.25))*Math.max(1,room.ids.length);room.spawnClock=.2;room.nextWave=-1}function spawn(room){let types=['green'];if(room.wave>=3)types.push('blue');if(room.wave>=5)types.push('red');if(room.wave>=7)types.push('cyan');let type=types[Math.floor(Math.random()*types.length)],edge=Math.floor(Math.random()*4),x=edge===0?20:edge===1?740:Math.random()*760,y=edge===2?20:edge===3?520:Math.random()*540;let hp=(30+room.wave*9)*({green:1,blue:.7,red:3,cyan:1.2}[type]);let active=aliveMembers(room),zones=[...new Set(active.map(p=>p.zone||0))];let zone=zones.length?zones[Math.floor(Math.random()*zones.length)]:0;room.zombies.push({id:++room.seq,x,y,zone,type,hp,max:hp,r:{green:12,blue:11,red:18,cyan:13}[type],speed:(60+Math.min(room.wave,15)*3)*({green:1,blue:1.7,red:.65,cyan:.9}[type]),bombTimer:2+Math.random()*2})}function hitWall(x,y,r){return x<r+4||x>760-r-4||y<r+4||y>540-r-4||[{x:185,y:120,w:100,h:35},{x:470,y:325,w:95,h:38},{x:80,y:345,w:55,h:80},{x:580,y:95,w:60,h:70},{x:315,y:415,w:100,h:40}].some(o=>x+r>o.x&&x-r<o.x+o.w&&y+r>o.y&&y-r<o.y+o.h)}function moveEntity(e,dx,dy,r){if(!hitWall(e.x+dx,e.y,r))e.x+=dx;if(!hitWall(e.x,e.y+dy,r))e.y+=dy}function kill(room,z,killer){let index=room.zombies.indexOf(z);if(index<0)return;room.zombies.splice(index,1);killer.streak=killer.streakTime>0?killer.streak+1:1;killer.streakTime=5;let earned=Math.round(rewards[z.type]*(killer.streak>=2?1.05:1));killer.cash+=earned;killer.kills++;room.ids.forEach(id=>{let p=players.get(id);if(p)send(p,{type:'kill',zone:z.zone,x:z.x,y:z.y,earned,killer:killer.id})})}
let broadcastClock=0;function tick(dt){broadcastClock+=dt;const broadcast=broadcastClock>=.10;if(broadcast)broadcastClock=0;for(let room of parties.values()){if(!room.running)continue;let members=room.ids.map(id=>players.get(id)).filter(Boolean);if(!members.length)continue;for(let p of members){p.cool=Math.max(0,p.cool-dt);p.inv=Math.max(0,p.inv-dt);p.streakTime=Math.max(0,p.streakTime-dt);if(!p.streakTime)p.streak=0;if(p.reload>0){p.reload-=dt;if(p.reload<=0)p.ammo=guns[p.gun].mag*(p.perks?.extra?2:1)}if(p.hp<=0)continue;p.portalCooldown=Math.max(0,(p.portalCooldown||0)-dt);let len=Math.hypot(p.moveX,p.moveY)||1;moveEntity(p,p.moveX/len*205*dt,p.moveY/len*205*dt,12);
// Crossing an unlocked doorway is automatic. All zones share screen coordinates,
// but have independent zombie populations and player positions.
if(p.portalCooldown<=0&&p.x>305&&p.x<455){
 if(p.zone===0&&p.y<=20&&room.doors.storage){p.zone=1;p.y=505;p.portalCooldown=1;send(p,{type:'zone',zone:1,x:p.x,y:p.y})}
 else if(p.zone===0&&p.y>=520&&room.doors.courtyard){p.zone=2;p.y=35;p.portalCooldown=1;send(p,{type:'zone',zone:2,x:p.x,y:p.y})}
 else if(p.zone===1&&p.y>=520){p.zone=0;p.y=35;p.portalCooldown=1;send(p,{type:'zone',zone:0,x:p.x,y:p.y})}
 else if(p.zone===2&&p.y<=20){p.zone=0;p.y=505;p.portalCooldown=1;send(p,{type:'zone',zone:0,x:p.x,y:p.y})}
}
// Illusionist: every 3 seconds a server-authoritative bomb seeks a nearby tough zombie.
if(p.perks?.illusion&&p.hp>0){
 p.illusionClock-=dt;
 if(p.illusionClock<=0){p.illusionClock+=3;
  let target=null,score=-Infinity;
  for(const z of room.zombies){if(z.zone!==p.zone)continue;let d=Math.hypot(z.x-p.x,z.y-p.y);if(d>430)continue;
   let value=z.hp*.8-d*.22+(z.type==='red'?35:0);
   if(value>score){score=value;target=z;}}
  if(target){const bx=target.x,by=target.y,zone=target.zone,radius=65;
   for(const z of [...room.zombies]){if(z.zone!==zone)continue;let d=Math.hypot(z.x-bx,z.y-by);if(d<radius+z.r){z.hp-=Math.round(65*(1-.3*Math.min(1,d/radius)));if(z.hp<=0)kill(room,z,p);}}
   for(const id of room.ids){const q=players.get(id);if(q)send(q,{type:'perkBomb',zone,x:bx,y:by,fromX:p.x,fromY:p.y,owner:p.id})}
  }
 }
}
if(p.fire&&p.cool<=0&&p.reload<=0){let g=guns[p.gun];if(p.ammo<=0){p.reload=g.name==='Minigun'?3:1.4;continue}p.ammo--;p.cool=1/(g.rate*[1,1.1,1.25,1.4][p.levels[p.gun]]);let count=g.pellets||1;for(let j=0;j<count;j++){
let angle=p.aim+(Math.random()-.5)*(count>1?.6:.05),vx=Math.cos(angle),vy=Math.sin(angle);
// One authoritative impact per projectile: bullets stop at the first zombie or wall.
let ox=p.x+vx*36,oy=p.y+vy*36,impactX=ox+vx*650,impactY=oy+vy*650,nearest=null,best=650;
for(let distance=5;distance<=650;distance+=5){if(hitWall(ox+vx*distance,oy+vy*distance,2)){best=distance;impactX=ox+vx*distance;impactY=oy+vy*distance;break}}
for(let z of room.zombies){if(z.zone!==p.zone)continue;let dx=z.x-ox,dy=z.y-oy,projection=dx*vx+dy*vy,lateral=Math.abs(dx*vy-dy*vx),radius=z.r+3;
if(projection>=0&&lateral<radius){let contact=Math.max(0,projection-Math.sqrt(radius*radius-lateral*lateral));if(contact<best){best=contact;nearest=z;impactX=ox+vx*contact;impactY=oy+vy*contact}}}
// Particle upgrades turn pistol shots into explosive projectiles at ALL three levels.
// Explosion is centered on the FIRST impact (zombie OR wall); a near miss also
// detonates at the projectile endpoint. The server alone applies area damage.
let pistolUpgrade=p.gun===0?p.levels[0]:0;
let explosive=pistolUpgrade>=1;
if(explosive){
  const blastRadius=[0,55,70,90][pistolUpgrade];
  const blastDamage=[0,45,70,100][pistolUpgrade];
  for(const target of [...room.zombies]){
    if(target.zone!==p.zone)continue;const d=Math.hypot(target.x-impactX,target.y-impactY);
    if(d<=blastRadius+target.r){
      target.hp-=Math.max(1,Math.round(blastDamage*(p.perks?.bigg?2:1)*(1-.35*Math.min(1,d/blastRadius))));
      if(target.hp<=0)kill(room,target,p);
    }
  }
}else if(nearest){
  nearest.hp-=g.damage*[1,1.15,1.3,1.5][p.levels[p.gun]]*(p.perks?.bigg?2:1);
  if(nearest.hp<=0)kill(room,nearest,p);
}
for(let id of room.ids){let other=players.get(id);if(other)send(other,{type:'shot',zone:p.zone,id:p.id,x:ox,y:oy,aim:angle,level:p.levels[p.gun],gun:p.gun,endX:impactX,endY:impactY,explosive,hit:!!nearest})}
}}}if(room.remaining>0){room.spawnClock-=dt;if(room.spawnClock<=0){if(room.zombies.length<90){spawn(room);room.remaining--;}room.spawnClock=Math.max(.22,.65-room.wave*.016)}}for(let z of room.zombies){let target=null,best=Infinity;for(let p of members){if(p.hp<=0||p.zone!==z.zone)continue;let d=Math.hypot(p.x-z.x,p.y-z.y);if(d<best){best=d;target=p}}if(!target)continue;let dx=(target.x-z.x)/(best||1),dy=(target.y-z.y)/(best||1);if(z.type==='cyan'){z.bombTimer-=dt;if(best<330&&z.bombTimer<=0){room.bombs.push({zone:z.zone,x:target.x,y:target.y,t:1.4,r:49});z.bombTimer=3+Math.random()*1.5}if(best<170){dx=-dx;dy=-dy}else if(best<240){dx=0;dy=0}}moveEntity(z,dx*z.speed*dt,dy*z.speed*dt,z.r);if(best<z.r+13&&target.inv<=0){target.hp=Math.max(0,target.hp-(z.type==='red'?22:12));target.inv=.65}}// Spatial hash: only resolve overlaps in nearby cells (not every pair on the map).
const cells=new Map(),cellSize=45;
for(let i=0;i<room.zombies.length;i++){let z=room.zombies[i],cx=Math.floor(z.x/cellSize),cy=Math.floor(z.y/cellSize),key=cx+','+cy;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i)}
for(let i=0;i<room.zombies.length;i++){let a=room.zombies[i],cx=Math.floor(a.x/cellSize),cy=Math.floor(a.y/cellSize);for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){let near=cells.get((cx+ox)+','+(cy+oy));if(!near)continue;for(let j of near){if(j<=i)continue;let b=room.zombies[j];if(b.zone!==a.zone)continue;let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),min=a.r+b.r+1;if(d<min){if(d<.001){dx=.7;dy=.7;d=Math.hypot(dx,dy)}let n=Math.min(7,(min-d)*.5),ux=dx/d,uy=dy/d;moveEntity(a,-ux*n,-uy*n,a.r);moveEntity(b,ux*n,uy*n,b.r)}}}}
for(let i=room.bombs.length-1;i>=0;i--){let b=room.bombs[i];b.t-=dt;if(b.t<=0){for(let p of members)if(p.hp>0&&p.zone===b.zone&&p.inv<=0&&Math.hypot(p.x-b.x,p.y-b.y)<b.r+12){p.hp=Math.max(0,p.hp-24);p.inv=.6}room.bombs.splice(i,1)}}if(room.remaining===0&&!room.zombies.length){if(room.nextWave<0){room.nextWave=5;members.forEach(p=>send(p,{type:'waveclear',wave:room.wave}))}else if((room.nextWave-=dt)<=0){room.wave++;startWave(room)}}if(members.every(p=>p.hp<=0)){room.running=false;members.forEach(p=>send(p,{type:'gameover',wave:room.wave}));partyState(room)}if(broadcast){const sharedZ=room.zombies.map(z=>({id:z.id,x:Math.round(z.x),y:Math.round(z.y),type:z.type,hp:Math.round(z.hp),max:z.max,r:z.r,zone:z.zone}));const sharedP=members.map(q=>({id:q.id,nick:q.nick,x:Math.round(q.x),y:Math.round(q.y),hp:q.hp,zone:q.zone,gun:q.gun,level:q.levels[q.gun],aim:q.aim}));room.ids.forEach(id=>{let p=players.get(id);if(p&&p.ws.bufferedAmount<180000)send(p,{type:'state',wave:room.wave,remaining:room.remaining,zombies:sharedZ,bombs:room.bombs,doors:room.doors,players:sharedP,cash:p.cash,kills:p.kills,ammo:p.ammo,gun:p.gun,levels:p.levels,owned:p.owned,hp:p.hp,streak:p.streak,streakTime:p.streakTime,perks:p.perks,nextWave:room.nextWave})})}}}
setInterval(()=>tick(1/30),1000/30);
wss.on('connection',ws=>{let p={id:nextId++,ws,nick:null,party:null};players.set(p.id,p);send(p,{type:'hello',id:p.id});ws.on('message',raw=>{if(raw.length>4000)return;let m;try{m=JSON.parse(raw)}catch{return}if(m.type==='adminLogin'){if(!p.nick)return fail(p,'Сначала войди под ником');if(p.adminFailures>=5)return fail(p,'Слишком много попыток входа');if(!validSecret(m.secret)){p.adminFailures=(p.adminFailures||0)+1;return fail(p,'Неверный админ-пароль или ADMIN_SECRET не задан на Render')}p.admin=true;p.adminFailures=0;send(p,{type:'adminOK'});return}
if(m.type==='adminCash'){if(!p.admin)return fail(p,'Нет прав администратора');const room=parties.get(p.party);if(!room?.running)return fail(p,'Сначала начни матч');const amount=Number(m.amount);if(!Number.isSafeInteger(amount)||amount<1||amount>100000)return fail(p,'Сумма: от 1 до 100 000');p.cash=Math.min(100000000,p.cash+amount);send(p,{type:'adminCashOK',cash:p.cash,amount});return}
if(m.type==='register'){let nick=String(m.nick||'').trim();if(!/^[\p{L}\p{N}_-]{3,16}$/u.test(nick))return fail(p,'Ник: 3–16 букв, цифр, _ или -');if([...players.values()].some(q=>q!==p&&q.nick?.toLowerCase()===nick.toLowerCase()))return fail(p,'Этот ник сейчас занят');p.nick=nick;send(p,{type:'registered',nick});return}if(!p.nick)return fail(p,'Сначала создай профиль');if(m.type==='create'){leave(p);newParty(p)}if(m.type==='join'){let room=parties.get(String(m.code||'').toUpperCase());if(!room)return fail(p,'Комната не найдена');join(p,room)}if(m.type==='invite'){let target=[...players.values()].find(q=>q.nick?.toLowerCase()===String(m.nick||'').toLowerCase());if(!target)return fail(p,'Игрок не в сети');let room=parties.get(p.party);if(!room)return fail(p,'Сначала создай парти');invites.set(target.id,room.code);send(target,{type:'invite',from:p.nick,code:room.code});send(p,{type:'info',message:'Приглашение отправлено'})}if(m.type==='accept'){let code=invites.get(p.id);if(!code)return fail(p,'Приглашение истекло');let room=parties.get(code);if(!room)return fail(p,'Комната закрыта');invites.delete(p.id);join(p,room)}if(m.type==='leave'){leave(p);send(p,{type:'left'})}if(m.type==='start'){let room=parties.get(p.party);if(!room||room.host!==p.id)return fail(p,'Только лидер запускает матч');if(room.running)return;begin(room)}if(m.type==='input'){p.moveX=Math.max(-1,Math.min(1,Number(m.x)||0));p.moveY=Math.max(-1,Math.min(1,Number(m.y)||0));p.aim=Number(m.aim)||0;p.fire=!!m.fire}if(m.type==='door'){
 let room=parties.get(p.party);if(!room?.running||p.hp<=0)return;
 const which=String(m.door||'');if(which!=='storage'&&which!=='courtyard')return;
 if(p.zone!==0)return fail(p,'Открывать двери можно из стартовой комнаты');
 const near=which==='storage'?p.y<105:p.y>435;
 if(!near||p.x<270||p.x>490)return fail(p,'Подойди к двери ближе');
 if(room.doors[which])return;
 const cost=which==='storage'?1000:2000;
 if(p.cash<cost)return fail(p,'Нужно €'+cost);
 p.cash-=cost;room.doors[which]=true;
 room.ids.forEach(id=>{let q=players.get(id);if(q)send(q,{type:'dooropened',door:which,by:p.nick})});
 }
 if(m.type==='buy'){let room=parties.get(p.party);if(!room?.running)return;let i=Number(m.index);if(!Number.isInteger(i)||i<0||i>=guns.length)return;if(!p.owned[i]){if(p.cash<guns[i].cost)return fail(p,'Не хватает евро');p.cash-=guns[i].cost;p.owned[i]=true}p.gun=i;p.ammo=guns[i].mag*(p.perks?.extra?2:1);send(p,{type:'purchase',index:i})}if(m.type==='upgrade'){let room=parties.get(p.party),i=Number(m.index);if(!room?.running||!Number.isInteger(i)||i<0||i>=guns.length||!p.owned[i])return;let lv=p.levels[i];if(lv>=3||p.cash<prices[lv])return fail(p,'Не хватает евро');p.cash-=prices[lv];p.levels[i]++;room.ids.forEach(id=>{let q=players.get(id);if(q)send(q,{type:'upgraded',id:p.id,level:p.levels[i],x:p.x,y:p.y})})} if(m.type==='perk'){
  const room=parties.get(p.party);if(!room?.running||p.hp<=0)return;
  const key=String(m.perk||'');const costs={extra:1000,bigg:1500,illusion:1500};
  if(!Object.prototype.hasOwnProperty.call(costs,key))return;
  if(p.perks?.[key])return fail(p,'Этот перк уже куплен');
  if(p.cash<costs[key])return fail(p,'Не хватает евро');
  p.cash-=costs[key];p.perks[key]=true;
  if(key==='extra')p.ammo=Math.min(guns[p.gun].mag*2,p.ammo+guns[p.gun].mag);
  if(key==='illusion')p.illusionClock=3;
  send(p,{type:'perkBought',perk:key,cash:p.cash,perks:p.perks});
 }
 if(m.type==='heal'){
 let room=parties.get(p.party);
 if(!room?.running||p.hp<=0)return fail(p,'Лечение доступно только живым игрокам во время матча');
 if(p.hp>=100)return fail(p,'Здоровье уже полное');
 if(p.cash<250)return fail(p,'Для лечения нужно €250');
 p.cash-=250;p.hp=Math.min(100,p.hp+50);
 send(p,{type:'healed',hp:p.hp,cash:p.cash});
 }
 if(m.type==='reload'&&p.ammo<guns[p.gun].mag*(p.perks?.extra?2:1)&&p.reload<=0)p.reload=1.4});ws.on('close',()=>{leave(p);players.delete(p.id)})});server.listen(PORT,()=>console.log('Until Zombies Come Online: http://localhost:'+PORT));
