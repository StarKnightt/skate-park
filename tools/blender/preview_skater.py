"""Render close-up previews of the built skater .blend (rest pose or a given action/frame).
blender -b <skater.blend> --python preview_skater.py -- <out_dir> [action frame]
"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
action = argv[1] if len(argv) > 1 else None
frame = int(argv[2]) if len(argv) > 2 else 1
os.makedirs(out, exist_ok=True)
scene = bpy.context.scene
arm = bpy.data.objects["Skater_Rig"]
for t in arm.animation_data.nla_tracks:
    t.mute = True
if action:
    arm.animation_data.action = bpy.data.actions[action]
    try:
        arm.animation_data.action_slot = bpy.data.actions[action].slots[0]
    except Exception:
        pass
    scene.frame_set(frame)
    arm.data.pose_position = "POSE"
else:
    arm.data.pose_position = "REST"
for o in list(scene.objects):
    if o.type in ("CAMERA", "LIGHT"):
        bpy.data.objects.remove(o, do_unlink=True)
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 640, 800
w = scene.world
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.93, 0.86, 0.76, 1); bg.inputs[1].default_value = 0.8
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
scene.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
# blender coords: front of character is -Y
shots = {
    "front": ((0, -4.6, 1.0), (0, 0, 0.92), 34),
    "side": ((4.6, 0, 1.0), (0, 0, 0.92), 34),
    "back": ((0.4, 4.6, 1.2), (0, 0, 0.92), 34),
    "face": ((0.10, -0.62, 1.68), (0, 0, 1.655), 55),
    "face34": ((0.38, -0.50, 1.70), (0, 0, 1.655), 55),
    "feet": ((0.45, -0.95, 0.35), (0.10, 0, 0.07), 45),
    "hand": ((0.98, -0.42, 1.36), (0.80, 0, 1.40), 55),
}
sel = argv[3].split(",") if len(argv) > 3 else list(shots.keys())
tag = (action + "_%d_" % frame) if action else ""
for name in sel:
    pos, tgt, lens = shots[name]
    cam.location = pos
    cam.data.lens = lens
    d = Vector(tgt) - Vector(pos)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(out, "skater_" + tag + name + ".png")
    bpy.ops.render.render(write_still=True)
    print("saved", scene.render.filepath)
