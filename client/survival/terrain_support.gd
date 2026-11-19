extends RefCounted

# Must match terrain-layout.mjs footprintBase: conservative cell-vertex lower
# bound. Supports keep old IDs/positions, while covering sloping ground below.
static var _material: StandardMaterial3D

static func base_height(at: Vector3, size: Vector2, ground: Callable) -> float:
	var lowest := at.y
	for gx in range(int(floor((at.x-size.x*0.5)/2.0)),int(ceil((at.x+size.x*0.5)/2.0))+1):
		for gz in range(int(floor((at.z-size.y*0.5)/2.0)),int(ceil((at.z+size.y*0.5)/2.0))+1):
			lowest=minf(lowest,float(ground.call(gx*2.0,gz*2.0)))
	return lowest-0.025 if at.y-lowest>0.08 else at.y

static func attach(parent: Node3D, at: Vector3, size: Vector2, ground: Callable, authoritative_bottom: float = NAN) -> float:
	if not ground.is_valid(): return at.y
	var bottom := authoritative_bottom if is_finite(authoritative_bottom) else base_height(at,size,ground)
	if bottom>=at.y: return bottom
	var mesh := BoxMesh.new()
	mesh.size=Vector3(size.x,at.y-bottom+0.05,size.y)
	var support := MeshInstance3D.new()
	support.name="TerrainSupport"
	support.mesh=mesh
	if _material==null:
		_material=StandardMaterial3D.new()
		_material.albedo_color=Color("626f70")
		_material.roughness=1.0
	support.material_override=_material
	parent.add_child(support)
	support.position.y=(bottom-at.y+0.05)*0.5
	return bottom
