import {createServer,type Server as HttpServer} from 'node:http';
import {randomInt,randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {Server,type Socket} from 'socket.io';
import {MatchEngine} from '../src/game/MatchEngine';
import {FIXED_STEP} from '../src/game/physics';
import type {PlayerId,GameMode} from '../src/game/types';
import type {RoomView,NetworkFrame,Reply} from '../src/shared/protocol';
import {ClientError,requireThat,object,roomCode,nickname,mode,finite,point,RateLimits,ALPHABET} from './validation';
interface Slot {id:PlayerId;nickname:string;digest:Buffer;socketId:string|null;connected:boolean;ready:boolean;deadline:number|null;}
interface Room {code:string;mode:GameMode;hostId:PlayerId;slots:(Slot|null)[];status:RoomView['status'];match:MatchEngine|null;matchId:string|null;sequence:number;lastActivity:number;seen:Map<PlayerId,Set<string>>;message:string;}
export interface ServerOptions {origins?:string[];roomTtlMs?:number;graceMs?:number;staticDir?:string;now?:()=>number;creationLimit?:number;}
export function secureRoomCode(){return Array.from({length:6},()=>ALPHABET[randomInt(ALPHABET.length)]).join('');}
const hash=(token:string)=>createHash('sha256').update(token).digest();
export class BattleServer {
 readonly http:HttpServer;
 readonly io:Server;
 readonly rooms=new Map<string,Room>();
 private expired=new Map<string,number>();
 private members=new Map<string,{code:string;id:PlayerId}>();
 private limits=new RateLimits();
 private timer:ReturnType<typeof setInterval>;
 private now:()=>number;
 private roomTtl:number;
 private grace:number;
 private accumulator=0;
 private last=performance.now();
 constructor(private options:ServerOptions={}){
  this.now=options.now??Date.now;this.roomTtl=options.roomTtlMs??600000;this.grace=options.graceMs??60000;
  const origins=options.origins??['http://localhost:5173','http://127.0.0.1:5173','http://localhost:3001','http://127.0.0.1:3001'];
  this.http=createServer((req,res)=>{void (async()=>{
   if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;}
   try{
    const root=resolve(options.staticDir??'dist'),pathname=decodeURIComponent(new URL(req.url??'/', 'http://local').pathname);
    const file=resolve(root,'.'+pathname);if(file!==root&&!file.startsWith(root+sep)){res.writeHead(404);res.end();return;}
    const target=pathname==='/'||/^\/room\/[A-Za-z2-9]{6}$/.test(pathname)?resolve(root,'index.html'):file;
    const content=await readFile(target);const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
    res.writeHead(200,{'Content-Type':mime[extname(target)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':extname(target)==='.html'?'no-cache':'public,max-age=3600'});res.end(content);
   }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found. Build the frontend with npm run build.');}
  })().catch(()=>{if(!res.headersSent)res.writeHead(500);res.end('Server error');});});
  this.io=new Server(this.http,{maxHttpBufferSize:16384,cors:{origin:origins,methods:['GET','POST']},allowRequest:(req,callback)=>callback(null,!req.headers.origin||origins.includes(req.headers.origin))});
  this.io.on('connection',socket=>this.connect(socket));
  this.timer=setInterval(()=>this.tick(),FIXED_STEP);
 }
 private view(room:Room):RoomView {
  const players=room.slots.filter((s):s is Slot=>s!==null).map(s=>({id:s.id,nickname:s.nickname,host:s.id===room.hostId,connected:s.connected,ready:s.ready}));
  const deadlines=room.slots.filter((s):s is Slot=>!!s&&!s.connected&&s.deadline!==null).map(s=>s.deadline!);
  return {code:room.code,mode:room.mode,status:room.status,players,hostId:room.hostId,canStart:room.status!=='playing'&&players.length===4&&players.every(p=>p.connected&&p.ready),paused:room.status==='playing'&&players.some(p=>!p.connected),disconnectDeadline:deadlines.length?Math.min(...deadlines):null,message:room.message,matchId:room.matchId};
 }
 private paused(room:Room){return room.status==='playing'&&room.slots.some(s=>!s||!s.connected)&&!!room.match&&['aiming','finished'].includes(room.match.snapshot().phase);}
 private frame(room:Room):NetworkFrame|null {if(!room.match||!room.matchId)return null;return {...room.match.getScene(),matchId:room.matchId,sequence:++room.sequence,tick:room.match.simulationTick,serverTime:this.now(),paused:this.paused(room)};}
 private broadcast(room:Room){this.io.to(`room:${room.code}`).emit('room:update',this.view(room));const frame=this.frame(room);if(frame)this.io.to(`room:${room.code}`).emit('game:snapshot',frame);}
 private find(code:string){const room=this.rooms.get(code);requireThat(room,this.expired.has(code)?'room_expired':'room_not_found',this.expired.has(code)?'房间已过期，请创建新房间':'找不到房间，请检查房间码');return room;}
 private member(socket:Socket){const membership=this.members.get(socket.id);requireThat(membership,'unauthorized','请先加入房间');const room=this.find(membership.code),slot=room.slots[membership.id];requireThat(slot&&slot.connected&&slot.socketId===socket.id,'unauthorized','此设备已失去玩家控制权');return {room,slot};}
 private host(socket:Socket){const member=this.member(socket);requireThat(member.slot.id===member.room.hostId,'host_only','只有房主可以操作');return member;}
 private bind(socket:Socket,room:Room,slot:Slot){
  requireThat(!this.members.has(socket.id),'already_joined','请先离开当前房间');
  if(slot.socketId){const old=this.io.sockets.sockets.get(slot.socketId);this.members.delete(slot.socketId);old?.emit('session:replaced');old?.leave(`room:${room.code}`);old?.disconnect(true);}
  slot.socketId=socket.id;slot.connected=true;if(!room.slots[room.hostId])room.hostId=slot.id;slot.deadline=null;if(room.status==='playing'&&room.slots.every(s=>s?.connected))room.message='';room.lastActivity=this.now();this.members.set(socket.id,{code:room.code,id:slot.id});void socket.join(`room:${room.code}`);
 }
 private newSlot(id:PlayerId,name:string){const credential=randomBytes(32).toString('base64url');return {credential,slot:{id,nickname:name,digest:hash(credential),socketId:null,connected:false,ready:false,deadline:null} satisfies Slot};}
 private response(room:Room,slot:Slot,credential:string){return {room:this.view(room),playerId:slot.id,credential,frame:this.frame(room)??undefined};}
 private connect(socket:Socket){
  const handle=(event:string,limit:number,windowMs:number,fn:(raw:unknown)=>unknown)=>socket.on(event,(raw:unknown,ack:unknown)=>{
   const reply=(value:Reply<unknown>)=>{if(typeof ack==='function')ack(value);};
   try{requireThat(this.limits.allow(`${socket.id}:${event}`,limit,windowMs,this.now()),'rate_limited','操作过于频繁，请稍后重试');const value=fn(raw);reply({ok:true,data:value});}catch(error){if(error instanceof ClientError)reply({ok:false,error:{code:error.code,message:error.message}});else {console.error('Socket handler failed',event,error instanceof Error?error.message:'unknown');reply({ok:false,error:{code:'server_error',message:'服务器暂时无法处理请求'}});}}
  });
  handle('room:create',5,60000,raw=>{
   requireThat(this.limits.allow(`${socket.handshake.address}:create`,this.options.creationLimit??5,60000,this.now()),'rate_limited','创建房间过于频繁');requireThat(!this.members.has(socket.id),'already_joined','请先离开当前房间');requireThat(this.rooms.size<500,'server_busy','服务器房间已满');
   const p=object(raw,['nickname','mode']),name=nickname(p.nickname),selected=mode(p.mode);let code:string;do{code=secureRoomCode();}while(this.rooms.has(code)||this.expired.has(code));
   const {slot,credential}=this.newSlot(0,name),room:Room={code,mode:selected,hostId:0,slots:[slot,null,null,null],status:'lobby',match:null,matchId:null,sequence:0,lastActivity:this.now(),seen:new Map(),message:''};this.rooms.set(code,room);this.bind(socket,room,slot);this.broadcast(room);return this.response(room,slot,credential);
  });
  handle('room:join',15,60000,raw=>{
   requireThat(this.limits.allow(`${socket.handshake.address}:join`,60,60000,this.now()),'rate_limited','加入尝试过多');const p=object(raw,['code','nickname']),room=this.find(roomCode(p.code)),name=nickname(p.nickname);
   requireThat(room.status==='lobby','match_started','对局已经开始，请使用原设备身份重连');requireThat(!room.slots.some(s=>s&&s.nickname.toLocaleLowerCase()===name.toLocaleLowerCase()),'duplicate_name','房间已有相同昵称，请换一个');const id=room.slots.findIndex(s=>s===null);requireThat(id>=0,'room_full','房间已有四位玩家');
   requireThat(!this.members.has(socket.id),'already_joined','请先离开当前房间');const {slot,credential}=this.newSlot(id as PlayerId,name);room.slots[id]=slot;this.bind(socket,room,slot);this.broadcast(room);return this.response(room,slot,credential);
  });
  handle('room:resume',20,60000,raw=>{
   requireThat(this.limits.allow(`${socket.handshake.address}:resume`,60,60000,this.now()),'rate_limited','重连尝试过多');const p=object(raw,['code','credential']),room=this.find(roomCode(p.code));requireThat(typeof p.credential==='string'&&/^[\w-]{43}$/.test(p.credential),'unauthorized','重连身份无效');const digest=hash(p.credential),slot=room.slots.find(s=>s&&timingSafeEqual(s.digest,digest));requireThat(slot,'unauthorized','重连身份已失效');this.bind(socket,room,slot);this.broadcast(room);return this.response(room,slot,p.credential);
  });
  handle('room:ready',10,10000,raw=>{const p=object(raw,['ready']);requireThat(typeof p.ready==='boolean','invalid_payload','准备状态不正确');const {room,slot}=this.member(socket);requireThat(room.status!=='playing','match_started','对局正在进行');slot.ready=p.ready;room.lastActivity=this.now();this.broadcast(room);return this.view(room);});
  handle('room:mode',10,10000,raw=>{const p=object(raw,['mode']),{room}=this.host(socket);requireThat(room.status!=='playing','match_started','对局中不能切换模式');room.mode=mode(p.mode);room.slots.forEach(s=>{if(s)s.ready=false;});this.broadcast(room);return this.view(room);});
  handle('room:start',5,10000,raw=>{object(raw,[]);const {room}=this.host(socket);requireThat(this.view(room).canStart,'not_ready','需要四位玩家连接并准备');room.match?.destroy();room.match=new MatchEngine({mode:room.mode,seed:randomInt(4294967296)});room.match.setPlayerNames(room.slots.map(s=>s!.nickname));room.matchId=randomUUID();room.status='playing';room.sequence=0;room.seen.clear();room.message='';room.lastActivity=this.now();room.slots.forEach(s=>{if(s)s.ready=false;});this.broadcast(room);return this.view(room);});
  handle('game:action',30,10000,raw=>{
   const p=object(raw,['roomCode','matchId','turn','actionId','kind','contact','direction','power']),{room,slot}=this.member(socket);
   requireThat(p.roomCode===room.code,'wrong_room','动作不属于此房间');requireThat(room.status==='playing'&&room.match&&p.matchId===room.matchId,'stale_match','对局已经结束或已重新开始');requireThat(!room.slots.some(s=>!s||!s.connected),'paused','等待离线玩家重连');
   requireThat(typeof p.actionId==='string'&&/^[\w-]{1,64}$/.test(p.actionId),'invalid_action','动作编号不正确');const seen=room.seen.get(slot.id)??new Set<string>();requireThat(!seen.has(p.actionId),'duplicate_action','该动作已经处理');const state=room.match.snapshot();
   requireThat(state.currentPlayer===slot.id,'wrong_turn','尚未轮到你');requireThat(p.turn===state.turn&&state.phase==='aiming','illegal_phase','当前不能执行动作');let accepted=false;
   if(p.kind==='shake'){requireThat(p.contact===undefined&&p.direction===undefined&&p.power===undefined,'invalid_payload','震桌无需弹笔参数');requireThat(state.players[slot.id].shakeCharge===1,'no_charge','震桌次数已用完');accepted=room.match.shake(slot.id);}
   else {requireThat(p.kind==='flick','invalid_action','未知动作');requireThat(finite(p.power,9/135,1),'invalid_power','弹笔力度必须在有效范围内');const contact=point(p.contact),direction=point(p.direction);requireThat(Math.abs(Math.hypot(direction.x,direction.y)-1)<.001,'invalid_direction','方向必须归一化');accepted=room.match.shoot({playerId:slot.id,contact,dx:direction.x*p.power,dy:direction.y*p.power});}
   requireThat(accepted,'invalid_contact','接触点必须位于自己的笔身上');seen.add(p.actionId);if(seen.size>4096)seen.delete(seen.values().next().value!);room.seen.set(slot.id,seen);room.lastActivity=this.now();this.broadcast(room);return {accepted:true,actionId:p.actionId};
  });
  handle('room:leave',5,10000,raw=>{object(raw,[]);this.depart(socket,true);return {};});
  socket.on('disconnect',()=>this.depart(socket,false));
 }
 private depart(socket:Socket,explicit:boolean){
  const membership=this.members.get(socket.id);if(!membership)return;this.members.delete(socket.id);const room=this.rooms.get(membership.code),slot=room?.slots[membership.id];if(!room||!slot||slot.socketId!==socket.id)return;
  slot.connected=false;slot.ready=false;slot.socketId=null;slot.deadline=this.now()+this.grace;room.lastActivity=this.now();void socket.leave(`room:${room.code}`);
  if(explicit&&room.status==='lobby'){room.slots[slot.id]=null;this.transferHost(room);}room.message=room.status==='playing'?'玩家离线：当前动作结算后暂停，等待重连。':room.message;this.broadcast(room);
 }
 private transferHost(room:Room){if(room.slots[room.hostId]?.connected)return;const next=room.slots.find(s=>s?.connected);if(next)room.hostId=next.id;}
 private tick(){
  const time=performance.now();this.accumulator+=Math.min(250,time-this.last);this.last=time;let steps=0;
  while(this.accumulator>=FIXED_STEP&&steps++<8){this.accumulator-=FIXED_STEP;
   for(const room of this.rooms.values()){try{
    const timedOut=room.slots.some(s=>s&&!s.connected&&s.deadline!==null&&this.now()>=s.deadline);
    if(timedOut){
     if(room.status==='playing'||room.status==='finished'){room.match?.destroy();room.match=null;room.matchId=null;room.status='lobby';room.message='离线玩家超时，对局取消。补齐四位玩家后可重新开始。';room.slots.forEach(s=>{if(s)s.ready=false;});}
     room.slots=room.slots.map(s=>s&&!s.connected&&s.deadline!==null&&this.now()>=s.deadline?null:s);this.transferHost(room);this.broadcast(room);
    }
    if(room.status==='playing'&&room.match&&!this.paused(room)){
     const beforePhase=room.match.snapshot().phase,impact=room.match.step(),afterPhase=room.match.snapshot().phase;if(afterPhase==='finished'){room.status='finished';this.broadcast(room);}else if(impact||beforePhase!==afterPhase||room.match.simulationTick%3===0)this.broadcast(room);
    }
    if(!room.slots.some(s=>s?.connected)&&this.now()-room.lastActivity>=this.roomTtl){room.match?.destroy();this.rooms.delete(room.code);this.expired.set(room.code,this.now()+this.roomTtl);}
   }catch(error){console.error('Room simulation failed',error instanceof Error?error.message:'unknown');try{room.match?.destroy();}catch{}room.match=null;room.matchId=null;room.status='lobby';room.message='对局出现异常，已安全终止。请重新准备。';room.slots.forEach(s=>{if(s)s.ready=false;});this.broadcast(room);}}
   for(const [code,expires] of this.expired)if(this.now()>=expires)this.expired.delete(code);
  }
 }
 async listen(port=3001,host='0.0.0.0'){await new Promise<void>((resolve,reject)=>{this.http.once('error',reject);this.http.listen(port,host,()=>{this.http.off('error',reject);resolve();});});const address=this.http.address();return typeof address==='object'&&address?address.port:port;}
 async close(){clearInterval(this.timer);for(const room of this.rooms.values())room.match?.destroy();await new Promise<void>(resolve=>this.io.close(()=>resolve()));}
}
