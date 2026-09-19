"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ComponentType } from "react";
import {
  ArrowLeft,
  BellRing,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CloudCog,
  CreditCard,
  Download,
  Eye,
  Globe2,
  ImageIcon,
  Instagram,
  KeyRound,
  Languages,
  Linkedin,
  LockKeyhole,
  Mail,
  Pencil,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  Video,
  Youtube,
} from "lucide-react";
import { SETTINGS_TABS, type SettingsTabId } from "../../lib/settings";
import { canPublish, channelSettingsHref, type SettingsData } from "../../lib/settings-data";
import { AvatarSettingsClient } from "./avatar-settings-client";
import styles from "./settings-system.module.css";

const tabCopy: Record<Exclude<SettingsTabId, "avatar">, { title: string; description: string }> = {
  account: { title: "Account & Profile", description: "Manage your personal information, security, notifications, and data preferences." },
  workspace: { title: "Brand & Workspace", description: "Manage the Brand identity, workspace defaults, billing, and ownership." },
  channels: { title: "Channels & Publishing", description: "Control connected destinations, publishing defaults, and approval safeguards." },
  providers: { title: "AI & Media Providers", description: "Choose the approved services Kairo can use for intelligence and media generation." },
  team: { title: "Team & Permissions", description: "Invite collaborators and control who can review, publish, and manage the workspace." },
};

type EditableKey = "name" | "email" | "timezone" | "language";

export function SettingsClient({ data, initialTab = "account" }: { data: SettingsData; initialTab?: SettingsTabId }) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [notice, setNotice] = useState(`${SETTINGS_TABS.find((item) => item.id === initialTab)?.label ?? "Settings"} opened.`);

  function chooseTab(tab: SettingsTabId) {
    setActiveTab(tab);
    const label = SETTINGS_TABS.find((item) => item.id === tab)?.label ?? "Settings";
    setNotice(`${label} opened.`);
  }

  if (activeTab === "avatar") return <AvatarSettingsClient data={data} onSectionChange={chooseTab}/>;

  const copy = tabCopy[activeTab];
  return <section id="settings-content" className={styles.page} aria-labelledby="settings-title">
    <div className={styles.breadcrumb}><ArrowLeft aria-hidden="true"/>Settings</div>
    <header className={styles.pageHeader}>
      <h1 id="settings-title">{copy.title}</h1>
      <p>{copy.description}</p>
    </header>
    <SettingsNav activeTab={activeTab} onChange={chooseTab}/>
    <p className={styles.srStatus} role="status" aria-live="polite">{notice}</p>
    {!data.authenticated ? <p className={styles.runtimeNotice}><LockKeyhole aria-hidden="true"/>Sign in to load your account and workspace settings.</p> : null}
    {activeTab === "account" ? <AccountPanel data={data} onNotice={setNotice}/> : null}
    {activeTab === "workspace" ? <WorkspacePanel data={data} onNotice={setNotice}/> : null}
    {activeTab === "channels" ? <ChannelsPanel data={data} onNotice={setNotice}/> : null}
    {activeTab === "providers" ? <ProvidersPanel data={data} onNotice={setNotice}/> : null}
    {activeTab === "team" ? <TeamPanel data={data} onNotice={setNotice}/> : null}
  </section>;
}

function SettingsNav({ activeTab, onChange }: { activeTab: SettingsTabId; onChange: (tab: SettingsTabId) => void }) {
  return <div className={styles.tabs} role="tablist" aria-label="Settings sections">
    {SETTINGS_TABS.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => onChange(tab.id)}>{tab.label}</button>)}
  </div>;
}

function AccountPanel({ data, onNotice }: { data: SettingsData; onNotice: (message: string) => void }) {
  const name = data.account.displayName;
  const email = data.account.email ?? "Not provided by the identity provider";
  const role = data.workspace?.role === "owner" ? "Owner" : data.workspace ? "Member" : "No workspace";
  return <div className={styles.accountPanel} role="tabpanel">
    <section className={styles.identityBand}>
      <div className={styles.accountInitial} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
      <div><h2>{name}</h2><p>{email}</p><span>Role <b>{role}</b></span></div>
      <button className={styles.outlineButton} type="button" disabled title="Profile photo storage is not enabled for this release."><ImageIcon aria-hidden="true"/>Photo unavailable</button>
    </section>

    <div className={styles.accountColumns}>
      <div>
        <section className={styles.sectionBlock}>
          <header><h2>Personal information</h2><p>These values come from your authenticated identity.</p></header>
          <ReadOnlyRow icon={UserRound} label="Display name" value={name}/>
          <ReadOnlyRow icon={Mail} label="Email" value={email}/>
          <ReadOnlyRow icon={Globe2} label="Timezone" value="Not configured"/>
          <ReadOnlyRow icon={Languages} label="Language" value="Not configured"/>
        </section>
        <section className={styles.sectionBlock}>
          <header><h2>Security</h2><p>Protect access to your Kairo account.</p></header>
          <ActionRow icon={KeyRound} title="Password" detail="Managed by your identity provider" action="Provider managed" disabled onAction={() => onNotice("Password management stays with your identity provider.")}/>
          <ActionRow icon={ShieldCheck} title="Two-factor authentication" detail="Managed by your identity provider" action="Provider managed" disabled onAction={() => onNotice("Two-factor authentication stays with your identity provider.")}/>
        </section>
      </div>

      <div>
        <section className={styles.sectionBlock}>
          <header><h2>Notifications</h2><p>Kairo exposes truthful in-app operational notices; delivery preferences are not configured yet.</p></header>
          <ToggleRow icon={BellRing} label="Discovery ready" detail="Available in Kairo when new discoveries are present." checked disabled onChange={() => undefined}/>
          <ToggleRow icon={ShieldCheck} label="Content approval" detail="Derived from real review state inside Kairo." checked disabled onChange={() => undefined}/>
          <ToggleRow icon={CircleAlert} label="Publishing failures" detail="Derived from failed publishing commands." checked disabled onChange={() => undefined}/>
          <ToggleRow icon={CloudCog} label="Weekly performance summary" detail="Email digest delivery is not enabled." checked={false} disabled onChange={() => undefined}/>
        </section>
        <section className={styles.sectionBlock}>
          <header><h2>Privacy & Data</h2><p>Control access to your information.</p></header>
          <ActionRow icon={Download} title="Data export" detail="No approved export workflow is configured." action="Unavailable" disabled onAction={() => onNotice("Data export is not enabled.")}/>
          <ActionRow icon={LockKeyhole} title="Connected-source permissions" detail="Manage connections from the Brand Channels surface." action="Open Channels" onAction={() => onNotice("Open Channels & Publishing to review connected accounts.")}/>
          <ActionRow icon={Trash2} title="Delete account" detail="No account-deletion command is exposed in this release." tone="danger" action="Unavailable" disabled onAction={() => onNotice("Account deletion is not enabled.")}/>
        </section>
      </div>
    </div>
    <footer className={styles.actionBar}><span>Account identity is synchronized from the authenticated session.</span><div><button className={styles.primaryButton} type="button" disabled><Check aria-hidden="true"/>No editable account fields</button></div></footer>
  </div>;
}

function WorkspacePanel({ data, onNotice }: { data: SettingsData; onNotice: (message: string) => void }) {
  const workspaceName = data.workspace?.name ?? "No workspace";
  const brandName = data.brand?.name ?? "No Brand";
  const owner = data.workspace?.role === "owner";
  return <div className={styles.workspacePanel} role="tabpanel">
    <section className={styles.summaryBand}><span><Building2 aria-hidden="true"/></span><div><small>Authenticated workspace</small><h2>{workspaceName}</h2><p>{brandName} · {owner ? "Owner access" : data.workspace ? "Member access" : "No active membership"}</p></div><b data-connected={Boolean(data.workspace)}>{data.workspace ? <><CheckCircle2 aria-hidden="true"/>Active</> : "Unavailable"}</b></section>
    <div className={styles.twoColumns}>
      <section className={styles.formPanel}><header><h2>Brand identity</h2><p>Authoritative names from the current Workspace and Brand records.</p></header><ReadOnlyRow icon={Building2} label="Brand name" value={brandName}/><ReadOnlyRow icon={UsersRound} label="Workspace name" value={workspaceName}/><ReadOnlyRow icon={Globe2} label="Workspace URL" value="No workspace slug contract"/><ReadOnlyRow icon={CloudCog} label="Default timezone" value="Not configured"/><ReadOnlyRow icon={CreditCard} label="Billing currency" value="Not configured"/></section>
      <div>
        <section className={styles.formPanel}><header><h2>Plan & billing</h2><p>No billing provider or subscription contract is connected to Settings.</p></header><div className={styles.planRow}><span><small>Runtime plan</small><strong>Not available</strong><p>Kairo will show real plan and seat data when a billing contract exists.</p></span><b>—</b></div><ActionRow icon={Mail} title="Billing email" detail="Not configured" action="Unavailable" disabled onAction={() => onNotice("Billing is not configured.")}/><ActionRow icon={CreditCard} title="Payment method" detail="No payment details are stored by this surface" action="Unavailable" disabled onAction={() => onNotice("Billing is not configured.")}/></section>
        <section className={styles.formPanel}><header><h2>Workspace ownership</h2><p>Only authenticated membership information is shown.</p></header><ActionRow icon={UsersRound} title="Your workspace role" detail={owner ? "Owner" : data.workspace ? "Member" : "No membership"} action="Read only" disabled onAction={() => onNotice("Workspace roles are read-only here.")}/><ActionRow icon={Trash2} title="Delete workspace" detail="No workspace-deletion command is exposed in this release." tone="danger" action="Unavailable" disabled onAction={() => onNotice("Workspace deletion is not enabled.")}/></section>
      </div>
    </div>
    <ReadOnlyFooter text="Workspace and Brand records are loaded from Kairo's authenticated API."/>
  </div>;
}

function ChannelsPanel({ data, onNotice }: { data: SettingsData; onNotice: (message: string) => void }) {
  const canonicalHref = data.brand ? channelSettingsHref(data.brand.id) : undefined;
  const instagramConnectHref = data.brand ? `/channels/instagram/start?brand=${encodeURIComponent(data.brand.id)}` : undefined;
  const channels = data.channels;
  return <div className={styles.stackPanel} role="tabpanel">
    <section className={styles.formPanel}><header className={styles.panelHeader}><div><h2>Connected channels</h2><p>Connection, health, and publishing capability come from the authenticated channel API.</p></div>{instagramConnectHref ? <Link className={styles.primaryButton} href={instagramConnectHref}><Plus aria-hidden="true"/>Connect Instagram</Link> : <button className={styles.primaryButton} type="button" disabled><Plus aria-hidden="true"/>Choose a Brand</button>}</header>{channels.length ? <div className={styles.channelList}>{channels.map((channel) => {
      const Icon = channel.channel === "instagram" ? Instagram : channel.channel === "linkedin" ? Linkedin : Globe2;
      const status = channel.status === "connected" ? "Connected" : channel.status === "reconnect-required" ? "Reconnect required" : "Disabled";
      return <article key={channel.id}><span><Icon aria-hidden="true"/></span><div><strong>{channel.displayName || channel.channel}</strong><small>{channel.accountRef}</small></div><b data-connected={channel.status === "connected"}>{status}</b><label><span>Can publish</span><button className={styles.switch} type="button" role="switch" aria-checked={canPublish(channel)} aria-label={`${channel.displayName} publishing capability`} disabled><span/></button></label>{canonicalHref ? <Link className={styles.rowButton} href={canonicalHref}>View</Link> : <button className={styles.rowButton} type="button" disabled>Unavailable</button>}</article>;
    })}</div> : <p className={styles.emptyState}>No connected channel accounts were returned for this Brand.</p>}</section>
    <div className={styles.twoColumns}>
      <section className={styles.formPanel}><header><h2>Publishing safeguards</h2><p>Existing immutable approval and destination checks remain enforced.</p></header><ToggleRow icon={ShieldCheck} label="Require approval before publishing" detail="Locked on by Kairo's publishing contract." checked disabled onChange={() => undefined}/><ToggleRow icon={CloudCog} label="Use best-time recommendations" detail="No workspace preference contract exists yet." checked={false} disabled onChange={() => undefined}/><ActionRow icon={CircleAlert} title="Failure handling" detail="Failures remain visible in Kairo's operational notifications." action="System managed" disabled onAction={() => onNotice("Failure handling is system-managed.")}/></section>
      <section className={styles.formPanel}><header><h2>Content defaults</h2><p>No server-side channel default preferences are configured.</p></header><SelectRow label="Instagram default" value="Human approval required" options={["Human approval required"]} disabled/><SelectRow label="LinkedIn default" value="Human approval required" options={["Human approval required"]} disabled/><SelectRow label="Default link tracking" value="Not configured" options={["Not configured"]} disabled/><SelectRow label="Publishing timezone" value="Explicit per schedule" options={["Explicit per schedule"]} disabled/></section>
    </div><ReadOnlyFooter text="Publishing authority can only be changed through approved channel connection flows."/>
  </div>;
}

function ProvidersPanel({ data, onNotice }: { data: SettingsData; onNotice: (message: string) => void }) {
  const avatar = data.presenter?.capabilities;
  return <div className={styles.stackPanel} role="tabpanel">
    <section className={styles.providerIntro}><span><ShieldCheck aria-hidden="true"/></span><div><h2>Provider access is server-managed</h2><p>Credentials stay outside the browser and domain records. This page reports capabilities without exposing provider secrets.</p></div></section>
    <div className={styles.providerGrid}>
      <ProviderCard icon={Bot} title="Intelligence & writing" status="Server managed" description="Discovery analysis, ranking, captions, and content planning." value="Runtime configuration"/>
      <ProviderCard icon={ImageIcon} title="Avatar rendering" status={avatar?.avatarRendering ? "Available" : "Unavailable"} good={avatar?.avatarRendering} description={avatar?.reason ?? "Capability is reported by Kairo's replaceable Avatar provider boundary."} value={avatar?.providerConfigured ? "Provider configured" : "No provider configured"}/>
      <ProviderCard icon={Video} title="Avatar test clips" status={avatar?.testClip ? "Available" : "Unavailable"} good={avatar?.testClip} description="Private test generation remains disabled unless the server reports this capability." value={avatar?.testClip ? "Runtime capability" : "Not configured"}/>
    </div>
    <section className={styles.formPanel}><header><h2>Provider rules</h2><p>Security boundaries are enforced in the runtime, not editable browser preferences.</p></header><ToggleRow icon={ShieldCheck} label="Require approved providers" detail="Locked on; unconfigured capabilities fail closed." checked disabled onChange={() => undefined}/><ActionRow icon={CreditCard} title="Monthly provider budget" detail="No workspace budget preference contract exists." action="Unavailable" disabled onAction={() => onNotice("Provider budgets are not enabled.")}/><ActionRow icon={Eye} title="Generation audit log" detail="No Settings projection is approved for provider audit records." action="Unavailable" disabled onAction={() => onNotice("Provider audit projection is not enabled.")}/></section>
    <ReadOnlyFooter text="Provider credentials and selections remain deployment-managed."/>
  </div>;
}

function TeamPanel({ data, onNotice }: { data: SettingsData; onNotice: (message: string) => void }) {
  const role = data.workspace?.role === "owner" ? "Owner" : "Member";
  return <div className={styles.stackPanel} role="tabpanel">
    <section className={styles.formPanel}><header className={styles.panelHeader}><div><h2>Your workspace access</h2><p>The current API exposes the signed-in member's role; it does not expose a team roster or invitation workflow.</p></div><button className={styles.primaryButton} type="button" disabled title="Team invitations require a separately approved contract."><Plus aria-hidden="true"/>Invites unavailable</button></header>{data.workspace ? <div className={styles.memberList}><article><span>{data.account.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{data.account.displayName}</strong><small>{data.account.email ?? "No email returned"}</small></div><select aria-label={`${data.account.displayName} role`} value={role} disabled><option>{role}</option></select><b data-status="Active">Active</b><button className={styles.rowButton} type="button" disabled>Read only</button></article></div> : <p className={styles.emptyState}>No active Workspace membership was returned.</p>}</section>
    <section className={styles.formPanel}><header><h2>Approved permission model</h2><p>Kairo currently stores only Owner and Member roles. Finer roles are not represented as active permissions.</p></header><div className={`${styles.permissionGrid} ${styles.compactPermissions}`}><span>Capability</span><b>Owner</b><b>Member</b>{[["Manage workspace",true,false],["Use Brand workflows",true,true],["Approve content",true,true],["Publish approved content",true,true],["View reports",true,true]].map(([label,...values]) => <div key={String(label)} className={styles.permissionRow}><strong>{String(label)}</strong>{values.map((value,index) => <span key={index}>{value ? <Check aria-label="Allowed"/> : <span aria-label="Not allowed">—</span>}</span>)}</div>)}</div></section>
  </div>;
}

function EditableRow({ icon: Icon, label, fieldKey, value, editing, draft, setDraft, onEdit, onSave, onCancel }: { icon: ComponentType<{ "aria-hidden": "true" }>; label: string; fieldKey: EditableKey; value: string; editing: boolean; draft: string; setDraft: (value: string) => void; onEdit: (key: EditableKey) => void; onSave: (key: EditableKey) => void; onCancel: () => void }) {
  return <div className={styles.editableRow}><Icon aria-hidden="true"/><span><strong>{label}</strong>{editing ? <input aria-label={`Edit ${label}`} value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus/> : <small>{value}</small>}</span>{editing ? <div><button type="button" onClick={() => onSave(fieldKey)}>Save</button><button type="button" onClick={onCancel}>Cancel</button></div> : <button className={styles.textButton} type="button" onClick={() => onEdit(fieldKey)}><Pencil aria-hidden="true"/>Edit</button>}</div>;
}

function ReadOnlyRow({ icon: Icon, label, value }: { icon: ComponentType<{ "aria-hidden": "true" }>; label: string; value: string }) {
  return <div className={styles.editableRow}><Icon aria-hidden="true"/><span><strong>{label}</strong><small>{value}</small></span><b className={styles.readOnlyBadge}>Read only</b></div>;
}

function ActionRow({ icon: Icon, title, detail, action, tone, disabled = false, onAction }: { icon: ComponentType<{ "aria-hidden": "true" }>; title: string; detail: string; action: string; tone?: "good" | "danger"; disabled?: boolean; onAction: () => void }) {
  return <div className={styles.actionRow}><Icon aria-hidden="true"/><span><strong>{title}</strong><small data-tone={tone}>{detail}</small></span><button type="button" data-tone={tone} disabled={disabled} onClick={onAction}>{action}{disabled ? null : <ChevronRight aria-hidden="true"/>}</button></div>;
}

function ToggleRow({ icon: Icon, label, detail, checked, disabled = false, onChange, delivery, onDeliveryChange }: { icon: ComponentType<{ "aria-hidden": "true" }>; label: string; detail: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; delivery?: string; onDeliveryChange?: (value: string) => void }) {
  return <div className={styles.toggleRow} data-delivery={Boolean(delivery)}><Icon aria-hidden="true"/><span><strong>{label}</strong><small>{detail}</small></span><button className={styles.switch} type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span/></button>{delivery && onDeliveryChange ? <select aria-label={`${label} delivery`} value={delivery} disabled={disabled} onChange={(event) => onDeliveryChange(event.target.value)}><option>Email, In-app</option><option>Email</option><option>In-app</option></select> : null}</div>;
}

function InlineField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  return <div className={styles.inlineField}><span><strong>{label}</strong>{editing ? <input aria-label={`Edit ${label}`} value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus/> : <small>{value}</small>}</span>{editing ? <div><button type="button" onClick={() => { onChange(draft); setEditing(false); }}>Save</button><button type="button" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</button></div> : <button className={styles.textButton} type="button" onClick={() => setEditing(true)}><Pencil aria-hidden="true"/>Edit</button>}</div>;
}

function SelectRow({ label, value, options, disabled = false }: { label: string; value: string; options: string[]; disabled?: boolean }) {
  const [selected, setSelected] = useState(value);
  return <label className={styles.selectRow}><span>{label}</span><select value={selected} disabled={disabled} onChange={(event) => setSelected(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function ProviderCard({ icon: Icon, title, status, good, description, value }: { icon: ComponentType<{ "aria-hidden": "true" }>; title: string; status: string; good?: boolean; description: string; value: string }) {
  return <section className={styles.providerCard}><header><span><Icon aria-hidden="true"/></span><b data-good={good}>{status}</b></header><h2>{title}</h2><p>{description}</p><label><span>Configuration</span><select value={value} disabled><option>{value}</option></select></label><button className={styles.outlineButton} type="button" disabled><Settings2 aria-hidden="true"/>Server managed</button></section>;
}

function ReadOnlyFooter({ text }: { text: string }) {
  return <footer className={styles.actionBar}><span>{text}</span><div><button className={styles.primaryButton} type="button" disabled><LockKeyhole aria-hidden="true"/>No editable preferences</button></div></footer>;
}
