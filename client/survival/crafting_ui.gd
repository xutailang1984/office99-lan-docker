extends RefCounted

# The surrounding game panel owns its fixed frame, header and scroll area.
static func _catalog(g) -> Dictionary:
	return g.catalog.get("crafting", g.config.get("crafting", {}))

static func _ingredients(g, parent: Node, ingredients: Array) -> String:
	var row := HFlowContainer.new()
	row.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	row.add_theme_constant_override("h_separation", 12)
	row.add_theme_constant_override("v_separation", 6)
	parent.add_child(row)
	var missing := false
	for ingredient in ingredients:
		var id := str(ingredient.get("definitionId", ""))
		var count: int = g._item_count(id)
		var cost := int(ingredient.get("quantity", 0))
		var color: Color = g.MINT if count >= cost else Color("ef826c")
		var pair := HBoxContainer.new()
		pair.add_theme_constant_override("separation", 3)
		row.add_child(pair)
		var icon: Control = g._item_icon(pair, id, color)
		icon.custom_minimum_size = Vector2(24,24)
		var source: String = str(_catalog(g).get("sources", {}).get(id, "探索获得"))
		icon.tooltip_text = g._name(id)+" · "+source
		icon.mouse_filter=Control.MOUSE_FILTER_PASS
		var amount: Label = g._text(pair, "%d/%d" % [count, cost], 13, color)
		amount.tooltip_text = icon.tooltip_text
		amount.mouse_filter=Control.MOUSE_FILTER_PASS
		missing = missing or count < cost
	return "材料不足" if missing else ""

static func _send(g, command: String, payload: Dictionary, revision := -1) -> void:
	if is_pending(g): return
	g.request_seq += 1
	g.pending[g.request_seq] = command
	var message := {"type":"command", "requestId":g.request_seq, "command":command, "payload":payload}
	if revision >= 0: message.expectedRevision = revision
	g._send(message)
	g.last_panel_signature=""
	g._refresh_panel_if_changed.call_deferred()

static func is_pending(g) -> bool:
	for command in g.pending.values():
		if command in ["Craft","ModGear","FitAttachment","RemoveModule","RemoveAttachment","DismantleGear","TrialModule","TrialAttachment"]: return true
	return false

static func build(g) -> void:
	var data := _catalog(g)
	g._tabs(g.panel_navigation,["枪械","钓具","部件"],g.craft_category,func(index: int): g.craft_category=index; g.panel_scroll.scroll_vertical=0; g._refresh_panel())
	var grid: GridContainer = g._visual_grid(g.panel_content, 2)
	for recipe in data.get("recipes", []):
		var kind: String = str(g._find(g.config.items,str(recipe.definitionId)).get("kind",""))
		if kind != ["weapon","rod","material"][g.craft_category]: continue
		var id := str(recipe.get("id", ""))
		var card: VBoxContainer = g._visual_card(grid, str(recipe.definitionId), str(recipe.name), str(recipe.description), g.GOLD)
		g._text(card,["基础","进阶 · 中风险","高阶 · 高风险"][clampi(int(recipe.get("risk",1)),1,3)-1],12,g.MINT)
		var missing := _ingredients(g, card, recipe.get("ingredients", []))
		var button: Button = g._button(card, "制作", func(): _send(g, "Craft", {"recipeId":id,"stationId":str(g._station_data().get("id", ""))}), true)
		var reason: String = g._station_reason("craft")
		if reason.is_empty(): reason = "夜间休息" if str(g.state.get("phase", "")) == "NIGHT" else missing
		if is_pending(g): reason="处理中"
		g._action_state(button, reason, "消耗随身材料，成品放入背包")
	g._text(g.panel_content, "机芯去外勤找 · 成品带回存 · 拆装备不返机芯", 12, Color("8faeaf"))

static func module_data(g, item: Dictionary) -> Dictionary:
	for module in _catalog(g).get("modules",[]):
		if str(module.id) == str(item.get("moduleId","")): return module
	return {}

static func module_name(g, item: Dictionary) -> String:
	return str(module_data(g,item).get("name",""))

static func attachment_data(g, item: Dictionary) -> Dictionary:
	for fitting in _catalog(g).get("attachments",[]):
		if str(fitting.id) == str(item.get("attachmentId","")): return fitting
	return {}

static func fitting_id(item: Dictionary, field: String) -> String:
	var value = item.get(field)
	return value if value is String else ""

static func _gear(g) -> Array:
	var items: Array = g._items_in(str(g.player.get("backpackId", ""))).filter(func(item): return str(g._find(g.config.items,str(item.definitionId)).get("kind","")) in ["weapon","rod"])
	for slot in ["weapon","rod"]:
		var item: Dictionary = g._equipped(slot)
		if not item.is_empty(): items.push_front(item)
	return items

static func _refund(g, item: Dictionary, whole: bool, accessory := false) -> Array:
	var amounts := {}
	var costs: Array = attachment_data(g,item).get("ingredients",[]).duplicate(true) if accessory else module_data(g,item).get("ingredients",[]).duplicate(true)
	if whole:
		costs.append_array(attachment_data(g,item).get("ingredients",[]))
		for recipe in _catalog(g).get("recipes",[]):
			if str(recipe.definitionId) == str(item.definitionId): costs.append_array(recipe.get("ingredients",[]))
	for ingredient in costs:
		var id := str(ingredient.definitionId)
		if id in _catalog(g).get("nonRefundable", ["field_core","hazard_core"]): continue
		amounts[id] = int(amounts.get(id,0)) + int(floor(float(ingredient.quantity)*0.5))
	if whole and int(item.get("magazineAmmo",0)) > 0:
		var ammo: String = str(g._find(g.config.weapons,str(item.definitionId)).get("ammo",""))
		if not ammo.is_empty(): amounts[ammo]=int(item.magazineAmmo)
	var rows: Array = []
	for id in amounts:
		if int(amounts[id]) > 0: rows.append({"definitionId":id,"quantity":amounts[id]})
	return rows

static func _reward_icons(g, parent: Node, rows: Array) -> void:
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation",8)
	parent.add_child(line)
	for row in rows:
		var icon: Control = g._item_icon(line,str(row.definitionId),g.MINT)
		icon.custom_minimum_size=Vector2(24,24)
		icon.tooltip_text=g._name(str(row.definitionId))
		g._text(line,"×%d" % int(row.quantity),13,g.MINT)

static func _confirm_action(g, parent: Node, item: Dictionary, command: String, label: String, reason: String) -> void:
	var key := command+":"+str(item.id)+":"+str(item.revision)
	var confirming: bool = g.growth_confirmation == key and reason.is_empty()
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation",8)
	parent.add_child(actions)
	if confirming:
		g._button(actions,"取消",func(): g.growth_confirmation=""; g._refresh_panel())
	var action: Button = g._button(actions,"确认"+label if confirming else label,func():
		if not confirming:
			g.growth_confirmation=key
			g._refresh_panel()
		else:
			g.growth_confirmation=""
			_send(g,command,{"itemId":str(item.id),"stationId":str(g._station_data().get("id","")),"confirmEquipped":true},int(item.revision)),true)
	g._action_state(action,reason,"返还图示材料，弹匣保留" if command in ["RemoveModule","RemoveAttachment"] else "装备会消失，图示材料与弹药放入背包")
	if confirming: g._text(parent,"仅处理这件装备 · 无法撤销",12,g.GOLD)

static func build_mods(g) -> void:
	var data := _catalog(g)
	var carried := _gear(g)
	if carried.is_empty():
		g._compact_row(g.panel_content,"repair","带上装备","选一件装备，换核心或装附件。",g.MINT)
		return
	var selected := 0
	for index in range(carried.size()):
		if str(carried[index].id) == g.assembly_item_id: selected=index
	var item: Dictionary = carried[selected]
	g.assembly_item_id=str(item.id)
	var chooser := OptionButton.new()
	chooser.custom_minimum_size=Vector2(280,40)
	chooser.set_meta("ui_role","selector")
	chooser.clip_text=true
	chooser.add_theme_font_size_override("font_size",14)
	chooser.size_flags_horizontal=Control.SIZE_SHRINK_BEGIN
	for gear in carried: chooser.add_item(g._item_text(gear))
	chooser.select(selected)
	chooser.item_selected.connect(func(index: int): g.assembly_item_id=str(carried[index].id); g.growth_confirmation=""; g._refresh_panel())
	g.panel_content.add_child(chooser)
	var reason: String = g._station_reason("upgrade")
	if reason.is_empty(): reason = "借用品" if item.get("loanOwnerSlotId") != null else "正在使用" if item.get("lockedBy") != null else "夜间休息" if str(g.state.get("phase", "")) == "NIGHT" else ""
	if is_pending(g): reason="处理中"
	g._text(g.panel_content,"功能核心 · 二选一",14,g.GOLD)
	var core_grid: GridContainer = g._visual_grid(g.panel_content,2)
	for core in data.get("modules",[]):
		if str(core.definitionId)==str(item.definitionId): _fitting_card(g,core_grid,item,core,false,reason)
	g._text(g.panel_content,"辅助附件 · 二选一",14,g.MINT)
	var accessory_grid: GridContainer = g._visual_grid(g.panel_content,2)
	var kind: String = str(g._find(g.config.items,str(item.definitionId)).get("kind",""))
	for accessory in data.get("attachments",[]):
		if str(accessory.kind)==kind: _fitting_card(g,accessory_grid,item,accessory,true,reason)
	g._text(g.panel_content,"核心和附件可同时装 · 换装会消耗旧件 · 卖出时跟随装备",12,Color("8faeaf"))

static func _fitting_card(g, parent: Node, item: Dictionary, fitting: Dictionary, accessory: bool, base_reason: String) -> void:
	var field := "attachmentId" if accessory else "moduleId"
	var installed := fitting_id(item,field)==str(fitting.id)
	var replacing := not fitting_id(item,field).is_empty() and not installed
	var card: VBoxContainer = g._visual_card(parent,str(item.definitionId),str(fitting.name),str(fitting.description),g.MINT if installed else g.GOLD)
	g._text(card,str(fitting.get("tradeoff","")),12,Color("8faeaf"))
	if installed:
		g._text(card,"已装配",12,g.MINT)
		_reward_icons(g,card,_refund(g,item,false,accessory))
		_confirm_action(g,card,item,"RemoveAttachment" if accessory else "RemoveModule","拆除",base_reason)
		return
	var missing := _ingredients(g,card,fitting.get("ingredients",[]))
	var reason := base_reason if not base_reason.is_empty() else missing
	var command := "FitAttachment" if accessory else "ModGear"
	var key := command+":"+str(item.id)+":"+str(fitting.id)+":"+str(item.revision)
	var confirming: bool = replacing and g.growth_confirmation==key
	var button: Button = g._button(card,"确认换装" if confirming else "换装" if replacing else "装配",func():
		if replacing and not confirming:
			g.growth_confirmation=key
			g._refresh_panel()
		else:
			var payload := {"itemId":str(item.id),"stationId":str(g._station_data().get("id","")),"replace":replacing}
			payload[field]=str(fitting.id)
			g.growth_confirmation=""
			_send(g,command,payload,int(item.revision)),true)
	g._action_state(button,reason,"旧件会消耗，弹药和另一槽保留" if replacing else "消耗图示部件，装备和弹药保留")
	if confirming: g._text(card,"旧件会消耗 · 返回可取消",12,g.GOLD)

static func build_dismantle(g) -> void:
	var carried := _gear(g)
	if carried.is_empty(): g._compact_row(g.panel_content,"scrap","没有装备","带上不用的枪或鱼竿再来。",g.MINT)
	for item in carried:
		var card: VBoxContainer = g._visual_card(g.panel_content,str(item.definitionId),g._item_text(item),"拆成材料 · 弹匣里的子弹全部退回",g.GOLD)
		_reward_icons(g,card,_refund(g,item,true))
		var reason: String = g._station_reason("recycle")
		if reason.is_empty(): reason="借用品" if item.get("loanOwnerSlotId") != null else "正在使用" if item.get("lockedBy") != null else ""
		_confirm_action(g,card,item,"DismantleGear","拆解",reason)
