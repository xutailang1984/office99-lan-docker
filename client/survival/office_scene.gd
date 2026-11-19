extends RefCounted

# Pure decoration only. Caller retains authority IDs, collision, labels, visibility
# groups, gate panel translations and all game logic.
const Assets=preload("res://survival/office_assets.gd")
const Tools=preload("res://survival/office_tools.gd")
const Batch=preload("res://survival/static_mesh_batch.gd")
const Library=preload("res://survival/visual_library.gd")
const DARK:=Color("344c5d")
const PALE:=Color("eee8d5")
const MINT:=Color("78bbb2")
const GOLD:=Color("ecc15d")

static func building_visual(group: Node3D, kind: String, damaged: bool) -> void:
	var cache_key := "building:"+kind+":"+str(damaged)
	if Library.reuse(cache_key,group): return
	var cabinet:=Color("958f80") if damaged else MINT
	if kind=="core":
		# A sealed lantern housing visibly covers the existing 3 m collision cube.
		# The four lit faces remain readable from every approach, including at night.
		# The caller already draws the 0.11 m foundation; meet it without coplanar sides.
		Tools.box(group,Vector3(0,0.305,0),Vector3(3,0.39,3),DARK)
		Tools.box(group,Vector3(0,1.60,0),Vector3(3,2.20,3),cabinet)
		Tools.box(group,Vector3(0,2.85,0),Vector3(3.02,0.30,3.02),DARK)
		Tools.box(group,Vector3(0,3.06,0),Vector3(0.68,0.12,0.68),GOLD)
		var light_color := Color("a57c60") if damaged else Color("efda9f")
		for side in [-1.0,1.0]:
			for axis in range(2):
				var face := Node3D.new()
				group.add_child(face)
				face.rotation.y=PI*0.5*axis
				Tools.box(face,Vector3(0,1.83,side*1.503),Vector3(2.48,1.20,0.012),light_color,true)
				Tools.box(face,Vector3(0,1.19,side*1.514),Vector3(2.57,0.08,0.03),DARK)
				Tools.box(face,Vector3(0,2.47,side*1.514),Vector3(2.57,0.08,0.03),DARK)
				for y in [0.66,0.83]:
					Tools.box(face,Vector3(0,y,side*1.508),Vector3(1.78,0.065,0.018),DARK)
				# Joining bars act as a simple teamwork emblem, without text or decals.
				for x in [-0.24,0.24]:
					Tools.box(face,Vector3(x,1.83,side*1.517),Vector3(0.18,0.38,0.015),cabinet)
				Tools.box(face,Vector3(0,1.83,side*1.517),Vector3(0.34,0.10,0.016),cabinet)
				if damaged:
					var break_line:=Tools.box(face,Vector3(0.59,1.88,side*1.518),Vector3(0.05,0.82,0.018),DARK)
					break_line.rotation.z=side*0.34
		# Bake only rigid display faces before batching; the gate joints below stay live.
		for face in group.get_children():
			if face is MeshInstance3D: continue
			for detail in face.get_children():
				var baked_transform: Transform3D=face.transform*detail.transform
				face.remove_child(detail)
				group.add_child(detail)
				detail.transform=baked_transform
			face.free()
	elif kind=="gate":
		for side in [-1.0,1.0]:
			Tools.box(group,Vector3(side*1.35,1.25,0),Vector3(0.3,2.5,0.4),DARK)
			var panel:=Node3D.new()
			panel.name="Left" if side<0 else "Right"
			group.add_child(panel)
			panel.position.x=side*0.60
			# Sliding panels retract inside the thicker cabinet wall; their faces
			# must not coincide with the adjacent wall when fully open.
			Tools.box(panel,Vector3(0,1.2,0),Vector3(1.2,2.3,0.28),cabinet)
			Tools.box(panel,Vector3(0,1.7,-0.157),Vector3(0.88,0.72,0.016),Color("becbc7") if damaged else Color("d2e3dc"))
			Tools.box(panel,Vector3(-side*0.40,1.06,-0.185),Vector3(0.07,0.34,0.06),DARK)
			Tools.box(panel,Vector3(0,1.62,-0.17),Vector3(0.82,0.065,0.02),PALE)
			Tools.box(panel,Vector3(0,0.40,-0.164),Vector3(1.12,0.17,0.016),DARK)
	else:
		Tools.box(group,Vector3(0,1.25,0),Vector3(3,2.5,0.3),DARK)
		for x in [-1.0,0.0,1.0]:
			for row in range(3):
				var y:=0.45+row*0.79
				var front:=Vector3(x,y,-0.16)
				Tools.box(group,front,Vector3(0.93,0.71,0.055),cabinet.darkened(0.08*row))
				Tools.box(group,front+Vector3(0,0.07,-0.04),Vector3(0.36,0.09,0.035),DARK)
				Tools.box(group,front+Vector3(0,0.21,-0.036),Vector3(0.31,0.085,0.015),PALE)
				if damaged and row==1:
					var paper:=Tools.box(group,front+Vector3(0.25,-0.14,-0.06),Vector3(0.27,0.29,0.014),PALE)
					paper.rotation.z=0.23
	if kind in ["wall","gate"]: _back_faces(group)
	Batch.merge_tree(group)
	Library.remember(cache_key,group)

static func terminal_visual(parent: Node3D, id: String) -> void:
	if id in ["craft","emergency_craft"]:
		if Library.reuse("station:craft",parent): return
		# Closed cabinet matches the station's solid 1.65 x 1.1 x 1.0 body.
		# No invisible table-leg gap or coplanar decorative faces.
		Tools.box(parent,Vector3(0,0.51,0),Vector3(1.62,1.02,0.98),Color("47627f"))
		Tools.box(parent,Vector3(0,1.06,0),Vector3(1.65,0.08,1.0),Color("adc5d2"))
		for side in [-1.0,1.0]:
			Tools.box(parent,Vector3(side*0.41,0.58,-0.498),Vector3(0.72,0.65,0.016),Color("637cac"))
			Tools.box(parent,Vector3(side*0.22,0.62,-0.519),Vector3(0.15,0.055,0.026),GOLD)
		Tools.box(parent,Vector3(0,1.111,0),Vector3(0.92,0.014,0.62),DARK)
		Tools.box(parent,Vector3(-0.24,1.14,-0.06),Vector3(0.28,0.044,0.15),GOLD)
		Tools.box(parent,Vector3(0.20,1.16,0.10),Vector3(0.19,0.084,0.23),MINT)
		Batch.merge_tree(parent)
		Library.remember("station:craft",parent)
		return
	var key := "station_supply"
	if id in ["warehouse","storage","emergency_storage"]: key="station_storage"
	elif id in ["upgrade","emergency_upgrade"]: key="station_upgrade"
	elif id in ["recycle","emergency_recycle"]: key="station_recycle"
	Assets.attach(parent,key)

static func search_visual(parent: Node3D, kind: String) -> void:
	if Library.reuse("search:"+kind,parent): return
	if kind=="scrap":
		for i in range(5):
			var chip:=Tools.box(parent,Vector3(-0.25+i*0.13,0.08+0.06*(i%2),0.08*(i%3)),Vector3(0.20,0.12,0.20),PALE if i%2 else DARK)
			chip.rotation.y=i*0.8
		Tools.clip(parent,Vector3(0,0.22,0),1.0,GOLD)
	else:
		# Fits the existing search visual; never adds collision to searchable nodes.
		Tools.box(parent,Vector3(0,0.58,0),Vector3(1.4,0.09,0.70),PALE)
		for x in [-0.53,0.53]: Tools.box(parent,Vector3(x,0.28,0),Vector3(0.12,0.53,0.56),DARK)
		Tools.box(parent,Vector3(0,0.84,0.13),Vector3(0.65,0.42,0.08),DARK)
		for z in [0.082,0.178]: Tools.box(parent,Vector3(0,0.84,z),Vector3(0.55,0.31,0.018),MINT.darkened(0.35))
		Tools.box(parent,Vector3(0,0.635,-0.15),Vector3(0.48,0.025,0.16),DARK)
		Tools.box(parent,Vector3(-0.43,0.64,-0.16),Vector3(0.25,0.022,0.25),GOLD)
	Batch.merge_tree(parent)
	Library.remember("search:"+kind,parent)

static func backpack_visual(parent: Node3D) -> void:
	if Library.reuse("backpack",parent): return
	Tools.box(parent,Vector3(0,0.24,0),Vector3(0.48,0.47,0.31),DARK)
	Tools.box(parent,Vector3(0,0.17,-0.18),Vector3(0.34,0.25,0.09),MINT)
	Tools.box(parent,Vector3(0,0.26,-0.235),Vector3(0.17,0.07,0.016),PALE)
	for x in [-0.12,0.12]: Tools.box(parent,Vector3(x,0.49,0),Vector3(0.05,0.12,0.06),GOLD)
	Batch.merge_tree(parent)
	Library.remember("backpack",parent)

static func _back_faces(parent: Node3D) -> void:
	# Players can approach either side of the unchanged thin barricade/counter.
	for child in parent.get_children():
		if child is MeshInstance3D and child.position.z < -0.15:
			var opposite:MeshInstance3D=child.duplicate()
			parent.add_child(opposite)
			opposite.position.z=-child.position.z
		elif child is Node3D and not child is MeshInstance3D:
			_back_faces(child)
