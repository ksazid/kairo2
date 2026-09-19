import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChannelAccount } from "@kairo/domain/publishing";
import {
  InstagramConnectionService,
  type InstagramConnectionCandidate,
  type InstagramConnectionRepository,
  type InstagramCredentialVault,
  type MetaInstagramOAuthPort,
} from "./instagram-connection";

class Repo implements InstagramConnectionRepository {
  intents: Array<any> = [];
  candidates: InstagramConnectionCandidate[] = [];
  disabled: string[] = [];
  importTarget: { accountRef: string; pageRef: string; credentialRef: string } | null = null;
  async createIntent(value: any) { this.intents.push(value); }
  async consumeIntent(accountId: string, stateHash: string) {
    const intent = this.intents.find((x) => x.accountId === accountId && x.stateHash === stateHash && !x.consumedAt);
    if (!intent) return null;
    intent.consumedAt = "now";
    return intent;
  }
  async saveCandidates(values: InstagramConnectionCandidate[]) { this.candidates.push(...values); }
  async listCandidates(accountId: string, brandId: string, intentId: string) {
    return this.candidates.filter((x) => x.accountId === accountId && x.brandId === brandId && x.intentId === intentId);
  }
  async markSelected(accountId: string, brandId: string, candidateId: string) {
    const item = this.candidates.find((x) => x.accountId === accountId && x.brandId === brandId && x.id === candidateId);
    if (!item) return null;
    item.selectedAt = "now";
    return item;
  }
  async disableConnection(_accountId: string, _brandId: string, channelAccountId: string) { this.disabled.push(channelAccountId); }
  async connectionImportTarget() { return this.importTarget; }
}

class Vault implements InstagramCredentialVault {
  values = new Map<string, string>();
  revoked: string[] = [];
  async store(_workspaceId: string, _brandId: string, ref: string, token: string) { this.values.set(ref, token); }
  async resolve(ref: string) { const value = this.values.get(ref); if (!value) throw new Error("unavailable"); return value; }
  async revoke(ref: string) { this.values.delete(ref); this.revoked.push(ref); }
}

class Meta implements MetaInstagramOAuthPort {
  authorizationUrl(state: string) { return `https://www.facebook.com/v99.0/dialog/oauth?state=${encodeURIComponent(state)}`; }
  async exchangeAndDiscover(code: string) {
    expect(code).toBe("meta-code");
    return {
      grantedScopes: ["business_management", "instagram_basic", "instagram_content_publish", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"],
      userAccessToken: "secret-user-token",
      userAccessTokenExpiresInSeconds: 60 * 24 * 60 * 60,
      accounts: [
        { pageRef: "page-1", pageName: "Page One", accountRef: "111", displayName: "One", username: "one", pageAccessToken: "secret-page-token-1" },
        { pageRef: "page-2", pageName: "Page Two", accountRef: "222", displayName: "Two", username: "two", pageAccessToken: "secret-page-token-2" },
      ],
    };
  }
  async readProfileSnapshot(accountRef: string, pageAccessToken: string) {
    expect(pageAccessToken).toBe("secret-page-token-1");
    return { accountRef, username: "one", biography: "Evidence-led studio", website: "https://one.example/", recentMedia: [{ id: "media-1", caption: "A useful caption", mediaType: "IMAGE" }], retrievedAt: "2026-08-15T05:00:00.000Z" };
  }
}

function service(repo = new Repo(), vault = new Vault()) {
  const saved: ChannelAccount[] = [];
  const sources: any[] = [];
  const instance = new InstagramConnectionService({
    brands: { async getBrandForAccount(accountId, brandId) { return accountId === "alice" && brandId === "brand-1" ? { id: brandId, workspaceId: "ws-1" } : null; } },
    publishing: { async saveChannelAccount(_accountId, channel) { saved.push(channel); return channel; } },
    knowledge: {
      async listKnowledgeSources() { return sources; },
      async createKnowledgeSource(accountId, brandId, input) { const source = { id: `source-${sources.length + 1}`, accountId, brandId, ...input }; sources.push(source); return source; },
      async removeKnowledgeSource(_accountId, _brandId, sourceId) { const source = sources.find((item) => item.id === sourceId); if (source) source.status = "removed"; return source; },
    },
    repo,
    vault,
    meta: new Meta(),
    now: () => new Date("2026-08-15T05:00:00Z"),
    stateBytes: () => Buffer.from("0123456789abcdef0123456789abcdef"),
    id: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  return { instance, repo, vault, saved, sources };
}

describe("VS-17 Instagram connection", () => {
  it("stores only a hash of OAuth state and binds it to account + Brand", async () => {
    const { instance, repo } = service();
    const started = await instance.begin("alice", "brand-1");
    const rawState = new URL(started.authorizationUrl).searchParams.get("state")!;
    expect(rawState).toBeTruthy();
    expect(repo.intents[0].stateHash).not.toBe(rawState);
    expect(repo.intents[0]).toMatchObject({ accountId: "alice", brandId: "brand-1", workspaceId: "ws-1" });
    expect(repo.intents[0].stateHash).toBe(createHash("sha256").update(rawState).digest("hex"));
  });

  it("consumes OAuth state once and requires explicit selection when Meta returns multiple accounts", async () => {
    const { instance, repo, saved } = service();
    const started = await instance.begin("alice", "brand-1");
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const completed = await instance.complete("alice", "meta-code", state);
    expect(completed.status).toBe("selection-required");
    if (completed.status !== "selection-required") throw new Error("expected selection");
    expect(completed.candidates).toHaveLength(2);
    expect(saved).toHaveLength(0);
    expect(Date.parse(repo.candidates[0]!.tokenExpiresAt)).toBeGreaterThan(Date.parse("2026-08-22T05:00:00Z"));
    await expect(instance.complete("alice", "meta-code", state)).rejects.toThrow(/expired|invalid|used/i);
    expect(JSON.stringify(repo.candidates)).not.toContain("secret-page-token");
    expect(JSON.stringify(repo.candidates)).not.toContain("secret-user-token");
  });

  it("selects one candidate, preserves separate publish/Insights credentials and revokes both unselected secrets", async () => {
    const { instance, vault, saved, sources } = service();
    const started = await instance.begin("alice", "brand-1");
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const completed = await instance.complete("alice", "meta-code", state);
    if (completed.status !== "selection-required") throw new Error("expected selection");
    expect(vault.values.size).toBe(4);
    const selected = await instance.select("alice", "brand-1", completed.intentId, completed.candidates[0]!.id);
    expect(selected).toMatchObject({ channel: "instagram", accountRef: "111", status: "connected" });
    expect(selected.capabilities).toEqual(expect.arrayContaining(["publish-image", "publish-carousel", "publish-reel"]));
    expect(saved).toHaveLength(1);
    expect(vault.revoked).toHaveLength(2);
    expect(vault.values.size).toBe(2);
    expect(selected.credentialRef).toContain(":publish:");
    expect(selected.credentialRef).not.toContain("secret-page-token");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ accountId: "alice", brandId: "brand-1", type: "research", status: "active", contentType: "application/vnd.kairo.instagram-profile+json" });
    expect(JSON.parse(sources[0].rawContent)).toMatchObject({ accountRef: "111", biography: "Evidence-led studio", recentMedia: [{ id: "media-1", caption: "A useful caption" }] });
    expect(sources[0].rawContent).not.toContain("secret-page-token");
    expect(sources[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refreshes the connected Instagram source and retires the previous active snapshot", async () => {
    const { instance, repo, vault, sources } = service();
    repo.importTarget = { accountRef: "111", pageRef: "page-1", credentialRef: "publish-ref" };
    vault.values.set("publish-ref", "secret-page-token-1");
    sources.push({ id: "source-old", status: "active", contentType: "application/vnd.kairo.instagram-profile+json", contentHash: "old" });

    await instance.refreshSource("alice", "brand-1", "channel-1");

    expect(sources.filter((source) => source.status === "active")).toHaveLength(1);
    expect(sources.find((source) => source.id === "source-old")?.status).toBe("removed");
    expect(sources.at(-1)).toMatchObject({ status: "active", contentType: "application/vnd.kairo.instagram-profile+json" });
  });
});
