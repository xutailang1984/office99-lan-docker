extends RefCounted

# The shared menu owns its outside rectangle and scrolling. This module only
# builds the content of the G page and sends normal authoritative commands.
var game
var selected_target := ""
var selected_stamp := "thanks"
var selected_tab := 0

class SocialIcon extends Control:
	var kind := "airplane"
	func _draw() -> void:
		var pale := Color("eee8d5")
		var gold := Color("ecc15d")
		var mint := Color("84d7bc")
		match kind:
			"coffee":
				draw_style_box(_style(Color("ba7b48")),Rect2(14,21,28,29))
				draw_arc(Vector2(43,32),8,-PI/2,PI/2,12,gold,3,true)
				draw_line(Vector2(20,15),Vector2(18,7),pale,2,true)
				draw_line(Vector2(32,15),Vector2(30,7),pale,2,true)
			"highfive":
				draw_style_box(_style(gold),Rect2(20,24,21,25))
				for index in range(4): draw_line(Vector2(22+index*6,25),Vector2(22+index*6,9+index%2*3),gold,4,true)
				draw_line(Vector2(20,34),Vector2(10,25),gold,6,true)
				draw_line(Vector2(44,19),Vector2(51,12),mint,2,true)
			"airplane":
				draw_colored_polygon(PackedVector2Array([Vector2(5,24),Vector2(54,9),Vector2(34,50),Vector2(27,31)]),pale)
				draw_line(Vector2(27,31),Vector2(54,9),mint,2,true)
			"paperball":
				draw_circle(Vector2(29,28),19,pale)
				draw_polyline(PackedVector2Array([Vector2(19,15),Vector2(24,26),Vector2(14,31),Vector2(30,38),Vector2(39,27),Vector2(31,19)]),Color("a6bbb5"),2,true)
			"stamp":
				draw_style_box(_style(mint),Rect2(12,34,36,12))
				draw_style_box(_style(gold),Rect2(23,18,15,19))
				draw_circle(Vector2(30,15),10,gold)
			"box_hat":
				draw_style_box(_style(Color("c79556")),Rect2(9,17,42,31))
				draw_line(Vector2(17,25),Vector2(43,25),pale,3,true)
				draw_line(Vector2(30,17),Vector2(30,46),Color("a57444"),2,true)
			"duck":
				draw_circle(Vector2(25,36),17,gold)
				draw_circle(Vector2(38,19),12,gold)
				draw_colored_polygon(PackedVector2Array([Vector2(46,19),Vector2(58,23),Vector2(46,26)]),Color("ef9853"))
				draw_circle(Vector2(41,16),2,Color("193741"))
			"cupStack", "cup_trophy":
				for row in range(3):
					for col in range(3-row):draw_style_box(_style(pale if row%2==0 else gold),Rect2(10+row*7+col*14,43-row*14,12,12))
			"groupPose", "portrait_badge":
				draw_style_box(_style(mint),Rect2(10,10,40,43))
				draw_circle(Vector2(30,25),8,pale)
				draw_style_box(_style(gold),Rect2(19,36,22,11))
			"noteChain", "message_flower":
				for index in range(5):draw_circle(Vector2(30,28)+Vector2(cos(index*TAU/5),sin(index*TAU/5))*14,8,mint if index%2==0 else gold)
				draw_circle(Vector2(30,28),7,pale)
			"field_postcard":
				draw_style_box(_style(pale),Rect2(6,16,48,31))
				draw_colored_polygon(PackedVector2Array([Vector2(10,40),Vector2(22,22),Vector2(33,40)]),mint)
				draw_style_box(_style(gold),Rect2(40,20,9,9))
			"salvage_bottle":
				draw_style_box(_style(gold),Rect2(24,7,12,9))
				draw_style_box(_style(mint),Rect2(20,16,20,7))
				draw_style_box(_style(mint),Rect2(13,23,34,29))
				draw_style_box(_style(pale),Rect2(18,29,24,15))
			"night_lantern":
				draw_arc(Vector2(30,17),10,PI,TAU,10,pale,3,true)
				draw_style_box(_style(gold),Rect2(15,20,30,26))
				draw_style_box(_style(pale),Rect2(23,24,14,18))
				draw_line(Vector2(14,49),Vector2(46,49),mint,4,true)
	func _style(color: Color) -> StyleBoxFlat:
		var value := StyleBoxFlat.new()
		value.bg_color=color
		value.set_corner_radius_all(3)
		return value

func setup(value) -> void:
	game=value

func _social() -> Dictionary:
	return game.state.get("social",{})

func _prefs(player_id := "") -> Dictionary:
	var id: String = str(game.player.get("id","")) if player_id.is_empty() else player_id
	for row in _social().get("playerStates",[]):
		if str(row.get("playerId",""))==id: return row
	return {"participating":false,"hat":false,"unlocked":[]}

func _players() -> Array:
	var result: Array = []
	for member in game.state.get("players",[]):
		if str(member.get("id",""))==str(game.player.get("id","")) or not bool(member.get("connected",false)) or str(member.get("lifeState",""))!="ALIVE": continue
		if game._v(member).distance_to(game._v(game.player))<=8.0: result.append(member)
	return result

func _target() -> Dictionary:
	for member in _players():
		if str(member.id)==selected_target: return member
	return {}

func _reason() -> String:
	if str(game.player.get("lifeState",""))!="ALIVE": return "先站起来再玩"
	if bool(_social().get("paused",false)): return "守夜时先收起玩具"
	if bool(game.player.get("swimming",false)): return "上岸后再玩"
	if game.player.get("work")!=null or game.player.get("fishing")!=null or game.player.get("reload")!=null or game.player.get("carryingId")!=null: return "先完成手上的事"
	return ""

func signature() -> Array:
	var peers: Array = []
	for member in _players(): peers.append([member.id,member.get("name",""),game._v(member).distance_to(game._v(game.player))<=3])
	var planes: Array = []
	for plane in _social().get("planes",[]): planes.append([plane.id,plane.get("landed",false),game._v(plane.get("to",{})).distance_to(game._v(game.player))<=3])
	return [selected_tab,_social().get("offers",[]),_social().get("activities",[]),_social().get("displays",[]),_social().get("playerStates",[]),_social().get("paused",false),peers,planes,game._item_count("coffee_flask"),_reason()]

func refresh() -> void:
	if str(game.overlay)=="social": game._refresh_panel()

func _send(action: String, payload: Dictionary = {}, target := "", resume := false) -> void:
	var value := payload.duplicate()
	value.action=action
	game._command("Social",target,value)
	if resume: game._resume()

func _button(parent: Node, label: String, callback: Callable, reason := "", primary := false) -> Button:
	var button: Button = game._button(parent,label,callback,primary)
	game._action_state(button,reason,label)
	return button

func _tile(parent: Node, kind: String, title: String, caption: String) -> VBoxContainer:
	var card := PanelContainer.new()
	card.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	card.custom_minimum_size.y=144
	card.add_theme_stylebox_override("panel",game._style(Color("142e38"),6))
	parent.add_child(card)
	var column: VBoxContainer = game._column(card,8)
	var row := HBoxContainer.new()
	column.add_child(row)
	var icon := SocialIcon.new()
	icon.kind=kind
	icon.custom_minimum_size=Vector2(60,60)
	icon.mouse_filter=Control.MOUSE_FILTER_IGNORE
	row.add_child(icon)
	var details: VBoxContainer = game._column(row,5)
	details.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	game._text(details,title,17,game.GOLD)
	var copy: Label = game._text(details,caption,13,game.CREAM)
	copy.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	copy.custom_minimum_size=Vector2(240,36)
	copy.max_lines_visible=2
	copy.tooltip_text=caption
	return column

func _actions(column: Node) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation",8)
	column.add_child(row)
	return row

func build(parent: Node) -> void:
	if game==null: return
	var tabs:=TabBar.new()
	tabs.name="SocialTabs"
	tabs.add_tab("嬉戏")
	tabs.add_tab("收藏")
	tabs.current_tab=selected_tab
	tabs.add_theme_font_override("font",game.FONT)
	tabs.add_theme_font_size_override("font_size",16)
	tabs.tab_changed.connect(func(value: int): selected_tab=value;refresh())
	parent.add_child(tabs)
	if selected_tab==1:
		_collection(parent)
		return
	var reason := _reason()
	var prefs := _prefs()
	var players := _players()
	if not selected_target.is_empty() and not players.any(func(row): return str(row.id)==selected_target): selected_target=""
	var heading := HBoxContainer.new()
	heading.add_theme_constant_override("separation",12)
	parent.add_child(heading)
	var tip: Label = game._text(heading,"G 打开嬉戏 · 免费玩具不占背包",14,game.MINT)
	tip.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	var participating: bool = bool(prefs.get("participating",false))
	_button(heading,"退出嬉戏" if participating else "加入嬉戏",func(): game._command("SocialSettings","",{"participating":not participating}),"",not participating)
	var reason_label: Label=game._text(parent,reason if not reason.is_empty() else "纸团只会碰到主动加入的同事。",13,game.GOLD if not reason.is_empty() else game.CREAM)
	reason_label.custom_minimum_size.y=22
	var peer_row := HBoxContainer.new()
	parent.add_child(peer_row)
	game._text(peer_row,"互动对象",14,game.CREAM)
	var choice := OptionButton.new()
	choice.name="SocialPeerChoice"
	choice.custom_minimum_size=Vector2(230,40)
	choice.add_theme_font_override("font",game.FONT)
	choice.add_theme_font_size_override("font_size",15)
	choice.add_item("自己练习")
	var selected := 0
	for index in range(players.size()):
		choice.add_item(str(players[index].get("name","同事")).left(18))
		if str(players[index].id)==selected_target: selected=index+1
	choice.select(selected)
	choice.item_selected.connect(func(index: int): selected_target="" if index==0 else str(players[index-1].id);refresh())
	peer_row.add_child(choice)
	var target := _target()
	var close: bool = not target.is_empty() and game._v(target).distance_to(game._v(game.player))<=3.0
	var incoming: Array = _social().get("offers",[]).filter(func(offer): return str(offer.get("toId",""))==str(game.player.get("id","")))
	var invite_slot:=ScrollContainer.new()
	invite_slot.name="SocialInviteSlot"
	invite_slot.custom_minimum_size.y=48
	invite_slot.size_flags_vertical=Control.SIZE_SHRINK_BEGIN
	invite_slot.horizontal_scroll_mode=ScrollContainer.SCROLL_MODE_DISABLED
	parent.add_child(invite_slot)
	var invite_list:=VBoxContainer.new()
	invite_list.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	invite_slot.add_child(invite_list)
	if incoming.is_empty():game._text(invite_list,"暂无邀请",13,game.MINT)
	for offer in incoming:
		var sender: Dictionary = game._find(game.state.get("players",[]),str(offer.fromId))
		var row := HBoxContainer.new()
		row.set_meta("focus_scope",str(offer.id))
		invite_list.add_child(row)
		var label: Label = game._text(row,str(sender.get("name","同事"))+ ("递来咖啡" if str(offer.kind)=="coffee" else "邀请合照" if str(offer.kind)=="pose" else "邀请击掌"),14,game.GOLD)
		label.size_flags_horizontal=Control.SIZE_EXPAND_FILL
		label.clip_text=true
		_button(row,"接过" if str(offer.kind)=="coffee" else "合照" if str(offer.kind)=="pose" else "击掌",func(): _send("accept",{"offerId":str(offer.id)}),reason,true)
		_button(row,"谢绝",func(): _send("decline",{"offerId":str(offer.id)}))
	var grid := GridContainer.new()
	grid.columns=2
	grid.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	grid.add_theme_constant_override("h_separation",12)
	grid.add_theme_constant_override("v_separation",12)
	parent.add_child(grid)
	var coffee := _tile(grid,"coffee","递咖啡","递出背包里的一杯。对方接过后才转移。")
	var coffee_reason := reason if not reason.is_empty() else "先选择近处的同事" if not close else "背包里没有咖啡" if game._item_count("coffee_flask")<=0 else ""
	_button(_actions(coffee),"递出咖啡",func(): _send("offerCoffee",{},selected_target),coffee_reason,true)
	var five := _tile(grid,"highfive","击掌","庆祝一下！没有同事回应，也能挥手。")
	_button(_actions(five),"挥手" if target.is_empty() else "邀请击掌",func(): _send("highFive",{},selected_target,true),reason if not reason.is_empty() else "靠近同事再邀请" if not target.is_empty() and not close else "")
	var plane := _tile(grid,"airplane","纸飞机","沿当前方向投出。靠近落地的飞机可以接力。")
	var plane_actions := _actions(plane)
	_button(plane_actions,"短投",func(): _send("airplane",{"power":.45},"",true),reason)
	_button(plane_actions,"远投",func(): _send("airplane",{"power":1.0},"",true),reason)
	var relay_id := ""
	for value in _social().get("planes",[]):
		if bool(value.get("landed",false)) and game._v(value.get("to",{})).distance_to(game._v(game.player))<=3:
			relay_id=str(value.id);break
	_button(plane_actions,"接力",func(): _send("relayPlane",{"planeId":relay_id,"power":.65},"",true),reason if not reason.is_empty() else "靠近落地的飞机" if relay_id.is_empty() else "")
	var ball := _tile(grid,"paperball","玩具纸团","加入后一起玩。也可以把纸团投进纸篓。")
	var ball_actions := _actions(ball)
	var ball_reason := reason if not reason.is_empty() else "先加入嬉戏" if not participating else ""
	var target_reason := ball_reason if not ball_reason.is_empty() else "先选择同事" if target.is_empty() else "对方还没加入嬉戏" if not bool(_prefs(selected_target).get("participating",false)) else ""
	_button(ball_actions,"投掷纸团",func(): _send("paperBall",{},selected_target,true),target_reason)
	var bin: Dictionary = _social().get("targets",{}).get("paperBin",{})
	_button(ball_actions,"投进纸篓",func(): _send("paperBall",{"x":float(bin.get("x",0)),"z":float(bin.get("z",0))},"",true),ball_reason if not ball_reason.is_empty() else "靠近办公室的纸篓" if bin.is_empty() or game._v(bin).distance_to(game._v(game.player))>8 else "")
	var stamp := _tile(grid,"stamp","趣味印章","在前方留个图案。最多两枚，过一会儿消失。")
	var stamp_actions := _actions(stamp)
	for value in [{"id":"thanks","name":"谢谢"},{"id":"help","name":"帮忙"},{"id":"cheer","name":"加油"}]:
		_button(stamp_actions,str(value.name),func(): _send("stamp",{"stampId":str(value.id),"power":.3},"",true),reason)
	for activity_type in ["cupStack","noteChain"]:
		var current: Dictionary={}
		for value in _social().get("activities",[]):
			if str(value.kind)==activity_type and game._v(value).distance_to(game._v(game.player))<=3:current=value;break
		var activity_id: String=str(current.get("id",""))
		var stage: int=int(current.get("stage",0))
		var activity_card:=_tile(grid,activity_type,"纸杯叠塔" if activity_type=="cupStack" else "便签接龙","%d / 3 · 自己完成，或同事接力" % stage if activity_type=="cupStack" else "★ → + → ! · %d / 3" % stage)
		if activity_type=="cupStack":_button(_actions(activity_card),"叠杯",func(): _send("cupStack",{"activityId":activity_id} if not activity_id.is_empty() else {}),reason,true)
		else:
			var symbol_row:=_actions(activity_card)
			for symbol in range(3):
				var symbol_id: int=symbol
				_button(symbol_row,["星星","加号","叹号"][symbol],func(): _send("noteChain",{"symbol":symbol_id,"activityId":activity_id} if not activity_id.is_empty() else {"symbol":symbol_id}),reason)
	var pose:=_tile(grid,"groupPose","合照摆姿","自己摆姿，或邀请身边同事一起拍。")
	_button(_actions(pose),"摆姿" if target.is_empty() else "邀请合照",func(): _send("groupPose",{},selected_target,true),reason if not reason.is_empty() else "靠近同事再邀请" if not target.is_empty() and not close else "")

func _collection(parent: Node) -> void:
	var prefs:=_prefs()
	var unlocked: Array=prefs.get("unlocked",[])
	game._text(parent,"收藏 %d / 8 · 记录随账号，摆件留在本冒险" % unlocked.size(),14,game.MINT)
	var grid:=GridContainer.new()
	grid.columns=2
	grid.add_theme_constant_override("h_separation",12)
	grid.add_theme_constant_override("v_separation",12)
	parent.add_child(grid)
	for value in game.catalog.get("social",{}).get("souvenirs",[]):
		var id: String=str(value.id)
		var card:=_tile(grid,"duck" if id=="rubber_duck" else id,str(value.name),"已找到" if unlocked.has(id) else str(value.source))
		var row:=_actions(card)
		var already: bool=_social().get("displays",[]).any(func(q): return str(q.souvenirId)==id)
		var near_base: bool=game._v(game._find(game.state.get("buildings",[]),"core")).distance_to(game._v(game.player))<=14
		var display_button:=_button(row,"已摆" if already else "摆放",func(): _send("souvenir",{"souvenirId":id},"",true),_reason() if not _reason().is_empty() else "还没找到" if not unlocked.has(id) else "靠近据点" if not near_base else "已摆" if already else "",true)
		display_button.set_meta("souvenir_id",id)
		if id=="box_hat":
			var hat: bool=bool(prefs.get("hat",false))
			_button(row,"摘帽" if hat else "戴帽",func(): game._command("SocialSettings","",{"hat":not hat}),"还没找到" if not unlocked.has(id) else "")
