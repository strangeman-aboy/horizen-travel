# Mobile Supporting Pages Design QA

## 2026-08-23 compact mobile pass

final result: local build and interaction QA passed

### Scope

- Home route cards were compressed without removing the working `查看路线` action.
- The creator route detail page now uses a phone-specific content scale instead of a desktop-sized article stack.
- Nearby inspiration and the confirmed-itinerary tabs were tightened while preserving their existing map and tab behaviors.
- The canvas Agent, its separate tool tray, the 60px product navigation, and conflict semantics were regression-tested rather than redesigned.

### Verified phone metrics

- Viewports: 390 × 844 px and 360 × 800 px, device scale factor 1.
- Home: 24px title, 20px creator, 292px featured card, second card enters the first viewport, 60px bottom rail.
- Route detail: 24px two-line title, 170–205px hero, 53px top bar, 36px avatar, 300–340px map, 60px bottom rail.
- Nearby inspiration: map remains before the feed and sticky; map is 276–281px, feed cards are 106px, saved-only toggle remains functional.
- Confirmed itinerary: 26px title, 66px next-stop reminder, 46px tab rail; bookings, places, and notes remain isolated views.
- Canvas: idle Agent is 162px, composer is 115px, empty dialogue body is absent, and the separate four-button product rail remains 60px.
- Every checked page matched its viewport width exactly; no page-level horizontal overflow, console errors, page errors, or visible broken images were found.

### Canvas conflict regression

- Mobile browse/pan and drag-to-10:45 conflict behavior passed.
- The conflicting card, dwell bar, buffer label, transport node, connector, and stem enter one continuous danger state.
- Conflict connector and stem use the dotted `radial-gradient` flow treatment; ordinary connectors remain neutral.
- Valid, conflict, blocked, and undo-oriented timeline states completed without runtime errors.

### Commands

- `npm.cmd --prefix frontend run build:pages`
- `$env:QA_BASE_URL='http://127.0.0.1:5198/'; $env:QA_VIEWPORT_WIDTH='390'; $env:QA_VIEWPORT_HEIGHT='844'; node .runtime\mobile-feedback-qa-20260820.mjs`
- `$env:QA_BASE_URL='http://127.0.0.1:5198/'; $env:QA_VIEWPORT_WIDTH='360'; $env:QA_VIEWPORT_HEIGHT='800'; node .runtime\mobile-feedback-qa-20260820.mjs`
- `node .runtime\qa-mobile-canvas-selected.mjs`
- `node .runtime\qa-conflict-final.mjs`

The remaining “AI 定制页面” question is not treated as a completed standalone route: the current product exposes Agent inside the planning canvas. A separate page needs a confirmed entry point and content contract before implementation.

---

final result: passed

## Comparison target

- Annotated source images:
  - `D:\xwechat_files\wxid_shokj42ta4yu22_3815\temp\RWTemp\2026-08\6dc1caa35213cbeb1472878adac69e11\c7c14ce202536de065b225a5010e7e5e.jpg`
  - `D:\xwechat_files\wxid_shokj42ta4yu22_3815\temp\RWTemp\2026-08\6dc1caa35213cbeb1472878adac69e11\c490f4d592dbf8b34e72755390c03573.jpg`
  - `D:\xwechat_files\wxid_shokj42ta4yu22_3815\temp\RWTemp\2026-08\6dc1caa35213cbeb1472878adac69e11\ba145b27815fbbd2720ecdcd0d58a0c0.jpg`
- Browser-rendered implementation:
  - `D:\自己的一些小项目\旅游小助手\.runtime\mobile-feedback-20260820\after\01-home.png`
  - `D:\自己的一些小项目\旅游小助手\.runtime\mobile-feedback-20260820\after\02-inspiration.png`
  - `D:\自己的一些小项目\旅游小助手\.runtime\mobile-feedback-20260820\after\03-dashboard-bookings.png`
  - `D:\自己的一些小项目\旅游小助手\.runtime\mobile-feedback-20260820\after\03-dashboard-places.png`
  - `D:\自己的一些小项目\旅游小助手\.runtime\mobile-feedback-20260820\after\04-canvas-agent.png`
- Side-by-side comparison: `D:\自己的一些小项目\旅游小助手\.runtime\mobile-feedback-20260820\design-comparison.png`
- CSS viewport: 390 × 844 px; device scale factor 1.

## Findings

- No actionable P0, P1, or P2 visual differences remain for the requested mobile changes.
- [P3] The annotated inspiration reference uses screenshots of third-party food-delivery listings. The implementation deliberately keeps the same compact list rhythm but uses the product's own travel places, source labels, map data, and imagery instead of copying another product's brand or merchant content.
- [P3] The annotated home reference replaces the route action with a like count. The implementation keeps the existing `查看路线` action because it is part of the working planning journey; the creator and title have still moved to the requested lower visual block.
- [P3] The mobile dashboard uses 40–44 px tab and action targets. This is slightly larger than the most compact annotated controls, but preserves reliable touch interaction.

## Required fidelity surfaces

- Home: the title is exactly 24 px, metadata stays at the top, title/type and creator/action align near the lower edge, the featured card is 342 px tall, and the fixed bottom navigation is reduced to 60 px.
- Nearby inspiration: search and categories lead directly into a 304 px map; the bookmark-only filter is a functional button; the map precedes the feed and becomes sticky; the feed uses compact 112 × 116 px travel-image rows.
- Confirmed itinerary: the title is 30 px; a functional next-stop reminder appears before the tabs; tab order is `预订 / 地点 / 笔记`; budget and journey content stay in bookings, the map and place list stay in places, and notes stay in notes.
- Canvas Agent: the removed suggestion card remains removed. The idle mobile Agent now measures 162 px rather than occupying half the screen, while the composer remains usable. Its product navigation now matches the other three mobile pages with a 60 px icon-only rail.
- Brand continuity: all new surfaces reuse the existing warm ivory, white, olive, ink, border, radius, imagery, and icon language.

## Interaction and browser evidence

- Browser run: Chromium through the project's existing Playwright dependency against `http://127.0.0.1:5198/`.
- Home title: 24 px; first card: 342 px; footer stays inside the card; bottom rail: 60 px.
- Nearby inspiration: saved-only filter toggles both ways; map top is 134 px, map height is 304.19 px, and the first feed card starts below it at 450.19 px.
- Dashboard: initial tab is bookings; budget is visible and map hidden. Switching to places shows the map and hides budget. Switching to notes shows only notes. The next-stop reminder is visible.
- Canvas: idle Agent inspector is 162 px, composer is 115 px, and the empty dialogue body occupies 0 px. The bottom navigation is 60 px, all visible text labels are hidden, and all four icon buttons retain accessible labels.
- Visible broken images: 0. Console errors: 0. Page errors: 0.
- Frontend production build: passed with Vite; Sites output prepared.

## Scope boundary

- This pass adjusts the existing responsive web application. It does not introduce a separate native mobile app.
- Meituan, live pricing, reservations, and partnership claims remain clearly labelled as mock/demo boundaries.
- The fixed public GitHub Pages URL has not been updated in this pass; deployment requires a separate explicit publish step.
