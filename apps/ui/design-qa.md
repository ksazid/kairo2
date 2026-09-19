# Kairo UI v2 — Design QA

## Home

Reference: approved Kairo Home mockup supplied by the Product Owner.

| Surface | Result |
| --- | --- |
| Independent dark shell and dedicated design tokens | Passed |
| Sidebar, brand controls, creation formats and viral-link analysis | Passed |
| Three-column recommendation, Continue Working, learning and discovery rail | Passed |
| Desktop and mobile responsive behavior | Passed |

## Discover Table and Grid

Reference: `/workspace/scratch/9b13db4cc8b7/upload/0241D33D-99EC-40CD-8D4F-3240222ADB62.jpeg` (1536 × 1024).

Implementation: `https://kairo-ui-v2-9tdybjbk3-sazid62-gmailcoms-projects.vercel.app/discover`, captured in the cloud browser at 1363 × 936 in Table state.

### Visual comparison

The approved reference and the browser-rendered implementation were reviewed together in one comparison pass. The implementation preserves the reference hierarchy, dark shell, typography scale, image-led opportunity rows, fit and trend evidence, format/source metadata, circular BI confidence, and aligned Preview/Save/Dismiss action row. The approved Table/Grid control is additive. At the narrower QA viewport the filters wrap to a safe second row instead of colliding.

| Surface | Result |
| --- | --- |
| Kairo shell, navigation and active Discover state | Passed |
| Discover heading, search, status filters and Refresh action | Passed |
| Detailed Table columns and opportunity imagery | Passed |
| Brand-fit, trend, format, channel, source and BI confidence data | Passed |
| Preview, Save and Dismiss action alignment | Passed |
| Alternate visual Grid using the same records and actions | Passed |
| Table/Grid selection persistence | Passed |
| Responsive filter wrapping and safe table width | Passed |

### Iteration history

1. Initial comparison found filter collision and clipped Actions at 1363 px (P1).
2. Filters were moved to a responsive second row below 1400 px and table columns were rebalanced.
3. Final comparison confirmed all Actions visible, no broken images, no page overflow, and no remaining P0/P1/P2 visual issue.

### Interaction verification

- Table/Grid parity: 6 records in both views.
- View persistence: Grid persisted across reload; Table restored on selection.
- Search: `airport` returned the single matching opportunity.
- Developing filter: returned the road-trip checklist opportunity.
- Save: changed the selected item to its saved state.
- Dismiss: reduced the result set from 6 to 5.
- Refresh discovery: restored all 6 records.
- Preview: routed to the matching `/discover/[id]` concept-preview page; browser Back returned to Discover.
- Console: no application-origin warnings or errors. Cloud-browser extension metadata errors were excluded as external tooling noise.

### Accepted responsive differences

- The reference shows 4 rows at 1536 px; the implementation uses 6 realistic records and naturally continues below the viewport.
- The implementation includes the approved Table/Grid selector and Channel filter.
- The 1363 px QA viewport uses a two-row filter layout; the 1536 px target retains the wider composition.

## Content List

Reference: `/workspace/scratch/9b13db4cc8b7/upload/2694B50A-D08B-4AF4-97DC-3B7175C7C1B0.jpeg` (1536 × 1024).

Implementation: Vercel preview deployment `dpl_9kdo3ioa8jBCVijZQLeEmsTaB5te`, captured in the cloud browser at 1365 × 936 in Table state.

### Visual comparison

The approved reference and browser-rendered implementation were reviewed together in one comparison pass. The implementation preserves the approved dark shell, heading and action hierarchy, three filter groups, image-led rows, channel and format metadata, lifecycle status, update timestamp, and aligned Open Preview action. The approved shared Table/Grid listing control and Campaigns shell link are additive.

| Surface | Result |
| --- | --- |
| Kairo shell, navigation and active Content state | Passed |
| Content heading, Create Content action and filter hierarchy | Passed |
| Detailed Table columns, row dimensions and imagery | Passed |
| Format, channel, status and timestamp metadata | Passed |
| Open Preview action alignment | Passed |
| Alternate visual Grid using the same records and actions | Passed |
| Table/Grid selection persistence | Passed |
| Responsive wrapping and safe table width | Passed |

### Interaction verification

- Table/Grid parity: 4 records in both views.
- View persistence: Grid persisted across reload; Table restored on selection.
- Search: `Scenic` returned the single matching asset.
- Scheduled filter: returned 1 asset.
- Carousel filter: returned 2 assets.
- Preview: each Open Preview action routed to the matching `/content/[campaignId]/[assetId]` page.
- Media: all browser-rendered images completed with a non-zero natural width.

### Accepted responsive differences

- The implementation includes the approved shared Table/Grid selector and the separately approved Campaigns shell link.
- Preview mode identifies fixture data in the top bar; authenticated mode projects existing Brand-scoped records.
- At the 1365 px QA viewport, spacing and typography scale proportionally while retaining the reference hierarchy.

## Content Preview

Reference: approved Content Preview hierarchy preserved in the existing Kairo content-preview implementation and the same Kairo visual language as the supplied Content List reference.

Implementation: `/content/malta-summer/content-one` in Vercel preview deployment `dpl_9kdo3ioa8jBCVijZQLeEmsTaB5te`.

| Surface | Result |
| --- | --- |
| Back link, content identity and lifecycle metadata | Passed |
| Platform-aware Post, Reel and Carousel media | Passed |
| Caption and social-preview context | Passed |
| Content details and evidence-safe performance state | Passed |
| Carousel navigation and card rail | Passed |
| AI assistance preview states | Passed |
| Approve, lock and schedule interactions | Passed |
| Authenticated handoff to the canonical full editor | Passed |

### Interaction verification

- Carousel navigation advanced from card `1/4` to `2/4` and card selection stayed synchronized.
- Improve Copy updated the preview caption and exposed a save-in-editor notice.
- Approve & Lock enabled Schedule; Schedule advanced the preview to its scheduled state.
- Reel rendered a visible Play control; Post rendered without Carousel controls.
- Back to Content returned to the shared list.
- No application-origin browser warnings or errors were recorded. Cloud-browser extension metadata errors were excluded as external tooling noise.

### Iteration history

1. Initial build used a 3.1 MB generated harbour PNG (P2 delivery weight).
2. The same generated asset was converted to an optimized 332 KB WebP without changing its crop or visual role.
3. Final comparison confirmed the approved hierarchy, healthy images, aligned actions and no remaining P0/P1/P2 visual issue.

## Campaign List

Reference: `/workspace/scratch/9b13db4cc8b7/upload/4F1108A2-D536-4B69-B508-6EB84281F826(1).jpeg` (1536 × 1024).

Implementation: `/campaigns`, captured in the cloud browser at 1365 × 917 in Table state.

### Visual comparison

The approved reference and the browser-rendered implementation were opened together and compared at the same desktop state. The implementation preserves the approved dark shell, Campaigns hierarchy, image-led rows, objective, circular progress, date range, status, aligned Open Campaign action, and pagination. The separately approved Campaigns shell link and Table/Grid selector are additive.

| Surface | Result |
| --- | --- |
| Kairo shell, navigation and active Campaigns state | Passed |
| Campaigns heading, Create Campaign action and filter hierarchy | Passed |
| Detailed Table columns, row density and image crops | Passed |
| Format, channel, progress, date and lifecycle metadata | Passed |
| Open Campaign action alignment | Passed |
| Alternate visual Grid using the same records and actions | Passed |
| Table/Grid selection persistence | Passed |
| Responsive wrapping and safe table width | Passed |

### Interaction verification

- Table/Grid parity: 3 campaigns in both views.
- View persistence: Grid persisted across reload; Table restored on selection.
- Search: `engagement` returned the single matching campaign.
- Draft filter: returned the single draft campaign; All restored all 3 campaigns.
- Open Campaign: routed to the matching `/campaigns/[campaignId]` preview.
- Layout: all 3 Open Campaign actions remained visible at 1365 px with no horizontal page overflow.
- Media: all browser-rendered images completed with a non-zero natural width.
- Console: no application-origin warnings or errors. Cloud-browser extension metadata errors were excluded as external tooling noise.

### Iteration history

1. Initial comparison found the Actions column clipped at the 1365 px QA viewport (P1).
2. Campaign columns and gaps were rebalanced while preserving the 1536 px reference proportions.
3. Final comparison confirmed all Actions visible and no remaining P0/P1/P2 visual issue.

### Accepted responsive differences

- Preview mode identifies fixture data in the top bar; authenticated mode projects existing Brand-scoped records.
- The Malta imagery follows the approved subject, palette and crop direction but is not the exact reference photograph; this is accepted P3 polish pending the planned per-section image agent.

## Campaign Preview

Reference: `/workspace/scratch/9b13db4cc8b7/upload/5E5819BA-6F5C-49B2-B908-18494710679D(1).jpeg` (1536 × 1024).

Implementation: `/campaigns/malta-summer`, captured in the cloud browser at 1365 × 917 in Draft state.

### Visual comparison

The approved reference and the browser-rendered implementation were opened together and compared at the same desktop state. The implementation preserves the approved campaign identity, objective and readiness summary, two-column Overview/Content Set composition, quality score, channel timeline, and three-part publishing action row.

| Surface | Result |
| --- | --- |
| Back link, lifecycle badge, campaign identity and readiness | Passed |
| Continue Campaign and Save actions | Passed |
| Campaign overview terms and campaign-quality score | Passed |
| Three-item coordinated Content Set and asset actions | Passed |
| Instagram and LinkedIn channel schedule | Passed |
| Review, Schedule and Publish action row | Passed |
| Responsive stacking and safe page width | Passed |

### Interaction verification

- Save changed visibly to Saved.
- View Recommendations exposed campaign guidance.
- LinkedIn selected its channel timeline state.
- View Full Schedule exposed a schedule notice.
- Review All exposed a review-ready notice.
- Schedule Campaign changed the campaign to scheduled state.
- Publish Campaign changed the campaign to published state.
- Every Content Set Open action routed to the matching v2 Content Preview.
- Back to Campaigns returned to the shared Campaign List.
- Media: all browser-rendered images completed with a non-zero natural width.
- Console: no application-origin warnings or errors. Cloud-browser extension metadata errors were excluded as external tooling noise.

### Iteration history

1. Initial comparison found preview objective/date copy and asset titles did not fully match the approved reference (P2).
2. Copy, dates, content titles and top workspace spacing were corrected.
3. Final comparison confirmed the complete approved section hierarchy and no remaining P0/P1/P2 visual issue.

### Accepted responsive differences

- At the 1365 × 917 QA viewport the publishing row starts below the first viewport and remains directly beneath the schedule; the 1536 × 1024 reference shows it in-frame.
- Malta images use the same approved visual direction rather than the exact source photographs; this is accepted P3 polish pending the planned per-section image agent.

Prior surfaces final result: passed

## Brand Brain

Source visual truth:

- Overview: `/workspace/scratch/b3d529b18d8b/generated_images/exec-1ea7d8a5-3b6a-4cc2-bc45-4c20411a6e6c.png` (1488 × 1024)
- Brand DNA: `/workspace/scratch/b3d529b18d8b/generated_images/exec-46ab6e2e-c550-40a2-9631-d90a6934f642.png` (1488 × 1024)
- Discovery Intelligence: `/workspace/scratch/b3d529b18d8b/generated_images/exec-8ecedc57-61a9-46e1-a81e-182a8117c021.png` (1488 × 1024)

Implementation screenshot: browser-rendered inline capture from `https://kairo-ui-v2-brand-brain-6tvmqpga4-sazid62-gmailcoms-projects.vercel.app/brand` at 1363 × 936 CSS px, DPR 1. The page measured 1363 × 1011 px with no horizontal overflow.

State: Overview with two review suggestions and Primary audience expanded; Brand DNA with Primary audience editing; Discovery Intelligence with the first topic editor open.

### Evidence and findings

- Fonts and typography: hierarchy, weights, and wrapping follow the approved Kairo shell. Dense table metadata remains intentionally compact; no unreadable or clipped text remains.
- Spacing and layout rhythm: the desktop shell, two-column Overview, Brand DNA table, Discovery plan and right rail match the approved composition. The corrected Discovery Save/Cancel actions now remain inline.
- Colors and tokens: the dark navy surfaces, violet action/selection color, lime readiness states, amber review states, borders, and progress tracks matched the approved direction.
- Image quality and asset fidelity: these screens do not rely on photographic or illustrative assets. Interface icons use the existing Lucide icon family consistently.
- Copy and content: the page and navigation use `Discovery Intelligence`; the later approved `Hunter schedule` label is reserved for the background-engine control inside that page.
- Responsive behavior: a 500 × 848, DPR 1 mobile capture showed safe single-column stacking and no horizontal page overflow. Tab navigation remains horizontally scrollable and the persistent bottom navigation remains available.
- Accessibility and behavior: semantic tabs, labeled edit controls, focus indicators, live status messages, and progress labels were present. All five tabs opened; Brand DNA and Discovery Intelligence Save/Cancel flows worked; Refresh Discovery completed; no application-origin console errors were observed. Cloud-browser extension metadata errors were excluded as external tooling noise.

Full-view comparisons placed each approved mockup and its post-fix browser render in the same comparison input. Focused comparison was required for the readiness score, Brand DNA editor row, and Discovery editor actions. The readiness score now uses the approved circular 84% treatment. Discovery Save measured 48.5 px wide inside a flex action row rather than stretching across the card.

### Comparison history

1. Initial browser comparison found the Discovery editor actions stretching into two full-width bars (P2) and the Overview score missing the approved circular treatment (P2).
2. CSS was corrected in `app/ui.css`: the readiness score now uses the approved circular progress treatment, and `.brand-topic-actions` now overrides the row's grid rule with an inline flex action row.
3. TypeScript, 34 Vitest checks, the production build, and repository preflight all passed after the corrections.
4. A protected Vercel preview was deployed after local-preview access was denied. Post-fix Overview, Brand DNA, and Discovery Intelligence renders were opened with their source mockups in the same comparison inputs.
5. Final comparison confirmed the corrected readiness ring and inline Discovery actions, no horizontal overflow, and no remaining actionable P0/P1/P2 visual issue.

### Implementation checklist

- [x] Build all five Brand Brain tabs.
- [x] Verify tab navigation and inline Save/Cancel flows.
- [x] Remove creator-facing Hunter terminology.
- [x] Correct the readiness ring and Discovery editor action layout.
- [x] Pass typecheck, tests, production build, and preflight.
- [x] Capture and compare the post-fix browser render against all three approved visual sources.

final result: passed

## Settings — Production-safe contract wiring

The approved Settings visual system is preserved, but this production pass supersedes preview-only behavior with authenticated runtime truth.

### Runtime boundaries

- Account identity, Workspace role, Brand identity, channel accounts, publishing capabilities, and Presenter capability/readiness now come from authenticated Kairo API contracts.
- Presenter Look, Background, and Voice preference save through the existing Brand-scoped `PUT /api/v1/brands/:brandId/presenter` contract with optimistic version checks.
- Profile-photo and identity-media uploads, notification delivery preferences, billing, team invitations/fine-grained roles, user-managed provider credentials, destructive account/workspace commands, and automatic Hunter scheduling remain visibly unavailable because no approved production contract exists.
- The three creator images are labeled as design previews and are never represented as enrolled identity media.
- Discovery Intelligence no longer claims a scheduled future Hunter run. It reports `Not scheduled` and leaves automatic scheduling disabled.

### Verification

- All six upper Settings tabs opened and exposed the expected level-one heading.
- The Avatar preference journey reached Review; a signed-out save was blocked with `Sign in and choose a Brand before saving a presenter.`
- The Hunter schedule boundary rendered `Unavailable` as a disabled control.
- Desktop document width matched viewport width at 1348 px with no horizontal overflow.
- No application-origin browser errors or warnings were recorded; extension metadata errors were external tooling noise.
- TypeScript passed, 12 Vitest files / 46 tests passed, production build passed, governance validation passed, and repository preflight passed.

final result: passed

## Complete Settings System and Hunter Schedule

Source visual truth: `/workspace/scratch/b3d529b18d8b/generated_images/exec-1132e3ca-79d0-47aa-99f6-bb0d6a672c01.png` (approved Settings option 1, 1488 × 1058 px).

Implementation evidence: browser-rendered inline capture of `/settings` at 1363 × 936 CSS px, DPR 1. The final full Account & Profile page measured 1348 × 1143 px inside the browser document with no horizontal overflow. The Brand Brain Discovery Intelligence schedule was also captured from `/brand` in its saved Weekdays/Deep state.

State: Account & Profile selected with notifications enabled and per-notification delivery visible; Discovery Intelligence selected with the inline Hunter schedule saved.

### Evidence and findings

- Fonts and typography: the Kairo hierarchy, compact metadata weights, readable headings, and wrapping follow the approved source. The narrower QA viewport scales type without truncating labels or actions.
- Spacing and layout rhythm: the shell, header, six upper tabs, wide profile band, two-column personal/notification layout, privacy rows, and footer actions preserve the approved composition. The remaining height difference is responsive reflow at the narrower viewport rather than hidden content.
- Colors and tokens: dark navy surfaces, violet selection/action states, lime switches and readiness states, neutral dividers, and danger actions match the established Kairo tokens.
- Image quality and asset fidelity: the approved generated creator portrait is used for the profile photo and stays sharp at its displayed size. Icons use the existing Lucide family consistently.
- Copy and content: Notifications and Privacy & Data live inside Account & Profile; billing lives inside Brand & Workspace; no removed section appears as a thin standalone tab. Team & Permissions remains a dedicated upper tab.
- Responsive behavior: no horizontal page overflow at 1363 px. The Settings tabs scroll safely at narrow widths, columns stack below 1120 px, and action groups stack below 760 px.
- Accessibility: all upper tabs expose selected state; notifications and channel permissions use labeled switches; editing fields, selectors, status updates, and focus states are labeled; destructive actions are visibly differentiated.

### Interaction verification

- All six upper Settings tabs opened: Account & Profile, Brand & Workspace, AI Creator Avatar, Channels & Publishing, AI & Media Providers, and Team & Permissions.
- Account display name edited and saved inline; Hunter notification toggled; four delivery selectors remained independently editable.
- Brand name edited and saved inline; plan, billing, ownership, and deletion reviews surfaced safe preview notices.
- Channel publishing permission toggled; provider selection changed; a team invitation was validated and added to the preview.
- The existing Avatar identity, Look, optional Voice, Review, and draft-save flow remained reachable from the shared tab system.
- Discovery Intelligence Hunter schedule edited to Weekdays and Deep, saved inline, and pause/resume behavior was verified.
- No application-origin browser warnings or errors were recorded. Cloud-browser extension metadata errors were excluded as external tooling noise.

### Comparison history

1. The first Account & Profile browser comparison found panel borders around the lower columns and native square checkboxes where the approved design used open divided sections and compact switches (P2).
2. The Account sections were flattened onto the page surface, a single vertical divider restored the approved two-column rhythm, and notification controls were rebuilt as semantic switches with individual delivery selectors.
3. The production bundle was rebuilt, the preview restarted, and the revised Account screen was compared against the approved option in the same comparison input.
4. Final evidence showed the approved hierarchy, switches, per-row delivery, alignment, image treatment, and action ordering with no remaining actionable P0/P1/P2 issue.

### Implementation checklist

- [x] Implement six functional horizontal Settings tabs.
- [x] Preserve the completed AI Creator Avatar workflow.
- [x] Consolidate notifications/privacy into Account and billing into Brand & Workspace.
- [x] Add interactive Channels, Providers, and Team workflows.
- [x] Add inline Hunter schedule editing to Discovery Intelligence without redesigning the page.
- [x] Pass TypeScript, 43 Vitest checks, production build, browser interaction checks, console review, and visual QA.

final result: passed

## Settings — AI Creator Avatar

Source visual truth: `/workspace/scratch/b3d529b18d8b/generated_images/exec-16ab5f4f-50a6-4b52-bf7c-22e416cfd4bd.png` (approved option 3).

Implementation: `/settings`, captured from the local Kairo preview in the cloud browser at 1363 × 936 CSS px, DPR 1. The full page measured 1363 × 1077 px with no horizontal overflow.

### Evidence and findings

- Visual hierarchy: the Kairo shell, Settings title, four-step journey, horizontal Settings navigation, two-column identity/quality workspace, consent row, and action hierarchy match the approved composition.
- Identity safety: eight-photo minimum, optional short video, explicit identity-media consent, and the prohibition on silently using connected social or website photos are visible at the decision point.
- Asset fidelity: three generated presenter images supply the approved front, left-angle, and right-angle identity-media treatment; all browser-rendered images loaded successfully.
- Responsive behavior: the desktop composition preserves the source hierarchy at the narrower QA viewport. Below 1120 px the working panels stack; below 760 px the stepper and actions reflow without forcing horizontal page overflow.
- Accessibility: the stepper exposes current/completed state, upload controls are labeled, progress has a textual label, consent uses a native checkbox, keyboard focus styles are visible, and status updates use a polite live region.

### Interaction verification

- Identity validation blocked continuation at three photos and announced that five more photos plus consent were required.
- Multi-file upload advanced the state from 3 of 8 to 8 of 8; explicit consent then unlocked the Look step.
- Look selections persisted through the Voice and Review steps.
- Voice could be explicitly enabled or skipped without blocking the flow.
- Review summarized approved photos, optional video, look, voice, and consent before creation.
- Create & save draft produced the ready-for-private-test state with editing still available.
- No application-origin browser warnings or errors were recorded. Cloud-browser extension metadata errors were excluded as external tooling noise.

### Comparison history

1. The approved mockup and the browser-rendered identity-media state were reviewed together in one comparison pass.
2. The implementation retained the approved dark navy surfaces, violet selection/action color, lime readiness states, image crops, card proportions, and compact information density.
3. At 1363 px, typography and spacing scale slightly from the 1488 px source while preserving the intended hierarchy; this is accepted responsive behavior.
4. Final comparison found no remaining actionable P0/P1/P2 visual issue.

### Implementation checklist

- [x] Build the approved option 3 identity-media screen.
- [x] Add inline photo, video, consent, look, voice, and review interactions.
- [x] Keep avatar creation in draft until a private test is approved.
- [x] Verify the complete flow and application console in the cloud browser.
- [x] Pass typecheck, tests, production build, and visual QA.

final result: passed
