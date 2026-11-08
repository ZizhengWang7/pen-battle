import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
import Matter from 'matter-js';
import {BattleServer,secureRoomCode} from '../server/service.ts';
import {handTiming} from '../src/game/hand.ts';
let clockSkew=0;
const server=new BattleServer({graceMs:10000,roomTtlMs:3000,now:()=>Date.now()+clockSkew,creationLimit:100});
const clients=[],allFrames=new Map(),latest=new Map(),rooms=new Map();let groups=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(predicate())return;await delay(10);}assert.fail('Timed out waiting for authoritative state');}
const call=(socket,event,payload)=>new Promise((resolve,reject)=>socket.timeout(3000).emit(event,payload,(error,reply)=>error?reject(error):resolve(reply)));
async function ok(socket,event,payload){const reply=await call(socket,event,payload);assert.equal(reply.ok,true,JSON.stringify(reply));return reply.data;}
async function error(socket,event,payload,code){const reply=await call(socket,event,payload);assert.equal(reply.ok,false);assert.equal(reply.error.code,code,JSON.stringify(reply));}
async function group(name,fn){await fn();groups++;console.log(`✓ ${name}`);}
let url;
async function connect(origin='http://localhost:5173'){
 const socket=io(url,{forceNew:true,transports:['websocket'],reconnection:false,timeout:1500,extraHeaders:{Origin:origin}});clients.push(socket);allFrames.set(socket,[]);
 socket.on('game:snapshot',frame=>{allFrames.get(socket).push(frame);latest.set(socket,frame);});socket.on('room:update',room=>rooms.set(socket,room));
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;
}
function intent(member,frame,fields,id=crypto.randomUUID()){return {roomCode:member.room.code,matchId:frame.matchId,turn:frame.state.turn,actionId:id,...fields};}
function scene(member){return server.rooms.get(member.room.code).match;}
async function settle(socket,turn){await until(()=>latest.get(socket)?.state.phase==='aiming'&&latest.get(socket)?.state.turn===turn);}
async function readyStart(sockets){for(const s of sockets)await ok(s,'room:ready',{ready:true});await ok(sockets[0],'room:start',{});const room=server.rooms.get(rooms.get(sockets[0]).code);if(room.mode==='classic'){/* Stable actor IDs for legacy physics/security fixtures; randomized starts are tested separately. */room.match.match.turnOrder=[0,1,2,3];room.match.match.currentPlayer=0;server.broadcast(room);}await until(()=>sockets.every(s=>latest.get(s)?.state.phase==='aiming'));}
function moveDanger(core,ids){ids.forEach((id,i)=>Matter.Body.setPosition(core.pens[id].body,{x:i%2===0?20:380,y:130+i*125}));}
async function main(){try{
 const port=await server.listen(0,'127.0.0.1');url=`http://127.0.0.1:${port}`;
 const a=[await connect(),await connect(),await connect(),await connect()],members=[];
 let extra=await connect(),b,bMembers=[];
 await group('Real server health and SPA invite routing respond; invalid socket origins are rejected',async()=>{
  assert.equal((await fetch(url+'/health')).status,200);assert.match(await (await fetch(url+'/room/ABC234')).text(),/root/);
  await assert.rejects(()=>connect('https://untrusted.invalid'));
 });
 await group('Cryptographic room creation, nickname validation, joining and four-player capacity',async()=>{
  await error(a[0],'room:create',{nickname:'<script>',mode:'classic'},'invalid_name');await error(a[0],'room:create',{nickname:'a'.repeat(21),mode:'classic'},'invalid_name');
  members[0]=await ok(a[0],'room:create',{nickname:'Alice',mode:'classic'});const code=members[0].room.code;assert.match(code,/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);assert.match(members[0].credential,/^[\w-]{43}$/);assert.notEqual(members[0].credential,code);
  await error(a[1],'room:join',{code,nickname:' alice '},'duplicate_name');await error(a[1],'room:join',{code:'OOOOOO',nickname:'Bob'},'invalid_code');await error(a[1],'room:join',{code:'AAAAAA'===code?'BBBBBB':'AAAAAA',nickname:'Bob'},'room_not_found');
  for(let i=1;i<4;i++)members[i]=await ok(a[i],'room:join',{code:code.toLowerCase(),nickname:['','Bob','玩家三','Delta'][i]});
  await error(extra,'room:join',{code,nickname:'Fifth'},'room_full');assert.equal(server.rooms.get(code).slots.filter(Boolean).length,4);
  for(const m of members)assert.ok(!JSON.stringify(m.room).includes(m.credential));
 });
 await group('Lobby hosts can remove players, revoke credentials and exclude them from room broadcasts',async()=>{
  await error(a[1],'room:kick',{playerId:2},'host_only');await error(a[0],'room:kick',{playerId:0},'invalid_player');await error(a[0],'room:kick',{playerId:4},'invalid_player');
  const oldCredential=members[2].credential;let removed=false;a[2].once('room:removed',()=>{removed=true;});await ok(a[0],'room:kick',{playerId:2});await until(()=>removed);assert.equal(server.rooms.get(members[0].room.code).slots[2],null);
  await error(extra,'room:resume',{code:members[0].room.code,credential:oldCredential},'unauthorized');await error(a[2],'room:ready',{ready:true},'unauthorized');
  members[2]=await ok(a[2],'room:join',{code:members[0].room.code,nickname:'玩家三'});assert.notEqual(members[2].credential,oldCredential);
 });
 await group('Private reconnect identity reclaims a slot and replaces its previous active controller',async()=>{
  await error(extra,'room:resume',{code:members[0].room.code,credential:'x'.repeat(43)},'unauthorized');
  const replacement=await connect(),old=a[2];const reclaimed=await ok(replacement,'room:resume',{code:members[2].room.code,credential:members[2].credential});assert.equal(reclaimed.playerId,2);await until(()=>!old.connected);a[2]=replacement;members[2]=reclaimed;assert.equal(server.rooms.get(reclaimed.room.code).slots.filter(Boolean).length,4);
 });
 await group('Host start is gated on four connected ready players; second independent room starts Evolution',async()=>{
  await error(a[1],'room:start',{},'host_only');await error(a[0],'room:start',{},'not_ready');await readyStart(a);
  await error(extra,'room:join',{code:members[0].room.code,nickname:'Late'},'match_started');
  b=[await connect(),await connect(),await connect(),await connect()];bMembers[0]=await ok(b[0],'room:create',{nickname:'Host B',mode:'evolution'});assert.notEqual(bMembers[0].room.code,members[0].room.code);
  for(let i=1;i<4;i++)bMembers[i]=await ok(b[i],'room:join',{code:bMembers[0].room.code,nickname:`B ${i}`});await readyStart(b);assert.ok(latest.get(b[0]).state.players.every(p=>p.penType===latest.get(b[0]).state.progression[0]));
 });
 await group('Idle matches do not simulate or repeatedly broadcast unchanged snapshots',async()=>{
  const core=scene(members[0]),tick=core.simulationTick,count=allFrames.get(a[0]).length;await delay(150);assert.equal(core.simulationTick,tick);assert.equal(allFrames.get(a[0]).length,count);
  await error(a[0],'room:kick',{playerId:1},'match_started');
 });
 await group('Unauthorized, wrong-room, wrong-turn, stale, malformed and forged action payloads are rejected',async()=>{
  const f=latest.get(a[0]),base=intent(members[0],f,{kind:'shake'});
  await error(extra,'game:action',base,'unauthorized');await error(a[0],'game:action',{...base,roomCode:bMembers[0].room.code},'wrong_room');await error(a[1],'game:action',base,'wrong_turn');await error(a[0],'game:action',{...base,matchId:'stale'},'stale_match');
  await error(a[0],'game:action',{...base,scores:[5,0,0,0]},'invalid_payload');
  const flick=intent(members[0],f,{kind:'flick',contact:f.pens[0].position,direction:{x:0,y:1},power:.3});
  await error(a[0],'game:action',{...flick,power:2},'invalid_power');await error(a[0],'game:action',{...flick,direction:{x:0,y:2}},'invalid_direction');await error(a[0],'game:action',{...flick,contact:f.pens[1].position},'invalid_contact');
  assert.equal(scene(members[0]).snapshot().turn,1);assert.ok(scene(members[0]).snapshot().players.every(p=>p.score===0));
 });
 await group('Authoritative flick applies at server hand impact; duplicate actions are rejected',async()=>{
  const f=latest.get(a[0]),before={...f.pens[0].position},payload=intent(members[0],f,{kind:'flick',contact:before,direction:{x:0,y:1},power:.3});await ok(a[0],'game:action',payload);await error(a[0],'game:action',payload,'duplicate_action');await error(a[0],'game:action',{...payload,actionId:crypto.randomUUID()},'illegal_phase');
  await settle(a[0],2);assert.ok(latest.get(a[0]).pens[0].position.y>before.y);
  const contact=allFrames.get(a[0]).find(frame=>frame.flick?.contacted&&frame.flick.elapsed===handTiming(.3).impact);assert.ok(contact);assert.deepEqual(contact.pens[0].position,before);assert.ok(contact.pens[0].velocity.y>0);
 });
 await group('Four independent Socket.IO clients receive identical authoritative sequences, with room isolation',async()=>{
  await until(()=>{const frames=allFrames.get(a[0]);return frames.some(f=>a.every(socket=>allFrames.get(socket).some(other=>other.sequence===f.sequence&&other.matchId===f.matchId)));});
  const common=allFrames.get(a[0]).find(f=>a.every(socket=>allFrames.get(socket).some(other=>other.sequence===f.sequence&&other.matchId===f.matchId)));
  for(const socket of a)assert.deepEqual(allFrames.get(socket).find(f=>f.sequence===common.sequence&&f.matchId===common.matchId),common);
  assert.ok(allFrames.get(b[0]).every(f=>f.matchId!==common.matchId));assert.equal(scene(bMembers[0]).snapshot().turn,1);
  const publicText=JSON.stringify(allFrames.get(a[0]));for(const m of members)assert.ok(!publicText.includes(m.credential));
 });
 await group('Server Table Shake eliminates at strike impact, consumes one charge and preserves Classic rules',async()=>{
  const core=scene(members[0]);moveDanger(core,[2]);const f=latest.get(a[1]);await ok(a[1],'game:action',intent(members[1],f,{kind:'shake'}));assert.equal(core.pens[2].fall,null);await settle(a[0],3);
  const result=latest.get(a[0]);assert.equal(result.state.players[1].shakeCharge,0);assert.equal(result.state.players[2].alive,false);assert.equal(result.state.currentPlayer,3);assert.equal(core.engine.world.bodies.length,3);assert.ok(result.state.players.every(p=>p.score===0));
 });
 await group('Evolution multi-kill attribution, self penalty and respawn are synchronized across clients',async()=>{
  const core=scene(bMembers[0]),actor=core.snapshot().currentPlayer,target=core.snapshot().turnOrder[1];core.match.players[actor].score=2;core.match.players[actor].currentPenStage=2;core.match.players[actor].penType=core.match.progression[2];core.replaceUpgrade(actor);moveDanger(core,[actor,target]);
  await ok(b[actor],'game:action',intent(bMembers[actor],latest.get(b[actor]),{kind:'shake'}));await settle(b[0],2);
  const result=latest.get(b[0]);assert.equal(result.state.players[actor].score,3);assert.equal(result.state.players[actor].currentPenStage,2);assert.ok(result.state.players.every(p=>p.alive&&p.respawn==='active'));assert.equal(result.state.players[actor].shakeCharge,0);
  await until(()=>b.every(s=>latest.get(s)?.state.turn===2&&latest.get(s)?.state.phase==='aiming'));for(const socket of b)assert.deepEqual(latest.get(socket).state.players,result.state.players);
  const next=core.snapshot().currentPlayer;core.match.players[next].score=1;core.match.players[next].currentPenStage=2;core.match.players[next].penType=core.match.progression[2];core.replaceUpgrade(next);moveDanger(core,[next]);await ok(b[next],'game:action',intent(bMembers[next],latest.get(b[next]),{kind:'shake'}));await settle(b[0],3);assert.equal(latest.get(b[0]).state.players[next].currentPenStage,1);assert.equal(latest.get(b[0]).state.players[next].score,1);
 });
 await group('Disconnect during an action resolves safely, pauses at the next boundary and reconnects without new identity',async()=>{
  const core=scene(members[0]),actor=core.snapshot().currentPlayer;assert.equal(actor,3);const f=latest.get(a[actor]);await ok(a[actor],'game:action',intent(members[actor],f,{kind:'flick',contact:f.pens[actor].position,direction:{x:0,y:-1},power:.08}));a[actor].disconnect();
  await until(()=>core.snapshot().turn===4&&core.snapshot().phase==='aiming'&&latest.get(a[0])?.paused);const tick=core.simulationTick;await delay(100);assert.equal(core.simulationTick,tick);
  const replacement=await connect();members[actor]=await ok(replacement,'room:resume',{code:members[actor].room.code,credential:members[actor].credential});a[actor]=replacement;assert.equal(members[actor].playerId,actor);await until(()=>!rooms.get(a[0])?.paused);assert.equal(core.snapshot().turn,4);
 });
 await group('Five-pen achievement completion precedes respawns; ready/rematch resets scores, types, charges and match identity',async()=>{
  const core=scene(bMembers[0]),actor=core.snapshot().currentPlayer,target=core.snapshot().turnOrder.find(id=>id!==actor);core.match.players[actor].completedPenKills=core.match.progression.slice(0,4);core.match.players[actor].score=4;core.match.players[actor].currentPenStage=4;core.match.players[actor].penType=core.match.progression[4];core.replaceUpgrade(actor);moveDanger(core,[actor,target]);const oldId=latest.get(b[0]).matchId;
  await ok(b[actor],'game:action',intent(bMembers[actor],latest.get(b[actor]),{kind:'shake'}));await until(()=>latest.get(b[0])?.state.phase==='finished');const result=latest.get(b[0]);assert.equal(result.state.winner,actor);assert.equal(result.state.players[actor].score,5);assert.equal(result.state.players[actor].currentPenStage,3);assert.equal(result.state.players[actor].alive,false);
  await readyStart(b);await until(()=>b.every(socket=>latest.get(socket)?.matchId!==oldId));const fresh=latest.get(b[0]);assert.ok(fresh.state.players.every(p=>p.score===0&&p.currentPenStage===0&&p.shakeCharge===1&&p.alive));assert.equal(fresh.state.winner,null);assert.equal(fresh.state.turn,1);
  await error(b[fresh.state.currentPlayer],'game:action',{...intent(bMembers[fresh.state.currentPlayer],fresh,{kind:'shake'}),matchId:oldId},'stale_match');
 });
 await group('Grace timeout cancels safely to lobby, releases the missing slot and transfers host when needed',async()=>{
  a[0].disconnect();await until(()=>server.rooms.get(members[0].room.code).slots[0]?.connected===false);clockSkew+=11000;await until(()=>server.rooms.get(members[0].room.code).status==='lobby');const room=server.rooms.get(members[0].room.code);assert.equal(room.match,null);assert.equal(room.slots[0],null);assert.notEqual(room.hostId,0);assert.ok(room.slots.every(s=>!s||!s.ready));
  const joined=await ok(extra,'room:join',{code:room.code,nickname:'New host candidate'});assert.equal(joined.playerId,0);assert.equal(server.rooms.get(bMembers[0].room.code).status,'playing');
 });
 await group('Abandoned rooms expire distinctly; payload limits and rate limits do not crash the server',async()=>{
  const lonely=await connect(),membership=await ok(lonely,'room:create',{nickname:'Lonely',mode:'classic'});lonely.disconnect();await until(()=>server.rooms.get(membership.room.code).slots[0]?.connected===false);clockSkew+=11000;await until(()=>!server.rooms.has(membership.room.code));const probe=await connect();await error(probe,'room:join',{code:membership.room.code,nickname:'Late'},'room_expired');
  for(let i=0;i<5;i++)await call(probe,'room:create',null);await error(probe,'room:create',null,'rate_limited');assert.equal((await fetch(url+'/health')).status,200);
 });
 await group('Room and connection limits return friendly capacity errors and free capacity after disconnect',async()=>{
  const limited=new BattleServer({maxRooms:1,maxConnections:3,roomTtlMs:50});const sockets=[];
  try{
   const port=await limited.listen(0,'127.0.0.1'),base=`http://127.0.0.1:${port}`;
   async function client(){const s=io(base,{forceNew:true,transports:['websocket'],reconnection:false});sockets.push(s);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
   const host=await client(),guest=await client();await ok(host,'room:create',{nickname:'Host',mode:'classic'});await error(guest,'room:create',{nickname:'Guest',mode:'classic'},'server_busy');await client();
   const overflow=io(base,{forceNew:true,transports:['websocket'],reconnection:false});sockets.push(overflow);const full=await new Promise(resolve=>overflow.once('server:full',resolve));assert.match(full.message,/已满/);
   await ok(host,'room:leave',{});await until(()=>limited.rooms.size===0);await ok(guest,'room:create',{nickname:'Guest',mode:'classic'});
  }finally{for(const s of sockets)s.disconnect();await limited.close();}
 });
 console.log(`${groups} real online integration groups passed (two rooms, four clients per match).`);
}finally{for(const client of clients)client.disconnect();await server.close();}

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
