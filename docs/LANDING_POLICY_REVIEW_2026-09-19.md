# Landing explanation and policy review

Reviewed: 19 September 2026.

Status: internal recommendations only. No legal pages or robots rules were
changed for this review, and no blanket crawling block was enabled. This is not
a legal opinion or a claim of full compliance. Findings describe the local
`codex/post-267-audit` build, not independently verified production behaviour.

## 1. Reuse the existing explanation pages

- `/how-it-works` already explains front capture, optional side capture, point
  review, signup, results and next steps.
- `/methodology` already explains the measurements, reference tables, limits,
  privacy boundaries and unresolved validation work.
- `/guides` is the existing educational hub. These pages already have canonical
  URLs, structured data, internal links and entries in `public/sitemap.xml`.

Do not add a duplicate blog page simply to explain the product again. A compact
landing-page explanation can link into these pages:

**Photo → reviewed points → measurements → reference comparison → next steps.**

Keep the distinction between measurement, score and recommendation explicit.
Avoid describing calibration as completed validation or an ideal band as a
biological rule. Publish a validation update only when its sample, protocol,
errors and exclusions can be reported.

## 2. Factual copy corrections needed before release

| Location | Evidence and gap | Proposed correction |
| --- | --- | --- |
| `terms.html:121-125` | The paragraph includes optional side feedback and then says source photos are not stored. `privacy.html:113-141` describes 90-day feedback retention, and `api/side-correction-feedback.ts:328-341` uploads that photo into private storage. | Separate cloud placement and Goal preview source handling from separately consented side-feedback storage. State the 90-day limit and revocation route consistently. |
| `terms.html:48-50` | It says error is published and same-day photos can differ by around a point. `methodology.html:116-119` correctly says a broad completed study and validated fixed rescan error are not published. | Remove the unsupported numerical error claim. Explain that camera position, pose, expression and point placement can change a result; link to the current validation limits. |
| `privacy.html:213-216` | The Max row describes sending messages to Anthropic but omits durable storage. `api/max-chat.ts:182-219` writes conversations, messages and plan items; `api/max-conversations.ts` reads them back. | Document server-backed Max history and plan memory, purpose, access and deletion. Confirm the retention policy before adding an interval. No time-based expiry was found in this review; account deletion cascades through the memory tables. |
| `terms.html:112-115` | The blanket prohibition on rating anyone conflicts with consensual analysis and the creator workflow. | Have counsel distinguish consensual own/guest analysis from harassment, non-consensual publication and prohibited ranking. Do not accidentally authorize use of others' photos without appropriate rights. |
| `privacy.html:350-354` | A single 30-day response promise does not explain applicable NZ access-request deadlines. | Review rights-request wording and operating process for NZ decision deadlines, lawful extensions and other applicable jurisdictions. |

Line references are pointers into the reviewed version and may move. These
changes should be reviewed together so Terms, Privacy, consent dialogs and
actual processing agree. Update dates and material-change notices when revised
policies are released.

## 3. Automated access and data use

The existing Terms already prohibit scraping and reverse engineering. A more
precise **Automated Access and Data Use Policy**, incorporated into the Terms,
would be clearer than a blanket ban on AI.

Proposed policy scope, subject to owner and legal review:

1. Preserve ordinary public search indexing within published limits,
   accessibility tools and users' lawful access/export rights.
2. Require prior written TrueMax authorization for systematic result
   extraction, bulk collection, automated paid-service usage, and reuse of
   service data or outputs for third-party model training or datasets.
3. Record the authorized operator or agent, purpose, permitted routes and data,
   rate/volume limits, retention and deletion rules, expiry and revocation.
4. Forbid bypassing authentication, quotas or access controls, and prohibit
   access to another person's private data outside a lawful authorized scope.
5. State that service-owner approval does not replace consent or other required
   rights for a person's face/results, and does not authorize access to another
   company's service. Preserve separately granted software licences and rights
   that cannot legally be restricted.

Technical enforcement is separate from policy. `public/robots.txt` currently
allows crawling. Private quick/calibration/League pages already have noindex
metadata or response headers. Robots directives are crawler instructions, not
authentication or a security boundary. Private data needs actual authorization;
abuse controls can include rate limits, logging and targeted bot/WAF rules.
Assess SEO and AI-search discovery tradeoffs before blocking public crawlers.
No bot settings were inspected or changed in the hosting dashboard here.

FaceIQ's public Terms, checked on this date, prohibit automated service access
without permission and separately restrict copying/reverse engineering.
Permission for FaceIQ must come from FaceIQ, not a subscriber. TrueMax ownership
can authorize TrueMax activity only.

TrueMax's repository is intentionally public, and its front measurement engine
runs in the browser. Policy cannot make distributed code secret. Protecting
implementation details through a different distribution or server architecture
would be a separate product/privacy decision, not a robots-file change.

## 4. NZ legal review scope

Ask NZ privacy counsel to review:

- Applicability of the Biometric Processing Privacy Code to each workflow,
  including own-face analysis, guest analysis and reuse for placement
  improvement. The Code has personal-use/entertainment exclusions; this review
  does not establish that TrueMax is covered or exempt.
- The privacy impact assessment, purpose limitation, separate improvement
  consent, retention/deletion, processor arrangements and overseas transfers.
- Indirect collection notices for guest/third-party photographs and results
  under IPP3A, including whether an exception applies in each workflow.
- Rights-request deadlines, age/guardian rules, advertising/accuracy claims,
  creator permissions, and enforceability of the proposed access restrictions.

The existing-agency transition for the Biometrics Code ended on 3 August 2026.
IPP3A took effect on 1 May 2026. Do not treat an entertainment disclaimer or an
owner's permission as a substitute for this assessment.

## Sources checked on 19 September 2026

- NZ OPC, Biometric Processing Privacy Code:
  https://www.privacy.org.nz/privacy-principles/codes-of-practice/biometric-processing-privacy-code/
- NZ OPC, scope and exclusions:
  https://www.privacy.org.nz/resources-and-learning/a-z-topics/biometrics/what-does-the-code-apply-to/
- NZ OPC, lawful purpose and data minimisation:
  https://www.privacy.org.nz/privacy-principles/1/
- NZ OPC, access rights:
  https://www.privacy.org.nz/privacy-principles/6/
- NZ OPC, access-request process and working-day deadline:
  https://www.privacy.org.nz/assets/zLEGACY-FILES/Principle-6-Flowchart.pdf
- NZ OPC, indirect collection notification:
  https://www.privacy.org.nz/resources-and-learning/a-z-topics/ipp3a/
- IETF RFC 9309, robots rules are not access authorization:
  https://www.rfc-editor.org/rfc/rfc9309.html#section-1
- Google, robots and indexing limitations:
  https://developers.google.com/search/docs/crawling-indexing/robots/intro
- Vercel, bot management and selective controls:
  https://vercel.com/docs/bot-management
- FaceIQ Labs, public Terms, updated 16 September 2026:
  https://www.faceiqlabs.com/support/terms

Recheck policies and provider documentation when implementing or releasing
changes. This review did not establish compliance in every market where the
website is accessible.
