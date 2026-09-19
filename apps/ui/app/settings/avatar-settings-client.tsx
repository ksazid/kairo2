"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowLeft, Check, CheckCircle2, ChevronRight, CircleAlert, ImagePlus, Lightbulb, Mic2, ShieldCheck, Video } from "lucide-react";
import { SETTINGS_TABS, type SettingsTabId } from "../../lib/settings";
import { presenterDraft, type PresenterResponse, type SettingsData } from "../../lib/settings-data";
import styles from "./settings-avatar.module.css";

type SetupStep = 1 | 2 | 3 | 4;
type LookChoice = "Professional" | "Casual" | "Campaign";
type BackgroundChoice = "Home office" | "Studio" | "Brand scene";

const steps: Array<{ id: SetupStep; label: string; helper?: string }> = [
  { id: 1, label: "Identity media", helper: "Not enabled" },
  { id: 2, label: "Look" },
  { id: 3, label: "Voice", helper: "Preference only" },
  { id: 4, label: "Review & save" },
];

const previews = [
  { src: "/creator-avatar-front.webp", alt: "Front-facing presenter design preview" },
  { src: "/creator-avatar-left.webp", alt: "Left-angle presenter design preview" },
  { src: "/creator-avatar-right.webp", alt: "Right-angle presenter design preview" },
];

export function AvatarSettingsClient({ data, onSectionChange }: { data: SettingsData; onSectionChange: (tab: SettingsTabId) => void }) {
  const initial = data.presenter?.presenter;
  const [response, setResponse] = useState<PresenterResponse | null>(data.presenter);
  const [step, setStep] = useState<SetupStep>(1);
  const [highestStep, setHighestStep] = useState<SetupStep>(1);
  const [look, setLook] = useState<LookChoice>(lookChoice(initial?.visualStyle));
  const [background, setBackground] = useState<BackgroundChoice>(backgroundChoice(initial?.background));
  const [voiceEnabled, setVoiceEnabled] = useState(initial?.mode === "talking-avatar" || initial?.mode === "hybrid-explainer");
  const [created, setCreated] = useState(Boolean(initial));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(initial ? "Loaded the saved Brand presenter profile." : "Identity-media enrollment is not enabled; you can still save presenter preferences.");

  function chooseStep(next: SetupStep) {
    if (next > highestStep || saving) return;
    setStep(next);
    setNotice(`${steps.find((item) => item.id === next)?.label ?? "Avatar setup"} opened.`);
  }

  function advance(next: SetupStep) {
    setStep(next);
    setHighestStep((current) => Math.max(current, next) as SetupStep);
  }

  async function saveDraft() {
    if (!data.authenticated || !data.brand) {
      setNotice("Sign in and choose a Brand before saving a presenter.");
      return;
    }
    setSaving(true);
    setNotice("Saving presenter draft…");
    const body = presenterDraft({ brandName: data.brand.name, look, background, voiceEnabled, ...(response?.presenter ? { expectedVersion: response.presenter.version } : {}) });
    try {
      const request = await fetch("/api/settings/presenter", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId: data.brand.id, ...body }) });
      const result = await request.json().catch(() => null) as PresenterResponse | { error?: string } | null;
      if (!request.ok || !result || !("presenter" in result)) throw new Error(result && "error" in result ? result.error : "Kairo could not save this presenter.");
      setResponse(result);
      setCreated(true);
      setNotice("Presenter preferences saved as an authoritative Brand draft.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Kairo could not save this presenter.");
    } finally {
      setSaving(false);
    }
  }

  return <section className={styles.page} aria-labelledby="avatar-settings-title">
    <div className={styles.breadcrumb}><ArrowLeft aria-hidden="true"/>Settings</div>
    <header className={styles.header}><h1 id="avatar-settings-title">{created ? "Your AI Creator Avatar" : "Create your AI Creator Avatar"}</h1><p>{created ? "This Brand-scoped presenter profile is stored in Kairo and remains fail-closed without a healthy rendering provider." : "Save presenter style preferences now; private identity-media enrollment requires a separately approved storage workflow."}</p></header>
    <ol className={styles.stepper} aria-label="Avatar setup progress">
      {steps.map((item) => {
        const completed = item.id < step || created;
        const active = item.id === step && !created;
        return <li key={item.id} data-active={active} data-complete={completed}><button type="button" onClick={() => chooseStep(item.id)} disabled={item.id > highestStep || created || saving} aria-current={active ? "step" : undefined}><span>{completed ? <Check aria-hidden="true"/> : item.id}</span><strong>{item.label}</strong>{item.helper ? <small>{item.helper}</small> : null}</button></li>;
      })}
    </ol>
    <nav className={styles.settingsNav} aria-label="Settings sections">{SETTINGS_TABS.map((section) => <button key={section.id} type="button" aria-pressed={section.id === "avatar"} onClick={() => section.id === "avatar" ? setNotice("AI Creator Avatar is already open.") : onSectionChange(section.id)}>{section.label}</button>)}</nav>
    <p className={styles.srStatus} role="status" aria-live="polite">{notice}</p>
    {created ? <CreatedState response={response} look={look} background={background} voiceEnabled={voiceEnabled} onEdit={() => { setCreated(false); setStep(2); setHighestStep(4); }}/>
      : step === 1 ? <IdentityBoundary capabilities={response?.capabilities} onContinue={() => advance(2)}/>
        : step === 2 ? <LookStep look={look} background={background} onLook={setLook} onBackground={setBackground} onBack={() => setStep(1)} onContinue={() => advance(3)}/>
          : step === 3 ? <VoiceStep enabled={voiceEnabled} onEnabled={setVoiceEnabled} onBack={() => setStep(2)} onContinue={() => advance(4)}/>
            : <ReviewStep look={look} background={background} voiceEnabled={voiceEnabled} saving={saving} onBack={() => setStep(3)} onSave={saveDraft}/>}
  </section>;
}

function IdentityBoundary({ capabilities, onContinue }: { capabilities?: PresenterResponse["capabilities"]; onContinue: () => void }) {
  return <><div className={styles.identityGrid}>
    <section className={styles.identityPanel}><h2>Identity media boundary</h2><div className={styles.uploadBox} aria-disabled="true"><ImagePlus aria-hidden="true"/><strong>Private identity-media enrollment is not enabled</strong><button type="button" disabled>Uploads unavailable</button><p>Kairo does not accept face or voice enrollment media through this Settings release. No social or website photos are imported.</p></div><div className={styles.photoSection}><h3>Approved design previews — not enrolled media</h3><div className={styles.photoStrip}>{previews.map((preview) => <div key={preview.src}><Image src={preview.src} alt={preview.alt} fill sizes="(max-width: 720px) 30vw, 150px"/></div>)}</div><p><strong>0 identity files stored</strong><span>Truthful runtime state</span></p></div></section>
    <section className={styles.qualityPanel}><h2>Runtime capability</h2><div className={styles.presenterPreview}><Image src="/creator-avatar-front.webp" alt="Presenter style illustration" fill priority sizes="(max-width: 960px) 100vw, 52vw"/></div><div className={styles.qualityRows}><CapabilityRow label="Provider configured" good={Boolean(capabilities?.providerConfigured)}/><CapabilityRow label="Avatar rendering" good={Boolean(capabilities?.avatarRendering)}/><CapabilityRow label="Private test clip" good={Boolean(capabilities?.testClip)}/></div><p className={styles.reviewNote}><ShieldCheck aria-hidden="true"/>{capabilities?.reason ?? "Capabilities fail closed until a server-side Avatar provider is configured."}</p></section>
  </div><footer className={styles.identityFooter}><p className={styles.reviewNote}><ShieldCheck aria-hidden="true"/>Continue to save non-sensitive presenter preferences only.</p><div><button className={styles.primaryButton} type="button" onClick={onContinue}>Continue to Look <ChevronRight aria-hidden="true"/></button></div></footer></>;
}

function LookStep({ look, background, onLook, onBackground, onBack, onContinue }: { look: LookChoice; background: BackgroundChoice; onLook: (value: LookChoice) => void; onBackground: (value: BackgroundChoice) => void; onBack: () => void; onContinue: () => void }) {
  return <div className={styles.choiceLayout}><section className={styles.choicePreview}><span>Style illustration</span><Image src="/creator-avatar-front.webp" alt="Selected presenter style illustration" fill sizes="(max-width: 960px) 100vw, 48vw"/></section><section className={styles.choicePanel}><header><Lightbulb aria-hidden="true"/><div><h2>Choose a default look</h2><p>This descriptive preference is stored with the Brand presenter profile.</p></div></header><ChoiceGroup label="Presenter style" choices={["Professional", "Casual", "Campaign"] as LookChoice[]} selected={look} onSelect={onLook}/><ChoiceGroup label="Default background" choices={["Home office", "Studio", "Brand scene"] as BackgroundChoice[]} selected={background} onSelect={onBackground}/><StepActions onBack={onBack} onContinue={onContinue} continueLabel="Continue to Voice"/></section></div>;
}

function VoiceStep({ enabled, onEnabled, onBack, onContinue }: { enabled: boolean; onEnabled: (value: boolean) => void; onBack: () => void; onContinue: () => void }) {
  return <div className={styles.voiceLayout}><section><Mic2 aria-hidden="true"/><h2>Voice preference only</h2><p>This records whether you want a future talking-avatar workflow. It does not upload, clone, or activate a voice.</p></section><section className={styles.voiceChoices}><button type="button" data-selected={enabled} onClick={() => onEnabled(true)}><Mic2 aria-hidden="true"/><span><strong>Prefer a talking avatar</strong><small>Enrollment and rendering remain unavailable until separately configured.</small></span><CheckCircle2 aria-hidden="true"/></button><button type="button" data-selected={!enabled} onClick={() => onEnabled(false)}><ShieldCheck aria-hidden="true"/><span><strong>Continue without voice</strong><small>Use a basic visual presenter profile.</small></span><CheckCircle2 aria-hidden="true"/></button><StepActions onBack={onBack} onContinue={onContinue} continueLabel="Review presenter"/></section></div>;
}

function ReviewStep({ look, background, voiceEnabled, saving, onBack, onSave }: { look: LookChoice; background: BackgroundChoice; voiceEnabled: boolean; saving: boolean; onBack: () => void; onSave: () => void }) {
  return <div className={styles.reviewLayout}><section className={styles.reviewPreview}><Image src="/creator-avatar-front.webp" alt="Presenter profile illustration" fill sizes="(max-width: 960px) 100vw, 48vw"/></section><section className={styles.reviewPanel}><header><ShieldCheck aria-hidden="true"/><div><h2>Review & save</h2><p>The saved profile remains a draft until a configured provider reports it eligible.</p></div></header><dl><SummaryRow label="Identity media" value="Not enrolled"/><SummaryRow label="Look" value={`${look} · ${background}`}/><SummaryRow label="Voice" value={voiceEnabled ? "Preference requested" : "Not enabled"}/><SummaryRow label="Saved status" value="Draft"/></dl><p className={styles.reviewNote}><ShieldCheck aria-hidden="true"/>This mutation stores descriptive Brand presenter preferences only.</p><StepActions onBack={onBack} onContinue={onSave} continueLabel={saving ? "Saving…" : "Create & save draft"} disabled={saving}/></section></div>;
}

function CreatedState({ response, look, background, voiceEnabled, onEdit }: { response: PresenterResponse | null; look: LookChoice; background: BackgroundChoice; voiceEnabled: boolean; onEdit: () => void }) {
  const eligibility = response?.eligibility?.status ?? "draft";
  const canTest = Boolean(response?.capabilities.testClip);
  return <div className={styles.createdState}><div className={styles.createdPreview}><Image src="/creator-avatar-front.webp" alt="Saved presenter style illustration" fill priority sizes="(max-width: 960px) 100vw, 48vw"/></div><section><span><CheckCircle2 aria-hidden="true"/>Authoritative draft saved</span><h2>{eligibility === "eligible" ? "Your presenter is eligible." : "Your presenter remains fail-closed."}</h2><p>{response?.eligibility?.reason ?? "A rendering provider must be configured before Kairo can use this presenter in content."}</p><dl><SummaryRow label="Look" value={`${look} · ${background}`}/><SummaryRow label="Voice" value={voiceEnabled ? "Preference requested" : "Not enabled"}/><SummaryRow label="Runtime eligibility" value={eligibility}/></dl><div><button className={styles.primaryButton} type="button" disabled={!canTest}><Video aria-hidden="true"/>{canTest ? "Generate private test" : "Test unavailable"}</button><button className={styles.secondaryButton} type="button" onClick={onEdit}>Edit preferences</button></div></section></div>;
}

function CapabilityRow({ label, good }: { label: string; good: boolean }) {
  return <div><ShieldCheck aria-hidden="true"/><strong>{label}</strong><span data-good={good}>{good ? "Available" : "Unavailable"}{good ? <CheckCircle2 aria-hidden="true"/> : <CircleAlert aria-hidden="true"/>}</span></div>;
}

function ChoiceGroup<T extends string>({ label, choices, selected, onSelect }: { label: string; choices: readonly T[]; selected: T; onSelect: (value: T) => void }) {
  return <fieldset className={styles.choiceGroup}><legend>{label}</legend><div>{choices.map((choice) => <button key={choice} type="button" data-selected={selected === choice} onClick={() => onSelect(choice)}>{choice}{selected === choice ? <Check aria-hidden="true"/> : null}</button>)}</div></fieldset>;
}

function StepActions({ onBack, onContinue, continueLabel, disabled = false }: { onBack: () => void; onContinue: () => void; continueLabel: string; disabled?: boolean }) {
  return <div className={styles.stepActions}><button className={styles.secondaryButton} type="button" onClick={onBack} disabled={disabled}><ArrowLeft aria-hidden="true"/>Back</button><button className={styles.primaryButton} type="button" onClick={onContinue} disabled={disabled}>{continueLabel}<ChevronRight aria-hidden="true"/></button></div>;
}

function SummaryRow({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function lookChoice(value?: string): LookChoice { return value === "Casual" || value === "Campaign" ? value : "Professional"; }
function backgroundChoice(value?: string): BackgroundChoice { return value === "Studio" || value === "Brand scene" ? value : "Home office"; }
