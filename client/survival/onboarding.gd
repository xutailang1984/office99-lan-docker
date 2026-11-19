extends RefCounted

const STEPS := [
	{"title":"入职打卡","icon":"boots","action":"WASD 走动，鼠标看看四周","hint":"走 6 米，再转个身","keys":["WASD","鼠标"],"detail":"欢迎加入夜班小队！\n先走走看看，Shift 快跑，空格跳起。"},
	{"title":"装备上手","icon":"weapon","action":"试着切换 2、3、4","hint":"2 鱼竿 · 3 近战 · 4 道具","keys":["1","2","3","4"],"detail":"1 用枪，2 摸鱼，3 近战，4 用道具。\n左键使用；空手也能挥拳。\n枪械右键瞄准，R 换弹。"},
	{"title":"随身背包","icon":"backpack","action":"按 Tab，看看带了什么","hint":"带好工具，再出门","keys":["Tab"],"detail":"这里放随身物品，也能换装备。\n把道具装入第 4 格，就能快捷使用。\n买卖和仓储，要到对应工位。"},
	{"title":"摸鱼时间","icon":"rod","action":"到水边，按 2 拿出鱼竿","hint":"按住左键蓄力，松开抛竿","keys":["2","左键"],"detail":"所有海水都能钓。\n咬钩时按左键，按住收线。\n张力太高就松手，慢慢把鱼拉上岸！"},
	{"title":"收获到账","icon":"melee","action":"攻击鱼怪，再拿起物资","hint":"3 近战 · 左键攻击 · E 查看","keys":["3","左键","E"],"detail":"鱼上岸后也会反击！\n击败它，按 E 查看掉落，再拿起。\n可和同事合作，也能拿其他战利品。"},
	{"title":"认识工位","icon":"storage","action":"走到四类工位，按 E 查看","hint":"买、存、升级、卖，各有工位","keys":["E"],"detail":"补给台买工具，储物柜存东西。\n升级台强化武器，回收台卖物品。\n这里只参观，不用花钱。"},
	{"title":"今日任务","icon":"trophy","action":"按 C，看看任务和能力","hint":"摸鱼稳一些，外勤收益更高","keys":["C"],"detail":"去旧工位搜索，按住 E 完成工作。\n那里物资多，怪物也更凶。\n完成挑战或守夜后，可选择新能力。"},
	{"title":"守护同事","icon":"core","action":"回到协作灯旁，按 F 查看","hint":"守住灯，和同事一起过夜","keys":["F","E"],"detail":"对准灯、墙或门，F 选修复 / 加固，按住 E 施工。\n夜里守住灯；靠近倒地同事，按住 E 救援。\n随身物品会掉落，贵重物先存柜。"}
]
const CHECKS := [["move","look"],["rod","melee","quick"],["inventory"],["landed"],["hit","pickup"],["store","storage","upgrade","recycle"],["rewards"],["building"]]
const STATION_NAMES := {"store":"补给台","storage":"储物柜","upgrade":"升级台","recycle":"回收台"}
var game
var record: Dictionary = {"version":2,"status":"pending","step":0,"revision":0,"checks":[]}
var marks: Dictionary = {}
var booted := false
var pending := false
var save_error := ""
var preview := -1
var walked := 0.0
var previous_position := Vector3.ZERO
var previous_yaw := 0.0
var looked := 0.0
var baseline_ready := false
var last_move_input_at := -100.0
var suspended := false
var welcome_needed := false
var next_retry_at := 0.0
var retry_count := 0
var retry_action := ""

func setup(owner_game) -> void:
	game = owner_game

func active() -> bool:
	return str(record.get("status","pending")) == "active"

func step() -> int:
	return clampi(int(record.get("step",0)),0,8)

func paused() -> bool:
	return not game.joined or game.player.is_empty() or str(game.player.get("lifeState","")) != "ALIVE" or str(game.state.get("phase","")) not in ["PREP","DAY"]

func _bridge_available() -> bool:
	return OS.has_feature("web") and game.platform_transport != null and bool(JavaScriptBridge.eval("typeof window.tidalTransport?.guideState === 'function'",true))

func sync(error := "") -> bool:
	if not _bridge_available(): return false
	var value = JSON.parse_string(str(game.platform_transport.guideState()))
	if not value is Dictionary or int(value.get("version",0)) != 2: return false
	apply_record(value,error)
	return true

func apply_record(value: Dictionary, error := "") -> void:
	if int(value.get("version",0)) != 2 or str(value.get("status","")) not in ["pending","active","done","paused"]: return
	if int(value.get("step",-1)) < 0 or int(value.get("step",-1)) > 8 or not value.get("checks",[]) is Array: return
	if int(value.get("revision",-1)) < int(record.get("revision",0)): return
	var changed := int(value.get("step",0)) != step() or str(value.status) != str(record.status)
	var finished := str(value.status) == "done" and str(record.status) != "done"
	record = value.duplicate(true)
	pending = false
	save_error = error
	if error.is_empty():
		retry_count = 0
		retry_action = ""
	else:
		retry_count += 1
		next_retry_at = game.elapsed + minf(30.0,pow(2.0,mini(retry_count,5)))
	if changed:
		marks.clear()
		walked = 0.0
		looked = 0.0
		baseline_ready = false
		last_move_input_at = -100.0
		preview = -1
	for key in record.get("checks",[]): marks[str(key)] = true
	if finished: game._toast("入职完成！今晚一起守灯。",4)
	game.last_panel_signature = ""

func _request(action: String, extra := {}) -> void:
	if pending: return
	if action == "restart":
		suspended = false
		welcome_needed = false
		marks.clear()
		walked=0.0
		looked=0.0
		baseline_ready=false
		last_move_input_at=-100.0
		preview=-1
	var message: Dictionary = {"version":2,"action":action,"revision":int(record.get("revision",0))}
	message.merge(extra)
	if action in ["pause","restart"]: retry_action = action
	save_error = ""
	if _bridge_available():
		pending = true
		game.platform_transport.guideUpdate(JSON.stringify(message))
	else:
		# Standalone development clients have no platform account. This fallback
		# stays in memory and never creates or modifies an adventure save.
		var next := record.duplicate(true)
		next.revision = int(next.revision)+1
		match action:
			"restart": next.status="active"; next.step=0; next.checks=[]
			"begin": next.status="active"
			"check": next.checks=marks.keys()
			"advance":
				if not CHECKS[step()].all(func(key): return record.get("checks",[]).has(key)): return
				next.step=step()+1; next.status="done" if int(next.step)==8 else "active"; next.checks=[]
			"pause": next.status="paused"
		apply_record(next)

func movement_input() -> void:
	if active() and step()==0 and not paused() and game.move_direction.length()>0.1:
		last_move_input_at = game.elapsed

func tick() -> void:
	if not booted:
		if not game.joined or game.player.is_empty(): return
		if game.platform_transport != null and (not game.platform_game_entered or game.elapsed < game.platform_input_after): return
		if game.platform_transport != null and not sync(): return
		booted = true
		welcome_needed = str(record.status) == "pending"
	if not pending and not retry_action.is_empty() and not save_error.is_empty() and game.elapsed >= next_retry_at:
		_request(retry_action)
	if not pending and not suspended and game.elapsed >= next_retry_at and str(record.status) in ["pending","paused"]:
		_request("begin")
	# A first visit gets a clear, dismissible entry into the handbook. Never
	# interrupt a fight, respawn, chat, or a menu the player has already opened.
	if welcome_needed and active() and not paused() and game.overlay.is_empty():
		welcome_needed = false
		game._open_panel("onboarding")
	if not active() or paused() or suspended:
		baseline_ready = false
		last_move_input_at = -100.0
		return
	var position: Vector3 = game._v(game.player)
	var current_yaw: float = game.yaw
	if not baseline_ready:
		previous_position = position
		previous_yaw = current_yaw
		baseline_ready = true
	if game.overlay.is_empty():
		if step() == 0:
			var distance: float = Vector2(position.x-previous_position.x,position.z-previous_position.z).length()
			# Acknowledged motion often arrives after key-up. Remember the input
			# actually sent, while respawns and large corrections reset the baseline.
			var moved_by_input: bool = last_move_input_at>=0 and (game.elapsed-last_move_input_at<1.0 or float(game.player.get("moveSpeed",0))>0.1)
			if moved_by_input and distance<2.0: walked += distance
			looked += minf(absf(angle_difference(previous_yaw,current_yaw)),0.5)
			if walked >= 6.0: _mark("move")
			if looked >= 0.65: _mark("look")
		elif step() == 1: _mark(str(game.player.get("heldSlot","")))
	previous_position = position
	previous_yaw = current_yaw
	_flush()

func _mark(key: String) -> void:
	if active() and not paused() and CHECKS[step()].has(key): marks[key]=true

func _flush() -> void:
	if not active() or pending or paused() or suspended or game.elapsed < next_retry_at: return
	var unsaved: Array = []
	for key in marks:
		if not record.get("checks",[]).has(key): unsaved.append(key)
	if not unsaved.is_empty(): _request("check",{"checks":unsaved})
	elif CHECKS[step()].all(func(key): return marks.has(key)):
		_request("advance",{"step":step()+1})

func panel_opened(mode: String) -> void:
	if not active() or paused(): return
	if step()==2 and mode=="inventory": _mark("inventory")
	elif step()==5 and STATION_NAMES.has(mode) and game._station_reason(game._panel_station_type(mode)).is_empty(): _mark(mode)
	elif step()==6 and mode=="rewards": _mark("rewards")
	elif step()==7 and mode=="building" and str(game.target.get("id",""))=="core": _mark("building")
	_flush()

func result(command: String, message: Dictionary) -> void:
	if bool(message.get("ok",false)) and step()==4 and command=="Pickup": _mark("pickup")

func event(kind: String, payload: Dictionary, actor_id: String) -> void:
	if actor_id != game.self_id: return
	if step()==3 and kind=="FishingChanged" and str(payload.get("state",""))=="LANDED" and str(payload.get("catch_kind","creature"))!="salvage": _mark("landed")
	elif step()==4 and kind=="Hit" and float(payload.get("damage",0))>0: _mark("hit")

func _hint() -> String:
	if pending: return "正在记入入职手册…"
	if not save_error.is_empty(): return "进度未保存 · 正在重试"
	match step():
		0: return ("走动 ✓" if marks.has("move") else "走动 %d / 6米" % mini(6,int(walked))) + (" · 转身 ✓" if marks.has("look") else " · 看看四周")
		1: return "2 %s  3 %s  4 %s" % ["✓" if marks.has("rod") else "鱼竿","✓" if marks.has("melee") else "近战","✓" if marks.has("quick") else "道具"]
		3:
			if str(game._equipped("rod").get("definitionId",""))=="rod_magnet": return "这一步先换普通鱼竿 · Tab 装备"
			var fishing = game.player.get("fishing")
			if fishing is Dictionary:
				return game.FishingPresentation.cue_hint(fishing)
			return "近岸水塘  "+game._waypoint(Vector3(-36,5,0))
		4: return ("攻击 ✓" if marks.has("hit") else "左键攻击")+(" · 拾取 ✓" if marks.has("pickup") else " · E 查看掉落")
		5:
			for key in CHECKS[5]:
				if not marks.has(key):
					var terminal: Dictionary = game._nearest_terminal(game._panel_station_type(key))
					return str(STATION_NAMES[key])+"  "+game._waypoint(game._v(terminal)) if not terminal.is_empty() else "找到"+str(STATION_NAMES[key])
		7: return "协作灯  "+game._waypoint(game._v(game._find(game.state.get("buildings",[]),"core")))
	return str(STEPS[mini(step(),7)].hint)

func draw_objective(hud) -> bool:
	if not booted or str(record.status)=="done" or paused(): return false
	var data: Dictionary = STEPS[mini(step(),7)]
	hud.card(Rect2(18,142,260,88),hud.GOLD,0.96)
	hud.icon(str(data.icon),Vector2(38,158),hud.GOLD,0.40)
	hud.text("新人入职  %d / 8" % (step()+1),Vector2(52,163),11,hud.GOLD)
	hud.text("Esc 教程",Vector2(208,163),10,hud.MUTED)
	var action_text := str(data.action)
	var hint_text := _hint()
	if suspended or str(record.status)=="paused":
		action_text = "入职暂缓，下次接着学"
		hint_text = "Esc → 教程，随时继续"
	elif str(record.status)=="pending":
		action_text = "欢迎加入夜班小队！"
		hint_text = "正在准备引导…" if save_error.is_empty() else "连接恢复后自动开始"
	hud.text(hud.fitted(action_text,236,13),Vector2(30,187),13,hud.WHITE)
	hud.text(hud.fitted(hint_text,236,12),Vector2(30,215),12,hud.MINT)
	return true

func waiting_label() -> String:
	if not booted or str(record.status)=="done" or not paused(): return ""
	return "新人入职 %d/8 · " % (mini(step(),7)+1) + ("恢复后继续" if str(game.player.get("lifeState",""))!="ALIVE" else "安全后继续")

func signature() -> Array:
	return [record,pending,save_error,preview,paused(),suspended]

func diagnostics() -> Dictionary:
	return {"version":record.version,"status":record.status,"step":step(),"checks":record.get("checks",[]),"pending":pending,"paused":paused(),"suspended":suspended,"booted":booted,"welcomeNeeded":welcome_needed,"saveError":not save_error.is_empty()}

func _continue() -> void:
	save_error = ""
	suspended = false
	welcome_needed = false
	retry_action = ""
	retry_count = 0
	next_retry_at = 0.0
	if not active(): _request("restart" if str(record.status)=="done" else "begin")
	game._resume()

func _pause_learning() -> void:
	suspended = true
	welcome_needed = false
	_request("pause")
	game._resume()

func panel() -> void:
	var index := preview if preview>=0 else mini(step(),7)
	var data: Dictionary = STEPS[index]
	var wide: bool = game.get_viewport().get_visible_rect().size.x>=760
	var layout = HBoxContainer.new() if wide else VBoxContainer.new()
	layout.add_theme_constant_override("separation",20)
	game.panel_content.add_child(layout)
	if wide:
		var list: VBoxContainer = game._column(layout,3)
		for i in range(8):
			var item_index := i
			var button: Button = game._nav_button(list,str(STEPS[i].title),func(): preview=item_index; game._refresh_panel(),i==index)
			button.tooltip_text = ("已完成 · " if i<step() else "")+str(STEPS[i].hint)
	else:
		var select := OptionButton.new()
		select.custom_minimum_size.y=40
		for i in range(8): select.add_item("%d · %s" % [i+1,str(STEPS[i].title)])
		select.select(index)
		select.item_selected.connect(func(value: int): preview=value; game._refresh_panel())
		layout.add_child(select)
	var details: VBoxContainer = game._column(layout,14)
	details.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	game._compact_row(details,str(data.icon),str(data.title),"第 %d 项 · 共 8 项" % (index+1),game.GOLD)
	var key_row := HFlowContainer.new()
	key_row.add_theme_constant_override("h_separation",8)
	details.add_child(key_row)
	for key in data.get("keys",[]):
		var cap := PanelContainer.new()
		cap.custom_minimum_size=Vector2(48,40)
		cap.add_theme_stylebox_override("panel",game._style(Color("264550"),6))
		key_row.add_child(cap)
		var label: Label=game._text(cap,str(key),15,game.GOLD)
		label.horizontal_alignment=HORIZONTAL_ALIGNMENT_CENTER
		label.vertical_alignment=VERTICAL_ALIGNMENT_CENTER
	var description: Label = game._text(details,str(data.detail),16)
	description.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	if index==5:
		for key in CHECKS[5]:
			game._text(details,("✓ " if step()>5 or (step()==5 and marks.has(key)) else "○ ")+str(STATION_NAMES[key]),14,game.MINT)
	var note := "入职完成，随时可以再练一次。" if str(record.status)=="done" else "夜袭、涨潮或倒地时先保命，安全后接着学。" if paused() else "完成 8 项就能毕业；暂缓后下次接着学。"
	var note_label: Label=game._text(details,note,13,game.MINT)
	note_label.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	if not save_error.is_empty():
		var error_label: Label=game._text(details,save_error,13,game.GOLD)
		error_label.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation",8)
	actions.add_theme_constant_override("v_separation",8)
	details.add_child(actions)
	var play: Button=game._system_button(actions,"继续引导" if active() else "开始引导",_continue,true)
	play.disabled=pending
	if active():
		var skip: Button=game._nav_button(actions,"稍后再学",_pause_learning)
		skip.disabled=pending
		var restart: Button=game._nav_button(actions,"重新开始",func(): _request("restart"); game._resume())
		restart.disabled=pending
