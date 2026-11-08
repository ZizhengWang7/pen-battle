import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
import {writeFile} from 'node:fs/promises';
const base=process.env.SMOKE_URL??'http://127.0.0.1:17321';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname)&&new URL(base).protocol!=='https:')throw Error('Public checks require HTTPS');
const clients=[],checks={};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(fn())return;await sleep(50);}throw Error('Lifecycle smoke timeout');}
const call=(s,e,p={})=>new Promise((resolve,reject)=>s.timeout(10000).emit(e,p,(error,r)=>error?reject(error):resolve(r)));
async function ok(s,e,p){const r=await call(s,e,p);assert.ok(r.ok,JSON.stringify(r));return r.data;}
async function bad(s,e,p,code){const r=await call(s,e,p);assert.equal(r.ok,false);assert.equal(r.error.code,code);}
async function connect(){const s=io(base,{forceNew:true,transports:['websocket'],reconnection:false,timeout:20000,extraHeaders:{Origin:new URL(base).origin}});clients.push(s);s.on('room:update',r=>s.room=r);s.on('game:snapshot',f=>s.frame=f);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
const create=(s,mode)=>ok(s,'room:create',{nickname:'Lifecycle Host',mode,maxPlayers:2});
async function start(host,guest){await ok(host,'room:ready',{ready:true});await ok(guest,'room:ready',{ready:true});await ok(host,'room:start');await until(()=>host.frame?.state.phase==='aiming'&&guest.frame?.state.phase==='aiming');}
try{
 const host=await connect(),guest=await connect(),probe=await connect();checks.secureTransport=host.io.engine.transport.name==='websocket'&&(new URL(base).protocol!=='https:'||host.io.engine.transport.opts.secure);
 const first=await create(host,'classic'),code=first.room.code;await ok(guest,'room:join',{code,nickname:'Lifecycle Guest'});await start(host,guest);
 await ok(host,'room:leave');await until(()=>guest.room.status==='lobby'&&guest.room.hostId===1&&guest.room.matchId===null&&guest.room.players.length===1);checks.activeLeaveCancelsAndMigrates=true;
 await bad(probe,'room:resume',{code,credential:first.credential},'unauthorized');assert.equal((await ok(host,'room:leave')).left,true);checks.revocationAndIdempotency=true;
 assert.equal((await ok(guest,'room:leave')).roomDeleted,true);await bad(probe,'room:join',{code,nickname:'Deleted room probe'},'room_expired');checks.immediateDeletion=true;
 const second=await create(host,'evolution');assert.notEqual(second.room.code,code);const gm=await ok(guest,'room:join',{code:second.room.code,nickname:'Lifecycle Guest'});await start(host,guest);const matchId=host.frame.matchId;
 guest.disconnect();await until(()=>host.room.paused);await bad(probe,'room:join',{code:second.room.code,nickname:'Reservation probe'},'match_started');
 const resumed=await connect(),r=await ok(resumed,'room:resume',{code:second.room.code,credential:gm.credential});assert.equal(r.playerId,1);assert.equal(r.frame.matchId,matchId);await until(()=>!host.room.paused);checks.activeReconnectPreservesMatch=true;
 await ok(resumed,'room:leave');await until(()=>host.room.status==='lobby'&&host.room.matchId===null);assert.equal((await ok(host,'room:leave')).roomDeleted,true);checks.evolutionLeaveCancels=true;
 await bad(probe,'room:join',{code:second.room.code,nickname:'Deleted room probe'},'room_expired');checks.recreationAndIsolation=true;
 const reservation=await create(host,'classic');host.disconnect();await sleep(500);
 await bad(probe,'room:join',{code:reservation.room.code,nickname:'Reservation probe',maxPlayers:2},'invalid_payload');
 const reservationGuest=await ok(probe,'room:join',{code:reservation.room.code,nickname:'Reservation guest'});assert.equal(reservationGuest.playerId,1);
 const thief=await connect();await bad(thief,'room:join',{code:reservation.room.code,nickname:'Slot thief'},'room_full');await ok(probe,'room:leave');checks.reservedSlotNotStolen=true;
 const restore=await connect();await ok(restore,'room:resume',{code:reservation.room.code,credential:reservation.credential});restore.disconnect();
 console.log('Valid reconnection confirmed; waiting for the real 60-second reservation deadline.');
 await sleep(61000);
 const stale=await call(thief,'room:resume',{code:reservation.room.code,credential:reservation.credential});assert.equal(stale.ok,false);assert.ok(['unauthorized','room_expired'].includes(stale.error.code));
 await bad(thief,'room:join',{code:reservation.room.code,nickname:'Expired probe'},'room_expired');checks.realGraceExpiryDeletesRoom=true;
 const final=await create(thief,'classic');assert.equal((await ok(thief,'room:leave')).roomDeleted,true);await bad(thief,'room:join',{code:final.room.code,nickname:'Deletion probe'},'room_expired');checks.capacityReusableWithoutRestart=true;
 const report={verifiedAt:new Date().toISOString(),base,passed:Object.values(checks).every(Boolean),checks};if(process.env.SMOKE_REPORT)await writeFile(process.env.SMOKE_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{for(const s of clients)if(s.connected)try{await ok(s,'room:leave');}catch{}clients.forEach(s=>s.disconnect());}
