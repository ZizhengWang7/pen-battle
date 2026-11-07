import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=await mkdtemp(join(tmpdir(),'pen-battle-'));
try {
 const result=await build({entryPoints:['tests/all.test.mjs'],bundle:true,platform:'node',format:'cjs',write:false});
 const file=join(dir,'tests.cjs');await writeFile(file,result.outputFiles[0].contents);
 const run=spawnSync(process.execPath,[file],{stdio:'inherit'});process.exitCode=run.status??1;
} finally {await rm(dir,{recursive:true,force:true});}
