extends RefCounted

# Blender glTF stores linear COLOR_0. Our procedural art uses sRGB vertex colors;
# normalize once into that same convention and share the resulting static mesh.
# GL Compatibility ignores vertex_color_is_srgb when reading raw linear glTF colors.
const MODELS := {
	"pistol": preload("res://assets/office/pistol.gltf"),
	"smg": preload("res://assets/office/smg.gltf"),
	"lmg": preload("res://assets/office/lmg.gltf"),
	"rod_light": preload("res://assets/office/rod_light.gltf"),
	"rod_heavy": preload("res://assets/office/rod_heavy.gltf"),
	"rod_magnet": preload("res://assets/office/rod_magnet.gltf"),
	"bandage": preload("res://assets/office/bandage.gltf"),
	"repair_kit": preload("res://assets/office/repair_kit.gltf"),
	"coffee_flask": preload("res://assets/office/coffee_flask.gltf"),
	"flash_note": preload("res://assets/office/flash_note.gltf"),
	"decoy_alarm": preload("res://assets/office/decoy_alarm.gltf"),
	"station_supply": preload("res://assets/office/station_supply.gltf"),
	"station_storage": preload("res://assets/office/station_storage.gltf"),
	"station_upgrade": preload("res://assets/office/station_upgrade.gltf"),
	"station_recycle": preload("res://assets/office/station_recycle.gltf"),
}
static var _meshes: Dictionary = {}
static var _material: StandardMaterial3D

static func _display_material() -> StandardMaterial3D:
	if _material == null:
		_material = StandardMaterial3D.new()
		_material.albedo_color = Color.WHITE
		_material.roughness = 0.88
		_material.vertex_color_use_as_albedo = true
		_material.vertex_color_is_srgb = true
	return _material

static func _display_mesh(source: Mesh) -> ArrayMesh:
	var key := source.get_instance_id()
	if _meshes.has(key): return _meshes[key]
	var mesh := ArrayMesh.new()
	for surface in range(source.get_surface_count()):
		var arrays := source.surface_get_arrays(surface)
		var colors: PackedColorArray = arrays[Mesh.ARRAY_COLOR]
		assert(colors.size() > 0, "Office model must contain vertex colors")
		for i in range(colors.size()): colors[i] = colors[i].linear_to_srgb()
		arrays[Mesh.ARRAY_COLOR] = colors
		mesh.add_surface_from_arrays(source.surface_get_primitive_type(surface),arrays)
		mesh.surface_set_material(surface,_display_material())
	_meshes[key] = mesh
	return mesh

static func attach(parent: Node3D, id: String) -> void:
	assert(MODELS.has(id), "Unknown office asset")
	var model: Node3D = MODELS[id].instantiate()
	model.name = "OfficeAsset"
	parent.add_child(model)
	for node in model.find_children("*","MeshInstance3D",true,false):
		var mesh: MeshInstance3D = node
		mesh.mesh = _display_mesh(mesh.mesh)
		mesh.material_override = _display_material()
