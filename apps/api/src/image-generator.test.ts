import { describe, expect, it, vi } from "vitest";
import { imageGeneratorFromEnv, imagePrompt, OpenAIImageGenerator } from "./image-generator";

function pngBytes() {
  const bytes = Buffer.alloc(40);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  return bytes;
}

describe("OpenAIImageGenerator", () => {
  it("sends an image prompt and returns the decoded PNG", async () => {
    const bytes = pngBytes();
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "test-image-model", n: 1, size: "1024x1024", output_format: "png" });
      return Response.json({ data: [{ b64_json: bytes.toString("base64") }] });
    });
    const generator = new OpenAIImageGenerator("test-key", "test-image-model", fetcher as typeof fetch);
    await expect(generator.generate("A calm coastal scene")).resolves.toMatchObject({ bytes, mimeType: "image/png", model: "test-image-model" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects invalid provider output and stays disabled without a key", async () => {
    const generator = new OpenAIImageGenerator("test-key", "test-image-model", async () => Response.json({ data: [{ b64_json: "bm90LWEtcG5n" }] }));
    await expect(generator.generate("a scene")).rejects.toThrow(/unsupported image/);
    expect(imageGeneratorFromEnv({})).toBeUndefined();
  });
});

it("builds an editorial prompt without treating the image as an exact branded product photo", () => {
  const prompt = imagePrompt({ brand: "Brand", topic: "Wool shoe", audience: "Runners", objective: "Awareness", caption: "Try it" });
  expect(prompt).toContain("no written words");
  expect(prompt).toContain("Do not depict an exact branded product");
});
