"""Assemble, rig and export the skater GLB.

blender -b --factory-startup --threads 4 --python build_skater.py -- <config.json>

config: { "bryce": fbx, "parts_dir": dir with *.obj + parts.json, "face_png": png,
          "anims": [[name, fbx], ...], "out_glb": path, "preview_dir": dir }
Raw Mixamo FBX are only read here; the output GLB bakes the skeleton + clips into the product.
"""
import bpy, bmesh, sys, json, os, math
from mathutils import Vector, Matrix

cfg = json.load(open(sys.argv[sys.argv.index("--") + 1:][0]))
LOG = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30


def select_only(objs, active=None):
    for o in list(scene.objects):
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


# ------------------------------------------------------------------ skeleton (Bryce rest pose)
bpy.ops.import_scene.fbx(filepath=cfg["bryce"], automatic_bone_orientation=False, ignore_leaf_bones=False)
arm = next(o for o in scene.objects if o.type == "ARMATURE")
for o in [o for o in scene.objects if o.type != "ARMATURE"]:
    bpy.data.objects.remove(o, do_unlink=True)
if arm.animation_data:
    arm.animation_data_clear()
select_only([arm])
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
arm.name = "Skater_Rig"
arm.data.name = "Skater_Rig"
for b in arm.data.bones:
    b.use_deform = not (b.name.endswith("_End") or b.name[-1] == "4" and "Hand" in b.name)
log("armature bones", len(arm.data.bones), "scale", tuple(arm.scale))

# ------------------------------------------------------------------ parts
parts = json.load(open(os.path.join(cfg["parts_dir"], "parts.json")))
mat_vc = bpy.data.materials.new("Skater_VC")
mat_vc.use_nodes = True
nt = mat_vc.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
ca = nt.nodes.new("ShaderNodeVertexColor")
ca.layer_name = "Col"
nt.links.new(ca.outputs[0], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.8

mat_face = bpy.data.materials.new("Skater_Face")
mat_face.use_nodes = True
nt = mat_face.node_tree
bsdf2 = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
tex = nt.nodes.new("ShaderNodeTexImage")
img = bpy.data.images.load(cfg["face_png"])
img.pack()
tex.image = img
nt.links.new(tex.outputs[0], bsdf2.inputs["Base Color"])
bsdf2.inputs["Roughness"].default_value = 0.8

S_FACE, YC_FACE = 0.26, 1.640
objs = []
for p in parts:
    path = os.path.join(cfg["parts_dir"], p["name"] + ".obj")
    before = set(scene.objects)
    bpy.ops.wm.obj_import(filepath=path)
    o = [x for x in scene.objects if x not in before][0]
    o.name = p["name"]
    me = o.data
    # bake the importer's axis conversion into the vertices (local == world for weighting / transfer)
    select_only([o])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # light relax then decimate to target
    mod = o.modifiers.new("smooth", "SMOOTH"); mod.factor = 0.5; mod.iterations = 2
    bpy.ops.object.modifier_apply(modifier=mod.name)
    ratio = min(1.0, p["target_tris"] / max(1, len(me.polygons)))
    mod = o.modifiers.new("dec", "DECIMATE"); mod.ratio = ratio; mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for poly in me.polygons:
        poly.use_smooth = True
    # colour attribute (linear float)
    lin = [srgb_to_lin(c) for c in hex_rgb(p["color"])] + [1.0]
    attr = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    for d in attr.data:
        d.color = lin
    me.color_attributes.active_color = attr
    me.materials.clear()
    if p["material"] == "face":
        me.materials.append(mat_face)
        uv = me.uv_layers.new(name="UVMap")
        # Blender world (x, y, z) -> glTF (x, z, -y): glTF y = blender z; the OBJ importer may leave
        # the axis conversion on the object transform, so always work in world space
        mw = o.matrix_world
        nm = mw.to_3x3()
        for poly in me.polygons:
            for li in poly.loop_indices:
                v = me.vertices[me.loops[li].vertex_index]
                cw = mw @ v.co
                nw = (nm @ v.normal).normalized()
                x, yb = cw.x, cw.z
                if nw.y > 0.10:  # facing backwards (blender -Y is front)
                    uv.data[li].uv = (0.5, 0.03)
                else:
                    uv.data[li].uv = (0.5 + x / S_FACE, 0.5 + (yb - YC_FACE) / S_FACE)
    else:
        me.materials.append(mat_vc)
    log("part", p["name"], "tris", len(me.polygons))
    objs.append(o)

# ------------------------------------------------------------------ weights via a watertight proxy
select_only(objs)
bpy.ops.object.duplicate()
dups = list(bpy.context.selected_objects)
select_only(dups, dups[0])
bpy.ops.object.join()
proxy = bpy.context.view_layer.objects.active
proxy.name = "proxy"
mod = proxy.modifiers.new("rm", "REMESH"); mod.mode = "VOXEL"; mod.voxel_size = 0.0032
select_only([proxy]); bpy.ops.object.modifier_apply(modifier=mod.name)
n0 = len(proxy.data.polygons)
mod = proxy.modifiers.new("dec", "DECIMATE"); mod.ratio = min(1.0, 70000 / max(1, n0))
bpy.ops.object.modifier_apply(modifier=mod.name)
log("proxy faces", n0, "->", len(proxy.data.polygons))
# weights must be computed against the rest pose (the FBX import leaves a pose on the bones)
for pb in arm.pose.bones:
    pb.location = (0, 0, 0)
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.scale = (1, 1, 1)
arm.data.pose_position = "REST"
bpy.context.view_layer.update()
select_only([proxy, arm], arm)
proxy.select_set(True)
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
log("proxy vgroups", len(proxy.vertex_groups))

for o in objs:
    select_only([o])
    dt = o.modifiers.new("dt", "DATA_TRANSFER")
    dt.object = proxy
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"
    dt.layers_vgroup_select_src = "ALL"
    dt.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.datalayout_transfer(modifier=dt.name)
    bpy.ops.object.modifier_apply(modifier=dt.name)

# head-only parts: rigid to the head bone (cap, hair, head above neck)
def rigid_to(o, bone, cond=None):
    vg_target = o.vertex_groups.get(bone) or o.vertex_groups.new(name=bone)
    for v in o.data.vertices:
        if cond and not cond(v):
            continue
        for g in list(v.groups):
            o.vertex_groups[g.group].remove([v.index])
        vg_target.add([v.index], 1.0, "REPLACE")


H = "mixamorig:Head"
for o in objs:
    if o.name in ("cap", "hair"):
        rigid_to(o, H)

bpy.data.objects.remove(proxy, do_unlink=True)
arm.data.pose_position = "POSE"

# ------------------------------------------------------------------ join + skin
select_only(objs, next(o for o in objs if o.name == "tee"))
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "Skater"
body.data.name = "Skater"
for uvl in body.data.uv_layers:
    uvl.active = True
    uvl.active_render = True
log("uv layers", [(u.name, u.active_render) for u in body.data.uv_layers])
select_only([body])
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
body.parent = arm
am = body.modifiers.get("Armature") or body.modifiers.new("Armature", "ARMATURE")
am.object = arm
log("body tris", len(body.data.polygons), "verts", len(body.data.vertices), "vgroups", len(body.vertex_groups))
# weight sanity check at known body locations (blender coords: x, -z_gltf, y_gltf)
_names = {g.index: g.name for g in body.vertex_groups}
for tgt, want in [((0.6, 0.0, 1.42), "ForeArm"), ((0.35, 0.0, 1.42), "Arm"), ((0.14, 0.0, 0.3), "Leg"), ((0.0, 0.0, 1.65), "Head"),
                  ((0.0, 0.0, 1.2), "Spine"), ((0.11, 0.0, 0.7), "UpLeg")]:
    t = Vector(tgt)
    best = min(body.data.vertices, key=lambda v: ((body.matrix_world @ v.co) - t).length)
    ws = sorted([(_names[g.group].replace("mixamorig:", ""), round(g.weight, 2)) for g in best.groups], key=lambda x: -x[1])[:3]
    log("weights", tgt, want, ws, "OK" if ws and want in ws[0][0] else "SUSPICIOUS")

# ------------------------------------------------------------------ animations
def action_fcurves(act):
    if hasattr(act, "fcurves") and act.fcurves is not None:
        try:
            return list(act.fcurves)
        except Exception:
            pass
    out = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for cb in getattr(strip, "channelbags", []):
                out.extend(cb.fcurves)
    return out


if not arm.animation_data:
    arm.animation_data_create()
for name, fbx in cfg["anims"]:
    before_objs = set(scene.objects)
    before_acts = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=fbx, automatic_bone_orientation=False, ignore_leaf_bones=False)
    new_acts = [a for a in bpy.data.actions if a not in before_acts]
    if not new_acts:
        log("NO ACTION in", fbx)
        continue
    act = max(new_acts, key=lambda a: len(action_fcurves(a)))
    act.name = name
    act.use_fake_user = True
    for fc in action_fcurves(act):
        if fc.data_path.endswith(".location"):
            for kp in fc.keyframe_points:
                kp.co.y *= 0.01
                kp.handle_left.y *= 0.01
                kp.handle_right.y *= 0.01
            if "Hips" in fc.data_path:
                log("  hips loc", name, fc.array_index, round(fc.keyframe_points[0].co.y, 3), round(fc.keyframe_points[-1].co.y, 3))
    for o in [o for o in scene.objects if o not in before_objs]:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in new_acts:
        if a is not act:
            bpy.data.actions.remove(a)
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    fr = act.frame_range
    strip = track.strips.new(name, int(fr[0]), act)
    if hasattr(strip, "action_slot") and len(getattr(act, "slots", [])):
        try:
            strip.action_slot = act.slots[0]
        except Exception as e:
            log("slot assign failed", e)
    track.mute = False
    log("anim", name, "frames", tuple(fr), "fcurves", len(action_fcurves(act)))
arm.animation_data.action = None

# ------------------------------------------------------------------ previews (EEVEE)
def preview():
    pd = cfg.get("preview_dir")
    if not pd:
        return
    os.makedirs(pd, exist_ok=True)
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError as e:
        log("engine", e)
    scene.render.resolution_x, scene.render.resolution_y = 720, 960
    scene.render.film_transparent = False
    w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.95, 0.85, 0.72, 1); bg.inputs[1].default_value = 0.9
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    shots = [("front", (0, -4.2, 1.0), 0, 30), ("side", (4.2, 0, 1.0), 90, 30), ("back", (0, 4.2, 1.0), 180, 30),
             ("face", (0.25, -0.75, 1.66), 0, 50), ("feet", (0.5, -1.2, 0.3), 0, 50), ("hand", (0.95, -0.55, 1.45), 0, 50)]
    targets = {"front": (0, 0, 0.95), "side": (0, 0, 0.95), "back": (0, 0, 0.95), "face": (0, 0, 1.655), "feet": (0.16, 0, 0.08),
               "hand": (0.78, 0, 1.41)}
    for name, pos, _, lens in shots:
        cam.location = pos
        cam.data.lens = lens
        d = Vector(targets[name]) - Vector(pos)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(pd, "skater_" + name + ".png")
        bpy.ops.render.render(write_still=True)
        log("preview", scene.render.filepath)


try:
    preview()
except Exception as e:
    log("preview failed", e)

# ------------------------------------------------------------------ export
select_only([arm, body], arm)
props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
opts = dict(filepath=cfg["out_glb"], export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
            export_texcoords=True, export_normals=True, export_materials="EXPORT", export_skins=True,
            export_animations=True, export_morph=False, export_lights=False, export_cameras=False)
extra = dict(export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_def_bones=True,
             export_rest_position_armature=True, export_optimize_animation_size=True, export_vertex_color="ACTIVE",
             export_all_vertex_colors=False, export_image_format="AUTO", export_anim_slide_to_zero=True,
             export_reset_pose_bones=True, export_bake_animation=False)
for k, v in extra.items():
    if k in props:
        opts[k] = v
opts = {k: v for k, v in opts.items() if k in props or k == "filepath"}
log("export opts", sorted(opts.keys()))
bpy.ops.export_scene.gltf(**opts)
log("exported", cfg["out_glb"], os.path.getsize(cfg["out_glb"]))
if cfg.get("blend_out"):
    bpy.ops.wm.save_as_mainfile(filepath=cfg["blend_out"])
open(os.path.join(os.path.dirname(cfg["out_glb"]), "build_skater.log"), "w").write("\n".join(LOG))
