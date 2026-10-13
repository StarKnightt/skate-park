"""Render close-up previews of the built skater .blend in the rest pose and/or posed on clip frames.
blender -b <skater.blend> --python preview_skater.py -- <out_dir> [pose ...]
pose: "rest" or "<action>:<frame>[:shot,shot]" (default shots: all for rest, front,side,face34 for clips)
"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
poses = argv[1:] or ["rest"]
os.makedirs(out, exist_ok=True)
scene = bpy.context.scene
arm = bpy.data.objects["Skater_Rig"]
for t in arm.animation_data.nla_tracks:
    t.mute = True
for o in list(scene.objects):
    if o.type in ("CAMERA", "LIGHT"):
        bpy.data.objects.remove(o, do_unlink=True)
try:
    scene.render.engine = "BLENDER_EEVEE"
except TypeError as e:
    print("engine", e)
scene.render.resolution_x, scene.render.resolution_y = 640, 800
w = scene.world or bpy.data.worlds.new("w")
scene.world = w
w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.93, 0.86, 0.76, 1); bg.inputs[1].default_value = 0.8
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
scene.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
# blender coords: front of character is -Y; targets follow the hips for posed shots
shots = {
    "front": ((0, -4.6, 1.0), (0, 0, 0.92), 34),
    "side": ((4.6, 0, 1.0), (0, 0, 0.92), 34),
    "back": ((0.4, 4.6, 1.2), (0, 0, 0.92), 34),
    "face": ((0.10, -0.62, 1.68), (0, 0, 1.655), 55),
    "face34": ((0.38, -0.50, 1.70), (0, 0, 1.655), 55),
    "headback": ((-0.30, 0.62, 1.78), (0, 0, 1.64), 55),
    "feet": ((0.45, -0.95, 0.35), (0.10, 0, 0.07), 45),
    "hand": ((0.98, -0.42, 1.36), (0.80, 0, 1.40), 55),
    "arm": ((0.55, -1.25, 1.45), (0.52, 0, 1.40), 50),
}
for spec in poses:
    bits = spec.split(":")
    if bits[0] == "rest":
        arm.data.pose_position = "REST"
        sel = bits[1].split(",") if len(bits) > 1 else list(shots.keys())
        tag, off = "rest_", Vector((0, 0, 0))
    else:
        act = bpy.data.actions[bits[0]]
        arm.animation_data.action = act
        try:
            arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
        arm.data.pose_position = "POSE"
        scene.frame_set(int(bits[1]))
        sel = bits[2].split(",") if len(bits) > 2 else ["front", "side", "face34"]
        hips = arm.matrix_world @ arm.pose.bones["mixamorig:Hips"].head
        off = Vector((hips.x, hips.y, 0))
        tag = "%s_%s_" % (bits[0], bits[1])
    bpy.context.view_layer.update()
    for name in sel:
        pos, tgt, lens = shots[name]
        cam.location = Vector(pos) + off
        cam.data.lens = lens
        d = (Vector(tgt) + off) - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(out, "skater_" + tag + name + ".png")
        bpy.ops.render.render(write_still=True)
        print("saved", scene.render.filepath)
