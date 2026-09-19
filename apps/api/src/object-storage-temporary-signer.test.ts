import{describe,expect,it}from"vitest";
import{HmacObjectStorageTemporarySigner}from"./object-storage-temporary-signer";
describe("HmacObjectStorageTemporarySigner",()=>{
 it("creates bounded credential-free HTTPS delivery URLs",async()=>{const url=new URL(await new HmacObjectStorageTemporarySigner("https://media.example.test/kairo/","x".repeat(32)).sign({storageProvider:"s3",objectKey:"brand/project/slide 1.png",expiresInSeconds:99_999}));expect(url.origin).toBe("https://media.example.test");expect(url.pathname).toContain("slide%201.png");expect(url.searchParams.get("signature")).toMatch(/^[a-f0-9]{64}$/);expect(Number(url.searchParams.get("expires"))).toBeLessThanOrEqual(Math.floor(Date.now()/1000)+3600)});
 it("rejects unsafe bases and traversal",async()=>{expect(()=>new HmacObjectStorageTemporarySigner("http://media.test/","x".repeat(32))).toThrow(/HTTPS/);const signer=new HmacObjectStorageTemporarySigner("https://media.test/","x".repeat(32));await expect(signer.sign({storageProvider:"s3",objectKey:"../secret",expiresInSeconds:900})).rejects.toThrow(/objectKey/)})
});
