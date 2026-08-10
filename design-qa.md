# Verafi Shop design QA

- Source visual truth: `/workspace/scratch/62c6fc29922c/generated_images/exec-e35c6acd-0e2c-46a1-96a6-bc097fe5533e.png`
- Implementation: local Sites preview of `/workspace/scratch/62c6fc29922c/verafi-shop-preview`
- Implementation screenshot: cloud-browser in-session capture, final results state, 2026-08-10 12:20 America/New_York
- Source pixels: 852 × 1842
- Implementation capture: 1350 × 936 browser viewport; app content constrained to 560 CSS px; device scale factor 1
- State: completed search for “lightweight carry-on suitcase under $150,” dark theme, three live-result cards

## Findings

No actionable P0, P1, or P2 differences remain.

- Typography: The implementation preserves the target hierarchy—compact query text, violet result heading, prominent product names and prices, and quiet supporting metadata. The existing Verafi serif wordmark remains intentionally unchanged; all decision-workspace content uses the app’s system sans stack.
- Spacing and layout: The final pass removed the old Shop homepage from above completed results. Query, source evidence, best-match explanation, ranked cards, actions, merchant guard, and persistent navigation now follow the target order with consistent 14–18 px card radii and compact mobile spacing.
- Colors and tokens: Dark slate surfaces, violet recommendations/actions, mint status and shipping text, subdued secondary copy, and thin low-contrast borders match the selected direction and reuse Verafi’s existing tokens.
- Image quality: Product cards use real raster product images when Tavily returns a confident match. The final browser capture showed three sharp, correctly cropped suitcase images. A Phosphor category icon appears only when no matching image is available.
- Copy and content: Search, evidence count, recommendation, prices, highlights, shipping, tradeoffs, and checkout disclaimer are all dynamic and make sense without the design prompt.
- Icons: Product actions use one consistent Phosphor icon family. Existing bottom-navigation icons remain part of Verafi’s established shell.
- Accessibility and responsiveness: Product images have alt text; merchant links use safe external URLs; controls are semantic buttons; cards wrap without clipping at the 560 px app width; persistent navigation remains reachable.

## Comparison history

### Pass 1

- P1: Completed results rendered below the old Shop homepage, delaying the decision workspace.
- Fix: `viewShop()` now switches to a dedicated result state; Edit returns to the search surface.
- Post-fix evidence: final browser capture begins with the Verafi brand and query bar, followed immediately by sources, best match, and product cards.
- P1: Product cards used category icons where the target showed product imagery.
- Fix: Tavily image retrieval and grounded `imageIndex` selection were added; the UI renders raster product images with a safe icon fallback.
- Post-fix evidence: final browser capture showed distinct purple hardshell, navy softside, and teal hardshell suitcase images.

### Pass 2

- No P0/P1/P2 differences found.
- Save to Spend was tested through its visible success state.
- Compare all was tested through the complete side-by-side state and return navigation.
- Price Watch now uses an in-app percentage-trigger sheet rather than a native prompt. The baseline, trigger price, and buy/wait decision are visible before monitoring starts.
- Visit Seller is enabled only for validated HTTP(S) URLs and opens merchant checkout outside Verafi.
- Browser console: no application errors were observed during the final results, comparison, or save flows. A cloud-browser dialog timeout occurred while automating the native prompt itself; it did not reproduce as an application-rendering error.

## Focused comparison evidence

- Header/query region: dedicated query edit control, five-source evidence strip, and best-match introduction match the source hierarchy.
- Product-card region: rank badge, image, label, product name, highlights, price, merchant, shipping, tradeoff, and actions are all present and readable.
- Action region: the primary recommendation receives the strongest Save to Spend treatment; other products keep compact Save, Compare, Watch, and Visit actions.

## Follow-up polish

- P3: At wider browser widths the implementation remains a centered mobile column rather than simulating device chrome; this is intentional because Verafi is a responsive PWA.
- P3: Merchant marks use clean text badges instead of third-party logos to avoid incorrect branding and extra tracking requests.

## Implementation checklist

- [x] Dedicated results state
- [x] Structured, source-grounded products
- [x] Dynamic product imagery with safe fallback
- [x] Save to Spend
- [x] Price Watch
- [x] Compare and side-by-side view
- [x] Visit Seller
- [x] Merchant-checkout safety message
- [x] Automated render and model-adapter tests

final result: passed

## v20 product rules

These rules came from the Save, Agents, custom-category, and notification rebuild. They are durable product decisions for future work:

- Save is an action queue, not an analytics dashboard. Its primary states are **Needs your decision**, **In progress**, and **Savings confirmed**.
- Potential savings are never added to confirmed savings until the user marks the action complete.
- Every Save decision names the responsible agent, evidence status, dollar status, and direct next action.
- Spending categories and transaction drill-downs belong in Spend, not Save. Forecast content must not compete with the Save decision queue.
- Each financial agent must expose what it checked, candidate/confirmed/review counts, evidence, and its next investigation step.
- User-created shopping categories do not depend on transaction history. They retain purpose, household context, budget, and a default price-drop threshold.
- Price alerts use a baseline plus a percentage trigger. The UI shows the calculated target before activation.
- Buy/wait status is calculated from verified prices and the user's trigger. The reasoning model may explain evidence but cannot override the numerical threshold.
- Repeated alerts are suppressed unless the agent finds an equal-or-better qualifying price.
- Visual screenshot QA for the v20 screens is still required; the cloud browser was unavailable during the implementation pass.
