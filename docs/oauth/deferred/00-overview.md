# OAuth — Deferred / Nice-to-Have Overview (Mentee Bot)

> **Purpose of this document**: capture OAuth features we **consciously decided NOT to ship in the MVP**, with enough design detail that any future engineer can pick them up without re-doing the analysis. None of this is required for first launch.
>
> **Counterpart**: `/Users/odzen/Job/Mentee/mentee/docs/oauth/deferred/00-overview.md`.
> **MVP plan** (what IS being built): [`../00-oauth-overview.md`](../00-oauth-overview.md).

---

## Deferred features

### A. Zero-click SSO — Phase 2 silent auth via hidden iframe

**What it is.** On Bot page load, render a hidden iframe pointing at `https://app.menteeglobal.org/oauth/authorize?prompt=none&response_mode=web_message&...`. If the user has an active Mentee session cookie, Mentee posts the authorization code back via `window.postMessage`. The Bot completes the token exchange and sets its session cookie — all with **zero clicks** and no visible redirect.

**What ships in MVP instead (Phase 1).** Click-through SSO: if the user is already logged into Mentee, clicking "Login with Mentee" on the Bot completes in ~1 second (no credentials prompt, consent auto-approved on repeat visits). That already meets the "auto-login" requirement in the product sense.

**Why deferred.**
- Iframe + postMessage + CSP `frame-ancestors` is where OAuth implementations most often introduce security holes or break on Safari ITP.
- Additional surface to test for little net UX gain over Phase 1 (1 click vs 0).
- Deferring risks nothing — Phase 2 is pure addition; the Phase 1 codepath stays as a fallback forever.

**Trigger to revisit.**
- Users complain about the login click in telemetry/feedback.
- Product decides the friction is material for conversion.
- A second OAuth client (mobile, Slack, etc.) is added and silent auth becomes more valuable for the platform as a whole.

**Pointers.**
- Bot-side tactical plan: [`01-backend-plan.md`](./01-backend-plan.md) §1 and [`02-frontend-plan.md`](./02-frontend-plan.md) §1.
- Mentee-side counterpart: `/Users/odzen/Job/Mentee/mentee/docs/oauth/deferred/01-backend-plan.md` §1.

---

### B. `mentee.api` scope — Bot calls Mentee APIs on user's behalf

**What it is.** The Bot agent receives a scoped access token that it can use to call Mentee's REST API (`/api/appointment`, `/api/training`, `/api/mentee`, etc.) on the user's behalf. Unlocks personalization:

- *"You have an appointment with Dr. Kim tomorrow at 3pm — want me to prep talking points?"*
- *"Based on your saved applications, here are 3 more scholarships that match your profile."*
- *"You haven't finished the training module on Interview Prep — want to continue?"*

**What ships in MVP instead.** Bot is an identity-only OAuth client. It knows who the user is (id, email, name, role, preferred language) but has no live data from Mentee beyond that. The `MockAgent` — and eventually the real LLM-backed agent — generates responses from the user's chat input + the conversation thread only.

**Why deferred.**
- Adding this scope requires a **second auth path in Mentee's API middleware** (`require_auth.py` today only accepts Firebase tokens; it'd need to also accept OAuth bearer tokens and map them to a `Users` record). Every protected endpoint in Mentee would need re-verification.
- Consent copy becomes scarier (*"Mentee Bot can take actions on your Mentee account"*), which may hurt conversion.
- The MVP Bot does not need this data to be useful.

**Trigger to revisit.**
- Product decides personalization based on live Mentee data is a priority.
- The agent swap (MockAgent → pydantic-ai / OpenAI / Perplexity) is planned and product wants user-context grounding.

**What is reserved now (no implementation).**
- The scope name `mentee.api` is documented publicly as a **reserved** scope. Client registration rejects it unless the operator explicitly whitelists it. This prevents a third-party client from accidentally claiming it.
- The user-facing Connected Apps page (shipped in MVP) is designed so that when `mentee.api` permissions show up on a future token, the UI already has slots to display them.

**Pointers.**
- Bot-side tactical plan: [`01-backend-plan.md`](./01-backend-plan.md) §2 and [`02-frontend-plan.md`](./02-frontend-plan.md) §2.
- Mentee-side counterpart: `/Users/odzen/Job/Mentee/mentee/docs/oauth/deferred/01-backend-plan.md` §2.

---

## Cross-cutting notes

- Neither deferred feature touches the MVP contract for `User`, session cookie, `/api/auth/me`, `/api/auth/login`, or `/api/auth/callback`. When they ship, they are additive.
- Both features assume the MVP has been running in production long enough to observe real usage and measure the actual friction / value gap they would close.

## When to open this document

- Planning a quarter's work and considering Bot polish.
- After launch, if specific user feedback maps to one of these features.
- When onboarding a new engineer — so they understand what was **explicitly chosen not to do**, and why.
