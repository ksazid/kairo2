import Link from "next/link";
import { redirect } from "next/navigation";
import { createBrand } from "../../../lib/api";

type SearchParams = Promise<{ error?: string; runtime?: string }>;

export default async function NewBrandPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  async function submit(formData: FormData) {
    "use server";
    const brandName = String(formData.get("brandName") ?? "").trim();
    const publicSourceUrl = String(formData.get("publicSourceUrl") ?? "").trim();
    if (!brandName || !publicSourceUrl) redirect("/brands/new?error=Enter+a+Brand+name+and+a+public+website.");
    let brandId: string;
    let runtime: string | undefined;
    try {
      const brand = await createBrand({ brandName, publicSourceUrl });
      brandId = brand.id;
      runtime = brand.runtime;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kairo could not create this Brand.";
      redirect(`/brands/new?error=${encodeURIComponent(message.slice(0, 180))}`);
    }
    redirect(`/brand?brand=${encodeURIComponent(brandId)}&setup=created${runtime ? `&runtime=${encodeURIComponent(runtime)}` : ""}`);
  }

  return <main className="onboarding-page">
    <section className="onboarding-card" aria-labelledby="new-brand-title">
      <p className="onboarding-eyebrow">New Brand</p>
      <h1 id="new-brand-title">Build a Brand Brain in Kairo v2.</h1>
      <p>Give Kairo a public website. It will create an isolated Brand and prepare its context for your review.</p>
      {params.error ? <p className="auth-error" role="alert">{params.error}</p> : null}
      {params.runtime ? <p role="status">Brand Brain runtime: {params.runtime}</p> : null}
      <form action={submit} className="onboarding-form">
        <label>Brand name<input name="brandName" required maxLength={120} autoComplete="organization"/></label>
        <label>Public website<input name="publicSourceUrl" required type="url" placeholder="https://example.com" autoComplete="url"/></label>
        <button type="submit">Create Brand and build context</button>
      </form>
      <Link href="/">Cancel</Link>
    </section>
  </main>;
}
