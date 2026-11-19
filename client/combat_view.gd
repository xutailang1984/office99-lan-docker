extends Node3D

var game
var rig: Node3D
var left_hand: Node3D
var right_hand: Node3D
var blade: Node3D
var pistol: Node3D
var weapon := "rod"
var punch_time := 0.0
var recoil := 0.0
var hit_time := 0.0
var shake := 0.0
var alternate := false
var effects: Array = []
var flash_material: StandardMaterial3D

func setup(owner_game) -> void:
	game = owner_game
	rig = Node3D.new()
	game.camera.add_child(rig)
	left_hand = _hand(Vector3(-0.39, -0.44, -0.59))
	right_hand = _hand(Vector3(0.39, -0.44, -0.59))
	blade = Node3D.new()
	right_hand.add_child(blade)
	game.world.box(blade, Vector3(0, 0.10, -0.07), Vector3(0.055, 0.30, 0.075), Color("#694b36"))
	game.world.box(blade, Vector3(0, 0.27, -0.07), Vector3(0.22, 0.035, 0.10), Color("#deb974"))
	game.world.box(blade, Vector3(0, 0.47, -0.07), Vector3(0.10, 0.39, 0.038), Color("#d8edf0"))
	game.world.box(blade, Vector3(0.035, 0.47, -0.07), Vector3(0.028, 0.36, 0.042), Color.WHITE)
	pistol = Node3D.new()
	right_hand.add_child(pistol)
	game.world.box(pistol, Vector3(0, 0.08, -0.10), Vector3(0.12, 0.25, 0.13), Color("#34434b"))
	game.world.box(pistol, Vector3(0, 0.22, -0.23), Vector3(0.15, 0.14, 0.43), Color("#738c93"))
	game.world.box(pistol, Vector3(0, 0.23, -0.47), Vector3(0.08, 0.08, 0.12), Color("#253b43"))
	game.world.box(pistol, Vector3(0, 0.31, -0.37), Vector3(0.028, 0.05, 0.04), Color("#f2ca79"))
	flash_material = StandardMaterial3D.new()
	flash_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	flash_material.albedo_color = Color(1, 0.93, 0.63, 0.8)
	flash_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA

func _hand(at: Vector3) -> Node3D:
	var hand := Node3D.new()
	rig.add_child(hand)
	hand.position = at
	game.world.box(hand, Vector3(0, -0.11, 0.12), Vector3(0.17, 0.34, 0.19), Color("#315c65"))
	game.world.box(hand, Vector3.ZERO, Vector3(0.19, 0.19, 0.21), Color("#daa77a"))
	game.world.box(hand, Vector3(0, 0.065, -0.045), Vector3(0.22, 0.09, 0.20), Color("#efc69b"))
	return hand

func swing(heavy := false) -> void:
	punch_time = 1.0
	alternate = not alternate
	recoil = 0.09 if weapon == "pistol" else (0.15 if heavy else 0.04)
	if weapon == "pistol":
		var muzzle: Vector3 = game.camera.global_transform * Vector3(0.28, -0.19, -1.04)
		burst(muzzle, Color("#fff0a4"), 5, 0.12)

func animate(delta: float) -> void:
	weapon = str(game.player.get("weapon", "rod"))
	rig.visible = game.joined and game.overlay_mode.is_empty() and weapon != "rod"
	game.rod.visible = game.joined and weapon == "rod"
	blade.visible = weapon == "knife"
	pistol.visible = weapon == "pistol"
	left_hand.visible = weapon == "fists"
	var charge: float = game.charge_amount()
	var sway: float = sin(game.elapsed * 10) * game.input_direction.length() * 0.018
	punch_time = maxf(0, punch_time - delta * (3.8 if weapon == "knife" else 4.8))
	recoil = move_toward(recoil, 0, delta * 0.75)
	hit_time = maxf(0, hit_time - delta)
	shake = move_toward(shake, 0, delta * 0.7)
	var arc := sin(punch_time * PI)
	var right_arc: float = arc if alternate or weapon != "fists" else 0.0
	var left_arc: float = arc if not alternate else 0.0
	left_hand.position = Vector3(-0.38 + left_arc * 0.14, -0.44 + sway + left_arc * 0.08, -0.59 - left_arc * 0.42)
	right_hand.position = Vector3(0.38 - right_arc * 0.18, -0.44 - sway + right_arc * 0.12 + charge * 0.06, -0.59 - right_arc * 0.40 + charge * 0.22 + recoil)
	right_hand.rotation = Vector3(-charge * 0.55 - right_arc * 0.45, -right_arc * 0.3, -charge * 0.35)
	if weapon == "pistol":
		var aimed: float = 1.0 if game.aiming else 0.0
		right_hand.position.x = lerpf(right_hand.position.x, 0.0, aimed)
		right_hand.position.y = lerpf(right_hand.position.y, -0.31, aimed)
		right_hand.rotation.x = recoil * 2.5
		if float(game.player.get("reloadRemaining", 0)) > 0:
			right_hand.rotation.z = -0.6
	for effect in effects.duplicate():
		effect.life -= delta
		if effect.life <= 0:
			effect.node.queue_free()
			effects.erase(effect)
			continue
		effect.node.position += effect.velocity * delta
		if effect.get("gravity", false):
			effect.velocity.y -= 7 * delta
			effect.node.rotation += Vector3(2, 4, 1) * delta
		var fade: float = clampf(float(effect.life) / float(effect.duration), 0, 1)
		if effect.node is Label3D:
			effect.node.modulate.a = minf(fade * 3, 1)
		else:
			effect.node.scale = Vector3.ONE * minf(fade * 4, 1)

func handle_event(event: Dictionary) -> void:
	var kind := str(event.get("kind", ""))
	var point := Vector3(float(event.get("x", 0)), float(event.get("y", 0.7)), float(event.get("z", 0)))
	var mine: bool = str(event.get("actorId", "")) == game.my_id
	if event.has("from") and event.has("to") and str(event.get("weapon", "")) == "pistol":
		var a: Dictionary = event["from"]
		var b: Dictionary = event["to"]
		tracer(Vector3(a.x, a.y, a.z), Vector3(b.x, b.y, b.z))
	if kind == "hit" or kind == "kill":
		burst(point, Color("#ffd278") if kind == "hit" else Color("#a8f4d6"), 9 if kind == "hit" else 16, 0.35)
		if float(event.get("damage", 0)) > 0:
			floating(point + Vector3(0, 0.3, 0), str(int(event.damage)), Color("#fff0b4"), 40)
		if mine:
			hit_time = 0.18
			shake = 0.035 if kind == "hit" else 0.075
			game._tone(190 if kind == "hit" else 620, 0.07 if kind == "hit" else 0.16)
			game.combat_label.text = "命中  %d" % int(event.get("damage", 0))
			game.combat_text_time = 0.8
		if kind == "kill":
			var labels: Array = event.get("styleLabels", [])
			game.combat_label.text = "漂亮！ %s\n渔获价值  %d 金币  ·  靠近按 E 收起" % [" + ".join(PackedStringArray(labels)), int(event.get("value", 0))]
			game.combat_text_time = 3.0
	elif kind == "hurt" and str(event.get("targetId", "")) == game.my_id:
		shake = 0.13
	elif kind == "pickup" and mine:
		burst(point, Color("#d7ffb4"), 6, 0.45)

func burst(at: Vector3, color: Color, count: int, duration: float) -> void:
	for i in range(count):
		if effects.size() > 140:
			break
		var particle: Node3D = game.world.box(game, at, Vector3.ONE * randf_range(0.035, 0.075), color)
		effects.append({"node": particle, "life": duration, "duration": duration, "velocity": Vector3(randf_range(-2, 2), randf_range(1, 3), randf_range(-2, 2)), "gravity": true})

func floating(at: Vector3, text: String, color: Color, size: int) -> void:
	var label: Label3D = game.world.label(game, text, at, size, color)
	label.no_depth_test = true
	effects.append({"node": label, "life": 0.75, "duration": 0.75, "velocity": Vector3(0, 1.1, 0)})

func tracer(from: Vector3, to: Vector3) -> void:
	var difference := to - from
	if difference.length() < 0.02:
		return
	var beam := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.012
	mesh.bottom_radius = 0.012
	mesh.height = difference.length()
	mesh.radial_segments = 4
	beam.mesh = mesh
	beam.material_override = game.world.material(Color("#ffe3a1"))
	game.add_child(beam)
	beam.position = (from + to) / 2
	beam.quaternion = Quaternion(Vector3.UP, difference.normalized())
	effects.append({"node": beam, "life": 0.08, "duration": 0.08, "velocity": Vector3.ZERO})

func warning_ring(parent: Node3D, radius: float) -> MeshInstance3D:
	var ring := MeshInstance3D.new()
	var mesh := TorusMesh.new()
	mesh.inner_radius = radius - 0.06
	mesh.outer_radius = radius + 0.06
	mesh.rings = 24
	mesh.ring_segments = 5
	ring.mesh = mesh
	ring.material_override = game.world.material(Color("#ff7657"))
	parent.add_child(ring)
	ring.scale.y = 0.15
	return ring
