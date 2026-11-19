extends Node3D

# Original multipart voxel rig. Forward -Z, Y up, feet at y=0.
# Only Body/joints move: caller owns this node's world transform and hitbox.
const OfficeTools = preload("res://survival/office_tools.gd")
const FishingPresentation = preload("res://survival/fishing_presentation.gd")
const OfficeBosses = preload("res://survival/office_bosses.gd")
const OfficeMonsters = preload("res://survival/office_monsters.gd")
const ActorLodMesh = preload("res://survival/actor_lod_mesh.gd")
const DEATH_SECONDS := 0.8
const SHIRTS := [Color("457d87"), Color("b26c50"), Color("87934f"), Color("7967a1")]
const SKIN := Color("d8ad85")
const DARK := Color("263c47")
const GOLD := Color("eeb957")
const IVORY := Color("f3e4bb")
const RIG_SHADER := """shader_type spatial;
render_mode diffuse_lambert, specular_disabled;
uniform float hit_flash = 0.0;
uniform vec4 hit_color : source_color = vec4(1.0,0.74,0.60,1.0);
void fragment(){ ALBEDO=mix(COLOR.rgb,hit_color.rgb,hit_flash); ROUGHNESS=0.96; METALLIC=0.0; }
"""

var kind := "fisherman"
var state: Dictionary = {}
var joints: Dictionary = {}
var body: Node3D
var weapon_root: Node3D
var muzzle: Marker3D
var weak_point: Node3D
var weak_material: StandardMaterial3D
var rig_material: ShaderMaterial
var equipment_id := ""
var assembly_signature := ""
var assembly_mark: Node3D
var clock := 0.0
var state_sample_clock := 0.0
var catch_hop := 0.0
var stride := 0.0
var move_weight := 0.0
var _eel_wave_phase := 0.0
var _breaker_drill_phase := 0.0
var _eel_warning := 0.0
var _enemy_warning := 0.0
var _enemy_stun := 0.0
var _enemy_recover := 0.0
var base_scale := 1.0
var mesh_count := 0
var triangle_count := 0
var _ages: Dictionary = {}
var _lengths := {"shot":0.2, "melee":0.65, "punch":0.6, "cast":0.9, "hit":0.42, "land":0.38, "jump":0.32, "attack":0.6,"tool":0.65,"social_give":.55,"social_receive":.55,"social_highfive":.75,"social_throw":.45}
var bandage_blend := 0.0
var crawl_weight := 0.0
var rescue_weight := 0.0
var rod_crank_phase := 0.0
var rod_crank_blend := 0.0
var rod_pull_blend := 0.0
var crawl_stride := 0.0
var _last_action_seq := -1
var _last_hit_seq := -1
var _last_enemy_attack_seq := -1
var _dead := false
var _death_age := 0.0
var _hit_side := 1.0
var _hit_direction := Vector3.BACK
var _hit_shielded := false
var _hit_heavy := false
var _hit_weak := false
var attack_kind := "melee"
var _was_grounded := true
var _was_swimming := false
var _base_positions: Dictionary = {}
static var _shared_shader: Shader
static var _mesh_library: Dictionary = {}
var _geometry_index := 0
var _palette_index := 0
var _far_visual: MeshInstance3D
var _far_sources: Array[MeshInstance3D] = []
var _far_active := false
var _far_anchor: Node3D
var _far_anchor_rest := Transform3D.IDENTITY
var details_pending := false

static func shared_shader() -> Shader:
	if _shared_shader == null:
		_shared_shader = Shader.new()
		_shared_shader.code = RIG_SHADER
	return _shared_shader

func _cube(at: Vector3, size: Vector3, color: Color, rotation := Vector3.ZERO) -> Dictionary:
	return {"p":at, "s":size, "c":color, "r":rotation}

func _geometry(parent: Node3D, cubes: Array, override_material: Material = null) -> MeshInstance3D:
	# Geometry is immutable for a rig kind/palette/joint. Share GPU buffers;
	# hit-flash materials remain per actor so one hit never flashes the whole pack.
	var key := "%s:%d:%d" % [kind,_palette_index,_geometry_index]
	_geometry_index += 1
	var visual := MeshInstance3D.new()
	if _mesh_library.has(key):
		visual.mesh = _mesh_library[key]
		visual.material_override = override_material if override_material != null else rig_material
		parent.add_child(visual)
		mesh_count += 1
		triangle_count += visual.mesh.surface_get_array_len(0) / 3
		return visual
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	for cube in cubes:
		var primitive := BoxMesh.new()
		primitive.size = cube.s
		var source := primitive.get_mesh_arrays()
		var basis := Basis.from_euler(cube.get("r", Vector3.ZERO))
		for index in source[Mesh.ARRAY_INDEX]:
			vertices.append(basis * source[Mesh.ARRAY_VERTEX][index] + cube.p)
			normals.append(basis * source[Mesh.ARRAY_NORMAL][index])
			colors.append(cube.c)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	_mesh_library[key] = mesh
	visual.mesh = mesh
	visual.material_override = override_material if override_material != null else rig_material
	parent.add_child(visual)
	mesh_count += 1
	triangle_count += vertices.size() / 3
	return visual

func _joint(parent: Node3D, title: String, at: Vector3, cubes: Array = []) -> Node3D:
	var joint := Node3D.new()
	joint.name = title
	parent.add_child(joint)
	joint.position = at
	joints[title] = joint
	_base_positions[title] = at
	if not cubes.is_empty(): _geometry(joint, cubes)
	return joint

func setup(actor_kind: String, color_index: int = 0, defer_details := false) -> void:
	if is_instance_valid(assembly_mark): assembly_mark.free()
	assembly_mark=null
	if is_instance_valid(body): body.free()
	details_pending = false
	_far_visual = null
	_far_sources.clear()
	_far_active = false
	_far_anchor = null
	_far_anchor_rest = Transform3D.IDENTITY
	kind = "fisherman" if actor_kind in ["player", "fisherman"] else actor_kind
	joints.clear()
	_base_positions.clear()
	_ages.clear()
	_lengths = {"shot":0.2, "melee":0.65, "punch":0.6, "cast":0.9, "hit":0.42, "land":0.38, "jump":0.32, "attack":0.6,"tool":0.65,"social_give":.55,"social_receive":.55,"social_highfive":.75,"social_throw":.45}
	state = {}
	clock = 0
	state_sample_clock = 0
	catch_hop = 0
	stride = float(posmod(color_index, 4)) * 0.7
	move_weight = 0
	_eel_wave_phase = 0
	_breaker_drill_phase = 0
	_eel_warning = 0
	_enemy_warning = 0
	_enemy_stun = 0
	_enemy_recover = 0
	_last_action_seq = -1
	_last_hit_seq = -1
	_last_enemy_attack_seq = -1
	_dead = false
	_death_age = 0
	_was_grounded = true
	_was_swimming = false
	mesh_count = 0
	triangle_count = 0
	_geometry_index = 0
	_palette_index = posmod(color_index,4) if kind=="fisherman" else 0
	weapon_root = null
	weak_point = null
	muzzle = null
	equipment_id = ""
	rig_material = ShaderMaterial.new()
	rig_material.shader = shared_shader()
	body = Node3D.new()
	body.name = "Body"
	add_child(body)
	base_scale = 0.90 if kind == "fisherman" else (2.2 if kind == "boss_crab" else 1.0)
	var preview_mesh: ArrayMesh = ActorLodMesh.cached_mesh(kind) if defer_details else null
	if preview_mesh != null:
		# A visible, already-warmed silhouette keeps targeting, hit feedback and
		# death readable while distant joints are assembled on subsequent frames.
		var preview := MeshInstance3D.new()
		preview.mesh = preview_mesh
		preview.material_override = rig_material
		body.add_child(preview)
		body.scale = Vector3.ONE * base_scale
		details_pending = true
		return
	_build_rig_body()

func finish_details() -> bool:
	if not details_pending or _dead or is_queued_for_deletion(): return false
	# Keep current authority data, action ages, death/hit sequences and the
	# actor's private material. Re-running setup would reset those live values.
	body.free()
	body = Node3D.new()
	body.name = "Body"
	add_child(body)
	details_pending = false
	_build_rig_body()
	return true

func _build_rig_body() -> void:
	match kind:
		"fisherman": _build_fisherman(_palette_index)
		"crab", "boss_crab": _build_crab()
		"eel": _build_eel()
		_:
			if OfficeBosses.handles(kind): OfficeBosses.build(self)
			elif OfficeMonsters.handles(kind): OfficeMonsters.build(self)
			else: _build_fish()
	if not OfficeBosses.handles(kind) and not OfficeMonsters.handles(kind): _build_office_details()
	body.scale = Vector3.ONE * base_scale
	_prepare_far_visual()
	animate(0, Vector3.ZERO)

func _prepare_far_visual() -> void:
	# Capture only the canonical construction pose. Baking on first distance
	# crossing could cache a random hit/attack pose for every subsequent actor.
	var prepared: Dictionary = ActorLodMesh.prepare(body, rig_material, kind)
	if prepared.is_empty(): return
	_far_visual = prepared.proxy
	_far_sources.assign(prepared.sources)
	_far_anchor = joints.get("Segment0") if kind == "eel" else joints.get("Torso")
	if is_instance_valid(_far_anchor): _far_anchor_rest = _far_anchor.transform

func set_visual_distance_squared(distance_squared: float) -> void:
	if details_pending: return
	# Called only by the enemy presentation loop; the helper also rejects
	# players, every boss, and unknown future kinds.
	# Separate enter/exit distances avoid flickering when the camera bobs at
	# the boundary. The caller supplies distance corrected for the current FOV.
	var threshold := 32.0 if _far_active else 36.0
	_set_far_visual(is_finite(distance_squared) and distance_squared > threshold * threshold and not _dead)

func _set_far_visual(enabled: bool) -> void:
	if not is_instance_valid(_far_visual) or _far_active == enabled: return
	_far_active = enabled
	for visual in _far_sources:
		if is_instance_valid(visual): visual.visible = not enabled
	_far_visual.visible = enabled
	_update_far_visual_pose()

func _update_far_visual_pose() -> void:
	if not is_instance_valid(_far_visual) or not _far_active: return
	if _dead:
		# Keep the existing full death pose/retirement at every distance.
		_set_far_visual(false)
		return
	# Body still applies the normal hit squash/flash. The dominant joint adds
	# broad breathing/attack movement without separate limb draw calls.
	_far_visual.transform = _far_anchor.transform * _far_anchor_rest.affine_inverse() if is_instance_valid(_far_anchor) else Transform3D.IDENTITY

func _build_fisherman(color_index: int) -> void:
	var shirt: Color = SHIRTS[color_index]
	var torso := _joint(body, "Torso", Vector3(0, 1.01, 0), [
		_cube(Vector3.ZERO, Vector3(0.56, 0.54, 0.32), shirt),
		_cube(Vector3(0, -0.23, 0), Vector3(0.59, 0.11, 0.35), DARK),
		_cube(Vector3(0, -0.23, -0.184), Vector3(0.13, 0.10, 0.035), GOLD),
		_cube(Vector3(-0.14, 0.02, -0.177), Vector3(0.15, 0.15, 0.035), shirt.lightened(0.16)),
		_cube(Vector3(0.16, 0.02, -0.177), Vector3(0.12, 0.15, 0.035), shirt.darkened(0.12))])
	_joint(torso, "Head", Vector3(0, 0.36, 0), [
		_cube(Vector3(0, 0.13, 0), Vector3(0.42, 0.40, 0.37), SKIN),
		_cube(Vector3(-0.11, 0.18, -0.193), Vector3(0.055, 0.055, 0.025), DARK),
		_cube(Vector3(0.11, 0.18, -0.193), Vector3(0.055, 0.055, 0.025), DARK),
		_cube(Vector3(0, 0.085, -0.202), Vector3(0.065, 0.07, 0.055), SKIN.darkened(0.10)),
		_cube(Vector3(0, 0.025, -0.20), Vector3(0.17, 0.035, 0.025), Color("805c48")),
		# Keep the cap outside the skin's rear plane: coplanar faces shimmer
		# during camera motion, even after these boxes share one baked mesh.
		_cube(Vector3(0, 0.345, -0.015), Vector3(0.44, 0.075, 0.42), DARK),
		_cube(Vector3(0, 0.385, 0.015), Vector3(0.41, 0.09, 0.39), DARK),
		_cube(Vector3(0, 0.377, -0.188), Vector3(0.43, 0.055, 0.03), shirt)])
	for side in [-1.0, 1.0]:
		var suffix := "L" if side < 0 else "R"
		var arm := _joint(torso, "Arm" + suffix, Vector3(side * 0.36, 0.23, 0), [
			_cube(Vector3(0, -0.155, 0), Vector3(0.20, 0.34, 0.23), shirt),
			_cube(Vector3(0, -0.30, 0), Vector3(0.205, 0.07, 0.235), shirt.darkened(0.10))])
		var forearm := _joint(arm, "Forearm" + suffix, Vector3(0, -0.30, 0), [
			_cube(Vector3(0, -0.145, 0), Vector3(0.17, 0.28, 0.19), SKIN),
			_cube(Vector3(0, -0.28, -0.005), Vector3(0.20, 0.105, 0.21), SKIN)])
		if suffix == "R":
			weapon_root = _joint(forearm, "HeldTool", Vector3(0, -0.28, 0))
		var leg := _joint(body, "Leg" + suffix, Vector3(side * 0.155, 0.77, 0), [
			_cube(Vector3(0, -0.155, 0), Vector3(0.235, 0.32, 0.25), Color("344c5c"))])
		_joint(leg, "Knee" + suffix, Vector3(0, -0.32, 0), [
			_cube(Vector3(0, -0.105, 0), Vector3(0.235, 0.21, 0.25), Color("344c5c")),
			_cube(Vector3(0, -0.315, -0.035), Vector3(0.26, 0.23, 0.34), Color("58473c")),
			_cube(Vector3(0, -0.41, -0.045), Vector3(0.27, 0.045, 0.35), DARK)])

	var parcel := _joint(torso, "CarryParcel", Vector3(0,-.07,-.51))
	preload("res://survival/exploration_view.gd").carry_box(parcel)
	parcel.visible=false

func _equip(id: String) -> void:
	if weapon_root == null: return
	var signature := id+":"+str(state.get("heldModuleId",""))+":"+str(state.get("heldAttachmentId",""))
	if id == equipment_id:
		if signature!=assembly_signature:
			var fitted: Node3D = weapon_root.get_node("OfficeTool") if weapon_root.has_node("OfficeTool") else weapon_root.get_node("FishingRod") if weapon_root.has_node("FishingRod") else weapon_root
			OfficeTools.apply_fittings(fitted,id,str(state.get("heldModuleId","")),str(state.get("heldAttachmentId","")))
			assembly_signature=signature
		return
	equipment_id = id
	for child in weapon_root.get_children(): child.free()
	muzzle = Marker3D.new()
	muzzle.name = "Muzzle"
	weapon_root.add_child(muzzle)
	if id.is_empty(): return
	if id in OfficeTools.NEW_RODS:
		var rod := Node3D.new()
		rod.name="FishingRod"
		weapon_root.add_child(rod)
		OfficeTools.build_rod(rod,id)
		muzzle.free()
		muzzle=rod.get_node("Muzzle")
	elif id.begins_with("rod"):
		OfficeTools.build_legacy_rod(weapon_root,id,0.84)
	else:
		var model := Node3D.new()
		model.name = "OfficeTool"
		weapon_root.add_child(model)
		OfficeTools.build(model,id)
		model.scale = Vector3.ONE * 0.78
		if model.has_node("Muzzle"):
			muzzle.free()
			muzzle=model.get_node("Muzzle")
		else: muzzle.position=Vector3(0,0.49,0) if id=="knife" else Vector3(0,0.035,-0.733)
	var fitted: Node3D = weapon_root.get_node("OfficeTool") if weapon_root.has_node("OfficeTool") else weapon_root.get_node("FishingRod") if weapon_root.has_node("FishingRod") else weapon_root
	OfficeTools.apply_fittings(fitted,id,str(state.get("heldModuleId","")),str(state.get("heldAttachmentId","")))
	assembly_signature=signature

func _build_crab() -> void:
	var shell := Color("577b96") if kind == "crab" else Color("596776")
	var torso := _joint(body, "Torso", Vector3(0, 0.43, 0), [
		_cube(Vector3.ZERO, Vector3(0.93, 0.34, 0.79), shell),
		_cube(Vector3(0, 0.19, 0.01), Vector3(0.82, 0.14, 0.66), Color("fff0d0")),
		_cube(Vector3(0, -0.16, 0), Vector3(0.73, 0.13, 0.61), Color("d3ae71")),
		_cube(Vector3(-0.24, 0.30, -0.32), Vector3(0.08, 0.28, 0.09), shell),
		_cube(Vector3(0.24, 0.30, -0.32), Vector3(0.08, 0.28, 0.09), shell),
		_cube(Vector3(-0.24, 0.43, -0.35), Vector3(0.15, 0.10, 0.13), DARK),
		_cube(Vector3(0.24, 0.43, -0.35), Vector3(0.15, 0.10, 0.13), DARK),
		_cube(Vector3(-0.24, 0.44, -0.42), Vector3(0.065, 0.055, 0.02), GOLD),
		_cube(Vector3(0.24, 0.44, -0.42), Vector3(0.065, 0.055, 0.02), GOLD)])
	for side in [-1.0, 1.0]:
		var suffix := "L" if side < 0 else "R"
		for index in range(3):
			_joint(torso, "Leg" + suffix + str(index), Vector3(side * 0.40, -0.10, -0.22 + index * 0.23), [
				_cube(Vector3(side * 0.20, -0.04, 0), Vector3(0.43, 0.10, 0.12), Color("344c5d"), Vector3(0, 0, side * -0.2)),
				_cube(Vector3(side * 0.36, -0.20, 0.015), Vector3(0.105, 0.32, 0.12), shell, Vector3(0, 0, side * -0.30))])
		var arm := _joint(torso, "Claw" + suffix, Vector3(side * 0.42, 0, -0.32), [
			_cube(Vector3(side * 0.12, 0, -0.18), Vector3(0.19, 0.18, 0.43), shell),
			_cube(Vector3(side * 0.13, 0.04, -0.46), Vector3(0.32, 0.25, 0.31), Color("dc6952")),
			_cube(Vector3(side * 0.03, 0.05, -0.65), Vector3(0.095, 0.18, 0.25), IVORY)])
		_joint(arm, "Pincer" + suffix, Vector3(side * 0.27, 0.04, -0.46), [_cube(Vector3(0, 0, -0.18), Vector3(0.10, 0.18, 0.34), IVORY)])
	if kind == "boss_crab":
		weak_point = _joint(torso, "WeakPoint", Vector3(0, 0.12, 0.41))
		weak_material = StandardMaterial3D.new()
		weak_material.albedo_color = Color("ffcc63")
		weak_material.roughness = 0.9
		weak_material.emission_enabled = true
		weak_material.emission = Color("ff895d")
		weak_material.emission_energy_multiplier = 0.30
		_geometry(weak_point, [_cube(Vector3.ZERO, Vector3(0.47, 0.24, 0.12), GOLD), _cube(Vector3(0, 0.16, 0.035), Vector3(0.21, 0.11, 0.13), GOLD)], weak_material)
		_geometry(torso, [_cube(Vector3(-0.32, 0.18, 0.21), Vector3(0.17, 0.28, 0.22), DARK, Vector3(0,0,-0.25)), _cube(Vector3(0.32, 0.18, 0.21), Vector3(0.17, 0.28, 0.22), DARK, Vector3(0,0,0.25))])

func _build_eel() -> void:
	var previous: Node3D = body
	for index in range(8):
		var width := 0.43 - index * 0.033
		var cubes := [_cube(Vector3.ZERO, Vector3(width, width * 0.80, 0.32), Color("384c62") if index % 2 == 0 else Color("657a8a")), _cube(Vector3(0, width * 0.47, 0.025), Vector3(0.045, 0.13, 0.23), GOLD)]
		if index == 0:
			cubes.append(_cube(Vector3(-0.14, 0.05, -0.17), Vector3(0.075, 0.065, 0.03), GOLD))
			cubes.append(_cube(Vector3(0.14, 0.05, -0.17), Vector3(0.075, 0.065, 0.03), GOLD))
			cubes.append(_cube(Vector3(0, -0.06, -0.18), Vector3(0.23, 0.055, 0.04), DARK))
		previous = _joint(previous, "Segment" + str(index), Vector3(0, 0.34, -0.46) if index == 0 else Vector3(0, 0, 0.27), cubes)

	_joint(joints.Segment0, "Jaw", Vector3(0, -0.11, -0.11), [_cube(Vector3(0, 0, -0.13), Vector3(0.25, 0.075, 0.22), Color("adc5ab"))])

func _build_fish() -> void:
	var torso := _joint(body, "Torso", Vector3(0, 0.28, 0), [
		_cube(Vector3.ZERO, Vector3(0.36, 0.36, 0.61), Color("a9c9c6")),
		_cube(Vector3(0, 0.08, -0.20), Vector3(0.33, 0.22, 0.19), Color("d1ded2")),
		_cube(Vector3(-0.187, 0.06, -0.20), Vector3(0.024, 0.06, 0.07), DARK),
		_cube(Vector3(0.187, 0.06, -0.20), Vector3(0.024, 0.06, 0.07), DARK),
		_cube(Vector3(0, 0.23, 0.02), Vector3(0.055, 0.14, 0.27), Color("618d93"))])
	_joint(torso, "Tail", Vector3(0, 0, 0.28), [_cube(Vector3(0, 0, 0.10), Vector3(0.06, 0.32, 0.19), Color("618d93"))])
	for side in [-1.0, 1.0]:
		_joint(torso, "Fin" + ("L" if side < 0 else "R"), Vector3(side * 0.17, -0.06, -0.02), [_cube(Vector3(side * 0.09, 0, 0.03), Vector3(0.20, 0.065, 0.17), Color("6da4a4"))])

func _number(value: Variant, fallback := 0.0) -> float:
	return float(value) if value is int or value is float else fallback

func apply_state(data: Dictionary, specific_equipment_id: String = "") -> void:
	var old_state := str(state.get("state", ""))
	var old_life := str(state.get("lifeState", "ALIVE"))
	state = data.duplicate()
	state_sample_clock = clock
	if kind == "fisherman":
		var id := specific_equipment_id
		if id.is_empty(): id = str(data.get("heldDefinitionId", data.get("equipmentDefinitionId", "")) if data.get("heldDefinitionId", data.get("equipmentDefinitionId", "")) != null else "")
		_equip(id)
		var grounded := bool(data.get("grounded", true))
		if grounded and not _was_grounded and not bool(data.get("swimming", false)): play_action("land")
		_was_grounded = grounded
		var life := str(data.get("lifeState", "ALIVE"))
		if life == "ALIVE" and (old_life != "ALIVE" or _dead):
			restore_alive()
		if life == "DEAD_WAIT": play_action("death")
	var action := str(data.get("action", "idle"))
	var action_sequence := int(_number(data.get("actionSeq"), -1))
	if action_sequence > _last_action_seq and action not in ["", "interact", "reel"]:
		var payload := {"actionSeq":action_sequence}
		if _number(data.get("actionDuration")) > 0: payload["duration"] = _number(data.actionDuration)
		if action in ["hurt", "hit"] and data.get("hitSeq") != null: payload["hitSeq"] = int(_number(data.hitSeq))
		if data.get("serverTime") != null and data.get("actionStartedAt") != null:
			payload["age"] = maxf(0, _number(data.serverTime) - _number(data.actionStartedAt))
		play_action(action, payload)
	if int(_number(data.get("hitSeq"), -1)) > _last_hit_seq and int(_number(data.get("hitSeq"), -1)) > 0:
		var hit_payload := {"hitSeq":int(_number(data.hitSeq)), "direction":data.get("lastHitDirection", {}),"weak":data.get("lastHitWeak",false),"shielded":data.get("lastHitShielded",false),"heavy":data.get("lastHitHeavy",false)}
		if data.get("serverTime") != null and data.get("hitAt") != null: hit_payload["age"] = maxf(0, _number(data.serverTime) - _number(data.hitAt))
		play_action("hit", hit_payload)
	var next_state := str(data.get("state", "")).to_upper()
	var attack_sequence := int(_number(data.get("attackActionSeq"),0))
	if _last_enemy_attack_seq<0 and attack_sequence<=0:
		_last_enemy_attack_seq=attack_sequence
	elif attack_sequence>0 and attack_sequence>_last_enemy_attack_seq:
		var attack_age := maxf(0,_number(data.get("serverTime"),clock)-_number(data.get("attackActionAt"),clock))
		if attack_age<0.6:
			play_action("attack", {"attackActionSeq":attack_sequence,"age":attack_age,"attackKind":str(data.get("attackActionKind",data.get("attackKind", "melee")))})
		else: _last_enemy_attack_seq=attack_sequence
	elif attack_sequence<=0 and old_state.to_upper().contains("WINDUP") and next_state in ["RECOVER", "WEAK", "CHARGE"]:
		play_action("attack", {"attackKind":str(data.get("attackKind", "melee"))})
	if kind != "fisherman" and _number(data.get("hp"), 1) <= 0: play_action("death")

func restore_alive() -> void:
	# Death and respawn events may occur between two ALIVE snapshots.
	# Restore the existing player rig without affecting enemy retirement.
	if kind != "fisherman": return
	_dead = false
	_death_age = 0
	body.visible = true

func play_action(action: String, payload: Dictionary = {}) -> void:
	var value := str({"fire":"shot", "hurt":"hit", "hook":"cast", "reload_insert":"reload", "equip":"equip"}.get(action.to_lower(), action.to_lower()))
	if value == "hit" and (payload.get("protected") == true or (payload.get("damage") != null and _number(payload.damage) <= 0)): return
	if value == "death":
		if not _dead: _dead = true; _death_age = 0
		return
	if _dead: return
	if value == "attack":
		if payload.get("animate") == false: return
		var sequence := int(_number(payload.get("attackActionSeq"),0))
		if sequence>0:
			if sequence<=_last_enemy_attack_seq: return
			_last_enemy_attack_seq=sequence
		attack_kind=str(payload.get("attackKind","melee"))
	if value in ["idle", "reload_complete"] and payload.get("actionSeq") == null: return
	if payload.get("actionSeq") != null:
		var sequence := int(_number(payload.actionSeq, -1))
		if sequence <= _last_action_seq: return
		_last_action_seq = sequence
	if value == "idle":
		for cancelled in ["reload", "cast", "melee"]: _ages.erase(cancelled)
		return
	if value == "reload_complete":
		_ages.erase("reload")
		return
	if value == "hit" and payload.get("hitSeq") != null:
		var sequence := int(_number(payload.hitSeq, -1))
		if sequence <= _last_hit_seq: return
		_last_hit_seq = sequence
	if value == "hit":
		var direction = payload.get("direction", {})
		if direction is Dictionary:
			_hit_side = -1.0 if _number(direction.get("x"), 1) < 0 else 1.0
			_hit_direction = global_basis.inverse()*Vector3(_number(direction.get("x")),0,_number(direction.get("z"),1))
		elif direction is Vector3:
			_hit_side = -1.0 if direction.x < 0 else 1.0
			_hit_direction = global_basis.inverse()*direction
		_hit_shielded = bool(payload.get("shielded",false))
		_hit_weak = bool(payload.get("weak",false))
		_hit_heavy = bool(payload.get("heavy",false)) or str(payload.get("weaponId","")) in ["shotgun","rifle","knife"]
		rig_material.set_shader_parameter("hit_color", Color("91cce3") if _hit_shielded else (Color("fff8c9") if _hit_weak else Color("fff0cb") if _hit_heavy else Color("ffbf99")))
	if value == "interrupt": _lengths[value]=clampf(_number(payload.get("duration"),.55),.3,1.2)
	_ages[value] = maxf(0, _number(payload.get("age")))
	if _lengths.has(value) and _number(payload.get("duration")) > 0: _lengths[value] = clampf(_number(payload.duration), 0.10, 3.0)
	if value == "reload": _lengths[value] = maxf(0.3, _number(payload.get("duration"), 1.5))
	if value == "equip": _lengths[value] = 0.3

func _pulse(action: String) -> float:
	if not _ages.has(action): return 0
	return maxf(0, 1.0 - float(_ages[action]) / float(_lengths.get(action, 1.0)))

func _phase(action: String) -> float:
	return clampf(float(_ages.get(action, 999.0)) / float(_lengths.get(action, 1.0)), 0, 1)

func strike_weight() -> float:
	if _pulse("attack")<=0: return 0
	var progress := _phase("attack")
	return smoothstep(0,.12,progress)*(1-smoothstep(.32,1,progress))

func _rotate(joint: String, euler: Vector3) -> void:
	if joints.has(joint): joints[joint].rotation = euler

func animate(delta: float, velocity: Vector3) -> void:
	if body == null: return
	# Off-screen poses are sampled less often; action clocks must still consume
	# the whole interval so hits, reloads and deaths keep their real duration.
	var dt := maxf(delta, 0)
	var bandaging: bool = state.get("work") is Dictionary and str(state.work.get("kind",""))=="Bandage"
	bandage_blend=move_toward(bandage_blend,1.0 if bandaging else 0.0,dt/0.20)
	crawl_weight=move_toward(crawl_weight,1.0 if str(state.get("lifeState",""))=="DOWNED" else 0.0,dt/0.42)
	var rescuing: bool = state.get("work") is Dictionary and str(state.work.get("kind",""))=="Revive"
	rescue_weight=move_toward(rescue_weight,1.0 if rescuing else 0.0,dt/0.25)
	crawl_stride += dt * minf(Vector2(velocity.x,velocity.z).length(),1.1) * 5.0
	clock += dt
	for key in _ages.keys():
		_ages[key] += dt
		if float(_ages[key]) >= float(_lengths.get(key, 1.0)): _ages.erase(key)
	var speed := Vector2(velocity.x, velocity.z).length()
	move_weight = move_toward(move_weight, clampf(speed / (5.5 if kind == "fisherman" else 2.3), 0, 1), minf(dt, 0.1) * 6.0)
	stride += dt * (5.5 + minf(speed, 7) * 1.7)
	for key in joints:
		joints[key].position = _base_positions[key]
		joints[key].rotation = Vector3.ZERO
		joints[key].scale = Vector3.ONE
	body.position = Vector3.ZERO
	body.rotation = Vector3.ZERO
	body.scale = Vector3.ONE * base_scale
	if details_pending:
		body.position.y = sin(clock * 2.0) * 0.015
	else:
		if kind != "fisherman": _animate_enemy_state(dt)
		if kind == "fisherman": _animate_fisherman(velocity,delta)
		elif kind in ["crab", "boss_crab"]: _animate_crab()
		elif kind == "eel": _animate_eel(dt)
		elif OfficeBosses.handles(kind): OfficeBosses.animate(self,dt)
		elif OfficeMonsters.handles(kind): OfficeMonsters.animate(self,dt)
		else: _animate_fish()
		_animate_office_details()
	var hit := _pulse("hit")
	rig_material.set_shader_parameter("hit_flash", pow(hit, 1.5) * (.9 if _hit_weak else .65 if str(state.get("tier",""))=="boss" or kind=="boss_crab" else .92))
	if hit > 0:
		if kind=="fisherman":
			body.scale *= Vector3(1 + sin(hit * PI * 2.0) * 0.13, 1 - sin(hit * PI * 2.0) * 0.16, 1 + sin(hit * PI * 2.0) * 0.13)
			body.rotation.z += _hit_side * sin(hit * PI * 2.0) * 0.19
			body.position.y += sin(hit * PI) * 0.07 * base_scale
		else:
			# One recoil and recovery, not a repeated full-body wobble.
			var recoil := sin((1-hit)*PI)*hit*(1.35 if _hit_heavy else 1.0)
			var weight := .20 if str(state.get("tier",""))=="boss" or kind=="boss_crab" else (.45 if str(state.get("tier",""))=="elite" else 1.0)
			if _hit_shielded: weight*=.3
			body.position += Vector3(_hit_direction.x,0,_hit_direction.z)*recoil*.13*weight
			body.rotation.z -= _hit_direction.x*recoil*.24*weight
			body.rotation.x += _hit_direction.z*recoil*.18*weight
			body.scale *= Vector3(1+recoil*.045*weight,1-recoil*.07*weight,1+recoil*.045*weight)
			if _hit_shielded and joints.has("Shield"): joints.Shield.rotation.x+=recoil*.18
	var interrupted := sin(_phase("interrupt")*PI)*_pulse("interrupt")
	if kind!="fisherman" and interrupted>0:
		body.position.y-=interrupted*.13
		body.rotation.x+=interrupted*.24
	var land := _pulse("land")
	if land > 0:
		var squash := sin((1-land) * PI) * land
		body.scale *= Vector3(1 + squash * 0.24, 1 - squash * 0.30, 1 + squash * 0.24)
	if _dead:
		_death_age += dt
		var progress := clampf(_death_age / DEATH_SECONDS, 0, 1)
		body.rotation.z += ease(minf(1, progress * 1.7), 0.7) * (1.45 if kind == "fisherman" else 2.45)
		body.rotation.x += progress * 0.28
		body.position.y = (0.35 if kind == "fisherman" else 0.16) * sin(progress * PI) * base_scale
		if kind in ["paper_drone","stamp_bat"]: body.position.y-=smoothstep(0,.75,progress)*(1.15 if kind=="paper_drone" else 1.05)
		if kind in ["crab", "boss_crab"]: body.position.y += (1 - cos(body.rotation.z)) * 0.35 * base_scale
		var shrink := 1.0 - smoothstep(0.58, 1.0, progress)
		body.scale *= maxf(0.005, shrink)
		body.visible = progress < 1 and not is_equal_approx(progress, 1.0)
	_update_far_visual_pose()

func _animate_fisherman(velocity: Vector3, delta := 0.0166667) -> void:
	var walking := sin(stride) * move_weight
	var running := bool(state.get("sprinting", false))
	var pitch := clampf(_number(state.get("pitch")), -0.95, 0.95)
	var airborne := (not bool(state.get("grounded", true)) or _pulse("jump") > 0) and not bool(state.get("swimming", false))
	var swim := bool(state.get("swimming", false))
	var crouch := bool(state.get("crouching", false))
	var downed := str(state.get("lifeState", "ALIVE")) == "DOWNED"
	var bob := absf(sin(stride)) * move_weight * (0.07 if running else 0.035)
	body.position.y = bob * base_scale
	if not airborne and not swim and not crouch:
		var leg_angle := walking * (0.95 if running else 0.72)
		body.position.y = (-0.70 * (1 - cos(leg_angle)) + absf(sin(stride * 2)) * move_weight * 0.025) * base_scale
	_rotate("Torso", Vector3(-0.13 * move_weight + pitch * 0.12, -walking * 0.075, walking * 0.025))
	_rotate("Head", Vector3(pitch * 0.60, walking * 0.035, -walking * 0.025))
	_rotate("LegL", Vector3(walking * (0.95 if running else 0.72), 0, 0))
	_rotate("LegR", Vector3(-walking * (0.95 if running else 0.72), 0, 0))
	_rotate("ArmL", Vector3(-walking * 0.78, 0, 0.06))
	_rotate("ArmR", Vector3(walking * 0.78, 0, -0.06))
	_rotate("ForearmL", Vector3(0.22 + move_weight * 0.20, 0, 0))
	_rotate("ForearmR", Vector3(0.22 + move_weight * 0.20, 0, 0))
	var fishing = state.get("fishing")
	var is_rod := equipment_id.begins_with("rod")
	var gun := equipment_id in OfficeTools.AimProfile.GUNS
	var ads := bool(state.get("ads", false))
	if gun:
		_rotate("ArmR", Vector3(1.05 + pitch * 0.45, 0, -0.32))
		_rotate("ForearmR", Vector3(0.27, 0, 0))
		_rotate("ArmL", Vector3(0.95 + pitch * 0.40, 0, 0.82))
		_rotate("ForearmL", Vector3(0.75, 0, 0.30))
		if equipment_id=="pistol":
			_rotate("ArmL",Vector3(0.9+pitch*0.4,0,0.45))
			_rotate("ForearmL",Vector3(0.85,0,0.15))
		if ads: joints.Head.position.z -= 0.045; joints.Torso.rotation.x += 0.055
		var recoil := _pulse("shot")
		joints.ArmR.rotation.x += recoil * 0.18
		joints.ForearmR.rotation.x += recoil * 0.24
		joints.Torso.position.z += recoil * 0.055
		joints.Head.rotation.x -= recoil * 0.075
	if OfficeTools.is_quick(equipment_id):
		var use_arc := sin(_phase("tool")*PI) if _pulse("tool")>0 else 0.0
		_rotate("ArmR",Vector3(0.60+use_arc*(1.0 if equipment_id=="coffee_flask" else 0.70),0,-0.15))
		_rotate("ForearmR",Vector3(0.62+use_arc*0.32,0,0))
		_rotate("ArmL",Vector3(-walking*0.35,0,0.12))
	if equipment_id=="rod_net":
		var line_data: Dictionary = fishing if fishing is Dictionary else {}
		var pull := FishingPresentation.reel_weight(line_data)
		_rotate("ArmR",Vector3(.70+sin(clock*5)*pull*.13,0,-.2))
		_rotate("ForearmR",Vector3(.60,0,0))
		_rotate("ArmL",Vector3(.72+sin(clock*5+PI)*pull*.13,0,.55))
		_rotate("ForearmL",Vector3(.68,0,.15))
	elif is_rod:
		var line_data: Dictionary=fishing if fishing is Dictionary else {}
		rod_crank_blend=move_toward(rod_crank_blend,FishingPresentation.reel_weight(line_data),delta*10)
		rod_pull_blend=move_toward(rod_pull_blend,FishingPresentation.pull_weight(line_data),delta*4)
		rod_crank_phase+=delta*9*rod_crank_blend
		_rotate("ArmR", Vector3(0.68, 0, -0.12))
		_rotate("ForearmR", Vector3(0.55, 0, 0))
		_rotate("ArmL", Vector3(0.62, 0, 0.62))
		_rotate("ForearmL", Vector3(0.88, 0, 0.2))
		if fishing is Dictionary:
			var reel_weight := rod_crank_blend
			var pull_weight := rod_pull_blend
			joints.ArmR.rotation.x += pull_weight*0.20+sin(clock*6)*pull_weight*0.04
			joints.ForearmL.rotation.z += sin(rod_crank_phase)*0.35*reel_weight
			joints.ForearmL.rotation.x += cos(rod_crank_phase)*0.16*reel_weight
			joints.Torso.rotation.x -= pull_weight*0.16
	if state.get("reload") is Dictionary or _pulse("reload") > 0:
		_rotate("ArmR", Vector3(0.70, 0, -0.48))
		_rotate("ForearmR", Vector3(0.50, 0, 0))
		_rotate("ArmL", Vector3(0.35 + sin(clock * 7) * 0.22, 0, 0.50))
		_rotate("ForearmL", Vector3(0.90 + sin(clock * 7 + 0.5) * 0.65, 0, 0.18))
		joints.Head.rotation.x = -0.17
	if state.get("work") is Dictionary and str(state.work.get("kind",""))!="Bandage":
		joints.Torso.rotation.x = 0.22
		_rotate("ArmR", Vector3(1.05 + sin(clock * 9) * 0.50, 0, -0.12))
		_rotate("ArmL", Vector3(0.98 + sin(clock * 9 + PI) * 0.35, 0, 0.24))
	elif bandage_blend>0:
		var wrap_blend := smoothstep(0,1,bandage_blend)
		joints.Torso.rotation.x=lerpf(joints.Torso.rotation.x,0.18,wrap_blend)
		joints.ArmR.rotation=joints.ArmR.rotation.lerp(Vector3(1.0+sin(clock*6)*0.13,0,-0.12),wrap_blend)
		joints.ArmL.rotation=joints.ArmL.rotation.lerp(Vector3(1.1+sin(clock*6+PI)*0.11,0,0.24),wrap_blend)
	var melee := _pulse("melee")
	if melee > 0:
		var progress := _phase("melee")
		var swing := -0.65 * sin(progress / 0.24 * PI / 2) if progress < 0.24 else lerpf(-0.65, 2.05, smoothstep(0.24, 0.60, progress)) * (1 - smoothstep(0.64, 1, progress))
		_rotate("ArmR", Vector3(swing, 0.2, -0.42 * melee))
		joints.ForearmR.rotation.x = 0.22
		joints.Torso.rotation.y = -0.34 * sin(progress * PI * 2)
		joints.Torso.rotation.x = 0.20 * sin(progress * PI)
	if _pulse("cast") > 0:
		var progress := _phase("cast")
		var cast_angle := -0.45 if progress < 0.30 else lerpf(-0.45, 1.50, smoothstep(0.30, 0.64, progress))
		joints.ArmR.rotation.x = cast_angle
		joints.ForearmR.rotation.x = 0.40
		joints.Torso.rotation.x = -0.12 * sin(progress * PI * 2)
	if _pulse("punch") > 0 and equipment_id.is_empty():
		var progress := _phase("punch")
		var extension := smoothstep(0.0,0.27,progress) * (1.0-smoothstep(0.34,0.75,progress))
		var side := "L" if posmod(_last_action_seq,2)==0 else "R"
		_rotate("Arm"+side,Vector3(0.45+extension*1.0,0,0.12 if side=="L" else -0.12))
		_rotate("Forearm"+side,Vector3(0.75-extension*0.62,0,0))
		joints.Torso.rotation.y = extension * (0.15 if side=="L" else -0.15)
	var social_action := str(state.get("action",""))
	var social_progress := _phase(social_action)
	var social_weight := sin(social_progress*PI) if social_action.begins_with("social_") and social_progress < 1 else 0.0
	if social_weight > 0 and not downed and not swim and not state.get("work") is Dictionary:
		if social_action == "social_highfive":
			_rotate("ArmR",Vector3(1.75*social_weight,0,-.18))
			_rotate("ForearmR",Vector3(.25,0,0))
		elif social_action in ["social_give","social_receive"]:
			_rotate("ArmR",Vector3(1.35*social_weight,0,-.12))
			_rotate("ForearmR",Vector3(.25+.35*social_weight,0,0))
		else:
			_rotate("ArmR",Vector3(lerpf(-.5,1.7,social_progress)*social_weight,0,-.22))
			_rotate("ForearmR",Vector3(.15,0,0))
		joints.Head.rotation.x -= .08*social_weight
	if airborne:
		var rising := velocity.y > 0.1
		_rotate("LegL", Vector3(-0.46 if rising else 0.28, 0, 0.12))
		_rotate("LegR", Vector3(0.75 if rising else -0.20, 0, -0.12))
		joints.Torso.rotation.x = -0.10 if rising else 0.12
	if crouch:
		body.position.y -= 0.25 * base_scale
		joints.Torso.rotation.x += 0.20
		joints.LegL.rotation.x -= 0.45
		joints.LegR.rotation.x -= 0.45
	if swim:
		# Server swimming feet are water_y - 1.15: keep the horizontal head at the surface.
		body.position.y = 0.72 * base_scale
		body.rotation.x = -1.02
		_rotate("ArmL", Vector3(sin(clock * 5) * 1.0, 0, 0.72))
		_rotate("ArmR", Vector3(sin(clock * 5 + PI) * 1.0, 0, -0.72))
		_rotate("LegL", Vector3(sin(clock * 7) * 0.55, 0, 0))
		_rotate("LegR", Vector3(sin(clock * 7 + PI) * 0.55, 0, 0))
	if rescue_weight > 0:
		var aid := smoothstep(0,1,rescue_weight)
		joints.Torso.position.y=lerpf(joints.Torso.position.y,0.72,aid)
		joints.Torso.rotation=joints.Torso.rotation.lerp(Vector3(-0.35,0,0),aid)
		for side in ["L","R"]:
			joints["Arm"+side].rotation=joints["Arm"+side].rotation.lerp(Vector3(0.12+sin(clock*3+(PI if side=="L" else 0))*0.07,0,0.12 if side=="L" else -0.12),aid)
			joints["Forearm"+side].rotation=joints["Forearm"+side].rotation.lerp(Vector3(0.55,0,0),aid)
			joints["Leg"+side].rotation=joints["Leg"+side].rotation.lerp(Vector3(-0.78,0,0),aid)
			joints["Knee"+side].rotation.x=1.35*aid
			var leg: Node3D = joints["Leg"+side]
			var knee: Node3D = joints["Knee"+side]
			var sole_y := INF
			for z in [-0.22,0.13]:
				var foot: Vector3 = leg.transform * (knee.transform * Vector3(0,-0.4325,z))
				sole_y=minf(sole_y,foot.y+body.position.y)
			leg.position.y+=(0.015-sole_y)*aid
		joints.Head.rotation.x=lerpf(joints.Head.rotation.x,-0.35,aid)
	if crawl_weight > 0:
		var weight := smoothstep(0,1,crawl_weight)
		var motion := clampf(Vector2(velocity.x,velocity.z).length(),0,1)
		var wave := sin(crawl_stride)*motion
		var self_aid: bool = state.get("work") is Dictionary and str(state.work.get("kind",""))=="SelfRevive"
		body.rotation=body.rotation.lerp(Vector3.ZERO,weight)
		body.position.y=lerpf(body.position.y,0.0,weight)
		joints.Torso.position=joints.Torso.position.lerp(Vector3(0,0.55+sin(clock*2.2)*0.008,-0.08),weight)
		joints.Torso.rotation=joints.Torso.rotation.lerp(Vector3(-1.12,0,wave*0.035),weight)
		joints.Head.rotation=joints.Head.rotation.lerp(Vector3(0.72+pitch*0.16,0,0),weight)
		for side in ["L","R"]:
			var phase := wave if side=="L" else -wave
			var leg: Node3D = joints["Leg"+side]
			var knee: Node3D = joints["Knee"+side]
			leg.position=leg.position.lerp(Vector3(-0.20 if side=="L" else 0.20,0.54,0.23),weight)
			leg.rotation=leg.rotation.lerp(Vector3(-1.10-phase*0.14,0,0),weight)
			knee.rotation.x=1.55*weight
			joints["Arm"+side].rotation=joints["Arm"+side].rotation.lerp(Vector3(1.00+phase*0.25,0,0.10 if side=="L" else -0.10),weight)
			joints["Forearm"+side].rotation=joints["Forearm"+side].rotation.lerp(Vector3(0.32-phase*0.22,0,0),weight)
			# Analytic sole placement keeps feet above ground throughout the crawl.
			var lowest := INF
			for z in [-0.22,0.13]:
				var foot: Vector3 = leg.transform * (knee.transform * Vector3(0,-0.4325,z))
				lowest=minf(lowest,foot.y+body.position.y)
			leg.position.y-=minf(lowest-0.015,0.0)*weight
		if self_aid:
			joints.ArmR.rotation=joints.ArmR.rotation.lerp(Vector3(1.60,0,-0.5),weight)
			joints.ForearmR.rotation=joints.ForearmR.rotation.lerp(Vector3(1.1+sin(clock*3)*0.08,0,-0.4),weight)
	var carrying: bool=state.get("carryingId")!=null and not downed
	if joints.has("CarryParcel"): joints.CarryParcel.visible=carrying
	if carrying:
		for side in ["L","R"]:
			joints["Arm"+side].rotation=Vector3(.8,0,.12 if side=="L" else -.12)
			joints["Forearm"+side].rotation=Vector3(.85,0,0)
	if weapon_root != null:
		weapon_root.visible = social_weight <= 0 and not carrying and not swim and not downed and crawl_weight<0.15 and rescue_weight<0.15 and not equipment_id.is_empty()
		var target_pitch := pitch if gun else (-0.50 if is_rod else 0.18)
		if is_rod:
			var line: Dictionary=fishing if fishing is Dictionary else {}
			var pull_weight := rod_pull_blend
			target_pitch-=pull_weight*0.23
			var rod_model: Node3D=weapon_root.get_node("FishingRod") if weapon_root.has_node("FishingRod") else weapon_root
			OfficeTools.RodFlex.animate(rod_model,pull_weight,delta,not line.is_empty())
		if equipment_id == "knife" and melee > 0: target_pitch = -sin(_phase("melee") * PI) * 1.4
		if is_rod and _pulse("cast") > 0: target_pitch += -0.85 + smoothstep(0.2, 0.65, _phase("cast")) * 1.35
		weapon_root.rotation.x = target_pitch - joints.ArmR.rotation.x - joints.ForearmR.rotation.x - joints.Torso.rotation.x
		weapon_root.rotation.z = -joints.ArmR.rotation.z - joints.ForearmR.rotation.z
		if gun and (state.get("reload") is Dictionary or _pulse("reload") > 0): weapon_root.rotation.z -= 0.5

func _animate_crab() -> void:
	var name := str(state.get("state", "CHASE")).to_upper()
	var warning := smoothstep(0.0, 1.0, _enemy_warning)
	var breath := 0.5 + sin(clock * 5.0) * 0.5
	var locomotion := move_weight * (1.0 - warning * 0.85) * (1.0 - _enemy_stun * 0.8)
	joints.Torso.position.y += sin(stride * 2) * locomotion * 0.035 - _enemy_recover * 0.035
	joints.Torso.rotation.z = sin(stride) * locomotion * 0.06
	var charge_prep := str(state.get("attackKind", "melee")) == "charge"
	var preparing_kind := str(state.get("attackKind","melee"))
	for side in [-1.0, 1.0]:
		var suffix := "L" if side < 0 else "R"
		for index in range(3):
			var phase: float = stride + index * 2.1 + (PI if side > 0 else 0)
			_rotate("Leg" + suffix + str(index), Vector3(0, sin(phase) * locomotion * 0.40, side * (maxf(0, cos(phase)) * locomotion * 0.28 + warning * 0.07)))
		var resting := -0.10 + sin(clock * 2 + side) * 0.07
		_rotate("Claw" + suffix, Vector3(lerpf(resting, 0.22 if charge_prep else 0.88 + breath * 0.06, warning), side * -0.08, side * lerpf(0.05, 0.30, warning)))
		_rotate("Pincer" + suffix, Vector3(0, side * lerpf(0.10 + breath * 0.06, 0.48, warning), 0))
		if preparing_kind in ["claw_left","claw_right"]:
			var chosen: bool = (side<0 and preparing_kind=="claw_left") or (side>0 and preparing_kind=="claw_right")
			joints["Claw"+suffix].rotation=Vector3(warning*(.65 if chosen else .08),side*warning*(.65 if chosen else .08),side*.12)
			joints.Torso.rotation.y=warning*(.18 if preparing_kind=="claw_left" else -.18)
	joints.Torso.scale = Vector3(1 + warning * 0.035, 1 - warning * (0.14 + breath * 0.025), 1 + warning * 0.035)
	joints.Torso.position.y -= warning * 0.045
	var attack := _pulse("attack")
	if attack > 0:
		var strike := strike_weight()
		var driving := attack_kind in ["charge","dash"]
		var slam := attack_kind in ["slam","overload_ring","stamp_marks"]
		joints.ClawL.rotation.x = lerpf(joints.ClawL.rotation.x, -0.12 if driving else -1.05 if slam else -0.72, strike)
		joints.ClawR.rotation.x = lerpf(joints.ClawR.rotation.x, -0.12 if driving else -1.05 if slam else -0.32, strike)
		if not driving and not slam: joints.Torso.rotation.y += strike*.26
		if attack_kind in ["claw_left","claw_right"]:
			var selected := "L" if attack_kind=="claw_left" else "R"
			var other := "R" if selected=="L" else "L"
			joints["Claw"+selected].rotation.x=-strike*.85
			joints["Claw"+selected].rotation.y=strike*(.55 if selected=="L" else -.55)
			joints["Claw"+other].rotation.x=-.08
			joints.Torso.rotation.y=strike*(.3 if selected=="L" else -.3)
		joints.PincerL.rotation.y = lerpf(joints.PincerL.rotation.y, -0.02, strike)
		joints.PincerR.rotation.y = lerpf(joints.PincerR.rotation.y, 0.02, strike)
		joints.Torso.position.z -= strike * (.30 if driving else .22)
		joints.Torso.position.y -= strike * (.15 if slam else .04)
		joints.Torso.rotation.x += strike * (.25 if slam else .16)
	if name == "CHARGE":
		joints.Torso.rotation.x += 0.14 * move_weight
		joints.ClawL.rotation.x = lerpf(joints.ClawL.rotation.x, -0.05, move_weight)
		joints.ClawR.rotation.x = lerpf(joints.ClawR.rotation.x, -0.05, move_weight)
	joints.Torso.position.y -= _enemy_stun * 0.08
	joints.Torso.rotation.z += sin(clock * 3.5) * _enemy_stun * 0.035
	joints.ClawL.rotation.z -= _enemy_stun * 0.38
	joints.ClawR.rotation.z += _enemy_stun * 0.38
	if weak_point != null:
		var exposed := bool(state.get("weak", false)) or name == "WEAK"
		weak_point.scale = Vector3.ONE * (1.20 + sin(clock * 4.0) * 0.06 if exposed else 1.0)
		weak_material.emission_energy_multiplier = 0.75 + breath * 0.20 if exposed else 0.20
		weak_material.albedo_color = Color("efb956") if exposed else Color("bd9161")

func _animate_eel(delta: float) -> void:
	var name := str(state.get("state", "CHASE")).to_upper()
	var warning := name.contains("WINDUP")
	# Preserve the integrated phase fix. Never multiply total age by changing speed.
	_eel_warning = move_toward(_eel_warning, 1.0 if warning else 0.0, delta * 4.0)
	var coil := smoothstep(0.0, 1.0, _eel_warning)
	var recovery := maxf(_enemy_stun, _enemy_recover * 0.6)
	var frequency := lerpf(4.0 + move_weight * 4.0, 6.0, coil) * (1.0 - recovery * 0.45)
	_eel_wave_phase = fposmod(_eel_wave_phase + delta * frequency, TAU)
	var amplitude := lerpf(0.12 + move_weight * 0.16, 0.10, coil) * (1.0 - recovery * 0.40)
	for index in range(8):
		var segment: Node3D = joints["Segment" + str(index)]
		segment.rotation.y = sin(_eel_wave_phase - index * 0.7) * amplitude
		segment.rotation.x = cos(clock * 2.5 - index * 0.6) * 0.035
		segment.rotation.y += 0.24 * coil if index > 1 else 0.0
	joints.Segment0.position.y += 0.17 * coil - recovery * 0.04
	joints.Segment0.rotation.x += recovery * 0.10
	var strike := 0.0
	if _pulse("attack") > 0:
		var progress := _phase("attack")
		strike = smoothstep(0, 0.22, progress) * (1 - smoothstep(0.35, 1, progress))
		joints.Segment0.position.z -= strike * 0.26
		joints.Segment0.rotation.x -= strike * 0.18
	if joints.has("Jaw"):
		joints.Jaw.rotation.x = -0.28 * coil - 0.42 * strike

func _animate_fish() -> void:
	var warning := smoothstep(0.0, 1.0, _enemy_warning)
	var calm := maxf(_enemy_recover, _enemy_stun * 0.40)
	var flap := sin(stride) * (0.36 + move_weight * 0.30) * (1 - calm * 0.40)
	joints.Tail.rotation.y = flap
	joints.FinL.rotation.z = sin(stride - 0.6) * 0.24
	joints.FinR.rotation.z = -sin(stride - 0.6) * 0.24
	joints.Torso.rotation.z = sin(clock * 4.0) * (0.08 + _enemy_stun * 0.13)
	joints.Torso.position.y += absf(sin(clock * 4.0)) * (0.035 + _enemy_stun * 0.035)
	joints.Torso.rotation.x = -0.20 * warning + 0.08 * _enemy_recover
	joints.Torso.scale = Vector3(1 + warning * 0.06, 1 - warning * 0.12, 1 + warning * 0.05)
	if _pulse("attack") > 0:
		var progress := _phase("attack")
		var strike := smoothstep(0, 0.20, progress) * (1 - smoothstep(0.40, 1, progress))
		joints.Torso.position.z -= strike * 0.20
		joints.Torso.position.y += strike * 0.12
		joints.Torso.rotation.x += strike * 0.32

func muzzle_position() -> Vector3:
	if is_instance_valid(muzzle): return muzzle.global_position
	return global_transform * Vector3(0, 1.1 if kind == "fisherman" else 0.45, -0.6)

func _animate_enemy_state(delta: float) -> void:
	var next := str(state.get("state", "CHASE")).to_upper()
	var timeline: Dictionary = state.get("attackTimeline",{}) if state.get("attackTimeline") is Dictionary else {}
	if next.contains("WINDUP") and not timeline.is_empty():
		var now := _number(state.get("serverTime"),0)+(clock-state_sample_clock)
		_enemy_warning=clampf((now-_number(timeline.get("startedAt"),now))/maxf(.1,_number(timeline.get("windup"),1)),0,1)
	else:
		_enemy_warning = move_toward(_enemy_warning, 1.0 if next.contains("WINDUP") else 0.0, delta * 5.5)
	_enemy_stun = move_toward(_enemy_stun, 1.0 if next in ["STUNNED", "WEAK"] else 0.0, delta * 4.5)
	_enemy_recover = move_toward(_enemy_recover, 1.0 if next in ["RECOVER","FOLLOW_THROUGH"] else 0.0, delta * 3.5)


func _build_office_details() -> void:
	if kind=="fisherman":
		_geometry(joints.Torso,[
			_cube(Vector3(-0.045,0.09,-0.185),Vector3(0.025,0.30,0.020),GOLD,Vector3(0,0,-0.20)),
			_cube(Vector3(0.045,0.09,-0.185),Vector3(0.025,0.30,0.020),GOLD,Vector3(0,0,0.20)),
			_cube(Vector3(0,-0.06,-0.207),Vector3(0.15,0.18,0.025),IVORY),
			_cube(Vector3(-0.034,-0.043,-0.224),Vector3(0.043,0.048,0.012),SHIRTS[0]),
			_cube(Vector3(0.025,-0.09,-0.224),Vector3(0.055,0.022,0.012),DARK)])
	elif kind in ["crab","boss_crab"]:
		var torso: Node3D=joints.Torso
		_geometry(torso,[
			_cube(Vector3(0,0.28,0),Vector3(0.98,0.045,0.78),Color("7194ad")),
			# Separate the cover from both faces of the crab body by 1 cm.
			_cube(Vector3(-0.44,0.20,0),Vector3(0.12,0.18,0.81),Color("344c5d")),
			_cube(Vector3(0.31,0.30,0.36),Vector3(0.23,0.07,0.17),GOLD),
			_cube(Vector3(0.08,0.309,-0.08),Vector3(0.31,0.025,0.29),IVORY),
			_cube(Vector3(0.08,0.327,-0.08),Vector3(0.21,0.015,0.025),Color("db6950"))])
		if kind=="boss_crab":
			var pages: Array=[]
			for i in range(5):
				pages.append(_cube(Vector3((i%2)*0.06,0.075*i,0),Vector3(0.67,0.06,0.52),IVORY if i%2 else Color("e6cb9c"),Vector3(0,(i-2)*0.10,0)))
			pages.append(_cube(Vector3(0,0.35,0),Vector3(0.75,0.065,0.60),Color("d9775c")))
			_joint(torso,"PaperStack",Vector3(0,0.34,0.08),pages)
			_joint(torso,"AuditStamp",Vector3(0,0.59,-0.05),[
				_cube(Vector3.ZERO,Vector3(0.79,0.17,0.63),Color("b8554c")),
				_cube(Vector3(0,0.27,0),Vector3(0.16,0.45,0.16),DARK),
				_cube(Vector3(0,0.49,0),Vector3(0.40,0.13,0.30),Color("b8554c"))])
			var coils: Array=[]
			for side in [-1.0,1.0]:
				for i in range(3):
					coils.append(_cube(Vector3(side*0.40,0.10+i*0.15,0),Vector3(0.20,0.10,0.47),GOLD if i%2==0 else Color("599faf")))
			_joint(torso,"PowerCoils",Vector3(0,0.35,0.06),coils)
	elif kind=="eel":
		for i in [1,3,5]:
			_geometry(joints["Segment"+str(i)],[
				_cube(Vector3(0,0.19,0),Vector3(0.28,0.025,0.16),IVORY),
				_cube(Vector3(-0.05,0.206,0),Vector3(0.02,0.012,0.13),GOLD,Vector3(0,-0.6,0)),
				_cube(Vector3(0.05,0.206,0),Vector3(0.02,0.012,0.13),GOLD,Vector3(0,0.6,0))])
		_joint(joints.Segment0,"Reminder",Vector3(0,0.35,0),[
			_cube(Vector3.ZERO,Vector3(0.36,0.32,0.055),GOLD),
			_cube(Vector3(0,0.045,-0.032),Vector3(0.055,0.15,0.016),DARK),
			_cube(Vector3(0,-0.09,-0.032),Vector3(0.055,0.045,0.016),DARK)])
	else:
		for side in [-1.0,1.0]:
			_joint(joints.Torso,"Note"+("L" if side<0 else "R"),Vector3(side*0.17,0.16,0.05),[
				_cube(Vector3(side*0.07,0.06,0.03),Vector3(0.018,0.26,0.22),GOLD if side<0 else Color("ed9b93")),
				_cube(Vector3(side*0.083,0.08,0.015),Vector3(0.008,0.018,0.13),IVORY)])

func _animate_office_details() -> void:
	var marked := float(state.get("markedRemaining",0))-(clock-state_sample_clock)>0 and not _dead
	if marked and not is_instance_valid(assembly_mark):
		assembly_mark=Node3D.new()
		assembly_mark.name="AssemblyMark"
		add_child(assembly_mark)
		OfficeTools.box(assembly_mark,Vector3.ZERO,Vector3(.26,.06,.10),Color("7ec8bd"),true)
		OfficeTools.box(assembly_mark,Vector3(0,-.07,0),Vector3(.11,.08,.10),Color("7ec8bd"),true)
	if is_instance_valid(assembly_mark):
		assembly_mark.visible=marked
		assembly_mark.position.y=(3.2 if kind.begins_with("boss") else 1.4)+sin(clock*4)*.04
	if joints.has("NoteL"):
		joints.NoteL.rotation.z=0.16+sin(stride*0.8)*0.22
		joints.NoteR.rotation.z=-0.16-sin(stride*0.8-0.5)*0.22
	if joints.has("Reminder"):
		var warning:=smoothstep(0,1,_eel_warning)
		joints.Reminder.position.y+=warning*0.17
		joints.Reminder.scale=Vector3.ONE*(0.66+warning*0.34)
		joints.Reminder.rotation.x=-warning*0.10
	if joints.has("PaperStack"):
		var variant := str(state.get("variantId","base"))
		var shown_attack := attack_kind if _pulse("attack")>0 else str(state.get("attackKind",""))
		joints.AuditStamp.visible=variant=="auditor"
		joints.PowerCoils.visible=variant=="overload"
		if variant=="auditor":
			joints.AuditStamp.position.y+=_enemy_warning*(.42 if shown_attack=="stamp_marks" else .18)-strike_weight()*.58
			joints.AuditStamp.rotation.x=-_enemy_warning*0.25+strike_weight()*0.5
			joints.AuditStamp.scale=Vector3(1.18,1.20,1.12)
		elif variant=="overload":
			joints.PowerCoils.position.y+=_enemy_warning*.18
			joints.PowerCoils.scale=Vector3(1.25,1.15+_enemy_warning*.22,1.15)
			joints.PowerCoils.rotation.y=sin(clock*2.6)*_enemy_warning*.10
		var exposure:=smoothstep(0,1,_enemy_stun)
		joints.PaperStack.rotation.x=-exposure*0.42
		joints.PaperStack.position.y+=exposure*0.14
		joints.PaperStack.rotation.z=sin(clock*3)*exposure*0.06
	if kind=="fisherman" and is_instance_valid(weapon_root) and weapon_root.has_node("OfficeTool"):
		OfficeTools.animate_tool(weapon_root.get_node("OfficeTool"),equipment_id,_pulse("shot")*0.1,state.get("reload") is Dictionary or _pulse("reload")>0,clock if not _ages.has("reload") else float(_ages.reload),float(_lengths.get("reload",1.7)))
	if equipment_id=="rod_net" and is_instance_valid(weapon_root) and weapon_root.has_node("FishingRod"):
		var fishing: Dictionary = state.fishing if state.get("fishing") is Dictionary else {}
		OfficeTools.animate_net(weapon_root.get_node("FishingRod"),fishing,clock,_pulse("cast"))
