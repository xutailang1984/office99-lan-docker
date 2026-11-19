extends Node3D

# Ground telegraphs share meshes/materials. The shape is the server attack area,
# including safe inner circles; visual pulses never change the hit boundary.
static var meshes: Dictionary = {}
static var materials: Dictionary = {}
var visual: MeshInstance3D
var extra_marks: Array[MeshInstance3D] = []

static func material(healing: bool) -> StandardMaterial3D:
	if not materials.has(healing):
		var result := StandardMaterial3D.new()
		result.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
		result.vertex_color_use_as_albedo=true
		result.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
		result.cull_mode=BaseMaterial3D.CULL_DISABLED
		result.albedo_color=Color("83d8b4") if healing else Color("eea255")
		materials[healing]=result
	return materials[healing]

static func triangle(vertices: PackedVector3Array, colors: PackedColorArray, a: Vector3, b: Vector3, c: Vector3, alpha: float) -> void:
	vertices.append_array(PackedVector3Array([a,b,c]))
	for i in range(3): colors.append(Color(1,1,1,alpha))

static func quad(vertices: PackedVector3Array, colors: PackedColorArray, a: Vector3, b: Vector3, c: Vector3, d: Vector3, alpha: float) -> void:
	triangle(vertices,colors,a,b,c,alpha)
	triangle(vertices,colors,a,c,d,alpha)

static func mesh(zone: Dictionary) -> ArrayMesh:
	var shape := str(zone.get("shape","circle"))
	var radius := float(zone.get("radius",1.5))
	var inner := float(zone.get("innerRadius",0))
	var length := float(zone.get("length",6))
	var width := float(zone.get("width",1.6))
	var angle := float(zone.get("halfAngle",PI)) if shape=="cone" else PI
	var key := "%s:%s:%s:%s:%s:%s" % [shape,radius,inner,length,width,angle]
	if meshes.has(key): return meshes[key]
	var vertices := PackedVector3Array()
	var colors := PackedColorArray()
	if shape=="projection":
		# An ink-pad silhouette beneath a descending stamp, not a universal danger ring.
		var half := radius*.72
		quad(vertices,colors,Vector3(-half,0,-half),Vector3(half,0,-half),Vector3(half,0,half),Vector3(-half,0,half),.24)
		for i in range(3):
			var row := (i-1)*half*.46
			quad(vertices,colors,Vector3(-half*.6,0,row-.035),Vector3(half*.6,0,row-.035),Vector3(half*.6,0,row+.035),Vector3(-half*.6,0,row+.035),.8)
	elif shape=="spokes":
		for ray_index in range(8):
			var ray := Vector3(sin(ray_index*TAU/8),0,-cos(ray_index*TAU/8))
			var edge := Vector3(-ray.z,0,ray.x)*width*.5
			quad(vertices,colors,ray*.6-edge,ray*radius-edge,ray*radius+edge,ray*.6+edge,.28)
			quad(vertices,colors,ray*.6-edge,ray*radius-edge,ray*radius-edge*.75,ray*.6-edge*.75,.92)
	elif shape=="line":
		var a:=Vector3(-width/2,0,0)
		var b:=Vector3(width/2,0,0)
		var c:=Vector3(width/2,0,-length)
		var d:=Vector3(-width/2,0,-length)
		quad(vertices,colors,a,b,c,d,0.18)
		for pair in [[a,b],[b,c],[c,d],[d,a]]:
			var delta: Vector3 = (pair[1]-pair[0]).normalized()
			var normal:=Vector3(-delta.z,0,delta.x)*0.07
			quad(vertices,colors,pair[0]-normal,pair[1]-normal,pair[1]+normal,pair[0]+normal,0.9)
	else:
		for i in range(40):
			var start: float = -angle+2*angle*i/40
			var finish: float = -angle+2*angle*(i+1)/40
			var a:=Vector3(sin(start),0,-cos(start))
			var b:=Vector3(sin(finish),0,-cos(finish))
			quad(vertices,colors,a*inner,b*inner,b*radius,a*radius,0.13)
			quad(vertices,colors,a*maxf(inner,radius-0.09),b*maxf(inner,radius-0.09),b*radius,a*radius,0.92)
			if inner>0: quad(vertices,colors,a*inner,b*inner,b*(inner+0.07),a*(inner+0.07),0.92)
		if shape=="cone":
			for side in [-1,1]:
				var ray:=Vector3(sin(angle*side),0,-cos(angle*side))
				var offset:=Vector3(-ray.z,0,ray.x)*0.045
				quad(vertices,colors,-offset,ray*radius-offset,ray*radius+offset,offset,0.92)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX]=vertices
	arrays[Mesh.ARRAY_COLOR]=colors
	var result := ArrayMesh.new()
	result.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	meshes[key]=result
	return result

func update_zone(zone: Dictionary, healing := false) -> void:
	if visual==null:
		visual=MeshInstance3D.new()
		visual.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(visual)
	top_level=true
	global_position=Vector3(float(zone.x),float(zone.y)+0.075,float(zone.z))
	global_rotation=Vector3(0,float(zone.get("yaw",0)),0)
	var marks: Array=zone.get("points",[]) if str(zone.get("shape",""))=="marks" else []
	visual.position=Vector3.ZERO
	for mark in extra_marks: mark.hide()
	if not marks.is_empty():
		global_rotation=Vector3.ZERO
		var shape := {"shape":"projection" if str(zone.get("footprint","circle"))=="square" else "circle","radius":zone.get("radius",1.8)}
		visual.mesh=mesh(shape)
		visual.position=Vector3(float(marks[0].x),float(marks[0].y)+.075,float(marks[0].z))-global_position
		for i in range(1,mini(3,marks.size())):
			if extra_marks.size()<i:
				var mark:=MeshInstance3D.new()
				mark.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				add_child(mark)
				extra_marks.append(mark)
			var mark:=extra_marks[i-1]
			mark.mesh=visual.mesh
			mark.material_override=material(healing)
			mark.position=Vector3(float(marks[i].x),float(marks[i].y)+.075,float(marks[i].z))-global_position
			mark.show()
	else: visual.mesh=mesh(zone)
	visual.material_override=material(healing)
