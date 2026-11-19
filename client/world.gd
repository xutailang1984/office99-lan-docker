extends Node3D

const FONT = preload("res://fonts/IslandSans.ttf")
var models: Dictionary = {}
var materials: Dictionary = {}
var sea: MeshInstance3D
var ui_font: FontVariation

func _ready() -> void:
	ui_font = FontVariation.new()
	ui_font.base_font = FONT
	ui_font.variation_opentype = {"wght": 550.0}
	for key in ["fisherman", "fish", "goldfish", "crab", "rod", "shop", "palm", "crate"]:
		models[key] = load("res://assets/%s.gltf" % key)
	var environment := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_COLOR
	settings.background_color = Color("#b7dcd7")
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("#d9ecd8")
	settings.ambient_light_energy = 0.48
	settings.fog_enabled = false
	settings.fog_light_color = Color("#b7dcd7")
	settings.fog_density = 0.004
	environment.environment = settings
	add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, -35, 0)
	sun.light_color = Color("#fff1d0")
	sun.light_energy = 0.85
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 65
	add_child(sun)
	_build_sea()
	var grass := [Color("#6d8e52"), Color("#739458"), Color("#77995c"), Color("#719055")]
	for x in range(-7, 8):
		for z in range(-7, 8):
			var radius := Vector2(x * 2, z * 2).length()
			if radius > 14.0:
				continue
			box(self, Vector3(x * 2, -0.42, z * 2), Vector3(2.01, 0.76, 2.01), Color("#b8a078"))
			if radius < 11.5:
				box(self, Vector3(x * 2, -0.01, z * 2), Vector3(2.0, 0.1, 2.0), grass[posmod(x * 7 + z * 3, 4)])
	for side in [0, 1, 2, 3]:
		var dock := Node3D.new()
		add_child(dock)
		dock.rotation.y = side * PI / 2
		for plank in range(6):
			box(dock, Vector3(0, 0.035, 11.1 + plank * 0.55), Vector3(2.15, 0.13, 0.49), Color("#b6875f"))
		for x in [-1.05, 1.05]:
			for z in [11.15, 13.65]:
				box(dock, Vector3(x, 0.24, z), Vector3(0.18, 0.8, 0.18), Color("#856247"))
	for point in [Vector3(-7, 0.05, -7), Vector3(8, 0.05, -6), Vector3(-9, 0.05, 4), Vector3(7, 0.05, 7)]:
		var palm := instance("palm", self, point)
		palm.scale = Vector3.ONE * 1.5
		palm.rotation.y = point.x
	var shop := instance("shop", self, Vector3(0, 0.05, -6))
	shop.scale = Vector3.ONE * 1.5
	label(self, "潮汐商店", Vector3(0, 3.35, -6), 42, Color("#fff0c5"))
	label(self, "售鱼 · 渔刀 · 手枪", Vector3(0, 2.9, -6), 25, Color.WHITE)
	var challenge := Node3D.new()
	add_child(challenge)
	challenge.position = Vector3(8, 0.08, 0)
	for i in range(16):
		var a := TAU * i / 16.0
		box(challenge, Vector3(cos(a) * 1.6, 0, sin(a) * 1.6), Vector3(0.35, 0.13, 0.35), Color("#d4b785"))
	box(challenge, Vector3(0, 0.36, 0), Vector3(1.3, 0.65, 0.75), Color("#725d53"))
	var trophy := instance("crab", challenge, Vector3(0, 0.73, 0))
	trophy.scale = Vector3.ONE * 1.1
	label(challenge, "礁甲巨蟹试炼", Vector3(0, 2.2, 0), 32, Color("#ffd18e"))
	label(challenge, "全队钓上 3 条鱼后，按 E 挑战", Vector3(0, 1.78, 0), 20, Color.WHITE)
	for point in [Vector3(3.5, 0.05, -5.7), Vector3(4.1, 0.05, -6.5), Vector3(-3.3, 0.05, -6.6)]:
		instance("crate", self, point)
	for z in range(-4, 7, 2):
		box(self, Vector3(0, 0.065, z), Vector3(1.5, 0.02, 1.2), Color("#d5d49b"))
	for i in range(32):
		var a := float(i) * 2.399
		var r := 7.8 + sin(i * 5.7) * 2.2
		var position_3d := Vector3(cos(a) * r, 0.11, sin(a) * r)
		if absf(position_3d.x) < 2.5 or absf(position_3d.z) < 2:
			continue
		box(self, position_3d, Vector3(0.14, 0.3, 0.14), Color("#719d61"))
		box(self, position_3d + Vector3(0, 0.15, 0), Vector3(0.23, 0.13, 0.23), Color("#f4d89b") if i % 2 else Color("#fff2c9"))
	for point in [Vector3(-38, -0.8, -48), Vector3(48, -0.9, -30), Vector3(-48, -0.7, 26)]:
		box(self, point, Vector3(12, 1, 9), Color("#d4c5a0"))
		box(self, point + Vector3(1, 0.65, 0), Vector3(9, 0.4, 7), Color("#8daa75"))
		instance("palm", self, point + Vector3(0, 1, 0)).scale = Vector3.ONE * 2.4
	for i in range(12):
		var cloud_pos := Vector3(sin(i * 2.3) * 80, 20 + (i % 3) * 4, cos(i * 2.3) * 80)
		box(self, cloud_pos, Vector3(8, 1.3, 3), Color("#edf2db"))
		box(self, cloud_pos + Vector3(1, 1, 0), Vector3(4, 1.3, 2.6), Color("#edf2db"))

func _build_sea() -> void:
	sea = MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(260, 260)
	plane.subdivide_width = 70
	plane.subdivide_depth = 70
	sea.mesh = plane
	sea.position.y = -0.18
	var shader := Shader.new()
	shader.code = """shader_type spatial;
render_mode cull_disabled, unshaded;
void vertex() { VERTEX.y += sin(VERTEX.x * 0.5 + TIME * 0.65) * cos(VERTEX.z * 0.4 + TIME * 0.4) * 0.07; }
void fragment() {
 float foam = step(0.975, sin(UV.x * 800.0 + TIME * 0.35) * sin(UV.y * 720.0));
 ALBEDO = mix(vec3(0.19, 0.61, 0.65), vec3(0.40, 0.76, 0.76), foam * 0.5);
 ROUGHNESS = 0.7; METALLIC = 0.0;
}
"""
	var material := ShaderMaterial.new()
	material.shader = shader
	sea.material_override = material
	add_child(sea)

func material(color: Color) -> StandardMaterial3D:
	var key := color.to_html()
	if not materials.has(key):
		var value := StandardMaterial3D.new()
		value.albedo_color = color
		value.roughness = 0.9
		materials[key] = value
	return materials[key]

func box(parent: Node3D, pos: Vector3, dimensions: Vector3, color: Color) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	var cube := BoxMesh.new()
	cube.size = dimensions
	mesh.mesh = cube
	mesh.material_override = material(color)
	parent.add_child(mesh)
	mesh.position = pos
	return mesh

func instance(key: String, parent: Node3D, pos := Vector3.ZERO) -> Node3D:
	var node: Node3D = models[key].instantiate()
	parent.add_child(node)
	node.position = pos
	return node

func label(parent: Node3D, text: String, pos: Vector3, size: int, color: Color) -> Label3D:
	var node := Label3D.new()
	node.text = text
	node.font = ui_font
	node.font_size = size
	node.pixel_size = 0.007
	node.modulate = color
	node.outline_size = 6
	node.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	parent.add_child(node)
	node.position = pos
	return node
