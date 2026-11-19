extends RefCounted

# Bake only rigid, opaque, untextured primitives sharing one transform parent.
# Moving parent nodes, colliders, named animation parts and visibility groups survive.
static func merge_tree(parent: Node, keep_names: Array[String] = []) -> int:
	var saved := 0
	for child in parent.get_children():
		saved += merge_tree(child, keep_names)
	if not parent is Node3D: return saved
	var groups: Dictionary = {}
	for child in parent.get_children():
		if not child is MeshInstance3D or not child.mesh is BoxMesh or str(child.name) in keep_names: continue
		if not child.visible or child.material_override == null or not child.material_override is StandardMaterial3D: continue
		var mat := child.material_override as StandardMaterial3D
		if mat.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED or mat.albedo_texture != null or mat.normal_enabled or mat.emission_enabled or mat.vertex_color_use_as_albedo: continue
		var key := JSON.stringify([mat.shading_mode,mat.roughness,mat.metallic,mat.cull_mode,child.cast_shadow,child.layers])
		if not groups.has(key): groups[key]=[]
		groups[key].append(child)
	for key in groups:
		var nodes: Array = groups[key]
		if nodes.size()<2: continue
		var vertices := PackedVector3Array()
		var normals := PackedVector3Array()
		var colors := PackedColorArray()
		for node in nodes:
			var source: Array = node.mesh.get_mesh_arrays()
			var normal_basis: Basis = node.basis.inverse().transposed()
			var mat := node.material_override as StandardMaterial3D
			for index in source[Mesh.ARRAY_INDEX]:
				vertices.append(node.transform*source[Mesh.ARRAY_VERTEX][index])
				normals.append((normal_basis*source[Mesh.ARRAY_NORMAL][index]).normalized())
				colors.append(mat.albedo_color)
		var arrays: Array = []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX]=vertices
		arrays[Mesh.ARRAY_NORMAL]=normals
		arrays[Mesh.ARRAY_COLOR]=colors
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
		var combined := MeshInstance3D.new()
		combined.name="BatchedBoxes"
		combined.mesh=mesh
		combined.cast_shadow=nodes[0].cast_shadow
		combined.layers=nodes[0].layers
		var material: StandardMaterial3D = nodes[0].material_override.duplicate()
		material.albedo_color=Color.WHITE
		material.vertex_color_use_as_albedo=true
		material.vertex_color_is_srgb=true
		combined.material_override=material
		parent.add_child(combined)
		saved += nodes.size()-1
		for node in nodes: node.free()
	return saved
