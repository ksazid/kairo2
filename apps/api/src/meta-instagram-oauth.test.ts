import { describe, expect, it } from "vitest";
import { MetaInstagramOAuthClient, metaInstagramRequestedScopes } from "./meta-instagram-oauth";

describe("VS-17 Meta Instagram OAuth adapter", () => {
  it("requests business_management so managed Facebook Pages can be discovered", () => {
    const client = new MetaInstagramOAuthClient(
      "app-1",
      "top-secret",
      "v99.0",
      "https://kairo.example/channels/instagram/callback",
      async () => { throw new Error("fetch should not be called"); },
    );
    const authorization = new URL(client.authorizationUrl("state-value"));
    const scopes = authorization.searchParams.get("scope")?.split(",") ?? [];
    expect(scopes).toContain("business_management");
    expect(metaInstagramRequestedScopes()).toContain("business_management");
  });

  it("keeps secrets out of URLs and extends the Facebook User token before Insights use", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let oauthCalls = 0;
    const client = new MetaInstagramOAuthClient(
      "app-1",
      "top-secret",
      "v99.0",
      "https://kairo.example/channels/instagram/callback",
      async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/oauth/access_token")) {
          oauthCalls++;
          const body = String(init?.body ?? "");
          if (body.includes("grant_type=fb_exchange_token")) {
            expect(body).toContain("fb_exchange_token=short-user-token");
            return new Response(JSON.stringify({ access_token: "long-user-token", expires_in: 5_184_000 }), { status: 200 });
          }
          return new Response(JSON.stringify({ access_token: "short-user-token" }), { status: 200 });
        }
        if (url.endsWith("/me/permissions")) {
          return new Response(JSON.stringify({ data: metaInstagramRequestedScopes().map((permission) => ({ permission, status: "granted" })) }), { status: 200 });
        }
        if (url.includes("/me/accounts")) {
          return new Response(JSON.stringify({ data: [
            { id: "page-1", name: "Page One", access_token: "page-token", instagram_business_account: { id: "111" } },
            { id: "page-2", name: "No Instagram", access_token: "unused" },
          ] }), { status: 200 });
        }
        if (url.includes("/111?")) {
          return new Response(JSON.stringify({ id: "111", username: "brandone", name: "Brand One" }), { status: 200 });
        }
        throw new Error(`unexpected ${url}`);
      },
    );
    const authorize = client.authorizationUrl("state-value");
    expect(authorize).toContain("client_id=app-1");
    expect(authorize).not.toContain("top-secret");
    expect(authorize).not.toContain("user-token");
    const result = await client.exchangeAndDiscover("auth-code");
    expect(oauthCalls).toBe(2);
    expect(result.userAccessToken).toBe("long-user-token");
    expect(result.userAccessTokenExpiresInSeconds).toBe(5_184_000);
    expect(result.accounts).toEqual([{ pageRef: "page-1", pageName: "Page One", accountRef: "111", displayName: "Brand One", username: "brandone", pageAccessToken: "page-token" }]);
    expect(calls.every((call) => !call.url.includes("top-secret") && !call.url.includes("page-token") && !call.url.includes("short-user-token") && !call.url.includes("long-user-token"))).toBe(true);
    const oauthBodies = calls.filter((call) => call.url.endsWith("/oauth/access_token")).map((call) => String(call.init?.body));
    expect(oauthBodies.every((body) => body.includes("client_secret=top-secret"))).toBe(true);
    expect(calls.filter((call) => call.url.includes("/me/")).every((call) => new Headers(call.init?.headers).get("authorization") === "Bearer long-user-token")).toBe(true);
  });

  it("accepts Meta extended tokens that omit expires_in using a conservative 60-day operational horizon", async () => {
    const client = new MetaInstagramOAuthClient(
      "app-1",
      "top-secret",
      "v99.0",
      "https://kairo.example/channels/instagram/callback",
      async (input, init) => {
        const url = String(input);
        if (url.endsWith("/oauth/access_token")) {
          const body = String(init?.body ?? "");
          if (body.includes("grant_type=fb_exchange_token")) {
            return new Response(JSON.stringify({ access_token: "long-user-token", token_type: "bearer" }), { status: 200 });
          }
          return new Response(JSON.stringify({ access_token: "short-user-token" }), { status: 200 });
        }
        if (url.endsWith("/me/permissions")) {
          return new Response(JSON.stringify({ data: metaInstagramRequestedScopes().map((permission) => ({ permission, status: "granted" })) }), { status: 200 });
        }
        if (url.includes("/me/accounts")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        throw new Error(`unexpected ${url}`);
      },
    );

    const result = await client.exchangeAndDiscover("auth-code");
    expect(result.userAccessToken).toBe("long-user-token");
    expect(result.userAccessTokenExpiresInSeconds).toBe(60 * 24 * 60 * 60);
  });

  it("still rejects an explicitly short-lived extended token", async () => {
    const client = new MetaInstagramOAuthClient(
      "app-1",
      "top-secret",
      "v99.0",
      "https://kairo.example/channels/instagram/callback",
      async (input, init) => {
        const url = String(input);
        if (url.endsWith("/oauth/access_token")) {
          const body = String(init?.body ?? "");
          if (body.includes("grant_type=fb_exchange_token")) {
            return new Response(JSON.stringify({ access_token: "too-short", expires_in: 3_600 }), { status: 200 });
          }
          return new Response(JSON.stringify({ access_token: "short-user-token" }), { status: 200 });
        }
        throw new Error(`unexpected ${url}`);
      },
    );

    await expect(client.exchangeAndDiscover("auth-code")).rejects.toThrow("sufficiently durable Facebook User access token");
  });

  it("imports a bounded sanitized profile and recent-media snapshot without putting credentials in URLs", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const client = new MetaInstagramOAuthClient("app-1", "top-secret", "v99.0", "https://kairo.example/channels/instagram/callback", async (input, init) => {
      const url = String(input);
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      if (url.includes("/111/media?")) return new Response(JSON.stringify({ data: [
        { id: "m1", caption: "Hello", media_type: "IMAGE", media_product_type: "FEED", permalink: "https://www.instagram.com/p/m1/", media_url: "https://cdn.example/m1.jpg", thumbnail_url: "http://unsafe.example/m1.jpg", like_count: 42, comments_count: 4, timestamp: "2026-08-14T10:00:00Z" },
        { id: "m2", caption: "x".repeat(3_000), media_type: "VIDEO", permalink: "javascript:bad" },
        { caption: "missing id" },
      ] }), { status: 200 });
      if (url.includes("/999?")) return new Response(JSON.stringify({ category: "Marketing Agency", about: "Page-level positioning", website: "https://page.example", phone: "+356 2000 0000", emails: ["HELLO@BRAND.EXAMPLE", "invalid"] }), { status: 200 });
      if (url.includes("/111?")) return new Response(JSON.stringify({ id: "111", username: "brandone", name: "Brand One", biography: "Useful bio", website: "https://brand.example", profile_picture_url: "http://unsafe.example/avatar.png", followers_count: 42, media_count: 8 }), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });
    const snapshot = await client.readProfileSnapshot("111", "page-secret", "999");
    expect(snapshot).toMatchObject({ accountRef: "111", username: "brandone", biography: "Useful bio", website: "https://brand.example/", category: "Marketing Agency", businessAbout: "Page-level positioning", businessPhone: "+356 2000 0000", businessEmails: ["hello@brand.example"], followersCount: 42, mediaCount: 8 });
    expect(snapshot).not.toHaveProperty("profilePictureUrl");
    expect(snapshot.recentMedia).toHaveLength(2);
    expect(snapshot.recentMedia[0]).toMatchObject({ mediaUrl: "https://cdn.example/m1.jpg", likeCount: 42, commentsCount: 4 });
    expect(snapshot.recentMedia[0]).not.toHaveProperty("thumbnailUrl");
    expect(snapshot.recentMedia[1]?.caption).toHaveLength(2_200);
    expect(snapshot.recentMedia[1]).not.toHaveProperty("permalink");
    expect(calls.every((call) => !call.url.includes("page-secret") && call.authorization === "Bearer page-secret")).toBe(true);
    expect(calls.find((call) => call.url.includes("/media?"))?.url).toContain("limit=25");
  });
});
