import {useEffect,useRef,useState} from 'react';
import {io,type Socket} from 'socket.io-client';
import type {Membership,RoomView,NetworkFrame,Reply,ActionIntent} from '../shared/protocol';
import {SnapshotBuffer} from './buffer';
import {OnlineTable} from './OnlineTable';
import {COLORS} from '../game/constants';
import {PEN_CLASSES} from '../game/pens';
import type {GameMode} from '../game/types';
const STORAGE='pen-battle:identity:';
const request=<T,>(socket:Socket,event:string,payload:unknown)=>new Promise<T>((resolve,reject)=>socket.timeout(7000).emit(event,payload,(error:Error|null,reply:Reply<T>)=>{if(error){reject(new Error('连接超时，请检查服务器与网络'));return;}if(!reply?.ok){reject(new Error(reply?.error?.message??'服务器响应异常'));return;}resolve(reply.data);}));
const saved=(code:string)=>{try{return localStorage.getItem(STORAGE+code);}catch{return null;}};
const actionId=()=>{const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return [...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');};
export default function OnlinePlay({onExit}:{onExit:()=>void}){
 const pathCode=window.location.pathname.match(/^\/room\/([A-Za-z2-9]{6})$/)?.[1].toUpperCase()??'';
 const [code,setCode]=useState(pathCode),[name,setName]=useState(''),[selectedMode,setSelectedMode]=useState<GameMode>('classic');
 const [room,setRoom]=useState<RoomView|null>(null),[identity,setIdentity]=useState<Membership|null>(null),[frame,setFrame]=useState<NetworkFrame|null>(null),[connected,setConnected]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[aiming,setAiming]=useState(false),[copyText,setCopyText]=useState('复制邀请链接');
 const socketRef=useRef<Socket|null>(null),identityRef=useRef<Membership|null>(null),buffer=useRef(new SnapshotBuffer()),canvas=useRef<HTMLCanvasElement>(null),allowed=useRef(false);
 const remember=(membership:Membership)=>{
  setError('');identityRef.current=membership;setIdentity(membership);setRoom(membership.room);setCode(membership.room.code);history.replaceState(null,'',`/room/${membership.room.code}`);
  try{localStorage.setItem(STORAGE+membership.room.code,membership.credential);localStorage.setItem('pen-battle:last-room',membership.room.code);}catch{setError('此浏览器禁用了本地存储，刷新后可能无法恢复身份。');}
  if(membership.frame){buffer.current.push(membership.frame);setFrame(membership.frame);}
 };
 useEffect(()=>{
  const socket=io(import.meta.env.VITE_SERVER_URL||window.location.origin,{reconnection:true,reconnectionDelay:500,reconnectionDelayMax:3000});socketRef.current=socket;let live=true;
  socket.on('connect',()=>{setConnected(true);let last=pathCode;try{last=last||localStorage.getItem('pen-battle:last-room')||'';}catch{/* private storage unavailable */}const current=identityRef.current,roomCode=current?.room.code??last,credential=current?.credential??saved(roomCode);
   if(credential)void request<Membership>(socket,'room:resume',{code:roomCode,credential}).then(m=>{if(live)remember(m);}).catch(e=>{if(live){setError(e.message);setRoom(null);setIdentity(null);identityRef.current=null;}});
  });
  socket.on('disconnect',()=>setConnected(false));socket.on('connect_error',()=>setError('无法连接在线服务器，请检查网络及服务器地址。'));
  socket.on('server:full',(value:{message:string})=>{setError(value.message);setConnected(false);});
  socket.on('server:shutdown',(value:{message:string})=>setError(value.message));
  socket.on('room:removed',(value:{message:string})=>{const old=identityRef.current;if(old){try{localStorage.removeItem(STORAGE+old.room.code);localStorage.removeItem('pen-battle:last-room');}catch{}}identityRef.current=null;setIdentity(null);setRoom(null);setFrame(null);buffer.current.clear();setError(value.message);history.replaceState(null,'','/');});
  socket.on('session:replaced',()=>{setError('另一窗口已接管这个玩家席位。此窗口已停止控制。');setConnected(false);socket.disconnect();});
  socket.on('room:update',(value:RoomView)=>{setRoom(value);if(!value.matchId){buffer.current.clear();setFrame(null);}});
  socket.on('game:snapshot',(value:NetworkFrame)=>{buffer.current.push(value);setFrame(value);});
  return()=>{live=false;socket.disconnect();socketRef.current=null;};
 },[]);
 const run=async<T,>(event:string,payload:unknown):Promise<T|null>=>{const socket=socketRef.current;if(!socket?.connected){setError('尚未连接服务器');return null;}setBusy(true);setError('');try{return await request<T>(socket,event,payload);}catch(e){setError(e instanceof Error?e.message:'操作失败');return null;}finally{setBusy(false);}};
 const join=async(create:boolean)=>{const membership=await run<Membership>(create?'room:create':'room:join',create?{nickname:name,mode:selectedMode}:{code,nickname:name});if(membership)remember(membership);};
 const send=async(intent:{kind:'shake'}|Pick<Extract<ActionIntent,{kind:'flick'}>,'kind'|'contact'|'direction'|'power'>)=>{
  const latest=buffer.current.latest(),current=identityRef.current;if(!latest||!current)return false;
  const result=await run('game:action',{...intent,roomCode:current.room.code,matchId:latest.matchId,turn:latest.state.turn,actionId:actionId()});return !!result;
 };
 const sendRef=useRef(send);sendRef.current=send;
 allowed.current=connected&&!busy&&!room?.paused;
 useEffect(()=>{if(!canvas.current||!identity||!room?.matchId)return;const table=new OnlineTable(canvas.current,buffer.current,identity.playerId,intent=>sendRef.current(intent),()=>allowed.current,setAiming);return()=>table.destroy();},[identity?.playerId,room?.matchId,frame?.matchId]);
 const leave=async()=>{if(socketRef.current?.connected)await run('room:leave',{});if(identity){try{localStorage.removeItem(STORAGE+identity.room.code);localStorage.removeItem('pen-battle:last-room');}catch{/* ignore storage restrictions */}}identityRef.current=null;history.replaceState(null,'','/');onExit();};
 const invite=room?`${window.location.origin}/room/${room.code}`:'';
 const self=room?.players.find(p=>p.id===identity?.playerId),host=room?.hostId===identity?.playerId;
 return <main className="app online"><header><div className="eyebrow">PEN BATTLE · ONLINE</div><h1>在线弹笔大战</h1><p>{connected?'已连接服务器':'正在连接…'}</p></header>
 {error&&<div className="connection-error" role="alert">{error}</div>}
 {!room||!identity?<section className="mode-select"><label className="online-field">昵称<input value={name} maxLength={20} onChange={e=>setName(e.target.value)} placeholder="1–20 个文字或数字" autoComplete="nickname"/></label><label className="online-field">玩法<select value={selectedMode} onChange={e=>setSelectedMode(e.target.value as GameMode)}><option value="classic">经典淘汰</option><option value="evolution">进化竞技场</option></select></label><button disabled={!connected||busy||!name.trim()} onClick={()=>void join(true)}>创建房间</button><div className="join-divider">或加入朋友的房间</div><label className="online-field">房间码<input value={code} maxLength={6} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="ABC234" autoCapitalize="characters"/></label><button disabled={!connected||busy||code.length!==6||!name.trim()} onClick={()=>void join(false)}>加入房间</button><p className="subtle">无需注册。重连身份仅保存在此浏览器，请勿清除站点数据。</p></section>:<>
 <section className="room-lobby"><div className="room-code">房间 <strong>{room.code}</strong></div><button className="secondary" onClick={()=>{void (async()=>{try{if(!navigator.clipboard)throw new Error();await navigator.clipboard.writeText(invite);setCopyText('已复制');}catch{setCopyText('请长按下方链接复制');}})();}}>{copyText}</button><input className="invite-link" readOnly value={invite} aria-label="房间邀请链接" onFocus={e=>e.target.select()}/>
 <div className="lobby-players">{room.players.map(player=><div key={player.id} style={{borderLeft:`3px solid ${COLORS[player.id]}`}}><strong>{player.nickname}{player.id===identity.playerId?'（你）':''}</strong><span>{player.host?'房主 · ':''}{player.connected?(player.ready?'已准备':'在线'):'离线，等待重连'}</span>{host&&room.status==='lobby'&&player.id!==identity.playerId&&<button className="kick-button" disabled={busy||!connected} onClick={()=>void run('room:kick',{playerId:player.id})}>移除</button>}</div>)}</div>
 {room.message&&<p className="subtle">{room.message}</p>}{room.paused&&<div className="pause-banner">等待离线玩家重连。本次动作结算后暂停；超时将取消对局并返回大厅。</div>}
 {room.status!=='playing'&&<><label className="online-field">{host?'房主选择玩法':'本局玩法'}<select disabled={!host||busy} value={room.mode} onChange={e=>void run('room:mode',{mode:e.target.value})}><option value="classic">经典淘汰</option><option value="evolution">进化竞技场</option></select></label><div className="bottom-actions"><button disabled={busy||!connected} onClick={()=>void run('room:ready',{ready:!self?.ready})}>{self?.ready?'取消准备':'准备'}</button>{host&&<button disabled={!room.canStart||busy||!connected} onClick={()=>void run('room:start',{})}>{room.status==='finished'?'开始下一局':'开始对局'}</button>}</div><p className="subtle">四位玩家全部连接并准备后，房主开始。每人控制自己的笔。</p></>}
 </section>
 {frame&&frame.matchId===room.matchId&&<section className="game online-game"><div className="status"><span>第 {frame.state.turn} 回合</span><strong style={{color:COLORS[frame.state.currentPlayer]}}>{frame.state.phase==='finished'?(frame.state.winner===null?'平局！':`${frame.state.players[frame.state.winner].name} 获胜！`):`轮到 ${frame.state.players[frame.state.currentPlayer].name}`}</strong></div>
 {frame.state.mode==='evolution'&&<div className="online-route">{frame.state.progression.map(type=>PEN_CLASSES[type].name).join(' → ')}</div>}
 <div className="board-stage"><canvas ref={canvas} className="table-canvas" aria-label="在线弹笔桌面"/>{frame.state.phase==='finished'&&<div className="victory" role="alert"><div className="eyebrow">MATCH COMPLETE</div><h2>{frame.state.winner===null?'平局！':`${frame.state.players[frame.state.winner].name} 获胜！`}</h2><p>回到上方大厅，全部准备后房主可开始下一局。</p></div>}</div>
 <div className="players">{frame.state.players.map(player=><div className={`player ${player.id===frame.state.currentPlayer?'active':''}`} key={player.id}><div className="player-heading"><span className="dot" style={{background:COLORS[player.id]}}/><strong>{player.name}</strong></div><div className="player-pen">{PEN_CLASSES[player.penType].name}</div><div className="player-stats"><span>{frame.state.mode==='evolution'?`${player.score}/5 · 阶段 ${player.stage+1}`:player.alive?'存活':'淘汰'}</span><span>震桌 {player.shakeCharge}/1</span></div></div>)}</div>
 <div className="notifications" aria-live="polite">{frame.state.notices.slice(-2).map(n=><div className={`notice ${n.kind}`} key={n.id}>{n.text}</div>)}</div>
 <button className="shake-button" disabled={!connected||busy||aiming||room.paused||frame.state.currentPlayer!==identity.playerId||!frame.state.canShake} onClick={()=>void send({kind:'shake'})}>握笔震桌 · 代替本回合弹笔</button><p className="subtle">桌边 5% 内所有笔都会掉落。进化模式自落降一级，历史分数保留。</p><p className="subtle">{frame.state.phase==='aiming'?'按住自己的笔，向后拖动并释放。':`服务器正在处理：${frame.state.phase}`}</p></section>}
 </>}
 <button className="text-button" onClick={()=>void leave()}>离开在线游戏</button><footer>服务器权威判定 · 无需账号</footer></main>;
}
