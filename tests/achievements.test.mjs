import assert from 'node:assert/strict';
import {createMatch,startMatch,acceptAction,recordElimination,scoreAction,shuffled} from '../src/game/rules.ts';
import {MatchEngine} from '../src/game/MatchEngine.ts';
import {PEN_TYPES} from '../src/game/pens.ts';
let groups=0;
function check(name,fn){fn();groups++;console.log(`✓ ${name}`);}
function score(state,actor,type,victims){
 state.phase='aiming';state.activeAction=null;state.currentPlayer=actor;
 state.players.forEach(p=>{p.alive=true;p.respawn='active';});
 state.players[actor].penType=type;state.players[actor].currentPenStage=state.progression.indexOf(type);
 assert.ok(acceptAction(state,{type:'flick',playerId:actor,dx:.2,dy:0}));
 victims.forEach(id=>recordElimination(state,id));scoreAction(state);
}
for(const count of [2,3,4])check(`${count}-player achievements require every actual pen ID; duplicates, self falls and downgrade preserve the set`,()=>{
 const s=createMatch('evolution',123,count);startMatch(s);const actor=s.currentPlayer,target=s.turnOrder.find(id=>id!==actor);
 score(s,actor,s.progression[0],[target,target]);assert.deepEqual(s.players[actor].completedPenKills,[s.progression[0]]);scoreAction(s);assert.equal(s.players[actor].completedPenKills.length,1);
 for(let i=0;i<6;i++)score(s,actor,s.progression[0],[target]);assert.equal(s.phase,'hand_animation');assert.equal(s.winner,null);assert.equal(s.players[actor].completedPenKills.length,1);
 score(s,actor,s.progression[3],[actor]);assert.equal(s.players[actor].currentPenStage,2);assert.deepEqual(s.players[actor].completedPenKills,[s.progression[0]]);
 for(let stage=1;stage<5;stage++){
  const type=s.progression[stage];score(s,actor,type,[target,actor,target]);
  assert.equal(s.players[actor].completedPenKills.length,stage+1);assert.equal(s.phase,stage===4?'finished':'hand_animation');
 }
 assert.equal(s.winner,actor);assert.deepEqual([...s.players[actor].completedPenKills].sort(),[...PEN_TYPES].sort());
});
check('One multi-victim action awards only its captured attacking pen type, before upgrades',()=>{
 const s=createMatch('evolution',33);startMatch(s);const actor=s.currentPlayer,type=s.players[actor].penType;
 score(s,actor,type,s.turnOrder.filter(id=>id!==actor));assert.deepEqual(s.players[actor].completedPenKills,[type]);assert.equal(s.players[actor].currentPenStage,3);assert.equal(s.winner,null);
 const snapshot=structuredClone(s);snapshot.players[actor].completedPenKills.push('fountain');assert.equal(s.players[actor].completedPenKills.length,1);
});
check('Full five-pen Fisher–Yates is seeded, preserves inputs, and can start with every pen type',()=>{
 const routes=new Set(),starts=new Set();
 for(let seed=0;seed<200;seed++){
  const s=createMatch('evolution',seed);assert.deepEqual(s,createMatch('evolution',seed));assert.deepEqual([...s.progression].sort(),[...PEN_TYPES].sort());
  starts.add(s.progression[0]);routes.add(s.progression.join(','));assert.ok(s.players.every(p=>p.penType===s.progression[0]));
 }
 assert.equal(starts.size,5);assert.ok(routes.size>50);
 // All 5! paths through Fisher–Yates produce exactly the 120 permutations.
 const permutations=new Set();
 for(let a=0;a<5;a++)for(let b=0;b<4;b++)for(let c=0;c<3;c++)for(let d=0;d<2;d++){
  const choices=[(a+.5)/5,(b+.5)/4,(c+.5)/3,(d+.5)/2];permutations.add(shuffled(PEN_TYPES,()=>choices.shift()).join(','));
 }
 assert.equal(permutations.size,120);assert.equal(PEN_TYPES.length,5);
});
check('Fresh local rematches reroll the seed and clear achievements; explicit seeds reproduce routes',()=>{
 const game=new MatchEngine({mode:'evolution',seed:5}),routes=new Set();
 for(let i=0;i<12;i++){game.match.players[0].completedPenKills.push(game.match.progression[0]);game.reset();routes.add(game.snapshot().progression.join(','));assert.ok(game.snapshot().players.every(p=>p.completedPenKills.length===0));}
 assert.ok(routes.size>1);game.reset('evolution',5);assert.deepEqual(game.snapshot().progression,createMatch('evolution',5).progression);game.destroy();
});
console.log(`${groups} achievement validation groups passed.`);
