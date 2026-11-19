extends Node3D
const QueryPhysics=preload("res://survival/static_query_physics.gd")

const TerrainSupport = preload("res://survival/terrain_support.gd")

var visual: Node3D
var cubes: Array = []
var material: ShaderMaterial
var mesh_instance: MeshInstance3D
var dimensions := Vector3.ONE
static var _shared_shader: Shader
static var _mesh_library: Dictionary = {}
var _mesh_key := ""
const SEARCHABLE := ["archive_cabinet","supply_locker","cable_reel","punch_clock","notice_board"]
const SPECIAL := ["archive_cabinet","partition_panel","copier_shell","supply_locker","cable_reel","punch_clock","notice_board"]

static func shared_shader() -> Shader:
	if _shared_shader==null:
		_shared_shader=Shader.new()
		_shared_shader.code="shader_type spatial; render_mode diffuse_lambert, specular_disabled; uniform float hit_flash=0.0; void fragment(){ALBEDO=mix(COLOR.rgb,vec3(1.0,0.87,0.65),hit_flash);ROUGHNESS=0.88;}"
	return _shared_shader

func _attach_mesh(mesh: ArrayMesh) -> void:
	if material==null:
		material=ShaderMaterial.new()
		material.shader=shared_shader()
	if mesh_instance==null:
		mesh_instance=MeshInstance3D.new()
		mesh_instance.material_override=material
		visual.add_child(mesh_instance)
	mesh_instance.mesh=mesh
	cubes.clear()

func _box(at: Vector3, size: Vector3, color: Color, rotation_value := Vector3.ZERO) -> void:
	cubes.append({"at":at,"size":size,"color":color,"rotation":rotation_value})

func _bake() -> void:
	if _mesh_library.has(_mesh_key):
		_attach_mesh(_mesh_library[_mesh_key])
		return
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	for cube in cubes:
		var box := BoxMesh.new()
		box.size=cube.size
		var source := box.get_mesh_arrays()
		var basis := Basis.from_euler(cube.rotation)
		for index in source[Mesh.ARRAY_INDEX]:
			vertices.append(basis*source[Mesh.ARRAY_VERTEX][index]+cube.at)
			normals.append(basis*source[Mesh.ARRAY_NORMAL][index])
			colors.append(cube.color)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX]=vertices
	arrays[Mesh.ARRAY_NORMAL]=normals
	arrays[Mesh.ARRAY_COLOR]=colors
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	_mesh_library[_mesh_key]=mesh
	_attach_mesh(mesh)

func _visual_state(data: Dictionary) -> String:
	if str(data.get("kind","")) not in SPECIAL:
		return "base"
	if str(data.get("kind",""))=="copier_shell" and bool(data.get("armed",false)):
		return "armed"
	if str(data.get("kind","")) in SEARCHABLE and bool(data.get("opened",false)):
		return "open"
	return "damaged" if float(data.get("hp",1))<=float(data.get("maxHp",1))*0.5 else "intact"

func _compose(data: Dictionary) -> void:
	cubes.clear()
	var card := Color("bb9469")
	var tape := Color("eadbad")
	var ink := Color("3e5665")
	var kind := str(data.get("kind","crate"))
	var visual_state := _visual_state(data)
	_mesh_key=kind+":"+str(dimensions)+(":"+visual_state if kind in SPECIAL else "")
	var w := dimensions.x
	var h := dimensions.y
	var d := dimensions.z
	if kind=="crate":
		_box(Vector3(0,h/2,0),Vector3(w*0.98,h*0.98,d*0.98),card)
		_box(Vector3(0,h*0.99,0),Vector3(w*0.18,0.02,d*0.99),tape)
		for side in [-1,1]:
			_box(Vector3(0,h/2,side*d*0.498),Vector3(w*0.18,h*0.98,0.015),tape)
			_box(Vector3(w*0.23,h*0.57,side*d*0.505),Vector3(w*0.32,h*0.30,0.012),Color("f4ecd6"))
			for i in range(5): _box(Vector3(w*(0.10+i*0.05),h*0.55,side*d*0.514),Vector3(w*0.02,h*0.13,0.01),ink)
		_box(Vector3(0,h*0.993,0),Vector3(w*0.025,0.022,d*1.01),card.darkened(0.30))
	elif kind=="barrel":
		for i in range(8):
			var angle := i*TAU/8
			_box(Vector3(sin(angle)*w*0.34,h/2,cos(angle)*d*0.34),Vector3(w*0.36,h*0.94,d*0.28),Color("5b96a6"),Vector3(0,angle,0))
		for y in [h*0.12,h*0.84]: _box(Vector3(0,y,0),Vector3(w*0.91,h*0.09,d*0.91),ink)
		_box(Vector3(0,h*0.98,0),Vector3(w*0.83,0.06,d*0.83),Color("aec3c7"))
		_box(Vector3(0,h*0.50,-d*0.49),Vector3(w*0.46,h*0.38,0.018),tape)
		_box(Vector3(0,h*0.5,-d*0.504),Vector3(w*0.08,h*0.27,0.008),ink)
	elif kind=="barricade":
		_box(Vector3(0,h*0.53,0),Vector3(w,h*0.82,d*0.34),Color("a6b5ae"))
		for side in [-1,1]:
			_box(Vector3(side*w*0.38,h/2,0),Vector3(w*0.09,h,d*0.52),ink)
			_box(Vector3(side*w*0.38,0.07,0),Vector3(w*0.22,0.14,d),ink)
		for i in range(3):
			_box(Vector3(w*(-0.27+i*0.27),h*0.62,-d*0.185),Vector3(w*0.19,h*0.31,0.016),tape if i%2 else Color("d78973"))
	elif kind=="partition_panel":
		var panel := Color("8aaeb1") if visual_state!="damaged" else Color("667f83")
		var frame := Color("324f5d")
		# The visible slab exactly fills the authoritative box; a decorative
		# inset here would look like another invisible bullet-stopping wall.
		_box(Vector3(0,h*0.5,0),Vector3(w,h,d),panel)
		for face in [-1.0,1.0]:
			for side in [-1.0,1.0]:
				_box(Vector3(side*w*0.475,h*0.5,face*d*0.54),Vector3(w*0.05,h,d*0.045),frame)
			for level in [0.08,0.92]:
				_box(Vector3(0,h*level,face*d*0.54),Vector3(w,h*0.055,d*0.045),frame)
			_box(Vector3(0,h*0.68,face*d*0.54),Vector3(w*0.67,h*0.11,d*0.018),Color("e9cd78"))
			_box(Vector3(0,h*0.44,face*d*0.54),Vector3(w*0.49,h*0.17,d*0.018),Color("dce9df"))
			if visual_state=="damaged":
				var crack := Color("2a454e")
				_box(Vector3(w*0.14,h*0.52,face*d*0.557),Vector3(w*0.045,h*0.38,d*0.014),crack,Vector3(0,0,0.18))
				_box(Vector3(w*0.06,h*0.31,face*d*0.557),Vector3(w*0.035,h*0.19,d*0.014),crack,Vector3(0,0,-0.22))
	elif kind=="copier_shell":
		var steel := Color("9cabb2") if visual_state!="damaged" else Color("71838b")
		var dark := Color("344952")
		# The solid cabinet fills the authoritative collision box. The amber
		# lamp is on the front face at y=0.72h and matches the server hit zone.
		_box(Vector3(0,h*0.5,0),Vector3(w,h,d),steel)
		_box(Vector3(0,h*0.28,-d*0.505),Vector3(w*0.92,h*0.37,d*0.025),dark)
		_box(Vector3(0,h*0.46,-d*0.525),Vector3(w*0.74,h*0.085,d*0.025),Color("d8d6c8"))
		_box(Vector3(0,h*0.78,-d*0.505),Vector3(w*0.86,h*0.27,d*0.025),dark)
		_box(Vector3(0,h*0.72,-d*0.535),Vector3(w*0.22,h*0.16,d*0.025),Color("ffad42") if visual_state!="armed" else Color("ffdd66"))
		_box(Vector3(-w*0.28,h*0.9,-d*0.52),Vector3(w*0.18,h*0.035,d*0.03),Color("dbe9e2"))
		for side in [-1.0,1.0]:
			_box(Vector3(side*w*0.43,h*0.58,-d*0.52),Vector3(w*0.035,h*0.76,d*0.03),Color("6b8088"))
			_box(Vector3(side*w*0.32,h*0.97,0),Vector3(w*0.12,h*0.055,d*0.9),dark)
		if visual_state=="damaged" or visual_state=="armed" and float(data.get("hp",1))<=float(data.get("maxHp",1))*0.5:
			_box(Vector3(w*0.25,h*0.52,-d*0.545),Vector3(w*0.035,h*0.22,d*0.015),Color("3f5159"),Vector3(0,0,0.17))
	elif kind in ["supply_locker","cable_reel","punch_clock","notice_board"]:
		var color: Color={"supply_locker":Color("689597"),"cable_reel":Color("876d58"),"punch_clock":Color("cb896f"),"notice_board":Color("bea273")}[kind]
		_box(Vector3(0,h*.5,0),Vector3(w,h,d),color.darkened(.14) if visual_state=="damaged" else color)
		if kind=="supply_locker":
			_box(Vector3(0,h*.5,-d*.5-.015),Vector3(w*.78,h*.83,.025),ink)
			_box(Vector3(w*.24,h*.5,-d*.5-.043),Vector3(.04,h*.25,.028),tape)
		elif kind=="cable_reel":
			for side in [-1.0,1.0]:_box(Vector3(side*w*.42,h*.54,0),Vector3(w*.10,h*.77,d*.90),tape)
			for i in range(4):_box(Vector3(w*(-.24+i*.16),h*.87,-d*.5-.011),Vector3(w*.09,h*.12,.018),ink)
		elif kind=="punch_clock":
			_box(Vector3(0,h*.68,-d*.5-.015),Vector3(w*.72,h*.28,.025),ink)
			_box(Vector3(0,h*.69,-d*.5-.044),Vector3(w*.42,h*.13,.025),Color("acd5a8"))
			_box(Vector3(0,h*.31,-d*.5-.013),Vector3(w*.58,h*.05,.02),tape)
		else:
			for i in range(3):_box(Vector3(w*(-.30+i*.30),h*(.5 if i==1 else .68),-d*.5-.02),Vector3(w*.23,h*.26,.03),[tape,Color("c4d8b2"),Color("d7acc8")][i])
		var marker: Color=Color("8fc5a6") if visual_state=="open" else tape
		_box(Vector3(0,h*.12,-d*.5-.014),Vector3(w*.22,h*.045,.02),marker)
	else:
		var steel := Color("557483") if visual_state!="damaged" else Color("465d68")
		var edge := Color("2f4855")
		var label := Color("f3e9ca")
		var folder := Color("e8b94f")
		_box(Vector3(0,h*0.50,0),Vector3(w*0.97,h*0.98,d*0.96),steel)
		_box(Vector3(0,h*0.985,0),Vector3(w,0.045,d),edge)
		for side in [-1,1]:
			_box(Vector3(side*w*0.49,h*0.50,0),Vector3(w*0.045,h,d),edge)
			_box(Vector3(side*w*0.37,0.055,0),Vector3(w*0.18,0.11,d*0.86),edge)
		for i in range(4):
			var opened := visual_state=="open" and i==1
			var damaged := visual_state=="damaged" and i==2
			var pull := 0.42 if opened else 0.0
			var drawer_y := h*(0.17+float(i)*0.215)
			var drawer_z := -d*0.505-pull
			if opened:
				_box(Vector3(0,drawer_y,-d*0.50-pull*0.52),Vector3(w*0.86,h*0.17,pull+0.05),edge.darkened(0.12))
				_box(Vector3(0,drawer_y+h*0.055,-d*0.52-pull*0.62),Vector3(w*0.67,h*0.055,pull*0.48),folder)
			_box(Vector3(w*0.025 if damaged else 0,drawer_y,drawer_z),Vector3(w*0.88,h*0.175,0.055),steel.lightened(0.06),Vector3(0,0,0.07 if damaged else 0))
			_box(Vector3(0,drawer_y,drawer_z-0.038),Vector3(w*0.32,h*0.075,0.012),label)
			_box(Vector3(0,drawer_y-h*0.055,drawer_z-0.070),Vector3(w*0.25,h*0.025,0.028),edge)
		_box(Vector3(0,h*0.925,-d*0.515),Vector3(w*0.58,h*0.055,0.018),folder)

func _solid_box(body: StaticBody3D, offset: Vector3, size: Vector3, angle: float = 0.0) -> void:
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	var sine := absf(sin(angle))
	var cosine := absf(cos(angle))
	box.size = Vector3(cosine*size.x+sine*size.z,size.y,sine*size.x+cosine*size.z)
	shape.shape = box
	shape.position = Vector3(offset.x*cos(angle)+offset.z*sin(angle),offset.y,-offset.x*sin(angle)+offset.z*cos(angle))
	body.add_child(shape)

func setup(data: Dictionary, ground: Callable = Callable()) -> void:
	set_meta("data",data)
	set_meta("hit_flash",0.0)
	position=Vector3(float(data.x),float(data.y),float(data.z))
	dimensions=Vector3(float(data.size.x),float(data.size.y),float(data.size.z))
	visual=Node3D.new()
	add_child(visual)
	visual.rotation.y=float(data.get("yaw",0))
	_compose(data)

	_bake()
	var collider := StaticBody3D.new()
	collider.set_meta("destructible_id",str(data.id))
	add_child(collider)
	var angle := float(data.get("yaw",0))
	var w := dimensions.x
	var h := dimensions.y
	var d := dimensions.z
	var footprint := Vector2(absf(cos(angle))*w+absf(sin(angle))*d,absf(sin(angle))*w+absf(cos(angle))*d)
	# Wire coordinates are quantized; never re-select terrain cells independently
	# from authority at cell edges. Legacy/local preview fixtures use the fallback.
	var bottom := TerrainSupport.attach(self,position,footprint,ground,float(data.get("supportY",NAN)))
	var kind := str(data.get("kind",""))
	if kind in ["barrel","barricade"]:
		# Match the visible round barrel / thin board, rather than blocking all
		# shots through their empty rectangular corners. Terrain support stays solid.
		if bottom < position.y:
			_solid_box(collider,Vector3(0,(bottom-position.y)/2,0),Vector3(footprint.x,position.y-bottom,footprint.y))
		if kind == "barrel":
			for size in [Vector3(w*0.84,h,d*0.84),Vector3(w,h,d*0.68),Vector3(w*0.68,h,d)]:
				_solid_box(collider,Vector3(0,h/2,0),size,angle)
		else:
			_solid_box(collider,Vector3(0,h*0.53,0),Vector3(w,h*0.82,d*0.4),angle)
			for side in [-1.0,1.0]:
				_solid_box(collider,Vector3(side*w*0.38,h/2,0),Vector3(w*0.09,h,d*0.52),angle)
				_solid_box(collider,Vector3(side*w*0.38,h*0.07,0),Vector3(w*0.22,h*0.14,d),angle)
	else:
		_solid_box(collider,Vector3(0,(h+bottom-position.y)/2,0),Vector3(footprint.x,h+position.y-bottom,footprint.y))
	QueryPhysics.refresh_body(collider)

func apply_state(data: Dictionary) -> void:
	set_meta("data",data)
	if str(data.get("kind","")) not in SPECIAL:
		return
	var next_key := str(data.get("kind",""))+":"+str(dimensions)+":"+_visual_state(data)
	if next_key==_mesh_key:
		return
	_compose(data)
	_bake()

func _process(delta: float) -> void:
	var flash := maxf(0,float(get_meta("hit_flash",0))-delta)
	set_meta("hit_flash",flash)
	if material!=null:
		material.set_shader_parameter("hit_flash",flash*3.3)
	if visual!=null:
		visual.position.x=sin(flash*90)*flash*0.13
		var data: Dictionary=get_meta("data",{})
		var damage := 1.0-float(data.get("hp",1))/maxf(1,float(data.get("maxHp",1)))
		visual.rotation.z=(0.0 if str(data.get("kind",""))=="partition_panel" else damage*0.05)+sin(flash*60)*flash*0.035
