import{describe,expect,it}from"vitest";
import{mapMetaConnectionHealth}from"./meta-channel-connection-postgres";

describe("Meta connection health projection",()=>{
 it("reports permissions, source sync and recovery issue without credentials",()=>{const health=mapMetaConnectionHealth({id:"c1",channel:"instagram",auth_method:"instagram-login",account_ref:"123",display_name:"@brand",status:"connected",token_expires_at:"2026-08-21T00:00:00Z",last_verified_at:"2026-08-20T00:00:00Z",granted_scopes:["instagram_business_basic"],source_status:"active",source_updated_at:"2026-08-20T01:00:00Z"},Date.parse("2026-08-22T00:00:00Z"));expect(health).toMatchObject({healthy:false,issue:"token-expired",grantedScopes:["instagram_business_basic"],sourceStatus:"active",lastSourceSyncAt:"2026-08-20T01:00:00.000Z"});expect(JSON.stringify(health)).not.toContain("token-secret")});
 it("marks a failed source refresh even when the token remains valid",()=>{expect(mapMetaConnectionHealth({id:"c1",channel:"instagram",account_ref:"123",display_name:"Brand",status:"connected",granted_scopes:[],source_status:"failed"},0)).toMatchObject({healthy:false,issue:"source-sync-failed"})});
});
