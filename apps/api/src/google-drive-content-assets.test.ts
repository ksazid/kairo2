import { describe, expect, it } from "vitest";
import { GOOGLE_DRIVE_FILE_SCOPE, GoogleDriveAccessError } from "./google-drive-content-assets-client";
import { GoogleDriveContentAssetService, hashGoogleDriveState, type GoogleDriveConnectionRepository, type GoogleDriveCredentialVault, type GoogleDriveOAuthIntent, type GoogleDriveProviderConnection } from "./google-drive-content-assets";
import { matchesContentAsset, type ContentAssetLibrary, type ContentAssetLibraryQuery, type ContentAssetLibraryRepository, type ContentAssetProviderStateInput, type ContentLibraryAsset } from "@kairo/domain/content-asset-library";

class Libraries implements ContentAssetLibraryRepository {
  libraries: ContentAssetLibrary[]=[{id:"library-1",workspaceId:"workspace-1",brandId:"brand-1",name:"Photos",provider:"google-drive",status:"not-connected",createdAt:"2026-08-18T20:00:00Z",updatedAt:"2026-08-18T20:00:00Z"}];
  assets: ContentLibraryAsset[]=[];
  failClear=false;
  async saveLibrary(_accountId:string,library:ContentAssetLibrary){this.libraries.push(library);return library;}
  async listLibraries(_accountId:string,brandId:string){return this.libraries.filter((item)=>item.brandId===brandId);}
  async getLibrary(_accountId:string,brandId:string,libraryId:string){return this.libraries.find((item)=>item.brandId===brandId&&item.id===libraryId)??null;}
  async listAssets(_accountId:string,brandId:string,query:ContentAssetLibraryQuery={}){return this.assets.filter((asset)=>asset.brandId===brandId&&matchesContentAsset(asset,query));}
  async replaceIndexedAssets(_accountId:string,library:ContentAssetLibrary,assets:ContentLibraryAsset[]){this.assets=[...this.assets.filter((asset)=>asset.libraryId!==library.id),...assets];}
  async updateProviderState(_accountId:string,brandId:string,libraryId:string,input:ContentAssetProviderStateInput){const library=this.libraries.find((item)=>item.brandId===brandId&&item.id===libraryId);if(!library)throw new Error("missing library");const updated:{[K in keyof ContentAssetLibrary]:ContentAssetLibrary[K]}={...library,status:input.status};if(input.clearRoot){delete updated.externalRootRef;delete updated.providerLabel;}if(input.externalRootRef)updated.externalRootRef=input.externalRootRef;if(input.providerLabel)updated.providerLabel=input.providerLabel;updated.updatedAt="2026-08-18T20:00:00Z";this.libraries=this.libraries.map((item)=>item.id===libraryId?updated:item);return updated;}
  async clearIndexedAssets(_accountId:string,brandId:string,libraryId:string){if(this.failClear)throw new Error("clear failed");this.assets=this.assets.filter((asset)=>asset.brandId!==brandId||asset.libraryId!==libraryId);}
}
class Connections implements GoogleDriveConnectionRepository {
  intents:GoogleDriveOAuthIntent[]=[]; connections:GoogleDriveProviderConnection[]=[]; attention=0;
  async createIntent(intent:GoogleDriveOAuthIntent){this.intents.push(intent);}
  async consumeIntent(accountId:string,stateHash:string,at:string){const intent=this.intents.find((item)=>item.accountId===accountId&&item.stateHash===stateHash&&!item.consumedAt&&item.expiresAt>=at);if(!intent)return null;intent.consumedAt=at;return intent;}
  async getConnection(_accountId:string,brandId:string,libraryId:string){return this.connections.find((item)=>item.brandId===brandId&&item.libraryId===libraryId&&!item.revokedAt)??null;}
  async saveConnection(_accountId:string,connection:GoogleDriveProviderConnection){const old=this.connections.find((item)=>item.libraryId===connection.libraryId&&!item.revokedAt);this.connections=this.connections.filter((item)=>item.libraryId!==connection.libraryId);this.connections.push(connection);return{connection,previousCredentialRefs:old?[old.credentialRef]:[]};}
  async markNeedsAttention(){this.attention++;}
  async revokeConnection(_accountId:string,brandId:string,libraryId:string,at:string){const connection=this.connections.find((item)=>item.brandId===brandId&&item.libraryId===libraryId);if(connection)connection.revokedAt=at;}
}
class Vault implements GoogleDriveCredentialVault {
  values=new Map<string,string>(); revoked:string[]=[];
  async store(_workspaceId:string,_brandId:string,ref:string,value:string){this.values.set(ref,value);}
  async resolve(ref:string){const value=this.values.get(ref);if(!value)throw new Error("missing credential");return value;}
  async revoke(ref:string){this.values.delete(ref);this.revoked.push(ref);}
}
function brands(){return{getBrandForAccount:async(accountId:string,brandId:string)=>accountId==="account-1"&&brandId==="brand-1"?{id:"brand-1",workspaceId:"workspace-1",name:"Brand"}:null} as any;}
function fixture(options:{connectorFactory?:(accessToken:string)=>any;refreshError?:Error}={}){
  const libraries=new Libraries(),connections=new Connections(),vault=new Vault();let exchangeCalls=0,refreshCalls=0;
  const oauth={authorizationUrl:(state:string)=>`https://accounts.google.test/oauth?state=${encodeURIComponent(state)}`,async exchange(){exchangeCalls++;return{accessToken:"access",refreshToken:"fixture-refresh",expiresInSeconds:3600,grantedScopes:[GOOGLE_DRIVE_FILE_SCOPE]};},async refresh(){refreshCalls++;if(options.refreshError)throw options.refreshError;return{accessToken:"refreshed",expiresInSeconds:3600,grantedScopes:[GOOGLE_DRIVE_FILE_SCOPE]};}};
  const service=new GoogleDriveContentAssetService({brands:brands(),libraries,connections,vault,oauth,picker:{developerKey:"browser-key",appId:"123"},...(options.connectorFactory?{connectorFactory:options.connectorFactory}:{}),now:()=>new Date("2026-08-18T20:00:00Z"),stateBytes:()=>Uint8Array.from({length:32},(_,i)=>i+1),id:(()=>{let i=0;return()=>`id-${++i}`})()});
  return{service,libraries,connections,vault,get exchangeCalls(){return exchangeCalls},get refreshCalls(){return refreshCalls}};
}
async function connected(f:ReturnType<typeof fixture>){const started=await f.service.begin("account-1","brand-1","library-1");const state=new URL(started.authorizationUrl).searchParams.get("state")!;await f.service.complete("account-1","code",state);}

describe("VS-60 Google Drive Content Asset connection",()=>{
  it("authorizes the Brand before creating an OAuth intent",async()=>{
    const f=fixture();
    await expect(f.service.begin("account-2","brand-1","library-1")).rejects.toMatchObject({code:"resource_not_found"});
    expect(f.connections.intents).toHaveLength(0);
  });

  it("stores only a hashed one-time state and rejects callback replay",async()=>{
    const f=fixture();
    const started=await f.service.begin("account-1","brand-1","library-1");
    const state=new URL(started.authorizationUrl).searchParams.get("state")!;
    expect(f.connections.intents[0]?.stateHash).toBe(hashGoogleDriveState(state));
    expect(JSON.stringify(f.connections.intents[0])).not.toContain(state);
    const completed=await f.service.complete("account-1","code-1",state);
    expect(completed).toMatchObject({brandId:"brand-1",libraryId:"library-1",status:"connected"});
    expect(f.exchangeCalls).toBe(1);
    expect([...f.vault.values.values()]).toEqual(["fixture-refresh"]);
    await expect(f.service.complete("account-1","code-2",state)).rejects.toThrow(/invalid, expired or already used/);
    expect(f.exchangeCalls).toBe(1);
  });

  it("fails closed if reconnect persistence stops after the new connection is saved",async()=>{
    const f=fixture();
    const previous:GoogleDriveProviderConnection={id:"old-connection",workspaceId:"workspace-1",brandId:"brand-1",libraryId:"library-1",provider:"google-drive",credentialRef:"old-credential",grantedScopes:[GOOGLE_DRIVE_FILE_SCOPE],connectedAt:"2026-08-18T19:00:00Z",lastVerifiedAt:"2026-08-18T19:00:00Z"};
    f.connections.connections.push(previous);
    f.vault.values.set(previous.credentialRef,"fixture-old");
    f.libraries.failClear=true;
    const started=await f.service.begin("account-1","brand-1","library-1");
    const state=new URL(started.authorizationUrl).searchParams.get("state")!;
    await expect(f.service.complete("account-1","code",state)).rejects.toThrow("clear failed");
    expect(await f.connections.getConnection("account-1","brand-1","library-1")).toBeNull();
    expect(f.vault.values.size).toBe(0);
    expect(f.vault.revoked).toContain("old-credential");
    expect(f.vault.revoked).toHaveLength(2);
    expect(f.libraries.libraries[0]).toMatchObject({status:"needs-attention"});
  });

  it("never exposes the refresh credential while issuing a short-lived Picker token",async()=>{
    const f=fixture();await connected(f);
    const picker=await f.service.pickerConfig("account-1","brand-1","library-1");
    expect(picker).toEqual({accessToken:"refreshed",expiresInSeconds:3600,developerKey:"browser-key",appId:"123"});
    expect(JSON.stringify(picker)).not.toContain("fixture-refresh");
    expect(f.refreshCalls).toBe(1);
  });

  it("verifies a selected root and marks bounded partial indexing as needs attention",async()=>{
    const connector={provider:"google-drive" as const,partial:true,async verifyFolder(){return{id:"folder-1",name:"Approved Assets"};},async listAssets(){return{assets:[{externalId:"file-1",name:"Hero.jpg",kind:"image" as const,mimeType:"image/jpeg",providerRef:"https://drive.google.com/file/d/file-1/view"}]};}};
    const f=fixture({connectorFactory:()=>connector});await connected(f);
    await f.service.selectRoot("account-1","brand-1","library-1","folder-1");
    const indexed=await f.service.index("account-1","brand-1","library-1");
    expect(indexed).toEqual({indexedCount:1,partial:true});
    expect(f.libraries.libraries[0]).toMatchObject({externalRootRef:"folder-1",providerLabel:"Approved Assets",status:"needs-attention"});
    expect(f.libraries.assets[0]?.id).toBe("library-1:file-1");
  });

  it("does not downgrade a healthy connection for a transient provider outage",async()=>{
    const f=fixture({refreshError:new GoogleDriveAccessError("unavailable","temporary")});await connected(f);
    await expect(f.service.pickerConfig("account-1","brand-1","library-1")).rejects.toThrow("temporarily unavailable");
    expect(f.connections.attention).toBe(0);
    expect(f.libraries.libraries[0]?.status).toBe("connected");
  });

  it("marks an authorization failure as needs attention",async()=>{
    const f=fixture({refreshError:new GoogleDriveAccessError("authorization","revoked")});await connected(f);
    await expect(f.service.pickerConfig("account-1","brand-1","library-1")).rejects.toThrow("Reconnect");
    expect(f.connections.attention).toBe(1);
    expect(f.libraries.libraries[0]?.status).toBe("needs-attention");
  });

  it("disconnects locally, clears stale metadata and revokes the encrypted credential",async()=>{
    const f=fixture();await connected(f);
    await f.libraries.updateProviderState("account-1","brand-1","library-1",{status:"connected",externalRootRef:"folder-1",providerLabel:"Assets"});
    f.libraries.assets.push({id:"library-1:file",workspaceId:"workspace-1",brandId:"brand-1",libraryId:"library-1",externalId:"file",name:"Old.jpg",kind:"image",mimeType:"image/jpeg",indexedAt:"2026-08-18T20:00:00Z"});
    await f.service.disconnect("account-1","brand-1","library-1");
    expect(f.vault.values.size).toBe(0);
    expect(f.vault.revoked).toHaveLength(1);
    expect(f.libraries.assets).toHaveLength(0);
    expect(f.libraries.libraries[0]).toMatchObject({status:"not-connected"});
    expect(f.libraries.libraries[0]?.externalRootRef).toBeUndefined();
  });
});
