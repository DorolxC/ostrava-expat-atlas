"""Model and export three modern Ostrava landmarks from the atlas's OSM snapshot.

Run with Blender in background mode. Objects are modelled in local east/north
metres. Map meshes are exported from Blender's triangulated mesh data.
"""

import json
import sys
from math import atan2, cos, hypot, pi, sin, sqrt
from pathlib import Path

import bpy
from mathutils import Vector


PROJECT = Path(__file__).resolve().parents[2]
MODELS = PROJECT / "scripts" / "blender" / "models"
REVIEW = PROJECT.parents[1] / "outputs" / "ostrava-expat-atlas-v5.3-review" / "blender"
EAST_METRES = 111319.49 * cos(49.832 * pi / 180)
NORTH_METRES = 111229
LIGHT = Vector((-0.7, -0.46, 0.78)).normalized()

KAROLINA_PARTS = (
    "w292280355", "w292280367", "w292280369", "w292280370", "w292280371",
    "w292280373", "w292280374", "w292280375", "w292280377", "w292280378",
    "w292280379", "w292280380", "w292280383",
)


def material(name, colour):
    saved = bpy.data.materials.get(name)
    if saved is not None:
        return saved
    mat = bpy.data.materials.new(name)
    mat["atlas_srgb"] = int(colour, 16)
    channels = [int(colour[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [((v + .055) / 1.055) ** 2.4 if v > .04045 else v / 12.92 for v in channels]
    # Workbench reads the viewport swatch while physically shaded renders use
    # the shader's linear input.
    mat.diffuse_color = (*channels, 1)
    mat.use_nodes = True
    shader = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (*linear, 1)
    shader.inputs["Roughness"].default_value = .78
    return mat


def wall_edges(rings):
    for ring in rings:
        for a, b in zip(ring, ring[1:] + ring[:1]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            length = hypot(dx, dy)
            if length > .001:
                yield a, b, (dy / length, -dx / length), length


def contour_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1]))


def map_rings(feature, anchor):
    polygons = []
    for i, coordinates in enumerate(feature["points"]):
        ring = [((lon - anchor[0]) * EAST_METRES, (lat - anchor[1]) * NORTH_METRES)
                for lon, lat in coordinates]
        if ring[0] == ring[-1]:
            ring.pop()
        if (contour_area(ring) > 0) != (i == 0):
            ring.reverse()
        polygons.append(ring)
    return polygons


def rectangle(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def edge_at(a, b, x):
    return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])


def intervals(edges, x):
    crosses = sorted(
        [(a, b) for a, b, _, _ in edges if min(a[0], b[0]) < x < max(a[0], b[0])],
        key=lambda edge: edge_at(*edge, x),
    )
    return zip(crosses[::2], crosses[1::2])


def offset(p, n, amount):
    return p[0] + n[0] * amount, p[1] + n[1] * amount


def interpolate(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


class Mesh:
    def __init__(self, name, transform=lambda point: point):
        self.name = name
        self.transform = transform
        self.vertices = []
        self.indices = {}
        self.polygons = []
        self.slots = []
        self.materials = []

    def add(self, coords, mat):
        points = [tuple(round(value, 4) for value in self.transform(v)) for v in coords]
        points = list(dict.fromkeys(points))
        if len(points) < 3:
            return
        face = []
        for point in points:
            if point not in self.indices:
                self.indices[point] = len(self.vertices)
                self.vertices.append(point)
            face.append(self.indices[point])
        if mat not in self.materials:
            self.materials.append(mat)
        self.polygons.append(face)
        self.slots.append(self.materials.index(mat))

    def wall(self, a, b, low, high, mat):
        self.add([(*a, low), (*b, low), (*b, high), (*a, high)], mat)

    def slab(self, rings, z, mat):
        # Vertical decomposition preserves narrow concavities and mapped courtyards.
        # Each trapezoid is bounded by the same two edges over its whole width.
        x_coords = sorted({p[0] for ring in rings for p in ring})
        edges = list(wall_edges(rings))
        for left, right in zip(x_coords, x_coords[1:]):
            if right - left < .0005:
                continue
            for lower, upper in intervals(edges, (left + right) / 2):
                self.add([(left, edge_at(*lower, left), z),
                          (right, edge_at(*lower, right), z),
                          (right, edge_at(*upper, right), z),
                          (left, edge_at(*upper, left), z)], mat)

    def shell(self, rings, bottom, top, side, cover):
        for a, b, _, _ in wall_edges(rings):
            self.wall(a, b, bottom, top, side)
        if cover is not None:
            self.slab(rings, top, cover)

    def box(self, bounds, bottom, top, side, cover):
        self.shell([rectangle(*bounds)], bottom, top, side, cover)

    def link(self):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices, [], self.polygons)
        for mat in self.materials:
            mesh.materials.append(mat)
        for polygon, slot in zip(mesh.polygons, self.slots):
            polygon.material_index = slot
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        return obj


def roof_channels(mesh, rings, roof_z, mat, angle, interval, width):
    """Clip steel skylight frames to the irregular mapped roof perimeter."""
    c, s = cos(angle), sin(angle)
    local = [[(x * c + y * s, -x * s + y * c) for x, y in ring] for ring in rings]
    edges = list(wall_edges(local))
    low, high = min(p[0] for p in local[0]), max(p[0] for p in local[0])

    def world(x, y):
        return x * c - y * s, x * s + y * c, roof_z

    x = low + interval * .72
    while x + width / 2 < high:
        for a, b in intervals(edges, x):
            ymin, ymax = edge_at(*a, x) + width, edge_at(*b, x) - width
            if ymax > ymin:
                mesh.add([world(x - width / 2, ymin), world(x + width / 2, ymin),
                          world(x + width / 2, ymax), world(x - width / 2, ymax)], mat)
        x += interval


def karolina(features, anchor):
    wall = material("Concrete · porcelain", "ded9cd")
    warm = material("Concrete · warm white", "d0c8b6")
    joint = material("Panel seams · warm grey", "ada698")
    top = material("Flat roof · grey bitumen", "a7aaa4")
    flashing = material("Roof rim · chalk", "e5dfce")
    deep = material("Shopfront · blue-grey glass", "506b70")
    glass = material("Atrium roof · blue glazing", "7299a5")
    shiny = material("Atrium roof · bright ribs", "abc7c3")

    main = map_rings(features["w98290906"], anchor)
    podium = Mesh("Forum · continuous ground-level envelope")
    podium.shell(main, 0, 2.6, warm, None)
    podium.shell(main, 2.6, 9.6, wall, top)
    facade = Mesh("Forum · fibre-concrete panels and glazed entrances")
    for j, (a, b, normal, length) in enumerate(wall_edges(main)):
        outer = offset(a, normal, .06), offset(b, normal, .06)
        facade.wall(*outer, 8.45, 8.8, joint)
        if length < 18:
            continue
        for k in range(max(2, round(length / 8))):
            rows = max(2, round(length / 8))
            start, end = (k + .1) / rows, (k + .78) / rows
            xa, xb = interpolate(*outer, start), interpolate(*outer, end)
            if (j % 3 == 0 and k != 0) or (j % 7 == 0 and k == 0):
                facade.wall(xa, xb, .9, 4.7, deep)
            seam0 = interpolate(*outer, (k + .28) / rows)
            seam1 = interpolate(*outer, (k + .53) / rows)
            seam_width = .16 / length
            seam2 = interpolate(*outer, (k + .53) / rows + seam_width)
            seam3 = interpolate(*outer, (k + .28) / rows + seam_width)
            facade.add([(*seam0, 4.9), (*seam3, 4.9), (*seam2, 8.45), (*seam1, 8.45)], joint)

    atrium = Mesh("Forum · glazed connecting roof")
    roof = map_rings(features["w292280367"], anchor)
    atrium.shell(roof, 9.52, 14.5, deep, glass)
    roof_channels(atrium, roof, 14.54, shiny, -.15, 4.7, .24)
    roof_channels(atrium, roof, 14.56, shiny, pi / 2 - .15, 11, .22)
    cubes = Mesh("Forum · offset white concrete volumes")
    heights = {2: 11.6, 3: 15.1, 4: 18.3, 5: 22.3, 6: 28.3}
    for j, key in enumerate(id for id in KAROLINA_PARTS if id != "w292280367"):
        feature = features[key]
        ring = map_rings(feature, anchor)
        z = heights[int(feature["tags"]["building:levels"])]
        cubes.shell(ring, 9.5, z, warm if j % 4 == 0 else wall, top)
        for a, b, normal, length in wall_edges(ring):
            outer = offset(a, normal, .035), offset(b, normal, .035)
            cubes.wall(*outer, z - .72, z, flashing)
            if length > 13 and z > 16:
                rows = max(2, round(length / 7))
                for i in range(1, rows):
                    seam_from = interpolate(*outer, i / rows)
                    seam_to = interpolate(*outer, i / rows + .18 / length)
                    cubes.wall(seam_from, seam_to, z - 4.4, z - .8, joint)
    return [part.link() for part in (podium, facade, atrium, cubes)]


def inset_strip(mesh, ring, level, inset, mat):
    for a, b, normal, _ in wall_edges([ring]):
        a2, b2 = offset(a, normal, inset), offset(b, normal, inset)
        mesh.add([(*a2, level), (*b2, level), (*b, level), (*a, level)], mat)


def organica(features, anchor):
    rims = material("Organica · ivory horizontal fins", "dadaca")
    ceiling = material("Organica · warm aluminium undersides", "a0a69e")
    pane = material("Organica · dark sage glazing", "547778")
    pane_sun = material("Organica · reflected sky", "658a86")
    mullion = material("Organica · slim bronze mullions", "82958b")
    membrane = material("Organica · pale roof membrane", "c2c5b5")
    slate = material("Organica · core metal tops", "8c9b91")
    stone = material("Organica · atrium paving", "b4aa97")

    rings = map_rings(features["r16182525"], anchor)
    glazing = Mesh("Organica · parabolic glass wings and open atrium")
    fins = Mesh("Organica · wraparound horizontal aluminium")
    glazing.slab([list(reversed(rings[1]))], .1, stone)
    for i, (a, b, normal, length) in enumerate(wall_edges(rings)):
        glazing.wall(a, b, 0, 28.6, pane_sun if i % 7 in (1, 2, 3) else pane)
        if length > 4.8:
            for numerator in (1, 2):
                p = offset(interpolate(a, b, numerator / 3), normal, .035)
                q = offset(interpolate(a, b, numerator / 3 + .16 / length), normal, .035)
                glazing.wall(p, q, .85, 28.55, mullion)
        a2, b2 = offset(a, normal, .26), offset(b, normal, .26)
        for level in (.65, 4.45, 7.87, 11.29, 14.71, 18.13, 21.55, 24.97, 28.38):
            fins.wall(a2, b2, level, level + .6, rims)
            fins.add([(*a, level), (*b, level), (*b2, level), (*a2, level)], ceiling)
            fins.add([(*a2, level + .6), (*b2, level + .6), (*b, level + .6),
                      (*a, level + .6)], rims)
    roof = Mesh("Organica · four roofs and inner atrium coping")
    roof.slab(rings, 28.77, membrane)
    for ring in rings:
        inset_strip(roof, ring, 28.82, -1.0, rims)
        for a, b, normal, _ in wall_edges([ring]):
            roof.wall(offset(a, normal, .10), offset(b, normal, .10), 28.85, 29.43, slate)
    # The real rooftop equipment is low; the four service blocks stay behind the parapet.
    for x, y in [(-26, 21), (20, 29), (-22, -23), (27, -19)]:
        roof.box((x - 3.6, x + 3.6, y - 4.1, y + 4.1), 28.75, 30.4, slate, rims)
    return [part.link() for part in (glazing, fins, roof)]


def arena(features, anchor):
    concrete = material("Arena · weathered concrete", "aaa596")
    brace = material("Arena · pale support brackets", "c7bdaa")
    cheeks = material("Arena · pillar concrete", "b6ad9b")
    metal = material("Arena · cool roof steel", "8e9695")
    trim = material("Arena · pale roof verge", "c6c5b8")
    shadow = material("Arena · dark glazing and undercroft", "475758")
    glass = material("Arena · muted main gallery glazing", "657876")
    paving = material("Arena · raised public terraces", "b8ad9b")
    truss = material("Arena · oxidized light metal truss", "a69687")

    outer = map_rings(features["w74404353"], anchor)
    podium = Mesh("Arena · mapped access and service envelope")
    podium.shell(outer, .0, 2.3, concrete, paving)
    for a, b, normal, length in wall_edges(outer):
        if length > 10:
            podium.wall(offset(a, normal, .04), offset(b, normal, .04), 1.2, 1.6, trim)

    angle = atan2(.515, .857)
    c, s = cos(angle), sin(angle)

    def orient(point):
        x, y, z = point
        x += 2
        y += 7
        return x * c - y * s, x * s + y * c, z

    def chamfered(x, y, cut):
        return [(-x + cut, -y), (x - cut, -y), (x, -y + cut), (x, y - cut),
                (x - cut, y), (-x + cut, y), (-x, y - cut), (-x, -y + cut)]

    hall = Mesh("Arena · 125 by 109 m chamfered hall", orient)
    hull = chamfered(54.5, 62.5, 19)
    lower = chamfered(45, 53, 16)
    hall.shell([lower], 2.1, 10.9, shadow, None)
    hall.shell([hull], 9.9, 11.8, brace, None)
    hall.shell([hull], 11.8, 21.7, glass, None)
    hall.shell([hull], 21.7, 23.6, trim, metal)
    structure = Mesh("Arena · four concrete towers and the projecting gallery", orient)
    for a, b, normal, length in wall_edges([hull]):
        outward = offset(a, normal, .075), offset(b, normal, .075)
        structure.wall(*outward, 16.3, 16.84, trim)
        n = max(1, round(length / 8.4))
        for i in range(n):
            centre = (i + .5) / n
            p = interpolate(*outward, centre - 1.08 / length)
            q = interpolate(*outward, centre + 1.08 / length)
            structure.wall(p, q, 11.8, 22.35, brace)
            if length > 55:
                p0 = offset(p, normal, -7.2)
                q0 = offset(q, normal, -7.2)
                structure.add([(*p0, 2.3), (*q0, 2.3), (*q, 10.4), (*p, 10.4)], brace)
    for x in (-31, 31):
        for y in (-48, 48):
            structure.box((x - 4.4, x + 4.4, y - 4.9, y + 4.9), 2.2, 28.5, cheeks, trim)

    roof = Mesh("Arena · twin 100 m truss bands and shallow shed roof", orient)
    # The two main trusses are aligned with the four support towers. Keep the
    # shallow roof breaks readable at map scale and cover the truss top chord.
    for left, right, level_left, level_right in (
        (-46, -32.9, 23.65, 25.4), (-29.1, -.33, 25.4, 24.35),
        (.33, 29.1, 24.35, 25.4), (32.9, 46, 25.4, 23.65),
    ):
        roof.add([(left, -49, level_left), (right, -49, level_right),
                  (right, 49, level_right), (left, 49, level_left)], metal)
        for y in (-49, 49):
            roof.add([(left, y, 23.55), (right, y, 23.55), (right, y, level_right),
                      (left, y, level_left)], concrete)
    for x in (-31, 31):
        roof.box((x - 2.5, x + 2.5, -50, 50), 20.3, 29.3, truss, trim)
    return [part.link() for part in (podium, hall, structure, roof)]


def export_model(spec, objects):
    data = dict(spec)
    data["vertices"] = vertices = []
    data["faces"] = faces = []
    for obj in objects:
        mesh = obj.data
        offset_index = len(vertices)
        vertices.extend([round(channel, 3) for channel in v.co] for v in mesh.vertices)
        mesh.calc_loop_triangles()
        for tri in mesh.loop_triangles:
            if tri.area < .003:
                continue
            # Match the atlas's material colours under a single directional light.
            colour = mesh.materials[tri.material_index]["atlas_srgb"]
            light = .91 + .14 * tri.normal.dot(LIGHT)
            srgb = [max(0, min(255, round(((colour >> shift) & 255) * light))) for shift in (16, 8, 0)]
            rgb = srgb[0] * 65536 + srgb[1] * 256 + srgb[2]
            faces.append([*(i + offset_index for i in tri.vertices), rgb])
    path = MODELS / (data["id"] + ".json")
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"ATLAS {data['id']} {len(vertices)} vertices, {len(faces)} triangles", flush=True)


def preview(spec, objects):
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene["atlas_lon_lat"] = spec["point"]
    scene["atlas_replaces"] = ", ".join(spec["replaces"])
    scene["atlas_sources"] = "\n".join(spec["sources"])
    coords = [v.co for obj in objects for v in obj.data.vertices]
    extent = max(max(abs(v.x), abs(v.y)) for v in coords) * 4
    ground = Mesh("Preview ground · not exported")
    ground.slab([rectangle(-extent, extent, -extent, extent)], -.15,
                material("Preview backdrop · sage grey", "9b9c85"))
    ground.link()
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = "Atlas projection preview"
    pitch, angle = .56, 33 * pi / 180
    horizontal = sqrt(1 - pitch * pitch)
    location = Vector((-sin(angle) * horizontal, -cos(angle) * horizontal, pitch))
    orientation = (-location).to_track_quat("-Z", "Y")
    projected = [orientation.inverted() @ v for v in coords]
    minima = [min(v[i] for v in projected) for i in range(3)]
    maxima = [max(v[i] for v in projected) for i in range(3)]
    target = orientation @ Vector([(a + b) / 2 for a, b in zip(minima, maxima)])
    camera.location = target + 360 * location
    camera.rotation_euler = orientation.to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 1.19 * max(maxima[0] - minima[0], (maxima[1] - minima[1]) * 1120 / 860)
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.studiolight_rotate_z = -.28
    shading.color_type = "MATERIAL"
    shading.show_shadows = True
    shading.show_cavity = True
    shading.cavity_type = "WORLD"
    shading.cavity_ridge_factor = .8
    shading.cavity_valley_factor = .66
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = 1120
    scene.render.resolution_y = 860
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(REVIEW / ("modern-" + spec["id"] + ".png"))
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(REVIEW / ("modern-" + spec["id"] + ".blend")))
    bpy.ops.render.render(write_still=True)


SPECS = [
    (karolina, {
        "id": "karolina", "name": "Forum Nová Karolina", "point": [18.285126, 49.830783],
        "replaces": ["w98290906", *KAROLINA_PARTS],
        "sources": [
            "https://www.k4.cz/projects/obchodni-a-zabavni-centrum-nova-karolina",
            "https://polycon.info/en/projekty/forum-nova-karolina/",
            "https://www.openstreetmap.org/way/98290906",
        ],
    }),
    (organica, {
        "id": "organica", "name": "Organica", "point": [18.2854, 49.8294],
        "replaces": ["r16182525"],
        "sources": [
            "https://www.organicaostrava.cz/budova",
            "https://schindlerseko.cz/en/projekty/organica/",
            "https://www.openstreetmap.org/relation/16182525",
        ],
    }),
    (arena, {
        "id": "arena", "name": "Ostravar Aréna", "point": [18.248476, 49.804576],
        "replaces": ["w74404353"],
        "sources": [
            "https://www.ostravskepamatky.cz/pamatky/256-Palac-kultury-a-sportu-Ostravar-Arena?lang=cs_CZ",
            "https://www.ostrava.cz/en/o-meste/aktualne/ostravar-arena-set-for-renovation-ostrava-plans-new-premier-ice-sports-centre",
            "https://www.openstreetmap.org/way/74404353",
        ],
    }),
]


def main():
    MODELS.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    needed = {id for _, spec in SPECS for id in spec["replaces"]}
    source = json.loads((PROJECT / "public" / "map" / "geometry.json").read_text(encoding="utf-8"))
    features = {f["id"]: f for f in source["features"] if f["id"] in needed}
    if needed != features.keys():
        raise ValueError(f"Landmark footprint IDs missing from map: {needed - features.keys()}")
    del source
    for make, spec in SPECS:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        models = make(features, spec["point"])
        if "--preview-only" not in sys.argv:
            export_model(spec, models)
        preview(spec, models)


if __name__ == "__main__":
    main()
