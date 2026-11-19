extends Node3D
const QueryPhysics=preload("res://survival/static_query_physics.gd")

const OfficeScene = preload("res://survival/office_scene.gd")
const OfficeTools = preload("res://survival/office_tools.gd")
const OfficeTheme = preload("res://survival/office_theme.gd")

const StaticMeshBatch = preload("res://survival/static_mesh_batch.gd")

# Original voxel-style map for Godot 4.7.2 Compatibility / Web.
# Terrain triangles match terrain-layout.mjs exactly; static geometry uses layer 1.
const GRID := 2.0
const PONDS := [{"id": "near", "x": -43.0, "z": 0.0, "radius": 6.0}, {"id": "outer", "x": 10.0, "z": 74.0, "radius": 6.0}]
const TRAINING_POND := {"id": "training", "x": 0.0, "z": 29.0, "radius": 6.0}
const ROCKS := [
	{"id": "rock_hunt_01", "x": 56.0, "z": -55.0, "width": 3.0, "depth": 3.0, "height": 2.8},
	{"id": "rock_hunt_02", "x": 67.0, "z": -61.0, "width": 4.0, "depth": 3.0, "height": 2.8},
	{"id": "rock_hunt_03", "x": 79.0, "z": -53.0, "width": 3.0, "depth": 4.0, "height": 2.5},
	{"id": "rock_hunt_04", "x": 79.0, "z": -40.0, "width": 4.0, "depth": 3.0, "height": 2.7},
	{"id": "rock_hunt_05", "x": 64.0, "z": -35.0, "width": 3.0, "depth": 3.0, "height": 2.8},
	{"id": "rock_hunt_06", "x": 54.0, "z": -43.0, "width": 3.0, "depth": 4.0, "height": 2.4},
	{"id": "rock_salvage_01", "x": 71.0, "z": 31.0, "width": 3.0, "depth": 3.0, "height": 2.0},
	{"id": "rock_salvage_02", "x": 52.0, "z": 45.0, "width": 3.0, "depth": 3.0, "height": 1.7},
	{"id": "rock_supply_01", "x": -65.0, "z": -40.0, "width": 3.0, "depth": 3.0, "height": 1.8}
]
const SAND := Color("#d6c49d")
const GRASS := Color("#6e9369")
const WOOD := Color("#695243")
const STONE := Color("#75848a")
const GOLD := Color("#ffbe55")
const DANGER := Color("#f06b58")
const MINT := Color("#73f6cf")
var config: Dictionary = {}
var level: Dictionary = {}
var models: Dictionary = {}
var materials: Dictionary = {}
var building_nodes: Dictionary = {}
var map_root: Node3D
var sea: MeshInstance3D
var boundary_buoys: MultiMeshInstance3D
var sun: DirectionalLight3D
var environment_settings: Environment
var font: Font
var water_height := 0.0
var tide_phase := "PREP"
var terrain_triangle_count := 0
var _decor_batches: Dictionary = {}
var training_root: Node3D
var training_signature := ""
var training_water_enabled := false

func _process(_delta: float) -> void:
	var camera := get_viewport().get_camera_3d()
	if camera != null:
		for caption in get_tree().get_nodes_in_group("tidal_world_hint"):
			var offset: Vector3=caption.global_position-camera.global_position
			caption.visible = caption.name!="Status" and offset.length()<14 and offset.normalized().dot(-camera.global_basis.z)>0.65
	if building_nodes.has("core"):
		var core: Node3D = building_nodes.core
		if bool(core.get_meta("critical", false)):
			var pulse := 0.5 + 0.5 * sin(float(Time.get_ticks_msec()) * 0.009)
			core.get_node("Status").modulate = DANGER.lerp(Color.WHITE, pulse * 0.45)
			core.get_node("CampLight").light_energy = 0.7 + pulse * 1.1

func setup(settings: Dictionary, practice_water := false) -> void:
	config = settings
	level = config.get("level", config)
	training_water_enabled = practice_water
	if is_instance_valid(map_root):
		map_root.free()
	building_nodes.clear()
	_decor_batches.clear()
	training_root = null
	training_signature = ""
	map_root = Node3D.new()
	map_root.name = "TidalMap"
	add_child(map_root)
	if ResourceLoader.exists("res://fonts/IslandSans.ttf"):
		font = load("res://fonts/IslandSans.ttf")
	# Actors and hand-held tools load their own resources. Only palms use this map.
	for key in ["palm"]:
		var resource_path := "res://assets/%s.gltf" % key
		if ResourceLoader.exists(resource_path):
			models[key] = load(resource_path)
	_build_environment()
	_build_terrain()
	_build_sea()
	_build_boundary()
	_build_landmarks()
	_build_camp()
	_flush_decor()
	set_tide(float(config.get("cycle", {}).get("low_water_y", 0)), "PREP")
	set_clock(0.35)

func location(id: String, fallback: Vector3) -> Vector3:
	for value in level.get("locations", []):
		if str(value.get("id", "")) == id:
			return Vector3(float(value.x), float(value.y), float(value.z))
	return fallback

func raw_ground_height(x: float, z: float) -> float:
	var radius := float(level.get("mainland_radius", 42))
	var high := float(level.get("mainland_height", 5))
	var low := float(level.get("outer_height", 1))
	var r := Vector2(x, z).length()
	var result := -2.0
	if r <= radius:
		result = high
	elif r < radius + 12.0:
		result = lerpf(high, low, (r - radius) / 12.0)
	elif r <= 100.0:
		result = low
	var emergency := location("emergency", Vector3(-28, 8, 20))
	var outside := maxf(0, maxf(absf(x - emergency.x) - 4, absf(z - emergency.z) - 4))
	result = maxf(result, emergency.y - outside * 0.3)
	for pond in PONDS:
		if Vector2(x - float(pond.x), z - float(pond.z)).length() <= float(pond.radius):
			return -2.0
	if training_water_enabled and Vector2(x - float(TRAINING_POND.x), z - float(TRAINING_POND.z)).length() <= float(TRAINING_POND.radius):
		return -2.0
	if (x <= -43 and x >= -104 and absf(z) <= 1.5) or (x >= 10 and x <= 104 and absf(z - 74) <= 1.5):
		return -2.0
	return result

func ground_height(x: float, z: float) -> float:
	var x0 := floorf(x / GRID) * GRID
	var z0 := floorf(z / GRID) * GRID
	var fx := (x - x0) / GRID
	var fz := (z - z0) / GRID
	var a := raw_ground_height(x0, z0)
	var b := raw_ground_height(x0 + GRID, z0)
	var c := raw_ground_height(x0, z0 + GRID)
	var d := raw_ground_height(x0 + GRID, z0 + GRID)
	return a + (b - a) * fx + (c - a) * fz if fx + fz <= 1 else d + (c - d) * (1 - fx) + (b - d) * (1 - fz)

func terrain_region(x: float, z: float) -> String:
	for pond in PONDS:
		if Vector2(x - float(pond.x), z - float(pond.z)).length() <= float(pond.radius):
			return "pond_" + str(pond.id)
	var h := ground_height(x, z)
	if h >= 7.8:
		return "emergency"
	if h >= float(level.get("mainland_height", 5)) - 0.01:
		return "mainland"
	if h > float(level.get("outer_height", 1)) + 0.05:
		return "ramp"
	return "low_beach" if h >= 0.95 else "seabed"

func material(color: Color) -> StandardMaterial3D:
	var key := color.to_html()
	if not materials.has(key):
		var value := StandardMaterial3D.new()
		value.albedo_color = color
		value.roughness = 0.92
		value.metallic = 0
		materials[key] = value
	return materials[key]

func box(parent: Node3D, pos: Vector3, dimensions: Vector3, color: Color) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var cube := BoxMesh.new()
	cube.size = dimensions
	node.mesh = cube
	node.material_override = material(color)
	parent.add_child(node)
	node.position = pos
	return node

func instance(asset: String, parent: Node3D, pos := Vector3.ZERO) -> Node3D:
	var key := str({"silverfish": "fish", "treasure": "crate", "storage": "crate"}.get(asset, asset))
	var node: Node3D
	if models.has(key):
		node = models[key].instantiate()
	else:
		node = Node3D.new()
		if key == "palm":
			box(node, Vector3(0, 1.4, 0), Vector3(0.5, 2.8, 0.5), WOOD)
			box(node, Vector3(0, 2.8, 0), Vector3(2.8, 0.3, 0.55), GRASS)
			box(node, Vector3(0, 2.8, 0), Vector3(0.55, 0.3, 2.8), GRASS)
		else:
			box(node, Vector3(0, 0.45, 0), Vector3(0.8, 0.9, 0.8), WOOD if key in ["crate", "shop"] else MINT)
	parent.add_child(node)
	node.position = pos
	return node

func label(parent: Node3D, text: String, pos: Vector3, size := 24, color := GOLD) -> Label3D:
	var node := Label3D.new()
	node.add_to_group("tidal_world_hint")
	node.text = text
	if font != null:
		node.font = font
	node.font_size = size
	node.pixel_size = 0.007
	node.modulate = color
	node.outline_size = 5
	node.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	parent.add_child(node)
	node.position = pos
	return node

func _triangle(vertices: PackedVector3Array, normals: PackedVector3Array, colors: PackedColorArray, a: Vector3, b: Vector3, c: Vector3, color: Color) -> void:
	# Godot front faces are clockwise; explicit vertex normals still point up.
	var normal := (c - a).cross(b - a).normalized()
	vertices.append_array(PackedVector3Array([a, b, c]))
	normals.append_array(PackedVector3Array([normal, normal, normal]))
	colors.append_array(PackedColorArray([color, color, color]))

func _build_terrain() -> void:
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var extent := int(level.get("extent", 128))
	for x in range(-extent, extent, int(GRID)):
		for z in range(-extent, extent, int(GRID)):
			var a := Vector3(x, raw_ground_height(x, z), z)
			var b := Vector3(x + GRID, raw_ground_height(x + GRID, z), z)
			var c := Vector3(x, raw_ground_height(x, z + GRID), z + GRID)
			var d := Vector3(x + GRID, raw_ground_height(x + GRID, z + GRID), z + GRID)
			var h := (a.y + b.y + c.y + d.y) * 0.25
			var color := GRASS if h >= 4.9 else (SAND if h > 0 else Color("#657f78"))
			color = color.lightened(0.022) if posmod(x * 17 + z * 7, 6) == 0 else color
			_triangle(vertices, normals, colors, a, b, c, color)
			_triangle(vertices, normals, colors, d, c, b, color)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var terrain_material := StandardMaterial3D.new()
	terrain_material.vertex_color_use_as_albedo = true
	terrain_material.vertex_color_is_srgb = true
	terrain_material.roughness = 1.0
	var visible := MeshInstance3D.new()
	visible.name = "GroundVisual"
	visible.mesh = mesh
	visible.material_override = terrain_material
	map_root.add_child(visible)
	var body := StaticBody3D.new()
	body.name = "GroundCollision"
	body.collision_layer = 1
	body.collision_mask = 0
	body.set_meta("kind", "terrain")
	var shape := ConcavePolygonShape3D.new()
	shape.set_faces(vertices)
	shape.backface_collision = true
	var collider := CollisionShape3D.new()
	collider.shape = shape
	body.add_child(collider)
	map_root.add_child(body)
	QueryPhysics.refresh_body(body)
	terrain_triangle_count = vertices.size() / 3

func _build_environment() -> void:
	var env_node := WorldEnvironment.new()
	environment_settings = Environment.new()
	environment_settings.background_mode = Environment.BG_COLOR
	environment_settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment_settings.fog_enabled = false
	env_node.environment = environment_settings
	map_root.add_child(env_node)
	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, -35, 0)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 90
	map_root.add_child(sun)

func _build_sea() -> void:
	sea = MeshInstance3D.new()
	sea.name = "TideWater"
	var plane := PlaneMesh.new()
	plane.size = Vector2(280, 280)
	sea.mesh = plane
	var shader := Shader.new()
	shader.code = """shader_type spatial;
render_mode unshaded, cull_disabled;
uniform vec4 sea_color : source_color = vec4(0.204,0.494,0.576,1.0);
void fragment(){
 float band = step(0.965,fract(UV.x*95.0+sin(TIME*0.22)*0.15))*step(0.83,fract(UV.y*90.0));
 ALBEDO=mix(sea_color.rgb,vec3(0.70,0.88,0.86),band*0.24);
 ROUGHNESS=0.9; METALLIC=0.0;
}
"""
	var water_material := ShaderMaterial.new()
	water_material.shader = shader
	sea.material_override = water_material
	map_root.add_child(sea)

func set_tide(height: float, phase: String) -> void:
	water_height = height
	tide_phase = phase
	if not is_instance_valid(sea):
		return
	sea.position.y = height
	if is_instance_valid(boundary_buoys): boundary_buoys.position.y=height
	# Water can change in a delta whose rounded clock is unchanged. Lighting
	# belongs solely to set_clock; otherwise RETURN alternates day/dusk every
	# few snapshots and looks like scene-wide flicker.

func set_clock(progress: float) -> void:
	var daylight := clampf(sin((progress-0.25)*TAU)*3+0.25,0,1)
	environment_settings.background_color=Color("203248").lerp(Color("b7cfcd"),daylight)
	environment_settings.ambient_light_color=Color("91abc9").lerp(Color("dce9d3"),daylight)
	environment_settings.ambient_light_energy=lerpf(0.62,0.42,daylight)
	sun.light_color=Color("9ebfec").lerp(Color("fff0d0"),daylight)
	sun.light_energy=lerpf(0.4,0.82,daylight)
	sun.rotation_degrees=Vector3(-18-daylight*36,-40+progress*150,0)
	if is_instance_valid(sea):
		sea.material_override.set_shader_parameter("sea_color",Color("254a61").lerp(Color("347e93"),daylight))

func _static_box(id: String, pos: Vector3, dimensions: Vector3, parent: Node3D = null) -> CollisionShape3D:
	var body := StaticBody3D.new()
	body.name = id
	body.collision_layer = 1
	body.collision_mask = 0
	body.set_meta("obstacle_id", id)
	var shape := BoxShape3D.new()
	shape.size = dimensions
	var collider := CollisionShape3D.new()
	collider.shape = shape
	body.add_child(collider)
	(parent if parent != null else map_root).add_child(body)
	body.position = pos
	QueryPhysics.refresh_body(body)
	return collider

func _build_boundary() -> void:
	var radius := float(level.get("boundary_radius", 120))
	var vertices := PackedVector3Array()
	for i in range(96):
		var a := Vector2(cos(TAU * i / 96.0), sin(TAU * i / 96.0)) * radius
		var b := Vector2(cos(TAU * (i + 1) / 96.0), sin(TAU * (i + 1) / 96.0)) * radius
		vertices.append_array(PackedVector3Array([Vector3(a.x, -4, a.y), Vector3(a.x, 18, a.y), Vector3(b.x, 18, b.y), Vector3(a.x, -4, a.y), Vector3(b.x, 18, b.y), Vector3(b.x, -4, b.y)]))
	_build_boundary_buoys(radius)
	var body := StaticBody3D.new()
	body.name = "ClosedSeaBoundary"
	body.collision_layer = 1
	body.collision_mask = 0
	var shape := ConcavePolygonShape3D.new()
	shape.backface_collision = true
	shape.set_faces(vertices)
	var collision := CollisionShape3D.new()
	collision.shape = shape
	body.add_child(collision)
	map_root.add_child(body)
	QueryPhysics.refresh_body(body)

func _build_boundary_buoys(radius: float) -> void:
	# Navigation markers float at the actual tide. Former fixed-height cubes
	# hovered 2.9 m above low tide and resembled unreachable loot.
	var multi := MultiMesh.new()
	multi.transform_format=MultiMesh.TRANSFORM_3D
	multi.use_colors=true
	multi.instance_count=24*4
	var cube := BoxMesh.new()
	cube.size=Vector3.ONE
	multi.mesh=cube
	var parts := [[Vector3(0,0.04,0),Vector3(0.72,0.28,0.72),Color("e56950")],
		[Vector3(0,0.185,0),Vector3(0.56,0.07,0.56),Color("fff2d6")],
		[Vector3(0,0.40,0),Vector3(0.06,0.58,0.06),Color("254556")],
		[Vector3(0.19,0.60,0),Vector3(0.33,0.22,0.07),GOLD]]
	for i in range(24):
		var angle := TAU*i/24.0
		var anchor := Vector3(cos(angle)*radius,0,sin(angle)*radius)
		for p in range(parts.size()):
			multi.set_instance_transform(i*4+p,Transform3D(Basis.from_scale(parts[p][1]),anchor+parts[p][0]))
			multi.set_instance_color(i*4+p,parts[p][2])
	boundary_buoys=MultiMeshInstance3D.new()
	boundary_buoys.name="BoundaryBuoys"
	boundary_buoys.multimesh=multi
	boundary_buoys.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo=true
	mat.vertex_color_is_srgb=true
	mat.roughness=0.88
	boundary_buoys.material_override=mat
	map_root.add_child(boundary_buoys)

func _decor_box(pos: Vector3, size: Vector3, color: Color, yaw := 0.0, pitch := 0.0) -> void:
	var key := color.to_html()
	if not _decor_batches.has(key):
		_decor_batches[key] = {"color": color, "transforms": []}
	var basis := Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, pitch) * Basis.from_scale(size)
	_decor_batches[key].transforms.append(Transform3D(basis, pos))

func _flush_decor() -> void:
	# All opaque decorative cubes share one mesh and one material. Instance colors
	# keep the existing palette while avoiding a draw submission for each color.
	var count := 0
	for data in _decor_batches.values(): count += data.transforms.size()
	if count == 0: return
	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.use_colors = true
	multi.instance_count = count
	var cube := BoxMesh.new()
	cube.size = Vector3.ONE
	multi.mesh = cube
	var index := 0
	for data in _decor_batches.values():
		for transform in data.transforms:
			multi.set_instance_transform(index,transform)
			multi.set_instance_color(index,data.color)
			index += 1
	var mesh := MultiMeshInstance3D.new()
	mesh.name = "OfficeParkDecor"
	mesh.multimesh = multi
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color.WHITE
	mat.roughness = 0.88
	mat.vertex_color_use_as_albedo = true
	mat.vertex_color_is_srgb = true
	mesh.material_override = mat
	map_root.add_child(mesh)
	_decor_batches.clear()

func _road(points: Array, width := 2.0, color := Color("#c6b484")) -> void:
	for i in range(points.size() - 1):
		var a: Vector2 = points[i]
		var b: Vector2 = points[i + 1]
		var delta := b - a
		var steps := maxi(1, int(delta.length() / 0.8))
		for step in steps:
			var p := a.lerp(b, (float(step) + 0.5) / steps)
			var start := a.lerp(b, float(step) / steps)
			var finish := a.lerp(b, float(step + 1) / steps)
			var rise := ground_height(finish.x, finish.y) - ground_height(start.x, start.y)
			var run := delta.length() / steps
			_decor_box(Vector3(p.x, ground_height(p.x, p.y) + 0.055, p.y), Vector3(width, 0.04, sqrt(run * run + rise * rise) + 0.02), color, atan2(delta.x, delta.y), -atan2(rise, run))

func _build_landmarks() -> void:
	_road([Vector2(0, 8), Vector2(0, 22)] if training_water_enabled else [Vector2(0, 8), Vector2(0, 42), Vector2(0, 54), Vector2(0, 74)], 3.0)
	_road([Vector2(0, -8), Vector2(0, -34)], 4.0)
	_road([Vector2(8, 0), Vector2(34, 0)], 4.0)
	_road([Vector2(-8, 0), Vector2(-34, 0)], 2.0)
	_road([Vector2(-6, 8), Vector2(-16, 14), Vector2(-28, 20)], 2.2)
	_road([Vector2(30, 0), Vector2(49, 22), Vector2(62, 38)], 2.3)
	_road([Vector2(20, -18), Vector2(43, -31), Vector2(68, -48)], 2.2)
	_road([Vector2(-20, -20), Vector2(-43, -29), Vector2(-57, -35)], 2.0)
	for item in ROCKS:
		var base := ground_height(float(item.x), float(item.z))
		var size := Vector3(float(item.width), float(item.height), float(item.depth))
		var pos := Vector3(float(item.x), base + size.y / 2, float(item.z))
		# Permanent concrete office remnants retain the full original obstacle volume.
		# Surface panels add a landmark silhouette; they do not look like loot crates.
		_decor_box(pos-Vector3(0,0.07,0),Vector3(size.x,size.y-0.14,size.z),STONE)
		_decor_box(pos+Vector3(0,size.y*0.5-0.07,0),Vector3(size.x,0.14,size.z),Color("91a096"))
		for side in [-1.0,1.0]:
			_decor_box(pos+Vector3(0,-size.y*0.22,side*(size.z*0.5+0.006)),Vector3(size.x*0.9,0.12,0.012),Color("344c5d"))
			_decor_box(pos+Vector3(0,size.y*0.13,side*(size.z*0.5+0.008)),Vector3(size.x*0.73,size.y*0.43,0.014),Color("4c7079"))
			for x in [-0.30,0,0.30]:
				_decor_box(pos+Vector3(x*size.x,size.y*0.13,side*(size.z*0.5+0.022)),Vector3(0.07,size.y*0.39,0.014),Color("a9b7b3"))
			_decor_box(pos+Vector3(-size.x*0.28,-size.y*0.22,side*(size.z*0.5+0.021)),Vector3(size.x*0.23,0.14,0.014),DANGER)

		_static_box(str(item.id), pos, size)
	for p in [Vector2(-18, -12), Vector2(15, 19), Vector2(-26, 30), Vector2(24, -25), Vector2(41, 17), Vector2(-53, -31), Vector2(73, 45)]:
		var palm := instance("palm", map_root, Vector3(p.x, ground_height(p.x, p.y), p.y))
		palm.scale = Vector3.ONE * 1.6
		palm.rotation.y = p.x * 0.17
	for id in ["fishing_near", "fishing_outer", "salvage", "hunt", "supply", "emergency"]:
		var fallback: Vector3 = {"fishing_near": Vector3(-34, 5, 0), "fishing_outer": Vector3(0, 1, 74), "salvage": Vector3(62, 1, 38), "hunt": Vector3(68, 1, -48), "supply": Vector3(-57, 1, -35), "emergency": Vector3(-28, 8, 20)}[id]
		var p := location(id, fallback)
		var caption: String = {"fishing_near": "午休水岸", "fishing_outer": "园区浅滩 · 留意涨潮", "salvage": "旧工位区", "hunt": "旧物资间", "supply": "快递堆放区", "emergency": "楼顶休息区"}[id]
		var color: Color = {"salvage":MINT,"hunt":Color("e7b74e"),"supply":DANGER}.get(id,MINT)
		label(map_root, caption, p + Vector3(0, 3.6, 0), 30, color)
		if id in ["hunt","salvage","supply"]:
			label(map_root,{"salvage":"巡逻 · 躲冲刺","hunt":"封路 · 绕护柜","supply":"护送 · 清支援"}[id],p+Vector3(0,2.8,0),20,color)
		_decor_box(p + Vector3(2.4, 1.0, 0), Vector3(0.18, 2, 0.18), WOOD)
		_decor_box(p + Vector3(2.4, 2.1, 0), Vector3(0.7, 0.6, 0.10), color)
	# Flat ruined floor markings replace the old solid-looking, non-colliding tables.
	# Search desks and harvestable boxes still come only from live game state.
	for offset in [Vector2(-5,-3),Vector2(5,4),Vector2(0,7)]:
		var p: Vector2 = Vector2(62,38)+offset
		var y := ground_height(p.x,p.y)
		_decor_box(Vector3(p.x,y+0.022,p.y),Vector3(3.5,0.028,2.2),Color("839c95"))
		for x in [-1.4,1.4]:
			_decor_box(Vector3(p.x+x,y+0.041,p.y),Vector3(0.12,0.012,1.80),Color("c6b484"))
		for z in [-0.9,0.9]:
			_decor_box(Vector3(p.x,y+0.041,p.y+z),Vector3(2.9,0.012,0.12),Color("c6b484"))
	# Small park reeds and low ground patches stay away from paths and casting water.
	for pond in PONDS:
		for i in range(9):
			var angle := float(i)*TAU/9.0+0.2
			var p := Vector2(float(pond.x),float(pond.z))+Vector2(cos(angle),sin(angle))*8.6
			if absf(p.y)<2.0 or absf(p.x)<2.0: continue
			var y := ground_height(p.x,p.y)
			_decor_box(Vector3(p.x,y+0.022,p.y),Vector3(0.8,0.025,0.64),Color("819a75"),angle)
			for j in range(3):
				var at:=Vector3(p.x+float(j-1)*0.16,y+0.16+float(j%2)*0.045,p.y)
				_decor_box(at,Vector3(0.075,0.29+float(j%2)*0.09,0.08),Color("5c8268"),angle)
				_decor_box(at+Vector3(0.07,0.03,0.02),Vector3(0.27,0.045,0.12),Color("8daa70"),angle)

	for p in ([Vector3(0, 5, -34), Vector3(34, 5, 0)] if training_water_enabled else [Vector3(0, 5, -34), Vector3(34, 5, 0), Vector3(0, 5, 34)]):
		for x in [-2.7, 2.7]:
			_decor_box(p + Vector3(x, 0.9, 0), Vector3(0.25, 1.8, 0.25), STONE)
			_decor_box(p + Vector3(x, 1.95, 0), Vector3(0.4, 0.3, 0.4), DANGER)

func building_slots() -> Array:
	var slots: Array = []
	for i in range(4):
		slots.append({"id": "W%02d" % (i + 1), "kind": "wall", "x": -4.5 + 3 * i, "z": -6.0, "yaw": 0.0})
	for i in range(4):
		slots.append({"id": "W%02d" % (i + 5), "kind": "wall", "x": 6.0, "z": -4.5 + 3 * i, "yaw": -PI / 2})
	for item in [{"id": "W09", "x": -4.5}, {"id": "W10", "x": -1.5}, {"id": "G01", "x": 1.5}, {"id": "W11", "x": 4.5}]:
		slots.append({"id": item.id, "kind": "gate" if item.id == "G01" else "wall", "x": item.x, "z": 6.0, "yaw": PI})
	for i in range(4):
		slots.append({"id": "W%02d" % (i + 12), "kind": "wall", "x": -6.0, "z": -4.5 + 3 * i, "yaw": PI / 2})
	return slots

func _build_camp() -> void:
	var base_y := ground_height(0, 0)
	# Office flooring is decoration; authoritative terrain and walkability stay intact.
	for x in range(-5, 6, 2):
		for z in range(-5, 6, 2):
			_decor_box(Vector3(x, base_y + 0.015, z), Vector3(1.97, 0.025, 1.97), Color("c4c5ab") if (x+z)%4==0 else Color("d8d4b7"))
	label(map_root, "有事说清楚", Vector3(-4.5, base_y + 2.8, -5.9), 18, MINT)
	label(map_root, "好东西一起用", Vector3(3.5, base_y + 2.4, -2), 16, GOLD)
	for slot in building_slots():
		slot["definitionId"] = slot.kind
		slot["hp"] = 400
		slot["maxHp"] = 400
		slot["y"] = base_y
		slot["level"] = 1
		slot["gateOpen"] = false
		sync_buildings([slot])
	sync_buildings([{"id": "core", "definitionId": "core", "x": 0, "y": base_y, "z": 0, "hp": 1500, "maxHp": 1500, "level": 1}])
	var emergency := location("emergency", Vector3(-28, 8, 20))
	label(map_root, "累了歇一会", emergency + Vector3(0, 2.6, -3), 18, GOLD)
	for x in [-3.6, 3.6]:
		for z in [-3.6, 3.6]:
			_decor_box(emergency + Vector3(x, 1.7, z), Vector3(0.20, 3.4, 0.20), WOOD)
	_decor_box(emergency + Vector3(0, 3.5, 0), Vector3(8, 0.2, 8), Color("#668995"))
	for station in config.level.terminals:
		var color: Color = MINT if str(station.type)=="storage" else Color("b3c98a") if str(station.type)=="recycle" else Color("a7bdec") if str(station.type)=="craft" else GOLD
		_terminal(str(station.id),Vector3(float(station.x),ground_height(float(station.x),float(station.z)),float(station.z)),str(station.label),color)
	for i in range(4):
		_decor_box(Vector3(-1.5 + i, base_y + 0.03, 3), Vector3(0.65, 0.05, 0.65), Color("#96b1ff"))

func _terminal(id: String, pos: Vector3, caption: String, color: Color) -> void:
	var root_node := Node3D.new()
	root_node.name = id
	root_node.set_meta("authority_id", str({"purchase": "terminal", "warehouse": "storage"}.get(id, id)))
	map_root.add_child(root_node)
	root_node.position = pos
	OfficeScene.terminal_visual(root_node, id)
	label(root_node, caption, Vector3(0, 2.15, 0), 22, color)
	# The body lies behind its front 2x2 interaction apron, never on spawn pads.
	_static_box(id, Vector3(0, 0.55, 0), Vector3(1.65, 1.1, 1.0), root_node)
	StaticMeshBatch.merge_tree(root_node)

func _practice_sign(caption: String, x: float, z: float, accent: Color) -> void:
	var ground := ground_height(x,z)
	var sign := Node3D.new()
	sign.position = Vector3(x,ground,z)
	training_root.add_child(sign)
	OfficeTools.box(sign,Vector3(0,0.055,0),Vector3(3.4,0.08,0.64),accent)
	OfficeTools.box(sign,Vector3(0,0.9,0),Vector3(0.14,1.8,0.14),STONE)
	label(sign,caption,Vector3(0,2.2,0),22,accent)

func show_training_area(terminals: Array) -> void:
	var displays := terminals.filter(func(entry): return str(entry.get("type","")) == "training")
	if training_water_enabled != not displays.is_empty():
		# Initial room state selects the matching terrain before any live props appear.
		setup(config, not displays.is_empty())
	var names := PackedStringArray()
	for entry in displays: names.append(str(entry.id))
	var signature := ",".join(names)
	if signature == training_signature: return
	training_signature = signature
	if is_instance_valid(training_root): training_root.queue_free()
	training_root = null
	if displays.is_empty(): return
	training_root = Node3D.new()
	training_root.name = "TrainingArea"
	map_root.add_child(training_root)
	label(training_root,"枪械试射 · E 领取",Vector3(0,ground_height(0,14)+3.1,14),24,GOLD)
	label(training_root,"钓具试用 · 前方抛竿",Vector3(0,ground_height(0,20)+3.1,20),24,MINT)
	label(training_root,"北侧练习 · 从南门绕行",Vector3(0,ground_height(0,-3.5)+2.7,-3.5),18,GOLD)
	_practice_sign("怪物巡逻 · 自动轮换",0,-21,DANGER)
	_practice_sign("首领演练 · 完整招式",-19,-28,GOLD)
	_practice_sign("拆解练习 · 打碎轮换",13,-22,MINT)
	for entry in displays:
		var id := str(entry.id)
		var definition_id := str(entry.definitionId)
		var is_rod := str(entry.kind) == "rod"
		var stand := Node3D.new()
		stand.name = id
		stand.set_meta("authority_id",id)
		stand.position = Vector3(float(entry.x),float(entry.y),float(entry.z))
		training_root.add_child(stand)
		var accent := MINT if is_rod else GOLD
		OfficeTools.box(stand,Vector3(0,0.45,0),Vector3(1.65,0.9,1.0),Color("38576a"))
		OfficeTools.box(stand,Vector3(0,0.92,0),Vector3(1.65,0.07,1.02),accent)
		var model := Node3D.new()
		stand.add_child(model)
		model.position = Vector3(0,1.28,0)
		model.scale = Vector3.ONE*(0.45 if is_rod else 0.7)
		if definition_id in OfficeTools.NEW_RODS: OfficeTools.build_rod(model,definition_id)
		elif is_rod: OfficeTools.build_legacy_rod(model,definition_id,0.52)
		else: OfficeTools.build(model,definition_id)
		var caption := str(OfficeTheme.NAMES.get(definition_id, ""))
		if caption.is_empty():
			var supplied = entry.get("label")
			caption = supplied.strip_edges() if supplied is String else ""
		if caption.is_empty() or caption.to_lower() in ["null", "<null>"]: caption = "试用装备"
		label(stand,caption,Vector3(0,2.1,0),18,accent)
		# The practice plinth ends at 0.955 m; the ordinary 1.1 m station
		# collider would put an invisible lid directly in front of the muzzle.
		_static_box(id,Vector3(0,0.48,0),Vector3(1.65,0.96,1.0),stand)
		StaticMeshBatch.merge_tree(stand)

func sync_buildings(buildings: Array) -> void:
	for data in buildings:
		var kind := str(data.get("definitionId", data.get("kind", "wall")))
		var id := str(data.get("socketId", data.get("id", "core")))
		if kind == "core":
			id = "core"
		if not building_nodes.has(id):
			building_nodes[id] = _create_building(id, kind)
		var node: Node3D = building_nodes[id]
		var previous_transform := node.transform
		node.position = Vector3(float(data.get("x", node.position.x)), float(data.get("y", ground_height(float(data.get("x", 0)), float(data.get("z", 0))))), float(data.get("z", node.position.z)))
		node.rotation.y = float(data.get("yaw", node.rotation.y))
		if node.transform != previous_transform:
			for shape in node.get_meta("colliders", []):
				QueryPhysics.refresh_body(shape.get_parent())
		node.set_meta("authority_id", str(data.get("id", id)))
		var hp := float(data.get("hp", 0))
		var maximum := float(data.get("maxHp", 1500 if kind == "core" else 400))
		node.set_meta("surface_data",{"hp":hp,"maxHp":maximum,"gateOpen":data.get("gateOpen",false),"level":data.get("level",1)})
		var alive := hp > 0
		var damaged := alive and hp <= maximum * 0.5
		node.get_node("Intact").visible = alive and not damaged
		node.get_node("Damaged").visible = damaged
		node.get_node("Reinforced").visible = alive and int(data.get("level", 1)) >= 2
		var open_gate := kind == "gate" and bool(data.get("gateOpen", false))
		if open_gate:
			node.get_node("Reinforced").visible = false
		if kind == "core":
			node.set_meta("critical", alive and hp <= maximum * 0.2)
			node.get_node("CampLight").light_energy = 1.1 if alive else 0.15
		for shape in node.get_meta("colliders", []):
			QueryPhysics.set_disabled(shape, not alive or (open_gate and str(shape.get_meta("part", "")) == "panel"))
		if kind == "gate":
			for group in ["Intact", "Damaged"]:
				var visual: Node3D = node.get_node(group)
				visual.get_node("Left").position.x = -1.82 if open_gate else -0.60
				visual.get_node("Right").position.x = 1.82 if open_gate else 0.60
		var caption: Label3D = node.get_node("Status")
		caption.text = ("协作灯" if kind == "core" else ("办公室门" if kind == "gate" else "文件柜墙")) + (" · 待重建" if not alive else "  %d / %d" % [hp, maximum])
		caption.visible = kind in ["core", "gate"] or damaged or not alive
		caption.modulate = DANGER if damaged or not alive else GOLD

func _create_building(id: String, kind: String) -> Node3D:
	var root_node := Node3D.new()
	root_node.name = id
	map_root.add_child(root_node)
	var colliders: Array = []
	for title in ["Intact", "Damaged", "Reinforced"]:
		var group := Node3D.new()
		group.name = title
		root_node.add_child(group)
	var width := 3.0
	var depth := 3.0 if kind == "core" else 0.4
	box(root_node, Vector3(0, 0.045, 0), Vector3(width+0.04, 0.13, depth + 0.08), Color("#b3aa85"))
	for damaged in [false, true]:
		var group: Node3D = root_node.get_node("Damaged" if damaged else "Intact")
		OfficeScene.building_visual(group, kind, damaged)
	var reinforce: Node3D = root_node.get_node("Reinforced")
	for x in [-1.10, 1.10]:
		box(reinforce, Vector3(x, 1.3, -depth * 0.55), Vector3(0.18, 2.36, 0.15), Color("#b9c9c4"))
	if kind == "gate":
		for side in [-1.0, 1.0]:
			colliders.append(_static_box(id + "_frame", Vector3(side * 1.35, 1.25, 0), Vector3(0.3, 2.5, 0.4), root_node))
		var panel := _static_box(id + "_panel", Vector3(0, 1.15, 0), Vector3(2.4, 2.3, 0.4), root_node)
		panel.set_meta("part", "panel")
		colliders.append(panel)
	else:
		colliders.append(_static_box(id, Vector3(0, 1.5 if kind == "core" else 1.25, 0), Vector3(3, 3, 3) if kind == "core" else Vector3(3, 2.5, 0.3), root_node))
	root_node.set_meta("colliders", colliders)
	if kind == "core":
		var light := OmniLight3D.new()
		light.name = "CampLight"
		light.position = Vector3(0, 3.5, 0)
		light.omni_range = 15
		light.light_color = GOLD
		light.light_energy = 1.1
		light.shadow_enabled = false
		root_node.add_child(light)
	var status := label(root_node, "", Vector3(0, 3.8 if kind == "core" else 2.85, 0), 18, GOLD)
	status.name = "Status"
	status.visibility_range_end = 28
	StaticMeshBatch.merge_tree(root_node)
	return root_node

func geometry_contract() -> Dictionary:
	return {"grid": GRID, "ponds": PONDS + [TRAINING_POND] if training_water_enabled else PONDS, "rocks": ROCKS, "slots": building_slots(), "terrainTriangles": terrain_triangle_count, "groundLayer": 1, "buildingLayer": 1}
