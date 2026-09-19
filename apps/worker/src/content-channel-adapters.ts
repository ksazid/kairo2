import type { ContentChannel } from "@kairo/domain/campaign";
import { DomainValidationError } from "@kairo/domain";

export type ChannelContentMode = "text-first" | "visual-caption" | "video-caption" | "generic";

export type ChannelContentProfile = {
  channel: ContentChannel;
  format: string;
  contentMode: ChannelContentMode;
  hardLimits: {
    maxCharacters: number;
  };
  presentation: {
    visualPrimary: boolean;
    videoPrimary: boolean;
  };
  requirements: string[];
  recommendations: string[];
};

export function resolveChannelContentProfile(channel: ContentChannel, format: string): ChannelContentProfile {
  const normalizedFormat = requiredText(format, "format", 120).toLowerCase();
  if (channel === "linkedin") return linkedinProfile(normalizedFormat);
  if (channel === "instagram") return instagramProfile(normalizedFormat);
  if (channel === "facebook") return facebookProfile(normalizedFormat);
  if (channel === "manual") return manualProfile(normalizedFormat);
  throw new DomainValidationError("channel is not supported");
}

export function validateChannelContent(profile: ChannelContentProfile, content: string): string {
  if (typeof content !== "string" || !content.trim()) throw new DomainValidationError("channel content is required");
  if (content.length > profile.hardLimits.maxCharacters) {
    throw new DomainValidationError(`${displayName(profile.channel)} content exceeds ${profile.hardLimits.maxCharacters} characters`);
  }
  return content;
}

export function channelContentFits(channel: ContentChannel, format: string, content: string): boolean {
  try {
    validateChannelContent(resolveChannelContentProfile(channel, format), content);
    return true;
  } catch {
    return false;
  }
}

function linkedinProfile(format: string): ChannelContentProfile {
  return {
    channel: "linkedin",
    format,
    contentMode: "text-first",
    hardLimits: { maxCharacters: 3000 },
    presentation: { visualPrimary: false, videoPrimary: false },
    requirements: [
      "Keep the final LinkedIn content at or below 3000 characters.",
      "The text must stand on its own and must not depend on hidden context or unsupported formatting.",
    ],
    recommendations: [
      "Use a clear opening and readable paragraph breaks.",
      "Prefer useful professional context over generic engagement bait.",
      "Keep the CTA natural and relevant to the Campaign objective.",
    ],
  };
}

function instagramProfile(format: string): ChannelContentProfile {
  const videoPrimary = format === "reel" || format === "video";
  const carousel = format === "carousel";
  return {
    channel: "instagram",
    format,
    contentMode: videoPrimary ? "video-caption" : "visual-caption",
    hardLimits: { maxCharacters: 2200 },
    presentation: { visualPrimary: true, videoPrimary },
    requirements: [
      "Keep the final Instagram caption at or below 2200 characters.",
      "Treat the visual or video asset as primary; the caption should add context rather than duplicate every visual element.",
    ],
    recommendations: [
      "Make the opening line useful without relying on clickbait.",
      carousel
        ? "For a carousel, let the caption complement the slide sequence and preserve the Campaign CTA."
        : videoPrimary
          ? "For a Reel/video, let the caption complement the video narrative and avoid repeating the full voiceover or on-screen text."
          : "For an image-led post, let the caption explain or extend the visual rather than describe it mechanically.",
    ],
  };
}

function manualProfile(format: string): ChannelContentProfile {
  return {
    channel: "manual",
    format,
    contentMode: "generic",
    hardLimits: { maxCharacters: 50000 },
    presentation: { visualPrimary: false, videoPrimary: false },
    requirements: ["Keep content within Kairo's generic Content Version limit."],
    recommendations: ["Preserve the selected Campaign objective, audience, evidence and CTA for manual export/publishing."],
  };
}

function facebookProfile(format: string): ChannelContentProfile {
  const imagePrimary = format === "image" || format === "static";
  return { channel: "facebook", format, contentMode: imagePrimary ? "visual-caption" : "text-first", hardLimits: { maxCharacters: 5000 }, presentation: { visualPrimary: imagePrimary, videoPrimary: false }, requirements: ["Keep the Facebook Page post focused on one approved message."], recommendations: ["Use readable copy and pair it with one approved image when the selected format is image-led."] };
}

function displayName(channel: ContentChannel): string {
  return channel === "linkedin" ? "LinkedIn" : channel === "instagram" ? "Instagram" : channel === "facebook" ? "Facebook" : "Manual";
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new DomainValidationError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new DomainValidationError(`${field} is too long`);
  return normalized;
}
