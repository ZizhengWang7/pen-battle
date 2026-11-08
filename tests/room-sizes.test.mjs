import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {MatchEngine} from '../src/game/MatchEngine.ts';
import {isSafeSpawn} from '../src/game/spawn.ts';
import {createMatch} from '../src/game/rules.ts';
import {capacity} from '../server/validation.ts';
const settle=game=>{for(let i=0;i<2000&&!['aiming','finished'].includes(game.status);i++)game.step();assert.ok(['aiming','finished'].includes(game.status));};
const edge=(game,ids)=>ids.forEach((id,i)=>Matter.Body.setPosition(game.pens[id].body,{x:20,y:160+120*i}));
let groups=0;
for(const count of [2,3,4]){
 assert.equal(capacity(count),count);
 for(const mode of ['classic','evolution']){
  const orders=new Set();
  for(let seed=0;seed<20;seed++){
   const game=new MatchEngine({mode,seed,playerCount:count,randomizeTurns:true});
   const state=game.snapshot();assert.equal(state.players.length,count);assert.equal(game.pens.length,count);
   assert.deepEqual([...state.turnOrder].sort(),Array.from({length:count},(_,i)=>i));orders.add(state.turnOrder.join(','));
   for(const pen of game.pens)assert.ok(isSafeSpawn(pen.body,game.pens.filter(p=>p!==pen).map(p=>p.body)));
   for(let i=0;i<60;i++)game.step();assert.ok(game.snapshot().players.every(p=>p.alive));game.destroy();
  }
  assert.ok(orders.size>1);assert.deepEqual(createMatch(mode,7,count,true),createMatch(mode,7,count,true));
  const game=new MatchEngine({mode,seed:7,playerCount:count,randomizeTurns:true});
  const seen=[];
  for(let i=0;i<count;i++){
   const s=game.snapshot();seen.push(s.currentPlayer);assert.ok(game.shake(s.currentPlayer));assert.equal(game.shake(s.currentPlayer),false);settle(game);
   assert.equal(game.snapshot().turn,i+2);assert.equal(game.snapshot().players[s.currentPlayer].shakeCharge,0);
  }
  assert.equal(new Set(seen).size,count);game.reset();assert.equal(game.snapshot().players.length,count);assert.ok(game.snapshot().players.every(p=>p.shakeCharge===1));game.destroy();
  groups++;console.log(`✓ ${count}-player ${mode}: safe spawns, deterministic randomized order, full turn cycle, shake and reset`);
 }
 const classic=new MatchEngine({playerCount:count,seed:9,randomizeTurns:true});
 const winner=classic.snapshot().currentPlayer;edge(classic,classic.snapshot().turnOrder.filter(id=>id!==winner));assert.ok(classic.shake(winner));settle(classic);assert.equal(classic.status,'finished');assert.equal(classic.snapshot().winner,winner);classic.destroy();
 const skip=new MatchEngine({playerCount:count});edge(skip,[1]);assert.ok(skip.shake(0));settle(skip);if(count>2){assert.equal(skip.snapshot().currentPlayer,2);assert.equal(skip.snapshot().players[1].alive,false);}skip.destroy();
 const evo=new MatchEngine({mode:'evolution',playerCount:count,seed:8});
 const actor=evo.snapshot().currentPlayer,target=evo.snapshot().turnOrder.find(id=>id!==actor);
 // Repeat actual fall/score/respawn phases with deterministic positioning. The
 // fixture resets charge between rounds to isolate scoring from turn selection.
 for(let score=1;score<=5;score++){
  evo.match.currentPlayer=actor;evo.match.players[actor].shakeCharge=1;edge(evo,[target]);assert.ok(evo.shake(actor));settle(evo);
  const s=evo.snapshot();assert.equal(s.players[actor].score,score);assert.deepEqual(s.players[actor].completedPenKills,s.progression.slice(0,score));assert.equal(s.players[actor].currentPenStage,Math.min(4,score));
  for(let i=0;i<5;i++)evo.step();assert.equal(evo.snapshot().players[actor].score,score);
  if(score<5){assert.notEqual(s.phase,'finished');assert.ok(s.players.every(p=>p.alive&&p.respawn==='active'));}else{assert.equal(s.phase,'finished');assert.equal(s.winner,actor);}
 }
 evo.reset();evo.match.players[actor].currentPenStage=2;evo.match.players[actor].score=2;evo.match.players[actor].penType=evo.match.progression[2];evo.replaceUpgrade(actor);evo.match.currentPlayer=actor;edge(evo,[actor]);assert.ok(evo.shake(actor));settle(evo);assert.equal(evo.snapshot().players[actor].currentPenStage,1);assert.equal(evo.snapshot().players[actor].score,2);assert.ok(evo.snapshot().players[actor].alive);evo.destroy();
 groups++;console.log(`✓ ${count}-player Classic victory/skip and Evolution five-pen achievement victory, deduplicated scoring, respawn, self downgrade`);
}
for(const value of [null,0,1,5,-1,2.5,'2',true,{},NaN,Infinity])assert.throws(()=>capacity(value));
console.log(`${groups+1} room-size regression groups passed.`);
