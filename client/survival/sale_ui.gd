extends RefCounted

var page := 0
var selected_id := ""
var quantity := 1
var confirmation := ""
var confirm_after := 0.0
var pending_request := 0
var waiting_signature := ""

func reconnected() -> void:
	pending_request=0
	waiting_signature=""
	confirmation=""

func reset() -> void:
	page = 0
	selected_id = ""
	quantity = 1
	confirmation = ""

static func is_loot(definition: Dictionary) -> bool:
	return str(definition.get("kind","")) in ["catch","loot","material"]

static func quote(g, item: Dictionary, count: int) -> Dictionary:
	var definition: Dictionary = g._find(g.config.items,str(item.get("definitionId","")))
	var credits := int(definition.get("sell_c",0) if is_loot(definition) else definition.get("resale_c",0))*count
	var materials := int(definition.get("deposit_m",0))*count if is_loot(definition) else 0
	if str(definition.get("kind",""))=="weapon":
		var weapon: Dictionary = g._find(g.config.weapons,str(item.definitionId))
		var ammo: Dictionary = g._find(g.config.items,str(weapon.get("ammo","")))
		credits += int(item.get("magazineAmmo",0))*int(ammo.get("resale_c",0))
		credits += maxi(0,int(item.get("level",1))-1)*int(floor(float(g.config.weapon_upgrade.cost_c)*float(g.config.economy.resale_upgrade_fraction)))
	return {"credits":credits,"materials":materials}

func signature(item: Dictionary) -> String:
	return JSON.stringify([item.get("id"),item.get("revision"),item.get("containerId"),item.get("quantity"),item.get("level"),item.get("magazineAmmo")])

func result(message: Dictionary) -> void:
	if int(message.get("requestId",0))!=pending_request: return
	pending_request=0
	confirmation=""
	if not bool(message.get("ok",false)): waiting_signature=""

func reason(g, item: Dictionary) -> String:
	var station: String = g._station_reason("recycle")
	if not station.is_empty(): return station
	if item.get("loanOwnerSlotId")!=null: return "借用品不卖"
	if item.get("lockedBy")!=null or g.player.get("work")!=null or g.player.get("reload")!=null or g.player.get("fishing")!=null or g.player.get("meleePending")!=null: return "正在使用"
	if pending_request>0 or not waiting_signature.is_empty(): return "交易中"
	var value := quote(g,item,quantity)
	if int(value.credits)+int(value.materials)<=0: return "暂不收购"
	return ""

func candidates(g) -> Array:
	var items: Array = []
	for slot in ["weapon","rod","melee"]:
		var item: Dictionary = g._equipped(slot)
		if not item.is_empty(): items.append(item)
	for item in g._items_in(str(g.player.get("backpackId",""))):
		var definition: Dictionary = g._find(g.config.items,str(item.definitionId))
		if not is_loot(definition) or bool(definition.get("crafting_material",false)): items.append(item)
	return items

func build(g) -> void:
	g._tabs(g.panel_navigation,["战利品","售卖","拆解"],page,func(index: int):
		page=index;confirmation="";g.growth_confirmation="";g.panel_scroll.scroll_vertical=0;g._refresh_panel())
	if page==0:
		g._recycle_loot_panel()
		return
	if page==2:
		g.CraftingUI.build_dismantle(g)
		return
	var items := candidates(g)
	if not items.any(func(item): return str(item.id)==selected_id):
		selected_id=str(items[0].id) if not items.is_empty() else ""
		quantity=1;confirmation=""
	var current: Dictionary = {}
	for item in items:
		if str(item.id)==selected_id: current=item;break
	if pending_request==0 and (current.is_empty() or signature(current)!=waiting_signature): waiting_signature=""
	if items.is_empty():
		g._compact_row(g.panel_content,"crate","没有可卖物品","带上不用的装备或材料再来。")
		return
	quantity=clampi(quantity,1,int(current.get("quantity",1)))
	if confirmation!=signature(current)+str(quantity): confirmation=""
	var scroll := ScrollContainer.new()
	scroll.name="SaleItems"
	scroll.custom_minimum_size.y=mini(3,int(ceil(items.size()/5.0)))*84-8
	scroll.horizontal_scroll_mode=ScrollContainer.SCROLL_MODE_DISABLED
	g.panel_content.add_child(scroll)
	var grid: GridContainer = g._visual_grid(scroll,mini(5,items.size()))
	grid.add_theme_constant_override("h_separation",8)
	grid.size_flags_horizontal=Control.SIZE_SHRINK_CENTER
	for item in items:
		var chosen: bool = str(item.id)==selected_id
		var cell := Button.new()
		cell.name="SaleItem_"+str(item.id)
		cell.set_meta("ui_role","item_slot")
		cell.set_meta("sale_definition",str(item.definitionId))
		cell.custom_minimum_size=Vector2(112,76)
		cell.size_flags_horizontal=Control.SIZE_SHRINK_BEGIN
		cell.tooltip_text=g._item_text(item)
		cell.disabled=pending_request>0 or not waiting_signature.is_empty()
		for key in ["normal","hover","pressed","focus","disabled"]:
			var style: StyleBoxFlat = g._button_style(Color("214953") if chosen or key=="hover" else Color("142e38"),6)
			style.border_color=g.GOLD if chosen else Color("3f6066")
			style.set_border_width_all(2 if chosen else 1)
			cell.add_theme_stylebox_override(key,style)
		grid.add_child(cell)
		var icon: Control = g._item_icon(cell,str(item.definitionId))
		icon.position=Vector2(29,5);icon.size=Vector2(54,46)
		var status := "借用品" if item.get("loanOwnerSlotId")!=null else "已装备" if str(item.containerId)!=str(g.player.get("backpackId","")) else "道具4" if str(item.definitionId)==str(g.player.get("quickItemDefinitionId","")) else ""
		var caption := Label.new()
		caption.mouse_filter=Control.MOUSE_FILTER_IGNORE
		caption.text=status+" ×%d" % int(item.quantity)
		caption.add_theme_font_size_override("font_size",12)
		caption.add_theme_color_override("font_color",g.GOLD if chosen else g.CREAM)
		caption.horizontal_alignment=HORIZONTAL_ALIGNMENT_CENTER
		cell.add_child(caption);caption.position=Vector2(4,54);caption.size=Vector2(104,18)
		cell.pressed.connect(func(): selected_id=str(item.id);quantity=1;confirmation="";g._refresh_panel())
	detail(g,current)

func detail(g, item: Dictionary) -> void:
	var equipped: bool = str(item.containerId)!=str(g.player.get("backpackId",""))
	var definition: Dictionary = g._find(g.config.items,str(item.definitionId))
	var note := "所得经费存入个人钱包"
	if bool(definition.get("crafting_material",false)): note="制作材料 · 只卖当前选中的数量"
	if str(definition.get("kind",""))=="weapon": note="Lv.%d · 弹匣 %d 发 · 已计入售价" % [int(item.get("level",1)),int(item.get("magazineAmmo",0))]
	elif str(item.definitionId)==str(g.player.get("quickItemDefinitionId","")): note="道具4 · 随身同类卖完后可挥拳"
	var row: HBoxContainer = g._compact_row(g.panel_content,str(item.definitionId),g._name(str(item.definitionId)),note,g.GOLD)
	g.InventoryUI.wrap_detail(row)
	row.set_meta("ui_role","sale_detail")
	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation",8)
	g.panel_content.add_child(controls)
	if int(item.quantity)>1:
		var minus: Button = g._button(controls,"−",func(): quantity=maxi(1,quantity-1);confirmation="";g._refresh_panel())
		compact_control(minus,"减少数量")
		minus.disabled=quantity<=1 or pending_request>0 or not waiting_signature.is_empty()
		var count: Label = g._text(controls,str(quantity),16,g.CREAM)
		count.custom_minimum_size=Vector2(48,40)
		count.horizontal_alignment=HORIZONTAL_ALIGNMENT_CENTER;count.vertical_alignment=VERTICAL_ALIGNMENT_CENTER
		var plus: Button = g._button(controls,"＋",func(): quantity=mini(int(item.quantity),quantity+1);confirmation="";g._refresh_panel())
		compact_control(plus,"增加数量")
		plus.disabled=quantity>=int(item.quantity) or pending_request>0 or not waiting_signature.is_empty()
		var all: Button = g._button(controls,"全部",func(): quantity=int(item.quantity);confirmation="";g._refresh_panel())
		all.size_flags_vertical=Control.SIZE_SHRINK_CENTER
		all.disabled=quantity==int(item.quantity) or pending_request>0 or not waiting_signature.is_empty()
	var space := Control.new();space.size_flags_horizontal=Control.SIZE_EXPAND_FILL;controls.add_child(space)
	var value := quote(g,item,quantity)
	var total: VBoxContainer = g._column(controls,3)
	var blocked := reason(g,item)
	g._text(total,"个人获得",12,g.MINT)
	if item.get("loanOwnerSlotId")!=null: g._text(total,"不可出售",14,g.MINT)
	else: g._visual_cost(total,int(value.credits),int(value.materials))
	var footer := HBoxContainer.new();footer.add_theme_constant_override("separation",10);g.panel_content.add_child(footer)
	var confirming := confirmation==signature(item)+str(quantity)
	if not blocked.is_empty(): confirmation="";confirming=false
	var message := blocked if not blocked.is_empty() else "卖出后，对应按键改为挥拳。" if confirming else "卖出后无法撤销" if equipped else "只卖当前选中的物品"
	var hint: Label = g._text(footer,message,12,g.GOLD if confirming else g.MINT)
	hint.size_flags_horizontal=Control.SIZE_EXPAND_FILL;hint.vertical_alignment=VERTICAL_ALIGNMENT_CENTER
	hint.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	if confirming:
		var cancel: Button = g._button(footer,"取消卖出",func(): confirmation="";g._refresh_panel())
		cancel.size_flags_vertical=Control.SIZE_SHRINK_CENTER
		cancel.name="CancelSale"
	var action: Button = g._button(footer,"确认卖出" if confirming else "卖出",func(): sell(g,item,equipped),true)
	action.size_flags_vertical=Control.SIZE_SHRINK_CENTER
	action.name="ConfirmSale" if confirming else "SellSelected"
	action.disabled=not blocked.is_empty()
	action.tooltip_text=blocked if not blocked.is_empty() else message
	if confirming: footer.get_node("CancelSale").call_deferred("grab_focus")

func compact_control(button: Button, title: String) -> void:
	button.set_meta("ui_role","icon_action")
	button.custom_minimum_size=Vector2(40,40)
	button.size_flags_vertical=Control.SIZE_SHRINK_CENTER
	button.tooltip_text=title

func sell(g, item: Dictionary, equipped: bool) -> void:
	if not reason(g,item).is_empty(): return
	var key := signature(item)+str(quantity)
	if equipped and confirmation!=key:
		confirmation=key;confirm_after=g.elapsed+0.35;g._refresh_panel();return
	if equipped and g.elapsed<confirm_after: return
	var actual: Dictionary = g._find(g.state.get("items",[]),str(item.id))
	if actual.is_empty() or signature(actual)!=signature(item):
		confirmation="";g._toast("物品变了，请重选");g._refresh_panel();return
	var payload := {"itemId":str(item.id),"quantity":quantity,"stationId":str(g.station_context.get("id","")),"confirmEquipped":equipped}
	waiting_signature=signature(item)
	pending_request=g._sell_command(payload,int(item.revision))
	confirmation=""
	g._refresh_panel()
