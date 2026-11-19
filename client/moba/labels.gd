extends Control

var camera: Camera3D
var nodes: Dictionary = {}
var states: Dictionary = {}
var self_id := ""
var selected := ""
var numbers: Array = []
var font: Font = preload("res://fonts/IslandSans.ttf")

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

func _process(delta: float) -> void:
	for row in numbers: row.life-=delta
	numbers=numbers.filter(func(row):return float(row.life)>0)
	queue_redraw()

func floating(at: Vector3, value: String, healing := false) -> void:
	if numbers.size()<40: numbers.append({"at":at,"value":value,"life":.8,"heal":healing})

func _draw() -> void:
	if camera==null: return
	var used_names: Array[Rect2]=[]
	var ordered:=states.keys()
	ordered.sort_custom(func(a,b):return (0 if a==self_id else 1 if a==selected else 2)<(0 if b==self_id else 1 if b==selected else 2))
	for id in ordered:
		var s: Dictionary = states[id]
		if float(s.hp)<=0 or not nodes.has(id): continue
		var node: Node3D = nodes[id]
		var at := node.position+Vector3(0,3.2 if str(s.kind)=="hero" else 4.4 if str(s.kind) in ["tower","core"] else 2.1,0)
		if camera.is_position_behind(at): continue
		var p := camera.unproject_position(at)
		if p.x<0 or p.y<0 or p.x>size.x or p.y>size.y: continue
		var hero := str(s.kind)=="hero"
		var width := 64.0 if hero else 45.0
		var color := Color("62c1e2") if int(s.team)==0 else Color("ed967c") if int(s.team)==1 else Color("e3c584")
		draw_rect(Rect2(p-Vector2(width*.5,0),Vector2(width,6)),Color("15282b"))
		draw_rect(Rect2(p-Vector2(width*.5,0),Vector2(width*clampf(float(s.hp)/float(s.maxHp),0,1),6)),color)
		if float(s.get("shield",0))>0:
			draw_rect(Rect2(p-Vector2(width*.5,3),Vector2(width*minf(1,float(s.shield)/float(s.maxHp)),2)),Color("c6eaf2"))
		if id==self_id: draw_rect(Rect2(p-Vector2(width*.5+1,1),Vector2(width+2,8)),Color("f9edc5"),false,1)
		if hero:
			var label := str(s.name).left(6)
			if bool(s.get("bot",false)): label=str({"stapler":"弩手","archer":"游侠","courier":"影客","mechanic":"斗士","printer":"术师","lecturer":"讲师","guardian":"铁卫","custodian":"保洁","barista":"茶水","broadcaster":"广播"}.get(str(s.heroId),"电脑"))
			label=str(int(s.get("level",1)))+" · "+label
			if bool(s.get("steady",false)): label="稳 · "+label
			var length := font.get_string_size(label,HORIZONTAL_ALIGNMENT_LEFT,-1,12).x
			var rect:=Rect2(p-Vector2(length*.5,19),Vector2(length,16))
			if not used_names.any(func(other):return other.intersects(rect)):
				used_names.append(rect)
				draw_string_outline(font,p-Vector2(length*.5,5),label,HORIZONTAL_ALIGNMENT_LEFT,-1,12,3,Color("243a3b"))
				draw_string(font,p-Vector2(length*.5,5),label,HORIZONTAL_ALIGNMENT_LEFT,-1,12,Color("f3eed9"))
		elif str(s.kind) in ["tower","inhibitor","core"]:
			var title:=str(["外塔","内塔","高地塔","门塔"][clampi(int(s.get("tier",0)),0,3)]) if str(s.kind)=="tower" else "兵营" if str(s.kind)=="inhibitor" else "基地"
			if bool(s.get("protected",false)): title+=" · 保护中"
			var length:=font.get_string_size(title,HORIZONTAL_ALIGNMENT_LEFT,-1,10).x
			draw_string_outline(font,p-Vector2(length*.5,5),title,HORIZONTAL_ALIGNMENT_LEFT,-1,10,3,Color("243a3b"))
			draw_string(font,p-Vector2(length*.5,5),title,HORIZONTAL_ALIGNMENT_LEFT,-1,10,Color("b6beba") if bool(s.get("protected",false)) else Color("f0e5c5"))
		elif bool(s.get("returning",false)):
			draw_string(font,p-Vector2(14,5),"回营",HORIZONTAL_ALIGNMENT_LEFT,-1,10,Color("d7c993"))
	for row in numbers:
		var p := camera.unproject_position(row.at+Vector3(0,2.5+(1-float(row.life))*.8,0))
		var color := Color("9bebb2") if row.heal else Color("fff0ba")
		color.a = minf(1,float(row.life)*2)
		draw_string_outline(font,p,str(row.value),HORIZONTAL_ALIGNMENT_LEFT,-1,17,3,Color(.08,.14,.16,color.a))
		draw_string(font,p,str(row.value),HORIZONTAL_ALIGNMENT_LEFT,-1,17,color)
