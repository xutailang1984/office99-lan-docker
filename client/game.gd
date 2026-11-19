extends Node3D

const WorldScene = preload("res://world.gd")
const CombatView = preload("res://combat_view.gd")
const FONT = preload("res://fonts/IslandSans.ttf")
const INK = Color("#17393e")
const CREAM = Color("#fff1d2")
const GOLD = Color("#f1c575")
const MINT = Color("#a9d8c5")
var world: Node3D
var camera: Camera3D
var rod: Node3D
var socket: WebSocketPeer
var greeted := false
var joined := false
var my_id := ""
var nickname := ""
var profile_token := ""
var current_state: Dictionary = {}
var player: Dictionary = {}
var avatars: Dictionary = {}
var fish_nodes: Dictionary = {}
var bobbers: Dictionary = {}
var ropes: Dictionary = {}
var yaw := 0.0
var pitch := -0.08
var local_pos := Vector3.ZERO
var server_pos := Vector3.ZERO
var input_direction := Vector2.ZERO
var input_clock := 0.0
var elapsed := 0.0
var jump_height := 0.0
var jump_velocity := 0.0
var swing := 0.0
var toast_time := 0.0
var connect_time := 0.0
var reconnect_time := -1.0
var last_hp := 100
var last_caught := 0
var previous_cast := ""
var startup_check := false
var connection_error := ""
var overlay_mode := "menu"
var gui: Control
var hud: Control
var menu: PanelContainer
var menu_heading: Label
var menu_description: Label
var name_input: LineEdit
var join_button: Button
var connection_label: Label
var stats_label: Label
var quest_label: Label
var roster_label: Label
var context_label: Label
var phase_label: Label
var notice_label: Label
var save_label: Label
var reticle: Label
var roster_panel: PanelContainer
var settings_button: Button
var panel: PanelContainer
var panel_content: VBoxContainer
var health_flash: ColorRect
var sound: AudioStreamPlayer
var last_saved_at := 0.0
var last_name_layout := ""
var drag_look := false
var keyboard_mode := false
var menu_settings: Button
var friendly_check: CheckButton
var host_note: Label
var identity_saved := true
var combat_view: Node3D
var weapon_bar: Label
var combat_label: Label
var boss_label: Label
var charge_bar: ProgressBar
var combat_text_time := 0.0
var aiming := false
var trigger_held := false
var reel_held := false
var attack_ready_at := 0.0
var charge_started := -1.0
var cast_started := -1.0
var combat_hits := 0

func _ready() -> void:
	world = WorldScene.new()
	add_child(world)
	camera = Camera3D.new()
	add_child(camera)
	camera.current = true
	camera.fov = 78
	camera.near = 0.06
	camera.far = 200
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = 35
	camera.position = Vector3(23, 18, 26)
	camera.look_at(Vector3(-6, 0, -1))
	rod = world.instance("rod", camera)
	rod.scale = Vector3.ONE * 0.52
	rod.visible = false
	sound = AudioStreamPlayer.new()
	add_child(sound)
	_build_interface()
	combat_view = CombatView.new()
	add_child(combat_view)
	combat_view.setup(self)
	startup_check = "--smoke-headless" in OS.get_cmdline_user_args()
	if startup_check:
		print("FISHING_CLIENT_READY assets=8 ui=zh_CN")
		await get_tree().create_timer(1).timeout
		get_tree().quit()

func _style(color: Color, radius := 10, border := Color.TRANSPARENT) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.set_corner_radius_all(radius)
	style.set_border_width_all(1)
	style.border_color = border
	style.content_margin_left = 22
	style.content_margin_right = 22
	style.content_margin_top = 18
	style.content_margin_bottom = 18
	return style

func _text(parent: Node, text: String, size := 18, color := CREAM) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.add_theme_color_override("font_outline_color", Color(0.04, 0.11, 0.12, 0.7))
	label.add_theme_constant_override("outline_size", 2)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label

func _button(parent: Node, text: String, callable: Callable, primary := false) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size.y = 48
	button.add_theme_stylebox_override("normal", _style(GOLD if primary else Color("#2a5156"), 7))
	button.add_theme_stylebox_override("hover", _style(Color("#f8d999") if primary else Color("#3b6567"), 7))
	button.add_theme_stylebox_override("pressed", _style(Color("#dba454") if primary else Color("#214249"), 7))
	button.add_theme_stylebox_override("focus", _style(Color.TRANSPARENT, 7, MINT))
	button.add_theme_color_override("font_color", INK if primary else CREAM)
	button.add_theme_color_override("font_hover_color", INK if primary else CREAM)
	button.add_theme_color_override("font_pressed_color", INK if primary else CREAM)
	button.add_theme_font_size_override("font_size", 18)
	button.pressed.connect(callable)
	parent.add_child(button)
	return button

func _card(parent: Node, pos: Vector2, width: float) -> PanelContainer:
	var card := PanelContainer.new()
	card.position = pos
	card.custom_minimum_size.x = width
	card.add_theme_stylebox_override("panel", _style(Color(0.065, 0.17, 0.19, 0.93), 12, Color(0.64, 0.83, 0.76, 0.2)))
	parent.add_child(card)
	return card

func _column(parent: Node, separation := 12) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", separation)
	parent.add_child(column)
	return column

func _build_interface() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	gui = Control.new()
	gui.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	gui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(gui)
	var theme := Theme.new()
	var ui_font := FontVariation.new()
	ui_font.base_font = FONT
	ui_font.variation_opentype = {"wght": 550.0}
	theme.default_font = ui_font
	theme.default_font_size = 18
	gui.theme = theme
	menu = _card(gui, Vector2(54, 105), 410)
	var column := _column(menu, 15)
	_text(column, "ISLAND DAYS  /  COMBAT 02", 14, GOLD)
	menu_heading = _text(column, "方岛渔友", 46)
	menu_description = _text(column, "钓上来，还得打得过。\n把鱼打飞，和朋友接上一枪。", 18, MINT)
	_text(column, "1–4 人合作   ·   局域网海岛", 16)
	name_input = LineEdit.new()
	name_input.placeholder_text = "给你的渔友起个昵称"
	name_input.max_length = 16
	name_input.custom_minimum_size = Vector2(350, 52)
	name_input.add_theme_stylebox_override("normal", _style(Color("#244a50"), 7))
	name_input.add_theme_stylebox_override("focus", _style(Color("#244a50"), 7, GOLD))
	name_input.add_theme_color_override("font_color", CREAM)
	name_input.text = _storage_get("island-days.last-name")
	if name_input.text.is_empty():
		name_input.text = "渔友%d" % randi_range(100, 999)
	column.add_child(name_input)
	join_button = _button(column, "带上鱼竿，加入海岛  →", _join, true)
	var free_mouse := CheckButton.new()
	free_mouse.text = "自由鼠标模式（右键拖动转向）"
	free_mouse.add_theme_font_size_override("font_size", 13)
	free_mouse.toggled.connect(func(enabled: bool): keyboard_mode = enabled)
	column.add_child(free_mouse)
	menu_settings = _button(column, "房间设置", _show_settings)
	menu_settings.visible = false
	connection_label = _text(column, "同一浏览器、同一昵称可继续上次进度。", 13, MINT)
	connection_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	connection_label.custom_minimum_size.x = 350
	_text(column, "1 鱼竿  2 拳套  3 刀  4 手枪\n左键使用  右键蓄力 / 瞄准  E 拾取 / 商店\nG 抓鱼 / 投掷  R 换弹  Shift 奔跑", 13, MINT)
	hud = Control.new()
	hud.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.visible = false
	gui.add_child(hud)
	var brand := _text(hud, "方岛渔友", 27)
	brand.position = Vector2(28, 20)
	var location := _text(hud, "初航营地  /  潮汐岛", 13, GOLD)
	location.position = Vector2(29, 60)
	var stats_card := _card(hud, Vector2(26, 96), 263)
	stats_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stats_label = _text(stats_card, "", 19)
	var quest_card := _card(hud, Vector2(26, 216), 263)
	quest_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	quest_label = _text(quest_card, "", 15, MINT)
	roster_panel = _card(hud, Vector2.ZERO, 224)
	roster_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	roster_panel.offset_left = -250
	roster_panel.offset_right = -26
	roster_panel.offset_top = 24
	var roster_column := _column(roster_panel, 10)
	roster_label = _text(roster_column, "", 14, MINT)
	settings_button = _button(roster_column, "房间设置  [Esc]", func(): _show_settings())
	settings_button.add_theme_font_size_override("font_size", 14)
	settings_button.custom_minimum_size.y = 34
	reticle = _text(hud, "+", 24)
	reticle.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	reticle.offset_left = -8
	reticle.offset_top = -18
	combat_label = _text(hud, "", 18, GOLD)
	combat_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	combat_label.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	combat_label.offset_left = -310
	combat_label.offset_right = 310
	combat_label.offset_top = 45
	combat_label.offset_bottom = 108
	charge_bar = ProgressBar.new()
	hud.add_child(charge_bar)
	charge_bar.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	charge_bar.offset_left = -80
	charge_bar.offset_right = 80
	charge_bar.offset_top = 30
	charge_bar.offset_bottom = 37
	charge_bar.show_percentage = false
	charge_bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	charge_bar.add_theme_stylebox_override("background", _style(Color("#244a50"), 2))
	charge_bar.add_theme_stylebox_override("fill", _style(GOLD, 2))
	boss_label = _text(hud, "", 20, Color("#ffb17f"))
	boss_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	boss_label.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	boss_label.offset_left = -310
	boss_label.offset_right = 310
	boss_label.offset_top = 77
	boss_label.offset_bottom = 126
	phase_label = _text(hud, "", 23, GOLD)
	phase_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	phase_label.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	phase_label.offset_left = -450
	phase_label.offset_right = 450
	phase_label.offset_top = -176
	phase_label.offset_bottom = -137
	context_label = _text(hud, "", 16)
	context_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	context_label.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	context_label.offset_left = -480
	context_label.offset_right = 480
	context_label.offset_top = -128
	context_label.offset_bottom = -96
	weapon_bar = _text(hud, "", 17, CREAM)
	weapon_bar.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	weapon_bar.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	weapon_bar.offset_left = -460
	weapon_bar.offset_right = 460
	weapon_bar.offset_top = -82
	weapon_bar.offset_bottom = -53
	var belt_style := _style(Color(0.055, 0.14, 0.16, 0.94), 7)
	belt_style.content_margin_top = 4
	belt_style.content_margin_bottom = 4
	weapon_bar.add_theme_stylebox_override("normal", belt_style)
	var controls := _text(hud, "左键 使用   右键 蓄力 / 瞄准   E 拾取 / 商店   G 抓鱼 / 投掷   R 换弹   Shift 奔跑   Esc 菜单", 13, MINT)
	controls.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	controls.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	controls.offset_left = -540
	controls.offset_right = 540
	controls.offset_top = -43
	controls.offset_bottom = -20
	save_label = _text(hud, "自动存档", 12, MINT)
	save_label.position = Vector2(29, 326)
	health_flash = ColorRect.new()
	health_flash.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	health_flash.color = Color(0.7, 0.15, 0.09, 0)
	health_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(health_flash)
	notice_label = _text(gui, "", 18, GOLD)
	notice_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	notice_label.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	notice_label.offset_left = -440
	notice_label.offset_right = 440
	notice_label.offset_top = 28
	notice_label.offset_bottom = 60
	panel = _card(gui, Vector2.ZERO, 480)
	panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	panel.offset_left = -240
	panel.offset_right = 240
	panel.offset_top = -210
	var panel_scroll := ScrollContainer.new()
	panel_scroll.custom_minimum_size = Vector2(442, 390)
	panel_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel.add_child(panel_scroll)
	panel_content = _column(panel_scroll, 12)
	panel_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.visible = false

func _storage_get(key: String) -> String:
	if OS.has_feature("web"):
		var result = JavaScriptBridge.eval("(function(){try{return localStorage.getItem(%s)||'';}catch(e){return '';}})()" % JSON.stringify(key))
		return str(result) if result != null else ""
	var file := ConfigFile.new()
	file.load("user://profiles.cfg")
	return str(file.get_value("profiles", key, ""))

func _storage_set(key: String, value: String) -> bool:
	if OS.has_feature("web"):
		return bool(JavaScriptBridge.eval("(function(){try{localStorage.setItem(%s,%s);return true;}catch(e){return false;}})()" % [JSON.stringify(key), JSON.stringify(value)]))
	else:
		var file := ConfigFile.new()
		file.load("user://profiles.cfg")
		file.set_value("profiles", key, value)
		return file.save("user://profiles.cfg") == OK

func _join() -> void:
	if joined:
		_resume()
		return
	if OS.has_feature("web"):
		var web_name = JavaScriptBridge.eval("document.getElementById('player-name').value")
		if web_name != null:
			name_input.text = str(web_name)
	nickname = name_input.text.strip_edges()
	if nickname.is_empty():
		name_input.grab_focus()
		connection_label.text = "先起个昵称，就可以出发了。"
		return
	profile_token = _storage_get("island-days.profile." + nickname)
	_storage_set("island-days.last-name", nickname)
	connection_error = ""
	_connect()

func _connect() -> void:
	if socket != null:
		socket.close()
	socket = WebSocketPeer.new()
	player = {}
	previous_cast = ""
	var address := "ws://127.0.0.1:8080/ws"
	if not OS.has_feature("web") and not OS.get_environment("FISHING_SERVER_URL").is_empty():
		address = OS.get_environment("FISHING_SERVER_URL")
	if OS.has_feature("web"):
		address = str(JavaScriptBridge.eval("(location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws'"))
	greeted = false
	connect_time = elapsed
	reconnect_time = -1
	var result := socket.connect_to_url(address)
	join_button.disabled = true
	connection_label.text = "正在靠岸…"
	if result != OK:
		connection_label.text = "连接失败，请先启动海岛服务。"
		join_button.disabled = false

func _send(message: Dictionary) -> void:
	if socket != null and socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.send_text(JSON.stringify(message))

func _network() -> void:
	if socket == null:
		return
	socket.poll()
	var status := socket.get_ready_state()
	if status == WebSocketPeer.STATE_OPEN:
		if not greeted:
			var hello := {"type": "hello", "name": nickname}
			if not profile_token.is_empty():
				hello["token"] = profile_token
			_send(hello)
			greeted = true
		while socket.get_available_packet_count() > 0:
			var message = JSON.parse_string(socket.get_packet().get_string_from_utf8())
			if message is Dictionary:
				_receive(message)
	elif status == WebSocketPeer.STATE_CLOSED:
		var code := socket.get_close_code()
		socket = null
		joined = false
		rod.visible = false
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		menu.visible = true
		panel.visible = false
		overlay_mode = "menu"
		name_input.visible = true
		join_button.disabled = false
		join_button.text = "重新加入海岛  →"
		menu_heading.text = "稍作停靠"
		connection_label.text = connection_error if not connection_error.is_empty() else "连接中断，请确认海岛服务仍在运行，然后重新加入。"
		if code == 4001:
			connection_label.text = "这个渔友已在另一个页面登录。重新加入会接管该角色。"
		elif code == 4003:
			connection_label.text = "服务器未找到旧存档，原有身份已保留。请检查存档或换一个新昵称。"
	elif elapsed - connect_time > 12 and status == WebSocketPeer.STATE_CONNECTING:
		socket.close()

func _receive(message: Dictionary) -> void:
	match str(message.get("type", "")):
		"welcome":
			my_id = str(message.playerId)
			profile_token = str(message.token)
			identity_saved = _storage_set("island-days.profile." + nickname, profile_token)
			joined = true
			camera.projection = Camera3D.PROJECTION_PERSPECTIVE
			join_button.disabled = false
			join_button.text = "进入海岛  →"
			menu_heading.text = "欢迎上岛"
			menu_description.text = "1 钓鱼，咬钩后按住左键收线。\n2 切拳套，瞄准鱼再出拳；\n长按右键蓄力，松开把鱼打飞！"
			name_input.visible = false
			connection_label.text = "进度自动保存在这台海岛服务器。"
			hud.visible = true
			rod.visible = true
			_toast("欢迎来到潮汐岛，%s。" % nickname)
			_tone(440, 0.14)
		"state":
			current_state = message
			_sync_world()
		"combat":
			combat_view.handle_event(message)
			if str(message.get("actorId", "")) == my_id and str(message.get("kind", "")) in ["hit", "kill"]:
				combat_hits += 1
		"notice", "error":
			var text := str(message.get("message", ""))
			_toast(text)
			if not joined:
				connection_error = text
			if overlay_mode == "shop":
				_refresh_panel.call_deferred()

func _sync_world() -> void:
	var old_economy := [player.get("coins", -1), player.get("rod", -1), player.get("bag", []).size(), player.get("weapons", [])]
	var active_players: Array = []
	for data in current_state.get("players", []):
		var id := str(data.id)
		active_players.append(id)
		if id == my_id:
			var first := player.is_empty()
			player = data
			server_pos = Vector3(float(data.x), 0.06, float(data.z))
			if first or local_pos.distance_to(server_pos) > 3.5:
				local_pos = server_pos
				if not first:
					jump_height = 0
			if int(data.hp) < last_hp:
				health_flash.color.a = 0.21
				_tone(110, 0.08)
			last_hp = int(data.hp)
			if int(data.progress.caught) > last_caught:
				_tone(740, 0.18)
			last_caught = int(data.progress.caught)
			var cast_phase := str(data.cast.phase) if data.cast != null else ""
			if cast_phase == "bite" and previous_cast != "bite":
				_tone(930, 0.25)
			previous_cast = cast_phase
		else:
			if not avatars.has(id):
				var avatar := Node3D.new()
				add_child(avatar)
				world.instance("fisherman", avatar)
				world.label(avatar, str(data.name), Vector3(0, 2, 0), 27, CREAM)
				avatar.position = Vector3(data.x, 0.07, data.z)
				avatars[id] = avatar
			avatars[id].set_meta("target", Vector3(data.x, 0.07 + float(data.get("y", 0)), data.z))
			avatars[id].set_meta("angle", float(data.angle) + PI)
		_sync_line(id, data)
	for id in avatars.keys():
		if not active_players.has(id):
			avatars[id].queue_free()
			avatars.erase(id)
	for id in bobbers.keys():
		if not active_players.has(id):
			_remove_line(id)
	var active_fish: Array = []
	for data in current_state.get("fish", []):
		var id := str(data.id)
		active_fish.append(id)
		if not fish_nodes.has(id):
			var fish := Node3D.new()
			add_child(fish)
			var model_name: String = str(data.get("model", "goldfish" if "金" in str(data.kind) else "fish"))
			if not world.models.has(model_name):
				model_name = "fish"
			var visual: Node3D = world.instance(model_name, fish)
			visual.scale = Vector3.ONE * (3.6 if data.get("boss", false) else (1.8 if model_name == "goldfish" else 1.5))
			fish.set_meta("visual", visual)
			var badge: Label3D = world.label(fish, "", Vector3(0, 2.2 if data.get("boss", false) else 1.1, 0), 24, GOLD)
			fish.set_meta("badge", badge)
			fish.set_meta("warning", combat_view.warning_ring(fish, 2.5 if data.get("boss", false) else 0.95))
			fish.position = Vector3(data.x, float(data.get("y", 0.12)), data.z)
			fish_nodes[id] = fish
		var fish_node: Node3D = fish_nodes[id]
		fish_node.set_meta("target", Vector3(data.x, float(data.get("y", 0.12)), data.z))
		fish_node.set_meta("data", data)
		var phase := str(data.get("state", "chase"))
		var phase_name: String = {"windup": "准备扑击！", "lunge": "冲撞！", "recover": "破绽", "stunned": "眩晕", "airborne": "可追击", "held": "抓住了"}.get(phase, "")
		var badge: Label3D = fish_node.get_meta("badge")
		badge.text = "%s  ·  %d 金币\n[ E ] 收起   [ G ] 抓起" % [data.kind, int(data.get("lootValue", 0))] if phase == "loot" else "%s  %d/%d\n%s" % [data.kind, data.hp, data.maxHp, phase_name]
		badge.modulate = Color("#a7f3b0") if phase == "loot" else (Color("#ff9070") if phase in ["windup", "lunge"] else GOLD)
		var last_hit: float = float(fish_node.get_meta("hitAt", 0))
		if float(data.get("hitAt", 0)) > last_hit:
			fish_node.set_meta("flash_until", elapsed + 0.10)
		fish_node.set_meta("hitAt", float(data.get("hitAt", 0)))
		var warning: MeshInstance3D = fish_node.get_meta("warning")
		var radius: float = float(data.get("attackRadius", 3.6 if data.get("boss", false) else 1.1))
		if not is_equal_approx(warning.mesh.outer_radius, radius + 0.06):
			warning.mesh.outer_radius = radius + 0.06
			warning.mesh.inner_radius = maxf(0.1, radius - 0.06)
	for id in fish_nodes.keys():
		if not active_fish.has(id):
			fish_nodes[id].queue_free()
			fish_nodes.erase(id)
	_update_hud()
	if overlay_mode == "settings" and is_instance_valid(friendly_check):
		var is_host := str(current_state.get("hostId", "")) == my_id
		friendly_check.set_pressed_no_signal(current_state.get("friendlyFire", false))
		friendly_check.disabled = not is_host
		host_note.text = "你是房主，可以修改此设置。" if is_host else "只有房主可以修改设置。"
	if overlay_mode == "shop" and old_economy != [player.get("coins", -1), player.get("rod", -1), player.get("bag", []).size(), player.get("weapons", [])]:
		_refresh_panel.call_deferred()
	if OS.has_feature("web") and joined:
		var public_check := {"joined": true, "players": active_players.size(), "coins": player.get("coins", 0), "rod": player.get("rod", 1), "bag": player.get("bag", []).size(), "hp": player.get("hp", 100), "x": player.get("x", 0), "z": player.get("z", 0), "cast": previous_cast, "fish": active_fish.size(), "friendlyFire": current_state.get("friendlyFire", false)}
		public_check.merge({"build": "0.2.0", "weapon": player.get("weapon", "rod"), "weapons": player.get("weapons", []), "ammo": player.get("ammo", 0), "reload": player.get("reloadRemaining", 0), "hits": combat_hits, "held": player.get("heldFishId") != null})
		JavaScriptBridge.eval("document.body.dataset.gameState=%s" % JSON.stringify(JSON.stringify(public_check)))

func _sync_line(id: String, data: Dictionary) -> void:
	if data.cast == null:
		_remove_line(id)
		return
	if not bobbers.has(id):
		bobbers[id] = world.box(self, Vector3.ZERO, Vector3(0.16, 0.2, 0.16), GOLD)
		var rope := MeshInstance3D.new()
		var cylinder := CylinderMesh.new()
		cylinder.top_radius = 0.009
		cylinder.bottom_radius = 0.009
		cylinder.height = 1
		cylinder.radial_segments = 4
		rope.mesh = cylinder
		rope.material_override = world.material(Color("#f5efc7"))
		add_child(rope)
		ropes[id] = rope
	bobbers[id].position = Vector3(float(data.cast.x), 0.02, float(data.cast.z))
	bobbers[id].set_meta("bite", data.cast.phase == "bite")
	bobbers[id].set_meta("origin", Vector3(data.x, 1.25, data.z))

func _remove_line(id: String) -> void:
	if bobbers.has(id):
		bobbers[id].queue_free()
		ropes[id].queue_free()
		bobbers.erase(id)
		ropes.erase(id)

func _update_hud() -> void:
	if player.is_empty():
		return
	stats_label.text = "生命  %d / 100\n金币  %d    鱼竿  Lv.%d\n鱼篓  %d / 30" % [player.hp, player.coins, player.rod, player.bag.size()]
	var tasks: Dictionary = current_state.get("tasks", {})
	quest_label.text = "营地订单  /  合作任务\n累计售鱼  %d / %d\n已完成 %d 单" % [tasks.get("sold", 0), tasks.get("target", 10), tasks.get("completed", 0)]
	var lines := "一起垂钓  %d / 4\n" % current_state.get("players", []).size()
	for data in current_state.get("players", []):
		lines += "\n%s%s" % [data.name, "  · 房主" if str(data.id) == str(current_state.get("hostId", "")) else ""]
	roster_label.text = lines
	last_saved_at = float(current_state.get("savedAt", 0))
	save_label.text = "自动存档  ·  队友伤害%s" % ("开启" if current_state.get("friendlyFire", false) else "关闭") if last_saved_at > 0 else "正在建立存档…"
	var weapon: String = str(player.get("weapon", "rod"))
	var slots: Array[String] = []
	for item in [["rod", "1 鱼竿"], ["fists", "2 拳套"], ["knife", "3 渔刀"], ["pistol", "4 手枪"]]:
		var owned: bool = item[0] == "rod" or item[0] in player.get("weapons", ["fists"])
		slots.append("【%s】" % item[1] if item[0] == weapon else str(item[1]) + (" · 待购买" if not owned else ""))
	weapon_bar.text = "    ".join(slots)
	if weapon == "pistol":
		weapon_bar.text += "    |    %d / 6" % int(player.get("ammo", 0))
	boss_label.text = ""
	for data in current_state.get("fish", []):
		if data.get("boss", false) and int(data.hp) > 0:
			boss_label.text = "%s   %d / %d\n%s" % [data.kind, data.hp, data.maxHp, "红圈预警时横移，扑空后集中攻击！"]
	if not identity_saved:
		save_label.text = "浏览器无法保留角色身份，请勿关闭页面"

func _resume() -> void:
	menu.visible = false
	panel.visible = false
	overlay_mode = ""
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if keyboard_mode else Input.MOUSE_MODE_CAPTURED
	get_viewport().gui_release_focus()

func _pause() -> void:
	if not joined:
		return
	_release_actions()
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	menu.visible = true
	panel.visible = false
	overlay_mode = "menu"
	menu_heading.text = "海风正好"
	menu_description.text = "暂停操作，岛上的朋友仍在继续。\n准备好就回到岸边。"
	join_button.text = "继续钓鱼  →"

func _clear_panel(title: String) -> void:
	_release_actions()
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	menu.visible = false
	panel.visible = true
	for child in panel_content.get_children():
		panel_content.remove_child(child)
		child.queue_free()
	_text(panel_content, title, 29)

func _show_settings() -> void:
	if not joined:
		return
	overlay_mode = "settings"
	_clear_panel("一起玩，自己定规矩")
	var host := str(current_state.get("hostId", "")) == my_id
	_text(panel_content, "队友伤害默认关闭。开启后，拳、刀和枪\n都可能打中准星前的队友。倒地保留进度。", 16, MINT)
	var check := CheckButton.new()
	check.text = "允许队友之间互相伤害"
	check.button_pressed = current_state.get("friendlyFire", false)
	check.disabled = not host
	check.toggled.connect(func(enabled: bool):
		_send({"type": "settings", "friendlyFire": enabled})
		_toast("队友伤害已%s。" % ("开启" if enabled else "关闭")))
	panel_content.add_child(check)
	friendly_check = check
	host_note = _text(panel_content, "你是房主，可以修改此设置。" if host else "只有房主可以修改设置。", 14, GOLD)
	_text(panel_content, "金币、装备、鱼篓和任务进度自动保存。\n换电脑 / 浏览器会使用独立角色。", 14, MINT)
	_button(panel_content, "返回海岛", _resume, true)

func _show_shop() -> void:
	if Vector2(local_pos.x, local_pos.z + 6).length() > 3:
		_toast("走近潮汐商店，再按 E 交易。")
		return
	overlay_mode = "shop"
	_refresh_panel()

func _refresh_panel() -> void:
	if overlay_mode != "shop" or player.is_empty():
		return
	_clear_panel("潮汐商店")
	var worth := 0
	for item in player.get("bag", []):
		worth += int(item.value)
	_text(panel_content, "先把鱼打服，再换更趁手的家伙。", 16, MINT)
	_text(panel_content, "持有 %d 金币  ·  鱼竿 Lv.%d\n鱼篓 %d 条，共值 %d 金币" % [player.coins, player.rod, player.bag.size(), worth], 19)
	_button(panel_content, "出售全部鱼  +%d 金币" % worth, func(): _send({"type": "sell"}); _tone(600, 0.13), true).disabled = worth == 0
	var cost := int(player.rod) * 40
	var upgrade := _button(panel_content, "升级鱼竿  ·  %d 金币" % cost if int(player.rod) < 5 else "鱼竿已满级", func(): _send({"type": "upgrade"}))
	upgrade.disabled = int(player.rod) >= 5 or int(player.coins) < cost
	_text(panel_content, "升级鱼竿提高抛投距离；武器独立购买。", 14, MINT)
	for item in [["knife", "渔刀", 36, "近身快斩  ·  32 伤害"], ["pistol", "海岛手枪", 90, "准星射击  ·  6 发弹匣，R 换弹"]]:
		var key := str(item[0])
		var owned: bool = key in player.get("weapons", ["fists"])
		var purchase := _button(panel_content, "%s  ·  %s" % [item[1], "已拥有" if owned else str(item[2]) + " 金币"], func(): _send({"type": "buy_weapon", "weapon": key}))
		purchase.disabled = owned or int(player.coins) < int(item[2])
		_text(panel_content, str(item[3]), 13, MINT)
	_button(panel_content, "收好鱼篓，继续出发", _resume)

func _show_bag() -> void:
	overlay_mode = "bag"
	_clear_panel("今天的鱼篓")
	var counts: Dictionary = {}
	var worth := 0
	for item in player.get("bag", []):
		counts[item.kind] = int(counts.get(item.kind, 0)) + 1
		worth += int(item.value)
	if counts.is_empty():
		_text(panel_content, "鱼篓还是空的。\n去岸边抛一竿，看看今天的运气。", 18, MINT)
	else:
		for kind in counts:
			_text(panel_content, "%s   × %d" % [kind, counts[kind]], 19)
		_text(panel_content, "合计可售 %d 金币" % worth, 20, GOLD)
	_text(panel_content, "累计收获 %d 条  ·  累计售出 %d 条" % [player.get("progress", {}).get("caught", 0), player.get("progress", {}).get("sold", 0)], 14, MINT)
	_button(panel_content, "回到海岛", _resume, true)

func _toast(message: String) -> void:
	notice_label.text = message
	toast_time = 4.5

func _tone(frequency: float, duration: float) -> void:
	if startup_check:
		return
	if OS.has_feature("web") and bool(JavaScriptBridge.eval("window.islandAudioFallback===true")):
		JavaScriptBridge.eval("window.playIslandTone(%f,%f)" % [frequency, duration])
		return
	var wave := AudioStreamWAV.new()
	wave.format = AudioStreamWAV.FORMAT_16_BITS
	wave.mix_rate = 22050
	var samples := int(duration * 22050)
	var bytes := PackedByteArray()
	bytes.resize(samples * 2)
	for i in range(samples):
		var envelope := sin(PI * float(i) / samples)
		bytes.encode_s16(i * 2, int(sin(TAU * frequency * i / 22050) * envelope * 3000))
	wave.data = bytes
	sound.stream = wave
	sound.play()

func _cast_or_reel(power := 1.0) -> void:
	if player.is_empty():
		return
	if player.get("cast") != null:
		_send({"type": "reel"})
		swing = 0.6
		return
	var direction := Vector2(-sin(yaw), -cos(yaw))
	var reach := (7.0 + float(player.get("rod", 1)) * 2.0) * lerpf(0.35, 1.0, power)
	var target := Vector2(local_pos.x, local_pos.z) + direction * reach
	_send({"type": "cast", "x": target.x, "z": target.y, "power": power})
	swing = 0.8
	_tone(300, 0.1)

func _attack(heavy := false) -> void:
	if player.is_empty() or not overlay_mode.is_empty() or elapsed < attack_ready_at:
		return
	var weapon: String = str(player.get("weapon", "rod"))
	if weapon == "pistol" and (int(player.get("ammo", 0)) <= 0 or float(player.get("reloadRemaining", 0)) > 0):
		if float(player.get("reloadRemaining", 0)) <= 0:
			_toast("弹匣空了，按 R 换弹。")
		return
	_send({"type": "attack", "aimYaw": yaw, "aimPitch": pitch, "heavy": heavy, "aiming": aiming})
	attack_ready_at = elapsed + (0.56 if heavy else (0.25 if weapon == "pistol" else (0.39 if weapon == "knife" else 0.34)))
	swing = 1
	combat_view.swing(heavy)
	_tone(85 if weapon == "pistol" else 150, 0.07)

func charge_amount() -> float:
	return clampf((elapsed - charge_started) / 0.85, 0, 1) if charge_started >= 0 else 0.0

func _release_actions() -> void:
	if charge_started >= 0:
		_send({"type": "charge", "active": false})
	if reel_held:
		_send({"type": "reel", "held": false})
	charge_started = -1
	cast_started = -1
	trigger_held = false
	reel_held = false
	aiming = false

func _equip(weapon: String) -> void:
	if weapon != "rod" and weapon not in player.get("weapons", ["fists"]):
		_toast("先在潮汐商店购买%s。" % ("渔刀" if weapon == "knife" else "手枪"))
		return
	_release_actions()
	_send({"type": "equip", "weapon": weapon})
	player["weapon"] = weapon
	_update_hud()

func _near_fish(loot_only := false) -> Dictionary:
	var best: Dictionary = {}
	var score := 100.0
	var look := Vector3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))
	for data in current_state.get("fish", []):
		if loot_only and str(data.get("state", "")) != "loot":
			continue
		if str(data.get("state", "")) == "held":
			continue
		var offset := Vector3(data.x, float(data.get("y", 0.12)) + (0.9 if data.get("boss", false) else 0.4), data.z) - camera.position
		var flat_distance := Vector2(float(data.x) - local_pos.x, float(data.z) - local_pos.z).length()
		var alignment := look.dot(offset.normalized())
		var reach := Vector3(float(data.x) - local_pos.x, float(data.get("y", 0.12)) - float(player.get("y", 0)), float(data.z) - local_pos.z).length()
		if reach > 3.0 or alignment < 0.35:
			continue
		var candidate := flat_distance + (1.0 - alignment) * 2.0
		if candidate < score:
			score = candidate
			best = data
	return best

func _interact() -> void:
	if player.get("heldFishId") != null:
		for data in current_state.get("fish", []):
			if str(data.id) == str(player.heldFishId) and int(data.hp) <= 0:
				_send({"type": "pickup", "fishId": data.id})
				return
	var target := _near_fish(true)
	if not target.is_empty():
		_send({"type": "pickup", "fishId": target.id})
	elif Vector2(local_pos.x - 8, local_pos.z).length() <= 3:
		_send({"type": "interact"})
	else:
		_show_shop()

func _grab_or_throw() -> void:
	if player.get("heldFishId") != null:
		_send({"type": "throw", "aimYaw": yaw, "aimPitch": pitch})
		combat_view.swing(true)
		return
	var target := _near_fish()
	if target.is_empty():
		_toast("靠近并看向一条倒地、眩晕或刚上岸的鱼。")
	else:
		_send({"type": "grab", "fishId": target.id})

func _primary(pressed: bool) -> void:
	if str(player.get("weapon", "rod")) == "rod":
		if pressed:
			var cast = player.get("cast")
			if cast != null:
				if str(cast.phase) in ["bite", "reeling"]:
					reel_held = true
					_send({"type": "reel", "held": true})
			else:
				cast_started = elapsed
		else:
			if cast_started >= 0:
				_cast_or_reel(clampf((elapsed - cast_started) / 0.85, 0.25, 1.0))
			cast_started = -1
			if reel_held:
				_send({"type": "reel", "held": false})
			reel_held = false
	else:
		trigger_held = pressed
		if pressed:
			_attack()

func _secondary(pressed: bool) -> void:
	var weapon: String = str(player.get("weapon", "rod"))
	if weapon == "pistol":
		aiming = pressed
	elif weapon == "fists":
		if pressed:
			charge_started = elapsed
			_send({"type": "charge", "active": true})
		else:
			_send({"type": "charge", "active": false})
			if charge_started >= 0 and not (keyboard_mode and drag_look):
				_attack(elapsed - charge_started >= 0.25)
			charge_started = -1
	elif weapon == "rod" and not pressed and not drag_look and player.get("cast") != null:
		_send({"type": "cancel_cast"})

func _unhandled_input(event: InputEvent) -> void:
	if not joined:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			_pause() if overlay_mode.is_empty() else _resume()
			return
		if not overlay_mode.is_empty():
			return
		var key: int = event.physical_keycode if event.physical_keycode != 0 else event.keycode
		match key:
			KEY_E: _interact()
			KEY_B: _show_bag()
			KEY_Q:
				if str(player.get("weapon", "rod")) == "rod":
					_equip("fists")
				_attack()
			KEY_F:
				if str(player.get("weapon", "rod")) != "rod":
					_equip("rod")
				_cast_or_reel()
			KEY_G: _grab_or_throw()
			KEY_R: _send({"type": "reload"})
			KEY_1: _equip("rod")
			KEY_2: _equip("fists")
			KEY_3: _equip("knife")
			KEY_4: _equip("pistol")
			KEY_SPACE:
				if jump_height <= 0:
					jump_velocity = 4.7
					_send({"type": "jump"})
	if not overlay_mode.is_empty():
		return
	if event is InputEventMouseMotion:
		if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED or event.button_mask & MOUSE_BUTTON_MASK_RIGHT:
			yaw -= event.relative.x * 0.0024
			pitch = clampf(pitch - event.relative.y * 0.0024, -1.35, 1.2)
			if event.relative.length() > 2:
				drag_look = true
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			_primary(event.pressed)
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			if event.pressed:
				drag_look = false
			_secondary(event.pressed)

func _process(delta: float) -> void:
	elapsed += delta
	_network()
	hud.visible = joined and not menu.visible
	menu_settings.visible = joined
	if OS.has_feature("web"):
		JavaScriptBridge.eval("document.body.dataset.uiMode=%s" % JSON.stringify(overlay_mode))
		var rectangle := name_input.get_global_rect()
		var viewport_size := get_viewport().get_visible_rect().size
		var layout := JSON.stringify({"visible": menu.visible and name_input.visible, "x": rectangle.position.x, "y": rectangle.position.y, "w": rectangle.size.x, "h": rectangle.size.y, "vw": viewport_size.x, "vh": viewport_size.y, "value": name_input.text})
		if layout != last_name_layout:
			JavaScriptBridge.eval("window.updateNameField(%s)" % layout)
			last_name_layout = layout
	toast_time = maxf(0, toast_time - delta)
	notice_label.visible = toast_time > 0
	combat_text_time = maxf(0, combat_text_time - delta)
	combat_label.visible = combat_text_time > 0 and overlay_mode.is_empty()
	health_flash.color.a = maxf(0, health_flash.color.a - delta * 0.65)
	swing = maxf(0, swing - delta * 3)
	combat_view.animate(delta)
	for id in avatars:
		var avatar: Node3D = avatars[id]
		var target: Vector3 = avatar.get_meta("target", avatar.position)
		var moving := avatar.position.distance_to(target) > 0.03
		avatar.position = avatar.position.lerp(target, minf(delta * 12, 1))
		avatar.position.y = target.y + (absf(sin(elapsed * 10)) * 0.035 if moving else 0)
		avatar.rotation.y = lerp_angle(avatar.rotation.y, float(avatar.get_meta("angle", 0)), minf(delta * 12, 1))
	for id in fish_nodes:
		var fish: Node3D = fish_nodes[id]
		var target: Vector3 = fish.get_meta("target", fish.position)
		fish.position = fish.position.lerp(target, minf(delta * 12, 1))
		var data: Dictionary = fish.get_meta("data", {})
		var phase := str(data.get("state", "chase"))
		var visual: Node3D = fish.get_meta("visual")
		fish.rotation.y = lerp_angle(fish.rotation.y, float(data.get("angle", 0)), minf(delta * 12, 1))
		visual.rotation.z = lerpf(visual.rotation.z, PI / 2 if phase == "loot" else (sin(elapsed * 18) * 0.7 if phase == "airborne" else sin(elapsed * 12) * 0.10), minf(delta * 14, 1))
		visual.rotation.x = sin(elapsed * 9) * 0.45 if phase == "airborne" else 0.0
		visual.position.y = absf(sin(elapsed * 10)) * 0.06 if phase == "chase" else 0.0
		var warning: MeshInstance3D = fish.get_meta("warning")
		warning.visible = phase == "windup"
		warning.position.y = 0.13 - fish.position.y
		warning.scale.x = 1.0 + sin(elapsed * 15) * 0.08
		warning.scale.z = warning.scale.x
		_flash_meshes(visual, elapsed < float(fish.get_meta("flash_until", 0)))
	for id in bobbers:
		var bobber: Node3D = bobbers[id]
		bobber.position.y = 0.03 + sin(elapsed * (16 if bobber.get_meta("bite") else 3)) * 0.08
		var origin: Vector3 = bobber.get_meta("origin")
		var rope: MeshInstance3D = ropes[id]
		var difference := bobber.position - origin
		rope.position = (origin + bobber.position) / 2
		rope.scale.y = difference.length()
		rope.quaternion = Quaternion(Vector3.UP, difference.normalized())
	if not joined or player.is_empty():
		return
	var active := overlay_mode.is_empty()
	var weapon: String = str(player.get("weapon", "rod"))
	input_direction = Vector2.ZERO
	if active:
		var side := float(_key_down(KEY_D)) - float(_key_down(KEY_A))
		var forward := float(_key_down(KEY_W)) - float(_key_down(KEY_S))
		input_direction = Vector2(cos(yaw), -sin(yaw)) * side + Vector2(-sin(yaw), -cos(yaw)) * forward
		input_direction = input_direction.limit_length()
		# Arrow keys provide a keyboard-only way to look around, also useful without pointer lock.
		yaw += (float(Input.is_physical_key_pressed(KEY_LEFT)) - float(Input.is_physical_key_pressed(KEY_RIGHT))) * delta * 1.8
		pitch = clampf(pitch + (float(Input.is_physical_key_pressed(KEY_UP)) - float(Input.is_physical_key_pressed(KEY_DOWN))) * delta, -1.35, 1.2)
		if trigger_held and charge_started < 0 and str(player.get("weapon", "rod")) != "rod":
			_attack()
	var sprinting := active and _key_down(KEY_SHIFT) and not aiming
	var speed := 6.8 if sprinting else 4.5
	input_clock += delta
	if input_clock >= 0.1:
		input_clock = 0
		_send({"type": "input", "dx": input_direction.x, "dz": input_direction.y, "angle": yaw, "pitch": pitch, "sprint": sprinting, "reeling": reel_held})
	local_pos += Vector3(input_direction.x, 0, input_direction.y) * speed * delta
	var constrained := Vector2(local_pos.x, local_pos.z).limit_length(13.5)
	local_pos.x = constrained.x
	local_pos.z = constrained.y
	local_pos = local_pos.lerp(server_pos, minf(delta * (2 if input_direction.length() > 0 else 10), 1))
	jump_velocity -= delta * 11
	jump_height = maxf(0, jump_height + jump_velocity * delta)
	if jump_height <= 0:
		jump_velocity = 0
	jump_height = lerpf(jump_height, float(player.get("y", 0)), minf(delta * 6, 1))
	var shake: float = combat_view.shake
	camera.position = local_pos + Vector3(sin(elapsed * 67) * shake, 1.62 + jump_height + sin(elapsed * 11) * input_direction.length() * 0.025 + cos(elapsed * 53) * shake, 0)
	camera.rotation = Vector3(pitch + float(combat_view.recoil) * 0.12, yaw, sin(elapsed * 43) * shake * 0.18)
	camera.fov = lerpf(camera.fov, 53.0 if aiming else (83.0 if sprinting else 78.0), minf(delta * 12, 1))
	rod.position = Vector3(0.42 - sin(swing * PI) * 0.25, -0.52, -0.64)
	rod.rotation = Vector3(-0.5 - sin(swing * PI) * 0.9, -0.25, -0.2 - sin(swing * PI) * 0.65)
	reticle.visible = overlay_mode.is_empty()
	reticle.text = "×" if combat_view.hit_time > 0 else ("·" if aiming else "+")
	reticle.modulate = GOLD if combat_view.hit_time > 0 else CREAM
	charge_bar.visible = active and (charge_started >= 0 or cast_started >= 0)
	charge_bar.value = charge_amount() * 100 if charge_started >= 0 else clampf((elapsed - cast_started) / 0.85, 0, 1) * 100
	var cast = player.get("cast")
	if cast != null:
		if cast.phase == "reeling":
			phase_label.text = "拉住它！按住左键收线   %d%%" % int(float(cast.get("progress", 0)) * 100)
		else:
			phase_label.text = "咬钩了！按住左键 / 按 F 收线  ·  %.1f 秒" % float(cast.remaining) if cast.phase == "bite" else "浮漂轻晃，等鱼咬钩…  ·  右键收回鱼线"
	elif charge_started >= 0:
		phase_label.text = "蓄力 %d%%  ·  松开右键，打飞面前的鱼" % int(charge_amount() * 100)
	elif player.get("heldFishId") != null:
		phase_label.text = "抓住了！看向空中按 G 抛出；倒地的鱼也能按 E 收起"
	elif float(player.get("reloadRemaining", 0)) > 0:
		phase_label.text = "换弹中  %.1f 秒" % float(player.get("reloadRemaining", 0))
	else:
		phase_label.text = ""
	var nearby := _near_fish()
	if not nearby.is_empty():
		if str(nearby.get("state", "")) == "loot":
			context_label.text = "[ E ] 收起 %s  ·  %d 金币     [ G ] 抓起 / 投掷" % [nearby.kind, int(nearby.get("lootValue", 0))]
		else:
			var attack_hint: String = {"rod": "[ 2 ] 切拳套再攻击", "fists": "左键连击 / 右键蓄力击飞", "knife": "左键挥刀", "pistol": "左键射击 / 右键瞄准 / R 换弹"}.get(weapon, "左键攻击")
			context_label.text = "瞄准 %s  ·  %s  ·  红圈时横移！" % [nearby.kind, attack_hint]
	elif Vector2(local_pos.x - 8, local_pos.z).length() <= 3:
		context_label.text = "[ E ] 礁甲巨蟹试炼  ·  全队钓上 3 条鱼解锁  ·  留意冲撞预警"
	elif Vector2(local_pos.x, local_pos.z + 6).length() <= 3:
		context_label.text = "[ E ] 潮汐商店  ·  售鱼 / 渔刀 36 / 手枪 90 金币"
	elif weapon == "pistol":
		context_label.text = "手枪  ·  左键射击 / 右键瞄准 / R 换弹  ·  [ 1 ] 切鱼竿钓鱼"
	elif weapon == "knife":
		context_label.text = "渔刀  ·  看准附近的鱼，左键挥刀  ·  [ 1 ] 切鱼竿钓鱼"
	elif weapon == "fists":
		context_label.text = "拳套  ·  左键连击 / 右键蓄力击飞  ·  硬直时 G 抓鱼，再 G 抛出"
	elif Vector2(local_pos.x, local_pos.z).length() >= 7:
		context_label.text = "[ 1 ] 鱼竿  ·  朝海面长按左键蓄力、松开抛竿  ·  [ F ] 快速抛竿"
	else:
		context_label.text = "钓鱼 → 切拳套打服 → E 收起 → 商店换武器  ·  击飞追击可卖更高价"

func _flash_meshes(node: Node, enabled: bool) -> void:
	if node is MeshInstance3D:
		node.material_overlay = combat_view.flash_material if enabled else null
	for child in node.get_children():
		_flash_meshes(child, enabled)

func _key_down(key: Key) -> bool:
	return Input.is_physical_key_pressed(key) or Input.is_key_pressed(key)
