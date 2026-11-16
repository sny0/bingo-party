"""Build the wooden garapon assets with Blender 2.93+.

Run from the repo: blender -b --python-exit-code 4 -P scripts/export-machine.py
Convert .local/garagara-poster.png to assets/garagara-poster.webp after rendering.
"""

from math import cos, pi, sin
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


root = Path(__file__).resolve().parents[1]
assets = root / 'assets'
staging = root / '.local'
assets.mkdir(exist_ok=True)
staging.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
drum_center = (0, 0, 1.56)


def material(name, rgb, roughness, metalness=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*rgb, 1)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = metalness
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def wood_material():
    mat = material('Clear lacquer over birch', (.51, .31, .15), .40)
    # In a small repeating texture, shallow bends and several grain widths
    # read as planed wood without dominating the outline.
    x, y = np.meshgrid(np.arange(512) / 512, np.arange(512) / 512)
    warp = y + .0035 * np.sin(2*pi*x + 5*y) + .002 * np.sin(4*pi*x + 19*y)
    fine = np.sin(2*pi * (82*warp + .25*np.sin(27*warp)))
    grain = .015*fine + .011*np.sin(2*pi*35*warp) + .010*np.sin(2*pi*12*warp)
    grain += np.random.default_rng(72).normal(0, .004, grain.shape)
    color = np.ones((512, 512, 4), dtype=np.float32)
    color[:, :, :3] = np.array([.70, .514, .335]) + grain[:, :, None]
    bitmap = bpy.data.images.new('Birch grain', width=512, height=512, alpha=False)
    bitmap.pixels.foreach_set(color.ravel())
    bitmap.update()
    bitmap.pack()
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = bitmap
    mat.node_tree.links.new(tex.outputs['Color'], mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    return mat


wood = wood_material()
red_lacquer = material('Satin red lacquer', (.235, .015, .028), .37)
dark_lacquer = material('Red lacquer edge', (.16, .011, .021), .42)
steel = material('Brushed steel fittings', (.61, .63, .65), .26, .83)
dark = material('Chute interior', (.032, .023, .016), .52)
tray_white = material('Off-white tray', (.85, .83, .75), .35)
felt = material('Wine red felt', (.16, .012, .023), .89)
arrow_ivory = material('Ivory rotation arrow', (.85, .63, .37), .60)


def finish(obj, name, mat, bevel=0, smooth=False):
    obj.name = name
    obj.data.materials.append(mat)
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bevel:
        mod = obj.modifiers.new('Eased edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        if bpy.app.version < (4, 1, 0):
            obj.data.use_auto_smooth = True
        obj.modifiers.new('Face normals', 'WEIGHTED_NORMAL').keep_sharp = True
    return obj


def mesh(name, vertices, faces, mat, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    return finish(obj, name, mat, bevel)


def wood_uv(obj):
    # Keep a consistent grain direction on each broad face. Scale in model
    # units so the knob, boards and disc all have believable grain widths.
    layer = obj.data.uv_layers.active or obj.data.uv_layers.new(name='Grain')
    for face in obj.data.polygons:
        axis = max(range(3), key=lambda index: abs(face.normal[index]))
        for index in face.loop_indices:
            x, y, z = obj.data.vertices[obj.data.loops[index].vertex_index].co
            u, v = ((y, z), (x, z), (x, y))[axis]
            layer.data[index].uv = (u / 2.55 + .5, v / 2.55 + .5)
    return obj


def block(name, size, location, mat, bevel=.018):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, name, mat, bevel)
    return wood_uv(obj) if mat == wood else obj


def cylinder(name, start, end, radius, mat, bevel=.008, sides=40):
    a, b = Vector(start), Vector(end)
    delta = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=delta.length, location=(a+b)/2)
    obj = bpy.context.object
    obj.rotation_euler = delta.to_track_quat('Z','Y').to_euler()
    return finish(obj, name, mat, bevel, sides > 8)


def octagon(name, radius, back, front, mat, bevel):
    vertices = [(radius*cos(pi/8 + i*pi/4), y, radius*sin(pi/8 + i*pi/4))
                for y in (front, back) for i in range(8)]
    walls = [(i, i+8, (i+1)%8+8, (i+1)%8) for i in range(8)]
    obj = mesh(name, vertices, [tuple(range(8)), tuple(reversed(range(8,16))), *walls], mat, bevel)
    obj.location = drum_center
    return wood_uv(obj) if mat == wood else obj


def empty(name, location):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.location = location
    return obj


def attach(obj, parent):
    matrix = obj.matrix_basis.copy()
    obj.parent = parent
    obj.matrix_basis = parent.matrix_basis.inverted() @ matrix


# The support is behind the drum, as on a tabletop raffle machine.
block('Birch base', (2.48, 1.52, .18), (0, -.20, .095), wood, .026)
block('Rear bearing support', (.37, .27, 1.45), (0, .39, .85), wood, .028)
block('Rear support foot', (.64,.52,.10), (0,.33,.222), wood, .022)
cylinder('Stationary axle', (0, .56, 1.56), (0, -.401, 1.56), .068, steel)
cylinder('Front bearing flange', (0, -.35, 1.56), (0, -.392, 1.56), .174, steel)
cylinder('Center spindle cap', (0, -.392, 1.56), (0, -.442, 1.56), .080, steel, .014)
for i in range(3):
    angle = i*2*pi/3 + pi/2
    x, z = .124*cos(angle), 1.56+.124*sin(angle)
    cylinder('Bearing fastener', (x,-.392,z), (x,-.403,z), .023, steel, .006, 24)

drum = empty('Drum', drum_center)
crank = empty('Crank', drum_center)
for part in (
    octagon('Shallow octagonal drum', 1.073, .25, -.288, red_lacquer, .023),
    octagon('Front ply edge', 1.076, -.247, -.302, dark_lacquer, .008),
    octagon('Lacquered front face', 1.062, -.291, -.337, red_lacquer, .016),
    octagon('Rear ply edge', 1.072, .258, .206, dark_lacquer, .009),
):
    attach(part, drum)

top = 1.56+1.073*cos(pi/8)
attach(block('Refill hatch', (.64,.32,.023), (0,-.04,top+.008), red_lacquer, .008), drum)
for x in (-.23,.23):
    for y in (-.145,.064):
        attach(cylinder('Refill screw', (x,y,top+.019), (x,y,top+.028), .022, steel, .005, 20), drum)

# A small knob on the wooden face turns together with the drum.
knob_x, knob_z = -.36, .91
attach(cylinder('Knob washer', (knob_x,-.329,knob_z), (knob_x,-.375,knob_z), .092, steel), crank)
attach(cylinder('Birch turning knob', (knob_x,-.365,knob_z), (knob_x,-.599,knob_z), .111, wood, .056), crank)
attach(cylinder('Knob screw', (knob_x,-.598,knob_z), (knob_x,-.612,knob_z), .030, steel, .005, 24), crank)

# The front face carries a small, flat direction arrow.
outer, inner = .636, .60
arc = [pi*.64 - step*.028 for step in range(12)]
points = [(r*cos(a), -.341, 1.56+r*sin(a)) for r in (outer, inner) for a in arc]
faces = [(i, i+12, i+13, i+1) for i in range(11)]
arrow = mesh('Direction arrow shaft', points, faces, arrow_ivory)
attach(arrow, drum)
end = arc[-1]
attach(mesh('Direction arrow tip', [
    (.565*cos(end+.014), -.341, 1.56+.565*sin(end+.014)),
    (.673*cos(end+.014), -.341, 1.56+.673*sin(end+.014)),
    (.617*cos(end-.155), -.341, 1.56+.617*sin(end-.155)),
], [(0,2,1)], arrow_ivory), drum)

# A short lip at the lower rim feeds a rectangular, felt-lined tray.
port_x, port_y = .16, -.270
bottom = 1.56-1.073*cos(pi/8)
attach(cylinder('Discharge lip', (port_x,port_y,bottom+.014), (port_x,port_y,bottom-.051), .103, steel, .012), drum)
attach(cylinder('Discharge opening', (port_x,port_y,bottom-.050), (port_x,port_y,bottom-.054), .079, dark, .003), drum)


def rounded_rectangle(half_x, half_y, radius, y_center):
    points = []
    for angle, dx, dy in [(0,1,1),(pi/2,-1,1),(pi,-1,-1),(3*pi/2,1,-1)]:
        for step in range(7):
            a = angle + step*pi/12
            points.append((dx*(half_x-radius)+radius*cos(a), y_center+dy*(half_y-radius)+radius*sin(a)))
    return points


tray_center = -.527
outer_bottom = rounded_rectangle(.90,.291,.14,tray_center)
outer_top = rounded_rectangle(.995,.359,.18,tray_center)
inner_top = rounded_rectangle(.953,.320,.15,tray_center)
inner_bottom = rounded_rectangle(.867,.253,.12,tray_center)
rings = [outer_bottom,outer_top,inner_top,inner_bottom]
heights = [.184,.348,.345,.229]
count = len(outer_top)
vertices = [(x,y,heights[k]) for k, ring in enumerate(rings) for x,y in ring]
faces = [tuple(reversed(range(count))), tuple(range(3*count,4*count))]
for k in range(3):
    for i in range(count):
        j = (i+1)%count
        faces.append((k*count+i, k*count+j, (k+1)*count+j, (k+1)*count+i))
mesh('Shallow moulded catch tray', vertices, faces, tray_white, .014)
liner = rounded_rectangle(.861,.247,.116,tray_center)
mesh('Felt liner', [(x,y,.231) for x,y in liner], [tuple(range(len(liner)))], felt)

exit_point = empty('BallExit', (port_x, port_y, bottom-.080))
rest_point = empty('BallRest', (.23, -.572, .318))

bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
    if obj.type == 'MESH' or obj in (drum, crank, exit_point, rest_point):
        obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(assets / 'garagara.glb'),
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_animations=False,
)

# Render the same machine without a drawn ball for the no-WebGL view.
bpy.ops.object.camera_add(location=(3.25,-8.6,3.62))
camera = bpy.context.object
camera.rotation_euler = (Vector((0,-.14,1.31))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 4.3
scene.camera = camera


def area(location, target, power, size, color):
    bpy.ops.object.light_add(type='AREA', location=location)
    lamp = bpy.context.object
    lamp.rotation_euler = (Vector(target)-lamp.location).to_track_quat('-Z','Y').to_euler()
    lamp.data.energy = power
    lamp.data.shape = 'DISK'
    lamp.data.size = size
    lamp.data.color = color


area((-3.5,-4.8,6.2), (0,0,1), 700, 4.6, (1,.92,.81))
area((4.6,-2,3.8), (0,0,1), 240, 4.0, (.83,.90,1))
area((.4,3.2,5.5), (0,0,1), 660, 3.2, (1,.77,.61))
scene.world = bpy.data.worlds.new('Studio ambient')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.36,.38,.41,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .5
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 804
scene.render.resolution_y = 603
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = str(staging / 'garagara-poster.png')
scene.render.threads_mode = 'FIXED'
scene.render.threads = 8
scene.view_settings.view_transform = 'Filmic'
bpy.ops.render.render(write_still=True)
