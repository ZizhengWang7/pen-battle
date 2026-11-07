import {io} from 'socket.io-client';
import {fork} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const value=fn();if(value)return value;await sleep(5);}throw new Error('Load scenario timed out');}
function message(worker,type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{worker.off('message',listener);reject(new Error(`Worker timeout: ${type}`));},120000);const listener=value=>{if(value.type===type){clearTimeout(timer);worker.off('message',listener);resolve(value);}};worker.on('message',listener);});}
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]??0;};
export async function runScenario(workerFile,roomCount){
 const worker=fork(workerFile,[],{env:{...process.env,LOAD_ROOMS:String(roomCount),NODE_PATH:resolve('node_modules')},stdio:['ignore','inherit','inherit','ipc']});
 const allClients=[],rooms=[],latencies=[];let requests=0,failedRequests=0,connections=0,failedConnections=0,unexpectedDisconnects=0,inconsistentSnapshots=0,wrongRoomSnapshots=0,commonSequences=0,totalSnapshots=0,actions=0,shakes=0,reconnects=0;
 const planned=new WeakSet();let base;
 async function rpc(client,event,payload){requests++;const started=performance.now();try{const reply=await new Promise((resolve,reject)=>client.socket.timeout(10000).emit(event,payload,(error,response)=>error?reject(error):resolve(response)));if(!reply?.ok)throw new Error(`${event}: ${reply?.error?.code}`);if(event==='game:action'){latencies.push(performance.now()-started);actions++;if(payload.kind==='shake')shakes++;}return reply.data;}catch(error){failedRequests++;throw error;}}
 async function connect(room,index){
  connections++;const socket=io(base,{forceNew:true,transports:['websocket'],reconnection:false,timeout:10000}),client={socket,index,frame:null,credential:null};allClients.push(client);
  socket.on('disconnect',()=>{if(!planned.has(socket))unexpectedDisconnects++;});
  socket.on('game:snapshot',frame=>{
   totalSnapshots++;client.frame=frame;
   if(room.matchId&&frame.matchId!==room.matchId){wrongRoomSnapshots++;return;}
   const key=`${frame.matchId}:${frame.sequence}`,digest=createHash('sha256').update(JSON.stringify(frame)).digest('hex');let entry=room.hashes.get(key);
   if(!entry){entry={digest,mask:0};room.hashes.set(key,entry);}else if(entry.digest!==digest)inconsistentSnapshots++;
   const previous=entry.mask;entry.mask|=1<<index;if(previous!==15&&entry.mask===15)commonSequences++;
   if(room.hashes.size>64)room.hashes.delete(room.hashes.keys().next().value);
  });
  try{await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});}catch(error){failedConnections++;throw error;}return client;
 }
 const latest=room=>room.clients.map(c=>c.frame).filter(Boolean).sort((a,b)=>b.sequence-a.sequence)[0];
 async function start(room){
  room.matchId=null;room.hashes.clear();for(const client of room.clients)await rpc(client,'room:ready',{ready:true});const view=await rpc(room.clients[0],'room:start',{});room.matchId=view.matchId;
  await until(()=>room.clients.every(c=>c.frame?.matchId===room.matchId&&c.frame.state.phase==='aiming'));
 }
 async function action(room,preferShake){
  if(latest(room)?.state.phase==='finished')await start(room);
  await until(()=>room.clients.every(c=>c.frame?.matchId===room.matchId&&c.frame.state.phase==='aiming'&&c.frame.state.turn===latest(room).state.turn));
  const frame=latest(room),id=frame.state.currentPlayer,client=room.clients[id],pen=frame.pens[id];
  const common={roomCode:room.code,matchId:room.matchId,turn:frame.state.turn,actionId:randomUUID()};
  let payload;
  if(preferShake&&frame.state.players[id].shakeCharge)payload={...common,kind:'shake'};
  else {const dx=200-pen.position.x,dy=310-pen.position.y,length=Math.hypot(dx,dy)||1;payload={...common,kind:'flick',contact:{x:pen.position.x+15*Math.cos(pen.angle),y:pen.position.y+15*Math.sin(pen.angle)},direction:{x:dx/length,y:dy/length},power:.2};if(Math.hypot(dx,dy)<1)payload.direction={x:1,y:0};}
  await rpc(client,'game:action',payload);
  await until(()=>room.clients.every(c=>c.frame?.matchId===room.matchId&&((c.frame.state.phase==='aiming'&&c.frame.state.turn>frame.state.turn)||c.frame.state.phase==='finished')));
 }
 try{
  const ready=await message(worker,'ready');base=`http://127.0.0.1:${ready.port}`;const measuring=message(worker,'measuring');worker.send('measure:start');await measuring;
  for(let group=0;group<roomCount;group+=5)await Promise.all(Array.from({length:Math.min(5,roomCount-group)},async(_,offset)=>{
   const number=group+offset,room={clients:[],hashes:new Map(),matchId:null,code:null};rooms.push(room);
   const host=await connect(room,0),created=await rpc(host,'room:create',{nickname:`Load ${number} A`,mode:number%2?'evolution':'classic'});room.code=created.room.code;host.credential=created.credential;room.clients.push(host);
   for(let id=1;id<4;id++){const client=await connect(room,id),joined=await rpc(client,'room:join',{code:room.code,nickname:`Load ${number} ${id}`});client.credential=joined.credential;room.clients.push(client);}await start(room);
  }));
  assert.equal(new Set(rooms.map(r=>r.code)).size,roomCount);assert.equal(new Set(rooms.map(r=>r.matchId)).size,roomCount);
  for(let cycle=0;cycle<8;cycle++){
   for(let move=0;move<3;move++)await Promise.all(rooms.map(room=>action(room,move===1)));
   if(cycle===0)await Promise.all(rooms.map(async room=>{
    const old=room.clients[1];planned.add(old.socket);old.socket.disconnect();await until(()=>room.clients.filter(c=>c!==old).some(c=>c.frame?.paused));
    const client=await connect(room,1);await rpc(client,'room:resume',{code:room.code,credential:old.credential});client.credential=old.credential;room.clients[1]=client;reconnects++;
    await until(()=>client.frame&&!client.frame.paused);
   }));
  }
  // Respawn outline animations have finite lifetime; settled rooms then stop
  // producing snapshots entirely, apart from Socket.IO's transport heartbeat.
  await sleep(800);const idleStart=totalSnapshots;await sleep(500);const idleSnapshots=totalSnapshots-idleStart;
  const metrics=message(worker,'metrics');worker.send('measure:stop');const measured=await metrics;
  assert.equal(failedRequests+failedConnections+unexpectedDisconnects+inconsistentSnapshots+wrongRoomSnapshots,0);assert.ok(commonSequences>=roomCount);assert.ok(shakes>=roomCount);assert.equal(idleSnapshots,0);
  return {rooms:roomCount,concurrentPlayers:roomCount*4,actions,shakes,reconnects,requests,connectionAttempts:connections,ackLatencyMs:{p50:percentile(latencies,.5),p95:percentile(latencies,.95),p99:percentile(latencies,.99)},...measured,type:undefined,errorCount:failedRequests+failedConnections,errorRate:(failedRequests+failedConnections)/(requests+connections),unexpectedDisconnects,inconsistentSnapshots,wrongRoomSnapshots,commonSequences,idleSnapshots,totalSnapshots};
 }finally{
  for(const client of allClients){planned.add(client.socket);client.socket.disconnect();}if(worker.connected)worker.send('close');await Promise.race([new Promise(resolve=>worker.once('exit',resolve)),sleep(3000)]);if(worker.exitCode===null)worker.kill('SIGTERM');
 }
}
