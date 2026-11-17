"""Build the atlas's three surveyed-footprint heritage models in Blender.

Run with Blender --background --factory-startup --python-exit-code 1
--python scripts/blender/heritage.py -- ATLAS_ROOT REVIEW_DIRECTORY
"""

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon


ROOT = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
REVIEW = Path(sys.argv[sys.argv.index('--') + 2]).resolve()
DEST = ROOT / 'scripts/blender/models'
REVIEW.mkdir(parents=True, exist_ok=True)
DEST.mkdir(parents=True, exist_ok=True)
FEATURES = {item['id']: item for item in json.loads(
    (ROOT / 'public/map/geometry.json').read_text(encoding='utf8'))['features']}
METRES_EAST = 111319.49 * math.cos(math.radians(49.832))
METRES_NORTH = 111229
LIGHT_DIRECTION = Vector((-0.63, -0.43, 0.65)).normalized()


def rgb(hex_colour):
    return tuple(int(hex_colour[i:i+2], 16) for i in (0, 2, 4))


def linear_colour(channel):
    value = channel / 255
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def clean_ring(ring):
    points = [Vector(point) for point in ring]
    if (points[0] - points[-1]).length < 0.01:
        points.pop()
    area = sum(a.x * b.y - a.y * b.x for a, b in edges(points))
    return points if area > 0 else list(reversed(points))


def edges(ring):
    return zip(ring, ring[1:] + ring[:1])


def outline(feature_id, origin):
    return clean_ring([
        ((lon-origin[0])*METRES_EAST, (lat-origin[1])*METRES_NORTH)
        for lon, lat in FEATURES[feature_id]['points'][0]
    ])


def xyz(point, z):
    return (point.x, point.y, z)


def lerp(a, b, t):
    return a + (b - a) * t


class Model:
    def __init__(self, ident, name, point, replaces, sources):
        self.data = dict(id=ident, name=name, point=point, replaces=replaces, sources=sources)
        self.objects = []
        self.materials = {}

    def material(self, key):
        if key not in self.materials:
            name, swatch = key
            m = bpy.data.materials.new(name)
            m.diffuse_color = (*[linear_colour(c) for c in rgb(swatch)], 1)
            m['atlas_swatch'] = swatch
            self.materials[key] = m
        return self.materials[key]

    def mesh(self, name, verts, faces):
        data = bpy.data.meshes.new(name)
        data.from_pydata(verts, [], [face for face, _ in faces])
        data.update()
        materials = {}
        for polygon, (_, swatch) in zip(data.polygons, faces):
            if swatch not in materials:
                materials[swatch] = len(materials)
                data.materials.append(self.material(swatch))
            polygon.material_index = materials[swatch]
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        self.objects.append(obj)
        return obj

    def panels(self, name, panels):
        vertices, faces = [], []
        for points, material in panels:
            start = len(vertices)
            vertices.extend(points)
            faces.append((tuple(range(start, len(vertices))), material))
        if faces:
            self.mesh(name, vertices, faces)

    def prism(self, name, ring, bottom, top, wall, roof=None):
        ring = clean_ring(ring)
        count = len(ring)
        lower = [xyz(v, bottom) for v in ring]
        upper = [xyz(v, top) for v in ring]
        indices = list(range(count))
        faces = [((i, (i+1) % count, (i+1) % count+count, i+count), wall) for i in indices]
        faces.append((tuple(i+count for i in indices), roof or wall))
        self.mesh(name, lower + upper, faces)

    def roofed(self, name, ring, floor, across, profile, wall, roof):
        """Split each tessellated roof face at the true ridge, gutter and eave lines."""
        def height(point):
            q = point.dot(across)
            for (a, h0), (b, h1) in zip(profile, profile[1:]):
                if q <= b + 1e-6:
                    return lerp(h0, h1, max(0, min(1, (q-a)/(b-a))))
            return profile[-1][1]

        def clip(points, limit, coeff):
            output = []
            for a, b in edges(points):
                qa = (a.dot(across) - limit) * coeff
                qb = (b.dot(across) - limit) * coeff
                if qa <= 0:
                    output.append(a)
                if (qa < -1e-6 and qb > 1e-6) or (qa > 1e-6 and qb < -1e-6):
                    output.append(lerp(a, b, qa / (qa-qb)))
            return output

        panels = []
        for a, b in edges(ring):
            axis_delta = (b-a).dot(across)
            stops = [0., 1.]
            if abs(axis_delta) > 1e-6:
                stops.extend(t for q, _ in profile[1:-1]
                             if 0.001 < (t := (q-a.dot(across))/axis_delta) < 0.999)
            line = [lerp(a, b, stop) for stop in sorted(stops)]
            for pa, pb in zip(line, line[1:]):
                panels.append(([xyz(pa, floor), xyz(pb, floor), xyz(pb, height(pb)),
                                xyz(pa, height(pa))], wall))

        for triangle in tessellate_polygon([[v.to_3d() for v in ring]]):
            points = [ring[index] for index in triangle]
            if (points[1]-points[0]).cross(points[2]-points[0]) < 0:
                points.reverse()
            for (lo, _), (hi, _) in zip(profile, profile[1:]):
                clipped = clip(clip(points, lo, -1), hi, 1)
                if len(clipped) >= 3:
                    panels.append(([xyz(p, height(p)) for p in clipped], roof))
        self.panels(name, panels)

    def save(self, render=True):
        vertices, faces = [], []
        for obj in self.objects:
            mesh = obj.data
            mesh.calc_loop_triangles()
            slot_colors = [rgb(m['atlas_swatch']) for m in mesh.materials]
            start = len(vertices)
            vertices.extend([round(v, 4) for v in vertex.co] for vertex in mesh.vertices)
            for tri in mesh.loop_triangles:
                if tri.area < 0.0001:
                    continue
                shade = 0.74 + 0.29 * max(0, tri.normal.dot(LIGHT_DIRECTION))
                color = [int(min(255, round(channel * shade))) for channel in slot_colors[tri.material_index]]
                faces.append([*[start + i for i in tri.vertices],
                              (color[0] << 16) | (color[1] << 8) | color[2]])
        self.data.update(vertices=vertices, faces=faces)
        ident = self.data['id']
        (DEST / f'{ident}.json').write_text(json.dumps(self.data, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf8')
        scene = bpy.context.scene
        scene['atlas_origin'] = self.data['point']
        scene['footprint_osm_ids'] = ', '.join(self.data['replaces'])
        scene['model_references'] = '\n'.join(self.data['sources'])
        self.preview(vertices)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(REVIEW / f'{ident}.blend'))
        if render:
            scene.render.filepath = str(REVIEW / f'{ident}.png')
            bpy.ops.render.render(write_still=True)
        print(f'ATLAS_MODEL {ident} {len(self.objects)} Blender meshes {len(vertices)} vertices {len(faces)} triangles', flush=True)

    def preview(self, vertices):
        scene = bpy.context.scene
        scene.unit_settings.system = 'METRIC'
        heading = math.radians(33)
        centre = Vector([(min(p[i] for p in vertices)+max(p[i] for p in vertices))*0.5 for i in range(3)])
        direction = Vector((-math.sin(heading), -math.cos(heading), math.tan(math.asin(0.56))))
        camera = bpy.data.cameras.new('Atlas 33° projection')
        eye = bpy.data.objects.new(camera.name, camera)
        scene.collection.objects.link(eye)
        eye.location = centre + direction * 170
        eye.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
        camera.type = 'ORTHO'
        camera.clip_end = 1500
        projected = [eye.rotation_euler.to_matrix().transposed() @ (Vector(v)-centre) for v in vertices]
        span = [max(p[i] for p in projected) - min(p[i] for p in projected) for i in range(2)]
        camera.ortho_scale = max(span[0], span[1]*1.45) * 1.17
        scene.camera = eye
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.render.resolution_x = 812
        scene.render.resolution_y = 560
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.film_transparent = False
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'MATERIAL'
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
        scene.display.shading.cavity_type = 'BOTH'
        scene.display.shading.background_type = 'WORLD'
        scene.world = bpy.data.worlds.new('Atlas review world')
        scene.world.color = (0.18, 0.19, 0.15)
        scene.view_settings.view_transform = 'Standard'
        scene.view_settings.exposure = 0.7
        bpy.ops.mesh.primitive_plane_add(size=2000, location=(0, 0, -0.045))
        plane = bpy.context.object
        plane.name = 'Preview ground (outside atlas export)'
        plane.data.materials.append(self.material(('Review neutral', 'a2a797')))


def frame(a, b):
    tangent = (b-a).normalized()
    return tangent, Vector((tangent.y, -tangent.x)), (b-a).length


def wall_point(a, tangent, normal, d, z, offset):
    return xyz(a + tangent*d + normal*offset, z)


def panel(a, tangent, normal, start, stop, sill, top, offset):
    return [wall_point(a, tangent, normal, d, z, offset)
            for d, z in [(start,sill), (stop,sill), (stop,top), (start,top)]]


def arch(a, tangent, normal, mid, width, sill, spring, rise, offset):
    arc = [(mid+math.cos(i*math.pi/8)*width/2, spring+math.sin(i*math.pi/8)*rise) for i in range(9)]
    return [wall_point(a, tangent, normal, d, z, offset)
            for d, z in [(mid-width/2,sill), (mid+width/2,sill), *arc]]


def rectangle(centre, along, across, width, depth):
    return [centre + along*(x*width/2) + across*(y*depth/2)
            for x, y in [(-1,-1), (1,-1), (1,1), (-1,1)]]


def longitudinal_roof(ring, along, proportions, heights):
    across = Vector((-along.y, along.x))
    lo, hi = min(p.dot(across) for p in ring), max(p.dot(across) for p in ring)
    return across, [(lerp(lo, hi, ratio), z) for ratio, z in zip(proportions, heights)]


def trojhali():
    origin = [18.28676, 49.82847]
    hall, power = 'w48214515', 'w48214517'
    model = Model('trojhali', 'Trojhalí Karolina', origin, [hall, power], [
        'https://www.ostravskepamatky.cz/pamatky/14-Elektrarna-koksovny-Karolina-a-elektrocentrala-III-Trojhali?lang=cs_CZ',
        'https://www.casopisstavebnictvi.cz/clanky-nova-karolina-ostrava-trojhali.html',
        'https://encyklopedie.ostrava.cz/home-mmo/?acc=profil-domu&load=95',
    ])
    brick = ('Fired industrial brick', 'a45b40')
    stone = ('Concrete and stone plinth', '978979')
    trim = ('Pale Portland cement lintels', 'ceb28a')
    plaster = ('Ústředna infill plaster', 'd5b792')
    roof = ('Weathered zinc', '777e80')
    pane = ('Dark steel glazing', '3c5153')
    framing = ('Glazing steel', '65726a')
    skylight = ('Ridge glazing', '879893')
    for feature, title, twin in [(hall, 'Dvojhalí', True), (power, 'Ústředna', False)]:
        ring = outline(feature, origin)
        along = Vector((-0.129, 0.992) if twin else (0.992, 0.129)).normalized()
        if twin:
            ratios = [0, .094, .22, .25, .28, .406, .50, .594, .72, .75, .78, .906, 1]
            heights = [11.5, 16.0, 17.2, 18.8, 17.2, 16.0, 11.5, 16.0, 17.2, 18.8, 17.2, 16.0, 11.5]
        else:
            ratios, heights = [0, .50, 1], [10.4, 16.6, 10.4]
        across, profile = longitudinal_roof(ring, along, ratios, heights)
        model.prism(f'{title} · foundation', ring, 0, 1.12, stone)
        model.roofed(f'{title} · brick shell and roof planes', ring, 1.12, across, profile, brick, roof)
        windows, framework, infill = [], [], []
        for a, b in edges(ring):
            tangent, normal, length = frame(a, b)
            if length < 4:
                continue
            gable = abs(tangent.dot(across)) > .8
            if twin and gable:
                # Short facade wall segments are separated by real shallow corner piers.
                count = max(1, round(length/8.9))
            else:
                count = max(1, round(length/(5.1 if twin else 7.4)))
            spacing = length / count
            for j in range(count):
                mid = spacing*(j+.5)
                width = min(spacing*.66, 6.2 if twin and gable else 4.0)
                spring, rise = (8.25, 1.60) if twin and gable else (7.10, 1.32)
                if not twin:
                    infill.append((panel(a,tangent,normal,mid-spacing*.39,mid+spacing*.39,1.35,9.65,.058), plaster))
                windows.append((arch(a,tangent,normal,mid,width+.45,2.10,spring,rise+.23,.085), trim if twin else brick))
                windows.append((arch(a,tangent,normal,mid,width,2.38,spring,rise,.109), pane))
                for delta in [-.24, 0, .24]:
                    c = mid + width*delta
                    framework.append((panel(a,tangent,normal,c-.075,c+.075,2.42,spring,.135), framing))
                for level in [4.28, 6.32, spring]:
                    framework.append((panel(a,tangent,normal,mid-width/2,mid+width/2,level-.07,level+.07,.139), framing))
            framework.append((panel(a,tangent,normal,.02,length-.02,9.98,10.18,.12), trim))
        model.panels(f'{title} · plastered bays', infill)
        model.panels(f'{title} · rolled window arches', windows)
        model.panels(f'{title} · steel mullions and band', framework)
        if twin:
            start, stop = min(p.dot(along) for p in ring), max(p.dot(along) for p in ring)
            for ratio in (.25,.75):
                offset = lerp(profile[0][0], profile[-1][0], ratio)
                centre = along*((start+stop)/2) + across*offset
                # Model the documented elevated, glazed ridge without extending beyond its end gables.
                model.prism('Elevated continuous ridge lantern', rectangle(centre,along,across,stop-start-7,1.35),
                            18.13,19.10,pane,skylight)
        else:
            for a,b in edges(ring):
                tangent, normal, length = frame(a,b)
                if 16 < length < 23 and abs(tangent.dot(along))>.97:
                    # The long north front has a mapped central projecting bay.
                    apex = lerp(a,b,.5) + normal*.135
                    model.panels('Ústředna · triangular risalit pediment', [(
                        [xyz(a+normal*.135,10.15), xyz(b+normal*.135,10.15), xyz(apex,13.0)], brick)])
                    break
    return model


def dum_kultury():
    ident, feature = 'dum-kultury', 'w462286572'
    origin = [18.27261, 49.83114]
    model = Model(ident, 'Dům kultury města Ostravy', origin, [feature], [
        'https://www.ostravskepamatky.cz/pamatky/15-Dum-kultury-mesta-Ostravy?lang=cs_CZ',
        'https://www.dkmoas.cz/60-let/historie/pocatky-ostravskeho-domu-kultury/',
        'https://encyklopedie.ostrava.cz/home-mmo/?acc=profil-domu&load=6',
        'https://moravskoslezsky.kraj.cz/encyklopedie/objekty1.phtml?id=50671',
    ])
    ceramic = ('Warm cream ceramic façade', 'c5b094')
    stone = ('Sandstone crown and travertine columns', 'ddd2b6')
    plinth = ('Darker foundation stone', '938779')
    roof = ('Recessed grey sheet-metal roof', '85867f')
    glazing = ('Recessed blue-green glazing', '4d6667')
    frame_colour = ('Bronze frames', 'a39b82')
    ring = outline(feature, origin)
    height = 14.2
    model.prism('Mapped Fragner cultural house, connected wings', ring, 0, height, ceramic, roof)
    trim, windows, mullions = [], [], []
    for a,b in edges(ring):
        tangent, normal, length = frame(a,b)
        if length < 2.2:
            continue
        for bot, top, offset, material in [(0,1.05,.12,plinth),(12.98,13.18,.13,stone),(13.76,14.30,.18,stone)]:
            trim.append((panel(a,tangent,normal,0,length,bot,top,offset),material))
        if length < 5.1:
            continue
        bays = max(1, round(length/3.35))
        bay = length/bays
        for idx in range(bays):
            mid = (idx+.5)*bay
            for z in [2.1,5.6,9.1]:
                width = min(bay*.61,1.7)
                windows.append((panel(a,tangent,normal,mid-width/2-.12,mid+width/2+.12,z-.13,z+2.30,.042),stone))
                windows.append((panel(a,tangent,normal,mid-width/2,mid+width/2,z,z+2.15,.070),glazing))
                mullions.append((panel(a,tangent,normal,mid-.06,mid+.06,z,z+2.15,.095),frame_colour))
    model.panels('Sandstone cornice and foundations',trim)
    model.panels('Rhythmic window bays and ceramic surrounds',windows)
    model.panels('Bronze window divisions',mullions)

    a,b = max(((a,b) for a,b in edges(ring) if frame(a,b)[1].y < -.82 and lerp(a,b,.5).x < 10),
              key=lambda segment:(segment[1]-segment[0]).length)
    tangent, normal, length = frame(a,b)
    mid = lerp(a,b,.5)
    span = min(32,length*.86)
    model.prism('Travertine portico and deep shadow line', rectangle(mid+normal*.18,tangent,normal,span,.48),
                2.0,13.2,plinth)
    opening_panels = []
    first = (length-span)/2
    for j in range(7):
        left = first + (j+.25)*span/7
        right = first + (j+.75)*span/7
        opening_panels.append((panel(a,tangent,normal,left,right,2.60,12.1,.46),glazing))
        opening_panels.append((panel(a,tangent,normal,left,right,5.28,5.55,.49),frame_colour))
    model.panels('Main entrance glazing',opening_panels)
    for i in range(8):
        pos = mid + tangent*((i/7-.5)*span) + normal*.65
        model.prism('Portico square travertine column',rectangle(pos,tangent,normal,.79,1.05),1.83,13.18,stone)
    model.prism('Portico entablature and attic',rectangle(mid+normal*.53,tangent,normal,span+1.2,1.55),13.02,14.68,stone)
    for i in range(6):
        pos = mid + tangent*((i/5-.5)*span*.80) + normal*.45
        model.prism('Sculpture at the attic edge · plinth',rectangle(pos,tangent,normal,.84,.73),14.62,14.86,plinth)
        model.prism('Sculpture at the attic edge · carved silhouette',rectangle(pos,tangent,normal,.55,.53),14.86,16.08,stone)
        model.prism('Sculpture at the attic edge · head',rectangle(pos+tangent*.06,tangent,normal,.34,.36),16.08,16.41,stone)
    for i in range(4):
        model.prism('Entrance stair', rectangle(mid+normal*(1.12-i*.23),tangent,normal,span+2.0,2.8-i*.47),
                    i*.31,(i+1)*.31,plinth,stone)
    return model


def hrad():
    ident, origin = 'hrad', [18.29965,49.83048]
    north, palace, curtain, annex = 'w52131374','w50015370','w50015371','w192080553'
    model = Model(ident,'Slezskoostravský hrad',origin,[north,palace,curtain,annex], [
        'https://www.slezskoostravskyhrad.cz/',
        'https://www.visitostrava.eu/cz/objevuj/mista/199/slezskoostravsky-hrad.html',
        'https://www.openstreetmap.org/way/52131377',
    ])
    rock = ('Weathered sandstone and rubble', '9c907a')
    light_rock = ('Dressed sandstone parapet', 'b6a98a')
    pale = ('Gatehouse render', 'c4b493')
    tile = ('Clay tile roofs', 'a9654d')
    dark_tile = ('Clay tile, shaded weathering', '955842')
    aperture = ('Heavy oak and deep openings', '51453a')
    for feature,title,z in [(north,'Northern sandstone range',6.8),
                            (curtain,'Eastern curtain and corner towers',6.2),
                            (annex,'Southern outbuilding',4.5)]:
        ring = outline(feature,origin)
        model.prism(title,ring,0,z,rock,light_rock)
        dressings = []
        for a,b in edges(ring):
            tangent,normal,length = frame(a,b)
            if length < 5:
                continue
            dressings.append((panel(a,tangent,normal,.10,length-.10,z-.42,z,.09),light_rock))
            for i in range(1,max(2,round(length/5.2))):
                mid = length*i/max(2,round(length/5.2))
                dressings.append((panel(a,tangent,normal,mid-.21,mid+.21,z-1.74,z-.64,.12),aperture))
        model.panels(f'{title} · upper stone course and slots', dressings)

    ring = outline(palace,origin)
    tangent = Vector((.953,-.303)).normalized()
    across, profile = longitudinal_roof(ring,tangent,[0,.11,.50,.89,1],[7.0,8.44,12.8,8.44,7.0])
    model.roofed('Western castle range and pitched tile roof',ring,0,across,profile,pale,tile)
    opens = []
    for a,b in edges(ring):
        along,norm,length = frame(a,b)
        if length < 6:
            continue
        count = max(1,round(length/5.7))
        for j in range(count):
            m = length*(j+.5)/count
            opens.append((arch(a,along,norm,m,1.53,3.72,5.34,.65,.063),light_rock))
            opens.append((arch(a,along,norm,m,1.10,3.96,5.21,.47,.085),aperture))
    model.panels('Western range · deep arched windows',opens)

    # Gate tower sits over the mapped northwestern masonry range, away from the open courtyard.
    centre = Vector(((18.299407-origin[0])*METRES_EAST,(49.830724-origin[1])*METRES_NORTH))
    tangent = Vector((.919,-.394)).normalized()
    axis = Vector((-tangent.y,tangent.x))
    tower = clean_ring(rectangle(centre,tangent,axis,9.35,7.45))
    across, profile = longitudinal_roof(tower,tangent,[0,.50,1],[13.0,17.1,13.0])
    model.roofed('Whitewashed gatehouse tower and burnt clay roof',tower,6.30,across,profile,pale,dark_tile)
    details = []
    for a,b in edges(tower):
        along,norm,length = frame(a,b)
        details.append((arch(a,along,norm,length/2,1.55,9.65,11.23,.61,.071),light_rock))
        details.append((arch(a,along,norm,length/2,1.07,9.86,11.14,.49,.09),aperture))
    model.panels('Gatehouse tower · tall apertures',details)

    # Mark only the small geometry at the ends of the mapped curtain, keeping both courts open.
    special = [(18.300291,49.830640,6.1,7.5,9.0),(18.300137,49.829992,4.2,5.3,8.25)]
    for lo,la,w,d,h in special:
        centre = Vector(((lo-origin[0])*METRES_EAST,(la-origin[1])*METRES_NORTH))
        model.prism('Fortified corner · cap',rectangle(centre,tangent,axis,w,d),6.0,h,rock,light_rock)
    return model


if __name__ == '__main__':
    for build in (trojhali, dum_kultury, hrad):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        build().save(render='--meshes-only' not in sys.argv)
