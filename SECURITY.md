# Security Policy

## Supported Versions

Security fixes are applied to the latest minor release on the `main` branch. Once a fix
is released, the previous minor version receives no further patches.

| Version | Supported |
|---------|-----------|
| 0.2.x (current) | Yes — security fixes backported promptly |
| 0.1.x | No — please upgrade to 0.2.x |
| < 0.1 | No |

If you are running an unsupported version, upgrade before reporting; the issue may already
be resolved.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.** Public disclosure
before a fix is available puts every deployment at risk.

### Preferred channel

Use **GitHub Security Advisories** (coordinated, private disclosure):

1. Go to <https://github.com/eddowding/contextual-feedback/security/advisories>
2. Click **"Report a vulnerability"**
3. Fill in the form described below

If you cannot use that interface, contact the maintainer through the address listed on the
[npm package page](https://www.npmjs.com/package/contextual-feedback) or the GitHub profile
for [@eddowding](https://github.com/eddowding).

> **Placeholder:** a dedicated security contact address (e.g. `security@…`) has not yet been
> configured. Until it is, the GitHub Security Advisory route above is the correct channel.
> [security contact — fill in before publishing]

### What to include in your report

A useful report lets us reproduce and triage the issue without asking follow-up questions.
Please provide as many of the following as are relevant:

- **Description** — what the vulnerability is and what an attacker could achieve
- **Affected component** — e.g. `src/api/handlers.ts`, the TRIAGE endpoint, the
  `formatForAI` formatter, the Supabase RLS policies
- **Steps to reproduce** — a minimal proof-of-concept (code snippet, curl command, or
  written steps); credentials and live URLs are not required
- **Impact assessment** — your view of severity (CVSS score welcome but not required)
- **Suggested fix** — if you have one; optional but appreciated
- **Affected versions** — which package version(s) you tested against
- **Your contact details** — so we can credit you and coordinate disclosure timing

The more detail you supply, the faster we can respond.

---

## Response Targets

These are targets, not guarantees. A solo-maintained open-source library cannot match
enterprise SLA commitments, but we take security reports seriously and will communicate
actively.

| Stage | Target |
|-------|--------|
| **Acknowledgement** | Within **2 business days** of receiving the report |
| **Initial triage** (reproduce / assess severity) | Within **5 business days** |
| **Status update** (fix timeline or reason for rejection) | Within **10 business days** |
| **Fix and coordinated disclosure** | Within **90 days** of acknowledgement for confirmed vulnerabilities; shorter for critical issues |

### Coordinated disclosure

We follow coordinated (responsible) disclosure aligned with
[ISO/IEC 29147](https://www.iso.org/standard/72311.html) and
[ISO/IEC 30111](https://www.iso.org/standard/69725.html):

1. Reporter submits privately; we acknowledge receipt.
2. We reproduce, assess severity, and agree a remediation timeline with the reporter.
3. A fix is developed in a private branch and released.
4. A GitHub Security Advisory (CVE if warranted) is published simultaneously with the
   release, crediting the reporter unless they prefer anonymity.
5. If 90 days pass without a fix, the reporter is free to disclose publicly; we will
   coordinate the timing where possible.

### Credit and CVEs

We will credit you by name (or handle) in the advisory and in the release notes unless
you request anonymity. For vulnerabilities that meet the MITRE CVE criteria, we will
request a CVE identifier and list you as the discoverer.

---

## Safe Harbour

We consider good-faith security research to be a service to the community. If you comply
with the following conditions, we will not pursue legal action and will not refer your
activities to law enforcement:

- You report through the private channel described above before any public disclosure.
- You test only against your own deployment (or a local test instance) — not against
  production systems you do not own or have explicit permission to test.
- You do not access, modify, or exfiltrate data belonging to real end-users.
- You do not degrade service availability (no denial-of-service testing against live
  systems).
- You act in good faith to avoid privacy violations and disruption.

We ask that you give us a reasonable opportunity to remediate before publishing. We will
reciprocate by keeping you informed and recognising your contribution.

This safe harbour is an ethical commitment; it does not constitute a legal waiver and does
not bind third parties.

---

## Security Model and Operator Responsibilities

### What the library provides

`contextual-feedback` implements defence-in-depth at the library boundary:

**Input validation (`src/lib/types.ts` — `validateFeedbackInput`)**
All user-supplied fields are validated and length-capped before storage:
`feedbackText` (5,000 characters), `pageUrl` (2,000 characters, scheme-safe),
`context` and `elementId` (255 characters each). Non-JSON content types are rejected
with 415; malformed JSON with 400; non-object bodies with 400. Invalid enum values
(`status`, `category`) are rejected before they reach the adapter.

**Authentication gating (`src/api/handlers.ts` — `ApiConfig.authorize`)**
Every read and admin endpoint (GET, COUNT, PATCH, TRIAGE, RESOLVE) is gated behind the
operator-supplied `authorize` callback. The public submission endpoint (POST) is
deliberately ungated — it is designed to accept anonymous feedback. When `authorize`
is not provided, all endpoints are unprotected; see **Operator responsibilities** below.

**Email attribution (`src/api/handlers.ts` — `getUserEmail` / `trustClientEmail`)**
By default (`trustClientEmail: false`), the server-derived identity from `getUserEmail`
overrides any client-supplied body email, preventing attribution forgery. The
`trustClientEmail: true` opt-in re-enables client-supplied emails for legacy
deployments; it should not be used in new integrations.

**CSRF mitigation (`src/api/handlers.ts` — `parseJsonBody`)**
State-changing endpoints require `Content-Type: application/json`. A cross-origin HTML
form cannot set this header without triggering a CORS preflight, which blocks form-based
cross-site request forgery when `authorize` is cookie-based.

**Row Level Security (`src/setup/supabase.ts`)**
The provided RLS SQL enforces at the database layer that:
- Authenticated users can only INSERT feedback attributed to their own JWT identity.
- Authenticated users can only SELECT their own feedback.
- UPDATE and DELETE require the `is_admin()` predicate (SECURITY DEFINER function
  referencing a `user_profiles` table).

RLS is an optional but strongly recommended defence layer. Its strength depends entirely
on the correctness of the operator's `user_profiles.role` data and Supabase auth
configuration.

**AI prompt-injection posture (`src/lib/ai.ts` — `formatForAI`)**
Feedback text is attacker-controlled (submitted via the public POST endpoint). The
`formatForAI` formatter treats every piece of user-supplied text as untrusted data:

- A standing header explicitly instructs the consuming agent to treat quoted content as
  data, not instructions.
- Every line of `feedbackText` is individually blockquoted so a crafted multi-line
  value cannot break out of the quote block to inject fake items or forged instructions.
- Single-line metadata fields (section, page, email, element ID) have newlines collapsed
  to prevent line-injection attacks.

### Operator responsibilities

The library's security depends on correct deployment. The following are **not** the
library's responsibility — they are yours as the operator:

| Responsibility | Guidance |
|----------------|----------|
| **Provide a real `authorize` callback** | If omitted, every read and admin endpoint is publicly accessible. Supply a callback that verifies a server-side session or API key. |
| **Use a trusted `getUserEmail` implementation** | Derive the user's identity from a verified server-side session (`auth.getUser()`, `getServerSession()`). Never read it from a client-settable request header. |
| **Configure and apply RLS** | Apply `SUPABASE_RLS_SQL` and maintain `user_profiles.role` accurately. Ensure the Supabase client passed to the adapter uses the anon key (not the service-role key) so RLS is enforced. |
| **Manage secrets** | Keep `SUPABASE_URL`, `SUPABASE_KEY`, and any API keys out of version control and client-side bundles. |
| **Rate-limit the POST endpoint** | The submission endpoint is unauthenticated by design; apply rate limiting (e.g. at the edge, via a Next.js middleware, or an API gateway) to prevent spam and storage exhaustion. |
| **Keep dependencies patched** | Run `npm audit` regularly and apply updates. This library cannot protect against vulnerabilities in its transitive dependencies if you defer patching. |
| **Restrict AI agent capabilities** | The TRIAGE endpoint returns attacker-controlled content formatted for AI consumption. Despite the prompt-injection mitigations in `formatForAI`, do not grant an AI agent consuming this output unattended destructive capabilities (deploys, deletions, external calls) without a human review gate. |

### The AI triage path

`src/lib/ai.ts` implements a deliberate prompt-injection barrier, but it is a
best-effort mitigation against a class of attack that has no complete defence. The
correct posture is:

1. Do not weaken or bypass the untrusted-input handling in `formatForAI` (blockquoting,
   newline collapsing, the standing "treat as data" header).
2. Scope AI agent permissions to the minimum required to act on feedback.
3. Require human approval before any agent action that is irreversible (schema changes,
   bulk deletions, external API calls triggered by feedback content).

---

## Scope

In-scope vulnerabilities include:

- Authentication or authorisation bypasses in the handler layer
- Input validation bypasses that lead to storage of malformed, oversized, or malicious
  data
- Prompt-injection vectors in `formatForAI` or `toTriageItem` that bypass the
  untrusted-input mitigations
- Logic errors in the RLS SQL that allow cross-user data access
- Email attribution spoofing via `getUserEmail` / `trustClientEmail` handling

Out of scope:

- Vulnerabilities in your application's deployment (misconfigured `authorize` callback,
  exposed service-role keys, missing rate limiting) — these are operator responsibilities
  described above
- Denial-of-service attacks against live deployments you do not own
- Social engineering
- Issues in dependencies — report these directly to the dependency maintainer; include us
  only if the library's usage pattern introduces or amplifies the risk

---

*This policy follows the principles of
[ISO/IEC 29147:2018](https://www.iso.org/standard/72311.html) (Vulnerability Disclosure)
and [ISO/IEC 30111:2019](https://www.iso.org/standard/69725.html) (Vulnerability Handling
Processes).*
