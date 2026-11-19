extends RefCounted

# The host owns mission progress. This view only presents that progress and
# sends navigation and equipment requests; it never awards items or completes a task.
const STAGES := [
	{"id":"move","title":"入职热身","hint":"走一走，试试 1—4 号物品栏","icon":"boots"},
	{"id":"fish","title":"海边摸鱼","hint":"抛竿、收线，钓上活鱼","icon":"rod"},
	{"id":"search","title":"工位寻宝","hint":"搜索、拾取，再试试回收","icon":"storage"},
	{"id":"fight","title":"怪物演练","hint":"瞄准、射击，试试不同枪械","icon":"weapon"},
	{"id":"base","title":"守护办公室","hint":"修复据点，和队友配合","icon":"core"},
]
const GUNS := ["pistol","smg","carbine","shotgun","rifle","lmg","doublebarrel","dmr"]
const RODS := ["rod_basic","rod_light","rod_pro","rod_heavy","rod_magnet","rod_net"]
const TOOLS := ["bandage","decoy_alarm","repair_kit","coffee_flask","flash_note","folding_cover","tape_trap","scan_note"]
const GUN_HINTS := {"pistol":"单发 · 装填快","smg":"近距快射","carbine":"中距连射","shotgun":"近距散射","rifle":"远距精准","lmg":"持续压制","doublebarrel":"快速两发","dmr":"精准点射"}
const ROD_HINTS := {"rod_basic":"标准手感","rod_light":"快速抛竿","rod_pro":"钓得更远","rod_heavy":"稳住大鱼","rod_magnet":"吸取物资","rod_net":"分段收网"}
const TOOL_HINTS := {"bandage":"恢复生命","decoy_alarm":"引开怪物","repair_kit":"修复建筑","coffee_flask":"恢复体力","flash_note":"闪晕小怪","folding_cover":"临时挡弹","tape_trap":"绊住小怪","scan_note":"标出怪物"}
const PROP_NAMES := {"crate":"快递箱","barrel":"补给桶","barricade":"杂物挡板","partition_panel":"办公隔断","archive_cabinet":"档案柜","copier_shell":"复印机外壳","supply_locker":"返修柜","cable_reel":"绕线盘","punch_clock":"考勤机","notice_board":"公告板"}

var game
var tab := 0
var training_reported := false
var entry_mode := ""
var entry_start := "tutorial"

func setup(owner_game) -> void:
	game = owner_game

func sync_entry_mode() -> void:
	if not OS.has_feature("web") or game.platform_transport == null: return
	if not bool(JavaScriptBridge.eval("typeof window.tidalTransport?.missionMode === 'function'",true)): return
	var value = JSON.parse_string(str(game.platform_transport.missionMode()))
	if value is Dictionary:
		entry_mode = str(value.get("mode",""))
		entry_start = str(value.get("start","tutorial"))

func active() -> bool:
	if not game.state.is_empty():
		var room = game.state.get("room",{})
		return str(game.state.get("mode","")) == "mission" or (room is Dictionary and str(room.get("mode","")) == "mission")
	return entry_mode == "mission"

func data() -> Dictionary:
	var value = game.state.get("mission",{})
	return value if value is Dictionary else {}

func stage_index() -> int:
	var value := data()
	var id := str(value.get("stageId",""))
	for i in range(STAGES.size()):
		if id == str(STAGES[i].id): return i
	return clampi(int(value.get("stage",0)),0,STAGES.size()-1)

func stage() -> Dictionary:
	return STAGES[stage_index()]

func free_play() -> bool:
	return bool(data().get("freePlay",entry_start=="free"))

func completed() -> bool:
	return bool(data().get("completed",false))

func host() -> bool:
	return not game.self_id.is_empty() and str(game.state.get("hostId","")) == game.self_id

func title() -> String:
	if free_play(): return "体验园区"
	if completed(): return "入职完成"
	var value := str(data().get("title",""))
	return value if not value.is_empty() else str(stage().title)

func hint() -> String:
	if free_play(): return "南侧试装备 · 北侧练战斗"
	if completed(): return "想继续练习？打开任务页"
	var value := str(data().get("hint",""))
	return value if not value.is_empty() else str(stage().hint)

func signature() -> Array:
	return [game.state.get("mode"),data(),tab,game.state.get("hostId"),game._equipped("weapon"),game._equipped("rod")]

func tick() -> void:
	if not active() or not completed() or training_reported: return
	if not OS.has_feature("web") or game.platform_transport == null: return
	if not bool(JavaScriptBridge.eval("typeof window.tidalTransport?.trainingComplete === 'function'",true)): return
	training_reported = true
	game.platform_transport.trainingComplete()

func draw_objective(hud) -> void:
	var value := data()
	hud.card(Rect2(18,142,260,88),hud.GOLD,0.94)
	hud.icon("trophy" if free_play() else str(stage().icon),Vector2(38,158),hud.GOLD,0.40)
	hud.text("体验园区 · 自由练习" if free_play() else "入职任务 · %s" % ("完成" if completed() else "%d / %d" % [stage_index()+1,STAGES.size()]),Vector2(52,163),11,hud.GOLD)
	if free_play():
		hud.text("南侧：枪竿与水岸",Vector2(30,188),14,hud.WHITE)
		hud.text("北侧：怪物与拆解",Vector2(30,214),11,hud.MINT)
		return
	hud.text(hud.fitted(title(),236,14),Vector2(30,188),14,hud.WHITE)
	hud.text(hud.fitted(hint(),236,11),Vector2(30,214),11,hud.MINT)
	if not free_play() and not completed() and int(value.get("goal",0))>0:
		hud.bar(Vector2(30,222),236,float(value.get("progress",0))/maxf(1,float(value.get("goal",1))),hud.GOLD,3)

func _control(action: String, definition_id := "") -> void:
	if not active() or data().is_empty(): return
	if action == "free_play" and not host(): return
	var payload := {"action":action}
	if action == "equip": payload.definitionId = definition_id
	game._command("MissionControl","",payload)

func _header() -> void:
	game._compact_row(game.panel_content,"trophy",title(),"和队友一起练习 · 体验物资不保存",game.GOLD)
	game._tabs(game.panel_content,["任务","枪械","鱼竿","道具"],tab,func(index: int): tab=index; game._refresh_panel())

func _park_name(id: String, prop := false) -> String:
	if id.is_empty(): return "待登场"
	if prop: return str(PROP_NAMES.get(id,"待登场"))
	var supplied: String = str(game._name(id))
	return "待登场" if supplied == id or supplied.to_lower() in ["null","<null>"] else supplied

func _park_id(value) -> String:
	return value if value is String else ""

func _park_detail(kind: String) -> String:
	var park = data().get("park",{})
	if not (park is Dictionary): return "走近后自动轮换"
	var prop := kind == "prop"
	var current := _park_id(park.get("propId" if prop else "creatureId",null))
	var next := _park_id(park.get("nextPropId" if prop else "nextCreatureId",null))
	var seen := int(park.get("propSeen" if prop else "creatureSeen",0))
	var total := int(park.get("propTotal" if prop else "creatureTotal",0))
	var progress := " · %d/%d" % [seen,total] if total > 0 else ""
	if current.is_empty():
		return "下一位 %s%s" % [_park_name(next,prop),progress] if not next.is_empty() else "走近后自动轮换"
	return "%s → %s%s" % [_park_name(current,prop),_park_name(next,prop),progress] if not next.is_empty() else "%s%s" % [_park_name(current,prop),progress]

func _park_boss_present() -> bool:
	var park = data().get("park",{})
	return park is Dictionary and str(game._enemy_definition(_park_id(park.get("bossId",null))).get("tier",""))=="boss"

func _park_page() -> void:
	var grid: GridContainer = game._visual_grid(game.panel_content,1 if game.gui.size.x < 880 else 2)
	var places := [
		["weapon","装备展架","南侧 · 8 枪 6 钓具，靠近按 E","training","前往展架",game.GOLD],
		["rod","午休水岸","南侧 · 钓鱼，钓上活鱼再战斗","water","前往水岸",game.MINT],
		["weapon","怪物巡逻","北侧 · 怪物自动轮换","combat","前往巡逻",game.GOLD],
		["storage","拆解练习","北侧 · 打碎后自动换下一件","props","前往拆解",game.MINT],
		["trophy","首领演练","北侧偏西 · 完整招式轮番登场","boss","前往首领",game.GOLD],
	]
	for place in places:
		var destination := str(place[3])
		var detail := str(place[2])
		if destination == "combat": detail = _park_detail("creature")
		if destination == "props": detail = _park_detail("prop")
		if destination == "boss" and _park_boss_present(): detail = game._enemy_name({"definitionId":_park_id(game.state.get("mission",{}).get("park",{}).get("bossId",null))})+" · 已登场"
		var row: HBoxContainer = game._compact_row(game.panel_content if destination == "boss" else grid,str(place[0]),str(place[1]),detail,place[5])
		var button: Button = game._system_button(row,str(place[4]),func(): _control(destination),destination == "training")
		button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		button.tooltip_text = str(place[2])

func _task_page() -> void:
	if data().is_empty():
		game._text(game.panel_content,"正在同步任务，稍等一下…",14,game.MINT)
		return
	if free_play():
		_park_page()
		return
	var current := stage_index()
	var completed_ids = data().get("completedStages",[])
	for i in range(STAGES.size()):
		var entry: Dictionary = STAGES[i]
		var selected := i == current and not completed()
		var done: bool = completed() or (completed_ids is Array and completed_ids.has(str(entry.id)))
		var prefix := "进行中 · " if selected else "已完成 · " if done else "未开始 · "
		game._compact_row(game.panel_content,str(entry.icon),prefix+str(entry.title),str(entry.hint),game.GOLD if selected else game.MINT)
	game._text(game.panel_content,"按提示完成任务，之后可自由试用。",12,game.MINT)

func _equipment_page(ids: Array, hints: Dictionary) -> void:
	if data().is_empty():
		game._text(game.panel_content,"正在同步任务，稍等一下…",14,game.MINT)
		return
	var grid: GridContainer = game._visual_grid(game.panel_content,2)
	for id in ids:
		var definition_id := str(id)
		var row: HBoxContainer = game._compact_row(grid,definition_id,game._name(definition_id),str(hints.get(definition_id,"随时试用")))
		var button: Button = game._system_button(row,"试用",func(): _control("equip",definition_id),true)
		button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var requires_stand := free_play() and (definition_id in GUNS or definition_id in RODS)
		var near_stand := not requires_stand
		if requires_stand:
			for display in game.state.get("world",{}).get("terminals",[]):
				if str(display.get("type","")) != "training" or str(display.get("definitionId","")) != definition_id: continue
				var delta: Vector3 = game._v(display)-game._v(game.player)
				near_stand = Vector2(delta.x,delta.z).length() <= float(game.config.player.interact_distance)
				break
		button.disabled = not near_stand
		button.tooltip_text = "走近对应展架，按 E 直接领取" if requires_stand and not near_stand else "领取本局试用物品"
	game._text(game.panel_content,"道具随时试用，不带进冒险。" if ids == TOOLS and free_play() else "走近展架按 E 领取；弹药无限，按 R 换弹。" if free_play() else "每次领一件，背包不会被一次塞满。",12,game.MINT)
	if free_play() and ids != TOOLS:
		var item: Dictionary = game._equipped("weapon" if ids == GUNS else "rod")
		if item.is_empty() or item.get("loanOwnerSlotId") == null: return
		for module in game.catalog.get("crafting",{}).get("modules",[]):
			if str(module.definitionId) != str(item.definitionId): continue
			var card: VBoxContainer = game._visual_card(game.panel_content,str(item.definitionId),game._name(str(item.definitionId))+" · "+str(module.name),str(module.description),game.GOLD)
			var near := false
			for display in game.state.get("world",{}).get("terminals",[]):
				if str(display.get("type","")) == "training" and str(display.get("definitionId","")) == str(item.definitionId):
					var delta: Vector3 = game._v(display)-game._v(game.player)
					near=Vector2(delta.x,delta.z).length()<=float(game.config.player.interact_distance)
			var actions := HBoxContainer.new()
			actions.add_theme_constant_override("separation",8)
			card.add_child(actions)
			var installed: bool = str(item.get("moduleId","")) == str(module.id)
			var prototype: Button = game._button(actions,"原型",func(): game.CraftingUI._send(game,"TrialModule",{"itemId":str(item.id),"moduleId":null},int(item.revision)),not installed)
			var trial: Button = game._button(actions,"试用核心",func(): game.CraftingUI._send(game,"TrialModule",{"itemId":str(item.id),"moduleId":str(module.id)},int(item.revision)),installed)
			game._action_state(prototype,"靠近展架" if not near else "已是原型" if game.CraftingUI.fitting_id(item,"moduleId").is_empty() else "","恢复原型，弹匣不重置")
			game._action_state(trial,"靠近展架" if not near else "已经装上" if installed else "","免费对比，退出不保存")
		var near := false
		for display in game.state.get("world",{}).get("terminals",[]):
			if str(display.get("type",""))=="training" and str(display.get("definitionId",""))==str(item.definitionId):
				var offset: Vector3 = game._v(display)-game._v(game.player)
				near=Vector2(offset.x,offset.z).length()<=float(game.config.player.interact_distance)
		game._text(game.panel_content,"附件对比 · 靠近同一展架",14,game.MINT)
		var fitting_grid: GridContainer = game._visual_grid(game.panel_content,2)
		for fitting in game.catalog.get("crafting",{}).get("attachments",[]):
			if str(fitting.kind)!=("weapon" if ids==GUNS else "rod"): continue
			var card: VBoxContainer = game._visual_card(fitting_grid,str(item.definitionId),str(fitting.name),str(fitting.description)+" · "+str(fitting.tradeoff),game.MINT)
			var installed: bool = str(item.get("attachmentId",""))==str(fitting.id)
			var trial: Button = game._button(card,"取下附件" if installed else "试用附件",func(): game.CraftingUI._send(game,"TrialAttachment",{"itemId":str(item.id),"attachmentId":null if installed else str(fitting.id)},int(item.revision)),not installed)
			game._action_state(trial,"靠近展架" if not near else "","不消耗部件，退出不保存")
		if game.CraftingUI.is_pending(game):
			for control in game.panel_content.find_children("*","Button",true,false):
				if control.text in ["试用核心","原型","试用附件","取下附件"]: game._action_state(control,"处理中","等待主机确认")

func panel() -> void:
	_header()
	match tab:
		0: _task_page()
		1: _equipment_page(GUNS,GUN_HINTS)
		2: _equipment_page(RODS,ROD_HINTS)
		3: _equipment_page(TOOLS,TOOL_HINTS)
	if data().is_empty(): return
	game.panel_footer.visible = true
	game.panel_footer.add_child(HSeparator.new())
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation",8)
	game.panel_footer.add_child(actions)
	var note: Label = game._text(actions,"退出后不保存",12,game.MINT)
	note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	note.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	game._system_button(actions,"补给",func(): _control("refill"))
	if not free_play():
		var free: Button = game._system_button(actions,"自由试用",func(): _control("free_play"),true)
		free.disabled = not host()
	game._nav_button(actions,"返回大厅",game._leave).tooltip_text = "返回大厅；任务物资不会保存"
