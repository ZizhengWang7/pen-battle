import type {GameMode,MatchState,GameAction,PlayerId,MatchNotice} from './types';
import type {PenType} from './pens';
import {PEN_CLASSES} from './pens';
export const WIN_SCORE=5;
export function seededRandom(seed:number){let value=seed>>>0;return ()=>{value+=0x6D2B79F5;let t=value;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
export function shuffled<T>(values:readonly T[],random:()=>number):T[]{const result=[...values];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
export function createMatch(mode:GameMode='classic',seed=1):MatchState {
 const random=seededRandom(seed),ids:PlayerId[]=[0,1,2,3];
 const progression:PenType[]=['wooden',...shuffled<PenType>(['mechanical','ballpoint','highlighter','fountain'],random)];
 const turnOrder=mode==='classic'?ids:shuffled(ids,random);
 return {mode,seed:seed>>>0,players:ids.map((id)=>({id,name:['蓝色玩家','红色玩家','绿色玩家','黄色玩家'][id],penType:mode==='classic'?'ballpoint':'wooden',score:0,stage:0,shakeCharge:1,alive:true,respawn:'active'})),turnOrder,currentPlayer:turnOrder[0],turn:1,phase:'waiting',progression,activeAction:null,nextActionId:1,winner:null,notices:[]};
}
export function canAct(state:MatchState,playerId:PlayerId){return state.phase==='aiming'&&state.currentPlayer===playerId&&state.activeAction===null&&!!state.players[playerId]?.alive&&state.players[playerId]?.respawn==='active';}
export function acceptAction(state:MatchState,action:GameAction):boolean {
 if(!canAct(state,action.playerId)||(action.type==='shake'&&state.players[action.playerId].shakeCharge===0))return false;
 if(action.type==='shake')state.players[action.playerId].shakeCharge=0;
 state.activeAction={id:state.nextActionId++,command:structuredClone(action),playerId:action.playerId,type:action.type,eliminated:[],scored:false};state.phase='hand_animation';return true;
}
export function recordElimination(state:MatchState,id:PlayerId){
 const action=state.activeAction;if(!action||action.scored||action.eliminated.includes(id))return;
 action.eliminated.push(id);
}
export function notice(state:MatchState,kind:MatchNotice['kind'],playerId:PlayerId,text:string){state.notices.push({id:(state.notices[state.notices.length-1]?.id??0)+1,kind,playerId,text});state.notices=state.notices.slice(-8);}
// Called once, after every fall from the action has completed. Commit all victims
// and points together, then check victory, before any upgrade/respawn/next turn.
export function scoreAction(state:MatchState):PlayerId[]{
 const action=state.activeAction;if(!action||action.scored)return [];
 action.scored=true;
 for(const id of action.eliminated){const p=state.players[id];p.alive=false;p.respawn=state.mode==='evolution'?'pending':'eliminated';}
 if(state.mode==='classic'){
  const survivors=state.players.filter(p=>p.alive);
  if(survivors.length<=1){state.winner=survivors[0]?.id??null;state.phase='finished';}
  return [];
 }
 const actor=state.players[action.playerId],kills=action.eliminated.filter(id=>id!==actor.id).length,oldStage=actor.stage;
 actor.score=Math.min(WIN_SCORE,actor.score+kills);
 const earnedStage=Math.min(4,actor.stage+kills),selfEliminated=action.eliminated.includes(actor.id);
 actor.stage=Math.max(0,earnedStage-(selfEliminated?1:0));actor.penType=state.progression[actor.stage];
 if(kills)notice(state,'score',actor.id,`${actor.name} +${kills} 淘汰 · ${actor.score}/${WIN_SCORE}`);
 if(selfEliminated&&earnedStage>0)notice(state,'downgrade',actor.id,`${actor.name} 自落惩罚：降一级，历史分数保留`);
 if(actor.stage!==oldStage)notice(state,actor.stage<oldStage?'downgrade':'upgrade',actor.id,`${actor.name} ${actor.stage<oldStage?'降级':'升级'}：${PEN_CLASSES[actor.penType].name}`);
 if(actor.score>=WIN_SCORE){state.winner=actor.id;state.phase='finished';return [];}
 return actor.stage!==oldStage?[actor.id]:[];
}
export function nextTurn(state:MatchState):boolean {
 if(state.phase==='finished')return false;
 if(state.mode==='evolution'&&state.players.some(p=>p.respawn==='pending'))return false;
 const index=state.turnOrder.indexOf(state.currentPlayer);
 for(let offset=1;offset<=state.turnOrder.length;offset++){
  const id=state.turnOrder[(index+offset)%state.turnOrder.length];
  if(state.players[id].alive&&state.players[id].respawn==='active'){
   state.currentPlayer=id;state.turn++;state.activeAction=null;state.phase='aiming';return true;
  }
 }
 return false;
}

export function startMatch(state:MatchState){if(state.phase==='waiting')state.phase='aiming';}
