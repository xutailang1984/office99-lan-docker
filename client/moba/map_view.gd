extends Node3D

const Tools = preload("res://survival/office_tools.gd")
const Office = preload("res://survival/office_scene.gd")
const Batch = preload("res://survival/static_mesh_batch.gd")
const BLUE := Color("62c1e2")
const RED := Color("ed967c")
static var mats: Dictionary = {}

static func material(color: Color, unlit := false) -> StandardMaterial3D:
	var key := str(color)+str(unlit)
	if not mats.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = color
		m.roughness = .9
		if unlit: m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		if color.a < 1: m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		mats[key] = m
	return mats[key]

static func box(parent: Node3D, at: Vector3, size: Vector3, color: Color, unlit := false) -> MeshInstance3D:
	return Tools.box(parent, at, size, color, unlit)

static func ring(parent: Node3D, radius: float, color: Color, width := .08) -> MeshInstance3D:
	var vertices := PackedVector3Array()
	for i in range(48):
		var a := float(i)*TAU/48.0
		var b := float(i+1)*TAU/48.0
		var p := Vector3(cos(a),0,sin(a))
		var q := Vector3(cos(b),0,sin(b))
		vertices.append_array(PackedVector3Array([p*(radius-width),p*radius,q*radius,p*(radius-width),q*radius,q*(radius-width)]))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material(color,true)
	# Above the highest road/fountain surface; avoid coplanar team markers.
	node.position.y = .18
	parent.add_child(node)
	return node

static func beam(parent: Node3D, from: Vector3, to: Vector3, color: Color, width := .1) -> MeshInstance3D:
	var d := to-from
	var node := box(parent,(from+to)*.5,Vector3(width,width,maxf(.01,d.length())),color,true)
	if d.length()>.001:
		var up:=Vector3.RIGHT if absf(d.normalized().dot(Vector3.UP))>.98 else Vector3.UP
		node.basis=Basis.looking_at(d,up)
	return node

func build(data: Dictionary) -> void:
	var size:=float(data.size)
	var river_width:=float(data.get("riverWidth",14))
	var river_length:=(size-river_width)*sqrt(2.0)
	box(self,Vector3(0,-.6,0),Vector3(size,1,size),Color("315450"))
	box(self,Vector3(0,-1.3,0),Vector3(size+4,.5,size+4),Color("233c43"))
	# Quiet floor trails make jungle routes legible; walls alone block movement.
	for trail in data.get("trails",[]):
		var a:=Vector3(float(trail[0]),-.045,float(trail[1]))
		var b:=Vector3(float(trail[2]),-.045,float(trail[3]))
		var path_floor:=box(self,(a+b)*.5,Vector3(5,.02,a.distance_to(b)+2.0),Color("486257"))
		path_floor.rotation.y=atan2((b-a).x,(b-a).z)
	# Shallow central canal is walkable; visible blockers remain the office walls.
	var river:=box(self,Vector3(0,-.025,0),Vector3(river_width,.04,river_length),Color("437a84"))
	river.rotation.y=PI*.25
	for i in range(-int(size/12),int(size/12)+1):
		var at:=Vector3(i*5.5,0,i*5.5)
		var ripple:=box(self,at,Vector3(2.3,.02,.16),Color("60949a"))
		ripple.rotation.y=-PI*.25
	for side in [-1,1]:
		var bank:=box(self,Vector3(side*river_width*.3535,-.015,-side*river_width*.3535),Vector3(.25,.06,river_length),Color("a0ad9b"))
		bank.rotation.y=PI*.25
	var road_index:=0
	for lane in data.lanes:
		for i in range(lane.size()-1):
			road_index+=1
			var a := Vector3(float(lane[i].x),0,float(lane[i].z))
			var b := Vector3(float(lane[i+1].x),0,float(lane[i+1].z))
			var road := box(self,(a+b)*.5+Vector3(0,.01+road_index*.004,0),Vector3(float(data.get("laneWidth",12)),.12,a.distance_to(b)+float(data.get("laneWidth",12))*.45),Color("868f7e"))
			road.rotation.y = atan2((b-a).x,(b-a).z)
			var stripe := box(self,(a+b)*.5+Vector3(0,.085+road_index*.004,0),Vector3(.12,.012,a.distance_to(b)),Color("b2b7a2"))
			stripe.rotation.y = road.rotation.y
			for step in range(1,8):
				var tile:=box(self,a.lerp(b,float(step)/8)+Vector3(0,.16,0),Vector3(1.4,.015,.12),Color("bbc0ac"))
				tile.rotation.y=road.rotation.y
	for wall in data.walls:
		var node := Node3D.new()
		add_child(node)
		node.position = Vector3(float(wall.x),0,float(wall.z))
		var w: float = wall.w
		var d: float = wall.d
		box(node,Vector3(0,1.15,0),Vector3(w,2.3,d),Color("4d6966"))
		box(node,Vector3(0,2.42,0),Vector3(w+.14,.24,d+.14),Color("d4cfb4"))
		for i in range(int(maxf(w,d)/2)):
			var pos := Vector3(-w*.5+1+i*2,1.1,-d*.5-.025) if w>d else Vector3(-w*.5-.025,1.1,-d*.5+1+i*2)
			box(node,pos,Vector3(1.45,1.7,.04) if w>d else Vector3(.04,1.7,1.45),Color("718b7c"))
			# Office cabinets sit within the real wall footprint.
			var top:=Vector3(-w*.5+1+i*2,2.65,0) if w>d else Vector3(0,2.65,-d*.5+1+i*2)
			box(node,top,Vector3(.8,.22,.8),Color("899b8c"))
	for brush in data.brush:
		var patch:=Node3D.new()
		add_child(patch)
		patch.position=Vector3(float(brush.x),0,float(brush.z))
		ring(patch,float(brush.r),Color("3c654c"),float(brush.r))
		var stalks:=int(float(brush.r)*float(brush.r)*1.6)
		for i in range(stalks):
			var a := i*2.39996
			var r := sqrt(float(i)/float(stalks))*float(brush.r)
			box(self,Vector3(float(brush.x)+cos(a)*r,.4,float(brush.z)+sin(a)*r),Vector3(.7,.8+fmod(i*.27,.3),.7),Color("466e59") if i%2==0 else Color("5a8462"))
	for team in range(2):
		var spawn: Dictionary = data.spawn[team]
		var node := Node3D.new()
		add_child(node)
		node.position = Vector3(float(spawn.x),.05,float(spawn.z))
		box(node,Vector3(0,.02,0),Vector3(12,.15,12),Color("426776") if team==0 else Color("856454"))
		ring(node,5.6,BLUE if team==0 else RED,.15)
		for i in range(3):
			box(node,Vector3(-3+i*3,.9,5.3 if team==0 else -5.3),Vector3(1.8,1.8,.65),Color("d0c9b2"))
	for camp in data.camps:
		var node := Node3D.new()
		add_child(node)
		node.position=Vector3(float(camp.x),0,float(camp.z))
		var epic:=str(camp.kind) in ["crab","archive"]
		if epic:
			box(node,Vector3(0,-.065,0),Vector3(21,.03,21),Color("536f73") if str(camp.kind)=="crab" else Color("666475"))
			# Low chevrons mark the open approach, with no invisible collision.
			var sign:=1.0 if float(camp.x)>0 else -1.0
			for i in range(3):
				var arrow:=box(node,Vector3(-2.0+i*2,.10,-10.0*sign),Vector3(.8,.04,2.0),Color("b3bd9a"))
				arrow.rotation.y=PI*.25
		ring(node,5.5 if epic else 2.5,Color("b8ad76"),.12)
		box(node,Vector3(0,-.01,0),Vector3(6,.10,6),Color("607966"))
		for i in range(6):
			var a:=i*TAU/6
			box(node,Vector3(cos(a)*3.1,.13,sin(a)*3.1),Vector3(.6,.26,.6),Color("9eac93"))
	for data_label in data.get("districts",[]):
		var label:=Label3D.new()
		label.text=str(data_label.text)
		label.font=preload("res://fonts/IslandSans.ttf")
		label.font_size=44
		label.pixel_size=.015
		label.position=Vector3(float(data_label.x),.2,float(data_label.z))
		label.rotation_degrees.x=-90
		label.modulate=Color("d5d7b9")
		label.outline_size=4
		add_child(label)
	# Visible boundary and server collision use the same playable extent.
	var boundary:=float(data.get("boundary",size*.5-6))
	for side in [-1.0,1.0]:
		box(self,Vector3(side*(boundary+.5),1,0),Vector3(1,2,boundary*2+2),Color("263e44"))
		box(self,Vector3(0,1,side*(boundary+.5)),Vector3(boundary*2+2,2,1),Color("263e44"))
	Batch.merge_tree(self)
