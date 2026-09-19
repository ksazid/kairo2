import { describe, expect, it } from "vitest";
import { SourceRouter } from "@kairo/agent-contracts";

const URL_MATRIX = [
  ["website root", "https://brand.example/", "website", "website"],
  ["website article", "https://brand.example/articles/launch", "web", "article"],
  ["PDF", "https://brand.example/brand-guide.pdf", "web", "article"],
  ["JSON endpoint", "https://brand.example/api/profile.json", "web", "article"],
  ["GitHub repository", "https://github.com/acme/project", "github", "repository"],
  ["GitHub profile", "https://github.com/acme", "github", "profile"],
  ["Hacker News discussion", "https://news.ycombinator.com/item?id=123", "hacker-news", "discussion"],
  ["Hacker News profile", "https://news.ycombinator.com/user?id=alice", "hacker-news", "profile"],
  ["YouTube video", "https://www.youtube.com/watch?v=abc123", "youtube", "video"],
  ["YouTube short", "https://www.youtube.com/shorts/abc123", "youtube", "short"],
  ["YouTube channel", "https://www.youtube.com/@acme", "youtube", "channel"],
  ["Instagram profile", "https://www.instagram.com/acme/", "instagram", "profile"],
  ["Instagram post", "https://www.instagram.com/p/abc123/", "instagram", "post"],
  ["Instagram reel", "https://www.instagram.com/reel/abc123/", "instagram", "reel"],
  ["Facebook page", "https://www.facebook.com/acme", "facebook", "page"],
  ["Facebook post", "https://www.facebook.com/acme/posts/123", "facebook", "post"],
  ["LinkedIn profile", "https://www.linkedin.com/in/acme", "linkedin", "profile"],
  ["LinkedIn company", "https://www.linkedin.com/company/acme", "linkedin", "company"],
  ["Substack publication", "https://acme.substack.com/", "substack", "publication"],
  ["Substack post", "https://acme.substack.com/p/launch", "substack", "post"],
  ["RSS feed", "https://brand.example/feed.xml", "rss", "feed"],
] as const;

describe("onboarding URL certification matrix", () => {
  it.each(URL_MATRIX)("classifies %s without losing source type", (_label, url, platform, sourceType) => {
    expect(SourceRouter.identify(url)).toMatchObject({ platform, sourceType });
  });

  it("rejects malformed URL input before adapter selection", () => {
    expect(() => SourceRouter.identify("javascript:alert(1)")).toThrow();
    expect(() => SourceRouter.identify("not a URL")).toThrow();
  });
});
