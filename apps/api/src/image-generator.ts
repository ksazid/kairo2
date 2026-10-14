export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: "image/png";
  model: string;
}

export interface ImageGenerationPort {
  generate(prompt: string): Promise<GeneratedImage>;
}

export class ImageGenerationUnavailableError extends Error {
  constructor() { super("AI image generation is not configured. Set OPENAI_API_KEY and private media storage to enable it."); }
}

export class OpenAIImageGenerator implements ImageGenerationPort {
  constructor(
    private readonly apiKey: string,
    private readonly model = "gpt-image-1.5",
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!apiKey.trim()) throw new Error("OPENAI_API_KEY is required");
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(model)) throw new Error("KAIRO_IMAGE_MODEL is invalid");
  }

  async generate(prompt: string): Promise<GeneratedImage> {
    const text = prompt.trim();
    if (!text || text.length > 12_000) throw new Error("Image prompt is invalid");
    const response = await this.fetcher("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text, n: 1, size: "1024x1024", quality: "medium", output_format: "png" }),
    });
    if (!response.ok) throw new Error(`Image generation provider returned ${response.status}`);
    const payload = await response.json() as { data?: Array<{ b64_json?: string }> };
    const encoded = payload.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || !encoded || encoded.length > 36_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error("Image generation provider returned an invalid image");
    }
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.byteLength > 25 * 1024 * 1024 || !isPng(bytes)) throw new Error("Image generation provider returned an unsupported image");
    return { bytes, mimeType: "image/png", model: this.model };
  }
}

export function imageGeneratorFromEnv(env: NodeJS.ProcessEnv = process.env): ImageGenerationPort | undefined {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return undefined;
  return new OpenAIImageGenerator(key, env.KAIRO_IMAGE_MODEL?.trim() || "gpt-image-1.5");
}

export function imagePrompt(input: { brand: string; topic: string; audience: string; objective: string; caption: string }): string {
  const safe = (value: string, max: number) => value.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const brand = safe(input.brand, 120), topic = safe(input.topic, 300), audience = safe(input.audience, 300), objective = safe(input.objective, 300), caption = safe(input.caption, 900);
  return [
    `Create one polished square editorial social-media photograph for ${brand}.`,
    `Subject and topic: ${topic}. Audience: ${audience}. Purpose: ${objective}.`,
    `Use this caption only as factual context: ${caption}.`,
    "Make the visual feel specific to the topic, natural, premium, and suitable for a real brand account. Use a clean composition with generous negative space and no written words, captions, labels, logos, watermarks, or invented product branding.",
    "Do not depict an exact branded product, package, person, or claim unless it was supplied as a reference image. For product-specific topics, create an editorial material, detail, or lifestyle scene that supports the subject without pretending to be an exact product photograph.",
  ].join("\n");
}

function isPng(bytes: Uint8Array) {
  return bytes.byteLength > 33 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
}
