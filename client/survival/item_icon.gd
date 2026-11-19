extends Control

var kind := "scrap"
var tint := Color("a5c6bd")
const OfficeTheme = preload("res://survival/office_theme.gd")
const DARK := Color("284858")
const GOLD := Color("e7b84e")
const PALE := Color("fff0d3")
const RED := Color("e56950")
const BLUE := Color("4db5bc")
const TOOL_ICONS := {
	"bandage": preload("res://survival/icons/bandage.png"),
	"repair_kit": preload("res://survival/icons/repair_kit.png"),
	"coffee_flask": preload("res://survival/icons/coffee_flask.png"),
	"flash_note": preload("res://survival/icons/flash_note.png"),
	"decoy_alarm": preload("res://survival/icons/decoy_alarm.png")
}
const TOOL_COLORS := {"bandage":Color("ffbba5"),"repair_kit":Color("92d7ec"),"coffee_flask":Color("eab577"),"flash_note":Color("efeaa1"),"decoy_alarm":Color("bdb8f3")}

func _ready() -> void:
	mouse_filter=Control.MOUSE_FILTER_IGNORE
	custom_minimum_size=Vector2(42,38)
	resized.connect(queue_redraw)

func _block(x: float,y: float,w: float,h: float,color: Color) -> void:
	draw_rect(Rect2(x,y,w,h),color)

func _poly(points: Array,color: Color) -> void:
	var vertices:=PackedVector2Array()
	for point in points: vertices.append(Vector2(point[0],point[1]))
	draw_colored_polygon(vertices,color)

func _clip(at: Vector2,scale_value:=1.0,color:=PALE) -> void:
	var points:=PackedVector2Array()
	for p in [Vector2(-4,-6),Vector2(-4,7),Vector2(4,7),Vector2(4,-9),Vector2(-7,-9),Vector2(-7,11),Vector2(7,11),Vector2(7,-5)]: points.append(at+p*scale_value)
	draw_polyline(points,color,2.4*scale_value,true)

func _draw() -> void:
	var factor:=minf(size.x,size.y)/48.0
	draw_set_transform(size/2,0,Vector2.ONE*factor)
	var id:=str({"weapon":"carbine","melee":"knife","rod":"rod_basic","ammo":"ammo_light","consumable":"bandage","catch":"catch_silver","silverfish":"catch_silver","crab":"catch_crab","eel":"catch_eel","storage":"crate","team":"player","turret":"staple_tower","boss_trophy":"trophy"}.get(kind,kind))
	if TOOL_ICONS.has(id):
		draw_texture_rect(TOOL_ICONS[id],Rect2(-23,-23,46,46),false,TOOL_COLORS[id])
		return
	match id:
		"folding_cover":
			_block(-20,-18,40,36,BLUE)
			_block(-2,-18,4,36,DARK)
			_block(-14,-12,10,4,PALE)
			_block(4,-12,10,4,PALE)
		"tape_trap":
			draw_arc(Vector2.ZERO,17,0,TAU,20,GOLD,8,true)
			_block(0,9,23,8,GOLD)
		"scan_note":
			_block(-17,-20,34,40,Color("a782c2"))
			for side in [-1,1]:
				_block(side*11-2,-12,4,24,PALE)
				_block(-12,side*11-2,24,4,PALE)
		"spring_parts":
			draw_polyline(PackedVector2Array([Vector2(-15,17),Vector2(12,13),Vector2(-12,6),Vector2(12,0),Vector2(-12,-7),Vector2(12,-13),Vector2(-10,-19)]),PALE,5,true)
			_block(-19,15,12,6,BLUE)
			_block(5,-21,14,6,BLUE)
		"sealed_cell":
			_block(-6,-22,12,5,GOLD)
			_block(-14,-17,28,36,BLUE)
			_block(-10,-12,20,5,PALE)
			_poly([[2,-7],[-7,5],[-1,5],[-4,15],[8,1],[2,1]],GOLD)
		"coffee_coupon":
			_block(-22,-14,44,28,Color("ba885d"))
			_block(-18,-10,36,20,PALE)
			_block(-10,-6,16,12,DARK)
			draw_arc(Vector2(6,-1),5,-PI/2,PI/2,12,DARK,3,true)
			_block(-12,8,23,2,DARK)
			for y in [-9,-1,7]: _block(15,y,2,3,GOLD)
		"team_medal":
			_poly([[-14,-22],[-2,-22],[3,0],[-9,0]],RED)
			_poly([[2,-22],[14,-22],[9,0],[-3,0]],BLUE)
			draw_circle(Vector2(0,5),15,GOLD)
			draw_arc(Vector2(0,5),11,0,TAU,24,PALE,2,true)
			_poly([[-8,5],[0,-2],[8,5],[0,12]],DARK)
		"boots":
			_poly([[-18,-17],[-6,-17],[-6,5],[1,10],[1,17],[-20,17]],tint)
			_poly([[1,-21],[13,-21],[13,1],[21,6],[21,13],[0,13]],PALE)
			_block(-20,15,21,5,DARK)
			_block(0,11,21,5,DARK)
			for y in [-10,-3]:
				_block(-15,y,8,2,GOLD)
				_block(4,y-4,8,2,GOLD)
		"backpack":
			draw_rect(Rect2(-7,-21,14,10),GOLD,false,3)
			_block(-18,-14,36,33,tint)
			_block(-14,-9,28,7,PALE)
			_block(-12,2,24,13,DARK)
			_block(-10,4,20,3,GOLD)
			_block(-23,-6,5,21,DARK)
			_block(18,-6,5,21,DARK)
		"fist","quick":
			_block(-13,-8,26,25,PALE)
			_block(-19,-2,9,14,PALE)
			_block(-12,15,24,8,DARK)
			for x in [-8,0,8]: _block(x,-7,2,8,GOLD)
		"carbine":
			_block(-20,7,40,6,DARK)
			_block(-20,-4,9,16,RED)
			_poly([[-20,-8],[15,-13],[21,-8],[21,4],[15,4],[13,-3],[-20,-1]],RED)
			_block(-12,-7,20,3,PALE)
			_block(11,6,9,3,PALE)
			_block(-15,0,4,4,GOLD)
		"shotgun":
			_block(-18,-8,30,16,BLUE)
			_block(11,-12,10,24,BLUE)
			_block(18,-7,4,14,DARK)
			_block(-13,8,7,12,BLUE)
			_block(-11,-15,17,9,PALE)
			_clip(Vector2(-2,0),0.57,DARK)
		"rifle":
			_poly([[-22,-4],[11,-4],[22,0],[11,4],[-22,4]],GOLD)
			_block(-22,-6,7,12,DARK)
			_poly([[12,-3],[22,0],[12,3]],PALE)
			_block(-7,-13,17,6,DARK)
			_block(-3,-7,3,4,BLUE)
			_block(-13,-3,12,2,BLUE)
		"pistol":
			_poly([[-19,-11],[17,-11],[20,-6],[20,1],[-2,1],[-6,18],[-17,18],[-12,-1],[-19,-1]],OfficeTheme.EQUIPMENT_COLORS[id])
			_block(-15,-8,27,3,PALE)
			_block(14,-8,7,6,DARK)
			draw_rect(Rect2(-4,1,12,7),DARK,false,2)
		"smg":
			_block(-19,-9,30,13,OfficeTheme.EQUIPMENT_COLORS[id])
			_block(11,-6,11,7,DARK)
			_poly([[-5,4],[3,4],[5,20],[-2,20]],PALE)
			_block(-16,3,6,12,DARK)
			_block(-10,-15,14,4,GOLD)
			for x in [-6,0,6]: _block(x,-6,2,7,DARK)
		"lmg":
			_block(-22,-9,28,15,OfficeTheme.EQUIPMENT_COLORS[id])
			_block(6,-6,17,8,DARK)
			_block(-13,6,19,14,DARK)
			_block(-10,9,13,7,PALE)
			draw_polyline(PackedVector2Array([Vector2(-12,-10),Vector2(-9,-17),Vector2(2,-17),Vector2(5,-10)]),PALE,3,true)
			draw_line(Vector2(15,2),Vector2(10,15),DARK,3,true)
		"rod_light":
			draw_line(Vector2(-17,19),Vector2(7,-17),PALE,2.5,true)
			draw_line(Vector2(7,-17),Vector2(17,4),PALE,1,true)
			draw_arc(Vector2(14,4),3,0,PI,10,BLUE,2,true)
			_block(-19,12,6,10,BLUE)
			draw_circle(Vector2(-9,8),3,GOLD)
		"rod_heavy":
			draw_line(Vector2(-15,18),Vector2(9,-20),GOLD,5,true)
			draw_line(Vector2(9,-20),Vector2(19,9),PALE,2,true)
			draw_arc(Vector2(15,9),4,0,PI,12,RED,3,true)
			_block(-20,10,9,12,DARK)
			draw_circle(Vector2(-4,7),7,PALE)
			draw_circle(Vector2(-4,7),3,DARK)
		"rod_magnet":
			draw_line(Vector2(-18,19),Vector2(5,-20),BLUE,3,true)
			draw_line(Vector2(5,-20),Vector2(14,0),PALE,1.5,true)
			draw_polyline(PackedVector2Array([Vector2(7,2),Vector2(7,14),Vector2(21,14),Vector2(21,2)]),RED,5,true)
			_block(4,0,6,5,PALE)
			_block(18,0,6,5,PALE)
			_block(-20,12,6,10,DARK)
			draw_circle(Vector2(-10,6),4,GOLD)
		"doublebarrel":
			var tint: Color = OfficeTheme.EQUIPMENT_COLORS[id]
			_block(-20,0,12,10,tint)
			_block(-10,-9,31,5,PALE)
			_block(-10,-1,31,5,PALE)
			_block(-13,-6,10,14,tint)
			_block(-9,7,5,12,DARK)
			_clip(Vector2(-1,1),.42,GOLD)
		"dmr":
			_block(-20,-6,29,12,OfficeTheme.EQUIPMENT_COLORS[id])
			_block(9,-3,15,5,DARK)
			_block(-13,5,6,12,DARK)
			_block(-4,6,7,12,BLUE)
			draw_rect(Rect2(-5,-14,16,6),DARK,false,2)
			_block(-18,-3,4,6,BLUE)
		"rod_net":
			draw_line(Vector2(-15,21),Vector2(0,0),DARK,5,true)
			draw_rect(Rect2(-14,-21,33,24),OfficeTheme.EQUIPMENT_COLORS[id],false,3)
			for x in [-8,-1,6,13]: draw_line(Vector2(x,-19),Vector2(x,1),PALE,1,true)
			for y in [-14,-7,0]: draw_line(Vector2(-12,y),Vector2(17,y),PALE,1,true)
		"field_core":
			for angle in range(0,360,60):
				var point := Vector2.from_angle(deg_to_rad(float(angle)))*16
				draw_rect(Rect2(point-Vector2(4,4),Vector2(8,8)),BLUE)
			draw_circle(Vector2.ZERO,17,BLUE)
			draw_circle(Vector2.ZERO,11,DARK)
			draw_circle(Vector2.ZERO,6,PALE)
		"hazard_core":
			_poly([[0,-23],[19,-11],[19,11],[0,23],[-19,11],[-19,-11]],GOLD)
			_poly([[0,-16],[12,-8],[12,8],[0,16],[-12,8],[-12,-8]],DARK)
			_poly([[2,-12],[-7,2],[0,2],[-2,12],[8,-3],[2,-3]],RED)
		"trigger_unit":
			_block(-17,-13,30,20,PALE)
			draw_rect(Rect2(-9,-5,25,22),GOLD,false,4)
			_block(-14,-9,9,7,RED)
		"barrel_unit":
			for y in [-10,5]:
				_block(-21,y,37,7,BLUE)
				draw_circle(Vector2(17,y+3),6,PALE)
				draw_circle(Vector2(17,y+3),3,DARK)
		"optic_unit":
			draw_circle(Vector2.ZERO,19,BLUE)
			draw_circle(Vector2.ZERO,13,DARK)
			draw_circle(Vector2(4,-4),7,PALE)
			_block(-18,14,36,5,GOLD)
		"spool_unit":
			draw_circle(Vector2(-2,0),18,GOLD)
			for radius in [6,10,14]: draw_arc(Vector2(-2,0),radius,0,TAU,24,DARK,2,true)
			draw_line(Vector2(15,0),Vector2(23,15),PALE,2,true)
		"float_unit":
			_block(-3,-23,6,46,DARK)
			_block(-10,-7,20,17,RED)
			_block(-8,-15,16,8,PALE)
			_block(-6,11,12,5,GOLD)
		"seal_unit":
			draw_rect(Rect2(-19,-15,38,32),BLUE,false,5)
			_block(-10,-9,20,20,DARK)
			_poly([[0,-6],[-6,3],[0,10],[6,3]],PALE)
		"rod_basic","rod_pro":
			draw_line(Vector2(-16,17),Vector2(12,-19),OfficeTheme.EQUIPMENT_COLORS[id],3,true)
			draw_line(Vector2(12,-19),Vector2(16,8),PALE,1,true)
			draw_arc(Vector2(12,8),4,0,PI,12,GOLD,2,true)
			_block(-17,9,7,11,Color("b98157"))
			draw_circle(Vector2(-8,7),5,GOLD if id=="rod_pro" else PALE)
			draw_circle(Vector2(-8,7),2,DARK)
		"knife":
			_poly([[-17,15],[-10,21],[6,0],[-1,-6]],GOLD)
			_poly([[-1,-6],[6,0],[19,-17],[16,-23],[11,-21]],PALE)
			draw_line(Vector2(-10,11),Vector2(0,-2),DARK,4)
			for i in range(3): draw_line(Vector2(4+i*4,-11-i*4),Vector2(9+i*4,-7-i*4),DARK,1)
		"ammo_light":
			for i in range(4):
				var y:=-14+i*8
				draw_polyline(PackedVector2Array([Vector2(-15,y+6),Vector2(-15,y),Vector2(15,y),Vector2(15,y+6)]),PALE,3)
			_block(-20,16,40,4,RED)
		"ammo_shell":
			_block(-19,-19,38,39,BLUE.darkened(0.20))
			_clip(Vector2(-6,-2),0.85,PALE)
			_clip(Vector2(8,1),0.70,GOLD)
		"ammo_heavy":
			for i in range(3):
				var x:=-14+i*11
				_block(x,-15,6,29,BLUE)
				_block(x,-20,6,7,GOLD)
				_poly([[x,14],[x+3,20],[x+6,14]],DARK)
		"bandage","repair_kit":
			_block(-16,-12,32,27,PALE)
			draw_rect(Rect2(-7,-18,14,7),PALE,false,3)
			_block(-3,-6,6,18,RED)
			_block(-9,0,18,6,RED)
			if id=="repair_kit":
				draw_line(Vector2(7,18),Vector2(20,4),DARK,5,true)
				_block(13,1,10,7,GOLD)
		"coffee_flask":
			_block(-12,-17,24,38,BLUE)
			_block(-14,-22,28,7,DARK)
			_block(-10,-11,20,6,PALE)
			_poly([[-2,-2],[6,-2],[1,5],[7,5],[-5,17],[-1,8],[-7,8]],GOLD)
		"flash_note":
			_block(-14,-19,29,36,PALE)
			_poly([[0,-14],[7,-4],[17,0],[7,5],[2,17],[-4,6],[-17,2],[-6,-4]],GOLD)
			_block(-16,16,33,5,RED)
		"decoy_alarm":
			_block(-16,-13,32,31,GOLD)
			draw_circle(Vector2(0,2),12,PALE)
			draw_line(Vector2(0,2),Vector2(0,-7),DARK,3,true)
			draw_line(Vector2(0,2),Vector2(7,6),DARK,3,true)
			_block(-18,-20,11,6,RED)
			_block(7,-20,11,6,RED)
			_block(-12,18,5,5,DARK)
			_block(7,18,5,5,DARK)
		"catch_shore","catch_silver":
			_poly([[-12,0],[-21,-10],[-21,10]],BLUE)
			_poly([[-14,-5],[-3,-12],[12,-9],[21,0],[12,9],[-3,12],[-14,5]],tint)
			_block(-6,-16,12,15,GOLD)
			_block(-3,-11,7,2,PALE)
			_block(11,-5,4,4,DARK)
		"catch_crab","boss_crab":
			for side in [-1,1]:
				for i in range(3): draw_line(Vector2(side*9,i*5-2),Vector2(side*21,i*6-3),DARK,3)
				draw_line(Vector2(side*9,-6),Vector2(side*16,-15),RED,5)
				_block(side*16-4,-21,8,9,RED)
			_block(-13,-7,26,23,Color("6b91aa"))
			_block(-10,-4,21,15,PALE)
			_block(-13,-7,5,23,DARK)
			_block(3,-10,8,4,GOLD)
			_block(-3,1,9,3,RED)
		"catch_eel":
			var points:=PackedVector2Array([Vector2(-20,12),Vector2(-12,15),Vector2(-4,8),Vector2(0,-6),Vector2(8,-12),Vector2(19,-10)])
			draw_polyline(points,DARK,9,true)
			draw_polyline(points,BLUE,2,true)
			_block(4,-22,17,17,GOLD)
			_block(11,-19,3,8,DARK)
			_block(11,-9,3,2,DARK)
		"coin":
			_poly([[-10,-17],[10,-17],[19,-8],[19,8],[10,17],[-10,17],[-19,8],[-19,-8]],GOLD)
			_block(-3,-11,6,22,PALE)
		"treasure":
			_block(-18,0,36,18,Color("c49664"))
			_poly([[-18,0],[-22,-8],[-4,-4],[0,3]],PALE)
			_poly([[18,0],[22,-8],[4,-4],[0,3]],GOLD)
			draw_circle(Vector2(0,-10),8,GOLD)
			_block(-3,-4,6,8,PALE)
			_block(-19,-17,8,9,RED)
		"trophy":
			_block(-10,-18,20,22,GOLD)
			draw_arc(Vector2(-10,-10),8,PI/2,PI*1.5,8,GOLD,3)
			draw_arc(Vector2(10,-10),8,-PI/2,PI/2,8,GOLD,3)
			_block(-3,4,6,10,PALE)
			_block(-13,14,26,6,DARK)
		"clock":
			draw_arc(Vector2.ZERO,17,0,TAU,24,tint,3,true)
			draw_line(Vector2.ZERO,Vector2(0,-10),tint,3)
			draw_line(Vector2.ZERO,Vector2(9,4),GOLD,3)
		"player","offline":
			_block(-13,-20,26,8,DARK)
			_block(-10,-12,20,20,PALE)
			_block(-17,10,34,13,tint)
			_block(-3,12,6,8,PALE)
			draw_line(Vector2(-5,9),Vector2(0,15),GOLD,2)
			draw_line(Vector2(5,9),Vector2(0,15),GOLD,2)
			if id=="offline": draw_line(Vector2(-21,-21),Vector2(21,21),DARK,4,true)
		"wall","crate":
			_block(-18,-20,36,40,tint)
			for y in [-16,-4,8]:
				_block(-15,y,30,10,DARK)
				_block(-6,y+3,12,3,PALE)
		"gate":
			_block(-21,-21,42,42,DARK)
			_block(-17,-17,16,37,tint)
			_block(1,-17,16,37,tint)
			_block(-13,-13,9,12,PALE)
			_block(4,-13,9,12,PALE)
			_block(-5,3,3,8,GOLD)
			_block(2,3,3,8,GOLD)
		"core":
			_block(-14,15,28,6,DARK)
			_block(-3,-8,6,25,tint)
			_poly([[-10,-20],[10,-20],[20,-7],[-20,-7]],tint)
			_block(-15,-6,30,4,GOLD)
			draw_line(Vector2(-13,1),Vector2(-17,7),GOLD,2)
			draw_line(Vector2(13,1),Vector2(17,7),GOLD,2)
		"staple_tower":
			_block(-7,-3,14,19,DARK)
			_block(-17,15,34,5,tint)
			_block(-19,-7,39,4,PALE)
			_poly([[-17,-21],[19,-21],[22,-15],[22,-8],[14,-8],[13,-14],[-17,-14]],RED)
			_block(-17,-15,6,10,RED)
		"repair":
			draw_line(Vector2(-15,17),Vector2(13,-13),DARK,7,true)
			_poly([[0,-18],[8,-23],[21,-8],[13,0]],tint)
		"slot":
			draw_rect(Rect2(-16,-16,32,32),tint,false,2)
			draw_line(Vector2(-6,0),Vector2(6,0),tint,2)
			draw_line(Vector2(0,-6),Vector2(0,6),tint,2)
		_:
			_block(-18,-12,15,14,PALE)
			_block(-13,-8,5,4,DARK)
			_block(4,5,15,14,BLUE)
			_clip(Vector2(7,-9),0.7,GOLD)
