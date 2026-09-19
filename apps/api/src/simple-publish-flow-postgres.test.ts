import { describe, expect, it, vi } from "vitest";
import { PgSimplePublishFlowRepository } from "./simple-publish-flow-postgres";
describe("PgSimplePublishFlowRepository", () => {
  it("composes approved signed carousel media, destination, publish result and metrics in Brand scope", async () => {
    const query = vi.fn(async (sql: string) => {
        if (sql.includes("from brands b"))
          return { rows: [{ workspace_id: "ws" }] };
        if (sql.includes("from content_assets"))
          return {
            rows: [
              {
                id: "asset",
                campaign_id: "campaign",
                channel: "instagram",
                format: "carousel",
                topic: "Finished carousel",
              },
            ],
          };
        if (sql.includes("from carousel_projects"))
          return { rows: [{ id: "project" }] };
        if (sql.includes("from carousel_rendered_approvals"))
          return {
            rows: [{ id: "approval", rendered_version_id: "render-v3" }],
          };
        if (sql.includes("from carousel_rendered_asset_versions"))
          return {
            rows: [
              {
                id: "render-v3",
                storage_provider: "objects",
                quality_report: { findings: [], blockingErrorCount: 0 },
              },
            ],
          };
        if (sql.includes("from carousel_rendered_slide_assets"))
          return {
            rows: [
              { object_key: "slides/1.png" },
              { object_key: "slides/2.png" },
            ],
          };
        if (sql.includes("from publish_commands"))
          return {
            rows: [
              {
                id: "command",
                workspace_id: "ws",
                brand_id: "brand",
                campaign_id: "campaign",
                asset_id: "asset",
                version_id: "content-v2",
                version: 2,
                approval_id: "content-approval",
                channel_account_id: "channel",
                channel: "instagram",
                account_ref: "123",
                content_type: "carousel",
                media_items: [],
                publish_options: {},
                scheduled_for: "2026-08-23T10:00:00Z",
                status: "published",
                attempt_count: 1,
                created_at: "2026-08-22T10:00:00Z",
                approved_asset_version_id: "render-v3",
                approved_media_fingerprint: "a".repeat(64),
                lifecycle_status: "published",
                provider_publish_id: "media-1",
                published_url: "https://instagram.com/p/media-1",
              },
            ],
          };
        if (sql.includes("from channel_accounts"))
          return {
            rows: [
              {
                id: "channel",
                workspace_id: "ws",
                brand_id: "brand",
                channel: "instagram",
                account_ref: "123",
                display_name: "@brand",
                credential_ref: "vault://ig",
                auth_method: "instagram-login",
                capabilities: ["publish-carousel"],
                status: "connected",
                connected_at: "2026-08-22T00:00:00Z",
              },
            ],
          };
        if (sql.includes("from published_posts"))
          return {
            rows: [
              {
                id: "post",
                workspace_id: "ws",
                brand_id: "brand",
                campaign_id: "campaign",
                asset_id: "asset",
                version_id: "content-v2",
                publish_command_id: "command",
                channel: "instagram",
                account_ref: "123",
                external_post_id: "media-1",
                published_at: "2026-08-23T10:02:00Z",
                published_url: "https://instagram.com/p/media-1",
              },
            ],
          };
        if (sql.includes("from normalized_metrics"))
          return {
            rows: [
              {
                id: "metric",
                workspace_id: "ws",
                brand_id: "brand",
                published_post_id: "post",
                name: "reach",
                captured_at: "2026-08-23T11:00:00Z",
                status: "available",
                value: 42,
                source_snapshot_id: "snapshot",
                source_field: "reach",
                transformation_version: "v1",
              },
            ],
          };
        throw new Error(sql);
      }),
      client = { query, release: vi.fn() },
      pool = { connect: async () => client },
      signer = {
        sign: vi.fn(
          async (input: { objectKey: string }) =>
            `https://media.example.test/${input.objectKey}`,
        ),
      },
      result = await new PgSimplePublishFlowRepository(
        pool as never,
        signer,
      ).read("actor", "brand", "asset");
    expect(result).toMatchObject({
      media: {
        approved: true,
        assetVersionId: "render-v3",
        previewUrls: [
          "https://media.example.test/slides/1.png",
          "https://media.example.test/slides/2.png",
        ],
      },
      destination: { displayName: "@brand" },
      command: { lifecycleStatus: "published" },
      publishedPost: { id: "post" },
      metrics: [{ name: "reach", value: 42 }],
    });
    expect((query.mock.calls as unknown[][])[0]?.[1]).toEqual(["actor", "brand"]);
    expect(signer.sign).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
