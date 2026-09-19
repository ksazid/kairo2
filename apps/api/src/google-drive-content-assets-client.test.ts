import { describe, expect, it } from "vitest";
import { GOOGLE_DRIVE_FILE_SCOPE, GoogleDriveAccessError, GoogleDriveContentConnector, GoogleDriveOAuthClient } from "./google-drive-content-assets-client";

function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}})}

describe("VS-60 Google Drive provider client",()=>{
  it("requests only drive.file with offline access and no incremental scope carry-forward",()=>{
    const client=new GoogleDriveOAuthClient("client","x","https://kairo.example/content-assets/google/callback",async()=>json({}) as any);
    const url=new URL(client.authorizationUrl("state-value"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_DRIVE_FILE_SCOPE);
    expect(url.searchParams.get("scope")).not.toContain("drive.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("state")).toBe("state-value");
  });

  it("rejects authorization failures without exposing provider response details",async()=>{
    const client=new GoogleDriveOAuthClient("client","x","https://kairo.example/callback",async()=>json({error:"invalid_grant",error_description:"provider detail"},400) as any);
    await expect(client.exchange("code")).rejects.toMatchObject({name:"GoogleDriveAccessError",reason:"authorization",message:"Google Drive authorization is unavailable"});
  });

  it("indexes metadata only and reports partial results when traversal bounds are reached",async()=>{
    const requests:string[]=[];
    const fetcher=async(input:any)=>{
      const url=new URL(String(input));requests.push(url.toString());
      if(url.pathname.includes("/drive/v3/files/folder-1"))return json({id:"folder-1",name:"Assets",mimeType:"application/vnd.google-apps.folder",trashed:false,capabilities:{canListChildren:true}});
      return json({files:[
        {id:"file-1",name:"Hero.jpg",mimeType:"image/jpeg",size:"120",modifiedTime:"2026-08-18T20:00:00Z",webViewLink:"https://drive.google.com/file/d/file-1/view"},
        {id:"folder-2",name:"More",mimeType:"application/vnd.google-apps.folder",capabilities:{canListChildren:true}},
      ]});
    };
    const connector=new GoogleDriveContentConnector("token",fetcher as any,{maxAssets:1,maxFolders:2,maxPages:2,maxDepth:2});
    const result=await connector.listAssets({externalRootRef:"folder-1"});
    expect(result.assets).toEqual([{externalId:"file-1",name:"Hero.jpg",kind:"image",mimeType:"image/jpeg",sizeBytes:120,modifiedAt:"2026-08-18T20:00:00.000Z",providerRef:"https://drive.google.com/file/d/file-1/view"}]);
    expect(connector.partial).toBe(true);
    expect(requests.every((value)=>!value.includes("alt=media"))).toBe(true);
  });

  it("maps Drive 403/404 to an access-attention error",async()=>{
    const connector=new GoogleDriveContentConnector("token",async()=>json({error:"forbidden"},403) as any);
    await expect(connector.verifyFolder("folder-1")).rejects.toBeInstanceOf(GoogleDriveAccessError);
    await expect(connector.verifyFolder("folder-1")).rejects.toMatchObject({reason:"authorization"});
  });
});
