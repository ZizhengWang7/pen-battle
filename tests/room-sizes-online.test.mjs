import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {io} from 'socket.io-client';
import {BattleServer} from '../server/service.ts';
let skew=0;
const server=new BattleServer({creationLimit:100,graceMs:5000,now:()=>Date.now()+skew}),clients=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<1000;i++){if(fn())return;await wait(10);}throw Error('State timeout');}
const call=(s,event,payload)=>new Promise((resolve,reject)=>s.timeout(3000).emit(event,payload,(err,result)=>err?reject(err):resolve(result)));
async function ok(s,e,p){const r=await call(s,e,p);assert.ok(r.ok,JSON.stringify(r));return r.data;}
async function bad(s,e,p,code){const r=await call(s,e,p);assert.equal(r.ok,false);assert.equal(r.error.code,code);}
let url;
async function connect(){const s=io(url,{forceNew:true,transports:['websocket'],reconnection:false});clients.push(s);s.on('room:update',r=>s.room=r);s.on('game:snapshot',f=>s.frame=f);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
async function main(){try{
 url=`http://127.0.0.1:${await server.listen(0,'127.0.0.1')}`;
 for(const count of [2,3,4]){
  const sockets=await Promise.all(Array.from({length:count+1},connect)),members=[];
  // Invalid creations use separate sockets so capacity validation, rather than
  // rate limiting, is what the assertion exercises.
  for(const maxPlayers of [null,1,5,'2',2.5]){const probe=await connect();await bad(probe,'room:create',{nickname:'Invalid',mode:'classic',maxPlayers},'invalid_capacity');probe.disconnect();}
  members[0]=await ok(sockets[0],'room:create',{nickname:'Host',mode:'classic',maxPlayers:count});const code=members[0].room.code;
  assert.equal(members[0].room.maxPlayers,count);await bad(sockets[0],'room:start',{},'not_ready');
  for(let i=1;i<count;i++)members[i]=await ok(sockets[i],'room:join',{code,nickname:`Guest ${i}`});
  await bad(sockets[count],'room:join',{code,nickname:'Overflow'},'room_full');
  await bad(sockets[count],'room:join',{code,nickname:'host'},'duplicate_name');
  await bad(sockets[1],'room:mode',{mode:'classic',maxPlayers:4},'invalid_payload');
  await bad(sockets[1],'room:mode',{mode:'evolution'},'host_only');
  await bad(sockets[0],'room:ready',{ready:true,maxPlayers:2},'invalid_payload');
  await bad(sockets[1],'room:start',{},'host_only');
  for(let i=0;i<count-1;i++)await ok(sockets[i],'room:ready',{ready:true});await bad(sockets[0],'room:start',{},'not_ready');
  const guest=count-1,token=members[guest].credential;sockets[guest].disconnect();await until(()=>sockets[0].room.players.some(p=>!p.connected));
  await bad(sockets[count],'room:join',{code,nickname:'Steal'},'room_full');await bad(sockets[0],'room:start',{},'not_ready');
  sockets[guest]=await connect();const resumed=await ok(sockets[guest],'room:resume',{code,credential:token});assert.equal(resumed.playerId,guest);
  for(const s of sockets.slice(0,count))await ok(s,'room:ready',{ready:true});await ok(sockets[0],'room:start',{});await until(()=>sockets.slice(0,count).every(s=>s.frame?.state.phase==='aiming'));
  let f=sockets[0].frame;assert.equal(f.pens.length,count);assert.deepEqual([...f.state.turnOrder].sort(),Array.from({length:count},(_,i)=>i));
  const actor=f.state.currentPlayer,action={roomCode:code,matchId:f.matchId,turn:f.state.turn,actionId:crypto.randomUUID(),kind:'shake'};
  await bad(sockets[actor],'game:action',{...action,roomCode:'AAAAAA'},'wrong_room');await ok(sockets[actor],'game:action',action);await bad(sockets[actor],'game:action',action,'duplicate_action');
  await until(()=>sockets.slice(0,count).every(s=>s.frame?.state.turn===2));assert.equal(sockets[0].frame.state.players[actor].shakeCharge,0);
  const core=server.rooms.get(code).match;
  // Deterministic elimination fixture; production tests never move server bodies.
  const winner=core.snapshot().currentPlayer;
  core.pens.filter(p=>p.id!==winner).forEach((p,i)=>Matter.Body.setPosition(p.body,{x:20,y:150+i*120}));
  f=sockets[winner].frame;await ok(sockets[winner],'game:action',{roomCode:code,matchId:f.matchId,turn:f.state.turn,actionId:crypto.randomUUID(),kind:'shake'});
  await until(()=>sockets[0].frame?.state.phase==='finished');assert.equal(sockets[0].frame.state.winner,winner);const oldMatch=f.matchId;
  skew+=11000; // Advance the fixture clock beyond the start-attempt rate window.
  await ok(sockets[0],'room:mode',{mode:'evolution'});
  for(const s of sockets.slice(0,count))await ok(s,'room:ready',{ready:true});await ok(sockets[0],'room:start',{});await until(()=>sockets[0].frame.matchId!==oldMatch);
  const evolution=server.rooms.get(code).match,eActor=evolution.snapshot().currentPlayer,target=evolution.snapshot().turnOrder.find(id=>id!==eActor);
  const originalRoute=[...evolution.snapshot().progression],originalSeed=evolution.snapshot().seed;
  await bad(sockets[eActor],'game:action',{roomCode:code,progression:originalRoute},'invalid_payload');
  for(let score=1;score<=5;score++){
   evolution.match.currentPlayer=eActor;evolution.match.players[eActor].shakeCharge=1;server.broadcast(server.rooms.get(code));
   Matter.Body.setPosition(evolution.pens[target].body,{x:20,y:310});
   await until(()=>sockets[eActor].frame.state.currentPlayer===eActor&&sockets[eActor].frame.state.phase==='aiming');
   const ef=sockets[eActor].frame;await ok(sockets[eActor],'game:action',{roomCode:code,matchId:ef.matchId,turn:ef.state.turn,actionId:crypto.randomUUID(),kind:'shake'});
   await until(()=>sockets.slice(0,count).every(s=>s.frame.state.players[eActor].score===score&&['aiming','finished'].includes(s.frame.state.phase)));
   assert.equal(sockets[0].frame.state.players[eActor].currentPenStage,Math.min(score,4));assert.deepEqual(sockets[0].frame.state.players[eActor].completedPenKills,originalRoute.slice(0,score));for(const s of sockets.slice(0,count))assert.deepEqual(s.frame.state.progression,originalRoute);
   if(score<5){assert.equal(sockets[0].frame.state.phase,'aiming');assert.ok(sockets[0].frame.state.players.every(p=>p.alive));}else assert.equal(sockets[0].frame.state.winner,eActor);
   for(const s of sockets.slice(0,count))assert.deepEqual(s.frame.state.players,sockets[0].frame.state.players);
  }
  const evolutionMatch=sockets[0].frame.matchId;skew+=11000;
  for(const s of sockets.slice(0,count))await ok(s,'room:ready',{ready:true});await ok(sockets[0],'room:start',{});await until(()=>sockets[0].frame.matchId!==evolutionMatch);assert.equal(sockets[0].frame.pens.length,count);assert.equal(sockets[0].room.maxPlayers,count);
  assert.notEqual(sockets[0].frame.state.seed,originalSeed);assert.ok(sockets[0].frame.state.players.every(p=>p.completedPenKills.length===0));
  // Active host reconnect reserves control, then expired credentials cannot resume.
  const restoreRoute=[...sockets[0].frame.state.progression];const hostToken=members[0].credential;sockets[0].disconnect();await until(()=>sockets[1].room.paused);sockets[0]=await connect();await ok(sockets[0],'room:resume',{code,credential:hostToken});await until(()=>!sockets[1].room.paused);assert.deepEqual(sockets[0].frame.state.progression,restoreRoute);assert.deepEqual(sockets[0].frame.state.players,sockets[1].frame.state.players);
  sockets[0].disconnect();await until(()=>!server.rooms.get(code).slots[0].connected);skew+=5001;
  await bad(sockets[count],'room:resume',{code,credential:hostToken},'unauthorized');await until(()=>server.rooms.get(code).status==='lobby');assert.notEqual(server.rooms.get(code).hostId,0);
  assert.equal(server.rooms.get(code).maxPlayers,count);for(const s of sockets)if(s.connected)await ok(s,'room:leave',{});
  console.log(`✓ ${count}-player real Socket.IO: validation, reserved capacity, readiness, start, shake, isolation, Classic/Evolution victory, scoring/respawn/rematch, host/guest resume, expiry/migration`);
 }
 console.log('3 configurable-room integration groups passed.');
}finally{for(const s of clients)s.disconnect();await server.close();}

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
