# Ostrava Expat Atlas

An animated isometric atlas of all 23 Ostrava districts, drawn from mapped building footprints, streets and waterways. The local place guide has 16 entries in the centre and Lower Vítkovice.

## Run

With Node.js 20 or later, run `npm run dev` in the project folder and open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). Set `OSTRAVA_PORT` to use a different port. The artwork, typefaces and directory are bundled and need no package installation.

- **Find a place** opens search, filters and the district index. Press **/** to move straight to search. Select a place to open its illustrated guide with directions and English-language evidence.
- **Historic centre** and **Ironworks** are available under **Districts**.
- **Districts** jumps to any of the 23 districts. Open **Map overview** for the minimap, the whole-city view, a share link and the **Ambient motion** switch. The switch follows the operating system’s reduced-motion preference until the user sets a choice.
- Drag or use the arrow keys to pan. Scroll, pinch or use the zoom buttons. Press **0** to return to the central view.
- Search supports Czech names with or without diacritics. Category, tag and English-verification filters combine. Map views and places have shareable links.

Run `npm run check` to validate the mapped features, resolution levels and animation inputs. Run `npm run build` to write the static site in `dist/` and `npm run preview` to serve that build.

## Deploy on Vercel

Import this repository with the Vercel GitHub integration. The project configuration builds the static site into `dist/` from the checked-in map artwork. Git-based builds keep the full tile set available on the Hobby plan.

Use `main` as the production branch. Push changes to a separate branch for a preview deployment and open a pull request for review. Merge to `main` after checking the preview. Connect this same repository in Codex Cloud to make and review changes from the web.

## Map art

The camera uses a shared projection in metres. The generator paints overlapping sections to keep shadows and structures continuous between tiles. Every district uses the citywide **2.78 px/m** level. The historic centre, the riverfront by New City Hall, the ironworks and the area around Poruba’s Oblouk keep **4.25 px/m** close-ups at the highest zooms. The close-up perimeter blends into the citywide artwork.

The shipped tiles use lossless WebP. The browser decodes nearby tiles and eases in their detail over the overview. The art uses a shared light direction, terracotta and slate roof materials, oxide and soot colors in the ironworks, and warmer plaster in Poruba. Surveyed surface tags take priority over broad land use. Developed ground has a neutral underpainting, and stone setts, slabs, ballast, orchards, allotments and lawns have distinct world-aligned textures. Roof shapes follow mapped footprints, including concave blocks and courtyards. Street details include marked crossings, benches, fountains and tram stops at mapped locations. The landmark renderer adds structural detail to the Bolt Tower, furnaces Nos. 1, 4 and 6, Gong, the Old and New City Hall towers, the cathedral and Oblouk.

The city edge feathers into the surrounding fields, woods and waterways. Real elevation drives ground shading. The projection uses a level ground plane, and roof fixtures, missing building heights and some landmark components are illustrated. At the highest zooms the four close-ups retain finer baked detail. True relief would require the tile renderer to project ground, buildings and transport routes from the same elevation mesh.

Daylight is used throughout the atlas. Historic townhouses, Secession-inspired façades, functionalist glazing, Poruba apartment rhythms, panel cores, family houses and industrial bays use different opening, material and silhouette treatments. Level B uses usable mapped attributes. Level C uses local typology and ordinary conservative details. The alternate Lithograph treatment uses engraved hatching and restrained material highlights. Both use the same map projection and silhouettes.

Level A monuments use individually drawn geometry routed through `scripts/curated-landmarks.mjs` and `scripts/models.mjs`. `public/map/landmarks.json` registers the earlier buildings and structures. V5.3 adds Forum Nová Karolina, Organica, Ostravar Aréna, Trojhalí Karolina, Dům kultury města Ostravy and Slezskoostravský hrad as Blender meshes. Their metric geometry, mapped anchors and reference links ship in `scripts/blender/models/`. The atlas rasterizes those meshes with the ordinary depth buffer, projection and light direction. The baked web build runs without Blender.

### Roof geometry

The tile builder validates building rings in metres and groups each outside outline with its enclosed courtyards. Convex hip roofs use the lowest of the sloping planes from the mapped eaves. On concave blocks the builder partitions the occupied footprint, then intersects the planar distances to finite eave segments. That creates continuous hips and valleys across wings and around open courts. Separate parts retain their outlines and heights. Across supported roof forms the painter uses the same computed wall top and roof edge.

The solver uses mapped shape, orientation, direction and height where the outline can support them. Unmapped shapes are inferred conservatively. Invalid outlines, exceptional complexity and unsupported mapped forms use a flat version of the footprint. A complex tagged gable can be approximated by joined hips. These are illustrated roof forms and some original heights remain estimated. [OpenStreetMap roof tags](https://wiki.openstreetmap.org/wiki/Simple_3D_buildings#Other_roof_tags)

Run `npm run check:roofs` for the synthetic and Ostrava geometry fixtures. To inspect a building, render a crop around its coordinates with its OSM ID. The renderer saves the isometric PNG, a JSON file with its exact source rings and roof planes, and a self-contained browser view of both.

```sh
node scripts/render.mjs --audit-crop 18.2981089 49.8386468 110 70 3.55 roof.png --roof-id w59009450
```

## Motion and interface

A separate transparent canvas animates tree crowns, water and simulated turquoise-and-white trams on mapped tracks. The browser worker isolates the painted crowns and prepares local poses that flex above fixed trunks as gusts travel through groups of trees. The river's bright crests and softer wakes follow downstream distances baked from its mapped centrelines. Narrow channels use shorter ripples. Visible water spans clip the flow at banks and bridge decks. Trams ease around mapped bends, stops and at-grade crossings. Mapped fountains with a visible basin add a small ripple in close views. Current speeds, wind and transit are illustrative. The viewer reprojects the last prepared patch during camera motion and blends in newly prepared artwork on the same clock. Failed visible tiles retry with backoff. Ambient motion pauses when the view is zoomed out, hidden or off-screen. Scroll and pinch retain their map anchor. Reduced-motion mode defaults to ambient motion off. Add `motion=diagnostic` to the URL query for stronger wind and water during inspection. The diagnostic follows the same ambient motion preference.

The dynamic world uses the same transparent overlay to draw windborne leaves, walkers, cars, cyclists, small flocks and drifting cloud shade. Street activity is authored in ten areas using mapped, permitted surface routes. Poruba and Mariánské Hory include mapped bird sites. Road users follow raw one-way tags where available. Each scene uses a static foreground depth field baked by the map renderer. The browser loads the relevant compressed fields after visible scenery settles. A clipped sprite can pass behind a building or tree. The overlay culls offscreen objects, reuses a bounded pose cache, sorts street traffic and trams by their ground depth, and stops its clock on pause. Wind direction and cloud cells use the atlas coordinates. All activity is illustrative. The map artwork stays on its own canvas. The browser uses the standard gzip `DecompressionStream` for the foreground fields.

The compact masthead pairs the Bricolage Grotesque wordmark with a search entry. Instrument Serif titles the place guides, with Inter for reading and navigation. On desktop the search drawer opens from the masthead and a selected place opens beside the map. On mobile both use bottom sheets. Map overview contains the coordinates, minimap, share control and motion setting. [Ostrava design manual](https://ostrava.cz/cs/o-meste/logo-mesta-ostravy/designmanual/styl)

## Cartographic checks

`npm run check:geometry` checks mapped junction fixtures, polygon rings, projected positions, grade separation and tile rectangles. It also flags close pedestrian endpoints for evidence review. Pass the path to the matching PBF as an argument or set `OSTRAVA_OSM_PBF` to check raw centreline coordinates and node order. Keep the extract date aligned with the `sourceTime` in `public/map/geometry.json`.

Start the loopback server with `OSTRAVA_GEOMETRY_DIAGNOSTIC=1` and open `/_geometry` to inspect the actual map tiles alongside the compiled centrelines, optional raw PBF, junctions, grades and tile edges. Hover for feature IDs and review flags. The overlay follows the camera after it settles. The tinted surface widths show the road-width model, with the rendered artwork visible beneath it. Diagnostic files are outside `public` and `dist`.

Run `node scripts/render.mjs --audit-seam street-3 18.2948333 49.8440657 x` to compare independent renders where two sections meet near Komenského sady. Pass another level, longitude, latitude and axis to inspect another join. The outer perimeter of each higher-resolution region blends into the map underneath using the tile alpha channel. The manifest includes a content revision for browser tile caching.

## Sources and regeneration

- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0. Buildings, roads, street detail and motion anchors use the [BBBike Ostrava extract](https://download.bbbike.org/osm/bbbike/Ostrava/) from 7 November 2026. The softened municipal outline uses [OSM relation 437354](https://www.openstreetmap.org/relation/437354).
- Statutární město Ostrava, [district names and geometry](https://data.gov.cz/zdroj/datové-sady/00845451/6333fdcab1c60bb548e62809d84bef5f) under CC BY 4.0.
- [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/). European terrain uses Copernicus data and information funded by the European Union, EU-DEM layers. Global SRTM and GMTED2010 data courtesy of the U.S. Geological Survey.
- Landmark references and drawing notes are in `public/map/landmarks.json`. Full attribution is in `public/map/DATA-LICENSE.txt`. Font licenses ship with the files.

The bundled inputs can regenerate the tiles and crown coordinates with `npm run map:render`. Run `npm run map:canopies` to refresh just the crown coordinates, `npm run map:flow` for river directions, or `npm run map:motion` for the mapped tram routes. Set `OSTRAVA_CWEBP` to the path of the [cwebp encoder](https://developers.google.com/speed/webp/docs/precompiled) to write lossless WebP tiles. The generator uses PNG when this setting is absent. `node scripts/render.mjs --sample 0 output.png` renders one central crop. Use indices 1, 2 and 3 for the ironworks, Poruba and New City Hall. [OpenStreetMap direction convention](https://wiki.openstreetmap.org/wiki/Tag:waterway=river).

For art comparisons, add `--style daylight`, `--style lithograph` or `--style atlas` to a sample or audit crop. Use `--style baseline` with `--pilot centre` or `--pilot ironworks` for the corresponding V4.4 material treatment. `npm run map:render` builds Daylight and the matching foreground depth fields. With `OSTRAVA_CWEBP` set, `npm run map:pilots` can refresh the matching centre and ironworks close-ups and thumbnails for the style recorded in the manifest. Run `npm run map:world` to rebuild the depth alone. `npm run map:routes -- path/to/Ostrava.osm.pbf` rebuilds route eligibility, lane offsets and launch sites from the matching geography. `npm run check:world` validates the shipped paths and foreground data.

The architectural profiles use the heritage descriptions for local massing, masonry, openings and materials. Tiny Glade informed warm light and incidental craft, Townscaper informed variation at the façade and roof scale, and Tiny Rio informed the visual readability of real geography. The artwork and sprites are produced by this project’s code. [Ostravské památky](https://www.ostravskepamatky.cz/), [Poruba architecture](https://poruba.ostrava.cz/cs/o-porube/zajimavosti/prochazky-porubou/architektura-socialistickeho-realismu-v-porube), [Jubilejní kolonie](https://ovajih.ostrava.cz/cs/o-jihu/historie/jubilejni-kolonie/), [Tiny Glade](https://store.steampowered.com/app/2198150/Tiny_Glade/), [Townscaper](https://store.steampowered.com/app/1291340/Townscaper/), [Tiny Rio](https://tinyrj.com/)

For a geographic refresh, place the [Ostrava OSM PBF](https://download.bbbike.org/osm/bbbike/Ostrava/Ostrava.osm.pbf) and [full municipal relation](https://api.openstreetmap.org/api/0.6/relation/437354/full.json) in `scripts/data/` as `Ostrava.osm.pbf` and `boundary-osm.json`. Extract `Obvody_WGS84.geojson` from the [official district archive](https://mapy.ostrava.cz/opendata/data/opendata/obvody_WGS84_gjson.zip) into `scripts/data/official/`. Then run:

```sh
npm run map:ingest-city
npm run map:details -- scripts/data/Ostrava.osm.pbf N49E018.hgt.gz
npm run map:motion
npm run map:flow
npm run map:routes
npm run map:render
npm run check
npm run build
```

Get the elevation input from [the N49E018 terrain tile](https://s3.amazonaws.com/elevation-tiles-prod/skadi/N49/N49E018.hgt.gz).
