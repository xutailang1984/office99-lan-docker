extends MeshInstance3D

# The warning is a flat planning aid. This is a short, three-dimensional strike
# AFTER authoritative resolution, never another collider or a damage timer.
const MAX_ACTIVE := 12
const LIFETIME := 0.62
var age := 0.0
var profile := "slam"
var vertices := PackedVector3Array()
var colors := PackedColorArray()
var motion := PackedVector2Array()
var tint := Color("ffb566")
var vertex_count := 0
var lifetime := LIFETIME
var travel := false
var travel_shape := ""
var travel_length := 0.0
var travel_inner := 0.0
var travel_outer := 0.0
var active_seconds := 0.1
var origin := Vector3.ZERO
var direction := Vector3.FORWARD
static var shader: Shader

static func _shader() -> Shader:
	if shader == null:
		shader = Shader.new()
		shader.code = """shader_type spatial;
render_mode unshaded, cull_disabled, shadows_disabled;
uniform float progress = 0.0;
uniform float radial_offset = 0.0;
void vertex(){
  if (abs(radial_offset)>0.001 && length(VERTEX.xz)>0.01) VERTEX.xz += normalize(VERTEX.xz)*radial_offset;
  float beat = clamp(progress * 1.8 - UV.x * 0.48, 0.0, 1.0);
  VERTEX.y += UV.y * (sin(beat * 3.14159) * 0.75);
}
void fragment(){
  ALBEDO = COLOR.rgb;
  ALPHA = COLOR.a * (1.0 - smoothstep(0.48, 1.0, progress));
}
"""
	return shader

func _v(data: Dictionary) -> Vector3:
	return Vector3(float(data.get("x",0)),float(data.get("y",0)),float(data.get("z",0)))

func _tri(a: Vector3,b: Vector3,c: Vector3,color: Color,travel := 0.0,lift := 0.0) -> void:
	for point in [a,b,c]:
		vertices.append(point)
		colors.append(color)
		motion.append(Vector2(travel,lift))

func _quad(a: Vector3,b: Vector3,c: Vector3,d: Vector3,color: Color,travel := 0.0,lift := 0.0) -> void:
	_tri(a,b,c,color,travel,lift)
	_tri(a,c,d,color,travel,lift)

func _box(at: Vector3,size_value: Vector3,color: Color,travel := 0.0,lift := 0.0) -> void:
	var h := size_value*.5
	var p: Array[Vector3] = []
	for y in [-1,1]:
		for z in [-1,1]:
			for x in [-1,1]: p.append(at+Vector3(x*h.x,y*h.y,z*h.z))
	for face in [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]:
		_quad(p[face[0]],p[face[1]],p[face[2]],p[face[3]],color,travel,lift)

func _arc(center: Vector3,inner: float,outer: float,half_angle: float,height: float,color: Color,segments := 24) -> void:
	for i in range(segments):
		var a := -half_angle+2*half_angle*float(i)/segments
		var b := -half_angle+2*half_angle*float(i+1)/segments
		var u := Vector3(sin(a),0,-cos(a))
		var v := Vector3(sin(b),0,-cos(b))
		_quad(center+u*inner,center+u*outer,center+v*outer,center+v*inner,color,float(i)/segments,.15)
		_quad(center+u*outer,center+u*outer+Vector3.UP*height,center+v*outer+Vector3.UP*height,center+v*outer,color.lightened(.20),float(i)/segments,.2)

func setup(payload: Dictionary) -> void:
	var zone: Dictionary = payload.zone if payload.get("zone") is Dictionary else {}
	var kind := str(payload.get("attackKind","melee"))
	var definition := str(payload.get("definitionId",""))
	var shape := str(zone.get("shape","cone"))
	position = _v(zone if zone.has("x") else payload.get("position",{}))+Vector3.UP*.10
	rotation.y = float(zone.get("yaw",0))
	origin=position
	direction=Vector3(-sin(rotation.y),0,-cos(rotation.y))
	travel=bool(zone.get("travel",false))
	travel_shape=shape
	active_seconds=maxf(.05,float(zone.get("duration",.12)))
	lifetime=maxf(LIFETIME,active_seconds+.14) if travel else LIFETIME
	travel_length=float(zone.get("length",0))
	travel_inner=float(zone.get("innerRadius",0))
	travel_outer=float(zone.get("radius",1))
	var radius := clampf(float(zone.get("radius",1.6)),.25,14)
	var ranged := kind in ["projectile","slow_bolt","paper_bolt","archive_spread","power_burst"]
	profile = "bolt" if ranged else "stamp" if shape=="marks" else "paper" if kind in ["printer_wave","paper_lob"] else "coffee" if kind.begins_with("coffee") else "electric" if kind in ["overload_ring","pulse"] else "dash" if kind in ["dash","charge","shredder_advance","printer_shift"] else "heal" if kind in ["heal","rally"] else "shredder" if kind=="shredder_fan" else "claw" if kind in ["melee","breach","erase","eat_cell","fish","claw_left","claw_right","audit_cone"] else "slam"
	tint = Color("80e7ff") if profile in ["electric","bolt"] else Color("9cf0b8") if profile=="heal" else Color("e9dfbf") if profile=="paper" else Color("d99660") if profile=="coffee" else Color("e49fff") if profile=="stamp" else Color("ffb566")
	if definition=="ink_cuttle": tint=Color("ad94de")
	if definition=="shield_bug" and kind=="melee": profile="shield"
	elif definition=="breaker" and kind=="breach": profile="drill"
	elif kind=="puddle": profile="puddle"
	elif kind=="erase": profile="erase"
	if ranged:
		# Projectile travel has its own authoritative renderer; only muzzle flash here.
		_box(Vector3(0,.65,-.65),Vector3(.4,.4,.7),tint,0,.15)
		for i in range(4): _box(Vector3((i%2-.5)*.7,.6+floorf(i/2.0)*.3,-.85),Vector3(.1,.1,.35),Color("fff0c7"),0,.4)
	elif profile=="shield":
		_box(Vector3(0,.7,-radius*.72),Vector3(1.25,.75,.16),Color("70b8c7"),0,.1)
		_box(Vector3(0,.7,-radius*.72-.1),Vector3(.42,.3,.09),Color("e4ddd0"))
		for i in range(6): _box(Vector3((i%3-1)*.48,.3+floorf(i/3.0)*.8,-radius*.82),Vector3(.10,.18,.18),Color("d2e9e5"),0,.55)
	elif profile=="drill":
		for i in range(6):
			var a := i*TAU/6
			_box(Vector3(sin(a)*.36,.55+cos(a)*.36,-radius*.78),Vector3(.20,.20,.45),Color("bec9c0"),float(i)/6,.15)
		for i in range(8): _box(Vector3((i%4-1.5)*.27,.15,-radius*(.4+float(i%3)*.18)),Vector3(.19,.18,.25),Color("ba9371"),float(i)/8,.8)
	elif profile=="puddle":
		for i in range(9):
			var a := i*TAU/9
			_box(Vector3(sin(a)*radius*.65,.14,-cos(a)*radius*.65),Vector3(.38,.22,.38),Color("9877b4"),float(i)/9,.5)
		_box(Vector3(0,.28,0),Vector3(radius*.9,.45,radius*.9),Color("6f5388"),0,.3)
	elif profile=="erase":
		for i in range(9): _box(Vector3((i-4)*radius*.18,.4+float(i%2)*.2,-radius*.7),Vector3(.20,.14,.38),Color("eed8dc") if i%2 else Color("ca8d9d"),float(i)/9,.45)
	elif profile=="heal":
		for i in range(5):
			var a := i*TAU/5
			var at := Vector3(sin(a)*radius*.45,.3,-cos(a)*radius*.45)
			_box(at,Vector3(.12,.48,.12),Color("94d5bc"),float(i)/5,.9)
			_box(at,Vector3(.36,.12,.12),Color("94d5bc"),float(i)/5,.9)
	elif kind=="coffee_boil":
		for i in range(9):
			var a := i*TAU/9
			var at := Vector3(sin(a)*radius*.7,.26,-cos(a)*radius*.7)
			_box(at,Vector3(.28,.55,.28),Color("aa653b"),0,.35)
			_box(at+Vector3.UP*.55,Vector3(.34,.32,.34),Color("e7d3aa"),float(i)/9,1.2)
	elif travel and shape=="line":
		var width := clampf(float(zone.get("width",2)),.2,5)
		if profile=="paper":
			# A folded, upright sheet moves with the server's damage front.
			for i in range(8):
				var x := -width*.5+width*float(i)/8
				var h := .55+(.45 if i%2==0 else 0.0)
				_quad(Vector3(x,.12,0),Vector3(x+width/8,.12,0),Vector3(x+width/8,h,.18),Vector3(x,h+.16,-.18),Color("f1e9c9"))
				_box(Vector3(x+.1,h*.65,-.03),Vector3(.12,.025,.08),Color("547b86"))
		else:
			# Brown liquid below and light steam above, with gaps to preserve aim visibility.
			for i in range(9):
				var x := (float(i)/8-.5)*width
				_box(Vector3(x,.2+float(i%3)*.14,0),Vector3(.24,.28,.65),Color("99532e"),0,.3)
				_box(Vector3(x,.9+float(i%2)*.3,.12),Vector3(.22,.18,.25),Color("dfd5b6"),0,.5)
	elif travel and shape=="ring":
		if profile=="electric":
			for band in range(3):
				_arc(Vector3(0,.12+band*.18,0),.82,1.18,PI,.07,Color("9df2ff") if band%2 else Color("5699e6"),32)
		else:
			_arc(Vector3.ZERO,.80,1.20,PI,.27,Color("9b562e"),28)
			for i in range(14):
				var a := i*TAU/14
				_box(Vector3(sin(a),.48,-cos(a)),Vector3(.14,.30,.14),Color("ead1a1"),0,.2)
	elif profile=="dash":
		# The moving body is the attack. A short kick-up replaces the old floor ladder.
		for i in range(10):
			var side: float=-1.0 if i%2==0 else 1.0
			var debris_color := Color("adb8b4") if definition=="boss_shredder" else Color("dfd7b8") if definition=="boss_printer" else Color("a9926a")
			_box(Vector3(side*(.6+float(i%3)*.18),.12,float(i/2)*.18),Vector3(.16,.12,.24),debris_color,float(i)/10,.55)
	elif shape=="marks":
		# Each mark is in world coordinates; do not rotate it a second time.
		rotation.y=0
		var points: Array=zone.get("points",[payload.get("position",{})])
		for point in points.slice(0,3):
			var center := _v(point)-position+Vector3.UP*.10
			_box(center+Vector3.UP*.16,Vector3(radius*1.44,.30,radius*1.44),Color("a94143"),0,.8)
			_box(center+Vector3.UP*.52,Vector3(.30,.65,.30),Color("37474d"),0,.8)
			for i in range(3):
				_box(center+Vector3(0,.015,(i-1)*radius*.3),Vector3(radius*.9,.02,.08),Color("70282e"))
			for i in range(6):
				var angle := i*TAU/6
				_box(center+Vector3(sin(angle)*radius*.7,.4,-cos(angle)*radius*.7),Vector3(.20,.22,.18),tint,float(i)/6,1.1)
	elif shape=="line":
		var length := clampf(float(zone.get("length",4)),.5,16)
		var width := clampf(float(zone.get("width",1.6)),.2,5)
		for i in range(9):
			var step := float(i+1)/9
			var height := .22 if profile=="dash" else .45
			_box(Vector3(0,.10,-length*step),Vector3(width,height,.25 if profile=="dash" else .45),tint,step,.55)
			if i%2==0: _box(Vector3(width*.3,.35,-length*step),Vector3(.20,.18,.32),Color("fff1d6"),step,.75)
	elif shape=="ring":
		var inner := clampf(float(zone.get("innerRadius",radius*.4)),.1,radius-.05)
		_arc(Vector3.ZERO,inner,minf(inner+.24,radius),PI,.3,tint,28)
		_arc(Vector3.ZERO,maxf(inner,radius-.3),radius,PI,.55,tint,28)
		for i in range(12):
			var angle := i*TAU/12
			var at := Vector3(sin(angle),0,-cos(angle))*(inner+radius)*.5
			_box(at+Vector3.UP*.32,Vector3(.15,.6,.15),Color("e6fbff") if profile=="electric" else tint,float(i%3)/3,.3)
	elif shape=="cone":
		var half_angle := clampf(float(zone.get("halfAngle",1.05)),.15,PI)
		if profile=="shredder":
			_arc(Vector3(0,.35,0),radius*.72,radius,half_angle,.10,Color("a6bdc0"),18)
			for i in range(12):
				var a := -half_angle+float(i)/11*half_angle*2
				_box(Vector3(sin(a)*radius*.92,.45,-cos(a)*radius*.92),Vector3(.16,.3,.22),Color("e7e4cc"),float(i)/12,.65)
		else:
			for slash in range(3):
				_arc(Vector3(0,.30+slash*.21,0),radius*(.82-slash*.1),radius*(.88-slash*.1),half_angle,.07,Color("f4dba7") if slash==1 else tint,18)
		for i in range(5):
			var angle := (i-2)*half_angle*.4
			_box(Vector3(sin(angle)*radius*.8,.4,-cos(angle)*radius*.8),Vector3(.12,.12,.2),tint,float(i)/5,.55)
	else:
		_arc(Vector3.ZERO,radius*.74,radius,PI,.40,tint,28)
		for i in range(12):
			var angle := i*TAU/12
			var at := Vector3(sin(angle)*radius*.6,.20,-cos(angle)*radius*.6)
			_box(at,Vector3(.20,.22,.20),tint,float(i%3)/3,.9)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX]=vertices
	arrays[Mesh.ARRAY_COLOR]=colors
	arrays[Mesh.ARRAY_TEX_UV]=motion
	var geometry := ArrayMesh.new()
	geometry.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	mesh=geometry
	if travel and shape=="ring":
		var extent := travel_outer+.6
		custom_aabb=AABB(Vector3(-extent,-.1,-extent),Vector3(extent*2,2.2,extent*2))
	else:
		custom_aabb=geometry.get_aabb().grow(1.1)
	vertex_count=vertices.size()
	var mat:=ShaderMaterial.new()
	mat.shader=_shader()
	material_override=mat
	cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	vertices.clear()
	colors.clear()
	motion.clear()

func advance(delta: float) -> bool:
	age+=delta
	var p := clampf(age/active_seconds,0,1)
	if travel:
		if travel_shape=="line": position=origin+direction*travel_length*p
		elif travel_shape=="ring": material_override.set_shader_parameter("radial_offset",lerpf(travel_inner,travel_outer,p)-1.0)
	var fade_progress := lerpf(0,.45,p) if travel and age<active_seconds else lerpf(.45,1,clampf((age-active_seconds)/maxf(.01,lifetime-active_seconds),0,1)) if travel else clampf(age/lifetime,0,1)
	material_override.set_shader_parameter("progress",fade_progress)
	return age<lifetime
