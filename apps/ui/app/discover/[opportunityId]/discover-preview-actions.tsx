"use client";

import { Bookmark, Check, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CreationFormat } from "../../../lib/home";
import { CreateButton } from "../../home-controls";

export function DiscoverPreviewActions({
  brandId,
  opportunityId,
  title,
  direction,
  format,
  initiallySaved,
}: {
  brandId?: string;
  opportunityId: string;
  title: string;
  direction?: string;
  format: CreationFormat;
  initiallySaved: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  async function act(action: "save" | "ignore") {
    if (pending) return;
    setPending(action);
    setError("");
    try {
      if (brandId) {
        const response = await fetch("/api/discover/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brandId, opportunityId, action }),
        });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Kairo could not update this idea.");
      }
      if (action === "save") setSaved(true);
      else router.replace(brandId ? `/discover?brand=${encodeURIComponent(brandId)}` : "/discover");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kairo could not update this idea.");
    } finally {
      setPending("");
    }
  }

  return <div className="discover-preview-actions">
    <CreateButton brandId={brandId} opportunityId={brandId ? opportunityId : undefined} title={title} direction={direction} format={format}/>
    <button className={saved ? "saved" : ""} type="button" disabled={saved || Boolean(pending)} onClick={() => void act("save")}><span>{saved ? <Check aria-hidden="true"/> : <Bookmark aria-hidden="true"/>}</span>{saved ? "Saved" : "Save idea"}</button>
    <button type="button" disabled={Boolean(pending)} onClick={() => void act("ignore")}><Trash2 aria-hidden="true"/>Dismiss</button>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
