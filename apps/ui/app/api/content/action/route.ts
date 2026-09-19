import { NextResponse } from "next/server";
import { approveContentVersion, getContentData, reviewContentVersion, saveContentVersion, scheduleContentVersion } from "../../../../lib/api";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = text(body?.action, 30);
  const brandId = text(body?.brandId, 200);
  const campaignId = text(body?.campaignId, 200);
  const assetId = text(body?.assetId, 200);
  const expectedVersion = positiveInteger(body?.expectedVersion);
  if (!brandId || !campaignId || !assetId || !expectedVersion) return problem("Brand, campaign, asset and current version are required.");

  try {
    if (action === "save") {
      if (typeof body?.content !== "string" || body.content.length > 100_000) return problem("Content must be 100,000 characters or fewer.");
      const content = body.content;
      if (!content.trim()) return problem("Content cannot be empty.");
      const detail = await saveContentVersion(brandId, campaignId, assetId, { expectedVersion, content });
      const version = detail.assets.find((entry) => entry.asset.id === assetId)?.versions.at(-1)?.version;
      return NextResponse.json({ message: `Version ${version ?? expectedVersion + 1} saved.` });
    }

    if (action === "review") {
      const review = await reviewContentVersion(brandId, campaignId, assetId, expectedVersion);
      return NextResponse.json({ message: review?.status === "passed" ? "Readiness review passed." : "Review completed with required changes.", review });
    }

    const data = await getContentData(brandId);
    if (!data.authenticated || data.brandId !== brandId) return problem("Sign in and choose this Brand before continuing.", 401);
    const entry = data.details.find((detail) => detail.campaign.id === campaignId)?.assets.find((candidate) => candidate.asset.id === assetId);
    if (!entry || entry.asset.currentVersion !== expectedVersion) return problem("Content Version is stale.", 409);
    const accountId = text(body?.channelAccountId, 200);
    const account = data.channelAccounts.find((candidate) => candidate.id === accountId && candidate.status === "connected" && candidate.channel === entry.asset.channel);
    if (!account) return problem("Choose a connected destination matching this content channel.");

    if (action === "approve") {
      await approveContentVersion(brandId, campaignId, assetId, { expectedVersion, destination: account });
      return NextResponse.json({ message: `Version ${expectedVersion} approved and locked for ${account.displayName}.` });
    }

    if (action === "schedule") {
      const scheduledFor = timestamp(body?.scheduledFor);
      if (!scheduledFor || Date.parse(scheduledFor) <= Date.now()) return problem("Choose a future publishing time.");
      const contentType = publishType(entry.asset.format);
      const requiredCapability = contentType === "text" ? "publish-text" : contentType === "image" ? "publish-image" : contentType === "video" ? "publish-video" : "publish-carousel";
      if (!account.capabilities.includes(requiredCapability)) return problem(`${account.displayName} cannot publish this content format.`);
      const command = await scheduleContentVersion(brandId, campaignId, assetId, { channelAccountId: account.id, contentType, scheduledFor });
      return NextResponse.json({ message: `Scheduled for ${new Date(command.scheduledFor).toLocaleString("en", { timeZone: "UTC" })} UTC.`, command });
    }

    return problem("Unsupported content action.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kairo could not update this content.";
    return problem(message, /stale|conflict/i.test(message) ? 409 : 400);
  }
}

function problem(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function text(value: unknown, max: number, trim = true) {
  if (typeof value !== "string") return "";
  const normalized = trim ? value.trim() : value;
  return normalized.slice(0, max);
}

function positiveInteger(value: unknown) {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : undefined;
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function publishType(format: string): "text" | "image" | "video" | "carousel" {
  const value = format.toLowerCase();
  if (value === "carousel") return "carousel";
  if (/reel|video|short/.test(value)) return "video";
  if (/image|post/.test(value)) return "image";
  return "text";
}
