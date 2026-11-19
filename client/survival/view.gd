extends Node3D

const FONT = preload("res://fonts/IslandSans.ttf")
var rig: Node3D
var hand: Node3D
var models: Dictionary = {}
var effects: Array = []
var weapon := "carbine"
var recoil := 0.0
var swing_time := 0.0
var hit_time := 0.0
var shake := 0.0
var clock := 0.0
var materials: Dictionary = {}

func material(color: Color) -> StandardMaterial3D:
	var key := color.to_html()
	if not materials.has(key):
		var mat := StandardMaterial3D.new()
		mat.albedo_color = color
		mat.roughness = 0.86
		materials[key] = mat
	return materials[key]

func box(parent: Node, at: Vector3, size: Vector3, color: Color) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	node.mesh = mesh
	node.material_override = material(color)
	parent.add_child(node)
	node.position = at
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return node

func setup(camera: Camera3D) -> void:
	rig = Node3D.new()
	camera.add_child(rig)
	hand = Node3D.new()
	rig.add_child(hand)
	box(hand, Vector3(0.23, -0.50, -0.44), Vector3(0.18, 0.34, 0.22), Color("375662"))
	box(hand, Vector3(0.23, -0.30, -0.46), Vector3(0.19, 0.18, 0.20), Color("d9b18c"))
	for id in ["carbine", "shotgun", "rifle", "knife", "rod_basic", "rod_pro"]:
		var model := Node3D.new()
		rig.add_child(model)
		models[id] = model
		model.position = Vector3(0.23, -0.25, -0.50)
		if id == "knife":
			box(model, Vector3.ZERO, Vector3(0.06, 0.20, 0.07), Color("6c4d36"))
			box(model, Vector3(0, 0.11, 0), Vector3(0.22, 0.045, 0.09), Color("dbb477"))
			box(model, Vector3(0, 0.33, 0), Vector3(0.12, 0.40, 0.04), Color("d6e9e9"))
		elif id.begins_with("rod"):
			box(model, Vector3(0, 0.35, -0.15), Vector3(0.035, 1.05, 0.035), Color("dbb574") if id == "rod_basic" else Color("73d4bd"))
			box(model, Vector3(0.04, 0.02, 0), Vector3(0.12, 0.12, 0.11), Color("3f555e"))
			model.rotation.x = -0.40
		else:
			var tint := Color("426c68") if id == "carbine" else (Color("987253") if id == "shotgun" else Color("466072"))
			var length := 0.63 if id == "carbine" else 0.78
			box(model, Vector3(0, 0.03, -0.17), Vector3(0.14, 0.17, length), tint)
			box(model, Vector3(0, 0.035, -length * 0.7), Vector3(0.065, 0.065, 0.38), Color("263a43"))
			box(model, Vector3(0, -0.13, -0.16), Vector3(0.08, 0.20, 0.12), Color("283c40"))
			box(model, Vector3(0, 0.145, -0.34), Vector3(0.025, 0.045, 0.055), Color("f1c779"))
			box(model, Vector3(0, -0.025, 0.19), Vector3(0.13, 0.16, 0.29), Color("705e4b"))
			if id == "rifle":
				box(model, Vector3(0, 0.17, -0.17), Vector3(0.105, 0.105, 0.30), Color("1e363f"))
				box(model, Vector3(0, 0.17, -0.008), Vector3(0.078, 0.078, 0.012), Color("77b7c0"))
			if id == "shotgun":
				box(model, Vector3(0, -0.045, -0.42), Vector3(0.17, 0.13, 0.25), Color("bb8e58"))

func equip(id: String) -> void:
	weapon = id
	for key in models:
		models[key].visible = key == id

func animate(delta: float, moving: float, ads: bool, reloading: bool, sprinting: bool, show_rig: bool) -> void:
	clock += delta
	recoil = move_toward(recoil, 0, delta * 1.4)
	swing_time = maxf(0, swing_time - delta * 3.2)
	hit_time = maxf(0, hit_time - delta)
	shake = move_toward(shake, 0, delta * 0.7)
	rig.visible = show_rig
	var target := Vector3(-0.23 if ads else 0, -0.035 if ads else 0, recoil)
	target.y += sin(clock * 9) * moving * 0.017
	rig.position = rig.position.lerp(target, minf(delta * 18, 1))
	rig.rotation = rig.rotation.lerp(Vector3(recoil * 1.8, 0, -0.55 if reloading else (0.18 if sprinting else 0.0)), minf(delta * 15, 1))
	if weapon == "knife":
		models[weapon].rotation.x = -sin(swing_time * PI) * 1.1
		models[weapon].position.z = -0.50 - sin(swing_time * PI) * 0.40
	for effect in effects.duplicate():
		effect.life -= delta
		if effect.life <= 0:
			effect.node.queue_free()
			effects.erase(effect)
			continue
		effect.node.position += effect.velocity * delta
		if effect.get("gravity", false):
			effect.velocity.y -= delta * 8
		var fade: float = minf(float(effect.life) * 5, 1)
		if effect.node is Label3D:
			effect.node.modulate.a = fade
		else:
			effect.node.scale = Vector3.ONE * fade

func fire() -> void:
	swing_time = 1.0
	recoil = 0.10 if weapon == "carbine" else 0.18
	if weapon in ["carbine", "shotgun", "rifle"]:
		burst(rig.global_transform * Vector3(0.23, -0.21, -1.15), Color("fff1ab"), 4, 0.08)

func confirm_hit(at: Vector3, damage: int, killed: bool) -> void:
	hit_time = 0.16
	shake = 0.025 if not killed else 0.055
	burst(at, Color("ffdc93") if not killed else Color("a7f1ce"), 6 if not killed else 10, 0.35)
	var label := Label3D.new()
	label.text = str(damage)
	label.font = FONT
	label.font_size = 42
	label.pixel_size = 0.012
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.modulate = Color("ffe6a6")
	add_child(label)
	label.position = at + Vector3.UP * 0.5
	effects.append({"node": label, "life": 0.70, "velocity": Vector3(0, 0.8, 0)})

func burst(at: Vector3, color: Color, count: int, duration: float) -> void:
	for i in range(count):
		if effects.size() >= 100:
			break
		var particle := box(self, at, Vector3.ONE * randf_range(0.04, 0.08), color)
		effects.append({"node": particle, "life": duration, "velocity": Vector3(randf_range(-1.5, 1.5), randf_range(0.3, 2), randf_range(-1.5, 1.5)), "gravity": true})

func tracer(from: Vector3, to: Vector3) -> void:
	var difference := to - from
	if difference.length() < 0.02:
		return
	var beam := box(self, (from + to) / 2, Vector3(0.018, 0.018, difference.length()), Color("ffe4a0"))
	beam.look_at(to)
	effects.append({"node": beam, "life": 0.065, "velocity": Vector3.ZERO})
