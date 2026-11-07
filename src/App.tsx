import OnlinePlay from './online/OnlinePlay';
import {useEffect,useRef,useState} from 'react';
import {PenBattle,COLORS} from './game/PenBattle';
import {createMatch,WIN_SCORE} from './game/rules';
import {PEN_CLASSES} from './game/pens';
import type {PenType} from './game/pens';
import type {GameSnapshot,GameMode,GamePhase} from './game/types';
function PenIcon({type}:{type:PenType}){
 const p=PEN_CLASSES[type],colors={wooden:'#dbb36b',mechanical:'#ccdce1',ballpoint:'#b8c4ca',highlighter:'#d8e66c',fountain:'#334655'};
 return <svg className="pen-icon" viewBox="-100 -18 200 36" aria-hidden="true"><polygon points={p.outline.map(v=>`${v.x},${v.y}`).join(' ')} fill={colors[type]} stroke="#ffffff55" strokeWidth="1.2"/><path d="M -38 -3 L 22 -3" stroke="#fff9" strokeWidth="2"/>{type==='fountain'&&<path d="M 35 -6 L 56 0 L 35 6 Z" fill="#e8cc8a"/>}</svg>;
}
function Header(){return <header><div className="eyebrow">PEN BATTLE · V2.2</div><h1>弹笔大战</h1><p>真实弹笔 · 四人同桌 · 进化竞技场</p></header>;}
function ModeSelection({onStart,onExit}:{onStart:(mode:GameMode,seed:number)=>void;onExit:()=>void}){
 const [seed,setSeed]=useState(String(Date.now()>>>0));
 const start=(mode:GameMode)=>onStart(mode,Number(seed)>>>0);
 return <main className="app"><Header/><section className="mode-select"><div className="section-label">选择玩法</div><button className="mode-card" onClick={()=>start('classic')}><span className="mode-number">01 / CLASSIC</span><strong>经典淘汰</strong><PenIcon type="ballpoint"/><span>四人金属圆珠笔 · 每人一次震桌<br/>最后留在桌上的玩家获胜</span></button><button className="mode-card evolution-card" onClick={()=>start('evolution')}><span className="mode-number">02 / EVOLUTION</span><strong>进化竞技场</strong><div className="mode-pens">{(['wooden','mechanical','ballpoint','highlighter','fountain'] as PenType[]).map(type=><PenIcon key={type} type={type}/>)}</div><span>木铅笔起步 · 淘汰升级 · 无限重生<br/>先获得 {WIN_SCORE} 次对手淘汰的玩家获胜</span></button><label className="seed-input">对局种子 <input inputMode="numeric" pattern="[0-9]*" value={seed} onChange={e=>setSeed(e.target.value.replace(/\D/g,''))} aria-label="对局种子"/></label><p className="subtle">相同种子可重现进化顺序与出手顺序。</p></section><button className="text-button" onClick={onExit}>返回本地 / 在线选择</button><footer>本地四人轮流 · 无需联网</footer></main>;
}
const phaseLabels:Record<GamePhase,string>={waiting:'准备对局…',aiming:'',hand_animation:'手势准备中…',physics:'等待笔停稳…',falling:'笔正在掉落…',scoring:'结算本次淘汰…',upgrading:'进化升级中…',respawning:'等待安全重生…',next_turn:'切换玩家…',finished:'对局结束'};
function MatchBoard({mode,seed,onExit}:{mode:GameMode;seed:number;onExit:()=>void}){
 const ref=useRef<HTMLCanvasElement>(null),game=useRef<PenBattle|null>(null);
 const [state,setState]=useState<GameSnapshot>(()=>({...createMatch(mode,seed),alive:[true,true,true,true],shakeCharges:[1,1,1,1],canShake:false}));
 useEffect(()=>{if(!ref.current)return;const instance=new PenBattle(ref.current,setState,{mode,seed});game.current=instance;return()=>{instance.destroy();game.current=null;};},[mode,seed]);
 const actor=state.players[state.currentPlayer],winner=state.winner===null?null:state.players[state.winner];
 const status=state.phase==='finished'?(winner?`${winner.name} 获胜！`:'平局！'):state.phase==='aiming'?`轮到${actor.name}`:state.phase==='hand_animation'&&state.activeAction?.type==='shake'?'握笔抬起 · 准备震桌…':phaseLabels[state.phase];
 const recent=state.notices.slice(-2);
 return <main className="app"><Header/><div className="match-meta"><span>{mode==='evolution'?'进化竞技场 · 先得 5 分':'经典模式 · 最后存活'}</span><button className="text-button" onClick={onExit}>切换模式</button></div>
 {mode==='evolution'&&<section className="progression" aria-label="本局进化顺序"><div className="section-label">本局共同进化路线</div><div className="progression-track">{state.progression.map((type,i)=><div className={actor.stage===i?'current-stage':''} key={type}><PenIcon type={type}/><span>{i+1}. {PEN_CLASSES[type].name}</span></div>)}</div></section>}
 <section className="game"><div className="status" aria-live="polite"><span>第 {state.turn} 回合</span><strong style={{color:state.phase==='finished'?'#f8d18b':COLORS[state.currentPlayer]}}>{status}</strong></div>
 <div className="turn-order" aria-label="出手顺序">顺序 {state.turnOrder.map((id,i)=><span key={id} className={id===state.currentPlayer?'turn-current':''} style={{color:COLORS[id]}}>{i>0?'› ':''}{state.players[id].name[0]}</span>)}</div>
 <div className="board-stage"><canvas ref={ref} className="table-canvas" aria-label="弹笔游戏桌面"/>
 {state.phase==='finished'&&<div className="victory" role="alert"><div className="eyebrow">{mode==='evolution'?'ARENA CHAMPION':'LAST PEN STANDING'}</div><h2>{status}</h2><p>{mode==='evolution'&&winner?`${winner.score} 次对手淘汰 · 进化阶段 ${winner.stage+1}/5`:'本局已结束，重新开始或切换玩法。'}</p><button onClick={()=>game.current?.reset()}>再来一局</button></div>}</div>
 <div className="players">{state.players.map(player=><div className={`player ${!player.alive?'out':''} ${player.id===state.currentPlayer?'active':''}`} key={player.id}><div className="player-heading"><span className="dot" style={{background:COLORS[player.id]}}/><strong>{player.name}</strong><span className="score">{mode==='evolution'?`${player.score}/5`:(player.alive?'存活':'淘汰')}</span></div><div className="player-pen"><PenIcon type={player.penType}/><span>{PEN_CLASSES[player.penType].name}</span></div><div className="player-stats"><span>{mode==='evolution'?`阶段 ${player.stage+1}/5`:'经典金属笔'}</span><span>{player.shakeCharge?'震桌 1/1':'震桌已用'}</span></div>{mode==='evolution'&&<div className="stage-dots" aria-label={`升级阶段 ${player.stage+1}`}>{[0,1,2,3,4].map(i=><i key={i} className={i<=player.stage?'reached':''}/>)}</div>}{player.respawn==='pending'&&<small className="pending">等待安全位置重生…</small>}</div>)}</div>
 <div className="notifications" aria-live="polite">{recent.length?recent.map(n=><div key={n.id} className={`notice ${n.kind}`}>{n.text}</div>):<span className="subtle">{mode==='evolution'?'淘汰对手得分升级；自己的动作导致自落，降一级但不扣分。':'按住笔身任意位置，向后拖动蓄力。'}</span>}</div>
 <div className="skill-controls"><button className="shake-button" disabled={!state.canShake} onClick={()=>game.current?.act({type:'shake',playerId:state.currentPlayer})}>握笔震桌 · 剩余 {actor.shakeCharge} 次</button><p>每人每局一次，替代本回合弹笔。握笔敲桌的瞬间，桌边 5% 内的所有笔都会掉落，包括自己的笔。</p></div></section>
 <p className="hint">{state.phase==='aiming'?'按住任意位置，向后拖动，松手弹出。笔尖或笔尾接触会产生旋转。':state.phase==='respawning'?'按确定顺序寻找无碰撞的安全位置；重生完成后再切换玩家。':status}</p>
 <div className="bottom-actions"><button onClick={()=>game.current?.reset()}>↻ 重新开始</button><button className="secondary" onClick={onExit}>选择玩法</button></div>
 <details className="match-details"><summary>对局信息 · 种子 {state.seed}</summary><p>进化模式的进化路线与出手顺序由种子确定。重新开始复用种子并清空分数、升级、震桌次数。</p><p>手部使用轻量关节模型与分层 Canvas 皮肤绘制，为风格化俯视表现，并非照片级手部。</p></details><footer>手机触屏 · 本地四人轮流版</footer></main>;
}
export default function App(){
 const [play,setPlay]=useState<'choose'|'local'|'online'>(()=>/^\/room\/[A-Za-z2-9]{6}$/.test(window.location.pathname)?'online':'choose');
 const [settings,setSettings]=useState<{mode:GameMode;seed:number}|null>(null);
 if(play==='online')return <OnlinePlay onExit={()=>setPlay('choose')}/>;
 if(play==='choose')return <main className="app"><Header/><section className="mode-select"><button className="mode-card" onClick={()=>setPlay('local')}><strong>本地游戏</strong><span>四人同桌，保留经典与进化模式</span></button><button className="mode-card evolution-card" onClick={()=>setPlay('online')}><strong>在线游戏</strong><span>创建六位房间码，邀请朋友一起玩<br/>无需注册 · 四位玩家各自控制</span></button></section></main>;
 return settings?<MatchBoard mode={settings.mode} seed={settings.seed} onExit={()=>setSettings(null)}/>:<ModeSelection onStart={(mode,seed)=>setSettings({mode,seed})} onExit={()=>setPlay('choose')}/>;
}
