import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync=promisify(execFile);
const databaseUrl=process.env.TEST_DATABASE_URL;
const suite=databaseUrl?describe:describe.skip;
const sha="0123456789abcdef0123456789abcdef01234567";

suite("VS-11 bundled API",()=>{
  it("builds and starts with live, ready and version endpoints",async()=>{
    const root=new URL("../../../",import.meta.url).pathname;
    const npm=process.platform==="win32"?"npm.cmd":"npm";
    await execFileAsync(npm,["run","build","--workspace","@kairo/api"],{cwd:root});
    const port=43000+(process.pid%1000);
    let stderr="";
    const child=spawn(process.execPath,[new URL("../dist/server.js",import.meta.url).pathname],{
      cwd:root,
      env:{...process.env,DATABASE_URL:databaseUrl,OIDC_ISSUER:"https://issuer.test",OIDC_AUDIENCE:"kairo-test",OIDC_JWKS_URI:"https://issuer.test/jwks",KAIRO_RELEASE_SHA:sha,HOST:"127.0.0.1",PORT:String(port)},
      stdio:["ignore","ignore","pipe"]
    });
    child.stderr?.on("data",chunk=>{stderr+=String(chunk)});
    try{
      const base=`http://127.0.0.1:${port}`;
      const live=await waitFor(`${base}/health/live`,child,()=>stderr);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({status:"ok"});
      const ready=await fetch(`${base}/health/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({status:"ready"});
      const version=await fetch(`${base}/version`);
      expect(version.status).toBe(200);
      expect(await version.json()).toEqual({releaseSha:sha});
    }finally{
      child.kill("SIGTERM");
    }
  },20000);
});

async function waitFor(url:string,child:ReturnType<typeof spawn>,errors:()=>string):Promise<Response>{
  for(let attempt=0;attempt<50;attempt++){
    if(child.exitCode!==null)throw new Error(`Bundled API exited early: ${errors()}`);
    try{return await fetch(url)}catch{await new Promise(resolve=>setTimeout(resolve,100))}
  }
  throw new Error(`Bundled API did not become live: ${errors()}`);
}
