"use client";

import {
  Bookmark,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Facebook,
  Heart,
  ImagePlus,
  Instagram,
  Linkedin,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Play,
  Send,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ChannelAccountView } from "../../../../lib/api";
import type { ContentItem } from "../../../../lib/content";
import { captionNeedsSave, contentWithCaption } from "../../../../lib/content";

type ActionContext = {
  brandId: string;
  reviewStatus: "review" | "revision-required" | "passed" | "archived" | null;
  approved: boolean;
  findings?: string[];
  eligibleAccounts: ChannelAccountView[];
  approvedAccountId?: string;
};

type LibraryAsset = { id: string; name: string; kind: string; mimeType: string; previewRef?: string; libraryId: string };
type MediaLibraryResponse = { libraries: Array<{ id: string; name: string; status: string; provider: string }>; assets: LibraryAsset[] };

export function ContentPreviewClient({ item, brandName = "Brand", authenticated, actionContext }: { item: ContentItem; brandName?: string; authenticated: boolean; actionContext?: ActionContext }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [slide, setSlide] = useState(0);
  const [caption, setCaption] = useState(item.caption);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(item.status === "published" || item.status === "scheduled" || Boolean(actionContext?.approved));
  const [scheduled, setScheduled] = useState(item.status === "scheduled");
  const [reviewStatus, setReviewStatus] = useState(actionContext?.reviewStatus ?? null);
  const [accountId, setAccountId] = useState(actionContext?.approvedAccountId ?? actionContext?.eligibleAccounts[0]?.id ?? "");
  const [scheduledFor, setScheduledFor] = useState(defaultScheduleTime);
  const [reviewFindings, setReviewFindings] = useState(actionContext?.findings ?? []);
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibraryResponse | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<string[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const identity = actionContext?.eligibleAccounts.find(account => account.id === accountId)?.displayName ?? brandName;
  const missingMedia = !item.media.some(ref => ref !== "/kairo-media-placeholder.svg");
  const copyChanged = captionNeedsSave(item.rawContent, caption);
  const media = item.media.length ? item.media : [item.image];
  const currentMedia = media[Math.min(slide, media.length - 1)] ?? item.image;
  const ChannelIcon = item.channel === "Facebook" ? Facebook : item.channel === "LinkedIn" ? Linkedin : Instagram;

  useEffect(() => {
    setCaption(item.caption);
    setReviewFindings(actionContext?.findings ?? []);
    setApproved(item.status === "published" || item.status === "scheduled" || Boolean(actionContext?.approved));
    setScheduled(item.status === "scheduled");
    setReviewStatus(actionContext?.reviewStatus ?? null);
    setAccountId(actionContext?.approvedAccountId ?? actionContext?.eligibleAccounts[0]?.id ?? "");
  }, [item.currentVersion, item.caption, item.status, actionContext]);

  function refine(action: "improve" | "shorten" | "tone" | "ideas") {
    if (action === "shorten") setCaption(item.caption.split(/[.!?]/)[0]?.trim().concat(".") || item.caption);
    if (action === "improve") setCaption(`${item.caption} ${item.cta}`.trim());
    if (action === "tone") setCaption(`Local tip: ${item.caption.charAt(0).toLowerCase()}${item.caption.slice(1)}`);
    setNotice(action === "ideas" ? "Three alternative directions are ready in this preview." : "Preview copy updated in Kairo v2.");
    setError("");
  }

  async function perform(action: "save" | "review" | "approve" | "schedule", extra: Record<string, unknown> = {}) {
    if (!actionContext) return;
    setError("");
    setNotice("");
    const response = await fetch("/api/content/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, brandId: actionContext.brandId, campaignId: item.campaignId, assetId: item.id, expectedVersion: item.currentVersion, ...extra }),
    });
    const result = await response.json().catch(() => null) as { message?: string; error?: string; review?: { status?: typeof reviewStatus; truth?: { findings?: Array<{message:string}> }; critic?: { findings?: Array<{message:string}> } } } | null;
    if (!response.ok) throw new Error(result?.error ?? "Kairo could not update this content.");
    if (action === "review") { setReviewStatus(result?.review?.status ?? null); setReviewFindings([...(result?.review?.truth?.findings ?? []), ...(result?.review?.critic?.findings ?? [])].map(finding => finding.message)); }
    if (action === "approve") setApproved(true);
    if (action === "schedule") setScheduled(true);
    setNotice(result?.message ?? "Content updated.");
    router.refresh();
  }

  function run(action: "save" | "review" | "approve" | "schedule", extra: Record<string, unknown> = {}) {
    startTransition(async () => {
      try { await perform(action, extra); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "Kairo could not update this content."); }
    });
  }

  function approve() {
    if (authenticated && actionContext) {
      run("approve", { channelAccountId: accountId });
      return;
    }
    setApproved(true);
    setNotice("Preview approved and locked.");
  }

  function schedule() {
    if (!approved) return;
    if (authenticated && actionContext) {
      run("schedule", { channelAccountId: actionContext.approvedAccountId ?? accountId, scheduledFor: new Date(scheduledFor).toISOString() });
      return;
    }
    setScheduled(true);
    setNotice("Preview scheduled for the next available slot.");
  }

  async function openMediaLibrary() {
    if (!actionContext) return;
    setMediaLoading(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/content/media?brandId=${encodeURIComponent(actionContext.brandId)}`);
      const result = await response.json() as MediaLibraryResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Kairo could not load the Brand media library.");
      setMediaLibrary(result);
      setSelectedMedia([]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Kairo could not load media."); }
    finally { setMediaLoading(false); }
  }

  async function attachMedia() {
    if (!actionContext || !selectedMedia.length) return;
    setMediaLoading(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/content/media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId: actionContext.brandId, campaignId: item.campaignId, assetId: item.id, expectedVersion: item.currentVersion, libraryAssetIds: selectedMedia }) });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Kairo could not attach these assets.");
      setMediaLibrary(null); setNotice(result.message ?? "Media attached."); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Kairo could not attach media."); }
    finally { setMediaLoading(false); }
  }

  return <>
    <div className="content-preview-grid">
      <section className="content-preview-panel" aria-labelledby="preview-heading">
        <header><div><h2 id="preview-heading">Preview</h2><p>Review how your content will look across platforms.</p></div><span>Mobile preview</span></header>
        <nav className="content-destination-tabs" aria-label="Content destinations"><button type="button" aria-pressed="true"><ChannelIcon aria-hidden="true"/>{item.channel}</button></nav>

        <div className="social-preview-wrap">
          <article className="social-preview-card" aria-label={`${item.channel} ${item.formatLabel} preview`}>
            <header><span className="social-brand-avatar">{identity.charAt(0)}</span><strong>{identity}</strong><MoreHorizontal aria-hidden="true"/></header>
            <div className={`social-media-stage format-${item.format}`}>
              {missingMedia ? <div className="social-media-concept" aria-label="Text concept preview; production media is missing"><span>TEXT CONCEPT</span><strong>{item.title}</strong><p>{caption}</p><small>Attach approved media to complete this preview.</small></div> : <img src={currentMedia} alt={`${item.title}${media.length > 1 ? ` card ${slide + 1}` : ""}`}/>}
              {item.format === "reel" && !missingMedia ? <button type="button" aria-label="Play Reel"><Play aria-hidden="true"/></button> : null}
              {media.length > 1 ? <><button className="media-previous" type="button" disabled={slide === 0} onClick={() => setSlide((value) => Math.max(0, value - 1))} aria-label="Previous card"><ChevronLeft aria-hidden="true"/></button><button className="media-next" type="button" disabled={slide === media.length - 1} onClick={() => setSlide((value) => Math.min(media.length - 1, value + 1))} aria-label="Next card"><ChevronRight aria-hidden="true"/></button><span className="media-count">{slide + 1}/{item.cardCount ?? media.length}</span></> : null}
            </div>
            <div className="social-actions" aria-hidden="true"><Heart/><MessageCircle/><Send/><Bookmark className="push-right"/></div>
            <div className="social-caption"><strong>Likes unavailable</strong>{authenticated ? <label htmlFor="caption-editor"><b>{identity}</b><textarea id="caption-editor" aria-label="Content caption" value={caption} disabled={pending || approved} maxLength={20_000} onChange={(event) => { setCaption(event.target.value); setNotice(""); setError(""); }}/></label> : <p><b>{identity}</b> {caption}</p>}</div>
          </article>
          {media.length > 1 ? <div className="social-dots" aria-label="Carousel position">{media.map((_, index) => <button type="button" key={index} aria-label={`Show card ${index + 1}`} aria-pressed={slide === index} onClick={() => setSlide(index)}/>)}</div> : null}
        </div>

        <section className="content-ai-assistance"><div><h3>AI assistance</h3><p>Improve your content with Kairo.</p></div><div><button type="button" disabled={pending} onClick={() => refine("improve")}><Sparkles/>Improve copy</button><button type="button" disabled={pending} onClick={() => refine("shorten")}><WandSparkles/>Shorten</button><button type="button" disabled={pending} onClick={() => refine("tone")}><WandSparkles/>Change tone</button><button type="button" disabled={pending} onClick={() => refine("ideas")}><Sparkles/>More ideas</button>{authenticated && copyChanged ? <button className="save-content-version" type="button" disabled={pending} onClick={() => run("save", { content: contentWithCaption(item.rawContent, caption) })}><Check/>Save version</button> : null}</div>{notice ? <p role="status">{notice}</p> : null}{error ? <p className="content-action-error" role="alert">{error}</p> : null}</section>
      </section>

      <aside className="content-preview-rail" aria-label="Content context">
        <section><h2>Content details</h2><dl><div><dt>Type</dt><dd>{item.formatLabel}</dd></div><div><dt>Campaign</dt><dd>{item.campaignName}</dd></div><div><dt>Goal</dt><dd>{item.objective}</dd></div><div><dt>Audience</dt><dd>{item.audience}</dd></div><div><dt>Channel</dt><dd><ChannelIcon aria-hidden="true"/>{item.channel}</dd></div><div><dt>CTA</dt><dd>{item.cta}</dd></div></dl></section>
        <section><h2>Performance potential</h2><div className="potential-row"><span>Brand fit</span><strong>Not available</strong></div><div className="potential-row"><span>Engagement</span><strong>Not available</strong></div><p>Scores appear only when supported by real Brand and performance evidence.</p></section>
        {media.length > 1 ? <section className="preview-cards-list"><h2>Cards ({item.cardCount ?? media.length})</h2><ol>{media.map((image, index) => <li key={`${image}-${index}`}><button type="button" aria-pressed={slide === index} onClick={() => setSlide(index)}><img src={image} alt=""/><span><b>Card {index + 1}</b>{index === 0 ? item.title : `Supporting point ${index + 1}`}</span></button></li>)}</ol></section> : null}
      </aside>
    </div>

    {authenticated && (reviewFindings.length > 0 || missingMedia || !accountId || copyChanged) ? <section aria-label="Required changes" className="content-review-findings"><h2>Before approval</h2><ul>{reviewFindings.map((finding,index) => <li key={index}>{finding}</li>)}{missingMedia ? <li>Production media is missing. Choose approved image assets from the Brand library to complete this post.</li> : null}{!accountId ? <li>Connect a publishing account in Settings before approving.</li> : null}{copyChanged ? <li>Save the cleaned caption as a new version, then run readiness review.</li> : null}</ul>{missingMedia && actionContext && !approved ? <div className="content-media-picker"><button type="button" disabled={mediaLoading || pending} onClick={() => void openMediaLibrary()}><ImagePlus aria-hidden="true"/>{mediaLoading ? "Loading media…" : "Choose media"}</button>{mediaLibrary ? <><p>{mediaLibrary.assets.length ? `Select production image${mediaLibrary.assets.length === 1 ? "" : "s"} from the Brand library.` : "No indexed images are available in the Brand library."}</p><div role="group" aria-label="Production media library">{mediaLibrary.assets.filter((asset) => asset.kind === "image" && asset.previewRef).map((asset) => <label key={asset.id}><input type="checkbox" checked={selectedMedia.includes(asset.id)} onChange={(event) => setSelectedMedia((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))}/>{asset.previewRef ? <img src={asset.previewRef} alt=""/> : null}<span>{asset.name}</span></label>)}</div>{mediaLibrary.libraries.length === 0 ? <small>No media libraries are configured. Connect Google Drive from Settings to add approved assets.</small> : null}{mediaLibrary.assets.length > 0 ? <button type="button" disabled={mediaLoading || pending || selectedMedia.length === 0 || selectedMedia.length > 12} onClick={() => void attachMedia()}>{mediaLoading ? "Attaching…" : `Attach ${selectedMedia.length || "selected"} image${selectedMedia.length === 1 ? "" : "s"}`}</button> : null}</> : null}</div> : null}</section> : null}
    <section className="content-approval-bar" aria-label="Approval actions"><div><span><Lock aria-hidden="true"/></span><p><strong>{scheduled ? "Scheduled" : approved ? "Approved & locked" : reviewStatus === "passed" ? "Ready to approve" : reviewStatus === "revision-required" ? "Changes needed" : "Needs review"}</strong><small>{scheduled ? "This content is ready for its publishing slot." : approved ? "This exact version is locked for its destination." : reviewStatus === "revision-required" ? "Make the required changes and run the review again." : "Run readiness review before approval."}</small></p></div><div className="content-approval-controls">{authenticated && !approved && reviewStatus !== "passed" ? <button type="button" disabled={pending || copyChanged} onClick={() => run("review")}><Sparkles/>{reviewStatus === "revision-required" ? "Check again" : "Check readiness"}</button> : null}{authenticated && !approved && actionContext && actionContext.eligibleAccounts.length > 1 ? <select aria-label="Publishing destination" value={accountId} disabled={pending} onChange={(event) => setAccountId(event.target.value)}>{actionContext.eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select> : null}<button className="approve" type="button" disabled={pending || approved || (authenticated && (reviewStatus !== "passed" || !accountId || copyChanged))} onClick={approve}>{approved ? <Check/> : <Lock/>}{approved ? "Approved & Locked" : "Approve & Lock"}</button>{authenticated && approved && !scheduled ? <input aria-label="Publishing time" type="datetime-local" value={scheduledFor} min={defaultScheduleTime()} disabled={pending} onChange={(event) => setScheduledFor(event.target.value)}/> : null}<button type="button" disabled={pending || !approved || scheduled || (authenticated && !actionContext?.approvedAccountId)} onClick={schedule}><CalendarDays/>{scheduled ? "Scheduled" : "Schedule"}</button></div></section>
  </>;
}

function defaultScheduleTime() {
  const value = new Date(Date.now() + 60 * 60 * 1000);
  value.setMinutes(0, 0, 0);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
