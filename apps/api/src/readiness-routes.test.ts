import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerReadinessRoutes } from "./readiness-routes";

const sha="0123456789abcdef0123456789abcdef01234567";

describe("readiness routes",()=>{
  it("serves healthy state",async()=>{const app=Fastify();registerReadinessRoutes(app,{releaseSha:sha,check:async()=>{}});expect((await app.inject({method:"GET",url:"/health/ready"})).statusCode).toBe(200);expect((await app.inject({method:"GET",url:"/version"})).json()).toEqual({releaseSha:sha});await app.close()});
  it("serves unavailable state",async()=>{const app=Fastify();registerReadinessRoutes(app,{releaseSha:sha,check:async()=>{throw new Error("x")}});const response=await app.inject({method:"GET",url:"/health/ready"});expect(response.statusCode).toBe(503);expect(response.json()).toEqual({status:"not-ready"});await app.close()});
});
