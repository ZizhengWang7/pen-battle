import {build} from 'esbuild';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir,cpus,platform,arch} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runScenario} from '../tests/load.test.mjs';
const counts=process.argv.slice(2).map(Number);const scenarios=counts.length?counts:[5,10,25];
if(scenarios.some(n=>![5,10,25].includes(n)))throw new Error('Choose local scenarios 5, 10 or 25 rooms.');
const temp=await mkdtemp(join(tmpdir(),'pen-load-'));const report={recordedAt:new Date().toISOString(),environment:{node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0].model,logicalCpus:cpus().length},cyclesPerRoom:8,scope:'Isolated loopback Socket.IO server in its own child process; no production traffic. Server CPU and RSS only. All clients share loopback IP, so join/create rate limits are raised for this test. No gameplay/identity validation is disabled.',scenarios:[]};
try{
 report.serverSourceSha256=createHash('sha256').update((await Promise.all(['server/service.ts','server/config.ts','src/game/MatchEngine.ts','src/game/physics.ts','src/game/pens.ts'].map(file=>readFile(file)))).map(b=>b.toString()).join('\n')).digest('hex');
 await mkdir('docs/benchmarks',{recursive:true});
 const built=await build({entryPoints:['tests/load-worker.mjs'],bundle:true,packages:'external',platform:'node',format:'cjs',write:false});const worker=join(temp,'worker.cjs');await writeFile(worker,built.outputFiles[0].contents);
 for(const rooms of scenarios){console.log(`Starting isolated ${rooms}-room / ${rooms*4}-player scenario…`);const result=await runScenario(worker,rooms);report.scenarios.push(result);await writeFile('docs/benchmarks/v2.2-local.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(result,null,2));}
 await mkdir('docs/benchmarks',{recursive:true});await writeFile('docs/benchmarks/v2.2-local.json',JSON.stringify(report,null,2)+'\n');
}finally{await rm(temp,{recursive:true,force:true});}
