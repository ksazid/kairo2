/** Public copy boundary. Lineage remains in supportingClaimIds, never in captions. */
export function normalizePublishableCopy(value: string): string {
  return value.replace(/\r\n?/g, "\n")
    .replace(/【[^】]*(?:claim|evidence)-[^】]*】/gi, "")
    .replace(/\[(?:[^\]\n]*:)?(?:claim|evidence)-[^\]\n]+\]/gi, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
    .replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim();
}
export function publicCopyFindings(channel: string, content: string): Array<{code:string;severity:"revision";message:string}> {
  let caption = content;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const key = ["caption", "copy", "text", "body", "description"].find(key => typeof record[key] === "string");
      if (!key) return [];
      caption = record[key] as string;
    }
  } catch {}
  const findings: Array<{code:string;severity:"revision";message:string}> = [];
  const limit = channel === "instagram" ? 2200 : channel === "linkedin" ? 3000 : channel === "facebook" ? 5000 : undefined;
  if (limit && caption.length > limit) findings.push({code:"channel-copy-limit",severity:"revision",message:`Shorten the caption to ${limit} characters or fewer before approval.`});
  if (normalizePublishableCopy(caption) !== caption.trim()) findings.push({code:"public-copy-format",severity:"revision",message:"Remove internal claim references and Markdown from the public caption, save a new version, then review again."});
  return findings;
}
