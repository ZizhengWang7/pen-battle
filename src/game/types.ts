import type {PenType} from './pens';
export type PlayerId=0|1|2|3;
export type GameMode='classic'|'evolution';
export type GamePhase='waiting'|'aiming'|'hand_animation'|'physics'|'falling'|'scoring'|'upgrading'|'respawning'|'next_turn'|'finished';
export type RespawnStatus='active'|'falling'|'pending'|'eliminated';
// completedPenKills is a unique-ID set serialized as an array for Socket.IO.
export interface PlayerState {id:PlayerId;name:string;penType:PenType;score:number;currentPenStage:number;completedPenKills:PenType[];shakeCharge:0|1;alive:boolean;respawn:RespawnStatus;}
export interface ShotCommand {playerId:PlayerId;dx:number;dy:number;contact?:{x:number;y:number};}
export interface FlickAction extends ShotCommand {type:'flick';}
export interface ShakeAction {type:'shake';playerId:PlayerId;}
export type GameAction=FlickAction|ShakeAction;
export interface ActiveAction {id:number;command:GameAction;playerId:PlayerId;type:GameAction['type'];attackingPenType:PenType;eliminated:PlayerId[];scored:boolean;}
export interface MatchNotice {id:number;kind:'upgrade'|'downgrade'|'respawn'|'score';playerId:PlayerId;text:string;}
export interface MatchState {
 mode:GameMode;seed:number;players:PlayerState[];turnOrder:PlayerId[];currentPlayer:PlayerId;turn:number;phase:GamePhase;
 progression:PenType[];activeAction:ActiveAction|null;nextActionId:number;winner:PlayerId|null;notices:MatchNotice[];
}
export interface GameSnapshot extends MatchState {alive:boolean[];shakeCharges:number[];canShake:boolean;}
