extends Node3D
const QueryPhysics=preload("res://survival/static_query_physics.gd")

const ExplorationView = preload("res://survival/exploration_view.gd")
var exploration_view
const SocialUI = preload("res://survival/social_ui.gd")
const SocialView = preload("res://survival/social_view.gd")
var social_ui := SocialUI.new()
var social_view
var query_only_physics := false
const CLIENT_BUILD := "0.18.0"
const SaleUI := preload("res://survival/sale_ui.gd")
var sale_ui := SaleUI.new()
const InventoryUI = preload("res://survival/inventory_ui.gd")
const CraftingUI = preload("res://survival/crafting_ui.gd")
const ExpeditionUI = preload("res://survival/expedition_ui.gd")
const Mission = preload("res://survival/mission.gd")
var mission := Mission.new()
const CombatZone = preload("res://survival/combat_zone.gd")
const ProjectileView = preload("res://survival/projectile_view.gd")
const NetworkState = preload("res://survival/network_state.gd")
const FONT = preload("res://fonts/IslandSans.ttf")
const AimProfile = preload("res://survival/aim_profile.gd")
const View = preload("res://survival/interaction_view.gd")
const Hud = preload("res://survival/hud.gd")
const Actor = preload("res://survival/actor.gd")
const Props = preload("res://survival/props.gd")
const Turret = preload("res://survival/turret.gd")
const CueAudio = preload("res://survival/audio.gd")
const FishingPresentation = preload("res://survival/fishing_presentation.gd")
const FishingWater = preload("res://survival/fishing_water.gd")
const VisualWarmup = preload("res://survival/visual_warmup.gd")
var visual_warmup_active := false
var visual_warmup_done := false
const INK = Color("143038")
const CREAM = Color("fff1d2")
const GOLD = Color("f1c575")
const MINT = Color("a9d8c5")
const OfficeScene = preload("res://survival/office_scene.gd")
const TerrainSupport = preload("res://survival/terrain_support.gd")
const OfficeTheme = preload("res://survival/office_theme.gd")
const NAMES = OfficeTheme.NAMES
const PHASES = {"PREP":"上班前整备", "DAY":"退潮外出", "RETURN":"涨潮返营", "NIGHT":"守护协作灯", "RECOVERY":"抢救重建", "COMPLETE":"冒险完成"}
var config: Dictionary = {}
var state: Dictionary = {}
var network_state = NetworkState.new()
var snapshot_received_at := 0.0
var network_bytes := 0
var network_sample_at := 0.0
var network_kib_per_second := 0.0
var snapshot_interval_ms := 0.0
var snapshot_apply_ms := 0.0
var network_delta_frames := 0
var network_full_frames := 0
var catalog: Dictionary = {}
var player: Dictionary = {}
var world
var camera: Camera3D
var view
var socket: WebSocketPeer
var platform_transport
var platform_previous_overlay := ""
var platform_ui_signature := ""
var panel_layout_revision := 0
var panel_shell_size := Vector2.ZERO
var panel_history: Array[Dictionary] = []
var panel_back_button: Button
var platform_game_entered := false
var platform_input_after := 0.0
var platform_controls_blocked := false
var self_id := ""
var token := ""
var nickname := ""
var greeted := false
var joined := false
var spectator := false
var input_seq := 0
var request_seq := 0
var pending: Dictionary = {}
var elapsed := 0.0
var input_timer := 0.0
var ui_timer := 0.0
var connect_started := 0.0
var reconnect_at := -1.0
var reconnect_attempts := 0
var leaving := false
var yaw := 0.0
var pitch := -0.06
var local_pos := Vector3.ZERO
var move_direction := Vector2.ZERO
var primary_held := false
var secondary_held := false
var interaction_held := false
var rescue_retry_at := 0.0
var jump_held := false
var drag_look := false
var free_mouse := false
var sensitivity := 0.0024
var base_fov := 80.0
var invert_y := false
var shake_enabled := true
var volume := 0.45
var overlay := "lobby"
var station_context: Dictionary = {}
var storage_category := 0
var craft_category := 0
var upgrade_category := 0
var rewards_category := 0
var growth_confirmation := ""
var assembly_item_id := ""
var target: Dictionary = {}
var selected_work: Dictionary = {}
var selected_item_id := ""
var deployables: Dictionary = {}
var actors: Dictionary = {}
var enemies: Dictionary = {}
var objects: Dictionary = {}
var projectiles: Dictionary = {}
var ended_projectiles: Dictionary = {}
var fishing_lines: Dictionary = {}
var destructibles: Dictionary = {}
var turrets: Dictionary = {}
var retiring: Array = []
var seen_shots: Dictionary = {}
var seen_events: Dictionary = {}
var rod_charge_started := -1.0
var aim_target: Dictionary = {}
var cast_marker: MeshInstance3D
var last_hit_killed := false
var gear_feedback_text := ""
var gear_feedback_until := 0
var last_grounded := true
var footstep_time := 0.0
var eye_height := 1.65
var look_motion := Vector2.ZERO
var hud_paint
var ui_scrim: ColorRect
var current_weapon := ""
var last_shot_at := -10.0
var last_hp := 100
var toast_until := 0.0
var last_layout := ""
var last_panel_signature := ""
var panel_refresh_pending := false
var last_phase := ""
var last_error := ""
var store_category := "补给"
var gui: Control
var hud: Control
var lobby: PanelContainer
var name_input: LineEdit
var join_button: Button
var lobby_note: Label
var status_label: Label
var roster_label: Label
var bank_label: Label
var vitals_label: Label
var weapon_label: Label
var objective_label: Label
var context_label: Label
var action_label: Label
var toast_label: Label
var hotbar_label: Label
var reticle: Label
var death_label: Label
var charge_progress: ProgressBar
var tension_progress: ProgressBar
var panel: PanelContainer
var panel_header: VBoxContainer
var panel_title: Label
var panel_navigation: VBoxContainer
var panel_scroll: ScrollContainer
var panel_content: VBoxContainer
var panel_footer: VBoxContainer
var health_flash: ColorRect
var hurt_direction := Vector2(0,-1)
var hurt_direction_until := 0
var hurt_kick := 0.0
var sound: AudioStreamPlayer
var cue_audio
var auto_test := false
var ui_audit_enabled := false

func _ready() -> void:
	QueryPhysics.configure(OS.has_feature("web") or query_only_physics)
	if OS.has_feature("web"):
		ui_audit_enabled = bool(JavaScriptBridge.eval("new URLSearchParams(window.parent.location.search).get('ui_audit')==='1'"))
	var loaded = JSON.parse_string(FileAccess.get_file_as_string("res://survival/balance.json"))
	if not loaded is Dictionary:
		push_error("Survival configuration failed to load")
		get_tree().quit(1)
		return
	config = loaded
	world = load("res://survival/world.gd").new()
	add_child(world)
	world.setup(config)
	social_ui.setup(self)
	camera = Camera3D.new()
	add_child(camera)
	camera.current = true
	camera.keep_aspect = Camera3D.KEEP_HEIGHT
	camera.near = 0.05
	camera.far = 300
	camera.fov = base_fov
	camera.position = Vector3(52, 62, 66)
	camera.look_at(Vector3(0, 3, 0))
	view = View.new()
	add_child(view)
	view.weapon_configs=config.weapons
	view.setup(camera)
	view.rig.visible = false
	cast_marker = MeshInstance3D.new()
	var marker_mesh := TorusMesh.new()
	marker_mesh.inner_radius = 0.22
	marker_mesh.outer_radius = 0.29
	marker_mesh.rings = 20
	marker_mesh.ring_segments = 6
	cast_marker.mesh = marker_mesh
	cast_marker.material_override = view.material(MINT,true)
	cast_marker.scale.y = 0.14
	cast_marker.visible = false
	add_child(cast_marker)
	sound = AudioStreamPlayer.new()
	add_child(sound)
	# Build the cue pool during loading so the first shot never pays the sample
	# import/allocation cost in the middle of play.
	cue_audio = CueAudio.new()
	add_child(cue_audio)
	_build_ui()
	mission.setup(self)
	if OS.has_feature("web"):
		platform_transport = JavaScriptBridge.get_interface("tidalTransport")
		if platform_transport != null:
			mission.sync_entry_mode()
			nickname = str(platform_transport.name())
			name_input.text = nickname
			_connect()
	auto_test = "--smoke-survival" in OS.get_cmdline_user_args()
	if auto_test:
		print("SURVIVAL_CLIENT_READY build=" + CLIENT_BUILD + " config=tidal-web-0.3.0")
		await get_tree().create_timer(0.5).timeout
		get_tree().quit()

func _style(color: Color, radius := 9) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.set_corner_radius_all(radius)
	style.content_margin_left = 16
	style.content_margin_right = 16
	style.content_margin_top = 12
	style.content_margin_bottom = 12
	return style

func _text(parent: Node, value: String, size := 18, color := CREAM) -> Label:
	var label := Label.new()
	label.text = value
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.add_theme_color_override("font_outline_color", Color(0.04, 0.10, 0.12, 0.8))
	label.add_theme_constant_override("outline_size", 0)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label

func _button_style(color: Color, radius := 6) -> StyleBoxFlat:
	var style := _style(color, radius)
	style.content_margin_left = 12
	style.content_margin_right = 12
	style.content_margin_top = 7
	style.content_margin_bottom = 7
	return style

func _button(parent: Node, value: String, callback: Callable, primary := false, role := "action") -> Button:
	var button := Button.new()
	button.text = value
	var navigation := role == "navigation"
	var radius := 8 if role in ["system","navigation"] else 2
	button.custom_minimum_size = Vector2(144 if role in ["system","navigation"] else 96, 40)
	button.size_flags_horizontal = Control.SIZE_SHRINK_END
	button.clip_text = true
	button.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	button.tooltip_text = value
	button.set_meta("ui_role", role)
	var normal := _button_style(Color(0,0,0,0) if navigation else GOLD if primary else Color("2d515e"), radius)
	normal.border_color = Color("f9d58f") if primary else Color("71959e")
	normal.set_border_width_all(1)
	button.add_theme_stylebox_override("normal",normal)
	button.add_theme_stylebox_override("hover", _button_style(Color("294c59") if navigation else Color("f8d999") if primary else Color("406775"), radius))
	button.add_theme_stylebox_override("pressed", _button_style(Color("183641") if navigation else Color("dba454") if primary else Color("244550"), radius))
	var foreground := GOLD if navigation and primary else CREAM if navigation else INK if primary else CREAM
	button.add_theme_color_override("font_color", foreground)
	button.add_theme_color_override("font_hover_color", foreground)
	button.add_theme_color_override("font_pressed_color", foreground)
	button.add_theme_color_override("font_disabled_color", Color("73898f"))
	var disabled_style := _button_style(Color(0,0,0,0) if navigation else Color("142c36"),radius)
	disabled_style.border_color = Color("304852")
	disabled_style.set_border_width_all(1)
	button.add_theme_stylebox_override("disabled",disabled_style)
	var focus_style := _button_style(Color(0,0,0,0),radius)
	focus_style.border_color=GOLD
	focus_style.set_border_width_all(2)
	button.add_theme_stylebox_override("focus",focus_style)
	button.add_theme_font_size_override("font_size", 15)
	button.pressed.connect(callback)
	parent.add_child(button)
	return button

func _system_button(parent: Node, value: String, callback: Callable, primary := false) -> Button:
	return _button(parent,value,callback,primary,"system")

func _nav_button(parent: Node, value: String, callback: Callable, primary := false) -> Button:
	return _button(parent,value,callback,primary,"navigation")

func _card(parent: Node, at: Vector2, width: float) -> PanelContainer:
	var card := PanelContainer.new()
	card.position = at
	card.custom_minimum_size.x = width
	card.add_theme_stylebox_override("panel", _style(Color(0.06, 0.15, 0.18, 0.94)))
	parent.add_child(card)
	return card

func _column(parent: Node, separation := 8) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", separation)
	parent.add_child(box)
	return box

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	gui = Control.new()
	gui.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	gui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(gui)
	var theme := Theme.new()
	theme.default_font = FONT
	theme.default_font_size = 17
	theme.set_constant("separation", "HBoxContainer", 8)
	theme.set_constant("separation", "VBoxContainer", 8)
	gui.theme = theme
	ui_scrim = ColorRect.new()
	ui_scrim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ui_scrim.color = Color(0.025,0.06,0.10,0.26)
	ui_scrim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	gui.add_child(ui_scrim)
	lobby = _card(gui,Vector2(42,43),390)
	lobby.add_theme_stylebox_override("panel",_style(Color(0.04,0.09,0.13,0.96),12))
	var col := _column(lobby,12)
	_text(col,"O F F I C E  /  9 9 N   /   v" + CLIENT_BUILD,13,GOLD)
	_text(col,"办公室的99夜",44,CREAM)
	_text(col,"白天找补给，晚上一起守灯。",18,MINT)
	var rule := HSeparator.new()
	col.add_child(rule)
	_text(col,"01  搜集与钓鱼    02  归营与守夜",12,Color("8faeaf"))
	_text(col,"同事昵称",12,MINT)
	name_input = LineEdit.new()
	name_input.custom_minimum_size = Vector2(354,45)
	name_input.max_length = 16
	name_input.placeholder_text = "输入你的昵称"
	name_input.add_theme_stylebox_override("normal",_style(Color("152f3c"),6))
	name_input.add_theme_stylebox_override("focus",_style(Color("244650"),6))
	name_input.add_theme_color_override("font_color",CREAM)
	name_input.text = _storage_get("tidal-v03.last-name")
	if name_input.text.is_empty():
		name_input.text = "同事%d" % randi_range(100,999)
	col.add_child(name_input)
	join_button = _system_button(col,"加入冒险",_join,true)
	join_button.custom_minimum_size = Vector2(144, 40)
	var mouse_check := CheckButton.new()
	mouse_check.text = "自由鼠标 · 右键拖动视角"
	mouse_check.add_theme_font_size_override("font_size",13)
	mouse_check.toggled.connect(func(value:bool):free_mouse=value)
	col.add_child(mouse_check)
	lobby_note = _text(col,"1–%d 人合作 · 空位随时加入\n最近进度自动保存，同一昵称继续队员。" % int(config.get("baseline",{}).get("max_players",4)),13,MINT)
	lobby_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	lobby_note.custom_minimum_size.x = 350
	_text(col,"1 主枪   2 鱼竿   3 刀   4 道具\nE 交互   F 维护   G 嬉戏   Tab 背包   Esc 菜单",12,Color("8faeaf"))
	hud = Control.new()
	hud.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.visible = false
	gui.add_child(hud)
	# Semantic labels remain for input tests and a single source of action text.
	var records := Control.new()
	hud.add_child(records)
	records.visible = false
	status_label = _text(records,"")
	roster_label = _text(records,"")
	bank_label = _text(records,"")
	objective_label = _text(records,"")
	vitals_label = _text(records,"")
	weapon_label = _text(records,"")
	reticle = _text(records,"")
	context_label = _text(records,"")
	action_label = _text(records,"")
	hotbar_label = _text(records,"")
	death_label = _text(records,"")
	charge_progress = _bar(records,-130,MINT)
	tension_progress = _bar(records,-108,GOLD)
	health_flash = ColorRect.new()
	records.add_child(health_flash)
	health_flash.color = Color(0.7,0.12,0.06,0)
	toast_label = _text(gui,"",14,GOLD)
	toast_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	toast_label.max_lines_visible = 3
	toast_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	toast_label.visible = false
	hud_paint = Hud.new()
	hud.add_child(hud_paint)
	hud_paint.setup(self)
	panel = _card(gui,Vector2.ZERO,856)
	panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	panel.offset_left = -428
	panel.offset_right = 428
	panel.offset_top = -300
	panel.offset_bottom = 300
	panel.add_theme_stylebox_override("panel",_style(Color("0f2633"),10))
	var frame := _column(panel,12)
	panel_header = _column(frame,10)
	var header_row := HBoxContainer.new()
	header_row.add_theme_constant_override("separation",16)
	panel_header.add_child(header_row)
	panel_title = _text(header_row,"",25,CREAM)
	panel_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel_title.clip_text = true
	panel_title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	panel_back_button = _nav_button(header_row,"返回上级",_panel_back)
	panel_back_button.visible = false
	_nav_button(header_row,"返回游戏",_resume).tooltip_text = "关闭菜单，返回游戏"
	# A timed notice must not move navigation or the button under the pointer.
	var notice_slot := Control.new()
	notice_slot.custom_minimum_size.y = 22
	notice_slot.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel_header.add_child(notice_slot)
	toast_label.reparent(notice_slot)
	toast_label.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	toast_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	toast_label.max_lines_visible = 1
	toast_label.clip_text = true
	panel_navigation = _column(panel_header,8)
	panel_header.add_child(HSeparator.new())
	panel_scroll = ScrollContainer.new()
	panel_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	panel_scroll.custom_minimum_size = Vector2.ZERO
	panel_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_RESERVE
	panel_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	frame.add_child(panel_scroll)
	panel_content = _column(panel_scroll,12)
	panel_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel_footer = _column(frame,8)
	panel_footer.visible = false
	panel_content.minimum_size_changed.connect(_queue_panel_layout)
	panel_header.minimum_size_changed.connect(_queue_panel_layout)
	panel_footer.minimum_size_changed.connect(_queue_panel_layout)
	panel.visible = false
	gui.resized.connect(_queue_panel_layout)

func _bar(parent: Node, top: float, color: Color) -> ProgressBar:
	var bar := ProgressBar.new()
	bar.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	bar.offset_left = -210
	bar.offset_right = 210
	bar.offset_top = top
	bar.offset_bottom = top + 18
	bar.show_percentage = false
	bar.add_theme_stylebox_override("background", _style(Color("203c43"), 3))
	bar.add_theme_stylebox_override("fill", _style(color, 3))
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(bar)
	bar.visible = false
	return bar

func _name(id: String) -> String:
	if NAMES.has(id): return str(NAMES[id])
	for library in [catalog.get("items",config.get("items",[])),catalog.get("creatures",config.get("creatures",[])),catalog.get("director",config.get("director",{})).get("perks",[])]:
		var definition := _find(library,id)
		if not definition.is_empty():
			var supplied = definition.get("name")
			if supplied is String and not supplied.strip_edges().is_empty(): return supplied
	return id

func _v(data) -> Vector3:
	if data is Array:
		return Vector3(float(data[0]), float(data[1]), float(data[2]))
	return Vector3(float(data.get("x", 0)), float(data.get("y", 0)), float(data.get("z", 0)))

func _find(values: Array, id: String) -> Dictionary:
	for value in values:
		if str(value.get("id", "")) == id:
			return value
	return {}

func _item(id: String) -> Dictionary:
	return _find(state.get("items", []), id)

func _container(id: String) -> Dictionary:
	return _find(state.get("containers", []), id)

func _items_in(container_id: String) -> Array:
	var result: Array = []
	for item in state.get("items", []):
		if str(item.get("containerId", "")) == container_id:
			result.append(item)
	return result

func _equipped(slot: String) -> Dictionary:
	if slot == "quick":
		var bound := str(player.get("quickItemDefinitionId", ""))
		for item in _items_in(str(player.get("backpackId", ""))):
			if str(item.definitionId)==bound and item.get("lockedBy")==null and int(item.quantity)>0: return item
		return {}
	var items := _items_in(str(player.get("equipment", {}).get(slot, "")))
	return items[0] if not items.is_empty() else {}

func _container_has_content(data: Dictionary) -> bool:
	return not data.is_empty() and (not _items_in(str(data.get("id",""))).is_empty() or int(data.get("recoverableC",0))>0 or int(data.get("recoverableM",0))>0)

func _ads_requested(active := true) -> bool:
	if player.get("carryingId")!=null: return false
	var preview := player.duplicate()
	# Right-click requests stopping sprint in the same input packet.
	preview.sprinting=false
	return active and overlay.is_empty() and AimProfile.requested_ads(preview,secondary_held,current_weapon)

func _weapon_config() -> Dictionary:
	if player.get("weaponStats") is Dictionary and str(player.weaponStats.get("id",""))==current_weapon: return player.weaponStats
	return _find(config.weapons, current_weapon)

func _storage_get(key: String) -> String:
	if OS.has_feature("web"):
		var value = JavaScriptBridge.eval("(function(){try{return localStorage.getItem(%s)||'';}catch(e){return '';}})()" % JSON.stringify(key))
		return str(value) if value != null else ""
	var file := ConfigFile.new()
	file.load("user://tidal-profiles.cfg")
	return str(file.get_value("profiles", key, ""))

func _storage_set(key: String, value: String) -> bool:
	if OS.has_feature("web"):
		return bool(JavaScriptBridge.eval("(function(){try{localStorage.setItem(%s,%s);return true;}catch(e){return false;}})()" % [JSON.stringify(key), JSON.stringify(value)]))
	var file := ConfigFile.new()
	file.load("user://tidal-profiles.cfg")
	file.set_value("profiles", key, value)
	return file.save("user://tidal-profiles.cfg") == OK

func _classic() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("location.href='classic.html'")
	else:
		get_tree().change_scene_to_file("res://main.tscn")

func _join() -> void:
	if joined:
		_resume()
		return
	if OS.has_feature("web"):
		var name_value = JavaScriptBridge.eval("document.getElementById('player-name')?.value||''")
		if name_value != null:
			name_input.text = str(name_value)
	nickname = name_input.text.strip_edges()
	if nickname.is_empty():
		lobby_note.text = "先填写队员昵称。"
		return
	token = _storage_get("tidal-v03.profile." + nickname)
	_storage_set("tidal-v03.last-name", nickname)
	reconnect_attempts = 0
	_connect()

func _connect() -> void:
	_clear_projectile_views()
	leaving = false
	network_state.reset()
	if platform_transport != null:
		greeted = false
		joined = false
		return
	if socket != null:
		socket.close()
	socket = WebSocketPeer.new()
	# The world state includes shared inventories and buildings. Background tabs
	# acknowledge snapshots only after consuming them, so stale states do not queue.
	socket.inbound_buffer_size = 8 * 1024 * 1024
	var url := "ws://127.0.0.1:8080/survival/ws"
	if OS.has_feature("web"):
		url = str(JavaScriptBridge.eval("(location.protocol==='https:'?'wss://':'ws://')+location.host+'/survival/ws'"))
	elif not OS.get_environment("SURVIVAL_SERVER_URL").is_empty():
		url = OS.get_environment("SURVIVAL_SERVER_URL")
	greeted = false
	connect_started = elapsed
	reconnect_at = -1
	join_button.disabled = true
	lobby_note.text = "正在连接潮汐岛…"
	last_error = ""
	if socket.connect_to_url(url) != OK:
		join_button.disabled = false
		lobby_note.text = "连接失败，请先启动局域网游戏服务。"

func _send(message: Dictionary) -> void:
	if platform_transport != null:
		platform_transport.send(JSON.stringify(message))
		return
	if socket != null and socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.send_text(JSON.stringify(message))

func _command(command: String, target_id := "", payload := {}) -> void:
	request_seq += 1
	var message := {"type":"command", "requestId":request_seq, "command":command, "payload":payload}
	if not target_id.is_empty():
		message.targetId = target_id
	pending[request_seq] = command
	_send(message)

func _sell_command(payload: Dictionary, expected_revision: int) -> int:
	request_seq += 1
	pending[request_seq] = "Sell"
	_send({"type":"command","requestId":request_seq,"command":"Sell","payload":payload,"expectedRevision":expected_revision})
	return request_seq

func _network() -> void:
	if platform_transport != null:
		if bool(platform_transport.ready()) and not greeted:
			greeted = true
			_send({"type":"hello", "name":nickname, "snapshotAck":true, "stateDelta":1, "clientReady":true})
		var raw_packets := str(platform_transport.poll())
		# Count the actual bridge batch once. Re-encoding each parsed Variant for
		# this diagnostic used to repeat JSON work on every incoming snapshot.
		if raw_packets != "[]": network_bytes += raw_packets.to_utf8_buffer().size()
		var packets = JSON.parse_string(raw_packets)
		if packets is Array:
			for message in packets:
				if message is Dictionary:
					_receive(message)
		return
	if socket == null:
		if reconnect_at > 0 and elapsed >= reconnect_at:
			_connect()
		return
	socket.poll()
	var ready := socket.get_ready_state()
	if ready == WebSocketPeer.STATE_OPEN:
		if not greeted:
			var hello := {"type":"hello", "name":nickname, "snapshotAck":true, "stateDelta":1}
			if not token.is_empty():
				hello.token = token
			_send(hello)
			greeted = true
		while socket.get_available_packet_count() > 0:
			var packet := socket.get_packet()
			network_bytes += packet.size()
			var message = JSON.parse_string(packet.get_string_from_utf8())
			if message is Dictionary:
				_receive(message)
	elif ready == WebSocketPeer.STATE_CLOSED:
		var code := socket.get_close_code()
		socket = null
		joined = false
		_stop_actions()
		overlay = "lobby"
		lobby.visible = true
		panel.visible = false
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		join_button.disabled = false
		join_button.text = "继续冒险"
		lobby_note.text = "已回大厅，进度保留。点击加入可继续。" if leaving else (last_error if not last_error.is_empty() else "连接中断；角色暂留岛上，仍可能受到伤害。")
		if not leaving and not token.is_empty() and code not in [4001, 4003, 1008] and reconnect_attempts < 8:
			reconnect_attempts += 1
			reconnect_at = elapsed + minf(2 * reconnect_attempts, 8)
			lobby_note.text += "\n正在自动重连…"
	elif ready == WebSocketPeer.STATE_CONNECTING and elapsed - connect_started > 12:
		socket.close()

func _receive(message: Dictionary) -> void:
	match str(message.get("type", "")):
		"onboarding_state":
			# Old clients may still send this account-only packet. The eight-step
			# adventure guide is retired; mission progress comes from room state.
			pass
		"platform_entered":
			platform_game_entered = true
			platform_input_after = elapsed + 0.15
			_stop_actions()
			_send({"type":"client_ready"})
		"platform_pointer":
			platform_controls_blocked = bool(message.get("blocked", false))
			_stop_actions()
			# The platform owns capture requests. Godot's web getter reads the
			# actual DOM lock; setting CAPTURED here would request it a second time.
		"platform_escape":
			# Browser Escape and its unlock event can both arrive in one batch.
			# Only the first navigation from the recorded overlay is applied.
			if platform_transport != null and platform_game_entered and overlay != "chat" and str(message.get("overlay", "!")) == overlay and bool(platform_transport.escapeCurrent(int(message.get("generation", -1)))):
				_escape_menu()
		"platform_notice":
			_toast(str(message.get("text", "")).left(500), 6.5)
		"platform_mission_continue":
			if joined and mission.active():
				platform_previous_overlay = ""
				_resume()
		"platform_reconnect":
			_clear_projectile_views()
			greeted = false
			network_state.reset()
		"platform_focus":
			# A queued open must not release the lock after chat already closed.
			if platform_transport != null and bool(message.get("active", false)) != bool(platform_transport.focusActive()):
				return
			if bool(message.get("active", false)):
				if overlay != "chat":
					platform_previous_overlay = overlay
				_stop_actions()
				overlay = "chat"
				Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
			elif overlay == "chat":
				overlay = platform_previous_overlay
				if overlay.is_empty():
					_resume()
				else:
					Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
				_queue_panel_layout()
			_publish_platform_ui()
		"welcome":
			_clear_projectile_views()
			sale_ui.reconnected()
			network_state.reset()
			self_id = str(message.get("selfId", ""))
			token = str(message.get("token", token))
			spectator = bool(message.get("spectator", false))
			catalog = message.get("catalog", {})
			for key in ["items","weapons","rods","creatures","fishing","director","crafting","expedition"]:
				if catalog.has(key): config[key]=catalog[key]
			view.weapon_configs=config.weapons
			if platform_transport == null and not token.is_empty() and not _storage_set("tidal-v03.profile." + nickname, token):
				_toast("浏览器未能保存身份；关闭网页后可能无法继续此队员。", 10)
			joined = true
			if platform_transport != null and platform_game_entered:
				_send({"type":"client_ready"})
			reconnect_attempts = 0
			join_button.disabled = false
			join_button.text = "进入园区"
			lobby_note.text = "练习物资不保存。Esc 查看任务与试用品。" if mission.active() else "按 1 用枪、2 用鱼竿；Esc 查看队伍与任务。"
			if spectator:
				lobby_note.text = "冒险已通关，可以查看结算；房主开启新冒险后加入。"
		"state", "state_delta":
			var apply_started := Time.get_ticks_usec()
			if not network_state.apply(message):
				_send({"type":"state_resync"})
				return
			if str(message.type) == "state_delta":
				network_delta_frames += 1
			else:
				network_full_frames += 1
			message = network_state.current
			snapshot_interval_ms = (elapsed - snapshot_received_at) * 1000.0
			snapshot_received_at = elapsed
			var previous_phase := str(state.get("phase", ""))
			var previous_life := str(player.get("lifeState", ""))
			if not state.is_empty() and str(state.get("worldId",""))!=str(message.get("worldId","")):
				_reset_world_views()
				player={}
			state = message
			var previous_empty := player.is_empty()
			var previous_carrying: bool=player.get("carryingId")!=null
			player = _find(state.get("players", []), self_id)
			if not previous_carrying and player.get("carryingId")!=null: _stop_actions()
			if player.is_empty() and not token.is_empty():
				for actor in state.get("players", []):
					if str(actor.get("slotId", "")) == str(message.get("selfSlotId", "!")):
						self_id = str(actor.id)
						player = actor
			if not player.is_empty():
				spectator = false
				request_seq = maxi(request_seq, int(player.get("requestHighWater", 0)))
				input_seq = maxi(input_seq, int(player.get("inputAck", 0)))
				var mission_teleport := mission.active() and local_pos.distance_to(_v(player)) > 8
				if previous_empty or mission_teleport:
					local_pos = _v(player)
				if previous_empty or mission_teleport:
					yaw = float(player.get("yaw", 0))
					pitch = float(player.get("pitch", -0.06))
				var hp := int(player.get("hp", 100))
				if hp < last_hp:
					health_flash.color.a = maxf(health_flash.color.a,0.28)
					if shake_enabled: hurt_kick = maxf(hurt_kick,clampf(.4+(last_hp-hp)*.015,.4,1))
				last_hp = hp
			if previous_phase != str(state.get("phase", "")) or previous_life != str(player.get("lifeState", "")):
				selected_work = {}
				_stop_actions()
			_reconcile_building_work()
			_sync_world(network_state.changed)
			if is_instance_valid(social_view): social_view.sync(state)
			if overlay == "container" and not _container_has_content(_container(str(target.get("id","")))):
				target = {}
				_resume()
				_toast("物资已全部回收。",3)
			_update_hud()
			_refresh_panel_if_changed()
			snapshot_apply_ms = float(Time.get_ticks_usec() - apply_started) / 1000.0
			_send({"type":"snapshot_ack", "snapshotId":int(message.get("snapshotId", -1))})
			if platform_transport != null and previous_empty and not player.is_empty():
				if not visual_warmup_active:
					visual_warmup_active = true
					_finish_platform_loading.call_deferred()
		"result":
			sale_ui.result(message)
			var command_name := str(pending.get(int(message.get("requestId",0)),""))
			pending.erase(int(message.get("requestId", 0)))
			last_panel_signature=""
			if not bool(message.get("ok", false)):
				if command_name not in ["Fire","Melee"] or str(message.get("code",""))!="BUSY":
					_toast(str(message.get("message", "操作未完成")))
			else:
				if command_name=="Sell": _toast("已卖出 · 个人获得 %d 经费" % int(message.get("data",{}).get("credits",0)))
				elif command_name=="Craft": _toast("制作完成 · 已放入背包")
				elif command_name=="ModGear": _toast("改装完成 · 装备可直接使用")
				elif command_name=="DismantleGear": _toast("已拆解 · 材料和弹药放入背包")
				elif command_name=="RemoveModule": _toast("已拆除 · 返还材料放入背包")
				elif command_name=="TrialModule": _toast("试用已切换 · 不带入冒险")
				elif command_name=="FitAttachment": _toast("附件已装上")
				elif command_name=="RemoveAttachment": _toast("附件已取下 · 返还部分材料")
				elif command_name=="TrialAttachment": _toast("试用附件已切换 · 不带入冒险")
				elif command_name=="ReturnExpedition": _toast("外勤交付 · 奖励放入背包")
				elif command_name=="Donate": _toast("捐献完成 · 团队收到物资")
				last_panel_signature = ""
		"event":
			_event(message)
		"error":
			last_error = str(message.get("message", "连接暂不可用"))
			lobby_note.text = last_error
			_toast(last_error)

# Finish the current network batch before temporarily isolating local warmup FX.
# The host Worker keeps saving while the first WebGL programs are prepared.
func _finish_platform_loading() -> void:
	var transport = platform_transport
	if not joined or leaving or transport == null:
		visual_warmup_active = false
		return
	set_process(false)
	if OS.has_feature("web") and not visual_warmup_done:
		JavaScriptBridge.eval("window.tidalTransport?.loading({phase:'warmup'})")
		camera.position = local_pos + Vector3.UP * eye_height
		camera.rotation = Vector3(pitch, yaw, 0)
		await VisualWarmup.run(view)
		visual_warmup_done = true
	visual_warmup_active = false
	if not is_inside_tree():
		return
	set_process(true)
	if joined and not leaving and platform_transport == transport:
		if overlay == "chat":
			lobby.visible = false
			panel.visible = false
			platform_previous_overlay = ""
		else:
			_resume(false)
		_publish_platform_ui()
		transport.loaded()

func _event(event: Dictionary) -> void:
	var event_id := str(event.get("eventId",""))
	if not event_id.is_empty():
		if seen_events.has(event_id):
			return
		seen_events[event_id] = true
		if seen_events.size()>512:
			seen_events.erase(seen_events.keys()[0])
	if is_instance_valid(social_view): social_view.handle_event(event)
	var payload: Dictionary = event.get("payload",{})
	var kind := str(event.get("eventType",""))
	var actor_id := str(payload.get("actorId",event.get("entityId","")))
	var mine := actor_id==self_id
	if kind == "PositionCorrected" and mine:
		local_pos = _v(payload.get("position", player))
		_stop_actions()
		_toast("建筑修好了，已帮你移到旁边。", 3)
	elif kind == "MissionTeleported" and mine:
		local_pos = _v(payload.get("position", player))
		yaw = float(payload.get("yaw", yaw))
		pitch = float(payload.get("pitch", pitch))
		_stop_actions()
	elif kind == "EnemyAttackWarning":
		var attack := str(payload.get("attackKind",""))
		var cue := "broadcast" if attack == "rally" else ("motor_start" if attack in ["shredder_advance","printer_shift","coffee_line","coffee_ring"] else ("stamp" if attack=="stamp_press" else "paper_wave"))
		_cue_at(cue,_v(payload.get("position",{})),38.0,.9,64,str(payload.get("enemyId",event_id)))
	elif kind in ["EnemyHeal","ToolUsed","EnemyInterrupted","EnemyWeakPoint","EnemyRally"]:
		if payload.get("position") is Dictionary:
			var at := _v(payload.position)
			if at.distance_to(local_pos)<35: view.ripple(at+Vector3(0,0.07,0))
		if kind=="EnemyInterrupted":
			var enemy_id := str(payload.get("enemyId",""))
			if enemies.has(enemy_id): enemies[enemy_id].get_node("Rig").play_action("interrupt",payload)
		elif kind=="ToolUsed":
			var tool_cue:=str({"folding_cover":"impact_metal","tape_trap":"paper_throw","scan_note":"broadcast"}.get(str(payload.get("definitionId","")),""))
			if not tool_cue.is_empty(): _cue_at(tool_cue,_v(payload.get("position",{})),18,.55,32,str(payload.get("actorId",event_id)))
			if mine: _toast("工具已使用")
	elif kind=="EnemyProjectileImpact":
		var projectile_id := str(payload.get("projectileId",""))
		var at := _v(payload.get("position",{}))
		ended_projectiles[projectile_id]=true
		while ended_projectiles.size()>128: ended_projectiles.erase(ended_projectiles.keys()[0])
		if projectiles.has(projectile_id):
			projectiles[projectile_id].finish(at)
			projectiles[projectile_id].queue_free()
			projectiles.erase(projectile_id)
		if str(payload.get("surface","air"))!="air" and at.distance_to(local_pos)<28:
			view.impact(at,_v(payload.get("normal",{"x":0,"y":1,"z":0})),str(payload.get("surface","air")),str(payload.get("targetId","")))
	elif kind=="EnemyAttackResolved":
		var zone: Dictionary=payload.zone if payload.get("zone") is Dictionary else {}
		var enemy_id := str(payload.get("enemyId",""))
		var strike_payload: Dictionary=payload.duplicate()
		var authority_now := float(state.get("time",0))+minf(maxf(elapsed-snapshot_received_at,0),.15)
		strike_payload["age"]=maxf(0,authority_now-float(payload.get("attackActionAt",authority_now)))
		if enemies.has(enemy_id): enemies[enemy_id].get_node("Rig").play_action("attack",strike_payload)
		var at := _v(payload.get("position",{}))
		if at.distance_to(local_pos)<38 and payload.get("animate")!=false:
			view.enemy_strike(strike_payload)
			var attack := str(payload.get("attackKind","melee"))
			var cue := "paper_wave" if attack in ["shredder_fan","printer_wave","paper_lob"] else "stamp" if attack in ["slam","stamp_press","stamp_marks"] else "impact_metal" if attack in ["overload_ring","power_burst","breach"] else "swing"
			if float(strike_payload.age)<.6: _cue_at(cue,at,32,.85 if str(payload.get("definitionId","")).begins_with("boss") else .6,66,enemy_id)
		if str(payload.get("definitionId",""))=="ink_cuttle":
			if at.distance_to(local_pos)<30: view.ink_spray(at,float(zone.get("yaw",0)))
	elif kind=="ObjectiveCompleted":
		_toast("目标完成 · 奖励在办公室 · C 选能力",4)
	elif kind=="RewardsAvailable":
		_toast("获得新能力 · 按 C 选择",4)
	elif kind=="RewardChosen" and mine:
		_toast("获得能力："+_name(str(payload.get("perkId",""))))
	elif kind == "Action":
		var action := str(payload.get("action",""))
		var action_key := action.to_lower()
		if actors.has(actor_id):
			actors[actor_id].get_node("Rig").play_action(action,payload)
		if action_key=="interact" and str(payload.get("workKind",""))=="SearchArchive":
			if mine:
				_cue("archive_rummage",0.9,0.0,70,false,self_id)
			elif actors.has(actor_id):
				_cue_at("archive_rummage",actors[actor_id].position,16.0,0.62,44,actor_id)
		elif action_key == "punch" and not mine and actors.has(actor_id):
			_cue_at("swing",actors[actor_id].position,18.0,0.4,44,actor_id)
		elif action_key == "reload":
			var weapon_id := str(payload.get("definitionId",payload.get("weaponId","")))
			var reload_cue := "reload_" + weapon_id if AimProfile.is_gun(weapon_id) else "reload"
			if mine:
				_cue(reload_cue,1.0,0.0,76,false,self_id)
			elif actors.has(actor_id):
				_cue_at(reload_cue,actors[actor_id].position,20.0,0.58,58,actor_id)
		elif action_key == "reload_insert":
			if mine:
				_cue("reload_insert_shotgun",1.0,0.0,76,false,self_id)
			elif actors.has(actor_id):
				_cue_at("reload_insert_shotgun",actors[actor_id].position,16.0,0.55,56,actor_id)
		elif action_key in ["equip","cast","hook"]:
			if mine:
				_cue(action_key,1.0,0.0,62,false,self_id)
			elif actors.has(actor_id):
				_cue_at(action_key,actors[actor_id].position,20.0,0.45,42,actor_id)
	elif kind=="ArchiveOpened":
		var at := _v(payload.get("position",{}))
		_cue_at("archive_open",at,20.0,0.9,58,str(payload.get("targetId",event_id)))
		if mine:
			_toast("档案柜已打开 · 物资在前方",3)
	elif kind=="CopierArmed":
		var at := _v(payload.get("position",{}))
		view.burst(at,Color("ffcc66"),5,0.34)
		_cue_at("charge_copier",at,24.0,0.8,62,str(payload.get("targetId",event_id)))
	elif kind=="CopierChain":
		var from := _v(payload.get("from",{}))
		var to := _v(payload.get("to",{}))
		view.copier_chain(from,to)
	elif kind == "GearPierced":
		view.tracer(_v(payload.get("from",{})),_v(payload.get("to",{})),"rifle")
	elif kind=="ReloadBeat":
		var cue := "reload_insert_shotgun" if str(payload.get("beat",""))=="shells" else "reload_doublebarrel"
		if mine: _cue(cue,.85,0.0,72,false,self_id)
		elif actors.has(actor_id): _cue_at(cue,actors[actor_id].position,18.0,.5,52,actor_id)
	elif kind == "GearPulse" and mine:
		var cue := str(payload.get("cue",""))
		gear_feedback_text = str({"burst_rest":"三连停顿","focus_ready":"专注就绪","heat_rest":"停火散热","kill_load":"击杀补弹 +2","walk_load":"走装补弹 +1","suppressed":"压制生效"}.get(cue,""))
		gear_feedback_until = Time.get_ticks_msec()+1100
	elif kind == "Shot":
		var id := str(payload.get("shotId",event_id))
		var gun := str(payload.get("weapon","carbine"))
		if not seen_shots.has(id):
			seen_shots[id] = true
			if seen_shots.size()>128:
				seen_shots.erase(seen_shots.keys()[0])
			if AimProfile.is_gun(gun):
				if mine:
					view.fire()
					var recoil_factor := (0.62 if secondary_held else 1.0)*(0.85 if bool(player.get("crouching",false)) else 1.0)
					pitch=clampf(pitch+deg_to_rad(float(payload.get("recoilPitch",0.8)))*recoil_factor,-1.48,1.48)
					yaw+=deg_to_rad(float(payload.get("recoilYaw",0)))*recoil_factor
					_cue(gun,1.0,0.0,100,false,self_id)
				elif actors.has(actor_id):
					view.remote_muzzle(actors[actor_id].get_node("Rig").muzzle_position())
					_cue_at(gun,_v(payload.get("from",{})),55.0,0.82,72,actor_id)
			elif gun=="fortress_turret":
				if turrets.has(actor_id):
					turrets[actor_id].fire()
				view.remote_muzzle(_v(payload.get("from",{})))
				_cue_at("carbine",_v(payload.get("from",{})),42.0,0.45,66,actor_id)
		if payload.has("from") and payload.has("to"):
			var start := _v(payload.from)
			var end := _v(payload.to)
			if mine and start.distance_to(end)>2:
				start = view.muzzle_position()
			elif actors.has(actor_id) and start.distance_to(end)>2:
				start = actors[actor_id].get_node("Rig").muzzle_position()
			view.tracer(start,end,gun)
	elif kind == "Impact":
		var at := _v(payload.get("position",payload.get("to",{})))
		var surface := str(payload.get("surface","ground"))
		var impact_target := str(payload.get("targetId",event.get("entityId","")))
		view.impact(at,_v(payload.get("normal",{"x":0,"y":1,"z":0})),surface,impact_target)
		var impact_cue := ""
		var impact_prop_kind := ""
		if destructibles.has(impact_target):
			impact_prop_kind = str(destructibles[impact_target].get_meta("data",{}).get("kind",""))
		if impact_prop_kind == "partition_panel":
			impact_cue = "impact_partition"
		elif impact_prop_kind == "copier_shell":
			impact_cue = "impact_copier"
		elif impact_prop_kind == "barricade":
			impact_cue = "impact_barricade"
		elif surface in ["wood","wall","gate","building"]:
			impact_cue = "impact_wood"
		elif surface in ["metal","terminal","turret","core"]:
			impact_cue = "impact_metal"
		elif surface in ["glass","window"]:
			impact_cue = "impact_glass"
		elif surface in ["ground","terrain","rock","unknown"]:
			impact_cue = "impact_hard"
		if not impact_cue.is_empty():
			_cue_at(impact_cue,at,30.0,0.92,74 if mine else 52,str(payload.get("shotId",event_id)))
	elif kind == "Hit":
		if bool(payload.get("protected",false)) or int(payload.get("damage",0))<=0:
			return
		var at := _v(payload.get("position",{}))
		var target_id := str(payload.get("targetId",event.get("entityId","")))
		var killed := bool(payload.get("killed",false)) and str(payload.get("targetKind",""))!="player"
		if killed: view.clear_surface_marks(target_id)
		var weak := bool(payload.get("weak",false))
		if mine:
			last_hit_killed = killed
		view.confirm_hit(at,int(payload.get("damage",0)),killed,mine,weak,bool(payload.get("shielded",false)))
		var target_node = enemies.get(target_id,actors.get(target_id))
		if target_node != null:
			target_node.get_node("Rig").play_action("hit",payload)
			if killed and str(payload.get("targetKind",""))=="enemy":
				target_node.get_node("Rig").play_action("death",payload)
		if target_id==self_id:
			health_flash.color.a=maxf(health_flash.color.a,clampf(.30+float(payload.get("damage",0))*.005,.30,.50))
			var incoming := -_v(payload.get("direction",{}))
			if incoming.length_squared()>.001:
				var local_direction := incoming.rotated(Vector3.UP,-yaw)
				hurt_direction=Vector2(local_direction.x,local_direction.z).normalized()
				hurt_direction_until=Time.get_ticks_msec()+750
			if shake_enabled: hurt_kick=maxf(hurt_kick,clampf(.4+float(payload.get("damage",0))*.015,.4,1))
			_cue("hurt")
		elif str(payload.get("targetKind","")) in ["enemy","player"]:
			var body_cue := "impact_creature"
			if weak:
				body_cue = "impact_weak"
			elif bool(payload.get("shielded",false)) or str(payload.get("definitionId","")) in ["boss_crab","boss_shredder","boss_printer","boss_stamp_press","boss_coffee_boiler"]:
				body_cue = "impact_armor"
			_cue_at(body_cue,at,34.0,0.9,76 if mine else 58,str(payload.get("shotId",event_id)))
		if mine:
			_cue("kill" if killed else ("weak" if weak else "hit"),0.76 if killed else (0.66 if weak else 0.42),0.0,78)
		if destructibles.has(target_id):
			destructibles[target_id].set_meta("hit_flash",0.2)
		if killed and turrets.has(target_id):
			view.destruction(turrets[target_id].position+Vector3.UP*1.5,"barricade",int(state.get("serverTick",1)))
			_cue_at("break_metal",turrets[target_id].position,24.0,0.68,62,target_id)
	elif kind == "Destroyed":
		var at := _v(payload.get("position",{}))
		var destroyed_kind := str(payload.get("kind","crate"))
		view.destruction(at,destroyed_kind,int(payload.get("seed",1)))
		var break_cue := "break_wood"
		if destroyed_kind == "partition_panel":
			break_cue = "break_partition"
		elif destroyed_kind == "copier_shell":
			break_cue = "break_copier"
		elif destroyed_kind == "barricade":
			break_cue = "break_barricade"
		elif destroyed_kind in ["barrel","archive_cabinet","supply_locker","cable_reel","punch_clock","terminal","turret","equipment"]:
			break_cue = "break_metal"
		elif destroyed_kind in ["glass","window"]:
			break_cue = "break_glass"
		_cue_at(break_cue,at,24.0,0.92,60,str(payload.get("targetId",event.get("entityId",""))))
		var id := str(payload.get("targetId",event.get("entityId","")))
		view.clear_surface_marks(id)
		if destructibles.has(id):
			destructibles[id].queue_free()
			destructibles.erase(id)
	elif kind=="TurretChanged" and mine:
		if str(selected_work.get("id",""))==str(payload.get("targetId","")) and str(payload.get("kind",""))!="RepairTurret":
			selected_work={}
			_toast(str({"InstallTurret":"炮台已就位", "UpgradeTurret":"炮台升级完成", "ReloadTurret":"炮台弹药已补满"}.get(str(payload.get("kind","")),"炮台维护完成")))
	elif kind in ["Notice","BreachResolved","PhaseChanged","RecoveryChanged"]:
		if kind == "RecoveryChanged" and str(payload.get("targetId", "")) == "core" and str(selected_work.get("command", "")) == "RecoveryWork":
			selected_work = {}
		if payload.has("message"):
			_toast(str(payload.message),5)
		if kind=="PhaseChanged":
			_cue("phase",0.6)
	elif kind=="LifeChanged":
		var id := str(event.get("entityId",""))
		if actors.has(id):
			var rig = actors[id].get_node("Rig")
			if str(payload.get("state",""))=="DEAD_WAIT":
				rig.play_action("death")
			elif str(payload.get("state",""))=="ALIVE":
				rig.restore_alive()
	elif kind=="SaveResult" and payload.get("error")!=null:
		_toast("保存暂时失败，请保持服务器运行并稍后重试。",10)

func _audibility(id: String) -> float:
	if not actors.has(id):
		return 0.0
	return clampf(1-local_pos.distance_to(actors[id].position)/45.0,0,1)

func _cue_pan(at: Vector3) -> float:
	var offset := at-local_pos
	offset.y = 0
	if offset.length_squared()<0.01:
		return 0.0
	var right := Vector3(cos(yaw),0,-sin(yaw))
	return clampf(offset.normalized().dot(right),-1.0,1.0)

func _cue_at(kind: String,at: Vector3,max_distance := 45.0,gain := 1.0,priority := -1,source_key := "") -> void:
	var distance := local_pos.distance_to(at)
	if distance>=max_distance:
		return
	var attenuation := pow(1.0-distance/max_distance,1.35)
	_cue(kind,gain*attenuation,_cue_pan(at),priority,distance>max_distance*0.38,source_key)

func _cue(kind: String,gain := 1.0,pan := 0.0,priority := -1,distant := false,source_key := "") -> void:
	if cue_audio==null:
		cue_audio=CueAudio.new()
		add_child(cue_audio)
	cue_audio.play(kind,gain*volume,pan,priority,distant,source_key)

func _toast(value: String, duration := 3.0) -> void:
	if toast_label.text == value and elapsed < toast_until - duration + 1:
		return
	toast_label.text = value
	toast_label.tooltip_text = value
	toast_until = elapsed + duration

func _tone(frequency: float, duration: float) -> void:
	if volume <= 0:
		return
	if OS.has_feature("web") and bool(JavaScriptBridge.eval("!!window.islandAudioFallback")):
		JavaScriptBridge.eval("window.playIslandTone(%s,%s)" % [str(frequency), str(duration)])
		return
	var stream := AudioStreamWAV.new()
	stream.mix_rate = 22050
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	var bytes := PackedByteArray()
	bytes.resize(int(duration * 22050) * 2)
	for i in range(bytes.size() / 2):
		var fade := 1.0 - float(i) / float(bytes.size() / 2)
		var sample := int(sin(float(i) / 22050 * frequency * TAU) * fade * 5200 * volume)
		bytes.encode_s16(i * 2, sample)
	stream.data = bytes
	sound.stream = stream
	sound.play()

func _label3d(parent: Node3D, value: String, at: Vector3, color := CREAM) -> Label3D:
	var label := Label3D.new()
	label.font = FONT
	label.font_size = 28
	label.pixel_size = 0.005
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.modulate = color
	label.outline_size = 6
	label.text = value
	parent.add_child(label)
	label.position = at
	return label

func _sync_world(changed: Array) -> void:
	world.show_training_area(state.get("world",{}).get("terminals",[]))
	if "waterY" in changed or "phase" in changed:
		world.set_tide(float(state.get("waterY", 0)), str(state.get("phase", "PREP")))
	if "clock" in changed and state.get("clock") is Dictionary:
		world.set_clock(float(state.clock.get("progress",0.5)))
	if "buildings" in changed:
		world.sync_buildings(state.get("buildings", []))
	if "turrets" in changed:
		_sync_turrets()
	if "players" in changed:
		_sync_actors()
	if "enemies" in changed:
		_sync_enemies()
	if "destructibles" in changed:
		_sync_destructibles()
	if "nodes" in changed or "containers" in changed or "items" in changed or "recovery" in changed or "waterY" in changed:
		_sync_objects()
	if "projectiles" in changed:
		_sync_projectiles()
	if "director" in changed:
		_sync_deployables()
	if "players" in changed or "waterY" in changed:
		_sync_fishing_lines()
	if "exploration" in changed:
		if not is_instance_valid(exploration_view):
			exploration_view=ExplorationView.new()
			add_child(exploration_view)
		exploration_view.sync_state(state,destructibles)
	_sync_impact_surfaces()

func _sync_impact_surfaces() -> void:
	var sources := {}
	for id in destructibles:
		var prop = destructibles[id]
		if is_instance_valid(prop) and not prop.is_queued_for_deletion():
			sources[id] = {"node":prop.visual,"signature":"prop"}
	for id in world.building_nodes:
		var node: Node3D = world.building_nodes[id]
		var data: Dictionary = node.get_meta("surface_data",{})
		if float(data.get("hp",0)) <= 0: continue
		var group: Node3D = node.get_node("Damaged" if float(data.hp) <= float(data.maxHp)*0.5 else "Intact")
		var signature := str(data.get("gateOpen",false))+":"+str(data.get("level",1))
		if group.visible: sources[str(node.get_meta("authority_id",id))] = {"node":group,"signature":signature}
	for node in world.map_root.get_children():
		if node.has_meta("authority_id") and not sources.has(str(node.get_meta("authority_id"))):
			var id := str(node.get_meta("authority_id"))
			if not _find(state.get("world",{}).get("terminals",[]),id).is_empty(): sources[id]={"node":node,"signature":"station"}
	# Rocks are immutable for this map generation; map_root is freed on a rebuild.
	for rock in world.ROCKS: sources[str(rock.id)]={"node":world.map_root,"signature":"rock"}
	view.sync_impact_sources(sources,float(state.get("waterY",-1000)))

func _sync_actors() -> void:
	var active_ids: Array = []
	for data in _online_players():
		var id := str(data.id)
		if id == self_id:
			continue
		active_ids.append(id)
		if not actors.has(id):
			var node := Node3D.new()
			add_child(node)
			node.position = _v(data)
			var rig = Actor.new()
			rig.name = "Rig"
			node.add_child(rig)
			rig.setup("fisherman",maxi(0,int(data.get("slotId",1))-1))
			_label3d(node, "", Vector3(0, 2.3, 0), MINT)
			actors[id] = node
		var actor: Node3D = actors[id]
		actor.set_meta("data", data)
		actor.set_meta("target", _v(data))
		var visual_data: Dictionary = data.duplicate()
		visual_data["serverTime"] = state.get("time",0)
		var held_definition = data.get("heldDefinitionId", "")
		actor.get_node("Rig").apply_state(visual_data, "" if held_definition == null else str(held_definition))
		for child in actor.get_children():
			if child is Label3D:
				child.text = "%s%s" % [str(data.get("name", "队员")), " · 倒地" if str(data.get("lifeState")) == "DOWNED" else ""]
	_cleanup(actors, active_ids)

func _sync_enemies() -> void:
	var active_ids: Array = []
	for data in state.get("enemies", []):
		var id := str(data.id)
		active_ids.append(id)
		if not enemies.has(id):
			var node := Node3D.new()
			add_child(node)
			node.position = _v(data)
			var kind := str(data.get("definitionId", "crab"))
			var rig = Actor.new()
			rig.name = "Rig"
			node.add_child(rig)
			# Only warmed, distant normal enemies use their existing silhouette
			# first. Nearby threats, bosses and initial loading stay immediate.
			rig.setup(kind, 0, visual_warmup_done and local_pos.distance_squared_to(node.position) > 576.0)
			var warning := CombatZone.new()
			warning.name = "Warning"
			node.add_child(warning)
			enemies[id] = node
		var enemy: Node3D = enemies[id]
		enemy.set_meta("data", data)
		enemy.set_meta("target", _v(data))
		var visual_data: Dictionary = data.duplicate()
		visual_data["serverTime"] = state.get("time",0)
		enemy.get_node("Rig").apply_state(visual_data)
		# Late join / lost event: resume the already moving front, never restart it.
		if data.get("activeAttack") is Dictionary:
			var active_attack: Dictionary=data.activeAttack
			var attack_age := maxf(0,float(state.get("time",0))-float(data.get("attackActionAt",0)))
			if attack_age<float(active_attack.zone.get("duration",0)) and enemy.position.distance_to(local_pos)<38:
				view.enemy_strike({"enemyId":id,"definitionId":data.definitionId,"attackKind":data.get("attackActionKind",""),"attackActionSeq":data.get("attackActionSeq",0),"zone":active_attack.zone,"position":data,"age":attack_age})
		elif str(data.definitionId).begins_with("boss_"):
			view.cancel_enemy_strikes(str(id),true)
		var warning = enemy.get_node("Warning")
		var enemy_state := str(data.get("state", "")).to_upper()
		var attack_area: Dictionary = data.attackZone if data.get("attackZone") is Dictionary else {}
		# Body motion reads close attacks; only remote landing projections need a marker.
		warning.visible = enemy_state.contains("WINDUP") and (str(attack_area.get("presentation",""))=="projection" or str(data.get("attackKind","")) in ["puddle","paper_lob"])
		if warning.visible:
			var zone: Dictionary = attack_area
			warning.update_zone(zone,str(data.get("attackKind",""))=="heal")
		_set_lazy_label(enemy, "%s  %d/%d%s" % [_enemy_name(data), int(data.hp), int(data.maxHp), " · 弱点暴露！" if bool(data.get("weak", false)) else ""], Vector3(0, 3.2 if str(data.get("tier","")) == "boss" else 1.4, 0), GOLD)
	for id in enemies.keys():
		if not active_ids.has(id):
			view.cancel_enemy_strikes(str(id))
			var node: Node3D = enemies[id]
			node.get_node("Rig").play_action("death")
			for child in node.get_children():
				if child is Label3D or child.name=="Warning":
					child.hide()
			retiring.append({"node":node,"time":0.82})
			enemies.erase(id)

func _enemy_definition(kind: String) -> Dictionary:
	return _find(catalog.get("creatures", config.get("creatures", [])),kind)

func _enemy_name(data: Dictionary) -> String:
	var variant := str(data.get("variantId",""))
	if variant=="auditor": return "审计巨蟹"
	if variant=="overload": return "过载巨蟹"
	if str(data.get("tier",""))=="elite": return "精英 · "+_name(str(data.definitionId))
	return _name(str(data.definitionId))

func _finish_enemy_details() -> int:
	# Read the live collection each frame instead of retaining spawn payloads.
	# Removal, death and world reset therefore cannot resurrect stale jobs.
	var waiting: Array = []
	for node in enemies.values():
		var rig = node.get_node("Rig")
		if rig.details_pending and not rig._dead:
			waiting.append(node)
	waiting.sort_custom(func(a, b): return local_pos.distance_squared_to(a.position) < local_pos.distance_squared_to(b.position))
	var started := Time.get_ticks_usec()
	var built := 0
	for node in waiting:
		if built >= 2 or (built > 0 and Time.get_ticks_usec() - started >= 2000): break
		if node.get_node("Rig").finish_details(): built += 1
	return built

func _set_lazy_label(parent: Node3D, value: String, at: Vector3, color: Color) -> void:
	# Most world labels are never displayed. Keep their latest content without
	# shaping hundreds of hidden text meshes on the first DAY snapshot.
	parent.set_meta("world_label_content", {"text":value,"at":at,"color":color})
	var label := parent.get_node_or_null("WorldLabel") as Label3D
	if label != null and label.text != value: label.text = value

func _ensure_world_label(parent: Node3D) -> void:
	if parent.has_node("WorldLabel") or not parent.has_meta("world_label_content"): return
	var content: Dictionary = parent.get_meta("world_label_content")
	var label := _label3d(parent, str(content.text), content.at, content.color)
	label.name = "WorldLabel"
	label.visible = false

func _sync_deployables() -> void:
	var ids: Array = []
	for data in state.get("director",{}).get("deployables",[]):
		if float(data.get("remaining",0))<=0 or float(data.get("hp",1))<=0:continue
		var id := str(data.id)
		ids.append(id)
		if not deployables.has(id):
			var node = preload("res://survival/tactical_cover.gd").new() if str(data.kind)=="cover" else CombatZone.new()
			add_child(node)
			if str(data.kind)=="cover":node.setup(id)
			if str(data.kind)=="trap":
				view.box(node,Vector3(0,.065,0),Vector3(1.6,.07,.10),GOLD)
				view.box(node,Vector3(0,.066,0),Vector3(.10,.07,1.6),GOLD)
			if str(data.kind)=="decoy":
				view.box(node,Vector3(0,0.2,0),Vector3(0.34,0.4,0.16),GOLD)
				view.box(node,Vector3(0,0.21,-0.09),Vector3(0.25,0.27,0.025),CREAM)
			deployables[id]=node
		deployables[id].update_zone({"shape":"circle","x":data.x,"y":data.y,"z":data.z,"radius":float(data.radius) if str(data.kind)=="slow" else 0.65},str(data.kind)=="decoy")
	_cleanup(deployables,ids)

func _sync_objects() -> void:
	var active_ids: Array = []
	var entries: Array = []
	for data in state.get("nodes", []):
		if str(data.get("state", "")) not in ["depleted", "EMPTY", "DEPLETED"]:
			entries.append({"data":data, "type":"node"})
	for data in state.get("containers", []):
		if data.has("x") and str(data.get("type", "")) not in ["storage", "personal_storage"] and _container_has_content(data):
			entries.append({"data":data, "type":"container"})
	var recovery = state.get("recovery")
	if recovery is Dictionary:
		for data in recovery.get("debris", []):
			if not bool(data.get("done", false)):
				entries.append({"data":data, "type":"debris"})
	for entry in entries:
		var data: Dictionary = entry.data
		var id := str(data.id)
		active_ids.append(id)
		if not objects.has(id):
			var object := Node3D.new()
			add_child(object)
			object.position=_v(data)
			objects[id] = object
		var object: Node3D = objects[id]
		object.position = _v(data)
		if entry.type == "container":
			object.position = _container_position(data)
		object.set_meta("data", data)
		object.set_meta("type", entry.type)
		# Keep interaction roots current. Only distant search scenery is deferred;
		# loot bags, recovery debris, nearby items and initial loading stay immediate.
		if not visual_warmup_done or entry.type != "node" or local_pos.distance_squared_to(object.position) <= 576.0:
			_build_object_visual(object)
		var object_name := "零件残骸" if str(data.get("kind", "")) == "scrap" else "旧工位 · 按住 E"
		if entry.type == "debris":
			object_name = "重建残骸 · 按住 E"
		elif entry.type == "container":
			object_name = "遗落背包 · E 查看"
			if int(data.get("recoverableC", 0)) + int(data.get("recoverableM", 0)) > 0:
				object_name = "失守回收箱 · E 抢救"
		_set_lazy_label(object, object_name, Vector3(0, 1.0, 0), MINT)
	_cleanup(objects, active_ids)

func _build_object_visual(object: Node3D) -> bool:
	if not is_instance_valid(object) or object.is_queued_for_deletion() or object.has_node("Visual"): return false
	var data: Dictionary = object.get_meta("data",{})
	if objects.get(str(data.get("id",""))) != object: return false
	var type := str(object.get_meta("type",""))
	var visual := Node3D.new()
	visual.name = "Visual"
	object.add_child(visual)
	if type == "container":
		OfficeScene.backpack_visual(visual)
	else:
		OfficeScene.search_visual(visual,"scrap" if type == "debris" else str(data.get("kind","treasure")))
		var footprint := Vector2(0.75,0.65) if type == "debris" or str(data.get("kind","")) == "scrap" else Vector2(1.20,0.60)
		TerrainSupport.attach(visual,object.position,footprint,world.ground_height)
	return true

func _finish_object_visuals() -> int:
	# Use the current collection and metadata: consumed, removed and reset objects
	# cannot be resurrected by a stale queued build. Nearest scenery is built first.
	var waiting: Array = []
	for object in objects.values():
		if is_instance_valid(object) and not object.is_queued_for_deletion() and not object.has_node("Visual"):
			waiting.append(object)
	waiting.sort_custom(func(a,b): return local_pos.distance_squared_to(a.position) < local_pos.distance_squared_to(b.position))
	var started := Time.get_ticks_usec()
	var built := 0
	for object in waiting:
		if built >= 2 or (built > 0 and Time.get_ticks_usec()-started >= 2000): break
		if _build_object_visual(object): built += 1
	return built

func _clear_projectile_views() -> void:
	for projectile in projectiles.values():
		projectile.finish(projectile.position)
		projectile.queue_free()
	projectiles.clear()
	ended_projectiles.clear()

func _sync_projectiles() -> void:
	var active_ids: Array = []
	for data in state.get("projectiles", []):
		var id := str(data.id)
		if ended_projectiles.has(id): continue
		active_ids.append(id)
		if not projectiles.has(id):
			var visual := ProjectileView.new()
			add_child(visual)
			projectiles[id] = visual
		projectiles[id].push_sample(data,float(state.get("time",0)))
	for id in projectiles.keys():
		if not active_ids.has(id):
			projectiles[id].finish(projectiles[id].position)
			projectiles[id].queue_free()
			projectiles.erase(id)


func _sync_destructibles() -> void:
	var ids: Array = []
	for data in state.get("destructibles",[]):
		if bool(data.get("broken",false)):
			continue
		var id := str(data.id)
		ids.append(id)
		if not destructibles.has(id):
			var node = Props.new()
			add_child(node)
			node.setup(data,world.ground_height)
			destructibles[id]=node
		destructibles[id].apply_state(data)
	_cleanup(destructibles,ids)

func _pick_aim_target() -> void:
	aim_target={}
	if not joined or not overlay.is_empty():
		return
	var origin := camera.global_position
	var direction := -camera.global_basis.z
	var best := 55.0
	var query := PhysicsRayQueryParameters3D.create(origin,origin+direction*best)
	var obstruction := get_world_3d().direct_space_state.intersect_ray(query)
	if not obstruction.is_empty():
		best=origin.distance_to(obstruction.position)
		var collider: Node = obstruction.collider
		if collider.has_meta("destructible_id"):
			var prop = destructibles.get(str(collider.get_meta("destructible_id")))
			if prop!=null:
				var data: Dictionary=prop.get_meta("data",{})
				aim_target={"name":str({"crate":"快递箱 · 可破坏","barrel":"补给桶 · 可破坏","barricade":"杂物挡板 · 可破坏","partition_panel":"办公隔断 · 可破坏","copier_shell":"复印机 · 打黄灯"}.get(str(data.get("kind","")),"可破坏物")),"hp":data.get("hp",0),"maxHp":data.get("maxHp",1)}
				if str(data.get("kind",""))=="copier_shell" and bool(data.get("armed",false)):
					aim_target.name="复印机 · 已蓄能"
				if str(data.get("kind","")) in Props.SEARCHABLE:
					var prop_name: String=str({"archive_cabinet":"档案柜","supply_locker":"储物柜","cable_reel":"绕线盘","punch_clock":"考勤机","notice_board":"公告板"}.get(str(data.kind),"物资"))
					aim_target.name="%s · %s" % [prop_name,"已拆取" if bool(data.get("opened",false)) else "静拆 / 响砸"]
	for node in enemies.values():
		var data: Dictionary=node.get_meta("data",{})
		var kind := str(data.get("definitionId","crab"))
		var center: Vector3=node.position+Vector3.UP*(float(_enemy_definition(kind).get("hit_height",1.0 if kind=="boss_crab" else 0.65)))
		var along := direction.dot(center-origin)
		var radius := float(_enemy_definition(kind).get("collision_radius",1.8 if kind=="boss_crab" else 0.75))
		if along>0 and along<best and (center-origin-direction*along).length()<radius:
			best=along
			var detail := " · 弱点暴露" if bool(data.get("weak",false)) else ""
			if str(data.get("source",""))=="wild":
				detail=" · "+str({"patrol":"巡逻","investigate":"警戒","chase":"追击"}.get(str(data.get("alertState","patrol")),"守卫"))
			elif str(data.get("source",""))=="fishing":
				detail=" · 击倒后回收"
			aim_target={"id":str(data.get("id","")),"name":_enemy_name(data)+detail,"hp":data.get("hp",0),"maxHp":data.get("maxHp",1)}

func _sync_turrets() -> void:
	var ids: Array = []
	for data in state.get("turrets",[]):
		var id := str(data.id)
		ids.append(id)
		if not turrets.has(id):
			var turret = Turret.new()
			add_child(turret)
			turret.setup(data,catalog.get("fortress",config.get("fortress",{})))
			turrets[id]=turret
		else:
			turrets[id].apply_state(data)
	_cleanup(turrets,ids)

func _cleanup(nodes: Dictionary, ids: Array) -> void:
	for id in nodes.keys():
		if not ids.has(id):
			nodes[id].queue_free()
			nodes.erase(id)

func _reset_world_views() -> void:
	if is_instance_valid(social_view): social_view.sync({})
	if is_instance_valid(exploration_view): exploration_view.clear()
	_clear_projectile_views()
	for collection in [actors,enemies,objects,projectiles,fishing_lines,destructibles,turrets,deployables]:
		_cleanup(collection,[])
	for entry in retiring:
		entry.node.queue_free()
	retiring.clear()
	view.clear_effects()
	seen_shots.clear()
	seen_events.clear()
	aim_target={}
	target={}
	selected_work={}
	_stop_actions()

func _sync_fishing_lines() -> void:
	var ids: Array = []
	for actor in _online_players():
		var cast = actor.get("fishing")
		if not cast is Dictionary:
			continue
		var pool: Dictionary = {"x":cast.get("x",0),"y":cast.get("y",state.get("waterY",0)),"z":cast.get("z",0)} if cast.has("x") else _find(state.get("pools", []), str(cast.get("poolId", "")))
		var id := str(actor.id)
		ids.append(id)
		if not fishing_lines.has(id):
			var node := FishingWater.create(view)
			add_child(node)
			fishing_lines[id]=node
		fishing_lines[id].set_meta("actor",actor)
		fishing_lines[id].set_meta("pool",pool)
	_cleanup(fishing_lines,ids)

func _animate_fishing_lines(delta: float) -> void:
	for id in fishing_lines:
		var node: Node3D=fishing_lines[id]
		FishingWater.update(self,node,node.get_meta("actor",{}),delta)

func _resume(allow_capture := true) -> void:
	panel_history.clear()
	lobby.visible = false
	panel.visible = false
	overlay = ""
	station_context = {}
	var capture_mouse := not free_mouse and allow_capture
	var platform_web := platform_transport != null and OS.has_feature("web")
	if platform_web:
		capture_mouse = capture_mouse and platform_game_entered
		if not capture_mouse:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	else:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if capture_mouse else Input.MOUSE_MODE_VISIBLE
	get_viewport().gui_release_focus()
	if OS.has_feature("web"):
		JavaScriptBridge.eval("document.getElementById('canvas').focus()")
	_publish_platform_ui()
	if platform_web and capture_mouse:
		platform_transport.capture()

func _stop_actions() -> void:
	primary_held = false
	secondary_held = false
	interaction_held = false
	jump_held = false
	drag_look = false
	move_direction = Vector2.ZERO
	rod_charge_started = -1.0

func _panel_can_back() -> bool:
	return not growth_confirmation.is_empty() or not panel_history.is_empty() or (overlay == "recycle" and not sale_ui.confirmation.is_empty() and sale_ui.pending_request == 0)

func _panel_back() -> void:
	if not growth_confirmation.is_empty():
		growth_confirmation=""
		_refresh_panel()
		return
	if overlay == "recycle" and not sale_ui.confirmation.is_empty() and sale_ui.pending_request == 0:
		sale_ui.confirmation = ""
		_refresh_panel()
		return
	if panel_history.is_empty(): return
	var previous: Dictionary = panel_history.pop_back()
	station_context = previous.station.duplicate(true)
	target = previous.target.duplicate(true)
	_open_panel(str(previous.mode),true)
	panel_shell_size = previous.size
	panel_scroll.set_deferred("scroll_vertical",int(previous.scroll))
	_queue_panel_layout()

func _open_subpanel(mode: String) -> void:
	panel_history.append({"mode":overlay,"size":panel_shell_size,"scroll":panel_scroll.scroll_vertical,"station":station_context.duplicate(true),"target":target.duplicate(true)})
	_open_panel(mode,true)

func _open_panel(mode: String, keep_history := false) -> void:
	if mode == "onboarding": mode = "mission" if mission.active() else "pause"
	if mode == "mission" and not mission.active(): mode = "pause"
	if not keep_history: panel_history.clear()
	growth_confirmation=""
	if mode in ["store", "storage", "upgrade", "recycle", "craft"]:
		var reason := _station_reason(_panel_station_type(mode))
		if not reason.is_empty():
			_toast(reason)
			return
	else:
		station_context = {}
	# Pick the surface once, before content is rebuilt. Item/party changes and
	# tab switches must never move the outside of an already open menu.
	panel_shell_size = _panel_preferred_size(mode)
	toast_until = 0
	toast_label.visible = false
	_stop_actions()
	selected_work = {}
	_command("CancelWork")
	if player.get("fishing") != null:
		_command("CancelFish")
	if mode=="recycle" and not keep_history: sale_ui.reset()
	overlay = mode
	panel.visible = true
	lobby.visible = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	last_panel_signature = ""
	panel_scroll.scroll_vertical = 0
	_refresh_panel()
	_publish_platform_ui()

func _panel_selection_open() -> bool:
	for control in panel.find_children("*", "OptionButton", true, false):
		if control.get_popup().visible:
			return true
	return false

func _refresh_panel_if_changed() -> void:
	if overlay not in ["pause", "inventory", "store", "storage", "upgrade", "recycle", "craft", "container", "building", "turret", "complete", "rewards", "mission", "social"]:
		panel_refresh_pending = false
		return
	# A Button emits pressed on release. Keep it alive across snapshots while the
	# pointer/key is held; release refreshes from the latest received state.
	if Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) or Input.is_key_pressed(KEY_ENTER) or Input.is_key_pressed(KEY_KP_ENTER) or Input.is_key_pressed(KEY_SPACE) or _panel_selection_open():
		panel_refresh_pending = true
		return
	panel_refresh_pending = false
	# Only data displayed by this panel may invalidate it. A teammate firing must
	# not recreate our loot/inventory buttons just because their ammo changed.
	var details: Array = [overlay, state.get("phase"), player.get("lifeState"), player.get("swimming")]
	match overlay:
		"social":
			details.append(social_ui.signature())
		"mission":
			details.append(mission.signature())
		"pause":
			var team: Array = []
			for member in _online_players():
				team.append([member.get("id"), member.get("name"), member.get("connected"), member.get("ready"), int(member.get("hp", 0)), member.get("lifeState")])
			details.append_array([team, state.get("hostId"), state.get("friendlyFire"), state.get("dayIndex"), state.get("threatStage"), state.get("maxPlayers"), state.get("night", {}).get("playerCount"), state.get("lockedPlayerCount"), state.get("statistics", {}).get("daysSurvived"),state.get("bank")])
		"rewards":
			details.append_array([player.get("perks",[]),player.get("rewardOffers",[]),state.get("director",{}).get("objective"),state.get("director",{}).get("optionalObjective"),state.get("expedition")])
		"inventory", "store", "storage", "upgrade", "recycle", "craft":
			var tool_ready := {"binding":player.get("quickItemDefinitionId")}
			for id in player.get("toolCooldowns",{}): tool_ready[id] = float(state.get("time",0)) >= float(player.toolCooldowns[id])
			details.append_array([player.get("perks",[]),player.get("rewardOffers",[]),tool_ready,int(player.get("hp",0)),player.get("work") != null,player.get("reload") != null,player.get("fishing") != null,_container(str(player.get("backpackId","")))])
			details.append_array([_items_in(str(player.get("backpackId", ""))), _equipped("weapon"), _equipped("rod"), _equipped("melee"), _near_terminal()])
			if overlay in ["store", "storage", "upgrade", "recycle", "craft"]:
				details.append_array([state.get("bank"), _personal_wallet(), _station_reason(_panel_station_type(overlay))])
			if overlay == "storage":
				var warehouse := _storage_container()
				details.append_array([storage_category, warehouse, _items_in(str(warehouse.get("id", ""))),state.get("expedition")])
		"container":
			var container_id := str(target.get("id", ""))
			details.append_array([_container(container_id), _items_in(container_id), _items_in(str(player.get("backpackId", "")))])
		"building":
			details.append_array([state.get("bank"), _find(state.get("buildings", []), str(target.get("id", ""))), state.get("recovery"), _recovery_ready(), _work_reason("Inspect",str(target.get("id","")))])
		"turret":
			details.append(state.get("fortressMode","output"))
			details.append_array([state.get("bank"), _find(state.get("turrets", []), str(target.get("id", ""))), _find(state.get("buildings", []), "core"), state.get("statistics", {}).get("daysSurvived"), _work_reason("InspectTurret",str(target.get("id","")))])
		"complete":
			details.append_array([state.get("dayIndex"), state.get("statistics"), state.get("hostId")])
	var signature := JSON.stringify(details)
	if signature != last_panel_signature:
		last_panel_signature = signature
		_refresh_panel()

func _refresh_panel() -> void:
	var focus_key := _panel_focus_key(get_viewport().gui_get_focus_owner())
	for child in panel_footer.get_children():
		panel_footer.remove_child(child)
		child.queue_free()
	panel_footer.visible = false
	var scroll := panel_scroll.scroll_vertical
	var storage_scrolls := {}
	for node in panel_content.find_children("*","ScrollContainer",true,false):
		if node.has_meta("storage_side"): storage_scrolls[node.get_meta("storage_side")] = node.scroll_vertical
	for child in panel_content.get_children():
		panel_content.remove_child(child)
		child.queue_free()
	var titles := {"social":"同事嬉戏", "rewards":"外勤手册", "pause":"队伍与冒险", "mission":"任务与试用", "inventory":"我的背包", "store":"补给台", "storage":"储物柜", "upgrade":"升级台", "recycle":"回收台", "craft":"制作台", "container":"地上的物品", "building":"建筑维护", "turret":"炮台", "settings":"操作设置", "complete":"这次冒险", "new_adventure":"新建冒险"}
	panel_title.text = str(titles.get(overlay,"办公室的99夜"))
	for child in panel_navigation.get_children():
		panel_navigation.remove_child(child)
		child.queue_free()
	if overlay in ["store", "storage", "upgrade", "recycle", "craft"]:
		var reason := _station_reason(_panel_station_type(overlay))
		if not reason.is_empty(): _text(panel_navigation,reason,14,GOLD)
	var bank: Dictionary = state.get("bank", {})
	if overlay in ["building", "turret"]:
		_visual_resources(panel_content, int(bank.get("credits", 0)) - int(bank.get("reservedCredits", 0)), int(bank.get("materials", 0)) - int(bank.get("reservedMaterials", 0)))
	match overlay:
		"social":
			social_ui.build(panel_content)
		"mission":
			mission.panel()
		"pause":
			_team_panel()
		"rewards":
			_tabs(panel_navigation,["外勤","能力"],rewards_category,func(index: int): rewards_category=index; panel_scroll.scroll_vertical=0; _refresh_panel())
			if rewards_category == 0: ExpeditionUI.build(self,false)
			else: InventoryUI.rewards(self)
		"inventory", "storage":
			_inventory_panel(overlay == "storage")
		"store":
			_store_panel()
		"upgrade":
			_upgrade_panel()
		"craft":
			CraftingUI.build(self)
		"recycle":
			_recycle_panel()
		"container":
			_container_panel()
		"building":
			_building_panel()
		"turret":
			_turret_panel()
		"settings":
			_settings_panel()
		"help":
			_help_panel()
		"about":
			_about_panel()
		"complete":
			_completion_panel()
		"new_adventure":
			_new_adventure_panel()
	if overlay in ["pause", "settings", "mission", "help", "about"]:
		panel_title.text = "系统菜单"
		var modes := ["pause", "mission", "settings", "help", "about"] if mission.active() else ["pause", "settings", "help", "about"]
		_tabs(panel_navigation,["队伍", "任务", "设置", "帮助", "关于"] if mission.active() else ["队伍", "设置", "帮助", "关于"],modes.find(overlay),func(index: int): _open_panel(modes[index]))
		if overlay != "mission": _system_footer()
	panel_back_button.visible = _panel_can_back()
	panel_back_button.tooltip_text = "Esc 返回上级"
	panel_navigation.visible = panel_navigation.get_child_count() > 0
	_queue_panel_layout()
	panel_scroll.set_deferred("scroll_vertical", scroll)
	for node in panel_content.find_children("*","ScrollContainer",true,false):
		if node.has_meta("storage_side"): node.set_deferred("scroll_vertical",int(storage_scrolls.get(node.get_meta("storage_side"),0)))
	if not focus_key.is_empty(): _restore_panel_focus.call_deferred(focus_key,overlay)

func _panel_focus_key(control: Control) -> String:
	if control == null or not (panel_content.is_ancestor_of(control) or panel_navigation.is_ancestor_of(control) or panel_footer.is_ancestor_of(control)): return ""
	var key := ""
	if control is TabBar:
		for index in range(control.tab_count): key += ":" + control.get_tab_title(index)
		return "tabs" + key
	if control is Button: key = "button:" + control.text
	else: return ""
	var node: Node = control
	while node != null and node != panel_content:
		if node.has_meta("focus_scope"): return key + ":" + str(node.get_meta("focus_scope"))
		node = node.get_parent()
	return key

func _restore_panel_focus(key: String, expected_overlay: String) -> void:
	if overlay != expected_overlay or not panel.visible: return
	var matches: Array[Control] = []
	for control in panel.find_children("*","Control",true,false):
		if control is Button and control.disabled: continue
		if _panel_focus_key(control)==key: matches.append(control)
	# Ambiguous/replaced actions lose focus instead of moving it to another item.
	if matches.size()==1: matches[0].grab_focus()

# Functional surfaces have stable bounds. Personal navigation shares one shell;
# independent ground loot selects a compact tier only when it is opened.
func _panel_preferred_size(mode: String) -> Vector2:
	if mode == "social": return Vector2(856,600)
	match mode:
		"container":
			var count := _items_in(str(target.get("id", ""))).size()
			return Vector2(448,300) if count <= 1 else Vector2(640,440) if count <= 6 else Vector2(856,560)
		"store": return Vector2(856,600)
		"storage": return Vector2(856,560)
		"recycle": return Vector2(640,600)
		"upgrade": return Vector2(640,520)
		"craft": return Vector2(640,360)
		"building": return Vector2(640,400)
		"turret": return Vector2(640,480)
		"complete", "new_adventure": return Vector2(560,360)
		"mission": return Vector2(856,560)
		_: return Vector2(856,560)

func _queue_panel_layout() -> void:
	if panel == null: return
	panel_layout_revision += 1
	# Only an actual viewport change may resize/recenter the saved surface.
	var layout_mode := platform_previous_overlay if overlay == "chat" else overlay
	if panel_shell_size == Vector2.ZERO: panel_shell_size = _panel_preferred_size(layout_mode)
	var available := Vector2(maxf(1,gui.size.x - 32),maxf(1,gui.size.y - 32))
	var surface := Vector2(minf(panel_shell_size.x,available.x),minf(panel_shell_size.y,available.y))
	panel.custom_minimum_size = surface
	panel.offset_left = -surface.x / 2
	panel.offset_right = surface.x / 2
	panel.offset_top = -surface.y / 2
	panel.offset_bottom = surface.y / 2
	_fit_panel_height.call_deferred(panel_layout_revision)

func _fit_panel_height(revision: int) -> void:
	# Settle internal scroll viewports only; never derive outer bounds from text.
	await get_tree().process_frame
	await get_tree().process_frame
	if revision != panel_layout_revision or not is_instance_valid(panel): return
	var layout_mode := platform_previous_overlay if overlay == "chat" else overlay
	if layout_mode == "storage":
		# Measure wrapped rows; fixed guessed heights can cut off the final action.
		var team_page := storage_category == 1 or player.get("vaultId") == null
		for scroll in panel_content.find_children("*","ScrollContainer",true,false):
			if not scroll.has_meta("storage_side") or scroll.get_child_count()==0: continue
			var rows: Node = scroll.get_child(0)
			var wanted := 0.0
			for index in range(mini(2 if team_page else 3,rows.get_child_count())):
				var row: Control = rows.get_child(index)
				wanted += row.get_combined_minimum_size().y + (8 if index>0 else 0)
			scroll.custom_minimum_size.y = clampf(wanted,48,maxf(48,panel_scroll.size.y-(220 if team_page else 96)))

func _tabs(parent: Node, labels: Array, selected: int, callback: Callable) -> TabBar:
	var tabs := TabBar.new()
	tabs.set_meta("ui_role","tabs")
	tabs.custom_minimum_size.y = 40
	tabs.tab_alignment = TabBar.ALIGNMENT_LEFT
	tabs.add_theme_font_size_override("font_size",15)
	tabs.add_theme_color_override("font_selected_color",GOLD)
	tabs.add_theme_color_override("font_unselected_color",Color("a1bdc3"))
	tabs.add_theme_color_override("font_hovered_color",CREAM)
	tabs.add_theme_color_override("font_disabled_color",Color("73898f"))
	for role in ["tab_selected","tab_unselected","tab_hovered","tab_disabled"]:
		var style := _button_style(Color("183641") if role=="tab_selected" else Color(0,0,0,0),0)
		style.content_margin_left = 24
		style.content_margin_right = 24
		style.content_margin_top = 8
		style.content_margin_bottom = 8
		style.border_color = GOLD if role=="tab_selected" else Color("39515a")
		style.border_width_bottom = 3 if role=="tab_selected" else 1
		tabs.add_theme_stylebox_override(role,style)
	for label in labels: tabs.add_tab(str(label))
	tabs.current_tab = selected
	tabs.tab_changed.connect(callback)
	parent.add_child(tabs)
	return tabs

func _item_icon(parent: Node, item_kind: String, color := MINT) -> Control:
	var glyph := preload("res://survival/item_icon.gd").new()
	glyph.kind=item_kind
	glyph.tint=color
	parent.add_child(glyph)
	return glyph

func _inventory_panel(storage_mode: bool) -> void:
	var backpack := _items_in(str(player.get("backpackId", "")))
	var warehouse := _storage_container()
	if storage_mode:
		if player.get("vaultId") != null:
			_tabs(panel_navigation,["个人", "团队", "外勤"],storage_category,func(index: int): storage_category=index; panel_scroll.scroll_vertical=0; _refresh_panel())
		if storage_category == 2:
			ExpeditionUI.build(self,true)
			return
		var personal := storage_category == 0 and player.get("vaultId") != null
		var stored := _items_in(str(warehouse.get("id","")))
		var list_height := float(mini(3 if personal else 2,maxi(1,maxi(backpack.size(),stored.size()))) * 88 - 8)
		var columns := HBoxContainer.new()
		columns.add_theme_constant_override("separation",16)
		panel_content.add_child(columns)
		var carried := _column(columns,8)
		carried.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_text(carried,"随身物品  %d / %d" % [backpack.size(),InventoryUI.capacity(self)],16,GOLD)
		var carried_list := _storage_list(carried,"carried",list_height)
		if backpack.is_empty(): _text(carried_list,"背包空了，右侧可以拿出物品。",13,MINT)
		for item in backpack:
			var row := _compact_row(carried_list,str(item.definitionId),_name(str(item.definitionId)),"×%d" % int(item.get("quantity",1)))
			row.tooltip_text = _item_text(item)
			if not warehouse.is_empty():
				var button := _button(row,"存入",func(): _station_command("Transfer","",{"itemId":str(item.id),"toContainerId":str(warehouse.id)}))
				button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
				_set_move_state(button,item,warehouse,"仓库已满")
		var shared := _column(columns,8)
		shared.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_text(shared,("个人仓库" if personal else "团队仓库")+"  %d / %d" % [stored.size(),int(warehouse.get("slotLimit",32))],16,GOLD)
		var shared_list := _storage_list(shared,"shared",list_height)
		if stored.is_empty(): _text(shared_list,"仓库空了，从左侧存入物品。",13,MINT)
		for item in stored:
			var row := _compact_row(shared_list,str(item.definitionId),_name(str(item.definitionId)),"×%d" % int(item.get("quantity",1)))
			row.tooltip_text = _item_text(item)
			var button := _button(row,"拿出",func(): _station_command("Transfer","",{"itemId":str(item.id),"toContainerId":str(player.get("backpackId",""))}))
			button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			_set_move_state(button,item,_container(str(player.get("backpackId",""))),"背包已满")
		var footer := HBoxContainer.new()
		panel_content.add_child(footer)
		var note := _text(footer,"存好后可带去朋友的冒险" if personal else "团队物资留在当前冒险",12,MINT)
		note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		note.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		if not personal: _donation_panel()
		return
	var equipment_row := HBoxContainer.new()
	equipment_row.add_theme_constant_override("separation",8)
	panel_content.add_child(equipment_row)
	for slot in ["weapon","rod","melee","quick"]:
		var item := _equipped(slot)
		var title := str({"weapon":"1 主枪","rod":"2 鱼竿","melee":"3 近战","quick":"4 道具"}[slot])
		var detail := "空手" if item.is_empty() else _name(str(item.definitionId))
		var row := _compact_row(equipment_row,str(item.get("definitionId",slot)),title,detail,GOLD if not item.is_empty() else Color("6b858f"))
		if not item.is_empty() and slot == "weapon":
			row.tooltip_text = "Lv.%d · %d 发" % [int(item.get("level",1)),int(item.get("magazineAmmo",0))]
	if _equipped("weapon").is_empty() and _equipped("rod").is_empty() and _equipped("melee").is_empty():
		_text(panel_content,"空手可挥拳 · 免费工具去补给台领取",14,GOLD)
	InventoryUI.build(self,backpack)
	_text(panel_content,"1—4 选择 · 左键使用 · E 救援／互动",12,MINT)

func _donation_panel() -> void:
	var bank: Dictionary = state.get("bank", {})
	var wallet := _personal_wallet()
	var balance := HBoxContainer.new()
	panel_content.add_child(balance)
	_text(balance,"团队",13,MINT)
	_visual_resources(balance,int(bank.get("credits",0))-int(bank.get("reservedCredits",0)),int(bank.get("materials",0))-int(bank.get("reservedMaterials",0)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation",12)
	panel_content.add_child(row)
	for contribution in [{"credits":50,"materials":0,"icon":"coin","title":"捐 50 经费"},{"credits":0,"materials":10,"icon":"scrap","title":"捐 10 零件"}]:
		var card := _compact_row(row,str(contribution.icon),str(contribution.title),"从个人钱包转入团队")
		card.set_meta("focus_scope",str(contribution.icon))
		var button := _button(card,"捐献",func(): _station_command("Donate","",{"credits":int(contribution.credits),"materials":int(contribution.materials)}),true)
		button.size_flags_vertical=Control.SIZE_SHRINK_CENTER
		var reason := _station_reason("storage")
		if reason.is_empty() and player.get("wallet") == null: reason="练习物资"
		if reason.is_empty() and (int(wallet.get("credits",0))-int(wallet.get("reservedCredits",0))<int(contribution.credits) or int(wallet.get("materials",0))-int(wallet.get("reservedMaterials",0))<int(contribution.materials)): reason="个人余额不足"
		_action_state(button,reason,"捐献后全队可用于建筑和炮台")


func _bind_quick(item_id: Variant) -> void:
	_command("BindQuick","",{"itemId":item_id})

func _quick_use_reason() -> String:
	if str(player.get("lifeState",""))!="ALIVE": return "倒地后无法使用"
	if bool(player.get("swimming",false)): return "上岸后再使用"
	if player.get("work")!=null or player.get("fishing")!=null or player.get("reload")!=null: return "请先完成当前动作"
	if view.equip_time>0: return "正在拿取道具"
	var id := str(_equipped("quick").get("definitionId",""))
	var remaining := maxf(0,float(player.get("toolCooldowns",{}).get(id,0))-float(state.get("time",0)))
	if remaining>0: return "冷却 %.1f 秒" % remaining
	if id=="bandage" and float(player.get("hp",0))>=float(config.player.max_hp): return "生命已满"
	if id=="coffee_flask" and float(player.get("stamina",0))>=float(config.player.stamina_max): return "体力已满"
	return ""

func _quick_hint() -> String:
	var reason := _quick_use_reason()
	if not reason.is_empty(): return reason
	return str({"bandage":"左键包扎 · 保持静止","coffee_flask":"左键喝咖啡 · 恢复体力","repair_kit":"靠近破损建筑 · 左键修复","flash_note":"左键投掷 · 暂时晕住怪物","decoy_alarm":"左键放置 · 吸引附近怪物","folding_cover":"左键立起 · 能挡弹也能被拆","tape_trap":"左键布置 · 绊住普通地面怪","scan_note":"左键扫描 · 标出可见怪物"}.get(str(_equipped("quick").get("definitionId","")),"左键挥拳 · Tab 可装入道具"))

func _use_tool(id: String) -> void:
	if str(player.get("heldSlot",""))!="quick" or _equipped("quick").is_empty(): return
	# One mouse press belongs to one tool use, even when its final item disappears.
	primary_held=false
	var reason := _quick_use_reason()
	if not reason.is_empty(): _toast(reason); return
	if id=="repair_kit":
		var nearest: Dictionary = {}
		var distance := 2.5
		for building in state.get("buildings",[]) + state.get("turrets",[]):
			if float(building.get("hp",0))<=0 or float(building.get("hp",0))>=float(building.get("maxHp",0)): continue
			var next := Vector2(local_pos.x-float(building.x),local_pos.z-float(building.z)).length()
			if next<=distance: distance=next;nearest=building
		if nearest.is_empty(): _toast("靠近受损的墙、门或炮台再使用");return
		_command("UseQuick",str(nearest.id))
	else:
		var at := local_pos + Vector3(-sin(yaw),0,-cos(yaw))*3.0
		_command("UseQuick","",{"x":at.x,"z":at.z})

func _storage_container() -> Dictionary:
	var station := _station_data()
	if str(station.get("type", "")) != "storage": return {}
	return _container(str(player.get("vaultId"))) if storage_category == 0 and player.get("vaultId") != null else _container(str(station.get("containerId", "")))

func _personal_wallet() -> Dictionary:
	return player.get("wallet") if player.get("wallet") is Dictionary else state.get("bank", {})

func _item_text(item: Dictionary) -> String:
	var value := _name(str(item.get("definitionId", "")))
	if int(item.get("quantity", 1)) > 1:
		value += " ×%d" % int(item.quantity)
	if AimProfile.is_gun(str(item.get("definitionId", ""))):
		value += " Lv.%d · %d发" % [int(item.get("level", 1)), int(item.get("magazineAmmo", 0))]
	if item.get("loanOwnerSlotId") != null:
		value += "（借用）"
	if item.get("moduleId") != null and not str(item.get("moduleId", "")).is_empty():
		value += " · " + CraftingUI.module_name(self,item)
	var accessory: Dictionary = CraftingUI.attachment_data(self,item)
	if not accessory.is_empty(): value += " · "+str(accessory.name)
	return value

func _store_panel() -> void:
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_END
	panel_content.add_child(actions)
	var budget := VBoxContainer.new()
	budget.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	budget.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_child(budget)
	var available: Dictionary = _personal_wallet()
	_visual_resources(budget,int(available.get("credits",0))-int(available.get("reservedCredits",0)),int(available.get("materials",0))-int(available.get("reservedMaterials",0)))
	var categories := ["补给","武器","钓具","免费工具"]
	_tabs(panel_navigation,categories,maxi(0,categories.find(store_category)),func(index: int): store_category=categories[index]; _refresh_panel())
	if str(state.get("phase"))=="NIGHT" and store_category!="免费工具":
		_text(panel_navigation,"夜间暂停购买 · 天亮后营业",13,GOLD)
	if store_category == "免费工具":
		var before := panel_content.get_child_count()
		_recovery_tools_panel()
		if panel_content.get_child_count() == before:
			_visual_card(panel_content,"rod_basic","工具齐全","丢失后可在这里领取",MINT)
		return
	var grid := _visual_grid(panel_content, 2)
	if store_category=="补给":
		var coupon_count := _item_count("coffee_coupon")
		var coupon_card := _visual_card(grid,"coffee_coupon","咖啡兑换","1 张券 → 1 杯咖啡",GOLD)
		var redeem := _button(coupon_card,"兑换",func(): _station_command("Redeem","",{"definitionId":"coffee_coupon"}),true)
		_action_state(redeem,"没有咖啡券" if coupon_count<=0 else _station_reason("shop"),"用随身的咖啡券兑换")
	var bank: Dictionary = _personal_wallet()
	for definition in config.items:
		if not definition.has("buy_c") or str(definition.id) == "knife" or bool(definition.get("craft_only", false)): continue
		var kind := str(definition.get("kind", ""))
		if (store_category == "武器" and kind != "weapon") or (store_category == "钓具" and kind != "rod") or (store_category == "补给" and kind not in ["ammo", "consumable", "tool"]): continue
		var id := str(definition.id)
		var descriptions := {"pistol":"单击重击 · 装填快", "smg":"近距快射 · 腰射灵活", "lmg":"站稳压制 · 移动较慢", "rod_light":"近岸快钓", "rod_heavy":"慢起竿 · 稳收线", "rod_magnet":"磁吸物资 · 上岸拾取", "carbine":"中程稳定 · 按住连射", "shotgun":"近距散射 · 逐发装填", "rifle":"远距重击 · 逐发拉栓", "rod_basic":"岸钓 · 12 米", "rod_pro":"岸钓 · 18 米", "ammo_light":"步枪 / 手枪 / 冲锋 / 机枪", "ammo_shell":"霰弹枪专用", "ammo_heavy":"狙击 / 半自动步枪", "bandage":"静止使用 · 恢复生命", "decoy_alarm":"诱敌 8 秒 · 道具栏使用", "repair_kit":"修复 120 · 不可重建", "coffee_flask":"恢复耐力 · 冷却 20 秒", "flash_note":"眩晕小怪 · 冷却 20 秒"}
		var quantity := int(definition.get("buy_quantity",1))
		var title := _name(id) + (" ×%d" % quantity if quantity>1 else "")
		var col := _visual_card(grid,id,title,str(OfficeTheme.EQUIPMENT_ROLES.get(id,descriptions.get(id,"行动补给"))),GOLD)
		var purchase_row := HBoxContainer.new()
		col.add_child(purchase_row)
		var price := _column(purchase_row,0)
		price.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		price.alignment = BoxContainer.ALIGNMENT_CENTER
		_visual_cost(price,int(definition.get("buy_c",0)),int(definition.get("buy_m",0)))
		var button := _button(purchase_row, "购买", func(): _station_command("Buy", "", {"definitionId":id, "replace":id == "rod_pro"}),true)
		var wrong_phase := str(state.get("phase")) in ["NIGHT", "COMPLETE"]
		var affordable := int(bank.get("credits", 0)) - int(bank.get("reservedCredits", 0)) >= int(definition.get("buy_c", 0)) and int(bank.get("materials", 0)) - int(bank.get("reservedMaterials", 0)) >= int(definition.get("buy_m", 0))
		var space := _purchase_fits(definition)
		var station_reason := _station_reason("shop")
		var reason := station_reason if not station_reason.is_empty() else "夜间休息" if wrong_phase else "资源不足" if not affordable else "背包已满" if not space else ""
		button.disabled = not reason.is_empty()
		if reason == "资源不足": reason = _funds_reason(int(definition.get("buy_c",0)),int(definition.get("buy_m",0)))
		_action_state(button,reason,"获得这件物品",not wrong_phase and station_reason.is_empty())
	if store_category == "钓具": _text(panel_content, "鱼竿：活鱼打倒后回收 · 磁吸竿：物资上岸后拾取", 12, MINT)


func _upgrade_panel() -> void:
	_tabs(panel_navigation,["强化","装配","能力"],upgrade_category,func(index: int): upgrade_category=index; growth_confirmation=""; panel_scroll.scroll_vertical=0; _refresh_panel())
	if upgrade_category == 1:
		CraftingUI.build_mods(self)
		return
	if upgrade_category == 2:
		InventoryUI.rewards(self)
		return
	var bank: Dictionary = _personal_wallet()
	_visual_resources(panel_content,int(bank.get("credits",0))-int(bank.get("reservedCredits",0)),int(bank.get("materials",0))-int(bank.get("reservedMaterials",0)))
	var guns: Array = _items_in(str(player.get("backpackId",""))).filter(func(item): return AimProfile.is_gun(str(item.definitionId)))
	var equipped := _equipped("weapon")
	if not equipped.is_empty(): guns.push_front(equipped)
	if guns.is_empty():
		_visual_card(panel_content,"repair","带上装备","枪可强化，每种枪和鱼竿都可改装。",MINT)
	for gun in guns:
		var level := int(gun.get("level",1))
		var reason := _station_reason("upgrade")
		if reason.is_empty(): reason = "夜间休息" if str(state.get("phase"))=="NIGHT" else "已升满" if level>=2 else "正在使用" if gun.get("lockedBy")!=null else ""
		var row := _compact_row(panel_content,str(gun.definitionId),_name(str(gun.definitionId))+"  Lv.%d" % level,"伤害 +20% · 装填加快",GOLD)
		var fees: Dictionary = CraftingUI._catalog(self).get("upgrades",{}).get(str(gun.definitionId),{})
		var cost_c := int(fees.get("credits",140))
		var cost_m := int(fees.get("materials",15))
		if level<2:
			_visual_cost(row.get_node("Details"),cost_c,cost_m,4)
			var missing := CraftingUI._ingredients(self,row.get_node("Details"),fees.get("ingredients",[]))
			if reason.is_empty(): reason=missing
		var button := _cost_button(row,"满级" if level>=2 else "升级",func(): _select_weapon_upgrade(str(gun.id)),cost_c,cost_m,reason.is_empty(),reason)
		button.size_flags_vertical=Control.SIZE_SHRINK_CENTER
		if not reason.is_empty(): button.tooltip_text=reason
		elif not button.disabled: button.tooltip_text="选定后，对准升级台按住 E"

func _recycle_panel() -> void:
	sale_ui.build(self)

func _recycle_loot_panel() -> void:
	var credits := 0
	var materials := 0
	for item in _items_in(str(player.get("backpackId",""))):
		var definition := _find(config.items,str(item.definitionId))
		if not SaleUI.is_loot(definition) or bool(definition.get("crafting_material",false)) or item.get("lockedBy")!=null or item.get("loanOwnerSlotId")!=null: continue
		var c := int(definition.get("sell_c",0))*int(item.quantity)
		var m := int(definition.get("deposit_m",0))*int(item.quantity)
		if c+m<=0: continue
		credits+=c
		materials+=m
		var row := _compact_row(panel_content,str(item.definitionId),_name(str(item.definitionId)),"×%d" % int(item.quantity),MINT)
		_visual_cost(row,c,m)
	if credits+materials==0:
		_visual_card(panel_content,"treasure","没有战利品","钓鱼、搜寻后带回来。",MINT)
	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation",12)
	panel_content.add_child(footer)
	var total := _column(footer,4)
	total.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	_text(total,"个人获得",13,MINT)
	if credits+materials>0: _visual_cost(total,credits,materials)
	else: _text(total,"0",16,CREAM)
	var button := _sell_button(footer)
	button.size_flags_vertical=Control.SIZE_SHRINK_CENTER

func _backpack_fits(definition_id: String, quantity: int) -> bool:
	var definition := _find(config.items,definition_id)
	var bag := _items_in(str(player.get("backpackId","")))
	var limit := int(_container(str(player.get("backpackId",""))).get("slotLimit",12))
	var stack := int(definition.get("stack",1))
	var available := (limit-bag.size()) * stack
	for item in bag:
		if str(item.get("definitionId",""))==definition_id and item.get("lockedBy")==null and item.get("loanOwnerSlotId")==null:
			available += stack-int(item.get("quantity",1))
	return available >= quantity

func _purchase_fits(definition: Dictionary) -> bool:
	var kind := str(definition.get("kind",""))
	if kind in ["weapon","rod","melee"]:
		var old := _equipped(kind)
		if old.is_empty(): return true
		if str(definition.id)=="rod_pro": return old.get("lockedBy")==null and _backpack_fits(str(old.definitionId),1)
	return _backpack_fits(str(definition.id),int(definition.get("buy_quantity",1)))

# Costs and locked states share one visible, short explanation throughout menus.
func _funds_reason(credits: int, materials: int) -> String:
	var bank: Dictionary = _personal_wallet() if overlay in ["store", "upgrade"] else state.get("bank",{})
	var c := maxi(0,credits-int(bank.get("credits",0))+int(bank.get("reservedCredits",0)))
	var m := maxi(0,materials-int(bank.get("materials",0))+int(bank.get("reservedMaterials",0)))
	var missing: Array[String] = []
	if c>0: missing.append("%d 经费" % c)
	if m>0: missing.append("%d 零件" % m)
	return "缺 " + " · ".join(missing) if not missing.is_empty() else ""

func _action_state(button: Button, reason: String, hint := "", show_reason := true) -> void:
	button.disabled = not reason.is_empty()
	button.tooltip_text = reason if button.disabled else hint
	button.set_meta("disabled_reason",reason)
	if reason.is_empty() or not show_reason: return
	var parent := button.get_parent()
	var destination: Node = null
	while parent != null and parent != panel_content and parent != panel_header:
		if parent.has_node("Details"):
			destination = parent.get_node("Details")
			break
		if parent.has_meta("item_definition") and parent is VBoxContainer:
			destination = parent
			break
		parent = parent.get_parent()
	if destination == null: return
	var label := _text(destination,reason,12,Color("f2b8a4"))
	label.set_meta("ui_role","action_reason")
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.max_lines_visible = 2
	label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	label.tooltip_text = reason

func _cost_button(parent: Node, label: String, callback: Callable, credits: int, materials: int, allowed := true, blocked_reason := "暂不可用") -> Button:
	var button := _button(parent,label,callback,true)
	var reason := "冒险已结束" if str(state.get("phase"))=="COMPLETE" else blocked_reason if not allowed else _funds_reason(credits,materials)
	_action_state(button,reason,"选定后，对准目标按住 E")
	return button

func _container_panel() -> void:
	var container := _container(str(target.get("id","")))
	if not _container_has_content(container):
		_text(panel_content,"这里的物品已取空。",15,MINT)
		return
	var items := _items_in(str(container.id))
	var backpack_size := _items_in(str(player.get("backpackId",""))).size()
	var summary := HBoxContainer.new()
	panel_content.add_child(summary)
	var space := _text(summary,"背包  %d / %d" % [backpack_size,InventoryUI.capacity(self)],14,MINT)
	space.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	space.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	if items.size() > 1:
		var take_all := _button(summary,"全部拿起",func(): _command("Pickup",str(container.id)),true)
		take_all.disabled = not items.any(func(item): return _item_move_reason(item,_container(str(player.get("backpackId",""))),"背包已满").is_empty())
		take_all.tooltip_text = "没有可拿起的物品，先整理背包" if take_all.disabled else "能装下的拿起，其余留在原地"
	if int(container.get("recoverableC",0))+int(container.get("recoverableM",0)) > 0:
		var rescued := _compact_row(panel_content,"storage","可拿回物资","",GOLD)
		_visual_cost(rescued.get_node("Details"),int(container.get("recoverableC",0)),int(container.get("recoverableM",0)))
		var button := _button(rescued,"拿回物资",func(): _command("Deposit",str(container.id)),true)
		button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var grid := _visual_grid(panel_content,1 if items.size() <= 6 else 2)
	for item in items:
		var row := _compact_row(grid,str(item.get("definitionId","")),_name(str(item.get("definitionId",""))),"×%d" % int(item.get("quantity",1)))
		row.tooltip_text = _item_text(item)
		var button := _button(row,"拿起",func(): _command("Pickup",str(container.id),{"itemId":str(item.id)}),items.size()==1)
		button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_set_move_state(button,item,_container(str(player.get("backpackId",""))),"背包已满")
	var note := "装不下的留在原地"
	if container.has("expiresAfterDay"): note += " · 保留至第 %d 天整备结束" % int(container.expiresAfterDay)
	var label := _text(panel_content,note,12,MINT)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.tooltip_text = "涨潮不会删除物资"


func _recovery_ready() -> bool:
	var recovery = state.get("recovery")
	return (recovery is Dictionary and bool(recovery.get("coreReady",false))) or float(_find(state.get("buildings",[]),"core").get("hp",0))>0

func _recovery_debris_status() -> Dictionary:
	var recovery = state.get("recovery")
	var debris: Array = recovery.get("debris", []) if recovery is Dictionary else []
	var cleared := 0
	for entry in debris:
		if bool(entry.get("done", false)): cleared += 1
	var total := debris.size() if not debris.is_empty() else int(config.get("recovery", {}).get("debris_tasks", 4))
	return {"cleared":cleared, "total":total, "complete":total > 0 and cleared >= total}

func _guide_recovery_core() -> void:
	var reason := _recovery_guide_reason()
	if not reason.is_empty(): _toast(reason); _refresh_panel(); return
	_resume()
	selected_work = {"command":"RecoveryWork", "id":"core"}
	_toast("去办公室中央找协作灯；对准后按住 E，免费重建。", 6)

func _recovery_guide_reason() -> String:
	if str(player.get("lifeState","")) != "ALIVE": return "恢复后可施工"
	if bool(player.get("swimming",false)): return "上岸后可施工"
	if str(state.get("phase","")) != "RECOVERY" or _recovery_ready(): return "协作灯已恢复"
	if not bool(_recovery_debris_status().complete): return "先清完所有残骸"
	return ""

func _building_panel() -> void:
	var building := _find(state.get("buildings", []), str(target.get("id", "")))
	if building.is_empty():
		_visual_card(panel_content, "wall", "未选中建筑", "看向附近建筑 · F")
		return
	var definition_id := str(building.definitionId)
	var col := _visual_card(panel_content, definition_id, "%s  Lv.%d" % [_name(definition_id), int(building.level)], "", GOLD)
	_visual_meter(col, "耐久", float(building.hp), float(building.maxHp), MINT)
	if definition_id == "gate" and int(building.hp) > 0:
		var is_open := bool(building.get("gateOpen", false))
		var gate_row := _compact_row(panel_content, "gate", "门已打开" if is_open else "门已关闭", "也可对准门按 E")
		var gate_button := _button(gate_row, "关门" if is_open else "开门", func():
			var reason := _work_reason("ToggleGate",str(building.id))
			if not reason.is_empty(): _toast(reason); _refresh_panel(); return
			_resume()
			selected_work = {}
			_command("ToggleGate", str(building.id), {"open":not is_open})
		, true)
		gate_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_action_state(gate_button,_work_reason("ToggleGate",str(building.id)))
	if str(state.get("phase")) == "RECOVERY" and not _recovery_ready():
		var debris := _recovery_debris_status()
		_visual_meter(panel_content, "已清理残骸（处）", int(debris.cleared), int(debris.total), GOLD)
		var seconds := int(config.get("recovery", {}).get("core_rebuild_seconds", 8))
		var recovery_card := _compact_row(panel_content, "core", "免费重建协作灯", "清完残骸后 · 按住 E %d 秒" % seconds, GOLD)
		var button: Button
		if definition_id == "core":
			button = _button(recovery_card, "选定重建", func(): _select_work("RecoveryWork", "core"), true)
		else:
			_text(panel_content, "上方是这处建筑的耐久，不是重建费用。", 13, MINT)
			button = _button(recovery_card, "去协作灯", _guide_recovery_core, true)
		button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var reason := _work_reason("RecoveryWork","core") if definition_id == "core" else _recovery_guide_reason()
		_action_state(button,reason,"不花经费或零件；没有装备也能重建")
		_text(panel_content, "先修灯，再修墙。按住 E 动手，松开即停。", 13, MINT)
		return
	var construction: Dictionary = catalog.get("construction", config.get("construction", {}))
	var choices: Array = []
	if int(building.hp) <= 0:
		choices.append({"icon":"repair","title":"重建","detail":"恢复 25% 耐久","kind":"Rebuild","credits":0,"materials":int(construction.get("rebuild_m",4)),"seconds":float(construction.get("rebuild_seconds",6))})
	else:
		if int(building.hp) < int(building.maxHp):
			choices.append({"icon":"repair","title":"修复","detail":"每轮最多 +%d 耐久" % int(construction.get("repair_hp",50)),"kind":"Repair","credits":0,"materials":int(construction.get("repair_m",1)),"seconds":float(construction.get("repair_seconds",2))})
		if int(building.level) < 2:
			var definition := _find(config.buildings,definition_id)
			choices.append({"icon":"wall","title":"加固升级","detail":"耐久上限 %d → %d\n保留当前耐久比例" % [int(building.maxHp),int(definition.level2_hp)],"kind":"Upgrade","credits":int(definition.upgrade_c),"materials":int(definition.upgrade_m),"seconds":float(construction.get("upgrade_seconds",4))})
	if definition_id == "core": _fortress_unlock_hint()
	if choices.is_empty():
		_text(panel_content,"防护已满 · 暂不需要维护",13,MINT)
		return
	var actions := _visual_grid(panel_content,mini(2,maxi(1,choices.size())))
	for choice in choices:
		var reason := _work_reason(str(choice.kind),str(building.id))
		if choices.size() == 1:
			var row := _compact_row(actions,str(choice.icon),str(choice.title),str(choice.detail))
			_visual_cost(row.get_node("Details"),int(choice.credits),int(choice.materials),float(choice.seconds))
			var button := _cost_button(row,str(choice.title),func(): _select_work(str(choice.kind),str(building.id)),int(choice.credits),int(choice.materials),reason.is_empty(),reason)
			button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		else:
			var work := _visual_card(actions,str(choice.icon),str(choice.title),str(choice.detail))
			_visual_cost(work,int(choice.credits),int(choice.materials),float(choice.seconds))
			_cost_button(work,str(choice.title),func(): _select_work(str(choice.kind),str(building.id)),int(choice.credits),int(choice.materials),reason.is_empty(),reason)
	_text(panel_content, "选定工作 → 朝向目标 → 按住 E", 14, GOLD).tooltip_text = "松开、移动或受伤会中断"



func _fortress_unlock_hint() -> void:
	var unlock: Dictionary = config.get("fortress",{}).get("unlock",{"coreLevel":2,"daysSurvived":2})
	var core := _find(state.get("buildings",[]),"core")
	var survived := int(state.get("statistics",{}).get("daysSurvived",0))
	var ready := int(core.get("level",1)) >= int(unlock.coreLevel) and survived >= int(unlock.daysSurvived)
	_text(panel_content,"炮台已解锁 · 到西北 / 东南平台按 F 安装" if ready else "炮台解锁：协作灯 %d/%d 级 · 守住 %d/%d 夜" % [mini(int(core.get("level",1)),int(unlock.coreLevel)),int(unlock.coreLevel),mini(survived,int(unlock.daysSurvived)),int(unlock.daysSurvived)],13,GOLD)

func _work_reason(kind: String, id: String) -> String:
	if str(state.get("phase","")) == "COMPLETE": return "冒险已结束"
	if str(player.get("lifeState","")) != "ALIVE": return "恢复后可施工"
	if bool(player.get("swimming",false)): return "上岸后可施工"
	var is_turret := kind.ends_with("Turret")
	var entity := _find(state.get("turrets" if is_turret else "buildings",[]),id)
	if entity.is_empty(): return "目标已不在"
	var delta := _v(entity) - _v(player)
	if Vector2(delta.x,delta.z).length() > float(config.player.interact_distance): return "靠近目标再操作"
	# Opening a gate is not construction: match E and the server even while
	# another teammate repairs it. Closing still uses server clearance checks.
	if kind == "ToggleGate": return ""
	if entity.get("lockedBy") != null and str(entity.lockedBy) != self_id: return "队友正在施工"
	if kind in ["Inspect", "InspectTurret"]: return ""
	if kind == "RecoveryWork": return _recovery_guide_reason()
	var hp := float(entity.get("hp",0))
	if is_turret:
		var core := _find(state.get("buildings",[]),"core")
		if float(core.get("hp",0)) <= 0: return "先重建协作灯"
		if str(state.get("phase","")) == "NIGHT" and kind in ["InstallTurret","UpgradeTurret"]: return "天亮后可安装和升级"
		if kind == "InstallTurret":
			if hp > 0: return "炮台已经建好"
			var unlock: Dictionary = config.fortress.unlock
			if int(entity.get("level",0)) == 0 and (int(core.get("level",1)) < int(unlock.coreLevel) or int(state.get("statistics",{}).get("daysSurvived",0)) < int(unlock.daysSurvived)): return "协作灯 %d 级 · 守住 %d 夜" % [int(unlock.coreLevel),int(unlock.daysSurvived)]
		else:
			if hp <= 0: return "先重建炮台"
			if kind == "UpgradeTurret" and int(entity.get("level",0)) >= 2: return "炮台已满级"
			if kind == "ReloadTurret" and int(entity.get("ammo",0)) >= int(entity.get("capacity",0)): return "弹药已满"
			if kind == "RepairTurret" and hp >= float(entity.get("maxHp",0)): return "耐久已满"
	else:
		if str(state.get("phase","")) == "RECOVERY" and not _recovery_ready(): return "先清残骸，再重建协作灯"
		if kind == "Rebuild":
			if hp > 0: return "建筑已经建好"
			if str(entity.get("definitionId","")) == "core": return "等待白天重建协作灯"
		else:
			if hp <= 0: return "先重建建筑"
			if kind == "Upgrade" and int(entity.get("level",1)) >= 2: return "建筑已满级"
			if kind == "Repair" and hp >= float(entity.get("maxHp",0)): return "耐久已满"
	return ""

func _select_work(kind: String, id: String) -> void:
	var reason := _work_reason(kind,id)
	if not reason.is_empty():
		_toast(reason)
		_refresh_panel()
		return
	_resume()
	if kind == "RecoveryWork" and id == "core":
		selected_work = {}
		if str(state.get("phase", "")) != "RECOVERY" or _recovery_ready():
			_toast("协作灯已恢复，可以继续行动。")
			return
		if not bool(_recovery_debris_status().complete):
			_toast("先清完所有残骸，再来免费重建。")
			return
	selected_work = {"command":kind, "id":id}
	_toast("已选择工作；按住 E 开始，松开取消。")

func _select_weapon_upgrade(id: String) -> void:
	var reason := _station_reason("upgrade")
	if not reason.is_empty(): _toast(reason); return
	var station_id := str(station_context.id)
	_resume()
	selected_work = {"command":"Upgrade", "id":id, "stationId":station_id}
	_toast("对准升级台，按住 E 升级；松开取消。")

func _reconcile_building_work() -> void:
	if selected_work.has("stationId"):
		var gun := _find(state.get("items",[]),str(selected_work.get("id","")))
		var station := _find(state.get("world",{}).get("terminals",[]),str(selected_work.stationId))
		var owned := str(gun.get("containerId","")) in [str(player.get("backpackId","")),str(player.get("equipment",{}).get("weapon",""))]
		var delta := _v(station) - _v(player)
		if gun.is_empty() or not owned or station.is_empty() or str(station.get("type",""))!="upgrade" or Vector2(delta.x,delta.z).length() > float(config.player.interact_distance) or bool(player.get("swimming",false)) or int(gun.get("level",1)) >= int(config.weapon_upgrade.max_level) or str(player.get("lifeState","")) != "ALIVE" or str(state.get("phase","")) in ["NIGHT","COMPLETE"]:
			selected_work = {}
		return
	var kind := str(selected_work.get("command", ""))
	if kind in ["Rebuild", "Repair", "Upgrade", "InstallTurret", "UpgradeTurret", "RepairTurret", "ReloadTurret"]:
		# Own active work stays selected; valid repair can run repeated cycles.
		# Snapshots also clear work that a teammate has already completed.
		if not _work_reason(kind,str(selected_work.get("id",""))).is_empty(): selected_work = {}

func _toggle_gate(id: String) -> void:
	selected_work = {}
	_command("ToggleGate", id)

func _turret_panel() -> void:
	var turret := _find(state.get("turrets",[]),str(target.get("id","")))
	if turret.is_empty():
		_text(panel_content,"靠近堡垒内两处炮台平台，按 F 管理。",16,MINT)
		return
	var fortress: Dictionary = catalog.get("fortress",config.get("fortress",{}))
	var unlock: Dictionary = fortress.get("unlock",{"coreLevel":2,"daysSurvived":2})
	var core := _find(state.get("buildings",[]),"core")
	var survived := int(state.get("statistics",{}).get("daysSurvived",0))
	var level := int(turret.get("level",0))
	var built := level>0
	var alive := float(turret.get("hp",0))>0
	var ready := int(core.get("level",1))>=int(unlock.coreLevel) and survived>=int(unlock.daysSurvived)
	_text(panel_content,"西北炮台" if str(turret.id)=="T01" else "东南炮台",20,CREAM)
	if not ready and not built:
		_text(panel_content,"解锁进度  协作灯 %d/%d级 · 成功守夜 %d/%d次" % [int(core.get("level",1)),int(unlock.coreLevel),mini(survived,int(unlock.daysSurvived)),int(unlock.daysSurvived)],16,GOLD)
	if built:
		var mode_row:=HBoxContainer.new()
		mode_row.add_theme_constant_override("separation",8)
		panel_content.add_child(mode_row)
		for mode in [{"id":"output","name":"火力"},{"id":"defense","name":"防护"},{"id":"control","name":"控场"}]:
			var mode_id: String=str(mode.id)
			var mode_button:=_button(mode_row,str(mode.name),func(): _command("FortressMode",str(turret.id),{"modeId":mode_id}),str(state.get("fortressMode","output"))==mode_id)
			_action_state(mode_button,"夜间锁定" if str(state.get("phase",""))=="NIGHT" else "正在施工" if turret.get("lockedBy")!=null else "","全堡垒共用一种方案")
		_text(panel_content,"防护：抗打、少输出 · 控场：减速、少输出",13,MINT)
		_visual_meter(panel_content, "Lv.%d · 耐久" % level, float(turret.get("hp",0)), float(turret.get("maxHp",0)), MINT)
		_visual_meter(panel_content, "弹药", float(turret.get("ammo",0)), float(turret.get("capacity",60)), GOLD)
		var definition: Dictionary = {}
		for candidate in fortress.get("levels",[]):
			if int(candidate.get("level",0))==level:
				definition=candidate
		var mode_damage: float=1.0 if str(state.get("fortressMode","output"))=="output" else .7 if str(state.get("fortressMode","output"))=="defense" else .75
		_text(panel_content,"每发 %d 伤害 · 最远 %d 米" % [floori(float(definition.get("damage",10))*mode_damage),int(fortress.get("range",27))],13,MINT)
	var costs: Dictionary = fortress.get("costs",{})
	var healthy_core := float(core.get("hp",0))>0
	if not alive:
		var action := "rebuild" if built else "install"
		_turret_work_button("重建炮台（空弹匣）" if built else "安装炮台（含 60 发）","InstallTurret",turret,costs.get(action,{}),(ready or built) and healthy_core)
	else:
		if int(turret.get("ammo",0))<int(turret.get("capacity",60)):
			_turret_work_button("补满弹药","ReloadTurret",turret,costs.get("reload",{}),healthy_core)
			var cell_row := _compact_row(panel_content,"sealed_cell","电芯补弹","1 电芯 → 20 发",GOLD)
			var cell_button := _button(cell_row,"补弹",func(): _command("Redeem",str(turret.id),{"definitionId":"sealed_cell"}),true)
			cell_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			_action_state(cell_button,"协作灯已毁" if not healthy_core else "没有电芯" if _item_count("sealed_cell")<=0 else "炮台使用中" if turret.get("lockedBy")!=null else "","使用随身电芯")
		if float(turret.hp)<float(turret.maxHp):
			var construction: Dictionary = catalog.get("construction",config.get("construction",{}))
			_turret_work_button("修炮台（最多 +50 耐久）","RepairTurret",turret,{"credits":0,"materials":construction.get("repair_m",1),"seconds":construction.get("repair_seconds",2)},healthy_core)
		if level<2:
			_turret_work_button("升到二级（不补弹）","UpgradeTurret",turret,costs.get("upgrade",{}),healthy_core)
	_text(panel_content,"防护和弹药已满 · 无需维护" if alive and level >= 2 and float(turret.hp) >= float(turret.maxHp) and int(turret.get("ammo",0)) >= int(turret.get("capacity",60)) else "选定工作 → 朝向炮台 → 按住 E",14,GOLD).tooltip_text="松开、移动或受伤会中断；炮台只攻击野怪与夜袭敌人"

func _turret_work_button(label: String, command: String, turret: Dictionary, cost: Dictionary, allowed: bool) -> void:
	var credits := int(cost.get("credits",0))
	var materials := int(cost.get("materials",0))
	var row := _compact_row(panel_content,"ammo" if command == "ReloadTurret" else "repair",label)
	_visual_cost(row.get_node("Details"),credits,materials,float(cost.get("seconds",4)))
	var button := _button(row,str({"InstallTurret":"重建" if int(turret.get("level",0))>0 else "安装","ReloadTurret":"补满弹药","RepairTurret":"修复","UpgradeTurret":"升到二级"}.get(command,"选定")),func(): _select_work(command,str(turret.id)),command in ["InstallTurret","ReloadTurret"])
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var reason := _work_reason(command,str(turret.id))
	if reason.is_empty() and not allowed:
		var core := _find(state.get("buildings",[]),"core")
		reason = "先重建协作灯" if float(core.get("hp",0))<=0 else "协作灯 2 级 · 守住 2 夜"
	if reason.is_empty(): reason = _funds_reason(credits,materials)
	_action_state(button,reason,"选定后朝向炮台，按住 E")

func _settings_panel() -> void:
	_slider("视野",70,100,base_fov,func(value: float): base_fov=value,"degrees","越大看得越宽")
	_slider("鼠标灵敏度",0.0008,0.005,sensitivity,func(value: float): sensitivity=value,"sensitivity","越大转身越快")
	_slider("音量",0,1,volume,func(value: float): volume=value,"percent","调整游戏音效")
	panel_content.add_child(HSeparator.new())
	_toggle_setting("反转上下视角",invert_y,func(value: bool): invert_y=value)
	_toggle_setting("受伤时画面震动",shake_enabled,func(value: bool): shake_enabled=value)
	_text(panel_content,"F11 切换全屏",13,MINT)

func _help_panel() -> void:
	var places := _visual_grid(panel_content,2)
	_compact_row(places,"core","据点建造","看向灯、墙或门，F 选修复 / 加固，按住 E 施工")
	_compact_row(places,"repair","堡垒炮台","灯升二级并守住两夜后，在炮台平台按 F 安装")
	_compact_row(places,"coin","补给台","靠近按 E · 购买物品、领取借用工具")
	_compact_row(places,"storage","储物柜","靠近按 E · 个人存取、团队捐献")
	_compact_row(places,"weapon","升级台","靠近按 E · 升级枪械、改装枪竿")
	_compact_row(places,"scrap","回收台","靠近按 E · 卖出换个人资源")
	_compact_row(places,"spring_parts","制作台","靠近按 E · 随身材料制作装备")
	_text(panel_content,"随身操作",15,GOLD)
	var controls := _visual_grid(panel_content,2)
	_compact_row(controls,"player","移动视角","WASD 移动 · 鼠标转身 · 空格跳跃")
	_compact_row(controls,"weapon","战斗操作","左键攻击 · 右键瞄准 · R 装弹 · 1–4 换装备")
	_compact_row(controls,"backpack","物品与成长","Tab 背包：装备道具 · C 能力：任务与成长")
	_compact_row(controls,"team","一起行动","Enter 聊天 · 靠近倒地同事，按住 E 救援")

func _about_panel() -> void:
	_compact_row(panel_content,"team","办公室的99夜","v%s · 同事合作，守住办公室" % CLIENT_BUILD)
	_text(panel_content,"素材鸣谢",16,GOLD)
	_text(panel_content,"道具图标：Lorc、Delapouite",14,CREAM)
	_text(panel_content,"来源：game-icons.net · 授权：CC BY 3.0",13,MINT)
	var credits := _text(panel_content,"https://game-icons.net\nhttps://creativecommons.org/licenses/by/3.0/",12,MINT)
	credits.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART


func _toggle_setting(title: String, value: bool, callback: Callable) -> void:
	var row := HBoxContainer.new()
	panel_content.add_child(row)
	var label := _text(row, title, 16)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	var toggle := CheckButton.new()
	toggle.custom_minimum_size = Vector2(56, 40)
	toggle.size_flags_horizontal = Control.SIZE_SHRINK_END
	toggle.tooltip_text = title
	toggle.set_meta("ui_role", "toggle")
	toggle.button_pressed = value
	toggle.toggled.connect(callback)
	row.add_child(toggle)

func _slider(title: String, minimum: float, maximum: float, value: float, callback: Callable, format := "", description := "") -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation",16)
	panel_content.add_child(row)
	var details := _column(row,3)
	details.custom_minimum_size.x = 158
	details.alignment = BoxContainer.ALIGNMENT_CENTER
	_text(details,title,16)
	if not description.is_empty(): _text(details,description,12,MINT)
	var slider := HSlider.new()
	slider.min_value = minimum
	slider.max_value = maximum
	slider.step = (maximum-minimum)/100
	slider.value = value
	slider.custom_minimum_size = Vector2(120,40)
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	slider.tooltip_text = title+" · "+description
	row.add_child(slider)
	var readout := _text(row,_setting_value(value,format),15,GOLD)
	readout.custom_minimum_size.x = 58
	readout.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	readout.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	slider.value_changed.connect(func(next: float):
		callback.call(next)
		readout.text = _setting_value(next,format)
	)


func _confirm_new() -> void:
	_open_subpanel("new_adventure")

func _new_adventure_panel() -> void:
	_compact_row(panel_content,"treasure","从第 1 天重新开始","这次冒险会保留一份备份",GOLD)
	_text(panel_content,"新冒险需要重新收集物品。",14,MINT)
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_END
	actions.add_theme_constant_override("separation",12)
	panel_content.add_child(actions)
	_nav_button(actions,"取消新建",_panel_back)
	_system_button(actions,"新建冒险",func(): _command("NewAdventure","",{"confirm":true}); _resume(),true)
	_queue_panel_layout()

func _leave() -> void:
	if platform_transport != null:
		_stop_actions()
		overlay = "pause"
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		platform_transport.leave()
		return
	leaving = true
	reconnect_attempts = 99
	reconnect_at = -1
	if socket != null:
		socket.close(1000, "leave")
	_stop_actions()
	joined = false
	player = {}
	state = {}
	pending.clear()
	_reset_world_views()
	panel.visible = false
	lobby.visible = true
	overlay = "lobby"
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	join_button.disabled = true
	lobby_note.text = "正在回大厅…"

func _online_players() -> Array:
	var members: Array = []
	for member in state.get("players", []):
		if bool(member.get("connected", false)):
			members.append(member)
	return members

func _online_count() -> int:
	return _online_players().size()

# Read-only numeric diagnostics of the actual scene, never account identifiers.
func _presence_metrics() -> Dictionary:
	var metrics := {"remoteNodes":0,"visibleBodies":0,"visibleLabels":0,"offlineBodies":0,"orphanBodies":0,"fishingLines":fishing_lines.size(),"visibleFishingLines":0,"visibleFishingTargets":0,"fishingVisualNodes":0,"teamCards":0,"offlineTeamCards":0}
	for node in fishing_lines.values():
		if not is_instance_valid(node) or node.is_queued_for_deletion(): continue
		metrics.fishingVisualNodes+=node.find_children("*","",true,false).size()+1
		if node.is_visible_in_tree() and camera.is_position_in_frustum(node.global_position): metrics.visibleFishingLines+=1
		for part in ["Target","Metal"]:
			var target_node: Node3D=node.get_node(part)
			if target_node.is_visible_in_tree() and camera.is_position_in_frustum(target_node.global_position): metrics.visibleFishingTargets+=1
	var members := {}
	for member in state.get("players", []):
		members[str(member.id)] = member
	for id in actors:
		var node: Node3D = actors[id]
		if not is_instance_valid(node) or node.is_queued_for_deletion():
			continue
		metrics.remoteNodes += 1
		var body = node.get_node_or_null("Rig/Body")
		if body != null and body.is_visible_in_tree():
			metrics.visibleBodies += 1
			if not members.has(id):
				metrics.orphanBodies += 1
			elif not bool(members[id].get("connected", false)):
				metrics.offlineBodies += 1
		for child in node.get_children():
			if child is Label3D and child.is_visible_in_tree():
				metrics.visibleLabels += 1
	if panel.visible:
		for card in panel_content.find_children("*", "VBoxContainer", true, false):
			if card.has_meta("team_member_connected") and card.is_visible_in_tree():
				metrics.teamCards += 1
				if not bool(card.get_meta("team_member_connected")):
					metrics.offlineTeamCards += 1
	return metrics

func _nearest_terminal(kind := "shop") -> Dictionary:
	var nearest: Dictionary = {}
	var distance := INF
	for terminal in state.get("world", {}).get("terminals", []):
		if str(terminal.get("type", "")) != kind: continue
		var delta := _v(terminal) - local_pos
		var length := Vector2(delta.x, delta.z).length()
		if length < distance:
			distance = length
			nearest = terminal
	return nearest

func _near_terminal(kind := "shop") -> bool:
	var terminal := _nearest_terminal(kind)
	if terminal.is_empty():
		return false
	var delta := _v(terminal) - _v(player)
	return Vector2(delta.x, delta.z).length() <= float(config.player.interact_distance)

func _station_data() -> Dictionary:
	return _find(state.get("world",{}).get("terminals",[]),str(station_context.get("id","")))

func _panel_station_type(mode: String) -> String:
	return "shop" if mode == "store" else mode

func _station_reason(kind: String) -> String:
	var label := str({"shop":"补给台","storage":"储物柜","upgrade":"升级台","recycle":"回收台","craft":"制作台"}.get(kind,"交互点"))
	var station := _station_data()
	if str(station_context.get("type","")) != kind or str(station.get("type","")) != kind: return "请到" + label + "操作"
	if str(player.get("lifeState","")) != "ALIVE": return "复活后可操作"
	if bool(player.get("swimming",false)): return "上岸后可操作"
	if str(state.get("phase","")) == "COMPLETE": return "冒险已结束"
	var delta := _v(station) - _v(player)
	if Vector2(delta.x,delta.z).length() > float(config.player.interact_distance): return "已离开" + label
	return ""

func _open_station(id: String) -> void:
	var station := _find(state.get("world",{}).get("terminals",[]),id)
	if str(station.get("type","")) not in ["shop","storage","upgrade","recycle","craft"]: return
	station_context = {"id":id,"type":str(station.type)}
	store_category = "补给"
	storage_category = 0
	_open_panel("store" if str(station.type) == "shop" else str(station.type))

func _station_command(kind: String, id := "", payload := {}) -> void:
	var type := "storage" if kind in ["Transfer", "Donate"] else "recycle" if kind == "Deposit" else "craft" if kind == "Craft" else "shop"
	var reason := _station_reason(type)
	if _panel_station_type(overlay) != type: return
	if not reason.is_empty(): _toast(reason); return
	var details: Dictionary = payload.duplicate(true)
	details.stationId = str(station_context.id)
	_command(kind,id,details)

func _recovery_tools_panel() -> void:
	var missing_rod := _equipped("rod").is_empty()
	var missing_knife := _equipped("melee").is_empty()
	for item in _items_in(str(player.get("backpackId", ""))):
		var kind := str(_find(config.items, str(item.get("definitionId", ""))).get("kind", ""))
		if kind == "rod": missing_rod = false
		elif kind == "melee": missing_knife = false
	if not missing_rod and not missing_knife: return
	var terminal := _nearest_terminal()
	var nearby := _station_reason("shop").is_empty()
	_text(panel_content, "免费工具" + (" · " + _waypoint(_v(terminal)) if not terminal.is_empty() and not nearby else ""), 14, GOLD)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	panel_content.add_child(row)
	for entry in [["rod_basic", missing_rod, "拿一根免费鱼竿"], ["knife", missing_knife, "拿一把免费小刀"]]:
		if not bool(entry[1]): continue
		var id := str(entry[0])
		var col := _compact_row(row, id, _name(id), "免费" if nearby else "靠近补给台", MINT)
		var button := _button(col, "领取", func(): _station_command("ClaimTool", "", {"definitionId":id}),true)
		button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		button.disabled = not nearby or str(state.get("phase", "")) == "COMPLETE"

func _empty_slot_hint(_slot: String) -> String:
	if _slot=="quick": return "左键挥拳 · Tab 可装入道具"
	return "空手可挥拳 · E 搜索 / 重建 · 工具去补给台领取"

func _update_hud() -> void:
	if state.is_empty():
		return
	var phase := str(state.get("phase", "PREP"))
	var time_left := maxi(0, int(ceil(float(state.get("phaseRemaining", 0)))))
	status_label.text = "任务模式  ·  %s\n体验物资只在本局有效" % mission.title() if mission.active() else "第 %d 天  ·  %s  %02d:%02d\n威胁 %d / 4%s" % [int(state.get("dayIndex", 1)), str(PHASES.get(phase, phase)), time_left / 60, time_left % 60, int(state.get("threatStage", 1)), " · 等待队员" if bool(state.get("paused", false)) else ""]
	status_label.modulate = Color("ffb584") if phase in ["RETURN", "NIGHT"] else Color.WHITE
	var roster := "渔猎小队  %d / %d" % [_online_count(),int(state.get("maxPlayers",config.get("baseline",{}).get("max_players",4)))]
	for actor in _online_players():
		var life := str(actor.get("lifeState", "ALIVE"))
		var detail := "%dHP" % int(actor.get("hp", 0)) if life == "ALIVE" else ("倒地待救" if life == "DOWNED" else "等待复活")
		if phase == "PREP" and bool(actor.get("ready", false)):
			detail += " · 就绪"
		roster += "\n%s %s  %s" % ["●" if str(actor.id) == self_id else "·", str(actor.get("name", "队员")), detail]
	roster_label.text = roster
	var core: Dictionary = {}
	for building in state.get("buildings", []):
		if str(building.get("definitionId", "")) == "core":
			core = building
	var bank: Dictionary = _personal_wallet()
	bank_label.text = "练习据点  %d / %d HP\n练习物资  %d 经费 · %d 零件\n退出不保存" % [int(core.get("hp", 0)), int(core.get("maxHp", 1500)), int(bank.get("credits", 0)), int(bank.get("materials", 0))] if mission.active() else "据点  %d / %d HP\n个人  %d 经费 · %d 零件\n自动存档%s" % [int(core.get("hp", 0)), int(core.get("maxHp", 1500)), int(bank.get("credits", 0)) - int(bank.get("reservedCredits", 0)), int(bank.get("materials", 0)) - int(bank.get("reservedMaterials", 0)), " · 写入中" if bool(state.get("save", {}).get("pending", false)) else " · 已开启"]
	if state.get("save", {}).get("error") != null:
		bank_label.text += "\n保存异常 · 请勿关闭服务"
	if phase == "NIGHT":
		bank_label.text += "\n第 %d 波 · 敌人 %d" % [int(state.get("night", {}).get("waveIndex", 0)), state.get("enemies", []).size()]
		for enemy in state.get("enemies", []):
			if str(enemy.get("tier", "")) == "boss":
				bank_label.text += "\n巨蟹  %d / %d" % [int(enemy.hp), int(enemy.maxHp)]
	var bank_way := _waypoint(Vector3(0, 5, 0))
	match "MISSION" if mission.active() else phase:
		"MISSION":
			objective_label.text = "任务模式 · " + mission.title() + "\n" + mission.hint() + "\nEsc → 任务，可换装备和补给"
		"PREP":
			objective_label.text = "⚑ 准备出发\nE 买东西 · F 建造升级\nEsc 告诉队友：我准备好了"
		"DAY":
			objective_label.text = "◈ 找鱼和物资\n钓鱼较安全，旧工位区收获更多\n⌂ 回营卖掉收获 " + bank_way
		"RETURN":
			objective_label.text = "↗ 涨潮了，快回营！\n水里不能开枪或拿东西\n⌂ 办公室 " + bank_way
		"NIGHT":
			objective_label.text = "⌂ 守住协作灯，撑到天亮\n队友倒地：靠近，按住 E\n巨蟹扑空后，绕到背后打"
		"RECOVERY":
			var recovery: Dictionary = state.get("recovery", {})
			var done := 0
			for debris in recovery.get("debris", []):
				if bool(debris.get("done", false)):
					done += 1
			objective_label.text = "⌂ 重建办公室\n按住 E 清残骸：%d / 4\n清完后，按住 E 修协作灯\n办公室 %s" % [done, bank_way]
		"COMPLETE":
			objective_label.text = "四个阶段已经完成！\nEsc 可查看队伍结算\n冒险与物资已保留"
	if player.is_empty():
		death_label.text = "正在加入任务…" if mission.active() else "正在查看冒险结算\n房主开启新冒险后，一起出发"
		return
	var life := str(player.get("lifeState", "ALIVE"))
	if life == "DOWNED":
		death_label.text = "倒地待救  %d 秒\nWASD 慢爬 · E 自救" % int(ceil(float(player.get("downedRemaining", 0))))
	elif life == "DEAD_WAIT":
		death_label.text = "稍后重返练习区" if mission.active() else "随身物品留在现场\n" + ("等待本夜结束" if phase == "NIGHT" else "%d 秒后回营复活" % int(ceil(float(player.get("respawnRemaining", 0)))))
	else:
		death_label.text = ""
	vitals_label.text = "生命  %d / 100\n体力  %d / 100" % [int(player.get("hp", 0)), int(player.get("stamina", 0))]
	if bool(player.get("swimming", false)):
		vitals_label.text += "\n深水氧气  %.1f 秒" % float(player.get("oxygen", 0))
	var slot := str(player.get("heldSlot", "weapon"))
	var equipped := _equipped(slot)
	current_weapon = str(player.get("heldDefinitionId") if player.get("heldDefinitionId")!=null else equipped.get("definitionId", ""))
	view.equip(current_weapon)
	var backpack := _items_in(str(player.get("backpackId", "")))
	weapon_label.text = _name(current_weapon) if not current_weapon.is_empty() else "空手 · 左键挥拳"
	if slot == "weapon" and not equipped.is_empty():
		var definition := _weapon_config()
		var reserve := 0
		for item in backpack:
			if str(item.definitionId) == str(definition.get("ammo", "")):
				reserve += int(item.quantity)
		weapon_label.text += "  Lv.%d\n%d / %d   备用 %s" % [int(equipped.get("level", 1)), int(equipped.get("magazineAmmo", 0)), int(definition.get("magazine", 0)), "∞" if mission.active() else str(reserve)]
	weapon_label.text += "\n背包 %d / %d  [Tab]" % [backpack.size(),InventoryUI.capacity(self)]
	hotbar_label.text = "%s  %s  %s   4 道具   Tab 背包" % ["[1 主枪]" if slot == "weapon" else "1 主枪", "[2 鱼竿]" if slot == "rod" else "2 鱼竿", "[3 刀]" if slot == "melee" else "3 刀"]
	charge_progress.visible = false
	tension_progress.visible = false
	action_label.text = ""
	var cast = player.get("fishing")
	if cast is Dictionary:
		match str(cast.get("state", "")):
			"CAST": action_label.text = "抛竿中…"
			"WAIT": action_label.text = "等鱼入网 · 左键收网" if current_weapon=="rod_net" else "等磁钩挂住物资…  右键取消" if current_weapon=="rod_magnet" else "等浮漂咬钩…  右键取消"
			"BITE": action_label.text = ("挂住了！左键收钩  %.1f 秒" if current_weapon=="rod_magnet" else "咬钩了！左键提竿  %.1f 秒") % float(cast.get("remaining", 0))
			"LAND": action_label.text = "物资上岸，靠近拾取" if current_weapon=="rod_magnet" else "活鱼上岸，打倒后回收"
			"REEL":
				action_label.text = "收线 %d%% / 张力 %d%% · 按住拉，松开降张力" % [int(cast.get("progress", 0)), int(cast.get("tension", 0))]
				charge_progress.visible = true
				tension_progress.visible = true
				charge_progress.value = float(cast.get("progress", 0))
				tension_progress.value = float(cast.get("tension", 0))
				tension_progress.modulate = Color("ff7050") if float(cast.get("tension", 0)) >= 80 else Color.WHITE
		action_label.text=FishingPresentation.cue_hint(cast)
	elif player.get("work") is Dictionary:
		var work: Dictionary = player.work
		var work_hint := "包扎中 · 保持静止" if str(work.get("kind", "")) == "Bandage" else "工作中 · 保持按住 E"
		if str(work.get("kind", "")) in ["Revive", "SelfRevive"]:
			work_hint = "施救中 · 按住 E" if str(work.kind) == "Revive" else "自救中 · 按住 E"
		if str(work.get("kind", "")) == "RecoveryWork":
			work_hint = "免费重建协作灯 · 按住 E" if str(work.get("targetId", "")) == "core" else "清理残骸 · 按住 E"
		if str(work.get("kind", "")) == "SearchArchive":
			work_hint = "翻找暗格 · 保持按住 E"
		action_label.text = "%s  %.1f / %.1f 秒" % [work_hint, float(work.get("progress", 0)), float(work.get("duration", 1))]
		charge_progress.visible = true
		charge_progress.value = 100 * float(work.get("progress", 0)) / maxf(0.1, float(work.get("duration", 1)))
	elif player.get("reload") is Dictionary:
		action_label.text = "换弹中… %.1f 秒" % float(player.reload.get("remaining", 0))
	elif not selected_work.is_empty():
		action_label.text = "按住 E 执行已选择的工作"
		if str(selected_work.get("command", "")) == "RecoveryWork":
			action_label.text = "对准协作灯 · 按住 E 免费重建" if str(target.get("id", "")) == "core" else "前往协作灯  " + _waypoint(_v(_find(state.get("buildings", []), "core")))
	elif bool(player.get("swimming", false)):
		action_label.text = "深水限制操作，请游向主岛高地！"
	if player.get("carryingId")!=null:
		weapon_label.text="搬运补给 · 移动较慢"
		context_label.text="E 放下 · 绿框内 E 交付"
		for outing in state.get("exploration",{}).get("events",[]):
			if outing.get("receiver") is Dictionary and outing.parts.any(func(q): return str(q.id)==str(player.carryingId)):
				action_label.text="接收点 "+_waypoint(_v(outing.receiver))
	if phase=="DAY":
		var nearest: Dictionary={}
		var distance := INF
		for outing in state.get("exploration",{}).get("events",[]):
			if bool(outing.get("done",false)): continue
			for part in outing.parts:
				if bool(part.opened): continue
				var d := local_pos.distance_to(_v(part))
				if d<distance: distance=d; nearest={"outing":outing,"part":part}
		if not nearest.is_empty(): objective_label.text="◈ "+str(nearest.outing.name)+"  "+_waypoint(_v(nearest.part))+"\n"+str(nearest.outing.goal)+"\n⌂ 回营卖收获 "+bank_way
	if phase != last_phase:
		if not last_phase.is_empty():
			_toast(str(PHASES.get(phase, phase)), 4)
		last_phase = phase
		if phase == "COMPLETE" and overlay.is_empty() and not mission.active():
			_open_panel("complete")

func _waypoint(point: Vector3) -> String:
	var delta := point - local_pos
	var forward := Vector3(-sin(yaw), 0, -cos(yaw))
	var right := Vector3(cos(yaw), 0, -sin(yaw))
	var arrow := "↑" if delta.dot(forward) > absf(delta.dot(right)) else ("→" if delta.dot(right) > 0 else "←")
	if delta.dot(forward) < -absf(delta.dot(right)):
		arrow = "↓"
	return "%s %d米" % [arrow, int(Vector2(delta.x, delta.z).length())]

func _gate_interaction_point(data: Dictionary) -> Vector3:
	var center := _v(data)
	var gate_yaw := float(data.get("yaw", 0))
	var normal := Vector3(sin(gate_yaw), 0, cos(gate_yaw))
	var right := Vector3(cos(gate_yaw), 0, -sin(gate_yaw))
	var direction := -camera.global_basis.z
	var aimed := camera.global_position
	var denominator := direction.dot(normal)
	if absf(denominator) > 0.001:
		var ray_distance := (center - aimed).dot(normal) / denominator
		if ray_distance > 0:
			aimed += direction * ray_distance
	# Aim at the door's surface, including at eye height when standing close.
	# The normal range, view cone and foreign-obstacle checks still apply.
	return center + right * clampf((aimed - center).dot(right), -1.45, 1.45) + Vector3.UP * clampf(aimed.y - center.y, 0.25, 2.45)

func _container_position(data: Dictionary) -> Vector3:
	var point := _v(data)
	# A bag saved while swimming follows today's water/ground, not the old tide.
	# Rendering and aiming share this position; authority keeps the same ID/items.
	point.y=maxf(world.ground_height(point.x,point.z),float(state.get("waterY",0)))
	return point

func _pick_target() -> void:
	target = {}
	if player.is_empty() or str(player.get("lifeState")) != "ALIVE":
		context_label.text = ""
		return
	var choices: Array = []
	for outing in state.get("exploration",{}).get("events",[]):
		if bool(outing.get("done",false)): continue
		for part in outing.get("parts",[]):
			if bool(part.get("opened",false)) or part.get("carrierId")!=null: continue
			var data: Dictionary=part.duplicate()
			data["outing"]=outing
			choices.append({"data":data,"type":"exploration","height":0.7})
	for actor in _online_players():
		if str(actor.id) != self_id and str(actor.get("lifeState")) == "DOWNED":
			choices.append({"data":actor, "type":"revive", "height":0.55})
	for data in state.get("containers", []):
		if data.has("x") and str(data.get("type", "")) not in ["storage", "personal_storage"] and _container_has_content(data):
			choices.append({"data":data, "type":"container", "height":0.5})
	for data in state.get("buildings", []):
		choices.append({"data":data, "type":"building", "height":1.1})
	for data in state.get("turrets", []):
		choices.append({"data":data, "type":"turret", "height":0.8})
	for data in state.get("world", {}).get("terminals", []):
		choices.append({"data":data, "type":"training" if str(data.get("type","")) == "training" else "terminal", "height":1.25 if str(data.get("type","")) == "training" else 0.8})
	for data in state.get("nodes", []):
		if str(data.get("state", "")) not in ["depleted", "DEPLETED", "EMPTY"]:
			choices.append({"data":data, "type":"node", "height":0.5})
	for data in state.get("destructibles", []):
		if str(data.get("kind","")) in Props.SEARCHABLE and not bool(data.get("broken",false)) and not bool(data.get("opened",false)) and data.get("resolution")==null:
			choices.append({"data":data,"type":"archive","height":0.95})
	var recovery = state.get("recovery")
	if recovery is Dictionary:
		for data in recovery.get("debris", []):
			if not bool(data.get("done", false)):
				choices.append({"data":data, "type":"debris", "height":0.4})
	var best := float(config.player.interact_distance)
	for choice in choices:
		var point := _v(choice.data) + Vector3.UP * float(choice.height)
		if str(choice.type)=="container": point=_container_position(choice.data)+Vector3.UP*float(choice.height)
		if str(choice.type) == "building" and str(choice.data.get("definitionId", "")) == "gate" and int(choice.data.get("hp", 0)) > 0:
			point = _gate_interaction_point(choice.data)
		var diff := point - camera.position
		var destination := _v(choice.data)
		var distance := Vector2(local_pos.x - destination.x, local_pos.z - destination.z).length()
		var is_rescue := str(choice.type) == "revive"
		if str(target.get("type", "")) == "revive" and not is_rescue:
			continue
		if is_rescue and absf(local_pos.y - destination.y) > 1.2:
			continue
		if distance > best or diff.length() < 0.05:
			continue
		var facing := diff.normalized().dot(-camera.global_basis.z)
		if is_rescue:
			var flat := Vector2(destination.x-local_pos.x,destination.z-local_pos.z)
			facing = flat.normalized().dot(Vector2(-sin(yaw),-cos(yaw))) if flat.length()>0.15 else 1.0
		if facing < (0.45 if is_rescue else 0.83):
			continue
		var ray_origin := local_pos + Vector3.UP * 0.85 if is_rescue else camera.position
		if is_rescue: point = destination + Vector3.UP * 0.42
		var query := PhysicsRayQueryParameters3D.create(ray_origin, point)
		var hit := get_world_3d().direct_space_state.intersect_ray(query)
		var own_collider := false
		if not hit.is_empty():
			var collider: Node = hit.get("collider")
			while collider != null:
				if str(collider.get_meta("authority_id", "")) == str(choice.data.id) or str(collider.get_meta("obstacle_id", "")) == str(choice.data.id) or str(collider.get_meta("destructible_id", "")) == str(choice.data.id):
					own_collider = true
					break
				collider = collider.get_parent()
		if not own_collider and not hit.is_empty() and ray_origin.distance_to(hit.position) + (0.12 if is_rescue else 0.6) < ray_origin.distance_to(point):
			continue
		best = distance
		target = {"id":str(choice.data.id), "type":str(choice.type), "data":choice.data}
	if not target.is_empty():
		if str(target.type) == "node" and objects.has(str(target.id)):
			_build_object_visual(objects[str(target.id)])
		match str(target.type):
			"revive": context_label.text = "按住 E 6秒 · 扶起队友"
			"container": context_label.text = "E 查看并回收现场物资"
			"node": context_label.text = "按住 E · 搜索物资"
			"archive": context_label.text = "按住 E 静拆 · 左键响砸"
			"exploration": context_label.text = _exploration_hint(target.data.outing)
			"terminal": context_label.text = str({"shop":"E 补给台 · 购买 / 领取","storage":"E 储物柜 · 个人 / 团队","upgrade":"E 升级台 · 升级 / 改装","recycle":"E 回收台 · 换成个人资源","craft":"E 制作台 · 制作装备"}.get(str(target.data.get("type","")),""))
			"training": context_label.text = "E 试用 %s · F 对比改装" % _name(str(target.data.get("definitionId","")))
			"debris": context_label.text = "按住 E · 清理重建残骸"
			"turret": context_label.text = "F / E 堡垒炮台 · %s" % ("空置平台" if int(target.data.get("level",0))==0 else ("已损毁" if int(target.data.get("hp",0))<=0 else "%d/%d 发" % [int(target.data.get("ammo",0)),int(target.data.get("capacity",60))]))
			"silverfish": context_label.text = "E 收起银鱼"
			"building":
				context_label.text = "F 建造 / 升级 %s · 耐久 %d/%d" % [_name(str(target.data.get("definitionId", "wall"))),int(target.data.get("hp",0)),int(target.data.get("maxHp",0))]
				if mission.active() and not mission.free_play() and str(mission.data().get("stageId", "")) == "base" and str(target.data.get("definitionId", "")) == "core" and int(target.data.get("hp", 0)) < int(target.data.get("maxHp", 0)):
					context_label.text = "按住 E · 修复协作灯 · 耐久 %d/%d" % [int(target.data.get("hp",0)), int(target.data.get("maxHp",0))]
				if str(target.data.get("definitionId")) == "gate" and int(target.data.get("hp", 0)) > 0:
					context_label.text = "E %s · F 建造升级 · 耐久 %d/%d" % ["关门" if bool(target.data.get("gateOpen", false)) else "开门", int(target.data.get("hp", 0)), int(target.data.get("maxHp", 0))]
				if str(state.get("phase")) == "RECOVERY" and not _recovery_ready() and str(target.data.get("definitionId")) == "core":
					var debris := _recovery_debris_status()
					context_label.text = "按住 E · 免费重建协作灯 · F 查看" if bool(debris.complete) else "先清残骸 %d/%d · F 查看" % [int(debris.cleared), int(debris.total)]
	else:
		var slot := str(player.get("heldSlot", "weapon"))
		if _equipped(slot).is_empty():
			context_label.text = "左键挥拳 · E 搜索 / 重建 · 补给台领工具"
		elif slot == "rod":
			var water := _sea_cast_target(rod_charge_amount() if rod_charge_started>=0 else 1.0)
			context_label.text = ("蓄力撒网 · 等鱼聚齐再收" if current_weapon=="rod_net" else "蓄力抛钩 · 物资上岸后拾取" if current_weapon=="rod_magnet" else "按住蓄力 · 松开抛竿 · 活鱼打倒后回收") if bool(water.valid) else "朝向近处海面 · 任意海域均可岸钓"
		elif slot == "weapon":
			context_label.text = str({"semi":"左键单发","pump":"泵动散射","bolt":"拉栓单发"}.get(str(_weapon_config().get("fire_mode","auto")),"按住连射")) + " · 右键瞄准 · R 换弹"
		elif slot == "quick":
			context_label.text = _quick_hint()
		else:
			context_label.text = "左键挥刀 · 瞄准近处目标"

func _item_count(id: String) -> int:
	var count := 0
	for item in _items_in(str(player.get("backpackId",""))):
		if str(item.definitionId)==id: count+=int(item.quantity)
	return count

func _nearest_outing() -> Dictionary:
	var nearest := {}
	var distance := INF
	for outing in state.get("exploration",{}).get("events",[]):
		if bool(outing.get("done",false)): continue
		for part in outing.parts:
			if bool(part.opened): continue
			if part.get("carrierId")!=null:
				if str(part.carrierId)==self_id and outing.get("receiver") is Dictionary: return {"outing":outing,"part":outing.receiver,"carrying":true}
				continue
			var d := local_pos.distance_to(_v(part))
			if d<distance:
				distance=d
				nearest={"outing":outing,"part":part}
	return nearest

func _exploration_hint(outing: Dictionary) -> String:
	match str(outing.type):
		"desk_alarm": return "按住 E 拆铃 · F 响铃" if int(outing.stage)==0 else "按住 E 开抽屉"
		"desk_sort": return "找 %s 标记 · 按住 E 开抽屉" % ["Ⅰ","Ⅱ","Ⅲ"][int(outing.clue)]
		"desk_stamp": return "依次 %s → %s → %s · 按住 E · %d/3" % [["Ⅰ","Ⅱ","Ⅲ"][int(outing.sequence[0])],["Ⅰ","Ⅱ","Ⅲ"][int(outing.sequence[1])],["Ⅰ","Ⅱ","Ⅲ"][int(outing.sequence[2])],int(outing.stage)]
		"desk_print": return "按住 E 启动打印" if int(outing.stage)==0 else "打印中 · %d 秒" % int(ceil(float(outing.remaining))) if float(outing.remaining)>0 else "按住 E 取打印件"
		"supply_dial": return "找 %s · F 转旋钮 %s · 按住 E 确认" % [["Ⅰ","Ⅱ","Ⅲ"][int(outing.clue)],["Ⅰ","Ⅱ","Ⅲ"][int(outing.dial)]]
		"supply_cool": return "按住 E 冷却 · F 强拆" if int(outing.stage)==0 else "冷却中 · %d 秒 · F 强拆" % int(ceil(float(outing.remaining))) if float(outing.remaining)>0 else "按住 E 取电池"
		"parcel_invoice": return "跳过 %s 错单 · 按住 E 拆真货 · %d/2" % [["Ⅰ","Ⅱ","Ⅲ"][int(outing.clue)],int(outing.stage)]
		"parcel_relay": return "E 抬起 · 送绿框 · %d/2" % int(outing.stage)
		"supply_carry": return "E 抬起 · 搬到绿框"
		"supply_seal": return "按住 E 拆封 %d/3 · 打碎只有少量零件" % int(outing.stage)
		"parcel_intact": return "按住 E 打包 0/3 · 保护快递" if int(outing.stage)==0 else "按住 E 打包 %d/3 · F 提前回收" % int(outing.stage)
		"parcel_rush": return "E 开始 · 25 秒内打碎三箱" if not bool(outing.started) else "打碎三箱 %d/3 · 剩 %d 秒" % [int(outing.stage),int(ceil(float(outing.remaining)))]
	return "按住 E 处理"

func _aimed_pool() -> Dictionary:
	var best: Dictionary = {}
	var nearest := 100.0
	var rod_config := _find(config.rods, str(_equipped("rod").get("definitionId", "rod_basic")))
	for pool in state.get("pools", []):
		var diff := _v(pool) - camera.position
		if diff.length() > float(rod_config.get("cast_range", 12)) + float(pool.get("radius", 2)) or diff.length() >= nearest:
			continue
		if diff.normalized().dot(-camera.global_basis.z) >= 0.74:
			best = pool
			nearest = diff.length()
	return best

func _sea_cast_target(power: float = 1.0) -> Dictionary:
	var rod := _find(config.rods,str(_equipped("rod").get("definitionId","rod_basic")))
	var reach := float(rod.get("cast_range",12)) * lerpf(0.35,1.0,clampf(power,0,1))
	var water_y := float(state.get("waterY",0))
	var direction := -camera.global_basis.z
	var flat := Vector2(direction.x,direction.z).normalized()
	var point := Vector3(local_pos.x+flat.x*reach,water_y,local_pos.z+flat.y*reach)
	if direction.y < -0.025:
		var distance := (water_y-camera.global_position.y)/direction.y
		var aimed := camera.global_position+direction*distance
		if distance>0 and Vector2(aimed.x-local_pos.x,aimed.z-local_pos.z).length()<=reach:
			point=aimed
	var valid: bool = world.ground_height(point.x,point.z)<water_y-0.12 and Vector2(point.x-local_pos.x,point.z-local_pos.z).length()>0.65
	if valid:
		var hit := get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(camera.global_position,point+Vector3.UP*0.04))
		valid=hit.is_empty() or camera.global_position.distance_to(hit.position)+0.18>=camera.global_position.distance_to(point)
	return {"x":point.x,"y":water_y,"z":point.z,"valid":valid}

func _interact() -> void:
	if player.get("carryingId")!=null:
		_command("Explore",str(player.carryingId))
		return
	_pick_target()
	if str(player.get("lifeState", "")) == "DOWNED" or str(target.get("type", "")) == "revive":
		_try_rescue()
		return
	_reconcile_building_work()
	if str(selected_work.get("command", "")) == "RecoveryWork" and (str(state.get("phase", "")) != "RECOVERY" or _recovery_ready()):
		selected_work = {}
	if not selected_work.is_empty():
		if selected_work.has("stationId"):
			if str(target.get("type","")) == "terminal" and str(target.get("id","")) == str(selected_work.stationId):
				_command("Upgrade",str(selected_work.id),{"stationId":str(selected_work.stationId)})
			else:
				_toast("对准选定的升级台，再按住 E。")
			return
		if str(target.get("id", "")) == str(selected_work.id):
			_command(str(selected_work.command), str(selected_work.id))
			return
		if str(selected_work.get("command", "")) == "RecoveryWork":
			_toast("先对准办公室中央的协作灯，再按住 E。", 4)
			return
		selected_work = {}
	if target.is_empty():
		_toast("靠近并看向物资包、补给台或残骸，出现 E 提示后再操作。", 4)
		return
	match str(target.type):
		"revive": _command("Revive", str(target.id))
		"node": _command("Search", str(target.id))
		"archive": _command("SearchArchive",str(target.id))
		"exploration": _command("Explore",str(target.id))
		"debris": _command("RecoveryWork", str(target.id))
		"silverfish": _command("Pickup", str(target.id))
		"container": _open_panel("container")
		"terminal": _open_station(str(target.id))
		"training": _command("MissionControl","",{"action":"equip","definitionId":str(target.data.get("definitionId",""))})
		"turret": _open_panel("turret")
		"building":
			if str(state.get("phase")) == "RECOVERY" and not _recovery_ready() and str(target.data.get("definitionId")) == "core":
				if not bool(_recovery_debris_status().complete):
					_toast("先清完四处残骸，再回来免费重建协作灯。", 4)
					return
				_command("RecoveryWork", str(target.id))
			elif mission.active() and not mission.free_play() and str(mission.data().get("stageId", "")) == "base" and str(target.data.get("definitionId", "")) == "core":
				if int(target.data.get("hp", 0)) < int(target.data.get("maxHp", 0)):
					_command("Repair", str(target.id))
				else:
					_toast("协作灯已修好。", 3)
			elif str(target.data.get("definitionId")) == "gate":
				_toggle_gate(str(target.id))

func _try_rescue() -> void:
	if not joined or not overlay.is_empty() or player.get("work") is Dictionary or elapsed < rescue_retry_at:
		return
	if str(player.get("lifeState", "")) == "DOWNED":
		if float(player.get("selfReviveReadyIn", 8)) > 0 or player.get("rescue") is Dictionary or bool(player.get("swimming", false)):
			return
		rescue_retry_at = elapsed + 0.7
		_command("SelfRevive")
	elif str(player.get("lifeState", "")) == "ALIVE" and str(target.get("type", "")) == "revive":
		selected_work = {}
		rescue_retry_at = elapsed + 0.7
		_command("Revive", str(target.id))

func _switch(slot: String) -> void:
	_stop_actions()
	selected_work = {}
	_command("SwitchEquip", "", {"slot":slot})
	if _equipped(slot).is_empty():
		_toast(_empty_slot_hint(slot), 5)

func _primary(pressed: bool) -> void:
	if not pressed: primary_held=false
	if player.get("carryingId")!=null:
		primary_held=false
		rod_charge_started=-1.0
		if pressed: _toast("先按 E 放下箱子")
		return
	if str(player.get("lifeState", "")) != "ALIVE":
		primary_held = false
		rod_charge_started = -1.0
		return
	primary_held = pressed
	if not pressed:
		if rod_charge_started >= 0:
			var power := rod_charge_amount()
			rod_charge_started = -1.0
			var water := _sea_cast_target(power)
			if bool(water.valid):
				_command("Cast","",{"x":water.x,"z":water.z,"power":power})
				view.cast_animation(power,float(_find(config.rods,str(_equipped("rod").get("definitionId","rod_basic"))).get("cast_seconds",config.fishing.get("cast_seconds",0.8))))
				_cue("cast")
			else:
				_toast("落点不在海面。靠近岸边朝向水面，再蓄力抛竿。")
		return
	var slot := str(player.get("heldSlot", "weapon"))
	if _equipped(slot).is_empty():
		_melee()
		return
	if slot == "quick":
		_use_tool(str(_equipped("quick").definitionId))
		return
	if slot == "rod":
		if str(state.get("phase", "")) == "COMPLETE":
			primary_held = false
			_toast("冒险已完成，开始新冒险后可以继续钓鱼。",5)
			return
		var fishing = player.get("fishing")
		if fishing is Dictionary:
			if str(fishing.get("state")) == "BITE":
				_command("Hook")
		else:
			rod_charge_started = elapsed
	elif slot == "melee":
		_melee()
	elif slot == "weapon":
		if int(_equipped("weapon").get("magazineAmmo",0))<=0:
			_cue("dry")
		else:
			_command("Fire","",{"yaw":yaw,"pitch":pitch,"ads":_ads_requested()})

func rod_charge_amount() -> float:
	return clampf((elapsed-rod_charge_started)/float(_find(config.rods,str(_equipped("rod").get("definitionId","rod_basic"))).get("charge_seconds",0.85)),0,1) if rod_charge_started>=0 else 0.0

func _melee() -> void:
	if player.get("carryingId")!=null: return
	var slot := str(player.get("heldSlot", "weapon"))
	var unarmed := _equipped(slot).is_empty()
	if (not unarmed and slot != "melee") or str(player.get("lifeState", "")) != "ALIVE" or str(state.get("phase", "")) == "COMPLETE":
		return
	if player.get("work") != null or player.get("fishing") != null or bool(player.get("swimming",false)) or view.equip_time > 0:
		return
	var cooldown := float(config.get("unarmed",{}).get("cooldown_seconds",0.6)) if unarmed else float(config.melee.cooldown_seconds)
	if elapsed - last_shot_at < cooldown:
		return
	last_shot_at = elapsed
	_command("Melee", "", {"yaw":yaw, "pitch":pitch})
	if unarmed:
		view.punch()
	else:
		view.fire()
	_cue("swing")

func _escape_menu() -> void:
	if not joined:
		return
	if overlay.is_empty():
		_open_panel("mission" if mission.active() else "complete" if str(state.get("phase")) == "COMPLETE" else "pause")
	elif _panel_can_back(): _panel_back()
	else: _resume()

func _unhandled_input(event: InputEvent) -> void:
	if platform_transport != null and not platform_game_entered:
		return
	# Recovery suppresses game actions, but must not swallow Esc or chat while
	# a menu is opening/closing in the same frame as a browser lock event.
	var accepting_controls := not platform_controls_blocked and (platform_transport == null or elapsed >= platform_input_after)
	if event is InputEventKey and event.pressed and not event.echo:
		var key: Key = event.physical_keycode if event.physical_keycode != 0 else event.keycode
		if platform_transport != null and key in [KEY_ENTER, KEY_KP_ENTER] and joined:
			_stop_actions()
			if overlay != "chat": platform_previous_overlay = overlay
			overlay = "chat"
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
			_publish_platform_ui()
			platform_transport.openChat()
			get_viewport().set_input_as_handled()
			return
		if key == KEY_ESCAPE:
			if overlay == "chat" and platform_transport != null:
				platform_transport.closeChat()
				get_viewport().set_input_as_handled()
				return
			_escape_menu()
			return
		if key == KEY_G and overlay == "social":
			_resume()
			return
		if not joined or not overlay.is_empty() or not accepting_controls:
			return
		if key == KEY_G:
			_open_panel("social")
			return
		if str(player.get("lifeState", "")) != "ALIVE":
			if key == KEY_E and str(player.get("lifeState", "")) == "DOWNED":
				interaction_held = true
				_interact()
			return
		match key:
			KEY_1: _switch("weapon")
			KEY_2: _switch("rod")
			KEY_3: _switch("melee")
			KEY_4: _switch("quick")
			KEY_R:
				if _equipped("weapon").is_empty():
					_toast(_empty_slot_hint("weapon"), 5)
				else:
					_command("Reload")
			KEY_TAB: _open_panel("inventory")
			KEY_C: _open_panel("rewards")
			KEY_F:
				_pick_target()
				if str(target.get("type", "")) == "training":
					mission.tab = 2 if str(target.data.get("definitionId","")).begins_with("rod_") else 1
					_open_panel("mission")
				elif str(target.get("type", "")) == "exploration":
					_command("Explore",str(target.id),{"alternate":true})
				elif str(target.get("type", "")) == "building":
					_open_panel("building")
				elif str(target.get("type", "")) == "turret":
					_open_panel("turret")
				else:
					_toast("靠近并看向围墙、门或协作灯，再按 F 维护。")
			KEY_E:
				interaction_held = true
				_interact()
			KEY_SPACE: jump_held = true
	elif event is InputEventKey and not event.pressed:
		var key: Key = event.physical_keycode if event.physical_keycode != 0 else event.keycode
		if key == KEY_E:
			interaction_held = false
			if not player.is_empty() and player.get("work") != null:
				_command("CancelWork")
		elif key == KEY_SPACE:
			jump_held = false
	elif event is InputEventMouseMotion and joined and overlay.is_empty() and accepting_controls:
		if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED or drag_look:
			look_motion += event.relative
			var aim_sensitivity := sensitivity * AimProfile.sensitivity_scale(base_fov,camera.fov)
			yaw -= event.relative.x * aim_sensitivity
			pitch = clampf(pitch - event.relative.y * aim_sensitivity * (-1 if invert_y else 1), -1.48, 1.48)
	elif event is InputEventMouseButton and joined and overlay.is_empty() and accepting_controls:
		if event.button_index == MOUSE_BUTTON_LEFT:
			_primary(event.pressed)
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			secondary_held = event.pressed
			drag_look = event.pressed and free_mouse
			if event.pressed and str(player.get("lifeState", "")) == "ALIVE" and str(player.get("heldSlot", "")) == "rod":
				rod_charge_started=-1.0
				primary_held=false
				if player.get("fishing")!=null: _command("CancelFish")

func _key(key: Key) -> bool:
	return Input.is_physical_key_pressed(key) or Input.is_key_pressed(key)

func _process(delta: float) -> void:
	if social_view == null and gui != null:
		social_view = SocialView.new()
		add_child(social_view)
		social_view.setup(self)
	if is_instance_valid(social_view): social_view.update(delta)
	if panel_refresh_pending:
		_refresh_panel_if_changed()
	elapsed += delta
	_network()
	if visual_warmup_active:
		return
	_finish_enemy_details()
	_finish_object_visuals()
	hud.visible = joined and not lobby.visible
	var show_notice := elapsed < toast_until and panel.visible
	if toast_label.visible != show_notice:
		toast_label.visible = show_notice
		_queue_panel_layout()
	ui_scrim.visible = not overlay.is_empty() and not (overlay == "chat" and platform_previous_overlay.is_empty())
	health_flash.color.a = maxf(0, health_flash.color.a - delta * 0.7)
	hurt_kick = maxf(0,hurt_kick-delta*4.2) if shake_enabled else 0.0
	var active := joined and overlay.is_empty() and not player.is_empty() and str(player.get("lifeState", "")) == "ALIVE" and str(state.get("phase", "")) != "COMPLETE"
	if platform_transport != null:
		active = active and platform_game_entered and elapsed >= platform_input_after and not platform_controls_blocked
	var mobile := active or (joined and overlay.is_empty() and str(player.get("lifeState", "")) == "DOWNED" and str(state.get("phase", "")) != "COMPLETE")
	if platform_transport != null:
		mobile = mobile and platform_game_entered and elapsed >= platform_input_after and not platform_controls_blocked
	move_direction = Vector2.ZERO
	if mobile:
		yaw += (float(_key(KEY_LEFT)) - float(_key(KEY_RIGHT))) * delta * 1.8
		pitch = clampf(pitch + (float(_key(KEY_UP)) - float(_key(KEY_DOWN))) * delta, -1.48, 1.48)
		move_direction = (Vector2(cos(yaw), -sin(yaw)) * (float(_key(KEY_D)) - float(_key(KEY_A))) + Vector2(-sin(yaw), -cos(yaw)) * (float(_key(KEY_W)) - float(_key(KEY_S)))).limit_length()
		if active and primary_held and (str(player.get("heldSlot", "")) == "melee" or _equipped(str(player.get("heldSlot", "weapon"))).is_empty()):
			_melee()
	var ads := _ads_requested(active)
	cast_marker.visible = active and player.get("carryingId")==null and str(player.get("heldSlot",""))=="rod" and not _equipped("rod").is_empty() and player.get("fishing")==null
	if cast_marker.visible:
		var water := _sea_cast_target(rod_charge_amount() if rod_charge_started>=0 else 1.0)
		cast_marker.visible = bool(water.valid)
		cast_marker.position = _v(water)+Vector3.UP*0.08
	var sprint := active and player.get("carryingId")==null and _key(KEY_SHIFT) and not ads and float(player.get("stamina", 0)) > 0
	input_timer += delta
	if joined and input_timer >= 1.0 / 30.0:
		input_timer = 0
		input_seq += 1
		_send({"type":"input", "seq":input_seq, "dx":move_direction.x, "dz":move_direction.y, "yaw":yaw, "pitch":pitch, "sprint":sprint, "crouch":active and _key(KEY_CTRL), "jump":active and jump_held, "fire":active and primary_held and str(player.get("heldSlot", "")) == "weapon" and not _equipped("weapon").is_empty() and str(_weapon_config().get("fire_mode","auto"))!="semi", "ads":ads, "reel":active and primary_held and str(player.get("heldSlot", "")) == "rod", "interact":mobile and interaction_held})
	if joined and not player.is_empty():
		var speed := float(config.player.crawl_speed) if str(player.get("lifeState", "")) == "DOWNED" else (6.5 if sprint else (2.5 if active and _key(KEY_CTRL) else 4.5))
		if bool(player.get("swimming", false)) and str(player.get("lifeState", "")) == "ALIVE":
			speed = 2.0
		if float(player.get("slowUntil",0))>float(state.get("time",0)):
			speed*=0.65
		if player.get("carryingId")!=null: speed*=0.58
		if str(player.get("lifeState",""))=="ALIVE" and str(player.get("heldSlot",""))=="weapon" and not bool(player.get("swimming",false)):
			speed*=float(_weapon_config().get("move_multiplier",1.0))
		var change := Vector3(move_direction.x, 0, move_direction.y) * speed * delta
		if change.length() > 0:
			var query := PhysicsRayQueryParameters3D.create(local_pos + Vector3.UP, local_pos + Vector3.UP + change.normalized() * (change.length() + 0.38))
			if get_world_3d().direct_space_state.intersect_ray(query).is_empty():
				local_pos += change
		var authoritative := _v(player)
		var state_age := minf(maxf(elapsed - snapshot_received_at, 0), 0.15)
		if move_direction.length() > 0 and player.get("velocity") is Dictionary:
			var velocity := _v(player.velocity)
			authoritative += Vector3(velocity.x, 0, velocity.z) * state_age
		local_pos = local_pos.lerp(authoritative, 1.0 - exp(-delta * (8 if move_direction.length() > 0 else 14)))
		var target_eye := 0.52 if str(player.get("lifeState", "")) == "DOWNED" else (1.05 if bool(player.get("crouching", false)) else float(config.player.camera_height))
		eye_height = lerpf(eye_height,target_eye,1.0-exp(-delta*9.0))
		var eye := eye_height
		var grounded := bool(player.get("grounded",true))
		if grounded and not last_grounded and not bool(player.get("swimming",false)):
			view.land(0.5)
			_cue("land",0.6)
		last_grounded=grounded
		footstep_time+=delta
		if active and move_direction.length()>0.1 and footstep_time>(0.29 if sprint else 0.43) and grounded:
			footstep_time=0
			_cue("swim" if bool(player.get("swimming",false)) else "step",0.30 if sprint else 0.19)
		camera.position = local_pos + Vector3(0,eye,0)
		camera.rotation = Vector3(pitch+sin(elapsed*27)*hurt_kick*.018,yaw,cos(elapsed*21)*hurt_kick*.012)
		var target_fov := AimProfile.target_fov(base_fov,_weapon_config(),ads) + (5 if sprint and not ads else 0)
		if ads:
			camera.fov = move_toward(camera.fov,target_fov,absf(base_fov-target_fov)*delta/float(_weapon_config().get("ads_seconds",0.15)))
		else:
			# Switching to rods/fists must release the scope promptly, with no gun config needed.
			camera.fov=lerpf(camera.fov,target_fov,minf(delta*20.0,1.0))
	# Only presentation extrapolates between snapshots; gameplay stays authoritative.
	# Keep the first-snapshot sentinel and the received player dictionary untouched.
	var presentation_player := player.duplicate()
	if not presentation_player.is_empty():
		presentation_player["_serverTime"] = float(state.get("time",0))+minf(maxf(elapsed-snapshot_received_at,0),0.15)
	if presentation_player.get("reload") is Dictionary:
		presentation_player["_reloadDuration"]=maxf(float(presentation_player.get("actionDuration",0)),float(presentation_player.reload.get("remaining",0)))
	if presentation_player.get("fishing") is Dictionary:
		presentation_player.fishing=presentation_player.fishing.duplicate()
		presentation_player.fishing.reeling=active and primary_held
	view.set_context(presentation_player,rod_charge_amount(),look_motion)
	look_motion=Vector2.ZERO
	view.animate(delta, move_direction.length(), ads, player.get("reload") != null, sprint, mobile)
	reticle.text = "×" if float(view.hit_time) > 0 else ("·" if ads else "+")
	reticle.modulate = GOLD if float(view.hit_time) > 0 else CREAM
	reticle.visible = active
	var projection_scale := tan(deg_to_rad(camera.fov) * 0.5) / tan(deg_to_rad(base_fov) * 0.5)
	for collection in [actors, enemies]:
		for node in collection.values():
			var previous_position: Vector3 = node.position
			var point: Vector3 = node.get_meta("target", node.position)
			if node.position.distance_to(point) > 8:
				node.position = point
			else:
				node.position = node.position.lerp(point, minf(delta * 12, 1))
			var data: Dictionary = node.get_meta("data", {})
			node.rotation.y = lerp_angle(node.rotation.y, float(data.get("yaw", 0)), minf(delta * 12, 1))
			var velocity: Vector3 = _v(data.velocity) if data.get("velocity") is Dictionary else (node.position-previous_position)/maxf(delta,0.001)
			# Keep nearby motion at the display rate; off-screen joints only need
			# a bounded catch-up pose. World positions and combat still update normally.
			var pose_delta := float(node.get_meta("pose_delta", 0.0)) + delta
			var distance_squared := camera.global_position.distance_squared_to(node.position)
			if collection == enemies:
				node.get_node("Rig").set_visual_distance_squared(distance_squared * projection_scale * projection_scale)
			var nearby := distance_squared < 1600.0
			var in_view := camera.is_position_in_frustum(node.position + Vector3.UP)
			var pose_period := 0.0 if nearby and in_view else (1.0 / 30.0 if in_view else 0.08)
			if pose_delta >= pose_period:
				node.get_node("Rig").animate(pose_delta,velocity)
				pose_delta = 0.0
			node.set_meta("pose_delta", pose_delta)
			if collection == enemies and overlay.is_empty() and str(aim_target.get("id","")) == str(data.get("id","")):
				var direction_to_label: Vector3 = node.position + Vector3.UP - camera.global_position
				if direction_to_label.length() >= 2.5 and direction_to_label.length() < 7 and direction_to_label.normalized().dot(-camera.global_basis.z) > 0.87:
					_ensure_world_label(node)
			for child in node.get_children():
				if child is Label3D:
					if collection == actors:
						child.position.y = lerpf(2.3, 0.9, float(node.get_node("Rig").crawl_weight))
					var towards: Vector3=child.global_position-camera.global_position
					# Nearby actors use the compact target HUD; world labels follow the
					# actual pose and stay hidden at close range to keep the view clear.
					var label_distance := towards.length()
					child.visible = overlay.is_empty() and label_distance<7 and label_distance>=2.5 and towards.normalized().dot(-camera.global_basis.z)>0.87 and str(data.get("lifeState",""))!="DEAD_WAIT" and (collection==actors or str(aim_target.get("id",""))==str(data.get("id","")))
	for object in objects.values():
		if overlay.is_empty() and str(target.get("id","")) == str(object.get_meta("data",{}).get("id","")):
			_ensure_world_label(object)
		for child in object.get_children():
			if child is Label3D:
				child.visible=overlay.is_empty() and str(target.get("id",""))==str(object.get_meta("data",{}).get("id",""))
	for entry in retiring.duplicate():
		entry.time-=delta
		entry.node.get_node("Rig").animate(delta,Vector3.ZERO)
		if entry.time<=0:
			entry.node.queue_free()
			retiring.erase(entry)
	_animate_fishing_lines(delta)
	for projectile in projectiles.values():
		projectile.advance(delta,bool(state.get("paused",false)))
		if projectile.position.distance_squared_to(camera.position)>3600: projectile.visible=false
	if elapsed - network_sample_at >= 1.0:
		network_kib_per_second = float(network_bytes) / 1024.0 / maxf(elapsed - network_sample_at, 0.001)
		network_bytes = 0
		network_sample_at = elapsed
	ui_timer += delta
	if ui_timer >= 0.10:
		ui_timer = 0
		mission.tick()
		if overlay.is_empty():
			_pick_target()
			if mobile and interaction_held and move_direction.length()<0.05:
				_try_rescue()
			_pick_aim_target()
		_update_browser_state()

func _publish_platform_ui() -> void:
	if not OS.has_feature("web") or platform_transport == null: return
	var resume_overlay := platform_previous_overlay if overlay == "chat" else overlay
	var value := JSON.stringify({"overlay":overlay, "resumeOverlay":resume_overlay, "resumeCapture":joined and resume_overlay.is_empty() and not free_mouse and str(player.get("lifeState", "")) in ["ALIVE", "DOWNED"]})
	if value != platform_ui_signature:
		platform_ui_signature = value
		platform_transport.uiState(value)

func _update_browser_state() -> void:
	_publish_platform_ui()
	if not OS.has_feature("web"):
		return
	var rectangle := name_input.get_global_rect()
	var viewport_size := get_viewport().get_visible_rect().size
	var layout := JSON.stringify({"visible":lobby.visible and not joined, "x":rectangle.position.x, "y":rectangle.position.y, "w":rectangle.size.x, "h":rectangle.size.y, "vw":viewport_size.x, "vh":viewport_size.y, "value":name_input.text})
	if layout != last_layout:
		JavaScriptBridge.eval("window.updateNameField(%s)" % layout)
		last_layout = layout
	var readable := {"fps":Engine.get_frames_per_second(), "queryOnlyPhysics":QueryPhysics.enabled, "staticMemoryBytes":OS.get_static_memory_usage(), "drawCalls":int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)), "networkKiBps":snappedf(network_kib_per_second,0.1), "snapshotIntervalMs":snappedf(snapshot_interval_ms,0.1), "snapshotApplyMs":snappedf(snapshot_apply_ms,0.1), "deltaFrames":network_delta_frames, "fullFrames":network_full_frames, "build":CLIENT_BUILD, "onlinePlayers":_online_count(), "inputSeq":input_seq, "inputAck":int(player.get("inputAck", 0)), "heldSlot":str(player.get("heldSlot", "")), "notice":toast_label.text if elapsed < toast_until else "", "mode":str(state.get("mode", "survival")), "joined":joined, "overlay":overlay, "phase":str(state.get("phase", "")), "day":int(state.get("dayIndex", 0)), "threat":int(state.get("threatStage", 0)), "players":state.get("players", []).size(), "hp":int(player.get("hp", 0)), "life":str(player.get("lifeState", "")), "weapon":current_weapon, "ammo":int(_equipped("weapon").get("magazineAmmo", 0)), "backpack":_items_in(str(player.get("backpackId", ""))).size(), "credits":int(state.get("bank", {}).get("credits", 0)), "materials":int(state.get("bank", {}).get("materials", 0)), "water":float(state.get("waterY", 0)), "fishState":str(player.get("fishing", {}).get("state", "")) if player.get("fishing") is Dictionary else "", "x":snappedf(local_pos.x, 0.01), "z":snappedf(local_pos.z, 0.01)}
	readable.presence = _presence_metrics()
	var life_peers: Array = []
	for id in actors:
		var peer: Node3D = actors[id]
		var peer_data: Dictionary = peer.get_meta("data",{})
		var peer_rig = peer.get_node("Rig")
		life_peers.append({"id":id,"life":str(peer_data.get("lifeState","")),"hp":peer_data.get("downedHp",0),"visible":peer.visible and peer_rig.body.visible,"crawlWeight":peer_rig.crawl_weight})
	var weapon_visible := false
	for model in view.models.values():
		weapon_visible = weapon_visible or model.is_visible_in_tree()
	readable.lifeDetail={"downedHp":player.get("downedHp",0),"downedRemaining":player.get("downedRemaining",0),"quiet":player.get("selfReviveReadyIn",0),"eyeHeight":eye_height,"work":player.get("work"),"rescue":player.get("rescue"),"weaponVisible":weapon_visible,"handsVisible":view.hands[0].is_visible_in_tree(),"target":target.get("type",""),"peers":life_peers}
	readable.onboarding = {"status":"retired"}
	readable.mission = mission.data() if mission.active() else {}
	readable.fov = snappedf(camera.fov,0.1)
	readable.ads = bool(player.get("ads",false))
	readable.scope = snappedf(view.scope_alpha(),0.01)
	readable.perks = player.get("perks",[]).size()
	readable.rewardChoices = InventoryUI.pending(self)
	JavaScriptBridge.eval("document.body.dataset.gameState=%s;document.body.dataset.uiMode=%s" % [JSON.stringify(JSON.stringify(readable)), JSON.stringify(overlay)])
	JavaScriptBridge.eval("document.body.dataset.controlsState=%s" % JSON.stringify(JSON.stringify({"entered":platform_game_entered,"ready":platform_transport == null or (platform_game_entered and elapsed >= platform_input_after),"mouseCaptured":Input.mouse_mode == Input.MOUSE_MODE_CAPTURED,"controlsBlocked":platform_controls_blocked,"pointerLocked":bool(JavaScriptBridge.eval("!!document.pointerLockElement",true)),"yaw":yaw,"pitch":pitch})))
	if ui_audit_enabled:
		var buttons: Array = []
		var tabs: Array = []
		if panel.visible:
			for node in panel.find_children("*","Button",true,false):
				if not node.is_visible_in_tree() or node.is_queued_for_deletion(): continue
				var bounds := _audit_rect(node)
				bounds.merge({"text":node.text,"disabled":node.disabled})
				buttons.append(bounds)
			for node in panel.find_children("*","TabBar",true,false):
				if not node.is_visible_in_tree() or node.is_queued_for_deletion(): continue
				for index in range(node.tab_count):
					var tab_rect: Rect2 = node.get_tab_rect(index)
					tab_rect.position += node.global_position
					tabs.append({"text":node.get_tab_title(index),"selected":node.current_tab==index,"x":tab_rect.position.x,"y":tab_rect.position.y,"w":tab_rect.size.x,"h":tab_rect.size.y})
		var scroll_bounds := _audit_rect(panel_scroll)
		scroll_bounds.value=panel_scroll.scroll_vertical
		JavaScriptBridge.eval("document.body.dataset.uiAudit=%s" % JSON.stringify(JSON.stringify({"viewport":{"w":viewport_size.x,"h":viewport_size.y},"panel":_audit_rect(panel),"scroll":scroll_bounds,"buttons":buttons,"tabs":tabs})))

func _audit_rect(control: Control) -> Dictionary:
	var bounds := control.get_global_rect()
	return {"x":bounds.position.x,"y":bounds.position.y,"w":bounds.size.x,"h":bounds.size.y,"visible":control.is_visible_in_tree()}

func _visual_card(parent: Node, icon: String, title: String, subtitle := "", tint := MINT) -> VBoxContainer:
	var card := PanelContainer.new()
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	card.custom_minimum_size.x = 176
	var card_style := _style(Color("18313e"), 7)
	card_style.content_margin_left = 12
	card_style.content_margin_right = 12
	card.add_theme_stylebox_override("panel", card_style)
	parent.add_child(card)
	var col := _column(card, 6)
	col.set_meta("item_definition", icon)
	col.set_meta("focus_scope",icon+":"+title)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	col.add_child(row)
	var glyph := _item_icon(row, icon, tint)
	glyph.custom_minimum_size = Vector2(40, 44)
	var details := _column(row, 3)
	details.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	details.custom_minimum_size.y = 70 if not subtitle.is_empty() else 46
	details.alignment = BoxContainer.ALIGNMENT_CENTER
	var heading := _text(details, title, 15, CREAM)
	heading.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	heading.max_lines_visible = 2
	heading.custom_minimum_size.y = heading.get_line_height() * 2 + heading.get_theme_constant("line_spacing")
	heading.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	heading.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	heading.tooltip_text = title
	heading.mouse_filter = Control.MOUSE_FILTER_PASS
	if not subtitle.is_empty():
		var caption := _text(details, subtitle, 12, tint)
		caption.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		caption.max_lines_visible = 2
		caption.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		caption.tooltip_text = subtitle
		col.set_meta("caption_label",caption)
	return col


func _visual_resources(parent: Node, credits: int, materials: int, seconds := -1.0) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 5)
	parent.add_child(row)
	for entry in [["coin", credits, "经费"], ["scrap", materials, "零件"]]:
		var glyph := _item_icon(row, str(entry[0]), GOLD if str(entry[0]) == "coin" else MINT)
		glyph.custom_minimum_size = Vector2(24, 24)
		glyph.tooltip_text = str(entry[2])
		var label := _text(row, "%s %d" % [str(entry[2]), int(entry[1])], 13, GOLD if str(entry[0]) == "coin" else MINT)
		label.tooltip_text = str(entry[2])
	if seconds >= 0:
		var glyph := _item_icon(row, "clock", MINT)
		glyph.custom_minimum_size = Vector2(24, 24)
		_text(row, "%s 秒" % str(seconds), 13, MINT)
func _visual_meter(parent: Node, title: String, value: float, maximum: float, tint := MINT) -> void:
	var row := HBoxContainer.new()
	parent.add_child(row)
	var label := _text(row, title, 12, tint)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_text(row, "%d / %d" % [int(value), int(maximum)], 12, CREAM)
	var bar := ProgressBar.new()
	bar.custom_minimum_size = Vector2(120, 9)
	bar.max_value = maxf(1, maximum)
	bar.value = value
	bar.show_percentage = false
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var background := StyleBoxFlat.new()
	background.bg_color = Color("091d28")
	background.set_corner_radius_all(3)
	var fill := StyleBoxFlat.new()
	fill.bg_color = tint
	fill.set_corner_radius_all(3)
	bar.add_theme_stylebox_override("background", background)
	bar.add_theme_stylebox_override("fill", fill)
	parent.add_child(bar)
func _visual_grid(parent: Node, columns: int) -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = columns
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 8)
	parent.add_child(grid)
	return grid
func _team_panel() -> void:
	var phase := str(state.get("phase","PREP"))
	var members := _online_players()
	var strip := HBoxContainer.new()
	strip.add_theme_constant_override("separation",12)
	panel_content.add_child(strip)
	if mission.active():
		_compact_row(strip,"trophy","任务模式 · "+mission.title(),"多人练习 · 退出不保存" if mission.free_play() else "入职任务 · 完成后开放园区",GOLD)
		_compact_row(strip,"team","在线 %d / %d" % [_online_count(),int(state.get("maxPlayers",8))],"退出后不保存")
	else:
		_compact_row(strip,"clock","第 %d 天 · %s" % [int(state.get("dayIndex",1)),str(PHASES.get(phase,phase))],"守住 %d 夜" % int(state.get("statistics",{}).get("daysSurvived",0)),GOLD)
		_compact_row(strip,"team","在线 %d / %d" % [_online_count(),int(state.get("maxPlayers",8))],"v%s · 自动保存" % CLIENT_BUILD)
	var shared_balance := HBoxContainer.new()
	panel_content.add_child(shared_balance)
	_text(shared_balance,"团队物资",13,MINT)
	var team_bank: Dictionary = state.get("bank",{})
	_visual_resources(shared_balance,int(team_bank.get("credits",0))-int(team_bank.get("reservedCredits",0)),int(team_bank.get("materials",0))-int(team_bank.get("reservedMaterials",0)))
	var grid := _visual_grid(panel_content,1 if members.size()<=3 else 2)
	for member in members:
		var status := "已准备" if bool(member.get("ready",false)) else "未准备"
		if phase != "PREP": status = str({"ALIVE":"行动中","DOWNED":"等待救援","DEAD_WAIT":"等待重返"}.get(str(member.get("lifeState","ALIVE")),"行动中"))
		var row := _compact_row(grid,"player",str(member.get("name","队员")))
		var details: VBoxContainer = row.get_node("Details")
		details.set_meta("team_member_connected",bool(member.get("connected",false)))
		var health := _column(row,4)
		health.custom_minimum_size.x = 112
		health.alignment = BoxContainer.ALIGNMENT_CENTER
		var info := HBoxContainer.new()
		health.add_child(info)
		var status_label := _text(info,status,12,MINT)
		status_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_text(info,"%d HP" % int(member.get("hp",0)),12,CREAM)
		var bar := ProgressBar.new()
		bar.custom_minimum_size = Vector2(112,7)
		bar.max_value = 100
		bar.value = float(member.get("hp",0))
		bar.show_percentage = false
		var fill := _button_style(MINT,3)
		fill.set_content_margin_all(0)
		var background := _button_style(Color("091d28"),3)
		background.set_content_margin_all(0)
		bar.add_theme_stylebox_override("fill",fill)
		bar.add_theme_stylebox_override("background",background)
		health.add_child(bar)
	if str(state.get("hostId","")) == self_id:
		_toggle_setting("队友伤害",bool(state.get("friendlyFire",false)),func(value: bool): _command("Settings","",{"friendlyFire":value}))
	if phase == "PREP" and not player.is_empty() and not mission.active():
		var ready_row := HBoxContainer.new()
		panel_footer.add_child(ready_row)
		var note := _text(ready_row,"准备好后，一起开始行动",13,MINT)
		note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		note.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		_system_button(ready_row,"取消准备" if bool(player.get("ready",false)) else "准备好了",func(): _command("Ready","",{"ready":not bool(player.get("ready",false))}))
		if str(state.get("hostId","")) == self_id:
			var start := _system_button(ready_row,"开始行动",func(): _command("StartDay"),true)
			start.disabled = members.any(func(member): return not bool(member.get("ready",false)))
			start.tooltip_text = "全队在线队员准备后开始"

func _system_footer() -> void:
	panel_footer.visible = true
	panel_footer.add_child(HSeparator.new())
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation",8)
	panel_footer.add_child(actions)
	var warning := _text(actions,"体验不保存" if mission.active() else "菜单不暂停战斗",12,GOLD)
	warning.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	warning.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	if not mission.active(): _system_button(actions,"保存进度",func(): _command("Save"))
	_nav_button(actions,"返回大厅",_leave).tooltip_text = "退出任务后练习物资不保留" if mission.active() else "房主离开会保存并暂停；队员离开不影响朋友" if platform_transport != null else "保留进度；无人在线时暂停世界"


func _compact_row(parent: Node, icon: String, title: String, subtitle := "", tint := MINT) -> HBoxContainer:
	var card := PanelContainer.new()
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var skin := _style(Color("18313e"), 7)
	skin.content_margin_left = 12
	skin.content_margin_right = 12
	skin.content_margin_top = 8
	skin.content_margin_bottom = 8
	card.add_theme_stylebox_override("panel",skin)
	parent.add_child(card)
	var row := HBoxContainer.new()
	row.set_meta("focus_scope",icon+":"+title)
	row.add_theme_constant_override("separation",12)
	card.add_child(row)
	var glyph := _item_icon(row,icon,tint)
	glyph.custom_minimum_size = Vector2(40,40)
	glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var details := _column(row,3)
	details.name = "Details"
	details.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	details.alignment = BoxContainer.ALIGNMENT_CENTER
	details.custom_minimum_size.y = 70 if not subtitle.is_empty() else 46
	var heading := _text(details,title,15,CREAM)
	heading.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	heading.max_lines_visible = 2
	heading.custom_minimum_size.y = heading.get_line_height() * 2 + heading.get_theme_constant("line_spacing")
	heading.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	heading.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	heading.tooltip_text = title
	heading.mouse_filter = Control.MOUSE_FILTER_PASS
	if not subtitle.is_empty():
		var caption := _text(details,subtitle,12,tint)
		caption.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		caption.max_lines_visible = 2
		caption.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		caption.tooltip_text = subtitle
	return row

func _visual_cost(parent: Node, credits: int, materials: int, seconds := -1.0) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation",5)
	parent.add_child(row)
	for entry in [["coin",credits,"经费",GOLD],["scrap",materials,"零件",MINT]]:
		if int(entry[1]) <= 0: continue
		var glyph := _item_icon(row,str(entry[0]),entry[3])
		glyph.custom_minimum_size = Vector2(24,24)
		glyph.tooltip_text = str(entry[2])
		_text(row,str(entry[1]),13,entry[3]).tooltip_text = str(entry[2])
	if credits <= 0 and materials <= 0: _text(row,"免费",13,MINT)
	if seconds >= 0:
		var clock_icon := _item_icon(row,"clock",MINT)
		clock_icon.custom_minimum_size = Vector2(24,24)
		_text(row,str(snappedf(seconds,0.1))+" 秒",13,MINT)

func _setting_value(value: float, format: String) -> String:
	if format == "degrees": return "%d°" % int(round(value))
	if format == "percent": return "%d%%" % int(round(value*100))
	if format == "sensitivity": return "%.2f×" % (value/0.0024)
	return str(snappedf(value,0.001))

func _completion_panel() -> void:
	_compact_row(panel_content,"treasure","这次冒险的收获","进度与装备自动保存",GOLD)
	var statistics: Dictionary = state.get("statistics",{})
	var grid := _visual_grid(panel_content,2)
	for entry in [["经历天数",int(state.get("dayIndex",1))],["钓上活鱼",int(statistics.get("fishLanded",0))],["击倒怪物",int(statistics.get("kills",0))],["失守次数",int(statistics.get("breaches",0))]]:
		var row := HBoxContainer.new()
		row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(row)
		var label := _text(row,str(entry[0]),14,MINT)
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_text(row,str(entry[1]),20,GOLD)
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_END
	actions.add_theme_constant_override("separation",12)
	panel_content.add_child(actions)
	_system_button(actions,"保存冒险",func(): _command("Save"))
	if str(state.get("hostId","")) == self_id:
		_system_button(actions,"新建冒险",_confirm_new,true)

func _storage_list(parent: Node, side: String, height: float) -> VBoxContainer:
	var scroll := ScrollContainer.new()
	scroll.set_meta("storage_side",side)
	scroll.custom_minimum_size.y = height
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	parent.add_child(scroll)
	var list := _column(scroll,8)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return list

func _item_move_reason(item: Dictionary, destination: Dictionary, full_reason: String) -> String:
	if item.get("lockedBy") != null: return "物品正在使用"
	if destination.is_empty(): return "目标暂不可用"
	if item.get("loanOwnerSlotId") != null and str(destination.get("type", "")) == "personal_storage": return "借用品不能入库"
	if item.get("loanOwnerSlotId") != null and item.get("loanOwnerSlotId") != destination.get("ownerSlotId"): return "借用品仅本人使用"
	var items := _items_in(str(destination.id))
	if items.size() < int(destination.get("slotLimit",0)): return ""
	var definition := _find(config.items,str(item.get("definitionId","")))
	var stack := int(definition.get("stack",1))
	for existing in items:
		if str(existing.get("definitionId","")) == str(item.get("definitionId","")) and existing.get("lockedBy") == null and existing.get("loanOwnerSlotId") == item.get("loanOwnerSlotId") and int(existing.get("quantity",1)) < stack: return ""
	return full_reason

func _set_move_state(button: Button, item: Dictionary, destination: Dictionary, full_reason: String) -> void:
	var reason := _station_reason("storage") if overlay == "storage" else ""
	if reason.is_empty(): reason = _item_move_reason(item,destination,full_reason)
	_action_state(button,reason,"能装下的先转移，剩余物品保留")

func _sell_button(parent: Node) -> Button:
	var button := _button(parent,"回收全部",func(): _station_command("Deposit"),true)
	var has_goods := _items_in(str(player.get("backpackId",""))).any(func(item):
		var definition := _find(config.items,str(item.get("definitionId","")))
		return SaleUI.is_loot(definition) and not bool(definition.get("crafting_material",false)) and item.get("lockedBy")==null and item.get("loanOwnerSlotId")==null and (int(definition.get("sell_c",0)) > 0 or int(definition.get("deposit_m",0)) > 0))
	var reason := _station_reason("recycle")
	if reason.is_empty() and not has_goods: reason = "背包里没有可回收物"
	button.disabled = not reason.is_empty()
	button.tooltip_text = reason if button.disabled else "战利品换成个人资源；保留制作材料"
	return button
