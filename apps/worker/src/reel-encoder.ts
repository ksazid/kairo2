import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReelEncoderPort } from "./publishable-media";

export interface FfmpegExecutionFile { name:string; bytes:Uint8Array }
export interface FfmpegExecutionRequest {
  executable:string;
  args:string[];
  files:FfmpegExecutionFile[];
  outputFilename:string;
  timeoutMs:number;
  maxOutputBytes:number;
  shell:false;
}
export interface FfmpegExecutionResult { exitCode:number; stderr:string; outputBytes:Uint8Array }
export interface FfmpegExecutionPort { run(request:FfmpegExecutionRequest):Promise<FfmpegExecutionResult> }

interface EncoderOptions { timeoutMs?:number; maxOutputBytes?:number }
const PNG_SIGNATURE=[137,80,78,71,13,10,26,10] as const;

export class FfmpegReelEncoder implements ReelEncoderPort {
  readonly version="ffmpeg-h264-v1";
  private readonly timeoutMs:number;
  private readonly maxOutputBytes:number;
  constructor(private readonly executable:string,private readonly execution:FfmpegExecutionPort=new NodeFfmpegExecutionPort(),options:EncoderOptions={}){
    if(typeof executable!=="string"||!executable.trim()||executable.includes("\0")||executable.length>500)throw new Error("FFmpeg executable is invalid");
    this.timeoutMs=boundedInt(options.timeoutMs??60_000,"timeoutMs",1,300_000);
    this.maxOutputBytes=boundedInt(options.maxOutputBytes??100*1024*1024,"maxOutputBytes",1,512*1024*1024);
  }
  async encode(input:{sourceFingerprint:string;frames:{bytes:Uint8Array;durationSeconds:number}[]}):Promise<{contentType:"video/mp4";bytes:Uint8Array}>{
    if(!/^[a-f0-9]{64}$/.test(input?.sourceFingerprint??""))throw new Error("Reel source fingerprint is invalid");
    if(!Array.isArray(input.frames)||input.frames.length<1||input.frames.length>120)throw new Error("Reel encoder requires 1 to 120 frames");
    const files:FfmpegExecutionFile[]=[];const concat:string[]=[];let total=0;
    input.frames.forEach((frame,index)=>{
      if(!(frame?.bytes instanceof Uint8Array)||frame.bytes.byteLength<PNG_SIGNATURE.length||!PNG_SIGNATURE.every((value,i)=>frame.bytes[i]===value))throw new Error("Reel encoder frame must be a PNG");
      if(typeof frame.durationSeconds!=="number"||!Number.isFinite(frame.durationSeconds)||frame.durationSeconds<=0||frame.durationSeconds>600)throw new Error("Reel frame duration is invalid");
      total+=frame.durationSeconds;if(total>600)throw new Error("Reel duration exceeds configured encoder bound");
      const name=`frame-${String(index).padStart(3,"0")}.png`;files.push({name,bytes:frame.bytes});concat.push(`file '${name}'`,`duration ${formatDuration(frame.durationSeconds)}`);
    });
    const lastName=files[files.length-1]!.name;concat.push(`file '${lastName}'`);
    files.push({name:"frames.txt",bytes:new TextEncoder().encode(`${concat.join("\n")}\n`)});
    const args=[
      "-hide_banner","-loglevel","error","-nostdin","-y",
      "-protocol_whitelist","file,pipe","-f","concat","-safe","1","-i","frames.txt",
      "-an","-vf","scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v","libx264","-preset","medium","-crf","20","-pix_fmt","yuv420p","-threads","1",
      "-movflags","+faststart","-map_metadata","-1","-metadata","creation_time=1970-01-01T00:00:00Z",
      "-fflags","+bitexact","-flags:v","+bitexact","output.mp4",
    ];
    const result=await this.execution.run({executable:this.executable,args,files,outputFilename:"output.mp4",timeoutMs:this.timeoutMs,maxOutputBytes:this.maxOutputBytes,shell:false});
    if(result.exitCode!==0)throw new Error(`FFmpeg encoder failed${result.stderr?`: ${boundedMessage(result.stderr)}`:""}`);
    if(!(result.outputBytes instanceof Uint8Array)||result.outputBytes.byteLength<12)throw new Error("FFmpeg encoder did not produce a valid MP4");
    if(result.outputBytes.byteLength>this.maxOutputBytes)throw new Error("FFmpeg encoded output exceeds configured size bound");
    if(result.outputBytes[4]!==0x66||result.outputBytes[5]!==0x74||result.outputBytes[6]!==0x79||result.outputBytes[7]!==0x70)throw new Error("FFmpeg output is missing MP4 ftyp signature");
    return{contentType:"video/mp4",bytes:result.outputBytes};
  }
}

export class NodeFfmpegExecutionPort implements FfmpegExecutionPort {
  async run(request:FfmpegExecutionRequest):Promise<FfmpegExecutionResult>{
    validateRequest(request);
    const dir=await mkdtemp(join(tmpdir(),"kairo-reel-"));
    try{
      for(const file of request.files)await writeFile(join(dir,file.name),file.bytes,{flag:"wx"});
      let stderr="",timedOut=false;
      const child=spawn(request.executable,request.args,{cwd:dir,shell:false,stdio:["ignore","ignore","pipe"],windowsHide:true});
      child.stderr?.on("data",chunk=>{if(stderr.length<65_536)stderr+=(Buffer.isBuffer(chunk)?chunk.toString("utf8"):String(chunk)).slice(0,65_536-stderr.length)});
      const exitCode=await new Promise<number>((resolve,reject)=>{
        const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL")},request.timeoutMs);
        child.once("error",error=>{clearTimeout(timer);reject(error)});
        child.once("close",code=>{clearTimeout(timer);resolve(code??-1)});
      });
      if(timedOut)throw new Error("FFmpeg execution timed out");
      if(exitCode!==0)return{exitCode,stderr:boundedMessage(stderr),outputBytes:new Uint8Array()};
      const outputPath=join(dir,request.outputFilename),info=await stat(outputPath);
      if(!info.isFile())throw new Error("FFmpeg output is not a file");
      if(info.size>request.maxOutputBytes)throw new Error("FFmpeg encoded output exceeds configured size bound");
      const bytes=await readFile(outputPath);
      return{exitCode,stderr:boundedMessage(stderr),outputBytes:new Uint8Array(bytes)};
    }finally{await rm(dir,{recursive:true,force:true})}
  }
}

function validateRequest(request:FfmpegExecutionRequest){
  if(request.shell!==false)throw new Error("FFmpeg execution must not use a shell");
  if(typeof request.executable!=="string"||!request.executable.trim()||request.executable.includes("\0"))throw new Error("FFmpeg executable is invalid");
  if(!Array.isArray(request.args)||!request.args.length||request.args.some(arg=>typeof arg!=="string"||arg.includes("\0")))throw new Error("FFmpeg arguments are invalid");
  if(!Array.isArray(request.files)||!request.files.length)throw new Error("FFmpeg input files are required");
  for(const file of request.files)if(!/^[A-Za-z0-9._-]+$/.test(file.name)||file.name==="."||file.name===".."||!(file.bytes instanceof Uint8Array))throw new Error("FFmpeg input file is invalid");
  if(!/^[A-Za-z0-9._-]+$/.test(request.outputFilename))throw new Error("FFmpeg output filename is invalid");
  boundedInt(request.timeoutMs,"timeoutMs",1,300_000);boundedInt(request.maxOutputBytes,"maxOutputBytes",1,512*1024*1024);
}
function formatDuration(value:number){const text=value.toFixed(3).replace(/0+$/,"" ).replace(/\.$/,"");return text||"0"}
function boundedMessage(value:string){return value.replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,500)}
function boundedInt(value:number,name:string,min:number,max:number){if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} is invalid`);return value}
