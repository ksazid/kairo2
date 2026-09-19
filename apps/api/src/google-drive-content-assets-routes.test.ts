import { describe, expect, it } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import type { IdentityVerifier } from "./auth";
import { buildApp } from "./app";
import { MemoryKairoRepository } from "./store";
import { registerGoogleDriveContentAssetRoutes } from "./google-drive-content-assets-routes";

class Verifier implements IdentityVerifier {
  async verify(value:string|undefined):Promise<ExternalIdentity|null>{return value?.startsWith("Bearer test:")?{provider:"test",subject:value.slice(12)}:null;}
}

describe("VS-60 Google Drive Content Asset routes",()=>{
  it("keeps the API healthy when provider configuration is absent",async()=>{
    const core=new MemoryKairoRepository(),verifier=new Verifier();
    const app=buildApp({store:core,identityVerifier:verifier});
    registerGoogleDriveContentAssetRoutes(app,{coreStore:core,identityVerifier:verifier});
    expect((await app.inject({method:"GET",url:"/api/v1/content-assets/google-drive/capability"})).statusCode).toBe(401);
    const setup=await app.inject({method:"POST",url:"/api/v1/workspaces",headers:{authorization:"Bearer test:alice"},payload:{workspaceName:"Studio",brandName:"Kairo"}});
    const brandId=setup.json().brand.id as string;
    const capability=await app.inject({method:"GET",url:"/api/v1/content-assets/google-drive/capability",headers:{authorization:"Bearer test:alice"}});
    expect(capability.statusCode).toBe(200);
    expect(capability.json()).toEqual({enabled:false});
    const unavailable=await app.inject({method:"POST",url:`/api/v1/brands/${brandId}/content-asset-libraries/library-1/google-drive/connect`,headers:{authorization:"Bearer test:alice"}});
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({code:"provider_unavailable"});
    await app.close();
  });
});
