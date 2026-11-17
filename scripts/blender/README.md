# Ostrava Expat Atlas Blender models

The six buildings use original Blender geometry prepared for the atlas's fixed projection. The WebP tile builder reads meshes in `models/` and projects local east, north and height coordinates in metres onto their registered geographic anchors. Triangles use an atlas-compatible palette and the rasterizer's shared depth buffer.

| Models | Authoring script |
| --- | --- |
| Forum Nová Karolina, Organica, Ostravar Aréna | `modern.py` |
| Trojhalí Karolina, Dům kultury města Ostravy, Slezskoostravský hrad | `heritage.py` |

Each mesh export lists its reference sources and the exact mapped features it replaces. OpenStreetMap building outlines are © OpenStreetMap contributors under the Open Database Licence. The models were built from mapped footprints, architectural descriptions and visual references. Their heights, roof shapes and façade details are adapted to atlas scale where source measurements are missing. The scenes contain original geometry and flat colors. [OpenStreetMap attribution and licence](https://www.openstreetmap.org/copyright)

Run both scripts from the atlas root with Blender 5.2.

```powershell
& "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python-exit-code 1 --python scripts/blender/modern.py
& "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python-exit-code 1 --python scripts/blender/heritage.py -- . ./model-review
```

Once the exports are ready, run `npm run map:render`, `npm run check` and `npm run build` to regenerate tiles, matching foreground data and the distributable site.
