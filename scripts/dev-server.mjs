import {context} from 'esbuild';
import {spawn} from 'node:child_process';
const build=await context({entryPoints:['server/index.ts'],bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',outfile:'dist-server/index.mjs',sourcemap:true});
await build.rebuild();await build.watch();
const child=spawn(process.execPath,['--watch','dist-server/index.mjs'],{stdio:'inherit'});
let closing=false;
async function close(){if(closing)return;closing=true;child.kill('SIGTERM');await build.dispose();}
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void close();});
child.once('exit',async code=>{await close();process.exitCode=code??0;});
