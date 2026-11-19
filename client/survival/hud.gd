extends Control

const FONT = preload("res://fonts/IslandSans.ttf")
const AimProfile = preload("res://survival/aim_profile.gd")
const ItemIcons = preload("res://survival/item_icon.gd")
const FishingPresentation = preload("res://survival/fishing_presentation.gd")
const WHITE = Color("e7f0ed")
const MUTED = Color("8faeaf")
const GOLD = Color("e7c383")
const MINT = Color("84d7bc")
const RED = Color("ef826c")
const BG = Color(0.035,0.08,0.11,0.86)
var game
var clock := 0.0
var scope_mask_rect := Rect2()
var scope_mask_parts: Array[PackedVector2Array] = []

# Only immutable derived drawing data is cached. Animation/redraw stays per frame.
const WIDTH_CACHE_LIMIT := 512
const LAYOUT_CACHE_LIMIT := 128
const STYLE_CACHE_LIMIT := 32
const CACHE_TEXT_LIMIT := 512
var _width_cache: Dictionary = {}
var _wrap_cache: Dictionary = {}
var _fitted_cache: Dictionary = {}
var _style_cache: Dictionary = {}

func _remember(cache: Dictionary, key: Variant, value: Variant, limit: int) -> void:
	if not cache.has(key) and cache.size() >= limit:
		cache.erase(cache.keys()[0])
	cache[key] = value

func _text_width(value: String, size_px: int) -> float:
	if value.length() > CACHE_TEXT_LIMIT:
		return FONT.get_string_size(value,HORIZONTAL_ALIGNMENT_LEFT,-1,size_px).x
	var key := str(size_px)+"\u001f"+value
	if _width_cache.has(key): return float(_width_cache[key])
	var result := FONT.get_string_size(value,HORIZONTAL_ALIGNMENT_LEFT,-1,size_px).x
	_remember(_width_cache,key,result,WIDTH_CACHE_LIMIT)
	return result

func _layout_key(value: String, width: float, size_px: int) -> String:
	return str(size_px)+"\u001f"+var_to_str(width)+"\u001f"+value

func _card_style(opacity: float) -> StyleBoxFlat:
	if _style_cache.has(opacity): return _style_cache[opacity]
	var style := StyleBoxFlat.new()
	style.bg_color = Color(BG, BG.a*opacity)
	style.border_color = Color(0.37,0.55,0.57,0.24*opacity)
	style.set_border_width_all(1)
	style.set_corner_radius_all(7)
	_remember(_style_cache,opacity,style,STYLE_CACHE_LIMIT)
	return style

func setup(owner_game) -> void:
	game = owner_game
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

func _process(delta: float) -> void:
	clock += delta
	queue_redraw()

func text(value: String, at: Vector2, size_px := 16, color := WHITE, limit := -1.0) -> void:
	draw_string(FONT,at,value,HORIZONTAL_ALIGNMENT_LEFT,limit,size_px,color)

func centered(value: String, at: Vector2, size_px := 16, color := WHITE) -> void:
	text(value,at-Vector2(_text_width(value,size_px)/2,0),size_px,color)

func wrapped_lines(value: String, width: float, size_px: int) -> Array[String]:
	var key := _layout_key(value,width,size_px)
	var cacheable := value.length() <= CACHE_TEXT_LIMIT
	if cacheable and _wrap_cache.has(key):
		var cached: Array[String] = _wrap_cache[key]
		return cached.duplicate()
	var lines: Array[String] = []
	var line := ""
	for i in range(value.length()):
		var character := value.substr(i,1)
		if character == "\n" or (not line.is_empty() and _text_width(line+character,size_px)>width):
			lines.append(line)
			line = ""
		if character != "\n":
			line += character
	lines.append(line)
	if cacheable: _remember(_wrap_cache,key,lines.duplicate(),LAYOUT_CACHE_LIMIT)
	return lines

func card(rect: Rect2, accent := Color(0,0,0,0), opacity := 1.0) -> void:
	draw_style_box(_card_style(opacity),rect)
	if accent.a>0:
		draw_rect(Rect2(rect.position+Vector2(1,11),Vector2(2,rect.size.y-22)),accent)

func bar(at: Vector2, width: float, value: float, color: Color, height := 5.0) -> void:
	draw_rect(Rect2(at,Vector2(width,height)),Color(0.28,0.4,0.43,0.42))
	draw_rect(Rect2(at,Vector2(width*clampf(value,0,1),height)),color)

func icon(kind: String, at: Vector2, color: Color, scale_value := 1.0) -> void:
	if ItemIcons.TOOL_ICONS.has(kind):
		var extent := Vector2.ONE * 38.0 * scale_value
		draw_texture_rect(ItemIcons.TOOL_ICONS[kind],Rect2(at-extent/2,extent),false,ItemIcons.TOOL_COLORS[kind])
		return
	var pts: PackedVector2Array
	match kind:
		"rod_net":
			draw_rect(Rect2(at+Vector2(-10,-13)*scale_value,Vector2(22,18)*scale_value),color,false,2*scale_value)
			for x in [-5,0,5]: draw_line(at+Vector2(x,-11)*scale_value,at+Vector2(x,3)*scale_value,color,scale_value,true)
			for y in [-6,0]: draw_line(at+Vector2(-8,y)*scale_value,at+Vector2(10,y)*scale_value,color,scale_value,true)
			draw_line(at+Vector2(-11,15)*scale_value,at+Vector2(0,4)*scale_value,color,3*scale_value,true)
			return
		"weapon":
			pts = PackedVector2Array([Vector2(-15,0),Vector2(-9,-5),Vector2(8,-5),Vector2(8,-8),Vector2(10,-8),Vector2(10,-4),Vector2(19,-4),Vector2(19,-1),Vector2(6,-1),Vector2(3,5),Vector2(-1,5),Vector2(-2,0),Vector2(-7,0),Vector2(-9,6),Vector2(-13,6),Vector2(-13,0)])
		"rod":
			draw_line(at+Vector2(-11,10)*scale_value,at+Vector2(11,-13)*scale_value,color,3*scale_value,true)
			draw_arc(at+Vector2(8,-3)*scale_value,9*scale_value,-1.2,1.8,15,color,1.2*scale_value,true)
			draw_circle(at+Vector2(-5,5)*scale_value,3*scale_value,color)
			return
		"melee":
			pts = PackedVector2Array([Vector2(-9,12),Vector2(-12,9),Vector2(0,-3),Vector2(-3,-6),Vector2(1,-8),Vector2(4,-5),Vector2(13,-14),Vector2(10,0),Vector2(0,8),Vector2(-3,5)])
		"coffee_flask":
			draw_rect(Rect2(at+Vector2(-9,-12)*scale_value,Vector2(18,26)*scale_value),color)
			draw_rect(Rect2(at+Vector2(-11,-17)*scale_value,Vector2(22,4)*scale_value),color)
			return
		"decoy_alarm":
			draw_arc(at,12*scale_value,0,TAU,20,color,3*scale_value,true)
			draw_line(at,at+Vector2(0,-8)*scale_value,color,2*scale_value,true)
			draw_line(at,at+Vector2(6,3)*scale_value,color,2*scale_value,true)
			return
		"flash_note":
			pts=PackedVector2Array([Vector2(1,-17),Vector2(6,-5),Vector2(17,0),Vector2(5,5),Vector2(0,17),Vector2(-5,5),Vector2(-17,0),Vector2(-5,-5)])
		"health":
			pts = PackedVector2Array([Vector2(-4,-13),Vector2(4,-13),Vector2(4,-4),Vector2(13,-4),Vector2(13,4),Vector2(4,4),Vector2(4,13),Vector2(-4,13),Vector2(-4,4),Vector2(-13,4),Vector2(-13,-4),Vector2(-4,-4)])
		_:
			pts = PackedVector2Array([Vector2(0,-10),Vector2(11,-5),Vector2(11,7),Vector2(0,12),Vector2(-11,7),Vector2(-11,-5)])
	for i in range(pts.size()):
		pts[i] = at+pts[i]*scale_value
	draw_colored_polygon(pts,color)

func fitted(value: String, width: float, size_px: int) -> String:
	var key := _layout_key(value,width,size_px)
	var cacheable := value.length() <= CACHE_TEXT_LIMIT
	if cacheable and _fitted_cache.has(key): return str(_fitted_cache[key])
	var result := value
	if _text_width(value,size_px)>width:
		while not result.is_empty() and _text_width(result+"…",size_px)>width:
			result = result.left(result.length()-1)
		result += "…"
	if cacheable: _remember(_fitted_cache,key,result,LAYOUT_CACHE_LIMIT)
	return result

func short_lines(value: String, width: float, size_px: int, maximum := 4) -> Array[String]:
	var lines := wrapped_lines(value,width,size_px)
	if lines.size()>maximum:
		lines.resize(maximum)
		lines[maximum-1]=fitted(lines[maximum-1]+"…",width,size_px)
	return lines

func _draw() -> void:
	if game == null or not game.joined: return
	if not game.overlay.is_empty() and not (game.overlay == "chat" and game.platform_previous_overlay.is_empty()): return
	var s: Dictionary = game.state
	var p: Dictionary = game.player
	if s.is_empty(): return
	var viewport := get_viewport_rect().size
	var factor := minf(viewport.x/1280.0,viewport.y/720.0)
	var canvas_offset := (viewport-Vector2(1280,720)*factor)/2
	draw_set_transform(canvas_offset,0,Vector2.ONE*factor)
	_scope_overlay(p,Rect2(-canvas_offset/factor,viewport/factor))
	var phase := str(s.get("phase","PREP"))
	var accent := RED if phase in ["NIGHT","RETURN"] else MINT
	# Side rails leave the forward view clear: x=278..1002 contains only aiming feedback.
	_calendar(s,phase,accent)
	_objective(s,phase,accent)
	var roster_bottom := _roster(s)
	for enemy in s.get("enemies",[]):
		if str(enemy.get("tier",""))=="boss" or str(enemy.get("definitionId",""))=="boss_crab":
			var y := roster_bottom+12
			card(Rect2(18,y,260,58),RED)
			text(fitted(game._enemy_name(enemy)+(" · 弱点暴露" if bool(enemy.get("weak",false)) else " · 加班连招" if int(enemy.get("combatPhase",1))>=2 else ""),236,13),Vector2(30,y+22),13,GOLD)
			bar(Vector2(30,y+39),236,float(enemy.hp)/maxf(1,float(enemy.maxHp)),RED,5)
			break
	for zone in s.get("dangerZones",[]):
		if Vector2(game.local_pos.x-float(zone.x),game.local_pos.z-float(zone.z)).length()<=float(zone.get("radius",22)):
			var risk := clampi(int(zone.get("risk",1)),1,3)
			var risk_color: Color = [MINT,GOLD,RED][risk-1]
			card(Rect2(18,554,260,54),risk_color)
			text(fitted(str(zone.get("riskName","风险区"))+" · "+str(zone.get("encounterName",zone.get("name",zone.get("label","旧工位区")))),236,13),Vector2(30,577),13,risk_color)
			var task: Dictionary = game.ExpeditionUI.contract(game,str(zone.id))
			text(fitted(game.ExpeditionUI.progress(task)+" · C",236,12),Vector2(30,597),12,MUTED)
			break
	_vitals(p)
	if str(p.get("lifeState","ALIVE"))=="ALIVE":
		_weapon(p)
		_hotbar(str(p.get("heldSlot","weapon")))
		_interaction(p)
		if game.overlay.is_empty(): _crosshair(p)
	var notice_bottom := 18.0
	var message := str(game.toast_label.text)
	if not message.is_empty() and game.elapsed<game.toast_until:
		var lines := short_lines(message,236,13,6)
		var height := 38+lines.size()*19
		card(Rect2(1002,18,260,height),GOLD,0.96)
		text("提示",Vector2(1014,40),12,GOLD)
		for i in range(lines.size()): text(lines[i],Vector2(1014,61+i*19),13,WHITE)
		notice_bottom = 18+height
	if str(p.get("lifeState")) == "DOWNED":
		_rescue_card(p,maxf(180,notice_bottom+12))
	elif not str(game.death_label.text).is_empty():
		var lines := short_lines(str(game.death_label.text),236,14,5)
		var y := maxf(180,notice_bottom+12)
		card(Rect2(1002,y,260,40+lines.size()*21),RED)
		text("等待救援" if str(p.get("lifeState"))=="DOWNED" else "等待归队",Vector2(1014,y+24),16,RED)
		for i in range(lines.size()): text(lines[i],Vector2(1014,y+48+i*21),14,WHITE)
	if float(game.health_flash.color.a)>0:
		for i in range(6):
			draw_rect(Rect2(i*10,i*10,1280-i*20,720-i*20),Color(0.90,0.22,0.12,float(game.health_flash.color.a)*(1-float(i)/6)*0.75),false,12)
	if Time.get_ticks_msec()<game.hurt_direction_until:
		var direction: Vector2=game.hurt_direction
		var at:=Vector2(640,360)+direction*Vector2(420,235)
		var side:=Vector2(-direction.y,direction.x)
		var alpha:=clampf(float(game.hurt_direction_until-Time.get_ticks_msec())/250,0,1)
		draw_colored_polygon(PackedVector2Array([at+direction*18,at-direction*9+side*18,at-direction*9-side*18]),Color(1,.34,.17,alpha))
	draw_set_transform(Vector2.ZERO)

func _rescue_card(p: Dictionary, y: float) -> void:
	# One fixed-size card for waiting, self aid and teammate aid.
	card(Rect2(1002,y,260,196),RED)
	icon("health",Vector2(1024,y+25),RED,0.3)
	text("先撑住！",Vector2(1044,y+31),19,WHITE)
	var remaining := int(ceil(float(p.get("downedRemaining",0))))
	var rescue = p.get("rescue")
	var work = p.get("work")
	text("失血暂缓" if rescue is Dictionary else "预计剩余 %d 秒" % remaining,Vector2(1014,y+58),13,RED)
	bar(Vector2(1014,y+70),236,float(p.get("downedHp",0))/maxf(1,float(p.get("downedMaxHp",40))),RED,7)
	var progress := 0.0
	var title := "按住 E · 自救"
	var hint := "原地坚持 12 秒，仍会失血"
	if rescue is Dictionary:
		title = "队友正在扶你"
		hint = "别移动 · 受伤会打断"
		progress = float(rescue.progress)/maxf(0.1,float(rescue.duration))
	elif work is Dictionary and str(work.get("kind","")) == "SelfRevive":
		title = "自救中 · 按住 E"
		hint = "别移动 · 受伤会打断"
		progress = float(work.progress)/maxf(0.1,float(work.duration))
	elif bool(p.get("swimming",false)):
		title = "先爬到岸边"
		hint = "水中无法自救"
	elif float(p.get("selfReviveReadyIn",0))>0:
		title = "躲好，再等 %d 秒" % int(ceil(float(p.selfReviveReadyIn)))
		hint = "没有再受伤，就能自救"
	text(title,Vector2(1014,y+103),15,GOLD)
	bar(Vector2(1014,y+115),236,progress,MINT,6)
	text(hint,Vector2(1014,y+145),12,MUTED)
	text("WASD 慢爬 · 队友靠近按 E",Vector2(1014,y+178),12,WHITE)

func _calendar(s: Dictionary, phase: String, accent: Color) -> void:
	if game.mission.active():
		card(Rect2(18,18,260,112),GOLD)
		text("OFFICE / 试岗",Vector2(30,40),15,GOLD)
		text("v"+game.CLIENT_BUILD,Vector2(216,39),10,MUTED)
		text("任务模式",Vector2(30,69),18,WHITE)
		text("练习物资 · 退出不保存",Vector2(30,96),12,MINT)
		text("Esc 查看任务",Vector2(30,116),11,MUTED)
		return
	card(Rect2(18,18,260,112),accent)
	text("OFFICE / 99N",Vector2(30,40),15,GOLD)
	text("v"+game.CLIENT_BUILD,Vector2(216,39),10,MUTED)
	var calendar: Dictionary = s.get("clock",{})
	var day := int(calendar.get("day",s.get("dayIndex",1)))
	text("第 %02d 天 · %02d:%02d" % [day,int(calendar.get("hour",8)),int(calendar.get("minute",0))],Vector2(30,65),13,MUTED)
	text(str(game.PHASES.get(phase,phase)),Vector2(30,94),17,WHITE)
	var remain := maxi(0,int(ceil(float(s.get("phaseRemaining",0)))))
	text("已完成" if phase=="COMPLETE" else "%02d:%02d" % [remain/60,remain%60],Vector2(214,94),14,accent)
	text("阶段剩余",Vector2(214,115),10,MUTED)

func _objective(s: Dictionary, phase: String, accent: Color) -> void:
	if game.mission.active():
		game.mission.draw_objective(self)
		return
	var guidance := {"PREP":"备好装备 · C 选外勤路线", "DAY":"钓鱼较稳 · C 查看三档外勤", "RETURN":"潮水上涨，带物资回办公室", "NIGHT":"守住协作灯，撑到天亮", "RECOVERY":"清四处残骸，再重建协作灯", "COMPLETE":"Esc 查看结算"}
	var director: Dictionary = s.get("director",{})
	var objective: Dictionary = director.objective if director.get("objective") is Dictionary else {}
	var heading := "当前目标"
	var outing: Dictionary=game._nearest_outing() if phase=="DAY" else {}
	if not outing.is_empty():
		heading="附近探索 · "+game._waypoint(game._v(outing.part))
		guidance.DAY=str(outing.outing.name)+(" · 剩 %d 秒" % int(ceil(float(outing.outing.remaining))) if str(outing.outing.type)=="parcel_rush" and bool(outing.outing.started) else "")
		if bool(outing.get("carrying",false)):
			heading="接收点 · "+game._waypoint(game._v(outing.part))
			guidance.DAY="送到绿框 · E 交付"
	elif phase=="DAY" and not objective.is_empty():
		guidance.DAY=str(objective.name)+(" · 已完成" if bool(objective.completed) else "  %d/%d" % [int(objective.progress),int(objective.goal)])
		if bool(objective.get("unavailable",false)): guidance.DAY=str(objective.name)+" · 已错过"
		heading="可选挑战 · C 查看"
	elif phase=="NIGHT" and director.get("nightPlan") is Dictionary:
		heading="夜袭 · "+str(director.nightPlan.name)
		var night: Dictionary=s.get("night",{})
		var segments: Array=night.get("segments",[])
		var index: int=clampi(int(night.get("waveIndex",1))-1,0,maxi(0,segments.size()-1))
		if not segments.is_empty():
			guidance.NIGHT=str(segments[index].get("label","守住协作灯"))+" · 守住灯"
			if index+1<segments.size(): guidance.NIGHT=str(segments[index].label)+" → "+str(segments[index+1].label)+" %d秒" % maxi(0,ceili(float(segments[index+1].at)-float(s.get("phaseElapsed",0))))
	if phase=="RECOVERY":
		var debris: Dictionary = game._recovery_debris_status()
		guidance.RECOVERY="协作灯已恢复 · 继续补给" if game._recovery_ready() else "残骸已清完 · 按住 E 重建" if bool(debris.complete) else "清理残骸 %d/%d · 按住 E" % [int(debris.cleared),int(debris.total)]
	# Waiting newcomers still need the real survival/rebuild objective and core HP.
	card(Rect2(18,142,260,88),accent,0.90)
	text(fitted(heading,236,11),Vector2(30,163),11,accent)
	text(fitted(str(guidance.get(phase,"")),236,13),Vector2(30,187),13,WHITE)
	if phase in ["NIGHT","RECOVERY"]:
		var core: Dictionary = game._find(s.get("buildings",[]),"core")
		text("协作灯",Vector2(30,214),11,MUTED)
		bar(Vector2(82,207),184,float(core.get("hp",0))/maxf(1,float(core.get("maxHp",1500))),accent,5)
	elif not outing.is_empty():
		text(fitted(str(outing.outing.goal),236,12),Vector2(30,215),12,GOLD)
	elif phase=="DAY" and not objective.is_empty() and not bool(objective.completed):
		text(fitted(preload("res://survival/inventory_ui.gd").objective_hint(game,objective),236,12),Vector2(30,215),12,GOLD)
	else:
		text(("C 查看路线 · " if phase in ["PREP","DAY"] else "办公室  ")+game._waypoint(Vector3(0,5,0)),Vector2(30,215),12,GOLD)

func _roster(s: Dictionary) -> float:
	var members: Array = []
	for member in s.get("players",[]):
		if str(member.id)!=game.self_id and bool(member.get("connected",false)): members.append(member)
	var height := 34+members.size()*22
	card(Rect2(18,242,260,height),Color(0,0,0,0),0.86)
	text("同事  %d 人在线" % game._online_count(),Vector2(30,265),12,MUTED)
	var row := 287.0
	for member in members:
		var color := MINT if str(member.get("lifeState","ALIVE"))=="ALIVE" else RED
		draw_circle(Vector2(32,row-4),3,color)
		text(fitted(str(member.get("name","队友")),152,12),Vector2(44,row),12,WHITE)
		if str(member.get("lifeState","ALIVE")) == "DOWNED":
			text("救 %ds" % int(ceil(float(member.get("downedRemaining",0)))),Vector2(204,row),11,RED)
		else:
			bar(Vector2(204,row-5),62,float(member.get("hp",0))/100.0,color,3)
		row+=22
	return 242+height

func _vitals(p: Dictionary) -> void:
	card(Rect2(18,624,260,76),Color(0,0,0,0),0.84)
	var hp := int(p.get("hp",0))
	if str(p.get("lifeState","")) == "DOWNED":
		icon("health",Vector2(42,656),RED,0.4)
		text("倒地",Vector2(62,668),22,RED)
		text("保持呼吸，等待救援",Vector2(119,691),11,MUTED)
		return
	icon("health",Vector2(42,656),MINT if hp>30 else RED,0.4)
	text(str(hp),Vector2(58,673),28,WHITE)
	bar(Vector2(119,652),137,hp/100.0,MINT if hp>30 else RED,5)
	bar(Vector2(119,675),137,float(p.get("stamina",0))/100.0,GOLD,3)
	if bool(p.get("swimming",false)):
		text("氧气 %.1f" % float(p.get("oxygen",0)),Vector2(30,620),12,MINT)
	elif float(p.get("joinProtectionRemaining",0))>0:
		text("加入保护 %.1fs" % float(p.joinProtectionRemaining),Vector2(30,620),11,MINT)

func _weapon(p: Dictionary) -> void:
	card(Rect2(1002,624,260,76),Color(0,0,0,0),0.84)
	if p.get("carryingId")!=null:
		text("搬运补给",Vector2(1014,650),19,GOLD)
		text("E 放下 · 绿框内 E 交付",Vector2(1014,681),13,MUTED)
		return
	var slot := str(p.get("heldSlot","weapon"))
	if game._equipped(slot).is_empty():
		text("空手",Vector2(1014,650),19,GOLD)
		text("左键挥拳 · 补给台领工具",Vector2(1014,681),13,MUTED)
		return
	text(fitted(game._name(game.current_weapon),236,13),Vector2(1014,647),13,MUTED)
	if slot=="weapon":
		var reserve := 0
		var ammo_type := str(game._weapon_config().get("ammo",""))
		for ammo in game._items_in(str(p.get("backpackId",""))):
			if str(ammo.definitionId)==ammo_type: reserve+=int(ammo.quantity)
		text("%02d" % int(game._equipped("weapon").get("magazineAmmo",0)),Vector2(1014,683),31,WHITE)
		text("/ ∞" if game.mission.active() else "/ %03d" % reserve,Vector2(1075,680),17,MUTED)
		text("R 装填" if p.get("reload")==null else "装填中",Vector2(1203,679),11,GOLD)
	elif slot=="quick":
		var id := str(game._equipped("quick").get("definitionId",""))
		var quantity := 0
		for item in game._items_in(str(p.get("backpackId",""))):
			if str(item.definitionId)==id: quantity+=int(item.quantity)
		text("×%d" % quantity,Vector2(1014,683),27,WHITE)
		var reason: String = game._quick_use_reason()
		text(fitted(reason if not reason.is_empty() else "左键使用",100,12),Vector2(1148,679),12,MUTED if not reason.is_empty() else GOLD)
	else:
		icon(slot,Vector2(1033,677),WHITE,0.6)
		text("海边撒网" if game.current_weapon=="rod_net" else "海域自由抛竿" if slot=="rod" else "左键挥刀",Vector2(1062,680),14,WHITE)

func _text_in_rect(value: String, rect: Rect2, font_size: int, tint: Color) -> void:
	var baseline := rect.get_center().y+(FONT.get_ascent(font_size)-FONT.get_descent(font_size))*0.5
	centered(value,Vector2(rect.get_center().x,baseline),font_size,tint)

func hotbar_cell(index: int) -> Rect2:
	return Rect2(1002+index*66,564,62,42)

func hotbar_icon_offset(kind: String) -> Vector2:
	# Center the source ink bounds, not its historical arbitrary draw origin.
	return {"weapon":Vector2(2,-1),"rod":Vector2(3,-1.5),"melee":Vector2(0.5,-1),"bandage":Vector2.ZERO}.get(kind,Vector2.ZERO)

func _hotbar(slot: String) -> void:
	var values := ["weapon","rod","melee","quick"]
	for i in range(4):
		var active: bool = values[i]==slot
		var empty: bool = game._equipped(values[i]).is_empty()
		var rect := hotbar_cell(i)
		var tint := GOLD if active else MUTED
		card(rect,GOLD if active else Color(0,0,0,0),0.96 if active else 0.88)
		_text_in_rect(str(i+1),Rect2(rect.position+Vector2(5,3),Vector2(14,13)),10,tint)
		if empty: _text_in_rect("空",rect,12,MUTED)
		else:
			var kind: String = str(game._equipped("quick").get("definitionId","")) if i==3 else values[i]
			if i==1 and str(game._equipped("rod").get("definitionId",""))=="rod_net": kind="rod_net"
			icon(kind,rect.get_center()-hotbar_icon_offset(kind)*0.59,tint,0.59)
	# This compact lane shows either the active module or the key guide.
	if slot=="weapon" and Time.get_ticks_msec()<game.gear_feedback_until:
		text(game.gear_feedback_text,Vector2(1014,619),12,GOLD)
	elif slot=="weapon" and float(game.player.get("gearFocusSeconds",0))>0:
		text("专注",Vector2(1014,619),12,MINT)
		bar(Vector2(1054,612),196,float(game.player.gearFocusSeconds),GOLD,4)
	elif slot=="rod" and str(game.state.get("mode",""))!="mission":
		var supply: Dictionary = game.state.get("exploration",{}).get("fishParts",{})
		var left := int(supply.get("remaining",0))
		text("今日鱼获部件 %d/%d" % [left,int(supply.get("limit",0))] if left>0 else "部件明日补充 · 鱼获照常",Vector2(1014,619),11,MUTED)
	else:
		text("Tab背包 · C外勤 · G嬉戏",Vector2(1014,619),10,MUTED)

func _interaction(p: Dictionary) -> void:
	var action := str(game.action_label.text)
	var fishing: Dictionary = p.fishing if p.get("fishing") is Dictionary else {}
	var charging: float = game.rod_charge_amount()
	if charging>0: action="松开左键撒网" if game.current_weapon=="rod_net" else "松开左键抛竿"
	var value := action if not action.is_empty() else str(game.context_label.text)
	if not fishing.is_empty():
		_fishing_card(fishing)
		value=""
	if not value.is_empty():
		var lines := short_lines(value,236,13,4)
		var progress_height := 60 if str(fishing.get("state",""))=="REEL" else 27 if charging>0 or p.get("work") is Dictionary else 0
		var height := 38+lines.size()*19+progress_height
		var y := 552-height
		card(Rect2(1002,y,260,height),GOLD if not action.is_empty() else Color(0,0,0,0),0.90)
		text("正在操作" if not action.is_empty() else "操作提示",Vector2(1014,y+22),11,GOLD if not action.is_empty() else MUTED)
		for i in range(lines.size()): text(lines[i],Vector2(1014,y+44+i*19),13,WHITE)
		var progress_y := y+44+lines.size()*19
		if str(fishing.get("state",""))=="REEL":
			text("收线",Vector2(1014,progress_y+2),11,MUTED)
			bar(Vector2(1060,progress_y-5),190,float(fishing.get("progress",0))/100,MINT,7)
			text("张力",Vector2(1014,progress_y+26),11,MUTED)
			var tension := float(fishing.get("tension",0))
			bar(Vector2(1060,progress_y+19),190,tension/100,RED if tension>78 else GOLD,7)
			draw_line(Vector2(1212,progress_y+17),Vector2(1212,progress_y+29),RED,1.5)
		elif charging>0: bar(Vector2(1014,progress_y-5),236,charging,GOLD,7)
		elif p.get("work") is Dictionary: bar(Vector2(1014,progress_y-5),236,float(p.work.get("progress",0))/maxf(0.1,float(p.work.get("duration",1))),MINT,7)
	var focus: Dictionary = game.aim_target
	if not focus.is_empty():
		# Keep target information readable against light scenery and outside the ADS sight.
		var focus_tint := RED if focus.has("id") else GOLD
		card(Rect2(1002,310,260,54),focus_tint,0.94)
		text(fitted(str(focus.get("name","")),236,12),Vector2(1014,334),12,WHITE)
		bar(Vector2(1014,347),236,float(focus.get("hp",0))/maxf(1,float(focus.get("maxHp",1))),focus_tint,5)

func _fishing_card(fishing: Dictionary) -> void:
	# A cast keeps one side-card footprint through waiting, strikes and landing.
	# Changing instructions never moves the hotbar or covers the centre view.
	var tint := FishingPresentation.cue_color(fishing)
	var style := FishingPresentation.mode(fishing)
	var stage := str(fishing.get("state",""))
	card(Rect2(1002,392,260,160),tint,0.92)
	icon("rod_net" if style=="net" else "rod",Vector2(1028,416),tint,0.50)
	text(FishingPresentation.title(fishing),Vector2(1050,420),14,tint)
	text("右键收回",Vector2(1192,418),10,MUTED)
	text(fitted(FishingPresentation.cue_hint(fishing),236,13),Vector2(1014,451),13,WHITE)
	if stage=="REEL" or stage=="LAND":
		text("收网" if style=="net" else "拖回" if style=="magnet" else "收线",Vector2(1014,479),11,MUTED)
		bar(Vector2(1060,472),190,float(fishing.get("progress",0))/100,MINT,7)
		text("张力",Vector2(1014,503),11,MUTED)
		var tension := float(fishing.get("tension",0))
		bar(Vector2(1060,496),190,tension/100,RED if tension>78 else GOLD,7)
		draw_line(Vector2(1208,494),Vector2(1208,505),RED,1.5)
		if style=="angle":
			var line := Vector2(float(fishing.get("x",0))-game.local_pos.x,float(fishing.get("z",0))-game.local_pos.z)
			var side := Vector2(line.y,-line.x).normalized()*float(fishing.get("pullSide",1))
			var right := Vector2(cos(game.yaw),-sin(game.yaw))
			var sign_value := 1.0 if side.dot(right)>0 else -1.0
			var center := Vector2(1030,531)
			draw_line(center-Vector2(sign_value*9,0),center+Vector2(sign_value*9,0),tint,2)
			draw_line(center+Vector2(sign_value*9,0),center+Vector2(sign_value*3,-5),tint,2)
			draw_line(center+Vector2(sign_value*9,0),center+Vector2(sign_value*3,5),tint,2)
			bar(Vector2(1060,527),82,float(fishing.get("angleAdvantage",0)),MINT,6)
			text("侧拉更省力",Vector2(1156,534),11,MUTED)
		elif style=="net": text("拉一段，松一下 · 最多两条",Vector2(1014,535),11,MUTED)
		elif style=="magnet": text("松手停拖 · 侧走解卡",Vector2(1014,535),11,MUTED)
		elif style=="power": text("冲刺放线  /  停歇收线",Vector2(1014,535),11,MUTED)
		elif style=="lure": text("轻拉一小下，再停一下",Vector2(1014,535),11,MUTED)
		else: text("别让张力条变满",Vector2(1014,535),11,MUTED)
	elif stage=="BITE":
		var remaining := float(fishing.get("remaining",0))
		draw_arc(Vector2(1036,500),17,-PI/2,-PI/2+TAU*clampf(remaining/2.6,0,1),28,tint,3,true)
		centered("!",Vector2(1036,506),22,tint)
		text("现在提竿",Vector2(1066,497),17,tint)
		text("松开后，再点左键",Vector2(1066,520),11,MUTED)
	elif stage=="WAIT" and style in ["lure","magnet","net"]:
		text("聚鱼" if style=="net" else "信号" if style=="magnet" else "追饵",Vector2(1014,486),11,MUTED)
		bar(Vector2(1060,479),190,float(fishing.get("signal" if style=="magnet" else "activity",0)),tint,8)
		text("鱼聚齐后收网 · 最多两条" if style=="net" else "信号越强，声音越密" if style=="magnet" else "停顿会让鱼更想咬钩",Vector2(1014,521),11,MUTED)
	else:
		for i in range(3):
			var active := int(clock*1.5)%3==i
			draw_circle(Vector2(1024+i*20,486),3,tint if active else MUTED.darkened(0.5))
		text("远处下竿，横移侧拉" if style=="angle" else "看水面 · 听咬钩声",Vector2(1014,521),11,MUTED)

func _scope_overlay(p: Dictionary, outer: Rect2) -> void:
	if str(p.get("lifeState","")) != "ALIVE" or str(game.current_weapon) != "rifle": return
	var opacity := float(game.view.scope_alpha())
	if opacity <= 0.001: return
	var center := Vector2(640,360)
	var radius := 240.0
	if scope_mask_parts.is_empty() or scope_mask_rect != outer:
		scope_mask_rect = outer
		scope_mask_parts.clear()
		var edges := [Vector2(outer.end.x,center.y),Vector2(center.x,outer.end.y),Vector2(outer.position.x,center.y),Vector2(center.x,outer.position.y)]
		var corners := [outer.end,Vector2(outer.position.x,outer.end.y),outer.position,Vector2(outer.end.x,outer.position.y)]
		for quadrant in range(4):
			var points := PackedVector2Array([edges[quadrant],corners[quadrant],edges[(quadrant+1)%4]])
			for step in range(25):
				var angle := (float(quadrant+1)-float(step)/24.0)*PI*0.5
				points.append(center+Vector2(cos(angle),sin(angle))*radius)
			scope_mask_parts.append(points)
	for points in scope_mask_parts:
		draw_colored_polygon(points,Color(0.012,0.025,0.028,0.90*opacity))
	draw_arc(center,radius,0,TAU,96,Color(0.04,0.065,0.07,opacity),13,true)
	draw_arc(center,radius-7,0,TAU,96,Color(0.55,0.77,0.78,opacity*0.8),1.5,true)
	# Marks sit on the rim; no filled center/lens, no second camera or viewport.
	for axis in [Vector2.UP,Vector2.DOWN,Vector2.LEFT,Vector2.RIGHT]:
		draw_line(center+axis*(radius-13),center+axis*(radius-5),Color(GOLD,opacity),2,true)

func _spread_brackets(center: Vector2, bounds: Rect2, tint: Color) -> void:
	if bounds.size.length() < 4: return
	var arm := minf(7.0,minf(bounds.size.x,bounds.size.y)*0.275)
	for x in [-1,1]:
		for y in [-1,1]:
			var corner := center+Vector2(bounds.position.x if x<0 else bounds.end.x,bounds.position.y if y<0 else bounds.end.y)
			draw_line(corner,corner-Vector2(x*arm,0),tint,1.25,true)
			draw_line(corner,corner-Vector2(0,y*arm),tint,1.25,true)

func _crosshair(p: Dictionary) -> void:
	if str(p.get("lifeState",""))!="ALIVE":
		return
	var c := Vector2(640,360)
	var id := str(game.current_weapon)
	var gun := AimProfile.is_gun(id) and str(p.get("heldSlot",""))=="weapon"
	var requested := gun and AimProfile.requested_ads(p,bool(game.secondary_held),id)
	var ready := AimProfile.ready(p,requested,id)
	var lens := float(game.view.scope_alpha()) if gun else 0.0
	if gun:
		var definition: Dictionary = game._weapon_config()
		var degrees := AimProfile.spread_degrees(definition,p,requested)
		var viewport := get_viewport_rect().size
		var ui_scale := minf(viewport.x/1280.0,viewport.y/720.0)
		var bounds := AimProfile.spread_bounds(degrees,float(game.pitch),float(game.camera.fov),viewport.y/maxf(0.01,ui_scale))
		_spread_brackets(c,bounds,Color(WHITE,0.72))
		if lens > 0.001:
			var hair := Color(0.05,0.09,0.1,lens)
			for x in [-1,1]: draw_line(c+Vector2(x*5,0),c+Vector2(x*118,0),hair,1.25,true)
			draw_line(c+Vector2(0,-118),c+Vector2(0,-5),hair,1.25,true)
			draw_line(c+Vector2(0,5),c+Vector2(0,33),hair,1.25,true)
		if requested and not ready:
			centered("瞄准中",c+Vector2(0,27 if lens<0.5 else 184),10,GOLD)
	else:
		for axis in [Vector2.UP,Vector2.DOWN,Vector2.LEFT,Vector2.RIGHT]:
			draw_line(c+axis*5,c+axis*9,Color(WHITE,0.7),1.25,true)
	draw_circle(c,1.4,WHITE)
	if float(game.view.hit_time)>0:
		for x in [-1,1]:
			for y in [-1,1]:
				draw_line(c+Vector2(x,y)*5,c+Vector2(x,y)*10,MINT if game.last_hit_killed else GOLD,2,true)
