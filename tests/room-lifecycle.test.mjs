import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
import {BattleServer} from '../server/service.ts';
let clock=Date.now();
const server=new BattleServer({maxRooms:5,graceMs:60000,roomTtlMs:10000,creationLimit:1000,now:()=>clock}),clients=[];
let url,groups=0;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<500;i++){if(fn())return;await delay(10);}throw Error('Lifecycle state timeout');}
const call=(s,e,p)=>new Promise((resolve,reject)=>s.timeout(3000).emit(e,p,(error,r)=>error?reject(error):resolve(r)));
async function ok(s,e,p={}){const r=await call(s,e,p);assert.ok(r.ok,JSON.stringify(r));return r.data;}
async function bad(s,e,p,code){const r=await call(s,e,p);assert.equal(r.ok,false);assert.equal(r.error.code,code);}
async function connect(){const s=io(url,{forceNew:true,transports:['websocket'],reconnection:false});clients.push(s);s.on('room:update',r=>s.room=r);s.on('game:snapshot',f=>s.frame=f);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
const create=(s,mode='classic',maxPlayers=2)=>ok(s,'room:create',{nickname:'Host',mode,maxPlayers});
async function group(name,fn){await fn();groups++;console.log(`✓ ${name}`);}
async function main(){try{
 url=`http://127.0.0.1:${await server.listen(0,'127.0.0.1')}`;
 await group('Lone host leave immediately deletes lobby, revokes identity and is idempotent',async()=>{
  const host=await connect(),probe=await connect(),m=await create(host),room=server.rooms.get(m.room.code);
  assert.deepEqual(await ok(host,'room:leave'),{left:true,roomDeleted:true});assert.equal(server.rooms.has(room.code),false);
  assert.deepEqual(await ok(host,'room:leave'),{left:true,roomDeleted:false});server.deleteRoom(room);assert.equal(server.members.has(host.id),false);
  await bad(probe,'room:resume',{code:room.code,credential:m.credential},'room_expired');assert.equal(server.io.sockets.adapter.rooms.has(`room:${room.code}`),false);
 });
 await group('Guest leaves, frees a slot, revokes token; host leaves and migrates; final player deletes room',async()=>{
  const host=await connect(),guest=await connect(),replacement=await connect(),m=await create(host);
  const gm=await ok(guest,'room:join',{code:m.room.code,nickname:'Guest'});
  assert.equal((await ok(guest,'room:leave')).roomDeleted,false);await until(()=>host.room.players.length===1);
  await bad(guest,'room:resume',{code:m.room.code,credential:gm.credential},'unauthorized');
  const next=await ok(replacement,'room:join',{code:m.room.code,nickname:'Next'});assert.equal(next.playerId,1);
  await ok(host,'room:leave');await until(()=>replacement.room.hostId===1);assert.equal(replacement.room.players.length,1);
  assert.equal((await ok(replacement,'room:leave')).roomDeleted,true);
 });
 await group('Unexpected close reserves identity for the full 60 seconds even with a shorter TTL',async()=>{
  const host=await connect(),m=await create(host);host.disconnect();await until(()=>!server.rooms.get(m.room.code).slots[0].connected);
  clock+=10001;server.cleanup();assert.ok(server.rooms.has(m.room.code));
  clock+=49998;const resumed=await connect(),r=await ok(resumed,'room:resume',{code:m.room.code,credential:m.credential});assert.equal(r.playerId,0);
  await ok(resumed,'room:leave');assert.equal(server.rooms.has(m.room.code),false);
 });
 await group('Last reservation expiry deletes room immediately; expired credentials cannot revive it',async()=>{
  const host=await connect(),m=await create(host),probe=await connect();host.disconnect();await until(()=>!server.rooms.get(m.room.code).slots[0].connected);
  clock+=60000;await bad(probe,'room:resume',{code:m.room.code,credential:m.credential},'unauthorized');server.cleanup();assert.equal(server.rooms.has(m.room.code),false);
  await bad(probe,'room:resume',{code:m.room.code,credential:m.credential},'room_expired');
 });
 await group('Five-room limit recovers immediately after five explicit deletions, without restarting',async()=>{
  const hosts=await Promise.all(Array.from({length:5},connect));for(const host of hosts)await create(host);
  const probe=await connect();await bad(probe,'room:create',{nickname:'Probe',mode:'classic'},'server_busy');
  for(const host of hosts)assert.equal((await ok(host,'room:leave')).roomDeleted,true);assert.equal(server.rooms.size,0);
  for(const host of hosts)await create(host);assert.equal(server.rooms.size,5);for(const host of hosts)await ok(host,'room:leave');assert.equal(server.rooms.size,0);
 });
 await group('Create sweeps expired reservations before enforcing capacity; live reservations cannot be stolen',async()=>{
  const hosts=await Promise.all(Array.from({length:5},connect)),members=[];for(const host of hosts)members.push(await create(host));
  const probe=await connect();hosts.forEach(s=>s.disconnect());await until(()=>members.every(m=>!server.rooms.get(m.room.code).slots[0].connected));
  clock+=59999;await bad(probe,'room:create',{nickname:'Probe',mode:'classic'},'server_busy');assert.equal(server.rooms.size,5);
  clock++;const m=await create(probe);assert.equal(server.rooms.size,1);assert.ok(server.rooms.has(m.room.code));await ok(probe,'room:leave');
 });
 for(const count of [2,3,4])for(const mode of ['classic','evolution'])await group(`${count}-player ${mode} voluntary action-time leave cancels without ghost pens, migrates host and permits a fresh match`,async()=>{
  const sockets=await Promise.all(Array.from({length:count},connect)),m=await create(sockets[0],mode,count);
  for(let i=1;i<count;i++)await ok(sockets[i],'room:join',{code:m.room.code,nickname:`Guest ${i}`});
  for(const s of sockets)await ok(s,'room:ready',{ready:true});await ok(sockets[0],'room:start');
  const room=server.rooms.get(m.room.code),core=room.match,state=core.snapshot(),actor=state.currentPlayer,matchId=room.matchId;
  await ok(sockets[actor],'game:action',{roomCode:room.code,matchId,turn:1,actionId:crypto.randomUUID(),kind:'shake'});
  await ok(sockets[0],'room:leave');assert.equal(room.match,null);assert.equal(room.matchId,null);assert.equal(core.engine.world.bodies.length,0);assert.equal(room.seen.size,0);
  await until(()=>sockets.slice(1).every(s=>s.room.status==='lobby'&&s.room.matchId===null&&s.room.players.length===count-1));
  assert.equal(room.slots[0],null);assert.equal(room.hostId,1);assert.ok(room.slots.every(s=>!s||!s.ready));
  await bad(sockets[0],'room:resume',{code:room.code,credential:m.credential},'unauthorized');
  await bad(sockets[1],'game:action',{roomCode:room.code,matchId,turn:1,actionId:'old',kind:'shake'},'stale_match');
  const replacement=await connect();await ok(replacement,'room:join',{code:room.code,nickname:'Replacement'});sockets[0]=replacement;
  for(const s of sockets)await ok(s,'room:ready',{ready:true});await ok(sockets[1],'room:start');
  assert.equal(room.match.snapshot().players.length,count);assert.ok(room.match.snapshot().players.every(p=>p.score===0&&p.alive));assert.notEqual(room.matchId,matchId);
  // A finished match must be destroyed by explicit departures too.
  room.match.match.phase='finished';room.status='finished';const finished=room.match;
  for(const s of sockets)await ok(s,'room:leave');assert.equal(server.rooms.has(room.code),false);assert.equal(finished.engine.world.bodies.length,0);
 });
 await group('Active unexpected disconnect pauses and resumes the same match; expiry cancels without scoring',async()=>{
  const host=await connect(),guest=await connect(),m=await create(host,'evolution'),gm=await ok(guest,'room:join',{code:m.room.code,nickname:'Guest'});
  for(const s of [host,guest])await ok(s,'room:ready',{ready:true});await ok(host,'room:start');const room=server.rooms.get(m.room.code),old=room.matchId;
  guest.disconnect();await until(()=>host.room.paused);const other=await connect();await bad(other,'room:join',{code:room.code,nickname:'Steal'},'match_started');
  const resumed=await connect();await ok(resumed,'room:resume',{code:room.code,credential:gm.credential});assert.equal(room.matchId,old);assert.ok(room.match.snapshot().players.every(p=>p.score===0));
  resumed.disconnect();await until(()=>!room.slots[1].connected);clock+=60000;server.cleanup();assert.equal(room.match,null);assert.equal(room.slots[1],null);await ok(host,'room:leave');
 });
 await group('Room deletion is isolated and repeated cycles release registries, adapter rooms, simulations and listeners',async()=>{
  const sentinel=await connect(),sm=await create(sentinel),timer=server.timer,sentinelRoom=server.rooms.get(sm.room.code);
  for(let i=0;i<20;i++){
   const host=await connect(),m=await create(host),peer=server.io.sockets.sockets.get(host.id),listeners=peer.eventNames().length;
   await ok(host,'room:leave');await ok(host,'room:leave');assert.equal(server.io.sockets.adapter.rooms.has(`room:${m.room.code}`),false);assert.equal(server.members.has(host.id),false);assert.equal(peer.eventNames().length,listeners);host.disconnect();
   assert.equal(server.rooms.size,1);assert.equal(server.rooms.get(sm.room.code),sentinelRoom);assert.equal(server.timer,timer);
  }
  await ok(sentinel,'room:leave');assert.equal(server.rooms.size,0);assert.equal(server.members.size,0);assert.ok(server.expired.size<=100);
 });
 console.log(`${groups} lifecycle integration groups passed.`);
}finally{clients.forEach(s=>s.disconnect());const timer=server.timer;await server.close();await server.close();assert.equal(timer._destroyed,true);assert.equal(server.rooms.size,0);assert.equal(server.members.size,0);assert.equal(server.io.sockets.sockets.size,0);}}
void main().catch(error=>{console.error(error);process.exitCode=1;});
