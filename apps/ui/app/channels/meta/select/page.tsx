import Link from "next/link";
import { redirect } from "next/navigation";
import { getMetaCandidates, safeV2ChannelsHref, selectMetaCandidate } from "../../../../lib/meta-channel-api";

type SearchParams = Promise<{ brand?: string; intent?: string; returnTo?: string; error?: string }>;

export default async function SelectChannelPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const brandId = query.brand ?? "";
  const target = safeV2ChannelsHref(query.returnTo, brandId);
  if (!brandId || !query.intent) redirect(target);
  const candidates = await getMetaCandidates(brandId, query.intent).catch(() => []);

  async function select(formData: FormData) {
    "use server";
    const candidateId = String(formData.get("candidateId") ?? "");
    try {
      await selectMetaCandidate(brandId, query.intent!, candidateId);
      redirect(`${target}&notice=${encodeURIComponent("Channel connected")}`);
    } catch (error) {
      redirect(`/channels/meta/select?brand=${encodeURIComponent(brandId)}&intent=${encodeURIComponent(query.intent!)}&returnTo=${encodeURIComponent(target)}&error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to connect account")}`);
    }
  }

  return <main className="onboarding-page"><section className="onboarding-card" aria-labelledby="channel-select-title"><p className="onboarding-eyebrow">Channel connection</p><h1 id="channel-select-title">Choose an account</h1><p>Select the exact Page or Professional account Kairo may use for this Brand.</p>{query.error ? <p className="auth-error" role="alert">{query.error}</p> : null}{candidates.length ? <div className="onboarding-form">{candidates.map((candidate) => <form action={select} key={candidate.id}><input type="hidden" name="candidateId" value={candidate.id}/><p><strong>{candidate.username ? `@${candidate.username}` : candidate.displayName}</strong><br/><small>{candidate.pageName ? `${candidate.pageName} · ` : ""}{candidate.channel} {candidate.accountRef}</small></p><button type="submit">Connect this account</button></form>)}</div> : <p>No eligible accounts were returned. Try another connection method.</p>}<Link href={target}>Cancel</Link></section></main>;
}
