import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=await mkdtemp(join(tmpdir(),'pen-online-'));
try{
 const result=await build({entryPoints:['tests/online.test.mjs'],bundle:true,packages:'external',platform:'node',format:'cjs',write:false});
 const file=join(dir,'online.cjs');await writeFile(file,result.outputFiles[0].contents);
 const run=spawnSync(process.execPath,[file],{stdio:'inherit',timeout:90000,env:{...process.env,NODE_PATH:resolve('node_modules')}});if(run.error)console.error(run.error.message);process.exitCode=run.status??1;
}finally{await rm(dir,{recursive:true,force:true});}
