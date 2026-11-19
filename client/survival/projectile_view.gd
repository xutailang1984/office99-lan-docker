extends Node3D

# Render only between authoritative samples. No guessed future flight or damage.
const DELAY := 0.10
const STALE_SECONDS := 0.25
static var _mesh: ArrayMesh
static var _materials: Dictionary = {}
var _samples: Array[Dictionary] = []
var presentation_time := 0.0
var _receive_age := 0.0
var _finished := false
var visual: MeshInstance3D

static func shared_mesh() -> ArrayMesh:
	if _mesh != null: return _mesh
	var vertices := PackedVector3Array()
	# One faceted luminous head and tapered tail, one surface, no light/particles.
	var head := BoxMesh.new()
	head.size = Vector3(0.15, 0.15, 0.22)
	var arrays := head.get_mesh_arrays()
	for index in arrays[Mesh.ARRAY_INDEX]: vertices.append(arrays[Mesh.ARRAY_VERTEX][index])
	var base := [Vector3(-0.065,-0.065,0.08),Vector3(0.065,-0.065,0.08),Vector3(0.065,0.065,0.08),Vector3(-0.065,0.065,0.08)]
	for i in range(4): vertices.append_array(PackedVector3Array([base[i],base[(i+1)%4],Vector3(0,0,0.62)]))
	var result := []
	result.resize(Mesh.ARRAY_MAX)
	result[Mesh.ARRAY_VERTEX] = vertices
	_mesh = ArrayMesh.new()
	_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,result)
	return _mesh

static func shared_material(id: String) -> StandardMaterial3D:
	var key := id if id in ["slow_bolt","paper_bolt","archive_spread","power_bolt"] else "electric_bolt"
	if not _materials.has(key):
		var material := StandardMaterial3D.new()
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		material.cull_mode = BaseMaterial3D.CULL_DISABLED
		material.albedo_color = {"slow_bolt":Color("be9be6"),"paper_bolt":Color("f3e3bb"),"archive_spread":Color("eea36c"),"power_bolt":Color("ffc95b"),"electric_bolt":Color("88eadb")}[key]
		_materials[key] = material
	return _materials[key]

func _vector(value: Dictionary) -> Vector3:
	return Vector3(float(value.get("x",0)),float(value.get("y",0)),float(value.get("z",0)))

func push_sample(data: Dictionary, server_time: float) -> void:
	if _finished or not is_finite(server_time): return
	if not _samples.is_empty() and server_time <= float(_samples.back().time): return
	var point := _vector(data)
	if not point.is_finite(): return
	if visual == null:
		visual = MeshInstance3D.new()
		visual.mesh = shared_mesh()
		visual.material_override = shared_material(str(data.get("definitionId","electric_bolt")))
		visual.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(visual)
	if _samples.is_empty():
		var born := float(data.get("spawnAt",server_time))
		if data.get("from") is Dictionary and is_finite(born) and born < server_time:
			_samples.append({"time":born,"point":_vector(data.from)})
		presentation_time = maxf(born, server_time-DELAY)
	elif _receive_age > STALE_SECONDS:
		# A resumed stream starts at its latest known segment; don't chase a backlog.
		presentation_time = maxf(presentation_time,server_time-DELAY)
	_samples.append({"time":server_time,"point":point})
	while _samples.size()>4: _samples.pop_front()
	presentation_time=clampf(presentation_time,float(_samples.front().time),server_time)
	_receive_age=0
	visible=true
	var velocity := Vector3(float(data.get("vx",0)),float(data.get("vy",0)),float(data.get("vz",0)))
	if velocity.length_squared()>.0001:
		var forward := velocity.normalized()
		basis=Basis.looking_at(forward,Vector3.RIGHT if absf(forward.dot(Vector3.UP))>.98 else Vector3.UP)
	_sample_position()

func _sample_position() -> void:
	if _samples.is_empty(): return
	position=_samples.back().point
	for i in range(1,_samples.size()):
		var a: Dictionary=_samples[i-1]
		var b: Dictionary=_samples[i]
		if presentation_time<=float(b.time):
			position=(a.point as Vector3).lerp(b.point,clampf((presentation_time-float(a.time))/maxf(.00001,float(b.time)-float(a.time)),0,1))
			return

func advance(delta: float, world_paused := false) -> void:
	if _finished or _samples.is_empty() or world_paused: return
	_receive_age+=maxf(0,delta)
	presentation_time=minf(presentation_time+maxf(0,delta),float(_samples.back().time))
	_sample_position()
	visible=_receive_age<=STALE_SECONDS

func finish(at: Vector3) -> void:
	position=at
	_finished=true
	visible=false
	_samples.clear()

func reset() -> void:
	_samples.clear()
	presentation_time=0
	_receive_age=0
	_finished=false
	visible=false

func sample_count() -> int:
	return _samples.size()
