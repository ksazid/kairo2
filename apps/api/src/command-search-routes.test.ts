import { describe, expect, it, vi } from "vitest";
import type { ExternalIdentity } from "@kairo/contracts";
import { buildApp } from "./app";
import type { IdentityVerifier } from "./auth";
import type { CommandSearchRepository } from "./command-search";
import { registerCommandSearchRoutes } from "./command-search-routes";
import { MemoryKairoRepository } from "./store";

class TestVerifier implements IdentityVerifier {
  async verify(header: string | undefined): Promise<ExternalIdentity | null> {
    return header === "Bearer valid" ? {provider:"issuer",subject:"alice",email:"alice@example.com"} : null;
  }
}

function setup(search: CommandSearchRepository) {
  const store = new MemoryKairoRepository();
  const verifier = new TestVerifier();
  const app = buildApp({store,identityVerifier:verifier});
  registerCommandSearchRoutes(app,{coreStore:store,identityVerifier:verifier,search});
  return app;
}

describe("command search routes", () => {
  it("runs an account-scoped search only after a valid query is supplied", async () => {
    const search: CommandSearchRepository = {search:vi.fn(async()=>[{kind:"brand" as const,id:"brand-1",brandId:"brand-1",brandName:"Kairo",label:"Kairo",detail:"Brand",href:"/brands/brand-1/brain"}])};
    const app = setup(search);
    const response = await app.inject({method:"GET",url:"/api/v1/command-search?q=kairo&limit=8",headers:{authorization:"Bearer valid"}});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({query:"kairo",scope:{},results:[{kind:"brand",label:"Kairo"}]});
    expect(search.search).toHaveBeenCalledWith(expect.any(String),{query:"kairo",limit:8});
    await app.close();
  });

  it("passes an explicit Brand boundary to the repository", async () => {
    const search: CommandSearchRepository = {search:vi.fn(async()=>[])};
    const app = setup(search);
    const response = await app.inject({method:"GET",url:"/api/v1/command-search?q=launch&brandId=brand-2",headers:{authorization:"Bearer valid"}});
    expect(response.statusCode).toBe(200);
    expect(response.json().scope).toEqual({brandId:"brand-2"});
    expect(search.search).toHaveBeenCalledWith(expect.any(String),{query:"launch",brandId:"brand-2",limit:12});
    await app.close();
  });

  it("rejects eager blank searches and unauthenticated requests", async () => {
    const search: CommandSearchRepository = {search:vi.fn(async()=>[])};
    const app = setup(search);
    expect((await app.inject({method:"GET",url:"/api/v1/command-search?q=x",headers:{authorization:"Bearer valid"}})).statusCode).toBe(400);
    expect((await app.inject({method:"GET",url:"/api/v1/command-search?q=kairo"})).statusCode).toBe(401);
    expect(search.search).not.toHaveBeenCalled();
    await app.close();
  });
});
