"""Import the Mixamo reference skeleton (Bryce) and dump bone positions in metres (glTF/three.js axes: Y-up, character faces +Z).
Run: blender -b --factory-startup --threads 4 --python dump_skeleton.py -- <bryce.fbx> <out.json>
"""
import bpy, sys, json
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=False, ignore_leaf_bones=False)

arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
print("armature", arm.name, "scale", tuple(arm.scale), "rot", tuple(arm.rotation_euler))
mw = arm.matrix_world
# Blender Z-up (-Y forward for imported FBX) -> glTF Y-up: (x, y, z) -> (x, z, -y)
def to_gltf(v):
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]

bones = {}
for b in arm.data.bones:
    h = mw @ b.head_local
    t = mw @ b.tail_local
    bones[b.name] = {
        "head": to_gltf(h), "tail": to_gltf(t),
        "parent": b.parent.name if b.parent else None,
    }
meshes = [o.name for o in bpy.context.scene.objects if o.type == 'MESH']
# Mesh bounds for reference proportions
mins = [1e9] * 3; maxs = [-1e9] * 3
for o in bpy.context.scene.objects:
    if o.type != 'MESH':
        continue
    for v in o.data.vertices:
        w = to_gltf(o.matrix_world @ v.co)
        for i in range(3):
            mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
json.dump({"bones": bones, "meshes": meshes, "mesh_min": mins, "mesh_max": maxs,
           "armature_scale": list(arm.scale)}, open(out, "w"), indent=1)
print("wrote", out, len(bones), "bones; mesh bounds", mins, maxs)
