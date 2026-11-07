import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {BattleServer} from '../server/service.ts';
const rooms=Number(process.env.LOAD_ROOMS),server=new BattleServer({maxRooms:rooms+2,maxConnections:rooms*4+10,creationLimit:rooms*4+10,joinLimit:rooms*8+10,resumeLimit:rooms*4+10});
const delay=monitorEventLoopDelay({resolution:10});let started=0,cpu,peak=process.memoryUsage().rss,peakCpu=0,lastCpu,lastTime;
const sampling=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);if(lastCpu){const now=performance.now(),used=process.cpuUsage(lastCpu);peakCpu=Math.max(peakCpu,(used.user+used.system)/(now-lastTime)/10);lastCpu=process.cpuUsage();lastTime=now;}},100);
let closing=false;async function close(){if(closing)return;closing=true;clearInterval(sampling);await server.close();process.exit(0);}
process.once('disconnect',()=>void close());for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>void close());
process.on('message',async message=>{
 if(message==='measure:start'){delay.enable();delay.reset();started=performance.now();cpu=process.cpuUsage();lastCpu=cpu;lastTime=started;process.send({type:'measuring'});}
 if(message==='measure:stop'){
  const wall=performance.now()-started,used=process.cpuUsage(cpu);delay.disable();process.send({type:'metrics',durationMs:wall,cpuPercentOneCore:(used.user+used.system)/wall/10,peakCpuPercentOneCore:peakCpu,peakRssMiB:Math.max(peak,process.resourceUsage().maxRSS*1024)/1048576,eventLoopDelayMs:{mean:delay.mean/1e6,p95:delay.percentile(95)/1e6,p99:delay.percentile(99)/1e6,max:delay.max/1e6}});
 }
 if(message==='close')await close();
});
server.listen(0,'127.0.0.1').then(port=>process.send({type:'ready',port})).catch(error=>{console.error(error.message);process.exit(1);});
