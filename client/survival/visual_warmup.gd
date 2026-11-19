extends RefCounted

const Actor = preload("res://survival/actor.gd")
const Props = preload("res://survival/props.gd")
const ProjectileView = preload("res://survival/projectile_view.gd")
const EnemyStrike = preload("res://survival/enemy_strike.gd")

# BaseMaterial3D frees its generated shader when its last material is released.
# Keep one actually drawn weak-point material alive after the temporary rig is
# freed. Live bosses still create independent materials for their own feedback.
static var _boss_weak_material_keepalive: StandardMaterial3D

# Loading-only, one existing camera/viewport. Every current scene Omni is muted
# locally, then one shadowless probe light covers the same meshes on/off. This
# compiles both lit and DISABLE_LIGHT_OMNI variants, even on an outside rejoin.
static func run(view) -> void:
	if not is_instance_valid(view): return
	if not _alive(view, view.camera): return
	var camera: Camera3D = view.camera
	var equipped: String = view.weapon
	var real_sources: Dictionary = view.impact_sources
	var real_water: float = view.effect_water_y
	view.impact_sources = {}
	view.effect_water_y = -1000.0
	var real_effects: Array = view.effects
	view.effects = []
	var previous_motion := {}
	for key in ["recoil", "shake", "muzzle_time", "swing_time", "bloom", "equip_time", "hit_time", "reload_active", "reload_elapsed", "aim_blend", "aim_ready", "aim_requested", "punch_time"]:
		previous_motion[key] = view.get(key)
	var previous_stats: Dictionary = view.stats.duplicate(true)
	var scene_lights: Array = []
	# The view's parent is this Game, not the SceneTree root or another viewport.
	for light in view.get_parent().find_children("*", "OmniLight3D", true, false):
		scene_lights.append({"node":light, "visible":light.visible})
		light.visible = false
	var probe_light := OmniLight3D.new()
	probe_light.name = "VisualWarmupOmni"
	probe_light.omni_range = 15.0
	probe_light.light_energy = 1.1
	probe_light.light_color = Color("eeb957")
	probe_light.shadow_enabled = false
	camera.add_child(probe_light)
	probe_light.position = Vector3(0, 0, -1.5)
	var owned: Array = []
	for omni_enabled in [true, false]:
		probe_light.visible = omni_enabled
		if not await _draw_content(view, camera, owned): break
	# Both success and an early scene exit reach this same cleanup path. Never
	# delete pre-existing real FX or restore a light that no longer exists.
	for node in owned:
		if is_instance_valid(node): node.free()
	if is_instance_valid(probe_light): probe_light.free()
	for entry in scene_lights:
		if is_instance_valid(entry.node): entry.node.visible = entry.visible
	if not is_instance_valid(view): return
	for effect in view.effects:
		if is_instance_valid(effect.node): effect.node.queue_free()
	view.effects = real_effects
	view.impact_sources = real_sources
	view.effect_water_y = real_water
	view.stats = previous_stats
	if _alive(view, camera):
		view.equip(equipped)
		view.animate(0.0, 0.0, false, false, false, false)
	for key in previous_motion:
		view.set(key, previous_motion[key])

static func _alive(view, camera) -> bool:
	return is_instance_valid(view) and is_instance_valid(camera) and view.is_inside_tree() and camera.is_inside_tree()

static func _draw_frames(view, camera: Camera3D, frames: int) -> bool:
	for frame in range(frames):
		if not _alive(view, camera): return false
		await RenderingServer.frame_post_draw
		if not _alive(view, camera): return false
	return true

static func _draw_content(view, camera: Camera3D, owned: Array) -> bool:
	# Compile the resolved-attack shader before the first live monster strike.
	# Its vertex-color/UV animation is separate from the warning-zone material.
	var strike := EnemyStrike.new()
	owned.append(strike)
	camera.add_child(strike)
	strike.setup({"attackKind":"slam","zone":{"shape":"circle","x":0,"y":-0.8,"z":-3,"radius":0.9}})
	if not await _draw_frames(view,camera,2): return false
	strike.advance(0.38)
	if not await _draw_frames(view,camera,2): return false
	strike.free()
	# Own damage numbers use the real depth-free font material, including its
	# fading state. Ordinary world labels do not compile this shader variant.
	# Effects are isolated by run(); these local calls never send a combat action.
	view.confirm_hit(camera.global_transform * Vector3(-0.3, -0.3, -2.5), 1234567890, false)
	view.confirm_hit(camera.global_transform * Vector3(0.3, -0.5, -2.8), 1234567890, true, true, true)
	if not await _draw_frames(view, camera, 2): return false
	view._update_effects(0.68)
	if not await _draw_frames(view, camera, 2): return false
	view.equip("carbine")
	view.animate(0.0, 0.0, false, false, false, true)
	view.fire()
	view.models.carbine.get_node("Muzzle/Flash").visible = true
	var near_point: Vector3 = camera.global_transform * Vector3(-0.25, 0.05, -2.2)
	var far_point: Vector3 = camera.global_transform * Vector3(0.25, 0.05, -4.0)
	view.remote_muzzle(near_point)
	view.tracer(near_point, far_point, "carbine")
	var impact_owner := Node3D.new()
	view.add_child(impact_owner)
	owned.append(impact_owner)
	view.impact_sources["warmup-mark"] = {"node":impact_owner,"signature":"probe"}
	view.impact(far_point, camera.global_basis.z, "wood", "warmup-mark")
	view.ripple(camera.global_transform * Vector3(0, -0.25, -2.8))
	# These are visible camera-frustum meshes, not hidden instances or alpha-zero boxes.
	if not await _draw_frames(view, camera, 5): return false
	# Imported rods use a different shader variant from the office tool meshes.
	# Compile each visible model during loading, before a player's first switch.
	# This changes only the local view; no equip command or gameplay shot is sent.
	for model_id in preload("res://survival/aim_profile.gd").GUNS + ["knife"] + preload("res://survival/office_tools.gd").ROD_IDS + preload("res://survival/office_tools.gd").QUICK_IDS:
		view.equip(model_id)
		view.animate(0.0, 0.0, false, false, false, true)
		if not await _draw_frames(view, camera, 2): return false
	# Reuse the same actor/prop shader RID and immutable meshes in the live world.
	# Draw them in the loading scene so no first encounter blocks input or relay.
	var bolt := ProjectileView.new()
	owned.append(bolt)
	camera.add_child(bolt)
	bolt.push_sample({"x":0,"y":0,"z":-2,"vx":0,"vy":0,"vz":-6},0)
	if not await _draw_frames(view,camera,2): return false
	bolt.free()
	for actor_kind in ["crab","eel","silverfish","boss_crab"] + preload("res://survival/office_bosses.gd").KINDS + preload("res://survival/office_monsters.gd").KINDS:
		var rig := Actor.new()
		owned.append(rig)
		camera.add_child(rig)
		rig.setup(actor_kind)
		if actor_kind == "boss_crab" and _boss_weak_material_keepalive == null:
			_boss_weak_material_keepalive = rig.weak_material
		rig.position=Vector3(-0.2,-0.45,-2.5)
		rig.scale=Vector3.ONE*0.55
		# The optional boss attachments start hidden. Draw each real silhouette
		# during loading so its first night does not introduce an unseen mesh.
		if actor_kind == "boss_crab":
			for variant in ["base", "auditor", "overload"]:
				rig.apply_state({"variantId":variant,"state":"CHASE","hp":1})
				rig.animate(0.0, Vector3.ZERO)
				if not await _draw_frames(view, camera, 2): return false
		else:
			if not await _draw_frames(view, camera, 2): return false
		rig.set_visual_distance_squared(40.0 * 40.0)
		if not await _draw_frames(view, camera, 2): return false
		rig.free()
	var prop := Props.new()
	owned.append(prop)
	camera.add_child(prop)
	prop.setup({"id":"warmup","x":0.35,"y":-0.5,"z":-2.5,"size":{"x":0.5,"y":0.5,"z":0.5},"kind":"crate"})
	if not await _draw_frames(view, camera, 2): return false
	prop.free()
	# Exact authoritative sizes are part of Props' retained mesh key.
	var warm_props: Array=JSON.parse_string('[{"kind":"partition_panel","size":{"x":1.25,"y":2.2,"z":0.32},"hp":55},{"kind":"archive_cabinet","size":{"x":1.2,"y":1.8,"z":1},"hp":90},{"kind":"copier_shell","size":{"x":1.35,"y":1.25,"z":0.95},"hp":75},{"kind":"supply_locker","size":{"x":0.85,"y":1.75,"z":0.65},"hp":65},{"kind":"cable_reel","size":{"x":1.3,"y":0.7,"z":0.85},"hp":50},{"kind":"punch_clock","size":{"x":0.72,"y":1.1,"z":0.5},"hp":45},{"kind":"notice_board","size":{"x":1.8,"y":1.35,"z":0.16},"hp":40}]')
	for definition in warm_props:
		var instance:=Props.new()
		owned.append(instance)
		camera.add_child(instance)
		var data: Dictionary={"id":"warm-special","x":0,"y":-.8,"z":-3,"kind":definition.kind,"size":definition.size,"hp":definition.hp,"maxHp":definition.hp,"opened":false}
		instance.setup(data)
		if not await _draw_frames(view,camera,2): return false
		data.hp=float(definition.hp)*.4
		instance.apply_state(data)
		if not await _draw_frames(view,camera,2): return false
		data.opened=true
		instance.apply_state(data)
		if not await _draw_frames(view,camera,2): return false
		instance.free()
	for kind in ["scrap","treasure","backpack"]:
		var prop_root := Node3D.new()
		owned.append(prop_root)
		camera.add_child(prop_root)
		prop_root.position=Vector3(0,-0.6,-2.5)
		if kind=="backpack": preload("res://survival/office_scene.gd").backpack_visual(prop_root)
		else: preload("res://survival/office_scene.gd").search_visual(prop_root,kind)
		if not await _draw_frames(view, camera, 2): return false
		prop_root.free()
	# Bake and retain every event variant before entry. Mesh baking/packing can
	# synchronously read buffers in WebGL; live DAY snapshots only instantiate.
	for kind in ["receiver","supply_carry","desk_alarm","desk_sort","supply_seal","parcel_intact","parcel_rush","desk_stamp","desk_print","supply_dial","supply_cool","parcel_invoice","parcel_relay"]:
		for index in range(3 if kind in ["desk_sort","parcel_rush","desk_stamp","parcel_invoice"] else 1):
			var event_root := Node3D.new()
			owned.append(event_root)
			camera.add_child(event_root)
			event_root.position=Vector3(0,-0.6,-2.5)
			preload("res://survival/exploration_view.gd").build(event_root,kind,index)
			if not await _draw_frames(view,camera,2): return false
			event_root.free()
	var zone := preload("res://survival/combat_zone.gd").new()
	owned.append(zone)
	view.add_child(zone)
	var zone_at := camera.global_transform*Vector3(0,-0.5,-2.5)
	zone.update_zone({"x":zone_at.x,"y":zone_at.y,"z":zone_at.z,"radius":0.5})
	if not await _draw_frames(view, camera, 2): return false
	zone.free()
	var label: Label3D = view.get_parent()._label3d(camera, "返工蟹 100/100\n旧工位 · 按住 E", Vector3(0,0.2,-2.5))
	owned.append(label)
	if not await _draw_frames(view, camera, 2): return false
	label.free()
	return true
