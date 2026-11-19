extends RefCounted

const PERK_ICONS := {"precision":"rifle","scavenger":"scrap","medic":"bandage","quick_reload":"ammo_light","endurance":"player","brawler":"knife","angler":"rod_pro","pockets":"crate"}

static func capacity(g) -> int:
	return int(g._container(str(g.player.get("backpackId",""))).get("slotLimit",12))

static func build(g, items: Array) -> void:
	var heading := HBoxContainer.new()
	g.panel_content.add_child(heading)
	var title: Label = g._text(heading,"背包  %d / %d" % [items.size(),capacity(g)],16,g.GOLD)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	if items.is_empty():
		g._compact_row(g.panel_content,"crate","背包空了","去海边钓鱼，或探索旧工位。")
		return
	if not items.any(func(item): return str(item.id)==g.selected_item_id): g.selected_item_id=str(items[0].id)
	var grid: GridContainer = g._visual_grid(g.panel_content,mini(6,items.size()))
	for item in items:
		var selected: bool = str(item.id)==g.selected_item_id
		var cell := Button.new()
		cell.set_meta("ui_role","item_slot")
		cell.name = "Item_"+str(item.definitionId)
		cell.set_meta("focus_scope",str(item.id))
		cell.custom_minimum_size = Vector2(112,76)
		cell.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		cell.tooltip_text = g._item_text(item)
		for key in ["normal","hover","pressed","focus"]:
			var style: StyleBoxFlat = g._button_style(Color("214953") if selected or key=="hover" else Color("142e38"),6)
			style.border_color = g.GOLD if selected else Color("3f6066")
			style.set_border_width_all(2 if selected else 1)
			cell.add_theme_stylebox_override(key,style)
		grid.add_child(cell)
		var icon: Control = g._item_icon(cell,str(item.definitionId))
		icon.position=Vector2(29,8)
		icon.size=Vector2(54,48)
		var count := Label.new()
		count.mouse_filter=Control.MOUSE_FILTER_IGNORE
		var module_tag := str(g.CraftingUI.module_name(g,item)).left(2)
		if not module_tag.is_empty(): module_tag+=" "
		count.text=module_tag+"×%d" % int(item.get("quantity",1))
		count.add_theme_font_size_override("font_size",12)
		count.add_theme_color_override("font_color",g.CREAM)
		count.horizontal_alignment=HORIZONTAL_ALIGNMENT_RIGHT
		cell.add_child(count)
		count.position=Vector2(8,54)
		count.size=Vector2(96,18)
		cell.pressed.connect(func(): g.selected_item_id=str(item.id);g._refresh_panel())
	var selected_item: Dictionary = {}
	for item in items:
		if str(item.id)==g.selected_item_id: selected_item=item;break
	detail(g,selected_item)

static func description(g, item: Dictionary) -> String:
	var id := str(item.get("definitionId",""))
	var module: Dictionary = g.CraftingUI.module_data(g,item)
	var module_copy := "\n"+str(module.get("description","")) if not module.is_empty() else ""
	var accessory: Dictionary = g.CraftingUI.attachment_data(g,item)
	if not accessory.is_empty(): module_copy+="\n"+str(accessory.description)
	var definition: Dictionary = g._find(g.config.items,id)
	var outing_copy := {"scrap":"制作的基础材料。拆箱或搜索获得。", "spring_parts":"制作、改装用。弹簧虾和抽屉里有。", "sealed_cell":"制作、改装用。外勤保全和搬运可得。也能给炮台补弹。", "coffee_coupon":"在补给台换一杯咖啡，或出售。", "team_medal":"合作的纪念！在回收台卖 80 金币。"}
	if outing_copy.has(id): return str(outing_copy[id])
	var tool_copy := {"decoy_alarm":"放在前方，吸引附近小怪 8 秒。","repair_kit":"修复受损建筑 120 耐久，不能重建。","coffee_flask":"恢复 40 体力，体力已满时不会消耗。","flash_note":"晕住附近小怪 1 秒，对首领无效。"}
	if tool_copy.has(id): return str(tool_copy[id])
	if definition.has("description") and str(definition.get("kind","")) not in ["weapon","rod"]: return str(definition.description)
	match str(definition.get("kind","")):
		"weapon":
			var weapon: Dictionary = item.effectiveStats if item.get("effectiveStats") is Dictionary else g._find(g.config.weapons,id)
			var damage := float(weapon.get("damage",0))
			if int(item.get("level",1))>=2: damage = floorf(damage*float(g.config.weapon_upgrade.damage_multiplier))
			var amount := str(snappedf(damage,0.1)) + ("×%d" % int(weapon.pellets) if int(weapon.get("pellets",1))>1 else "")
			var role := str(g.OfficeTheme.EQUIPMENT_ROLES.get(id,"右键瞄准"))
			return "%s · 弹匣 %d\n%s%s" % ["伤害 "+amount,int(weapon.get("magazine",0)),role,module_copy]
		"rod":
			var rod: Dictionary = g._find(g.config.rods,id)
			var purpose := "磁吸物资 · 上岸后拾取" if id=="rod_magnet" else "活鱼上岸 · 打倒后回收"
			return "%d 米 · %s\n%s%s" % [int(rod.get("cast_range",12)),purpose,str(g.OfficeTheme.EQUIPMENT_ROLES.get(id,"按住收线 · 松手降压")),module_copy]
		"melee": return "近身挥砍，不消耗弹药。"
		"ammo": return str({"ammo_light":"轻弹通用：步枪、手枪、冲锋枪、机枪。","ammo_shell":"供霰弹枪使用。","ammo_heavy":"供狙击枪和半自动步枪使用。"}.get(id,"装填对应武器时使用。"))
		"consumable": return "装入道具栏，按 4 选中，再左键包扎。"
		_: return "带回办公室出售，获得个人资源。"

static func detail(g, item: Dictionary) -> void:
	if item.is_empty(): return
	var definition: Dictionary = g._find(g.config.items,str(item.definitionId))
	var row: HBoxContainer = g._compact_row(g.panel_content,str(item.definitionId),g._item_text(item),description(g,item),g.GOLD)
	wrap_detail(row)
	row.set_meta("ui_role","item_detail")
	var kind := str(definition.get("kind",""))
	if kind in ["weapon","rod","melee"]:
		var button: Button = g._button(row,"装备",func(): g._command("SwitchEquip","",{"itemId":str(item.id)}),true)
		button.size_flags_vertical=Control.SIZE_SHRINK_CENTER
		button.disabled=item.get("lockedBy")!=null or str(g.player.get("lifeState",""))!="ALIVE"
		var reason := "倒地后无法装备" if str(g.player.get("lifeState",""))!="ALIVE" else "物品正在使用" if item.get("lockedBy")!=null else ""
		g._action_state(button,reason,"装备已有物品")
	elif kind=="tool" or str(item.definitionId)=="bandage":
		var bound: bool = str(g.player.get("quickItemDefinitionId",""))==str(item.definitionId)
		g._text(row.get_node("Details"),"道具栏 · 按 4 选用",12,g.MINT)
		var button: Button = g._button(row,"取下" if bound else "装入",func(): g._bind_quick(null if bound else str(item.id)),not bound)
		button.size_flags_vertical=Control.SIZE_SHRINK_CENTER
		button.disabled=item.get("lockedBy")!=null or str(g.player.get("lifeState",""))!="ALIVE" or g.player.get("work")!=null or g.player.get("fishing")!=null or g.player.get("reload")!=null or bool(g.player.get("swimming",false))
		var reason := "倒地后无法配置" if str(g.player.get("lifeState",""))!="ALIVE" else "上岸后再配置" if bool(g.player.get("swimming",false)) else "完成当前动作后再配置" if button.disabled else ""
		g._action_state(button,reason,"取下后按 4 可挥拳" if bound else "按 4 选中，左键使用")

static func pending(g) -> int:
	var count := 0
	for offer in g.player.get("rewardOffers",[]):
		if offer.get("selected")==null and not bool(offer.get("exhausted",false)): count+=1
	return count

static func rewards(g) -> void:
	var definitions: Array = g.config.get("director",{}).get("perks",[])
	var tasks: GridContainer = g._visual_grid(g.panel_content,2)
	for key in ["objective","optionalObjective"]:
		var task = g.state.get("director",{}).get(key)
		if not task is Dictionary: continue
		var caption := "完成 · 奖励在办公室" if bool(task.get("completed",false)) else "%d/%d · %s" % [int(task.get("progress",0)),int(task.get("goal",1)),objective_hint(g,task)]
		if bool(task.get("unavailable",false)): caption=objective_hint(g,task)
		var row: HBoxContainer = g._compact_row(tasks,"trophy" if bool(task.get("completed",false)) else "treasure",str(task.name),caption)
		wrap_detail(row)
		if bool(task.get("unavailable",false)): row.modulate=Color(0.67,0.72,0.76)
	var offers: Array = g.player.get("rewardOffers",[])
	var current: Dictionary = {}
	for offer in offers:
		if offer.get("selected")==null and not bool(offer.get("exhausted",false)): current=offer;break
	if not current.is_empty():
		g._text(g.panel_content,"选择一项能力 · 换冒险也保留" if g.player.has("wallet") else "选择一项能力 · 本次冒险持续生效",14,g.GOLD)
		var choices: GridContainer = g._visual_grid(g.panel_content,mini(3,current.options.size()))
		for id in current.options:
			var definition: Dictionary = g._find(definitions,str(id))
			var column: VBoxContainer = g._visual_card(choices,str(PERK_ICONS.get(id,"treasure")),str(definition.get("name",id)),str(definition.get("description","")),g.GOLD)
			if column.has_meta("caption_label"):
				var caption: Label = column.get_meta("caption_label")
				caption.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
				caption.clip_text=false
				caption.max_lines_visible=3
			var button: Button = g._button(column,"选择",func(): g._command("ChooseReward","",{"offerId":str(current.id),"perkId":str(id)}),true)
			button.disabled=id in g.player.get("perks",[])
	else:
		var complete: bool = g.player.get("perks",[]).size()>=definitions.size()
		g._compact_row(g.panel_content,"trophy","能力已集齐" if complete else "暂无新能力",("换冒险也保留。" if g.player.has("wallet") else "本次冒险持续生效。") if complete else "完成目标或守住夜晚，可以再选。")
	var owned: Array = g.player.get("perks",[])
	if not owned.is_empty():
		g._text(g.panel_content,"已有能力  %d / 8" % owned.size(),15,g.GOLD)
		var grid: GridContainer = g._visual_grid(g.panel_content,2)
		for id in owned:
			var definition: Dictionary = g._find(definitions,str(id))
			wrap_detail(g._compact_row(grid,str(PERK_ICONS.get(id,"treasure")),str(definition.get("name",id)),str(definition.get("description",""))))

static func wrap_detail(row: HBoxContainer) -> void:
	var details := row.get_node("Details")
	if details.get_child_count()>1:
		var caption: Label = details.get_child(1)
		caption.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
		caption.clip_text=false
		caption.max_lines_visible=3

static func objective_hint(g, task: Dictionary) -> String:
	if bool(task.get("unavailable",false)): return "本轮错过，明天再试"
	var action := str({"search":"按住 E 搜索","treasure":"寻找宝盒","break":"打碎场景物品","quiet_search":"停火后按住 E 搜索","zones":"搜索两个区域","deposit":"回营出售原料","fish":"让鱼成功上岸","kill":"击败野外怪物"}.get(str(task.get("verb","")),"探索地图"))
	if task.get("zoneId")!=null:
		for zone in g.state.get("dangerZones",[]):
			if str(zone.get("id",""))==str(task.zoneId):
				return str(zone.get("label","目标区"))+" · "+g._waypoint(Vector3(float(zone.x),float(zone.get("y",0)),float(zone.z)))
	return action
