extends RefCounted

const Presentation = preload("res://survival/fishing_presentation.gd")
const Batch = preload("res://survival/static_mesh_batch.gd")
const Library = preload("res://survival/visual_library.gd")
const CREAM := Color("f3e4bb")
const FISH := Color("174756")
const FIN := Color("426c76")

static func create(view) -> Node3D:
	var node := Node3D.new()
	node.name = "FishingWater"
	if not Library.reuse("fishing:water:v093", node):
		var body: MeshInstance3D = view.box(node, Vector3.ZERO, Vector3(0.15, 0.13, 0.15), Color("f1754f"))
		body.name = "FloatBody"
		var tip: MeshInstance3D = view.box(node, Vector3(0, 0.12, 0), Vector3(0.055, 0.20, 0.055), CREAM)
		tip.name = "FloatTip"
		for index in range(8):
			var line: MeshInstance3D = view.box(node, Vector3.ZERO, Vector3(0.009, 0.009, 1.0), CREAM)
			line.name = "Line%d" % index
		var ripple := MeshInstance3D.new()
		ripple.name = "Ripple"
		var ring := TorusMesh.new()
		ring.inner_radius = 0.24
		ring.outer_radius = 0.28
		ring.rings = 20
		ring.ring_segments = 4
		ripple.mesh = ring
		ripple.material_override = view.material(Color("bbdfd9"), true)
		ripple.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(ripple)
		var lure := _group(node, "Lure")
		view.box(lure, Vector3.ZERO, Vector3(0.11, 0.07, 0.28), Color("4db5bc"))
		view.box(lure, Vector3(0, 0.012, -0.11), Vector3(0.12, 0.048, 0.06), CREAM)
		Batch.merge_tree(lure)
		var magnet := _group(node, "Magnet")
		view.box(magnet, Vector3(0, 0, 0.055), Vector3(0.24, 0.08, 0.06), Color("e56950"))
		for side in [-1, 1]:
			view.box(magnet, Vector3(side * 0.09, 0, -0.055), Vector3(0.06, 0.08, 0.16), Color("e56950"))
			view.box(magnet, Vector3(side * 0.09, 0.003, -0.14), Vector3(0.062, 0.086, 0.035), Color("b1d0d2"))
		Batch.merge_tree(magnet)
		var target := _group(node, "Target")
		var fish := _group(target, "FishBody")
		view.box(fish, Vector3(0, 0, -0.06), Vector3(0.28, 0.06, 0.58), FISH)
		view.box(fish, Vector3(0, 0.006, -0.28), Vector3(0.17, 0.066, 0.17), FISH)
		view.box(fish, Vector3(0, -0.013, 0.005), Vector3(0.52, 0.025, 0.12), FIN)
		Batch.merge_tree(fish)
		var tail := _group(target, "Tail")
		tail.position.z = 0.24
		view.box(tail, Vector3(0, 0, 0.075), Vector3(0.24, 0.038, 0.17), FIN)
		var metal := _group(node, "Metal")
		view.box(metal, Vector3.ZERO, Vector3(0.45, 0.16, 0.34), Color("8dafb6"))
		view.box(metal, Vector3(0, 0.095, 0), Vector3(0.46, 0.03, 0.35), Color("d6d6bd"))
		view.box(metal, Vector3(0, 0.128, 0), Vector3(0.17, 0.03, 0.09), Color("e7b84e"))
		Batch.merge_tree(metal)
		var net := _group(node,"WaterNet")
		for index in range(9):
			var offset := -.8+index*.2
			view.box(net,Vector3(offset,0,0),Vector3(.009,.009,1.6),CREAM)
			view.box(net,Vector3(0,.011,offset),Vector3(1.6,.009,.009),Color("ad90c5"))
		Batch.merge_tree(net)
		var second := target.duplicate()
		second.name="SecondFish"
		node.add_child(second)
		Library.remember("fishing:water:v093", node)
	var lines: Array[MeshInstance3D] = []
	for index in range(8): lines.append(node.get_node("Line%d" % index))
	node.set_meta("parts", {"body":node.get_node("FloatBody"), "tip":node.get_node("FloatTip"), "lure":node.get_node("Lure"), "magnet":node.get_node("Magnet"), "ripple":node.get_node("Ripple"), "target":node.get_node("Target"), "tail":node.get_node("Target/Tail"), "metal":node.get_node("Metal"), "lines":lines})
	node.set_meta("cast_id", "")
	node.set_meta("age", 0.0)
	node.set_meta("splashed", false)
	node.set_meta("net",node.get_node("WaterNet"))
	node.set_meta("second_fish",node.get_node("SecondFish"))
	node.get_node("Target").visible = false
	node.get_node("Metal").visible = false
	return node

static func _group(parent: Node3D, name: String) -> Node3D:
	var group := Node3D.new()
	group.name = name
	parent.add_child(group)
	return group

static func _duration(game, actor: Dictionary) -> float:
	var id := str(actor.get("heldDefinitionId", actor.get("equipmentDefinitionId", "rod_basic")))
	for definition in game.config.get("rods", []):
		if str(definition.get("id", "")) == id: return maxf(0.1, float(definition.get("cast_seconds", 0.8)))
	return 0.8

static func _water(game, point: Vector3, water_y: float) -> bool:
	return float(game.world.ground_height(point.x, point.z)) < water_y - 0.035

static func _clip(game, desired: Vector3, anchor: Vector3, water_y: float) -> Vector3:
	desired.y = water_y
	if _water(game, desired, water_y): return desired
	# The authoritative cast anchor is the safe endpoint. Six bounded subdivisions
	# keep all presentation on sea, including shallow channels and tide changes.
	var safe := anchor
	safe.y = water_y
	if not _water(game, safe, water_y): return safe
	var blocked := desired
	for index in range(6):
		var middle := safe.lerp(blocked, 0.5)
		if _water(game, middle, water_y): safe = middle
		else: blocked = middle
	return safe

static func _point(origin: Vector3, anchor: Vector3, shape: Vector2) -> Vector3:
	var offset := anchor - origin
	offset.y = 0.0
	var sideways := Vector3(-offset.z, 0, offset.x).normalized()
	return origin + offset * shape.x + sideways * shape.y

static func _audio(game, node: Node3D, fishing: Dictionary, id: String, dt: float) -> void:
	var state := str(fishing.get("state", ""))
	var cue := str(fishing.get("cue", ""))
	var old_state := str(node.get_meta("sound_state", state))
	var old_cue := str(node.get_meta("sound_cue", cue))
	node.set_meta("sound_state", state)
	node.set_meta("sound_cue", cue)
	var wait := maxf(0.0, float(node.get_meta("sound_wait", 0.0)) - dt)
	node.set_meta("sound_wait", wait)
	var mine := id == str(game.self_id)
	var gain: float = 0.40 if mine else float(game._audibility(id)) * 0.14
	if not mine and node.global_position.distance_squared_to(game.local_pos) > 576.0: return
	if gain <= 0.001: return
	var style := Presentation.mode(fishing)
	if style == "magnet" and old_state == "WAIT" and state == "REEL":
		game._cue("metal_catch", gain * 1.2)
		node.set_meta("sound_wait", 0.30)
		return
	if style=="net" and old_state=="WAIT" and state=="REEL":
		game._cue("net_close",gain)
		node.set_meta("sound_wait",.30)
		return
	if cue != old_cue and cue == "snag":
		game._cue("snag", gain)
		node.set_meta("sound_wait", 0.35)
		return
	if cue != old_cue and cue == "free":
		game._cue("metal_catch", gain * 0.85)
		node.set_meta("sound_wait", 0.30)
		return
	if old_state != "BITE" and state == "BITE":
		game._cue("splash", gain * 0.8)
		node.set_meta("sound_wait", 0.30)
		return
	if wait > 0.0: return
	if style == "magnet" and state == "WAIT" and bool(fishing.get("reeling", false)):
		game._cue("sonar", gain * (0.30 + float(fishing.get("signal", 0)) * 0.35))
		node.set_meta("sound_wait", 0.95 - clampf(float(fishing.get("signal", 0)), 0, 1) * 0.50)
	elif state == "REEL" and cue == "rush" and not bool(fishing.get("reeling", false)):
		game._cue("spool", gain * 0.75)
		node.set_meta("sound_wait", 0.58)
	elif Presentation.reel_weight(fishing) > 0.0:
		game._cue("reel", gain * 0.35)
		node.set_meta("sound_wait", 0.48)

static func update(game, node: Node3D, actor: Dictionary, delta: float) -> void:
	if not actor.get("fishing") is Dictionary: return
	var fishing: Dictionary = actor.fishing
	var state := str(fishing.get("state", ""))
	var id := str(actor.get("id", ""))
	var cast_id := str(fishing.get("id", ""))
	var water_y := float(game.state.get("waterY", 0))
	var anchor: Vector3 = game._v(node.get_meta("pool", fishing))
	anchor.y = water_y
	var duration := float(node.get_meta("duration", 0.8))
	if cast_id != str(node.get_meta("cast_id", "")):
		duration = _duration(game, actor)
		node.set_meta("duration", duration)
		node.set_meta("cast_id", cast_id)
		node.set_meta("age", maxf(0.0, duration - float(fishing.get("remaining", duration))) if state == "CAST" else duration)
		node.set_meta("splashed", state != "CAST")
		node.set_meta("water_point", anchor)
		node.set_meta("target_point", anchor)
		node.set_meta("last_cue", str(fishing.get("cue", "")))
		node.set_meta("sound_state", state)
		node.set_meta("sound_cue", str(fishing.get("cue", "")))
		node.set_meta("sound_wait", 0.45)
		node.set_meta("tail_phase", 0.0)
		node.set_meta("ripple_phase", 0.0)
		node.get_node("Target").visible = false
	var age := float(node.get_meta("age", 0.0)) + maxf(delta, 0.0)
	node.set_meta("age", age)
	var style := Presentation.mode(fishing)
	var cue := str(fishing.get("cue", ""))
	node.visible = (id == str(game.self_id) or anchor.distance_squared_to(game.local_pos) < 3025.0) and (state == "CAST" or _water(game, anchor, water_y))
	if not node.visible:
		# A distant cast keeps its lifecycle without replaying old sounds on return.
		node.set_meta("splashed", state != "CAST")
		node.set_meta("sound_state", state)
		node.set_meta("sound_cue", cue)
		return
	var parts: Dictionary = node.get_meta("parts")
	var origin: Vector3 = game.local_pos if id == str(game.self_id) else game._v(actor)
	var from := origin + Vector3.UP * 1.6
	if id == str(game.self_id):
		from = game.view.muzzle_position()
	elif game.actors.has(id):
		origin = game.actors[id].position
		from = game.actors[id].get_node("Rig").muzzle_position()
	origin.y = water_y
	var afloat := state != "CAST" or age >= duration
	var line_age := clampf(age / duration, 0.0, 1.0) if state == "CAST" else 1.0
	var desired := _clip(game, _point(origin, anchor, Presentation.water_shape(fishing, age)), anchor, water_y)
	var last_cue := str(node.get_meta("last_cue", ""))
	if style == "magnet" and cue == "snag":
		if last_cue != "snag": node.set_meta("snag_point", node.get_meta("water_point", desired))
		desired = _clip(game, node.get_meta("snag_point", desired), anchor, water_y)
	node.set_meta("last_cue", cue)
	var previous: Vector3 = node.get_meta("water_point", desired)
	var smooth := 1.0 - exp(-maxf(delta, 0.0) * 9.0)
	var water_point := _clip(game, previous.lerp(desired, smooth), anchor, water_y)
	node.set_meta("water_point", water_point)
	var at := from.lerp(water_point + Vector3.UP * 0.10, line_age) + Vector3.UP * sin(line_age * PI) * 2.2
	var activity := clampf(float(fishing.get("activity", 0)), 0.0, 1.0)
	if afloat:
		var bob := sin(age * 5.0) * 0.020
		if state == "BITE": bob -= 0.05 + sin(age * 12.0) * 0.018
		at.y = water_y + 0.095 + (bob if style != "magnet" else 0.0)
		if not bool(node.get_meta("splashed", false)):
			node.set_meta("splashed", true)
			var gain: float = 0.32 if id == str(game.self_id) else float(game._audibility(id)) * 0.10
			if gain > 0: game._cue("splash", gain)
	node.global_position = at
	parts.body.visible = style not in ["lure","magnet","net"]
	parts.tip.visible = parts.body.visible
	parts.lure.visible = style == "lure"
	parts.magnet.visible = style == "magnet"
	parts.lure.rotation.y = sin(age * 3.0) * activity * 0.25
	parts.magnet.rotation.y = -float(actor.get("yaw", 0))
	var ripple: MeshInstance3D = parts.ripple
	ripple.visible = afloat
	var ripple_phase := fmod(float(node.get_meta("ripple_phase", 0.0)) + maxf(delta, 0.0) * (2.1 if style == "magnet" else 2.5 + activity * 1.8), TAU)
	node.set_meta("ripple_phase", ripple_phase)
	var spread := 0.95 + sin(ripple_phase) * 0.30
	if style == "magnet": spread = (0.95 + sin(ripple_phase) * 0.28) * (0.75 + float(fishing.get("signal", 0)) * 0.45)
	ripple.scale = Vector3(spread, 0.055, spread)
	ripple.global_position = Vector3(water_point.x, water_y + 0.028, water_point.z)
	var target: Node3D = parts.target
	var target_was_visible := target.visible
	target.visible = afloat and state != "CAST" and style != "magnet"
	var shadow_desired := _clip(game, _point(origin, anchor, Presentation.shadow_shape(fishing, age)), anchor, water_y)
	var shadow_previous: Vector3 = node.get_meta("target_point", shadow_desired) if target_was_visible else shadow_desired
	var shadow := _clip(game, shadow_previous.lerp(shadow_desired, smooth * 0.75), anchor, water_y)
	node.set_meta("target_point", shadow)
	target.global_position = Vector3(shadow.x, water_y + 0.045, shadow.z)
	var water_net: Node3D = node.get_meta("net")
	water_net.visible=style=="net" and afloat
	var second_fish: Node3D = node.get_meta("second_fish")
	second_fish.visible=style=="net" and afloat and (float(fishing.get("activity",0))>=.8 or int(fishing.get("netBatch",1))>1)
	if style=="net":
		var radius := 1.0-clampf(float(fishing.get("progress",0))/100,0,1)*.65
		for attempt in range(5):
			var safe := true
			for corner in [Vector3(-1,0,-1),Vector3(-1,0,1),Vector3(1,0,-1),Vector3(1,0,1)]:
				if not _water(game,water_point+corner*radius*.8,water_y): safe=false
			if safe: break
			radius*=.7
		water_net.scale=Vector3(radius,1,radius)
		water_net.global_position=Vector3(water_point.x,water_y+.046,water_point.z)
		var second_point := _clip(game,water_point+Vector3(.28*radius,0,.30*radius),anchor,water_y)
		second_fish.global_position=Vector3(second_point.x,water_y+.019,second_point.z)
		second_fish.rotation.y=sin(age*2)*.4
	var direction := water_point - shadow if state == "WAIT" else origin - shadow
	if direction.length_squared() > 0.001:
		target.rotation.y = lerp_angle(target.rotation.y, atan2(-direction.x, -direction.z), smooth)
	var phase := float(node.get_meta("tail_phase", 0.0)) + maxf(delta, 0.0) * (3.0 + activity * 6.0)
	node.set_meta("tail_phase", phase)
	parts.tail.rotation.y = sin(phase) * (0.18 + activity * 0.32)
	match str(fishing.get("behavior", "glide")):
		"dart": target.scale = Vector3(0.70, 0.85, 0.76)
		"drag": target.scale = Vector3(1.20, 0.85, 0.86)
		"rush": target.scale = Vector3(0.95, 1.0, 1.25)
		"pulse": target.scale = Vector3(0.95 + sin(phase * 0.45) * 0.055, 1.0, 0.90)
		_: target.scale = Vector3(1.0, 1.0, 1.0)
	var metal: Node3D = parts.metal
	metal.visible = afloat and style == "magnet" and (state == "REEL" or state == "LAND")
	metal.global_position = Vector3(water_point.x, water_y - 0.075 + clampf(float(fishing.get("progress", 0)) / 100.0, 0, 1) * 0.10, water_point.z)
	metal.rotation.y = lerp_angle(metal.rotation.y, atan2(origin.x - water_point.x, origin.z - water_point.z), smooth * 0.30) if cue != "snag" else metal.rotation.y
	var sag := (0.04 + (1.0 - Presentation.pull_weight(fishing)) * 0.15) if state == "REEL" else 0.38
	var lines: Array = parts.lines
	for index in range(8):
		var p0 := float(index) / 8.0
		var p1 := float(index + 1) / 8.0
		var start := from.lerp(at, p0) - Vector3.UP * sin(p0 * PI) * sag * line_age
		var end := from.lerp(at, p1) - Vector3.UP * sin(p1 * PI) * sag * line_age
		var line: MeshInstance3D = lines[index]
		line.global_position = (start + end) * 0.5
		line.scale.z = maxf(0.001, start.distance_to(end))
		if start.distance_squared_to(end) > 0.000001: line.look_at(end)
	_audio(game, node, fishing, id, maxf(delta, 0.0))
