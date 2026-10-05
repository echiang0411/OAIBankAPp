# Harbor Community Bank: Message check

A local take-home demo of a bank customer checking a suspicious text or screenshot. All examples, accounts, phone numbers, and bank details are synthetic.

**The model interprets. Code validates. The customer decides.**

## Quick start

Requires Node.js 24.2 or newer and npm. This project uses Node's built-in SQLite module. Development was verified with Node 26.5.

```sh
npm ci
npm run dev
```

After installation, `npm run dev` is the single startup command for the frontend and backend. Open [the local app](http://localhost:3000). Mock mode is the default and needs no API key or network for checks. The PNG screenshot and saved responses are already included.

## Live mode

Create `.env` in the project folder using `.env.example` as a template. Put your own key there locally, or export it in the terminal that starts the app. Never commit or paste the key into chat. `.env` is ignored by Git.

```dotenv
APP_MODE=live
OPENAI_API_KEY=your_key_here
PORT=3000
```

Restart with `npm run dev` after changing `.env`. The header will say **Live API**. The key stays on the server and is never sent to the browser. A key configured in another terminal, another project's environment, or a separate product may not be inherited by this process.

To run the reliable recording version even when `.env` selects live mode:

```sh
APP_MODE=mock npm run dev
```

Live requests go to OpenAI and incur API usage. Missing credentials, unavailable models, incomplete outputs, and network failures produce an explicit error. The app never silently substitutes a mock result for a failed live check.

## What to demonstrate

The customer screen automatically uses the first supported browser language, falling back to English. A compact dropdown sits next to the page title: **English**, **繁體中文**, **简体中文**, **Español**, and **العربية**. Chinese script preferences are honored; Taiwan, Hong Kong, and Macau default to Traditional Chinese, and other Chinese locales to Simplified Chinese. Arabic uses a right-to-left customer layout. A manual choice is remembered locally; choose **Automatic (browser)** to follow the browser again. Results, recovery actions, and fraud-team notifications support all five choices in mock and live mode.

1. Upload the included `public/demo/ups-message.png` fixture. The phone screenshot shows the complete plain-text URL `https://ups-redelivery-fee.example/pay`. The reserved `.example` domain is synthetic. Expect `scam`.
2. Expand **How this was checked**. Inspect the extracted URLs, full hostname, and registered domain. In **Analyst view**, the **Developer diagnostics** panel shows cost, token usage, model routing, and model-reported confidence for the latest 50 checks. These diagnostics are not shown on the customer result card. Links are never fetched, followed, or rendered as anchors.
3. Every result offers **Submit to our fraud team**, including likely-legitimate results. It is highlighted below the verdict when the model recommends human review or the verdict is unclear. Scam and likely-scam results also offer a separate **Report this scam** action. These actions add `escalation` or `report` tags to the same masked queue item; customers never supply a verdict label. Sending both does not duplicate the review. Analyst resolution of any escalation saves the label and sends a simulated notification in the customer’s chosen language.
4. Answer **Did you tap the link or share anything?** Nothing is preselected. **No, just checking** shows only the three safe steps: do not tap the link, delete the message, and block the sender. **I entered card details** reveals **Freeze my card** and **Order a replacement card**. **I entered my password** reveals **Reset my password** and **Sign out other devices**. Each action needs its own confirmation and changes browser-local demo state only. Freeze is never shown by default.
5. In **Analyst view**, explicitly choose an expected verdict before approving. The item leaves the pending queue and joins the eval set. The first unique approved demo raises the count from 20 to 21.
6. Check the same screenshot again and report it. Approve both distinct reports as scam or likely scam. **Active campaigns** groups their near-identical masked text and shows two confirmed reports. The eval set still deduplicates identical text in the same language.
7. Check **Bank fraud alert** without reporting it. Click **Weekly random sample** in the analyst view. It randomly selects unreviewed past checks, including likely-legitimate results, for labeling. A report is not needed to be sampled.
8. To demo the escalation loop, paste `Please call me about your account when you have a chance.` and select a language. Check it, send it to the fraud team, then approve an analyst verdict. Return to the customer view to see a simulated notification with the final answer and next steps in the language chosen for that check. The notification persists after reload until dismissed. It includes the same follow-up choices and confirmed simulated card/password actions; scam final answers appear in red.
9. Choose **Hidden instructions** to show injection detection, including in Traditional Chinese and Simplified Chinese.
10. Run `npm run eval`. It reads the same dataset, including analyst-labeled reports, escalations, and random samples.

After submission, the customer sees an estimated reply time of 2 minutes per pending queue item, including their own. The server calculates this snapshot after inserting or deduplicating the request. The hotline shows a fixed average wait of 25 minutes. Both are demo estimates, not a countdown or a measured service commitment.

Each check can have one review item with multiple source tags. Repeated reports on the same check do not multiply the queue or campaign count. Separately checked messages can count as distinct confirmed reports, but this single-user demo does not claim to count distinct customers. Reapproving an existing text/language pair updates its eval label without adding a duplicate. Report a result within its 30-minute in-memory submission session, or check it again.

## Architecture

```text
+-----------------------------------------------------------+
| React customer screen          React analyst screen       |
| paste / screenshot / language  review / sample / approve   |
+----------------------+--------------------------+---------+
                       |                          |
+----------------------+--------------------------+---------+
| Express server: local loopback or Railway container        |
|                                                           |
| 1. Validate input; process image only for this request          |
| 2. For images, transcribe with Responses image input       |
| 3. Code checks domains and instruction attempts            |
| 4. Luna returns a strict structured verdict                |
| 5. Sol rechecks low-confidence or unclear verdicts         |
| 6. Code validates result and selects an approved next step |
| 7. Return localized result, route, and cost                 |
|                                                           |
| Live provider: OpenAI     Mock provider: saved JSON        |
|                                                           |
| Masked history; reports; samples; analyst labels           |
| Approval also resolves escalations with local notifications |
+-------------------------------------+---------------------+
                                      |
                         +------------+------------+
                         | Local SQLite database   |
                         | data/harbor.sqlite       |
                         +------------+------------+
                                      |
                         +------------+------------+
                         | npm run eval            |
                         | Same checker service    |
                         +-------------------------+
```

There is no agent framework, banking integration, authentication service, or separate database server. Local and hosted versions share one simulated customer persona, not separate customer accounts.

## API and schema

The official JavaScript SDK calls `openai.responses.parse` with `text.format: zodTextFormat(...)`. Screenshots use a base64 `input_image`. `store: false` is set on every Responses call, and no model tools are enabled. The response schema has exactly these eight fields:

```ts
{
  verdict: 'scam' | 'likely_scam' | 'unclear' | 'likely_legitimate';
  confidence: number; // 0 to 1
  red_flags: string[];
  impersonated_brand: string | null;
  recommended_action: string;
  explanation_in_user_language: string;
  escalate_to_human: boolean;
  injection_detected: boolean;
}
```

Transport metadata such as link checks, costs, route, and IDs is outside the model schema. Code revalidates the response, bounds customer actions using reviewed localized templates, and prevents detected injection or unrecognized domains from yielding a `likely_legitimate` result.

For screenshots, Luna first transcribes text and returns a separate `extracted_links: string[]` field containing every fully visible URL. Code validates both those extracted links and URLs found in the transcript. This field belongs to the transcription schema and check metadata; the eight-field classification schema stays unchanged. The checker also receives the original image. Only a masked transcript is available to the fraud team. Original images are withheld because this demo cannot reliably redact image pixels. Unreadable images require pasted text with personal details removed. The transcription and every classification call contribute to the cost estimate. If transcription says the screenshot or a link is unreadable, the app requests human help or pasted text; it does not infer missing URL characters or claim that links were checked.

After the initial classification, confidence below `0.80` or verdict `unclear` triggers one independent Sol check using the original evidence. Persistent uncertainty requests human help. Model confidence is self-reported, not calibrated. The final result is advisory.

## Configuration and estimated cost

Edit `config.json` to change the threshold, model IDs, token limit, domain lists, and prices. Missing model pricing causes startup to fail instead of displaying a fabricated cost.

Official model IDs and standard short-context prices were verified on October 4, 2026:

| Model | Input per 1M | Cache reads per 1M | Cache writes per 1M | Output per 1M |
| --- | ---: | ---: | ---: | ---: |
| gpt-6-luna | $0.10 | $0.01 | $0.125 | $0.50 |
| gpt-6-sol | $2.00 | $0.20 | $2.50 | $10.00 |

Per-call estimate: `((input - cached - written) * input_price + cached * cached_price + written * cache_write_price + output * output_price) / 1,000,000`. The check estimate sums all calls. `cached_tokens` and `cache_write_tokens` come from API usage. A missing write count is not invented; older checks may understate the total because write usage was not recorded. Developer diagnostics shows the recorded cache read and write counts. Output usage includes reasoning tokens; image tokens are included in API input usage. The app uses small bounded inputs and standard processing assumptions. Prices are configurable estimates and do not include account-specific terms or other processing tiers.

Costs appear only under **Analyst view > Developer diagnostics**, not in the customer result. They estimate the bank’s API usage and are not customer charges. This local demo uses view switching, not authenticated role separation.

Mock usage is authored fixture data, clearly labeled **Illustrative API cost**. Its actual API spend is $0. Saved mock outputs are synthetic authored responses, not presented as captured live model measurements.

Sources: [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Sol](https://developers.openai.com/api/docs/models/gpt-6-sol), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Images and vision](https://developers.openai.com/api/docs/guides/images-vision).

## Scale and prompt caching

The demo places fixed instructions first and the customer's message last. Its output schema is stable; language, domain checks, and injection evidence vary between calls. It does not currently include few-shot examples or dynamically retrieve the eval set. Prompt caching is enabled by default for supported models, but reuse needs an exact matching eligible prefix. The current docs specify a 1,024-token minimum for these models. Do not pad a short prompt just to cross the threshold or claim every request hits the cache.

For the configured models, cache reads cost 10% of ordinary input and cache writes cost 125%. Only reused input gets the discounted read rate; new input, output, and extra transcription or stronger-model calls still cost money. Cache hits can reduce input processing latency, but do not guarantee a faster total check or a 90% total saving. Measure actual `cached_tokens`, latency, and total cost. Cached input still counts toward token rate limits. See [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

The server allows three simultaneous checks in one process, rejects excess work with HTTP 429, limits input sizes and output tokens, and sets a 45-second timeout per API call. SDK retries are disabled. This is demo overload protection, not bank-scale rate limiting. A bank deployment needs authenticated per-customer and tenant limits, a shared request/token budget across replicas, a bounded queue, bounded retries honoring Retry-After with jitter, end-to-end deadlines, and operational monitoring. A screenshot or uncertain message can make multiple API calls, so budgets must count calls and tokens, not just customer submissions. These production controls are not implemented by this change. See [OpenAI rate limits](https://developers.openai.com/api/docs/guides/rate-limits).

## Key design choices

| Choice | Reason |
| --- | --- |
| One Express process serves React and API routes | Keeps startup and recording simple. |
| Strict Structured Outputs plus server validation | Makes model results predictable to consume. |
| Registered-domain allowlist using a bundled Public Suffix List | Rejects brand-name tricks in subdomains and handles multi-part suffixes. |
| No fetching links, browsing tools, or clickable message links | The checker cannot visit an attacker-controlled destination. |
| A separate fictional `harbor.example` allowlist | Avoids pretending a demo bank owns a real domain. |
| Small model first, one stronger-model escalation | Makes the cost and quality tradeoff visible. |
| Untrusted content isolated from system instructions | Message text cannot define the intended system behavior. |
| Code-selected safe next steps and a confirmation dialog | The model cannot execute actions or provide arbitrary action buttons. |
| Reports, escalations, and random samples need an explicit analyst label | Customers never create ground-truth labels. |
| SQLite with transactional approval, notification creation, and deduplication | Keeps analyst labels and escalation outcomes consistent across restarts. |
| Explicit mock fixtures without silent live fallback | Recording behavior stays predictable and honest. |

## Link validation details

Domain checks run entirely in code with [tldts](https://github.com/remusao/tldts) and its bundled Public Suffix List, including private suffixes. The checker compares the registered domain (eTLD+1), not substrings or brand names. For example:

| Visible host | Registered domain | Result |
| --- | --- | --- |
| `track.ups.com` | `ups.com` | Allowlisted |
| `cibc.com.verify-account.example` | `verify-account.example` | Not allowlisted |
| `ups.com.evil.example` | `evil.example` | Not allowlisted |
| `accounts.example.co.uk` | `example.co.uk` | Not allowlisted |
| `bit.ly` | `bit.ly` | Unverifiable shortened link |

Known shorteners in `shortenerDomains` are marked `unverifiable`. The app never follows redirects to discover their destinations. This configured list does not identify every shortening service. An unknown service is still outside the allowlist. Neither an allowlist match nor a model verdict proves sender identity.

## Sampling, campaigns, and escalation resolution

`config.json` now includes:

| Setting | Default | Behavior |
| --- | ---: | --- |
| `weeklySampleSize` | 5 | Maximum number of checks selected per manual sample run |
| `sampleLookbackDays` | 7 | Eligible check-history window |
| `campaignWindowDays` | 30 | Recency window for analyst-confirmed reports |
| `campaignSimilarityThreshold` | 0.88 | Minimum character-trigram Jaccard similarity for grouping |

**Weekly random sample** is a manual button, not a scheduled job. SQL selects uniformly from eligible unreviewed checks without filtering by model verdict or requiring a report. Existing queued or reviewed checks are excluded to avoid duplicate work. If a customer escalates a check after it was already resolved through sampling, its review reopens for a new analyst resolution and notification. A successful run is recorded once per Monday-based UTC week; an empty run does not use up the week. Changing sample settings takes effect after restarting the server.

Campaigns include only `report` items approved by an analyst as `scam` or `likely_scam` within the configured window. Unreviewed reports, non-scam resolutions, escalations alone, and random samples alone never become confirmed campaign reports. The deterministic grouping normalizes case, whitespace, punctuation, and number variations, then compares each report with a group's representative text. The count measures distinct confirmed check reports, not verified unique people or proven attacker attribution.

When an analyst resolves an `escalation`, the same SQLite transaction saves the analyst's label in the eval set, marks the review approved, and creates one customer notification. It stores the chosen language and analyst verdict; the customer UI renders the final answer and reviewed next-step template in that language. It does not ask the model to reinterpret the analyst's decision. Notifications survive reloads and server restarts, are checked every five seconds while the app is open, and can be dismissed. Repeated approval cannot create duplicate notifications. Existing yes/no reviews are preserved as `legacy_feedback` without treating those answers as labels or confirmed scam reports.

Notifications are simulated within the single local demo customer persona. They do not send email, SMS, push messages, or real banking actions. This local demo has no customer authentication or multi-customer notification isolation.

## Privacy boundaries

Phone-number roles are decided by deterministic code, not a model prompt. Explicit callback instructions such as "call us back immediately at" retain the destination as separate unverified evidence; toll-free prefixes alone do not qualify. Customer context, ambiguity, or the same number appearing elsewhere as a customer/unknown number keep it masked. The analyst must compare any retained destination with trusted bank records. Screenshot transcription can vary, but a given transcript always passes through the same code rules.

US street-address masking includes apartment/unit, city, state abbreviation, and ZIP or ZIP+4 when present together. The address migration also removes those trailing fragments from older `[ADDRESS]` records without changing analyst labels or queue status. Already masked callback numbers cannot be recovered; check and submit the original message again to capture the callback evidence.

Only synthetic data should be used in this demo. Text is masked before classification and local storage. Every successful check is now stored as masked history so unreported checks can be sampled. Generated results, extracted URLs, and queued messages are masked again before persistence. History starts with this version; earlier unreported checks were not stored and cannot be recovered. Explicit callback destinations can be retained separately as `callback_numbers` for analyst evidence in history, reviews, and approved eval records. The message text and model prose still mask all numbers. The analyst view displays these destinations as plain text under **Unverified callback numbers**, never as clickable or verified contact methods. Code uses narrow callback phrases in English, Chinese, Spanish, and Arabic with 10 to 15 ASCII digits; customer/account context, unknown roles, and a number also occurring outside callback context suppress retention. This does not prove ownership or whether a number is fake. The demo has no authenticated customer phone profile; a production implementation should additionally suppress matches against verified customer contact data. Screenshot transcripts pass through the same rules; unreadable screenshots retain no callback evidence. Eval classification continues to use masked text, not these analyst-only numbers. Historical masked numbers cannot be recovered and require resubmission.

Text masking covers known synthetic names plus context-labeled names and greetings, Unicode email addresses, common phone/card/account formats, dates of birth and full numeric dates, labeled personal addresses and common numbered English street addresses, labeled IDs and credentials, IBANs, IPv4 addresses, and URL credentials, query strings, fragments, and percent-encoded values. English, Chinese, Spanish, and Arabic examples are tested. Unicode normalization, invisible-character removal, and Arabic digit conversion run before matching. Prices, scam deadlines, bank brands, and domain-check results are preserved where possible. Explicit callback destinations remain separate unverified threat evidence under the existing narrow role checks; this is not a verified customer identifier store.

A transactional startup migration re-masks existing check, review, and eval text and generated prose. It preserves record IDs, labels, dates, queue status, usage metrics, and notifications. If masking makes two eval texts identical, both existing records and labels survive. New eval additions still require an analyst's approval. Old values may remain in SQLite pages or external backups; this migration is not a secure-erasure guarantee.

Original screenshot pixels are no longer stored, cached for submission, or served to analysts. The current demo has no independently validated image redactor, so it withholds all original images rather than claim they are safe. Readable screenshots provide masked transcripts; unreadable ones require the customer to paste text with personal details removed. A request still sends its image to OpenAI for extraction and classification with `store: false`; withholding here is an application retention policy, not a claim about API retention. The customer's upload preview stays only in browser state. Existing review and diagnostic image attachments are logically deleted on startup, without changing reviews or labels. Old image endpoints return 410 even for stale clients. Logical deletion does not securely erase SQLite pages, volume snapshots, or backups. Request bodies and raw API error payloads are not logged.

Text masking and injection detection remain bounded demo controls. Context rules cannot guarantee removal of every arbitrary name, indirect identifier, or obfuscated secret. Do not describe this as complete PII protection. They are not guarantees for arbitrary names, languages, obfuscation, or sophisticated attacks. A production version would need independently validated multilingual PII detection, adversarial testing, access controls, retention rules, and bank-approved customer guidance.

Live screenshot analysis sends the image to OpenAI in memory, so do not upload real personal details. `store: false` controls Responses application-state storage; it is not a claim of zero provider retention. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

## Evaluation and tests

```sh
npm run eval -- --mock
npm run eval -- --live
npm run verify:live
npm test
npm run build
```

The 20 initial labeled messages span scams, likely scams, unclear messages, and plausible legitimate alerts in English and Chinese. The three customer demos are distinct from the initial eval cases, so their first approval adds a new example. Two seed cases cover a deceptive registered domain and a shortened link. Shipped seed revisions refresh existing seed rows, while analyst-approved labels are preserved. The eval set lives in SQLite and is seeded from `data/seed-eval.json` on first run. The three analyst count cards open and scroll to the review queue, full evaluation set, or analyst-approved examples respectively. The approved-only view includes a Show all examples control. The analyst table shows newest additions or approvals first, with dates in the browser’s local time. Dates persist across restarts, and relabeling updates the approval date without changing the original addition date. Historical approval dates are recovered from saved reviews when available; older examples with no recorded date display "Not recorded".

The eval script prints exact-verdict accuracy, a confusion matrix, errors, dangerous false negatives, escalation count, link-policy checks, analyst-review source counts, and estimated cost. API errors count as incorrect. It never supplies the expected label to the checker. Mock replay scores verify plumbing, not model intelligence. An analyst changing a label can lower the mock score because the saved prediction does not change. A 20-example synthetic set is not a production validation dataset.

`npm run verify:live` checks the three customer demos against the actual API, including the real screenshot input, and saves a minimal verification report under ignored `artifacts/`. It requires the key and model access. Expected labels are used only to score results, never as input to the model.

Live verification on September 30, 2026 passed all three customer demos, including screenshot transcription and injection detection. The local evaluation set contained 20 seeds and one analyst-approved example: exact-verdict accuracy was 15/21 (71.4%), with zero API errors, zero labeled scams predicted likely legitimate, four stronger-model escalations, and 3/3 link-policy checks passing. Five disagreements were between scam and likely_scam; one unclear example was predicted likely_scam. Labels were not changed to fit predictions. This is one run on a small synthetic set, not a production accuracy claim. Evaluation alone cost an estimated $0.012927 using returned token usage and configured prices.

Additional live browser checks verified Spanish and Arabic results, Arabic right-to-left mobile layout, and the absence of cost diagnostics on the customer card. Local reports are saved under ignored `artifacts/`; the analyst-approved example is in the local database and is not shipped with the 20 seed cases.

Mock mode recognizes the included three demos and 20 eval messages in all five output language choices. Other messages and modified screenshots produce an explicit missing-fixture error. Analyst-approved live examples without saved fixtures also produce eval errors in mock mode; use live eval for those cases.

For browser tests or screenshot regeneration, install the test browser once:

```sh
npx playwright install chromium
npm run test:ui
npm run screenshot
```

The UI test starts an isolated mock server on port 3033 with a temporary database. It tests all three demos, tagged reporting, all follow-up branches, four confirmed recovery actions, cancellation, explicit analyst labels, campaign grouping, unbiased sampling eligibility, eval count growth, browser language detection, saved language overrides, Arabic layout, localized escalation notifications in all five language choices, persistence after reload, and mobile overflow. It leaves screenshots in ignored `artifacts/` and does not change your demo database. The API contract test intercepts SDK HTTP calls locally; passing it is not proof of a successful live API request.

To use a fresh separate database for a rehearsal without deleting existing history or reviews:

```sh
DATABASE_PATH=data/rehearsal.sqlite APP_MODE=mock npm run dev
DATABASE_PATH=data/rehearsal.sqlite npm run eval -- --mock
```

For a built local version:

```sh
npm run build
NODE_ENV=production npm start
```

## Railway hosting

The included Dockerfile builds the frontend and runs Express on Node 26. Railway reads `railway.toml` and checks `/api/health` before routing traffic.

1. Connect the GitHub repository to a Railway service.
2. Attach a persistent volume at `/data` and set `DATABASE_PATH=/data/harbor.sqlite`. Keep one service replica because this demo uses SQLite.
3. Set `APP_MODE=live` and `OPENAI_API_KEY` in Railway's service variables. For saved responses, use `APP_MODE=mock` instead. Never put the key in the repository or image.
4. Generate a Railway public domain targeting port 3000. Its `RAILWAY_PUBLIC_DOMAIN` is accepted automatically. For a custom domain, set `APP_ORIGIN` to its exact HTTPS origin.
5. Deploy. The public app starts with the 20 synthetic eval seeds; the local database is excluded from Git and Docker. Hosted reviews and labels persist on the volume.

Docker sets `HOST=0.0.0.0` for Railway. Local `npm run dev` still defaults to `127.0.0.1` and works as before. Host and Origin checks accept only local addresses and the configured public origin; Railway's healthcheck hostname can access only the health endpoint. `.dockerignore` explicitly includes application files and excludes local secrets and databases.

This review demo deliberately has no login. Anyone with its URL can use the checker and analyst view, and all reviewers share its data and simulated notifications. Live checks use the owner's API credits. Railway hosting is billed separately. Use synthetic examples and stop the service after the review period.

## Files

| Location | Purpose |
| --- | --- |
| `src/` | Customer and analyst screens, localized copy, styles |
| `server/checker.ts` | Live/mock providers, routing, policy validation, costs |
| `server/security.ts` | URL extraction, registered-domain checks, shortener detection, injection signals |
| `server/campaigns.ts` | Deterministic grouping of analyst-confirmed reports |
| `server/privacy.ts` | Masking before persistence |
| `server/store.ts` | Masked check history, sampling, reviews, eval labels, notifications |
| `shared/schema.ts` | Exact model result schema and shared types |
| `config.json` | Models, prices, routing threshold, domain allowlists |
| `data/` | Synthetic seeds, saved mock responses, local ignored database |
| `public/demo/ups-message.png` | Realistic synthetic phone screenshot |
| `scripts/eval.ts` | Dataset evaluation using the checker |
| `tests/` | Policy, privacy, routing, SDK contract, and persistence tests |

All authored UI copy, fixtures, and documentation avoid en dashes, em dashes, and arrow characters.
