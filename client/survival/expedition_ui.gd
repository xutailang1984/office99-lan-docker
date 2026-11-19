extends RefCounted

# Informational away from base; the storage terminal alone offers hand-in.
static func contracts(g) -> Array:
	for row in g.state.get("expedition",{}).get("players",[]):
		if str(row.get("playerId","")) == g.self_id: return row.get("contracts",[])
	return []

static func contract(g, zone_id: String) -> Dictionary:
	for row in contracts(g):
		if str(row.get("zoneId","")) == zone_id: return row
	return {}

static func progress(row: Dictionary) -> String:
	if bool(row.get("claimed",false)): return "今日已交付"
	if bool(row.get("ready",false)): return "带回储物柜 · 领取奖励"
	return "搜 %d/%d · 战 %d/%d" % [int(row.get("search",0)),int(row.get("searchGoal",0)),int(row.get("kills",0)),int(row.get("killGoal",0))]

static func build(g, at_storage: bool) -> void:
	var data: Dictionary = g.state.get("expedition",{})
	if data.is_empty() or g.mission.active():
		g._compact_row(g.panel_content,"storage","准备出发","外勤任务在冒险的白天开放。",g.MINT)
		return
	for zone in data.get("zones",[]):
		var id := str(zone.get("id",""))
		var tier := clampi(int(zone.get("risk",1)),1,3)
		var colors: Array[Color] = [g.MINT,g.GOLD,Color("ef826c")]
		var marker: String = ["Ⅰ","Ⅱ","Ⅲ"][tier-1]
		var row := contract(g,id)
		var place: Dictionary = g._find(g.state.get("dangerZones",[]),id)
		var direction: String = g._waypoint(g._v(place)) if not place.is_empty() else ""
		var profile: Dictionary=g.state.get("director",{}).get("regionPlans",{}).get(id,{})
		var card: VBoxContainer = g._visual_card(g.panel_content,["scrap","spring_parts","sealed_cell"][tier-1],str(marker)+" "+str(zone.get("name",id))+" · "+str(zone.get("riskName","")),str(profile.get("advice",zone.get("advice","")))+"  "+direction,colors[tier-1])
		var summary := HBoxContainer.new()
		summary.add_theme_constant_override("separation",12)
		card.add_child(summary)
		var status: Label = g._text(summary,progress(row),13,colors[tier-1])
		status.size_flags_horizontal=Control.SIZE_EXPAND_FILL
		status.vertical_alignment=VERTICAL_ALIGNMENT_CENTER
		if at_storage:
			var reason: String = g._station_reason("storage")
			if reason.is_empty(): reason="今日已领" if bool(row.get("claimed",false)) else "尚未完成" if not bool(row.get("ready",false)) else "夜间守灯" if str(g.state.get("phase","")) == "NIGHT" else ""
			var button: Button = g._button(summary,"交付完成" if bool(row.get("claimed",false)) else "交付",func(): g.CraftingUI._send(g,"ReturnExpedition",{"stationId":str(g._station_data().get("id","")),"zoneId":id}),true)
			g._action_state(button,reason,"活着带回，奖励放入背包")
		var rewards: Array = row.get("reward",[])
		if not rewards.is_empty():
			g._text(card,"交付奖励",12,g.MINT)
			g.CraftingUI._reward_icons(g,card,rewards)
		var loot: Dictionary = zone.get("loot",{})
		if not loot.is_empty():
			g._text(card,"搜索材料",12,g.MINT)
			g.CraftingUI._reward_icons(g,card,loot.get("search",[]))
			if tier>1:
				g._text(card,"宝盒机芯",12,colors[tier-1])
				g.CraftingUI._reward_icons(g,card,loot.get("cache",[]).filter(func(item): return str(item.definitionId) in ["field_core","hazard_core"]))
	g._text(g.panel_content,"倒地可救 · 死亡掉随身物，未交外勤重做 · C 查看路线",12,g.MINT)
