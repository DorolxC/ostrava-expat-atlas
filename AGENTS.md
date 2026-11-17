# Ostrava Expat Atlas

## Product

Ostrava Expat Atlas is an interactive illustrated map of Ostrava with an English-first guide for residents, newcomers, students and visitors. Keep Czech place names and diacritics where they identify local places. Verify English-language offerings before marking them confirmed. Keep the evidence and the date checked with each place record.

## Geography

Use the bundled OSM, municipal district and elevation data. Preserve geographic coordinates, source identifiers, footprints, supported heights, road grades and waterway directions. Use the fixed local-metre projection in `public/js/geo.js` for every layer. Road and path joins require a shared mapped endpoint or independent evidence. Inspect bridges, tunnels and layers before changing visible or connected segments. Respect genuine dead ends. Illustrative roof, material or landmark details need to fit the mapped feature and should never be described as surveyed.

## Art and identity

Build a sunlit miniature city with readable streets, distinct architectural periods, densely layered park and forest canopies, and a visibly different material vocabulary at the ironworks. Keep the light direction consistent, with the lit façade and roof contrasts legible at street and city scales. Use deterministic, world-aligned materials. Preserve a clear hierarchy between transport, terrain, water, foliage and landmarks. Draw landmark assets in the atlas projection at their mapped anchors, with the same lighting and resolution as the surrounding scene.

Daylight is the selected art direction. Treat the historic street wall, Secession detail, functionalist bands, planned Poruba apartments, detached and row houses, panel blocks and steel or brick industrial halls as distinct architectural profiles. Attribute Level A to the curated landmark registry and its documented visual or dimensional evidence. Level B uses usable building metadata and Level C uses conservative typology and local context. Retain the V5.1 roof validation. Fixtures must fit their supporting plane and preserve ridges, open courts and separately mapped building parts.

Keep the map visible by default. Finding a place should be easy to start by touch, keyboard or pointer. Use contextual discovery and details, a compact masthead, anchored map symbols, and cartographic controls with a clear function. Avoid dashboard panels, generic floating cards, decorative badges, unrelated navigation and filler text. Ostrava blue `#003C69` and cyan `#00ADD0` can inform accents. Use the original atlas signature and preserve an independent identity.

## Pipeline

Verify the active worktree and live local revision before editing. The renderer is a dependency-free Node script and CPU rasterizer. It reads the bundled inputs and writes the overview, a 2.78 px/m citywide tile layer, four 4.25 px/m close-ups, guide illustrations, a revisioned manifest and tree crown records under `public/map/`. Register Blender meshes in `scripts/blender/models/` with metre-based local coordinates, source links and the exact OSM buildings they replace. Keep artist files available alongside the release. The runtime uses native modules, Canvas 2D and workers. Use the existing pipeline when it meets the design requirement and evaluate new dependencies against concrete needs. Build `dist/` with `npm run build`.

Compare rendered crops before applying broad changes. Keep overlapping section draws deterministic and detail edges feathered. Regenerate affected levels and their manifest together. Explicit surface and cover tags take priority over broad land use. Infer untagged ground through continuous context without inventing parcel edges. When changing tree geometry, rebuild the crown records and keep the extraction envelope and trunk mask aligned. When changing water pigments, test river extraction and flow clips around bridges. Preserve tram positions, saved views, tile retries, reduced motion and pause. Verify that crown and river patches stay visible while crossing tile levels in both zoom directions.

Permanent artwork uses the static tiles. Dynamic figures, vehicles, wildlife, leaves and cloud shade use the overlay clock, field and projection. Derive route samples and access or directional tags from the matching OSM extract. Qualify a route against buildings and water before publishing it. Use foreground depth associated with the current tile revision for street objects. Rebuild the depth field with revised permanent art. Moving actors, adjusting their timing and updating sprite drawings use the dynamic runtime and assets.

## Provenance and verification

Track sources and licenses for any material, typeface, data or external asset used in a release. Use imagery only where permission permits. Keep attribution accessible.

Run `npm run check` and `npm run build`. Verify the served build in a real browser on desktop and touch sizes. Exercise panning, wheel/pinch zoom, search, filtering, place selection, share links and reduced motion. Watch for network or console errors. For an art release, pair before and after images at matching coordinates, zoom, viewport, pixel ratio and motion state. Check the centre, ironworks, a park, a river crossing, a road junction and both sides of representative seams. State the coverage and any open issues.

Record normal-speed footage from the layered map canvases at practical zoom. Include matched stationary-camera views for wind particles, walkers, traffic, birds, moving shade and river and tree motion. Check that the stationary base canvas stays stable while animation operates. Document visual scope, 4×-throttled mobile timings, asset costs, tool availability and the provenance of curated models.

Save the previous working version or exact release ZIP before entering a destructive stage. Work in a separate copy or branch until the new release passes checks. Confirm the active preview revision and the release archive after switching.

