extends RefCounted
const View = preload("res://moba/map_view.gd")

static func sector(parent: Node3D, radius: float, color: Color) -> void:
	var vertices:=PackedVector3Array()
	for i in range(20):
		var a:=-PI/3+i*(PI*2/3)/20
		var b:=-PI/3+(i+1)*(PI*2/3)/20
		vertices.append_array(PackedVector3Array([Vector3.ZERO,Vector3(sin(a),0,-cos(a))*radius,Vector3(sin(b),0,-cos(b))*radius]))
	var arrays:=[]
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX]=vertices
	var mesh:=ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	var node:=MeshInstance3D.new()
	node.mesh=mesh
	node.material_override=View.material(Color(color,.18),true)
	node.position.y=.28
	parent.add_child(node)
	for side in [-1,1]: View.beam(parent,Vector3(0,.29,0),Vector3(sin(side*PI/3),.0,-cos(side*PI/3))*radius+Vector3(0,.29,0),color,.07)

static func stamp(parent: Node3D, size: float, color: Color) -> void:
	View.box(parent,Vector3(0,.13*size,0),Vector3(size,.26*size,size*.76),Color("713b4d"))
	View.box(parent,Vector3(0,.36*size,0),Vector3(size*.95,.20*size,size*.72),color)
	for side in [-1,1]:
		View.box(parent,Vector3(side*.32,.63,0)*size,Vector3(.14,.36,.20)*size,color)
	View.box(parent,Vector3(0,.86*size,0),Vector3(.8,.12,.20)*size,Color("eee1c3"))

static func projectile(root: Node3D, kind: String, width: float, edge: Color) -> bool:
	if kind in ["arrow","great_arrow"]:
		var size:=1.6 if kind=="great_arrow" else 1.0
		View.box(root,Vector3.ZERO,Vector3(.08,.08,1.25*size),Color("dfd8ab"),true)
		for side in [-1,1]:
			View.beam(root,Vector3(0,0,-.75*size),Vector3(side*width,0,-.2*size),Color("99de64"),.12)
			View.beam(root,Vector3(0,0,.25*size),Vector3(side*.25,0,.6*size),edge,.08)
	elif kind in ["stamp","stamp_bolt"]:
		stamp(root,.55 if kind=="stamp" else .3,Color("ce7599"))
		View.box(root,Vector3(0,-.07,0),Vector3(width*2,.05,width*2),edge,true)
	elif kind=="light_bolt":
		for side in [-1,1]:
			View.box(root,Vector3(side*.22,0,0),Vector3(.06,.08,.6),Color("b8b8ff"),true)
			View.box(root,Vector3(0,0,side*.3),Vector3(.5,.08,.06),edge,true)
	elif kind=="sound":
		for i in range(3):
			var band:=View.box(root,Vector3(0,0,i*.23),Vector3(width*2*(1-i*.22),.12,.08),Color("d7b4ff"),true)
			band.rotation.z=(i-1)*.12
	else: return false
	return true

static func zone(root: Node3D, kind: String, radius: float, edge: Color) -> bool:
	if kind=="tape":
		View.ring(root,radius,edge,.12)
		for i in range(5):
			var x:=(i-2)*radius*.32
			View.box(root,Vector3(x,.24,0),Vector3(.16,.04,sqrt(radius*radius-x*x)*1.7),Color("cfb447"))
	elif kind=="projection":
		View.ring(root,radius,edge,.15)
		# Full damage inside 60% of the radius. Broken inner ring; solid team edge.
		var inner:=radius*.60
		for i in range(12):
			var a:=i*TAU/12
			var b:=a+TAU/18
			var p:=Vector3(cos(a)*inner,.26,sin(a)*inner)
			var q:=Vector3(cos(b)*inner,.26,sin(b)*inner)
			View.beam(root,p,q,Color("cbc7fb"),.12)
		var origin:=Vector3(0,.46,radius*.37)
		View.box(root,origin,Vector3(.82,.50,.76),Color("ebe1c3"))
		View.box(root,origin+Vector3(0,0,-.44),Vector3(.30,.30,.17),Color("cecaff"),true)
		var upper_z:=-radius*.47
		for side in [-1,1]:
			View.beam(root,origin+Vector3(0,0,-.52),Vector3(side*radius*.55,.25,upper_z),Color("a5a2df"),.075)
		View.beam(root,Vector3(-radius*.55,.25,upper_z),Vector3(radius*.55,.25,upper_z),Color("d5d3ff"),.12)
		for i in range(3):
			View.box(root,Vector3(-radius*.14,.25,upper_z+.42+i*.38),Vector3(radius*(.57-i*.09),.07,.12),Color("c9c6f2"),true)
	else: return false
	return true

static func ability(root: Node3D, shape: String, radius: float, color: Color) -> void:
	match shape:
		"stamp_drop":
			stamp(root,1.6,color)
			for i in range(6):
				var a:=i*TAU/6
				View.box(root,Vector3(cos(a)*1.05,.25,sin(a)*1.05),Vector3(.3,.06,.45),Color("f1dcc1"))
		"bind":
			# Two folded sheets wrap this one target.
			for side in [-1,1]:
				var ribbon:=View.box(root,Vector3(0,.55+side*.17,0),Vector3(1.37,.27,.16),Color("b37383"),true)
				ribbon.rotation.y=side*.72
				View.box(ribbon,Vector3(0,.145,0),Vector3(1.25,.04,.14),Color("f2dfc4"),true)
			View.box(root,Vector3(0,.94,0),Vector3(.42,.19,.40),color,true)
		"frame":
			# Corner marks frame the slide; the outer ring is the actual radial limit.
			View.ring(root,radius,color,.10)
			for x in [-1,1]:
				for z in [-1,1]:
					var corner:=Vector3(x*radius*.59,.26,z*radius*.59)
					View.beam(root,corner,corner-Vector3(x*.55,0,0),color,.12)
					View.beam(root,corner,corner-Vector3(0,0,z*.55),color,.12)
		"light":
			View.ring(root,radius,color,.12)
			for i in range(5): View.box(root,Vector3((i-2)*radius*.3,.15,0),Vector3(.15,.15,radius),color,true)
		"wrench":
			View.ring(root,radius,color,.16)
			for i in range(8):
				var a:=i*TAU/8
				var bolt:=View.box(root,Vector3(cos(a)*radius*.8,.6,sin(a)*radius*.8),Vector3(.15,.15,.4),Color("f2d1a5"),true)
				bolt.rotation.y=-a
		"clean":
			sector(root,radius,color)
			for i in range(9):
				var a:=-PI/3+(i+.5)*(PI*2/3)/9
				var shard:=View.box(root,Vector3(sin(a)*radius*.72,.55,-cos(a)*radius*.72),Vector3(.15,.45,.55),color,true)
				shard.rotation.y=-a
		"sound":
			sector(root,radius,color)
			for fraction: float in [.39,.73]:
				var previous:=Vector3(sin(-PI/3),0,-cos(-PI/3))*radius*fraction
				for i in range(1,9):
					var angle:=-PI/3+i*TAU/24
					var current:=Vector3(sin(angle),0,-cos(angle))*radius*fraction
					View.beam(root,previous+Vector3.UP*.39,current+Vector3.UP*.39,color,.14)
					previous=current
		"guard":
			View.box(root,Vector3(0,1,-1),Vector3(1.8,1.6,.08),color,true)
		"rally","haste":
			for i in range(3):
				for side in [-1,1]: View.beam(root,Vector3(side*.5,.3,i*.5),Vector3(0,.3,i*.5-.4),color,.1)
		"overload":
			for side in [-1,1]: View.box(root,Vector3(side*.8,1,0),Vector3(.16,1.6,.16),color,true)

static func sound(hero: String, ultimate: bool) -> String:
	return str(({"stapler":"archive_open","archer":"paper_wave","courier":"impact_weak","mechanic":"motor_start","printer":"stamp","lecturer":"charge_copier","guardian":"break_metal","custodian":"break_partition","barista":"coffee_share","broadcaster":"broadcast"} if ultimate else {"stapler":"paper_throw","archer":"paper_throw","courier":"paper_throw","mechanic":"impact_metal","printer":"stamp","lecturer":"paper_wave","guardian":"impact_armor","custodian":"impact_partition","barista":"coffee_share","broadcaster":"broadcast"}).get(hero,"impact_hard"))
