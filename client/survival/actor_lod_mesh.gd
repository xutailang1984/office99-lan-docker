extends RefCounted

# Optional presentation-only rest-pose proxy. No scene nodes or materials are
# shared between actors: only the immutable ArrayMesh is cached by normal kind.
const NORMAL_KINDS := ["silverfish", "crab", "eel", "courier", "shield_bug", "jammer", "medic_bug", "breaker", "spore_slug", "bubble_puffer", "lantern_fish", "paper_drone", "stamp_bat", "archive_guard"]
static var _cache: Dictionary = {}

static func cached_mesh(kind: String) -> ArrayMesh:
	# Never bake on this path: it is used during a burst of DAY spawns.
	return _cache.get(kind) if kind in NORMAL_KINDS else null

static func _gather(parent: Node3D, relative: Transform3D, entries: Array) -> void:
	for child in parent.get_children():
		if not child is Node3D: continue
		var transform: Transform3D = relative * child.transform
		if child is MeshInstance3D:
			entries.append({"node":child, "transform":transform})
		_gather(child, transform, entries)

static func prepare(body: Node3D, expected_material: ShaderMaterial, kind: String) -> Dictionary:
	if kind not in NORMAL_KINDS or not is_instance_valid(body) or expected_material == null: return {}
	var entries: Array = []
	_gather(body, Transform3D.IDENTITY, entries)
	if entries.size() < 2: return {}
	var source_nodes: Array[MeshInstance3D] = []
	var shadow_mode := (entries[0].node as MeshInstance3D).cast_shadow
	var render_layers: int = entries[0].node.layers
	# Fail closed if future art adds a different shader, per-surface override,
	# hidden variant, or multiple surfaces. Never discard such geometry silently.
	for entry in entries:
		var visual: MeshInstance3D = entry.node
		if not visual.visible or not visual.mesh is ArrayMesh or visual.mesh.get_surface_count() != 1: return {}
		if visual.material_override != expected_material or visual.material_overlay != null or visual.get_surface_override_material(0) != null: return {}
		if visual.cast_shadow != shadow_mode or visual.layers != render_layers: return {}
		var ancestor: Node = visual.get_parent()
		while ancestor != body:
			if ancestor is Node3D and not ancestor.visible: return {}
			ancestor = ancestor.get_parent()
		source_nodes.append(visual)
	if not _cache.has(kind):
		var vertices := PackedVector3Array()
		var normals := PackedVector3Array()
		var colors := PackedColorArray()
		for entry in entries:
			var visual: MeshInstance3D = entry.node
			var source: Array = visual.mesh.surface_get_arrays(0)
			if source[Mesh.ARRAY_VERTEX] == null or source[Mesh.ARRAY_NORMAL] == null or source[Mesh.ARRAY_COLOR] == null: return {}
			var points: PackedVector3Array = source[Mesh.ARRAY_VERTEX]
			var directions: PackedVector3Array = source[Mesh.ARRAY_NORMAL]
			var shades: PackedColorArray = source[Mesh.ARRAY_COLOR]
			if points.size() != directions.size() or points.size() != shades.size(): return {}
			var transform: Transform3D = entry.transform
			var normal_basis: Basis = transform.basis.inverse().transposed()
			var indices: PackedInt32Array = source[Mesh.ARRAY_INDEX] if source[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			var count: int = indices.size() if not indices.is_empty() else points.size()
			if count % 3 != 0: return {}
			for offset in range(count):
				var index: int = indices[offset] if not indices.is_empty() else offset
				vertices.append(transform * points[index])
				normals.append((normal_basis * directions[index]).normalized())
				colors.append(shades[index])
		var arrays: Array = []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = vertices
		arrays[Mesh.ARRAY_NORMAL] = normals
		arrays[Mesh.ARRAY_COLOR] = colors
		var merged := ArrayMesh.new()
		merged.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		_cache[kind] = merged
	var proxy := MeshInstance3D.new()
	proxy.name = "FarSilhouette"
	proxy.mesh = _cache[kind]
	proxy.material_override = expected_material
	proxy.cast_shadow = shadow_mode
	proxy.layers = render_layers
	proxy.visible = false
	body.add_child(proxy)
	return {"proxy":proxy, "sources":source_nodes, "surfaces_before":source_nodes.size(), "surfaces_after":1}
