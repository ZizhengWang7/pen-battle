import type {GameSnapshot,GameMode,PlayerId} from '../game/types';
import type {PenType} from '../game/pens';
import type {FallingPen} from '../game/falling';
export type Point={x:number;y:number};
export interface AimVisual {start:Point;origin:Point;end:Point;}
export interface PenPose {id:PlayerId;type:PenType;position:Point;angle:number;velocity:Point;angularVelocity:number;alive:boolean;fall:FallingPen|null;}
export interface SceneFrame {
 state:GameSnapshot;pens:PenPose[];
 flick:{point:Point;direction:Point;impulse:Point;elapsed:number;power:number;contacted:boolean}|null;
 strike:{elapsed:number;impacted:boolean;playerId:PlayerId}|null;
 shakeElapsed:number|null;phaseTime:number;upgrades:PlayerId[];respawnGlows:[PlayerId,number][];
}
export interface NetworkFrame extends SceneFrame {matchId:string;sequence:number;tick:number;serverTime:number;paused:boolean;}
export interface RoomPlayer {id:PlayerId;nickname:string;host:boolean;connected:boolean;ready:boolean;}
export type RoomCapacity=2|3|4;
export interface RoomView {code:string;maxPlayers:RoomCapacity;mode:GameMode;status:'lobby'|'playing'|'finished';players:RoomPlayer[];hostId:PlayerId;canStart:boolean;paused:boolean;disconnectDeadline:number|null;message:string;matchId:string|null;}
export type ActionIntent={roomCode:string;matchId:string;turn:number;actionId:string}&({kind:'flick';contact:Point;direction:Point;power:number}|{kind:'shake'});
export type Reply<T>={ok:true;data:T}|{ok:false;error:{code:string;message:string}};
export interface Membership {room:RoomView;playerId:PlayerId;credential:string;frame?:NetworkFrame;}
