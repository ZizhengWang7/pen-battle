import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(fn())return;await sleep(50);}throw Error('Public gameplay state timed out');}
const call=(s,event,payload)=>new Promise((resolve,reject)=>s.timeout(10000).emit(event,payload,(err,result)=>err?reject(err):resolve(result)));
async function ok(s,event,payload){const r=await call(s,event,payload);assert.ok(r.ok,JSON.stringify(r));return r.data;}
async function bad(s,event,payload,code){const r=await call(s,event,payload);assert.equal(r.ok,false);assert.equal(r.error.code,code);}
// Functional actions only, on the room just created by the browser smoke test.
// Reconnect credentials stay in memory and are never logged or written to disk.
export async function verifyRoomGameplay(base,identities){
 const sockets=[],checks={};const code=identities[0].code,count=identities.length;
 async function connect(){const s=io(base,{forceNew:true,transports:['websocket'],reconnection:false,timeout:20000,extraHeaders:{Origin:new URL(base).origin}});sockets.push(s);s.on('game:snapshot',f=>s.frame=f);s.on('room:update',r=>s.room=r);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
 let players=[];
 const action=(s,fields)=>{const f=s.frame;return {roomCode:code,matchId:f.matchId,turn:f.state.turn,actionId:crypto.randomUUID(),...fields};};
 async function settled(turn){await until(()=>players.every(s=>s.frame?.state.phase==='finished'||s.frame?.state.phase==='aiming'&&s.frame.state.turn>=turn));}
 async function readyStart(){for(const s of players)await ok(s,'room:ready',{ready:true});await ok(players[0],'room:start',{});await until(()=>players.every(s=>s.frame?.state.phase==='aiming'&&s.frame.state.turn===1));}
 try{
  for(const identity of identities){const s=await connect();const m=await ok(s,'room:resume',{code,credential:identity.credential});players[m.playerId]=s;}
  assert.equal(players.length,count);checks.wss=players.every(s=>s.io.engine.transport.name==='websocket'&&(new URL(base).protocol!=='https:'||s.io.engine.transport.opts.secure));
  const outsider=await connect();await bad(outsider,'game:action',action(players[0],{kind:'shake'}),'unauthorized');
  const f=players[0].frame,actor=f.state.currentPlayer;
  await bad(players[actor],'game:action',{...action(players[actor],{kind:'shake'}),roomCode:process.env.SMOKE_ISOLATION_ROOM??(code==='AAAAAA'?'BBBBBB':'AAAAAA')},'wrong_room');checks.isolation=true;
  // Keep one winner stationary; all other owners deliberately flick outward.
  const winner=actor;let actions=0;
  while(players[0].frame.state.phase!=='finished'&&actions++<20){
   const s=players[players[0].frame.state.currentPlayer],frame=s.frame,p=frame.pens[frame.state.currentPlayer].position;
   const edges=[{distance:p.x-17,x:-1,y:0},{distance:383-p.x,x:1,y:0},{distance:p.y-17,x:0,y:-1},{distance:603-p.y,x:0,y:1}].sort((a,b)=>a.distance-b.distance);
   const d=frame.state.currentPlayer===winner?{x:0,y:1}:edges[0];
   const payload=action(s,{kind:'flick',contact:p,direction:{x:d.x,y:d.y},power:frame.state.currentPlayer===winner?.07:1});
   await ok(s,'game:action',payload);await bad(s,'game:action',payload,'duplicate_action');await settled(frame.state.turn+1);
  }
  assert.equal(players[0].frame.state.phase,'finished');assert.equal(players[0].frame.state.winner,winner);assert.equal(players[0].frame.state.players.filter(p=>p.alive).length,1);checks.classicEliminationAndWinner=true;
  const old=players[0].frame.matchId;await readyStart();assert.notEqual(players[0].frame.matchId,old);assert.equal(players[0].frame.pens.length,count);assert.ok(players[0].frame.state.players.every(p=>p.alive&&p.shakeCharge===1));checks.rematch=true;
  // Finish the rematch through legal outward flicks before selecting Evolution.
  actions=0;
  while(players[0].frame.state.phase!=='finished'&&actions++<20){
   const frame=players[0].frame,s=players[frame.state.currentPlayer],p=frame.pens[frame.state.currentPlayer].position;
   const d=[{v:p.x-17,x:-1,y:0},{v:383-p.x,x:1,y:0},{v:p.y-17,x:0,y:-1},{v:603-p.y,x:0,y:1}].sort((a,b)=>a.v-b.v)[0];
   await ok(s,'game:action',action(s,{kind:'flick',contact:p,direction:{x:d.x,y:d.y},power:1}));await settled(frame.state.turn+1);
  }
  assert.equal(players[0].frame.state.phase,'finished');await ok(players[0],'room:mode',{mode:'evolution'});await readyStart();
  const ef=players[0].frame;
  assert.equal(new Set(ef.state.progression).size,5);for(const s of players)assert.deepEqual(s.frame.state.progression,ef.state.progression);checks.sharedRandomRoute=true;
  assert.ok(ef.state.players.every(p=>p.completedPenKills.length===0&&p.penType===ef.state.progression[0]));checks.freshAchievements=true;
  const eactor=ef.state.currentPlayer,ep=ef.pens[eactor].position;
  const direction=ep.x<200?{x:-1,y:0}:ep.x>200?{x:1,y:0}:{x:0,y:-1};
  let sawFall=false;for(const s of players)s.on('game:snapshot',frame=>{if(frame.state.players[eactor]?.respawn==='falling')sawFall=true;});
  await ok(players[eactor],'game:action',action(players[eactor],{kind:'flick',contact:ep,direction,power:1}));await settled(2);
  assert.ok(sawFall);assert.ok(players[0].frame.state.players.every(p=>p.alive&&p.respawn==='active'));assert.equal(players[0].frame.state.phase,'aiming');assert.equal(players[0].frame.state.winner,null);checks.evolutionRespawnContinues=true;assert.deepEqual(players[0].frame.state.players[eactor].completedPenKills,[]);checks.selfFallNoAchievement=true;
  const sf=players[0].frame,shaker=sf.state.currentPlayer;await ok(players[shaker],'game:action',action(players[shaker],{kind:'shake'}));await settled(sf.state.turn+1);assert.equal(players[0].frame.state.players[shaker].shakeCharge,0);assert.equal(players[0].frame.state.turn,sf.state.turn+1);checks.shakeOneTurn=true;
  await until(()=>players.every(s=>s.frame.state.turn===players[0].frame.state.turn));for(const s of players)assert.deepEqual(s.frame.state,players[0].frame.state);checks.synchronized=true;assert.equal(outsider.frame,undefined);checks.noUnauthorizedSnapshots=true;
  console.log(JSON.stringify({gameplayPassed:true,playerCount:count,checks}));return checks;
 }finally{for(const s of players)if(s?.connected)try{await ok(s,'room:leave',{});}catch{}for(const s of sockets)s.disconnect();}
}
