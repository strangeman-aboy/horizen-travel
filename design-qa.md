# Map Design QA

## Comparison target

- Source visual truth: `C:\Users\郝东晨\AppData\Local\Temp\codex-clipboard-36c82c6b-7be9-44d7-ba3f-30266aec3db3.png`
- Final implementation capture: `D:\自己的一些小项目\旅游小助手\.runtime\offline-static-dashboard-map-qa.png`
- Side-by-side comparison: `D:\自己的一些小项目\旅游小助手\.runtime\map-design-comparison-final.png`
- Browser viewport: 1900 × 1100 CSS px
- Device scale factor: 1
- Source pixels: 672 × 414
- Implementation component pixels: 630 × 360
- Density normalization: both captures compared at 1× raster density; no browser chrome included
- State: offline static demo, 出行模式, 五道营胡同 selected

## Full-view comparison evidence

The final implementation preserves the reference’s dominant cartographic language: pale blue-gray land, orange regional roads, yellow Beijing urban roads, thin gray district boundaries, light-blue waterways, subdued Chinese district labels, and a white selected-place callout containing a thumbnail, time, and place name. The final map is a local raster backdrop and does not claim that Baidu JSAPI is connected.

## Focused-region evidence

The component capture itself is the focused region and keeps the selected marker, road hierarchy, district labels, status badge, and callout readable at native density. A second crop was unnecessary because the complete target is one compact map component.

## Findings

- No actionable P0, P1, or P2 differences remain.
- P3 accepted difference: the offline implementation uses a single full-route control and an honest “北京离线演示地图” badge instead of recreating live Baidu zoom, locate, attribution, or connected-state controls.
- P3 accepted difference: all itinerary markers remain visible so the demo can communicate route structure; the reference only exposes one selected marker in the captured state.

## Required fidelity surfaces

- Fonts and typography: Source Han Sans remains the app font; map labels come from the raster asset, while callout text uses the same compact weight hierarchy as the reference.
- Spacing and layout rhythm: The dashboard map was increased from 300 px to 360 px high, bringing its aspect ratio and callout breathing room closer to the reference.
- Colors and visual tokens: Road orange/yellow, cool map background, gray boundaries, green inactive markers, black active marker, and white callout are visually aligned with the reference.
- Image quality and asset fidelity: The offline map is a dedicated 1600 × 1000 raster asset with no stretched screenshot chrome, old marker, logo, copyright strip, or embedded controls.
- Copy and content: The selected callout displays the real itinerary time and place name; the offline badge accurately describes the runtime rather than falsely claiming a Baidu connection.

## Comparison history

1. Initial implementation used a street-level pale map, a 300 px-high dashboard card, and markers positioned too far right. These were P2 fidelity mismatches.
2. Replaced the backdrop with a clean regional Beijing raster, increased the dashboard map to 360 px, added the thumbnail/time/name callout, and shifted the marker group onto the Beijing urban center.
3. Final side-by-side evidence shows no remaining actionable P0/P1/P2 issue.

## Interaction and runtime checks

- Opened the self-contained offline HTML with network disabled.
- Navigated to 附近灵感 and 出行模式.
- Verified 8 clickable markers.
- Clicked 国子监街 and 五道营胡同; the active marker, map callout, and detail content updated.
- External HTTP requests: 0.
- Page errors: 0.
- Console errors: 0.
- Automated tests: 106 passed.

## Follow-up polish

- If the live Baidu AK is restored later, keep the same callout component so live and offline modes retain one visual language.

final result: passed
