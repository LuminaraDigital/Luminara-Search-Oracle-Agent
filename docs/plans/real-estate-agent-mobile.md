# Real-estate agents on mobile (Track RE)

Status: draft for owner review, 2026-11-03. Not started.

## Why

luminara.digital sells the Listing Growth Desk to independent Melbourne agencies: follow up past appraisals, open-home attendees and rent-roll landlords, with a person approving every message and the agent approving every booking, then a Friday scorecard. The Android app is still shaped for SEO people: its tabs are Home, Ask, Scout, Audit and Studio, and words like AEO, GEO, schema, NAP and llms.txt sit on the first screens. The two things an agent needs on their phone, the Enquiry Desk and their Business Profile, are hidden as overlays.

An agent opens the app between inspections, one-handed, for under a minute. The app has to answer three questions in that minute:

1. Is anything waiting for me to approve?
2. Who do I need to call?
3. How did this week go?

## What already exists (reuse, do not rebuild)

- Enquiry Desk on Android (`feature/enquiry/EnquiryDeskScreen.kt`, PR 316): log an enquiry, suggested replies, take over, approve or decline a booking slot.
- Real-estate playbooks in `services/enquiries/playbookQualificationService.ts`: `seller_appraisal`, `buyer_enquiry`, `landlord_management`. STOP handling and escalation for Section 32, cooling-off, strata and bond disputes.
- Agency website checks in `services/audit/realEstateChecks.ts`: RealEstateAgent schema, NAP, agent profile pages, suburb pages, Google Business Profile link, review schema. Each is Measured or Not measured.
- `/api/outcomes/record` for funnel stages, and the Business Profile screen.

## Phases

### RE0. Agent mode and plain words (small, copy and navigation only)

- Welcome screen asks once: "I'm a real-estate agent or agency" or "I run another kind of business". Change it later in Settings. Prop-tech teams pick the second option and keep today's app.
- Agent mode tabs: **Today**, **Enquiries**, **Website**, **Ask**, **More**. Scout and Studio move under More.
- Rename for agents: Audit becomes "Website check", findings read as "Can buyers and sellers find your agency on Google and ChatGPT?". Jargon gets a one-line plain meaning the first time it shows (for example "NAP: your name, address and phone are the same everywhere").
- Australian defaults: A$, +61 numbers, en-AU spelling, suburb and postcode fields.
- Bigger tap targets (48 dp minimum) and one primary button per card.

### RE1. Today screen (the agent's home)

- Top card: "Needs your sign-off", the count of bookings and messages waiting, with large Approve and Decline buttons. Uses the existing appointment decision endpoint.
- Escalation cards ("They asked about the Section 32. Call them yourself.") with Call, SMS and Email buttons. These use Android intents, so no message is sent by the app.
- After an approved appraisal: "Add to calendar" (calendar intent with the address and owner name).
- Push notification when something needs sign-off. Needs FCM, which the app does not have yet: confirm before building.

### RE2. Enquiries, agent-friendly

- Filter chips by segment: Past appraisals, Open-home attendees, Landlords, Buyers.
- Each card shows the four qualifying facts from the site (owner, address, timeline within 12 months, consent to meet), each ticked or "Not asked yet". Missing facts stay unknown, never guessed.
- Reply sorting matches the site's five categories: Interested, Not ready, Wrong person, Opted out, Needs agent input.
- Quick log after an open home: name, phone, "owns locally?" yes or no. Thumb-only, under 15 seconds.

### RE3. Friday scorecard on the phone

- Appraisals booked this week by segment, plus each lead's status, owner, next action and outcome.
- Only counts the Worker returns. A segment with no data says "Not measured yet". No example numbers ship in the app.
- Needs a read endpoint for outcomes if one does not exist: check before building.

### RE4. Writing help for agents (Studio, agent templates)

- Templates: appraisal follow-up message, open-home thank-you, landlord hold-or-sell check-in, suburb page, agent profile page.
- Every message draft carries the agency name and an opt-out line (Spam Act). Drafts are never sent from the app; the agent copies or shares them.

### RE5. Prop-tech companies (later, web and MCP first)

- Prop-tech partners use the MCP and API that exist today. A short "For prop-tech teams" page on the web explaining the enquiry playbooks, the website checks and the MCP tools. No mobile work in this phase.

## Guardrails

- No invented scores, counts or revenue. Unknown stays unknown (APS invariant 5).
- The app never sends a message or books on its own. A person approves messages; the agent approves bookings.
- STOP and escalation rules from the playbook service apply to everything the app shows.
- Matches the Obsidian Gold design kit (`core/designsystem/ObsidianKit.kt`). No new visual style.

## Order and size

RE0 then RE1 first: they change what an agent sees on day one and reuse existing endpoints. RE2 is mostly UI on the existing desk. RE3 and push notifications may need Worker work, so they are checked before they are scheduled.

## Open questions for the owner

1. Base branch: build on `origin/main` after the Android draft PRs (319, 320, 325) land, or on `feat/android-obsidian-gold`?
2. Agent mode as a choice, or real estate as the Android default for everyone?
3. Push notifications: add Firebase Cloud Messaging now, or later?

## Push notifications setup

Worker side is built (`worker/pushNotifyService.ts`, migration `0047_push_devices.sql`). It stays a silent no-op until an operator does this:

1. Enable the Firebase Cloud Messaging API in Google Cloud project `luminara-suite`.
2. Grant the impersonated Worker service account (the value of `GCP_IMPERSONATE_SERVICE_ACCOUNT`, see `worker/gcpToken.ts`) the role "Firebase Cloud Messaging API Admin" (`roles/firebasecloudmessaging.admin`) on project `luminara-suite`.
3. Set `FCM_PROJECT_ID=luminara-suite` as a plain var in the Worker config (`wrangler.jsonc`, the production `vars` block; staging can use the same project or stay unset). It is not a secret.
4. Apply migration 0047 through the normal release flow (CI migrates before deploy).
5. Android: create the `agent_signoff` notification channel and register the FCM token with `POST /api/push/devices`.

Notification text never contains an address, phone number or email. Only the contact's first name appears.
