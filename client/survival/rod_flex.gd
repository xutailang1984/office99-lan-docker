extends RefCounted

# Each held rod owns its material instances. Deformation bends the existing
# mesh, so no overlapping decorative shaft can shimmer against it.
const CODE := """shader_type spatial;
render_mode diffuse_lambert, specular_disabled;
uniform mat4 to_rod;
uniform mat4 from_rod;
uniform vec4 tint : source_color = vec4(1.0);
uniform bool vertex_tint = false;
uniform bool stowed_part = false;
uniform bool line_out = false;
uniform float load_amount = 0.0;
void vertex(){
 vec3 p=(to_rod*vec4(VERTEX,1.0)).xyz;
 float h=max(p.y-0.30,0.0);
 p.z-=h*h*load_amount*0.22;
 VERTEX=(from_rod*vec4(p,1.0)).xyz;
 vec3 n=normalize(mat3(to_rod)*NORMAL);
 n.y+=2.0*h*load_amount*0.22*n.z;
 NORMAL=normalize(mat3(from_rod)*n);
}
void fragment(){if(stowed_part&&line_out){discard;}ALBEDO=tint.rgb*(vertex_tint?COLOR.rgb:vec3(1.0));ROUGHNESS=0.88;}
"""
static var shader: Shader
static var meshes: Dictionary={}

static func _flexible_mesh(source: Mesh) -> ArrayMesh:
	var key := source.get_instance_id()
	if meshes.has(key): return meshes[key]
	var result := ArrayMesh.new()
	for surface in range(source.get_surface_count()):
		var arrays: Array=source.surface_get_arrays(surface)
		var points: PackedVector3Array=arrays[Mesh.ARRAY_VERTEX]
		var normals: PackedVector3Array=arrays[Mesh.ARRAY_NORMAL]
		var colors: PackedColorArray=arrays[Mesh.ARRAY_COLOR] if arrays[Mesh.ARRAY_COLOR]!=null else PackedColorArray()
		var indices: PackedInt32Array=arrays[Mesh.ARRAY_INDEX]
		if indices.is_empty():
			for index in range(points.size()): indices.append(index)
		var vertices := PackedVector3Array()
		var ns := PackedVector3Array()
		var cs := PackedColorArray()
		for at in range(0,indices.size(),3):
			var ids := [indices[at],indices[at+1],indices[at+2]]
			var low := minf(points[ids[0]].y,minf(points[ids[1]].y,points[ids[2]].y))
			var high := maxf(points[ids[0]].y,maxf(points[ids[1]].y,points[ids[2]].y))
			var steps := clampi(int(ceil((high-low)/0.14)),1,14)
			for i in range(steps):
				for j in range(steps-i):
					var weights := [Vector2(i,j),Vector2(i+1,j),Vector2(i,j+1)]
					if j<steps-i-1: weights.append_array([Vector2(i+1,j),Vector2(i+1,j+1),Vector2(i,j+1)])
					for weight in weights:
						var b: float=weight.x/steps
						var c: float=weight.y/steps
						var a := 1.0-b-c
						vertices.append(points[ids[0]]*a+points[ids[1]]*b+points[ids[2]]*c)
						ns.append((normals[ids[0]]*a+normals[ids[1]]*b+normals[ids[2]]*c).normalized())
						if not colors.is_empty(): cs.append(colors[ids[0]]*a+colors[ids[1]]*b+colors[ids[2]]*c)
		var out: Array=[]
		out.resize(Mesh.ARRAY_MAX)
		out[Mesh.ARRAY_VERTEX]=vertices
		out[Mesh.ARRAY_NORMAL]=ns
		if not cs.is_empty(): out[Mesh.ARRAY_COLOR]=cs
		result.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,out)
		result.surface_set_material(surface,source.surface_get_material(surface))
	meshes[key]=result
	return result

static func attach(model: Node3D) -> void:
	if shader==null:
		shader=Shader.new()
		shader.code=CODE
	var materials: Array[ShaderMaterial]=[]
	var highest := Vector3.ZERO
	for node in model.find_children("*","MeshInstance3D",true,false):
		var mesh: MeshInstance3D=node
		mesh.mesh=_flexible_mesh(mesh.mesh)
		mesh.extra_cull_margin=2.0
		var transform := Transform3D.IDENTITY
		var current: Node3D=mesh
		while current!=model:
			transform=current.transform*transform
			current=current.get_parent() as Node3D
		for surface in range(mesh.mesh.get_surface_count()):
			var original=mesh.get_active_material(surface)
			if not original is StandardMaterial3D: continue
			var mat := ShaderMaterial.new()
			mat.shader=shader
			mat.set_shader_parameter("to_rod",transform)
			mat.set_shader_parameter("from_rod",transform.affine_inverse())
			mat.set_shader_parameter("tint",original.albedo_color)
			mat.set_shader_parameter("vertex_tint",original.vertex_color_use_as_albedo)
			mat.set_shader_parameter("stowed_part",original.resource_name in ["cream","coral"])
			mesh.set_surface_override_material(surface,mat)
			materials.append(mat)
			var arrays: Array=mesh.mesh.surface_get_arrays(surface)
			for vertex in arrays[Mesh.ARRAY_VERTEX]:
				var at: Vector3=transform*vertex
				if at.y>highest.y: highest=at
		mesh.material_override=null
	model.set_meta("flex_materials",materials)
	model.set_meta("flex_tip",highest)
	model.set_meta("flex_load",0.0)
	var tip=model.get_node_or_null("Muzzle")
	if tip==null:
		tip=Marker3D.new()
		tip.name="Muzzle"
		model.add_child(tip)
	tip.position=highest

static func animate(model: Node3D, amount: float, delta: float, line_out := false) -> void:
	if not model.has_meta("flex_materials"): return
	var load_value := lerpf(float(model.get_meta("flex_load",0)),clampf(amount,0,1),minf(delta*9,1))
	model.set_meta("flex_load",load_value)
	for mat in model.get_meta("flex_materials",[]):
		mat.set_shader_parameter("load_amount",load_value)
		mat.set_shader_parameter("line_out",line_out)
	var tip: Vector3=model.get_meta("flex_tip")
	tip.z-=pow(maxf(tip.y-0.30,0),2)*load_value*0.22
	model.get_node("Muzzle").position=tip
