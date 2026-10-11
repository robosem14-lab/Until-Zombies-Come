const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{WebSocketServer}=require('ws');
const ADMIN_SECRET=process.env.ADMIN_SECRET||'';
function validSecret(value){if(!ADMIN_SECRET||typeof value!=='string'||value.length>256)return false;const a=crypto.createHash('sha256').update(value).digest(),b=crypto.createHash('sha256').update(ADMIN_SECRET).digest();return crypto.timingSafeEqual(a,b)}
const PORT=process.env.PORT||3000,root=path.join(__dirname,'public');
// Permanent accounts in Supabase. Secret key is SERVER ONLY (Render Environment).
const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SB_KEY=process.env.SUPABASE_SECRET_KEY||'';
const SB_READY=SB_URL.startsWith('https://')&&SB_KEY.length>15;
if(!SB_READY)console.error('SUPABASE_URL / SUPABASE_SECRET_KEY missing: account creation disabled to prevent data loss');
function digestPassword(password,salt){return crypto.scryptSync(password,salt,64).toString('hex')}
function verifyPassword(password,stored){
 const bits=String(stored||'').split(':');if(bits.length!==3||bits[0]!=='scrypt')return false;
 try{const a=Buffer.from(digestPassword(password,bits[1]),'hex'),b=Buffer.from(bits[2],'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b)}catch{return false}
}
async function sbRequest(method,endpoint,body){
 if(!SB_READY)throw Error('База аккаунтов не подключена. Проверь настройки Render');
 const response=await fetch(SB_URL+'/rest/v1/'+endpoint,{method,headers:{'apikey':SB_KEY,...(SB_KEY.startsWith('sb_secret_')?{}:{'Authorization':'Bearer '+SB_KEY}),'Content-Type':'application/json','Prefer':'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
 const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data=raw}
 if(!response.ok){let e=new Error('Supabase '+response.status);e.status=response.status;e.code=data?.code;throw e}
 return data;
}
async function getAccount(key){let rows=await sbRequest('GET','game_accounts?username_key=eq.'+encodeURIComponent(key)+'&select=id,username,password_hash&limit=1');return rows[0]||null}
const TOKEN_KEY=crypto.createHash('sha256').update('uzc-account-token-v311:'+SB_KEY).digest();
function makeToken(acc){const body=Buffer.from(JSON.stringify({id:acc.id,nick:acc.username,exp:Date.now()+90*86400000})).toString('base64url');const sig=crypto.createHmac('sha256',TOKEN_KEY).update(body).digest('base64url');return body+'.'+sig}
function parseToken(token){if(typeof token!=='string'||token.length>2048)return null;const parts=token.split('.');if(parts.length!==2)return null;const signature=crypto.createHmac('sha256',TOKEN_KEY).update(parts[0]).digest('base64url');const a=Buffer.from(signature),b=Buffer.from(parts[1]);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;try{const obj=JSON.parse(Buffer.from(parts[0],'base64url').toString());return obj.exp>Date.now()&&typeof obj.id==='string'?obj:null}catch{return null}}
const ADMIN_NAMES=new Set(['ogurchiksem5','pro666_kirill666']);
function isGameAdmin(p){return !!p.accountKey&&ADMIN_NAMES.has(String(p.nick||'').toLowerCase())}
function adminRoom(p){let r=parties.get(p.party);return r?.running?r:null}
function loginAccount(p,acc){if(p.nick)leave(p);p.nick=acc.username;p.accountKey=acc.id;p.admin=isGameAdmin(p);p.token=makeToken(acc);send(p,{type:'authOK',nick:acc.username,token:p.token,gameAdmin:p.admin})}

const server=http.createServer((req,res)=>{let file=req.url.split('?')[0];file=file==='/'?'/index.html':file;if(file==='/solo.html'){res.writeHead(302,{Location:'/index.html'});return res.end()}let full=path.resolve(root,'.'+decodeURIComponent(file));if(!full.startsWith(root+path.sep)){res.writeHead(403);return res.end()}fs.readFile(full,(e,data)=>{if(e){res.writeHead(404);return res.end('Not found')}res.setHeader('Content-Type',full.endsWith('.html')?'text/html':full.endsWith('.js')?'application/javascript':'text/plain');res.end(data)})});
const wss=new WebSocketServer({server});const players=new Map(),parties=new Map(),invites=new Map();let nextId=1;
const guns=[{name:'Pistol',cost:0,damage:15,rate:3.5,mag:12},{name:'SMG',cost:1500,damage:9,rate:11,mag:35},{name:'Shotgun',cost:3500,damage:12,rate:1.4,mag:8,pellets:6},{name:'AK-47',cost:7500,damage:22,rate:7,mag:30},{name:'Minigun',cost:20000,damage:12,rate:19,mag:150}];const prices=[5000,15000,30000],rewards={green:100,blue:200,red:750,cyan:300,yellow:240,purple:950,armor:1100,duo:450,duoMini:50,shadow:400};
function send(p,obj){if(p.ws.readyState===1)p.ws.send(JSON.stringify(obj))}function fail(p,msg){send(p,{type:'error',message:msg})}function partyState(party){let members=party.ids.map(id=>players.get(id)).filter(Boolean);members.forEach(p=>send(p,{type:'party',code:party.code,host:party.host,members:members.map(m=>({id:m.id,nick:m.nick})),running:party.running}))}function newParty(host){let code;do{code=Math.random().toString(36).slice(2,8).toUpperCase()}while(parties.has(code));let party={code,host:host.id,ids:[host.id],running:false,wave:1,remaining:0,spawnClock:0,nextWave:-1,zombies:[],bombs:[],slime:[],seq:0,doors:{storage:false,courtyard:false}};parties.set(code,party);host.party=code;partyState(party);return party}function leave(p){let party=parties.get(p.party);if(!party)return;party.ids=party.ids.filter(id=>id!==p.id);p.party=null;if(!party.ids.length)parties.delete(party.code);else{if(party.host===p.id)party.host=party.ids[0];partyState(party)}}function join(p,party){if(p.party)leave(p);if(party.running)return fail(p,'Матч уже начался');if(party.ids.length>=4)return fail(p,'Комната заполнена');party.ids.push(p.id);p.party=party.code;partyState(party)}function aliveMembers(room){return room.ids.map(id=>players.get(id)).filter(p=>p&&p.hp>0)}function begin(room){room.running=true;room.wave=1;room.zombies=[];room.bombs=[];room.slime=[];room.bots=[];room.nextWave=-1;room.remaining=0;room.doors={storage:false,courtyard:false};for(let i=0;i<room.ids.length;i++){let p=players.get(room.ids[i]);if(!p)continue;Object.assign(p,{x:330+i*34,y:260,zone:0,portalCooldown:0,perks:{extra:false,bigg:false,illusion:false,lessblood:false},illusionClock:3,maxHp:100,hp:100,cash:0,kills:0,gun:0,ammo:12,owned:guns.map((_,i)=>i===0),levels:guns.map(()=>0),cool:0,reload:0,inv:0,downed:0,reviveBy:null,reviveProgress:0,downedFinished:false,streak:0,streakTime:0,aim:0,moveX:0,moveY:0,fire:false,god:false,aimbot:false,adminSpeed:205,adminDamage:0,skin:'#69b8ee',zombieSkin:false});send(p,{type:'started'})}startWave(room)}function startWave(room){room.remaining=(6+room.wave*5+Math.floor(room.wave*room.wave*.25))*Math.max(1,room.ids.length)*(1+0.25*Object.values(room.doors||{}).filter(Boolean).length);room.spawnClock=.2;room.nextWave=-1}function spawn(room){let types=['green'];if(room.wave>=3)types.push('blue');if(room.wave>=5)types.push('red');if(room.wave>=7)types.push('cyan');if(room.wave>=10)types.push('yellow');if(room.wave>=14)types.push('purple');if(room.wave>=8)types.push('armor');if(room.wave>=10)types.push('duo');if(room.wave>=12)types.push('shadow');let type=types[Math.floor(Math.random()*types.length)];if(room.wave>=5&&room.seq%6===0)type='red';let edge=Math.floor(Math.random()*4),x=edge===0?20:edge===1?740:Math.random()*760,y=edge===2?20:edge===3?520:Math.random()*540;let hp=(30+room.wave*9)*Math.pow(1.14,Math.max(0,room.wave-1))*({green:1,blue:.7,red:3,cyan:1.2,yellow:.48,purple:3.6,armor:3.5,duo:1.5,shadow:1.2}[type]);let active=aliveMembers(room),zones=[...new Set(active.map(p=>p.zone||0))];let zone=zones.length?zones[Math.floor(Math.random()*zones.length)]:0;room.zombies.push({id:++room.seq,x,y,zone,type,hp,max:hp,r:{green:12,blue:11,red:18,cyan:13,yellow:10,purple:19,armor:18,duo:15,shadow:12}[type],speed:(60+Math.min(room.wave,15)*3)*({green:1,blue:1.7,red:.65,cyan:.9,yellow:2.35,purple:.52,armor:.68,duo:.82,shadow:1.9}[type]),bombTimer:2+Math.random()*2,chargeState:0,chargeClock:2+Math.random()*2,chargeDX:0,chargeDY:0,chargeHit:false,slimeClock:1.2+Math.random()*2})}function hitWall(x,y,r){return x<r+4||x>760-r-4||y<r+4||y>540-r-4||[{x:185,y:120,w:100,h:35},{x:470,y:325,w:95,h:38},{x:80,y:345,w:55,h:80},{x:580,y:95,w:60,h:70},{x:315,y:415,w:100,h:40}].some(o=>x+r>o.x&&x-r<o.x+o.w&&y+r>o.y&&y-r<o.y+o.h)}function moveEntity(e,dx,dy,r){if(!hitWall(e.x+dx,e.y,r))e.x+=dx;if(!hitWall(e.x,e.y+dy,r))e.y+=dy}function keepZombiesOutsidePlayers(room,members){
 for(const z of room.zombies){for(const p of members){if(p.hp<=0||p.zone!==z.zone)continue;
  let dx=z.x-p.x,dy=z.y-p.y,d=Math.hypot(dx,dy),minimum=z.r+12+1;
  if(d>=minimum)continue;
  if(d<.001){dx=1;dy=0;d=1;}
  const nx=p.x+dx/d*minimum,ny=p.y+dy/d*minimum;
  if(!hitWall(nx,ny,z.r)){z.x=nx;z.y=ny;}
  else { // Move player out only if the zombie is pinned against a wall.
   const px=z.x-dx/d*minimum,py=z.y-dy/d*minimum;
   if(!hitWall(px,py,12)){p.x=px;p.y=py;}
  }
 }}
}
function kill(room,z,killer){let index=room.zombies.indexOf(z);if(index<0)return;room.zombies.splice(index,1);if(z.type==='duo'){for(let i=0;i<3;i++){const a=i*Math.PI*2/3;room.zombies.push({id:++room.seq,x:Math.max(25,Math.min(735,z.x+Math.cos(a)*24)),y:Math.max(25,Math.min(515,z.y+Math.sin(a)*24)),zone:z.zone,type:'duoMini',hp:Math.max(12,z.max*.045),max:Math.max(12,z.max*.045),r:7,speed:z.speed*2.3,slimeClock:99});}}killer.streak=killer.streakTime>0?killer.streak+1:1;killer.streakTime=5;let earned=Math.round(rewards[z.type]*(killer.streak>=2?1.05:1));killer.cash+=earned;killer.kills++;room.ids.forEach(id=>{let p=players.get(id);if(p)send(p,{type:'kill',zone:z.zone,x:z.x,y:z.y,earned,killer:killer.id})})}
let broadcastClock=0;function tick(dt){broadcastClock+=dt;const broadcast=broadcastClock>=.10;if(broadcast)broadcastClock=0;for(let room of parties.values()){if(!room.running)continue;let members=room.ids.map(id=>players.get(id)).filter(Boolean);if(!members.length)continue;for(let p of members){p.cool=Math.max(0,p.cool-dt);p.inv=Math.max(0,p.inv-dt);if(room.nextWave<0){p.streakTime=Math.max(0,p.streakTime-dt);if(!p.streakTime)p.streak=0;}if(p.upgradeTimer>0){p.upgradeTimer-=dt;if(p.upgradeTimer<=0){p.levels[p.upgradeGun]++;room.ids.forEach(id=>{const q=players.get(id);if(q)send(q,{type:'upgraded',id:p.id,level:p.levels[p.upgradeGun],x:p.x,y:p.y})});p.upgradeTimer=0;}}if(p.reload>0){p.reload-=dt;if(p.reload<=0)p.ammo=guns[p.gun].mag*(p.perks?.extra?2:1)}if(p.hp<=0){if(p.downed>0){p.downed-=dt;if(p.downed<=0){p.downed=0;p.reviveBy=null;p.reviveProgress=0}}continue;}p.portalCooldown=Math.max(0,(p.portalCooldown||0)-dt);let len=Math.hypot(p.moveX,p.moveY)||1;const oldPX=p.x,oldPY=p.y;
const slow=room.slime.some(q=>q.zone===p.zone&&Math.hypot(q.x-p.x,q.y-p.y)<q.r)?0.5:1;moveEntity(p,p.moveX/len*(p.adminSpeed||205)*slow*dt,0,12);
if(room.zombies.some(z=>z.zone===p.zone&&Math.hypot(z.x-p.x,z.y-p.y)<z.r+12)){p.x=oldPX;}
moveEntity(p,0,p.moveY/len*(p.adminSpeed||205)*slow*dt,12);
if(room.zombies.some(z=>z.zone===p.zone&&Math.hypot(z.x-p.x,z.y-p.y)<z.r+12)){p.y=oldPY;}
// Crossing an unlocked doorway is automatic. All zones share screen coordinates,
// but have independent zombie populations and player positions.
if(false&&p.portalCooldown<=0&&p.x>305&&p.x<455){
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
if(p.aimbot&&p.fire){let target=room.zombies.filter(z=>z.zone===p.zone).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];if(target)p.aim=Math.atan2(target.y-p.y,target.x-p.x)}
if(p.fire&&p.cool<=0&&p.reload<=0){let g=guns[p.gun];if(p.ammo<=0){p.reload=g.name==='Minigun'?3:1.4;continue}p.ammo--;p.cool=1/(g.rate*[1,1.1,1.25,1.4][p.levels[p.gun]]);let level=p.levels[p.gun]||0;
let count=p.gun===2&&level>=1?4:(g.pellets||1);
let shotgunHits=0;
for(let j=0;j<count;j++){
 const angle=p.aim+(Math.random()-.5)*(count>1?.6:.05),vx=Math.cos(angle),vy=Math.sin(angle);
 const ox=p.x+vx*36,oy=p.y+vy*36;
 let wallDist=650;
 for(let distance=5;distance<=650;distance+=5){if(hitWall(ox+vx*distance,oy+vy*distance,2)){wallDist=distance;break}}
 const collisions=[];
 for(const z of room.zombies){if(z.zone!==p.zone)continue;
  const dx=z.x-ox,dy=z.y-oy,projection=dx*vx+dy*vy,lateral=Math.abs(dx*vy-dy*vx),radius=z.r+3;
  if(projection>=0&&lateral<radius){const contact=Math.max(0,projection-Math.sqrt(radius*radius-lateral*lateral));if(contact<wallDist)collisions.push({z,contact})}
 }
 collisions.sort((a,b)=>a.contact-b.contact);
 const explosive=p.gun===0&&level>=1;
 const piercing=level>=1&&(p.gun===2);
 const hitLimit=p.gun===2?Math.min(2,8-shotgunHits):(piercing?Math.min(8,level+2):1);
 const hitTargets=collisions.slice(0,Math.max(0,hitLimit));
 let impactDistance=hitTargets.length&&!piercing?hitTargets[0].contact:wallDist;
 if(piercing&&hitTargets.length)impactDistance=Math.min(wallDist,hitTargets[hitTargets.length-1].contact+25);
 const impactX=ox+vx*impactDistance,impactY=oy+vy*impactDistance;
 if(explosive){
  const blastRadius=[0,90,120,155][level],blastDamage=[0,95,145,210][level];
  for(const target of [...room.zombies]){if(target.zone!==p.zone)continue;const d=Math.hypot(target.x-impactX,target.y-impactY);
   if(d<=blastRadius+target.r){target.hp-=Math.max(1,Math.round((blastDamage+(p.adminDamage||0))*(p.perks?.bigg?1.5:1)*(1-.35*Math.min(1,d/blastRadius))));if(target.hp<=0)kill(room,target,p)}
  }
 }else{
  const multiplier=level>=1&&p.gun===2?1.55:1;
  for(const item of hitTargets){if(!room.zombies.includes(item.z))continue;
   item.z.hp-=(g.damage*[1,1.15,1.3,1.5][level]*multiplier+(p.adminDamage||0))*(p.perks?.bigg?1.5:1)*(item.z.type==='armor'?(p.gun===0?.2:level===3&&[1,2,3,4].includes(p.gun)?35:.4):1);
   if(item.z.hp<=0)kill(room,item.z,p);
  }
  if(p.gun===2)shotgunHits+=hitTargets.length;
 }
 for(const id of room.ids){const other=players.get(id);if(other)send(other,{type:'shot',zone:p.zone,id:p.id,x:ox,y:oy,aim:angle,level,gun:p.gun,endX:impactX,endY:impactY,explosive,hit:hitTargets.length>0})}
}
}}if(room.remaining>0){room.spawnClock-=dt;if(room.spawnClock<=0){if(room.zombies.length<90){spawn(room);room.remaining--;}room.spawnClock=Math.max(.22,.65-room.wave*.016)}}for(let z of room.zombies){let target=null,best=Infinity;for(let p of members){if(p.hp<=0||p.zone!==z.zone)continue;let d=Math.hypot(p.x-z.x,p.y-z.y);if(d<best){best=d;target=p}}if(!target)continue;let dx=(target.x-z.x)/(best||1),dy=(target.y-z.y)/(best||1);if(z.type==='purple'){
 if(z.chargeState===0){z.chargeClock-=dt;if(z.chargeClock<=0&&best<380){z.chargeState=1;z.chargeClock=1.15;z.chargeDX=dx;z.chargeDY=dy;}}
 else if(z.chargeState===1){z.chargeClock-=dt;dx=0;dy=0;if(z.chargeClock<=0){z.chargeState=2;z.chargeClock=.48;z.chargeHit=false;}}
 else if(z.chargeState===2){z.chargeClock-=dt;dx=z.chargeDX;dy=z.chargeDY;const oldX=z.x,oldY=z.y;moveEntity(z,dx*500*dt,dy*500*dt,z.r);if(!z.chargeHit){for(const victim of members){if(victim.hp<=0||victim.zone!==z.zone||victim.inv>0)continue;const vx=victim.x-oldX,vy=victim.y-oldY,travel=Math.hypot(z.x-oldX,z.y-oldY);const projection=Math.max(0,Math.min(travel,vx*dx+vy*dy));if(Math.hypot(victim.x-(oldX+dx*projection),victim.y-(oldY+dy*projection))<z.r+12){victim.hp=Math.max(0,victim.hp-50);victim.inv=.7;z.chargeHit=true;break;}}}if(z.chargeClock<=0||Math.hypot(z.x-oldX,z.y-oldY)<1){z.chargeState=0;z.chargeClock=3.5+Math.random()*1.5;}continue;}
 if(z.chargeState===1){dx=0;dy=0;}
}
if(z.type==='shadow'){z.slimeClock=(z.slimeClock||2)-dt;if(z.slimeClock<=0){room.slime.push({x:z.x,y:z.y,zone:z.zone,t:5,r:33});z.slimeClock=2+Math.random()*3;}}if(z.type==='cyan'){z.bombTimer-=dt;if(best<330&&z.bombTimer<=0){room.bombs.push({zone:z.zone,x:target.x,y:target.y,t:1.4,r:49});z.bombTimer=3+Math.random()*1.5}if(best<170){dx=-dx;dy=-dy}else if(best<240){dx=0;dy=0}}moveEntity(z,dx*z.speed*dt,dy*z.speed*dt,z.r);if(best<z.r+13&&target.inv<=0&&z.chargeState!==1){target.hp=Math.max(0,target.hp-(target.god?0:(z.type==='red'?22:12)));target.inv=.65}}keepZombiesOutsidePlayers(room,members);
// Spatial hash: only resolve overlaps in nearby cells (not every pair on the map).
const cells=new Map(),cellSize=45;
for(let i=0;i<room.zombies.length;i++){let z=room.zombies[i],cx=Math.floor(z.x/cellSize),cy=Math.floor(z.y/cellSize),key=cx+','+cy;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i)}
for(let i=0;i<room.zombies.length;i++){let a=room.zombies[i],cx=Math.floor(a.x/cellSize),cy=Math.floor(a.y/cellSize);for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){let near=cells.get((cx+ox)+','+(cy+oy));if(!near)continue;for(let j of near){if(j<=i)continue;let b=room.zombies[j];if(b.zone!==a.zone)continue;let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),min=a.r+b.r+1;if(d<min){if(d<.001){dx=.7;dy=.7;d=Math.hypot(dx,dy)}let n=Math.min(7,(min-d)*.5),ux=dx/d,uy=dy/d;moveEntity(a,-ux*n,-uy*n,a.r);moveEntity(b,ux*n,uy*n,b.r)}}}}
keepZombiesOutsidePlayers(room,members);
for(const bot of (room.bots||[])){
 const owner=players.get(bot.owner);if(!owner||owner.hp<=0){bot.hp=0;continue}
 if(bot.zone!==owner.zone){bot.zone=owner.zone;bot.x=owner.x+22;bot.y=owner.y+22;}const ox=owner.x+28,oy=owner.y+24;
 const gap=Math.hypot(bot.x-ox,bot.y-oy);
 if(gap>20){const step=Math.min(gap,165*dt),oldX=bot.x,oldY=bot.y;moveEntity(bot,(ox-bot.x)/gap*step,(oy-bot.y)/gap*step,11);
  if(Math.hypot(bot.x-oldX,bot.y-oldY)<.15){bot.stuck=(bot.stuck||0)+dt;for(const [vx,vy] of [[0,step],[step,0],[0,-step],[-step,0]]){if(!hitWall(bot.x+vx,bot.y+vy,11)){bot.x+=vx;bot.y+=vy;break;}}}else bot.stuck=0;
  if(bot.stuck>2.5){const candidates=[[22,22],[-22,22],[22,-22],[-22,-22],[0,35],[35,0]];for(const [x,y] of candidates){if(!hitWall(owner.x+x,owner.y+y,11)){bot.x=owner.x+x;bot.y=owner.y+y;break;}}bot.stuck=0;}
 }
 bot.cool=Math.max(0,bot.cool-dt);
 const target=room.zombies.filter(z=>z.zone===bot.zone).sort((a,b)=>Math.hypot(a.x-bot.x,a.y-bot.y)-Math.hypot(b.x-bot.x,b.y-bot.y))[0];
 if(target&&Math.hypot(target.x-bot.x,target.y-bot.y)<320&&bot.cool<=0){
  const weapon=guns[bot.gun];bot.cool=1/Math.max(.4,weapon.rate*[1,1.1,1.25,1.4][bot.level]);
  const hit=(weapon.damage*[1,1.15,1.3,1.5][bot.level])*(bot.gun===2?3:1);
  target.hp-=hit*(target.type==='armor'?(bot.gun===0?.2:bot.level===3?35:.4):1);bot.aim=Math.atan2(target.y-bot.y,target.x-bot.x);
  if(target.hp<=0)kill(room,target,owner);
  for(const id of room.ids){let q=players.get(id);if(q)send(q,{type:'botShot',zone:bot.zone,x:bot.x,y:bot.y,endX:target.x,endY:target.y})}
 }
 // Zombies near the bot attack it instead of walking through it.
 for(const z of room.zombies){if(z.zone===bot.zone&&Math.hypot(z.x-bot.x,z.y-bot.y)<z.r+11){bot.hp-=12*dt;}}
 }
 room.bots=(room.bots||[]).filter(b=>b.hp>0);
 for(const q of members){if(q.hp<=0&&q.downed===0&&!q.downedFinished){q.downed=room.ids.length>1?10:0;q.downedFinished=true;}}for(let i=room.slime.length-1;i>=0;i--){if((room.slime[i].t-=dt)<=0)room.slime.splice(i,1)}for(let i=room.bombs.length-1;i>=0;i--){let b=room.bombs[i];b.t-=dt;if(b.t<=0){for(let p of members)if(p.hp>0&&p.zone===b.zone&&p.inv<=0&&Math.hypot(p.x-b.x,p.y-b.y)<b.r+12){p.hp=Math.max(0,p.hp-(p.god?0:24));p.inv=.6}room.bombs.splice(i,1)}}if(room.remaining===0&&!room.zombies.length){if(room.nextWave<0){room.nextWave=5;members.forEach(p=>send(p,{type:'waveclear',wave:room.wave}))}else if((room.nextWave-=dt)<=0){room.wave++;startWave(room)}}if(members.every(p=>p.hp<=0&&p.downed<=0)){room.running=false;members.forEach(p=>send(p,{type:'gameover',wave:room.wave}));partyState(room)}if(broadcast){const sharedZ=room.zombies.map(z=>({id:z.id,x:Math.round(z.x),y:Math.round(z.y),type:z.type,hp:Math.round(z.hp),max:z.max,r:z.r,zone:z.zone,chargeState:z.chargeState||0,chargeClock:z.chargeClock||0,chargeDX:z.chargeDX||0,chargeDY:z.chargeDY||0}));const sharedP=members.map(q=>({id:q.id,nick:q.nick,x:Math.round(q.x),y:Math.round(q.y),hp:q.hp,zone:q.zone,gun:q.gun,level:q.levels[q.gun],aim:q.aim,maxHp:q.maxHp||100,skin:q.skin||'#69b8ee',zombieSkin:!!q.zombieSkin,god:!!q.god,downed:Math.max(0,q.downed||0),reviveProgress:q.reviveProgress||0}));room.ids.forEach(id=>{let p=players.get(id);if(p&&p.ws.bufferedAmount<180000)send(p,{type:'state',wave:room.wave,remaining:room.remaining,zombies:sharedZ,bots:(room.bots||[]).map(b=>({id:b.id,x:Math.round(b.x),y:Math.round(b.y),zone:b.zone,nick:b.nick,hp:Math.round(b.hp),maxHp:b.maxHp,gun:b.gun,level:b.level,aim:b.aim||0})),bombs:room.bombs,slime:room.slime,doors:room.doors,players:sharedP,cash:p.cash,kills:p.kills,ammo:p.ammo,gun:p.gun,levels:p.levels,owned:p.owned,hp:p.hp,maxHp:p.maxHp||100,streak:p.streak,streakTime:p.streakTime,perks:p.perks,nextWave:room.nextWave,admin:{god:!!p.god,aimbot:!!p.aimbot,speed:p.adminSpeed||205,damage:p.adminDamage||0,skin:p.skin||'#69b8ee',zombieSkin:!!p.zombieSkin}})})}}}
setInterval(()=>tick(1/30),1000/30);
wss.on('connection',ws=>{let p={id:nextId++,ws,nick:null,party:null};players.set(p.id,p);send(p,{type:'hello',id:p.id});ws.on('message',async raw=>{if(raw.length>4000)return;let m;try{m=JSON.parse(raw)}catch{return}if(m.type==='adminAction'){
 if(!isGameAdmin(p))return fail(p,'Нет прав администратора');
 const room=adminRoom(p),action=String(m.action||'');
 if(!room)return fail(p,'Админ-команды доступны во время матча');
 const n=Number(m.value);
 if(action==='god')p.god=!!m.value;
 else if(action==='aimbot')p.aimbot=!!m.value;
 else if(action==='zombie')p.zombieSkin=!!m.value;
 else if(action==='heal')p.hp=p.maxHp||100;
 else if(action==='clearZombies'){room.zombies=[];room.bombs=[];}
 else if(action==='skipWave'){room.zombies=[];room.remaining=0;room.nextWave=.1;}
 else if(action==='revive'){for(const id of room.ids){const q=players.get(id);if(q&&q.hp<=0){q.hp=q.maxHp||100;q.inv=2;}}}
 else if(action==='speed'){if(!Number.isFinite(n))return;p.adminSpeed=Math.max(205,Math.min(300,Math.round(n)))}
 else if(action==='damage'){if(!Number.isFinite(n))return;p.adminDamage=Math.max(0,Math.min(100000,Math.round(n)))}
 else if(action==='cash'){if(!Number.isFinite(n))return;p.cash=Math.min(100000000,p.cash+Math.max(0,Math.min(1000000,Math.floor(n))))}
 else if(action==='skin'){if(typeof m.value!=='string'||!/^#[0-9a-fA-F]{6}$/.test(m.value))return;p.skin=m.value}
 else if(action==='weapon'){const i=Math.floor(n);if(i<0||i>=guns.length)return;p.owned[i]=true;p.gun=i;p.ammo=guns[i].mag*(p.perks?.extra?2:1)}
 else if(action==='level'){const i=p.gun;p.levels[i]=Math.max(0,Math.min(3,Math.floor(n)||0))}
 else if(action==='perk'){if(!['extra','bigg','illusion','lessblood'].includes(m.value))return;p.perks[m.value]=true;if(m.value==='lessblood'){p.maxHp=150;p.hp=150}if(m.value==='extra')p.ammo=guns[p.gun].mag*2}
 else if(action==='bot'){
  const data=m.bot||{};if((room.bots||[]).filter(b=>b.owner===p.id).length>=2)return fail(p,'Максимум 2 напарника');
  const nick=String(data.nick||'Buddy').trim().slice(0,20).replace(/[^\p{L}\p{N}_ -]/gu,'')||'Buddy';
  const hp=Math.max(50,Math.min(10000,Math.floor(Number(data.hp)||300)));
  const gun=Math.max(0,Math.min(guns.length-1,Math.floor(Number(data.gun)||0)));
  const level=Math.max(0,Math.min(3,Math.floor(Number(data.level)||0)));
  room.bots=room.bots||[];room.bots.push({id:crypto.randomUUID(),owner:p.id,nick,hp,maxHp:hp,gun,level,x:p.x+24,y:p.y+24,zone:p.zone,cool:0,aim:0});
 }else if(action==='removeBots'){room.bots=(room.bots||[]).filter(b=>b.owner!==p.id)}
 else return;
 send(p,{type:'adminActionOK',action});return;
}
if(m.type==='authCreate'||m.type==='authLogin'||m.type==='authResume'){
 if(p.authBusy)return fail(p,'Подожди завершения входа');p.authBusy=true;
 try{
  if(!SB_READY)return fail(p,'База аккаунтов не подключена. Сообщи владельцу игры');
  if(m.type==='authResume'){
   const session=parseToken(m.token);if(!session)return fail(p,'Сессия истекла, войди снова');
   const rows=await sbRequest('GET','game_accounts?id=eq.'+encodeURIComponent(session.id)+'&select=id,username,password_hash&limit=1');
   if(!rows.length)return fail(p,'Аккаунт не найден, войди с паролем');
   loginAccount(p,rows[0]);return;
  }
  const nick=String(m.nick||'').trim(),key=nick.toLowerCase(),password=String(m.password||'');
  if(!/^[\p{L}\p{N}_-]{3,16}$/u.test(nick))return fail(p,'Ник: 3–16 букв, цифр, _ или -');
  if(password.length<8||password.length>128)return fail(p,'Пароль: от 8 до 128 символов');
  if(m.type==='authCreate'){
   if(await getAccount(key))return fail(p,'Ник занят. Выбери другой');
   const salt=crypto.randomBytes(16).toString('hex');
   let created;
   try{created=await sbRequest('POST','game_accounts?select=id,username,password_hash',{username:nick,password_hash:'scrypt:'+salt+':'+digestPassword(password,salt)})}
   catch(e){if(e.code==='23505'||e.status===409)return fail(p,'Ник занят. Выбери другой');throw e}
   loginAccount(p,created[0]);return;
  }
  const acc=await getAccount(key);
  if(!acc||!verifyPassword(password,acc.password_hash))return fail(p,'Неверный ник или пароль');
  loginAccount(p,acc);return;
 }catch(e){console.error('Account auth error:',e.message);return fail(p,'Не удалось подключиться к базе аккаунтов. Попробуй позже')}
 finally{p.authBusy=false}
}
if(m.type==='authLogout'){
 // Browser discards its signed token; token expires after 90 days.
 leave(p);p.nick=null;p.accountKey=null;p.token=null;p.admin=false;send(p,{type:'authLoggedOut'});return;
}
if(!p.accountKey)return fail(p,'Сначала войди в аккаунт');if(m.type==='create'){leave(p);newParty(p)}if(m.type==='join'){let room=parties.get(String(m.code||'').toUpperCase());if(!room)return fail(p,'Комната не найдена');join(p,room)}if(m.type==='invite'){let target=[...players.values()].find(q=>q.nick?.toLowerCase()===String(m.nick||'').toLowerCase());if(!target)return fail(p,'Игрок не в сети');let room=parties.get(p.party);if(!room)return fail(p,'Сначала создай парти');invites.set(target.id,room.code);send(target,{type:'invite',from:p.nick,code:room.code});send(p,{type:'info',message:'Приглашение отправлено'})}if(m.type==='accept'){let code=invites.get(p.id);if(!code)return fail(p,'Приглашение истекло');let room=parties.get(code);if(!room)return fail(p,'Комната закрыта');invites.delete(p.id);join(p,room)}if(m.type==='leave'){leave(p);send(p,{type:'left'})}if(m.type==='start'){let room=parties.get(p.party);if(!room||room.host!==p.id)return fail(p,'Только лидер запускает матч');if(room.running)return;begin(room)}if(m.type==='input'){p.moveX=Math.max(-1,Math.min(1,Number(m.x)||0));p.moveY=Math.max(-1,Math.min(1,Number(m.y)||0));p.aim=Number(m.aim)||0;p.fire=!!m.fire}if(m.type==='portal'){
 const room=parties.get(p.party);if(!room?.running||p.hp<=0||p.portalCooldown>0)return;
 if(p.x<270||p.x>490)return fail(p,'Подойди к центру двери');
 let destination=null;
 if(p.zone===0&&p.y<110&&room.doors.storage)destination=1;
 else if(p.zone===0&&p.y>430&&room.doors.courtyard)destination=2;
 else if(p.zone===1&&p.y>430)destination=0;
 else if(p.zone===2&&p.y<110)destination=0;
 if(destination===null)return fail(p,'Дверь закрыта или слишком далеко');
 const previous=p.zone;p.zone=destination;p.y=(destination===1||previous===2)?485:55;
 if(destination===2||previous===1)p.y=(destination===2)?55:55;
 if(destination===0&&previous===2)p.y=485;
 p.portalCooldown=1.1;
 // In solo online rooms, the entire horde pursues the only player. With several players,
 // rebalance only half the horde so both active zones remain dangerous.
 const living=aliveMembers(room);const count=living.length<=1?room.zombies.length:Math.floor(room.zombies.length*.5);
 const candidates=room.zombies.filter(z=>z.zone===previous).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
 for(const z of candidates.slice(0,count)){z.zone=destination;z.x=Math.max(24,Math.min(736,z.x));z.y=destination===1?Math.max(40,z.y-30):destination===2?Math.min(500,z.y+30):z.y;}
 send(p,{type:'zone',zone:destination,x:p.x,y:p.y});return;
 }
 if(m.type==='door'){
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
 if(m.type==='reviveHold'){const room=parties.get(p.party);if(!room?.running||p.hp<=0)return;const q=players.get(Number(m.target));if(!q||q.party!==p.party||q.hp>0||q.downed<=0||q.zone!==p.zone||Math.hypot(p.x-q.x,p.y-q.y)>75)return;const now=Date.now();if(q.reviveBy!==p.id||now-(q.reviveLast||0)>350)q.reviveProgress=0;if(now-(q.reviveLast||0)<80)return;q.reviveBy=p.id;q.reviveLast=now;q.reviveProgress=(q.reviveProgress||0)+.1;if(q.reviveProgress>=2){q.hp=Math.max(35,Math.round(q.maxHp*.5));q.inv=2;q.downed=0;q.downedFinished=false;q.reviveProgress=0;q.reviveBy=null;q.cash=Math.floor(q.cash/2);q.perks={extra:false,bigg:false,illusion:false,lessblood:false};q.maxHp=100;send(q,{type:'revived'});}}
 if(m.type==='buy'){let room=parties.get(p.party);if(!room?.running)return;let i=Number(m.index);if(!Number.isInteger(i)||i<0||i>=guns.length)return;if(!p.owned[i]){if(p.cash<guns[i].cost)return fail(p,'Не хватает евро');p.cash-=guns[i].cost;p.owned[i]=true}p.gun=i;p.ammo=guns[i].mag*(p.perks?.extra?2:1);send(p,{type:'purchase',index:i})}if(m.type==='upgrade'){let room=parties.get(p.party),i=Number(m.index);if(!room?.running||!Number.isInteger(i)||i<0||i>=guns.length||!p.owned[i])return;if(p.zone!==2||Math.hypot(p.x-380,p.y-275)>95)return fail(p,'Particle Machine находится во дворе');if(i!==p.gun)return fail(p,'Улучшить можно только оружие в руках');let lv=p.levels[i];if(p.upgradeTimer>0)return fail(p,'Машина ещё работает');if(lv>=3||p.cash<prices[lv])return fail(p,'Не хватает евро');p.cash-=prices[lv];p.upgradeGun=i;p.upgradeTimer=2;} if(m.type==='perk'){
  const room=parties.get(p.party);if(!room?.running||p.hp<=0)return;
  const key=String(m.perk||'');const costs={extra:1000,bigg:1000,illusion:1000,lessblood:1000};const perkPrice=1000+1000*Object.values(p.perks||{}).filter(Boolean).length;
  if(!Object.prototype.hasOwnProperty.call(costs,key))return;if(p.zone!==1||Math.hypot(p.x-380,p.y-275)>95)return fail(p,'Perk Machine находится на складе');
  if(p.perks?.[key])return fail(p,'Этот перк уже куплен');
  if(p.cash<perkPrice)return fail(p,'Не хватает евро');
  p.cash-=perkPrice;p.perks[key]=true;
  if(key==='extra')p.ammo=Math.min(guns[p.gun].mag*2,p.ammo+guns[p.gun].mag);
  if(key==='illusion')p.illusionClock=3;
  if(key==='lessblood'){p.maxHp=150;p.hp=Math.min(150,p.hp+50);}
  send(p,{type:'perkBought',perk:key,cash:p.cash,perks:p.perks});
 }
 if(m.type==='heal'){
 let room=parties.get(p.party);
 if(!room?.running||p.hp<=0)return fail(p,'Лечение доступно только живым игрокам во время матча');
 if(p.hp>=(p.maxHp||100))return fail(p,'Здоровье уже полное');
 if(p.cash<250)return fail(p,'Для лечения нужно €250');
 p.cash-=250;p.hp=Math.min(p.maxHp||100,p.hp+50);
 send(p,{type:'healed',hp:p.hp,cash:p.cash});
 }
 if(m.type==='reload'&&p.ammo<guns[p.gun].mag*(p.perks?.extra?2:1)&&p.reload<=0)p.reload=1.4});ws.on('close',()=>{leave(p);players.delete(p.id)})});server.listen(PORT,()=>console.log('Until Zombies Come Online: http://localhost:'+PORT));
