"""Render close-up previews of the built skater .blend in the rest pose and/or posed on clip frames.
blender -b <skater.blend> --python preview_skater.py -- <out_dir> [pose ...]
pose: "rest" or "<action>:<frame>[:shot,shot]" (default shots: all for rest, front,side,face34 for clips)
      or "curl=<0..1>[:shot,shot]": rest pose with the runtime finger pose of src/player/skater.ts applyFingers
      (1 = relaxed curl, 0 = open and spread); default shots handback,handpalm,handside
"""
import bpy, sys, os, math
from mathutils import Vector, Quaternion

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
w = scene.world or bpy.data.worlds.new("w")
scene.world = w
w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.93, 0.86, 0.76, 1); bg.inputs[1].default_value = 0.8
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0
SUN_TOP = (math.radians(50), 0, math.radians(-30))
SUN_LOW = (math.radians(140), 0, math.radians(-30))   # from below, for palm views
scene.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
# blender coords: front of character is -Y; targets follow the hips for posed shots
# name: (camera, target, lens[, resolution, sun])
HL, HR = (0.815, 0.005, 1.395), (-0.815, 0.005, 1.395)
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
    "handback": ((0.90, 0.10, 1.66), HL, 50, (960, 640), SUN_TOP),
    "handpalm": ((0.90, -0.08, 1.12), HL, 50, (960, 640), SUN_LOW),
    "handside": ((0.86, -0.30, 1.43), HL, 50, (960, 640), SUN_TOP),
    "handbackR": ((-0.90, 0.10, 1.66), HR, 50, (960, 640), SUN_TOP),
    "handpalmR": ((-0.90, -0.08, 1.12), HR, 50, (960, 640), SUN_LOW),
}
FINGERS = ("Index", "Middle", "Ring", "Pinky")
AX_Y, AX_Z = Vector((0, 0, 1)), Vector((0, -1, 0))   # three.js model +Y / +Z in blender armature space


def lerp(a, b, t):
    return a + (b - a) * t


def rot(pb, ax, ang):
    return Quaternion(pb.bone.matrix_local.to_3x3().inverted() @ ax, ang)


def finger_pose(curl):
    """same rotations as skater.ts applyFingers(curl), about the model axes in each bone's rest frame"""
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    for side, s in (("Left", 1.0), ("Right", -1.0)):
        for f, name in enumerate(FINGERS):
            for j in (1, 2, 3):
                pb = arm.pose.bones.get("mixamorig:%sHand%s%d" % (side, name, j))
                if not pb:
                    continue
                relaxed = 0.3 + f * 0.07 if j == 1 else (0.55 + f * 0.05 if j == 2 else 0.42 + f * 0.04)
                c = lerp(0.06 if j == 2 else 0.03, relaxed, curl)
                q = Quaternion()
                if j == 1:
                    sp = lerp([0.16, 0.05, -0.06, -0.17][f], [-0.03, 0, 0.03, 0.06][f], curl)
                    q = q @ rot(pb, AX_Y, -s * sp)
                pb.rotation_quaternion = q @ rot(pb, AX_Z, -s * c)
        for j in (1, 2, 3):
            pb = arm.pose.bones.get("mixamorig:%sHandThumb%d" % (side, j))
            if pb:
                pb.rotation_quaternion = rot(pb, AX_Y, s * lerp(-0.18, 0.25, curl)) if j == 1 else rot(pb, AX_Z, -s * lerp(0.0, 0.22, curl))


for spec in poses:
    bits = spec.split(":")
    if bits[0] == "rest":
        arm.data.pose_position = "REST"
        sel = bits[1].split(",") if len(bits) > 1 else list(shots.keys())
        tag, off = "rest_", Vector((0, 0, 0))
    elif bits[0].startswith("curl="):
        curl = float(bits[0][5:])
        arm.animation_data.action = None
        arm.data.pose_position = "POSE"
        finger_pose(curl)
        sel = bits[1].split(",") if len(bits) > 1 else ["handback", "handpalm", "handside"]
        tag, off = "curl%s_" % bits[0][5:], Vector((0, 0, 0))
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
        pos, tgt, lens, *extra = shots[name]
        res = extra[0] if extra else (640, 800)
        scene.render.resolution_x, scene.render.resolution_y = res
        sun.rotation_euler = extra[1] if len(extra) > 1 else SUN_TOP
        cam.location = Vector(pos) + off
        cam.data.lens = lens
        d = (Vector(tgt) + off) - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(out, "skater_" + tag + name + ".png")
        bpy.ops.render.render(write_still=True)
        print("saved", scene.render.filepath)
