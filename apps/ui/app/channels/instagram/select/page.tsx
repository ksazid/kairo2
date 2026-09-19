import Link from "next/link";
import { redirect } from "next/navigation";
import { getInstagramCandidates, safeV2ChannelsHref, selectInstagramCandidate } from "../../../../lib/meta-channel-api";

type SearchParams = Promise<{ brand?: string; intent?: string; returnTo?: string; error?: string }>;

export default async function SelectInstagramPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const brandId = query.brand ?? "";
  const target = safeV2ChannelsHref(query.returnTo, brandId);
  if (!brandId || !query.intent) redirect(target);
  const candidates = await getInstagramCandidates(brandId, query.intent).catch(() => []);

  async function select(formData: FormData) {
    "use server";
    const candidateId = String(formData.get("candidateId") ?? "");
    try {
      await selectInstagramCandidate(brandId, query.intent!, candidateId);
      redirect(`${target}&notice=${encodeURIComponent("Instagram connected")}`);
    } catch (error) {
      redirect(`/channels/instagram/select?brand=${encodeURIComponent(brandId)}&intent=${encodeURIComponent(query.intent!)}&returnTo=${encodeURIComponent(target)}&error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to connect Instagram")}`);
    }
  }

  return <main className="onboarding-page"><section className="onboarding-card" aria-labelledby="instagram-select-title"><p className="onboarding-eyebrow">Instagram connection</p><h1 id="instagram-select-title">Choose an account</h1><p>Select the exact Instagram Professional account Kairo may use for this Brand.</p>{query.error ? <p className="auth-error" role="alert">{query.error}</p> : null}{candidates.length ? <div className="onboarding-form">{candidates.map((candidate) => <form action={select} key={candidate.id}><input type="hidden" name="candidateId" value={candidate.id}/><p><strong>{candidate.username ? `@${candidate.username}` : candidate.displayName}</strong><br/><small>{candidate.pageName} · Instagram {candidate.accountRef}</small></p><button type="submit">Connect this account</button></form>)}</div> : <p>No eligible Instagram Professional accounts were returned.</p>}<Link href={target}>Cancel</Link></section></main>;
}
