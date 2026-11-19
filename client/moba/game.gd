extends Node3D

const Actor = preload("res://survival/actor.gd")
const HeroRig = preload("res://moba/hero_rig.gd")
const HeroFX = preload("res://moba/hero_fx.gd")
const MapView = preload("res://moba/map_view.gd")
const Labels = preload("res://moba/labels.gd")
const Audio = preload("res://survival/audio.gd")
const Office = preload("res://survival/office_scene.gd")
const HERO_ORDER := ["stapler","courier","printer","guardian","barista","archer","mechanic","lecturer","custodian","broadcaster"]
var config: Dictionary = {}
var snapshot: Dictionary = {}
var entities: Dictionary = {}
var visuals: Dictionary = {}
var projectile_nodes: Dictionary = {}
var zone_nodes: Dictionary = {}
var effects: Array = []
var bridge
var camera: Camera3D
var labels: Control
var sounds: Node
var self_id := ""
var team := 0
var elapsed := 0.0
var last_event := 0
var blocked_input := false
var quick_cast := false
var cast_mode := "normal"
var camera_zoom := 44.0
var focus_ally := ""
var target_heroes_only := false
var right_repeat_at := 0.0
var right_order_held := false
var feedback_seq := -1
var volume := .6
var camera_locked := false
var temporary_center := false
var edge_pan := true
var pointer_inside := false
var pointer_over_ui := false
var web_pointer_active := false
var web_pointer := Vector2.ZERO
var web_view_size := Vector2.ZERO
var web_buttons := 0
var web_keys: Array = []
var web_keys_active := false
var camera_speed := 56.0
var edge_width := 24.0
var edge_direction := Vector2.ZERO
var middle_dragging := false
var middle_anchor := Vector3.ZERO
var minimap_peeking := false
var focus_key := ""
var release_armed_key := ""
var local_intent_id := 0
var pending_local_feedback: Dictionary = {}
var last_local_feedback: Dictionary = {}
var marker_shapes: Dictionary = {}
var ui_rects: Array = []
var camera_center := Vector3(-45,0,45)
var aiming := ""
var attack_move := false
var aim_cursor: Node3D
var mouse_world := Vector3.ZERO
var selected := ""
var marker: Node3D
var diagnostic_at := 0.0
var snapshot_age := 0.0
var offline_frames := 0
var last_key_event: Dictionary = {}
var before_pointer_callback: JavaScriptObject
var geometry_count := 0
var geometry_at := 0.0
var fog_mesh: MeshInstance3D
var fog_texture: ImageTexture
var fog_cells := ""
var target_marker: Node3D
var attack_range: Node3D
var attack_range_base := 0.0

func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	config = JSON.parse_string(FileAccess.get_file_as_string("res://moba/data.json"))
	var environment := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("243d47")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("d6e5db")
	env.ambient_light_energy = .35
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	environment.environment=env
	add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees=Vector3(-60,-25,0)
	sun.light_color=Color("fff1d4")
	sun.light_energy=.65
	sun.shadow_enabled=true
	sun.directional_shadow_max_distance=85
	add_child(sun)
	var map := MapView.new()
	add_child(map)
	map.build(config.map)
	camera=Camera3D.new()
	camera.projection=Camera3D.PROJECTION_PERSPECTIVE
	camera.fov=45
	camera.far=350
	add_child(camera)
	camera.make_current()
	_update_camera(1.0)
	var canvas := CanvasLayer.new()
	add_child(canvas)
	labels=Labels.new()
	labels.camera=camera
	canvas.add_child(labels)
	sounds=Audio.new()
	add_child(sounds)
	aim_cursor=Node3D.new()
	add_child(aim_cursor)
	marker=Node3D.new()
	add_child(marker)
	for style in ["move","attack","cast","stop"]:
		var shape := Node3D.new()
		marker.add_child(shape)
		var color := Color("83e1bd") if style=="move" else Color("ffb48f") if style=="attack" else Color("9acff0") if style=="cast" else Color("e1dfc1")
		MapView.ring(shape,.68,color,.10)
		if style in ["move","attack"]:
			for i in range(4):
				var angle := float(i)*PI*.5
				var stroke := MapView.box(shape,Vector3(cos(angle)*.9,.22,sin(angle)*.9),Vector3(.32,.05,.10),color,true)
				stroke.rotation.y=-angle
		shape.hide()
		marker_shapes[style]=shape
	RenderingServer.frame_post_draw.connect(_after_frame_draw)
	marker.hide()
	target_marker=Node3D.new()
	add_child(target_marker)
	MapView.ring(target_marker,1.05,Color("ffbe79"),.1)
	target_marker.hide()
	attack_range=Node3D.new()
	add_child(attack_range)
	get_viewport().mouse_entered.connect(func():pointer_inside=true)
	get_viewport().mouse_exited.connect(func():pointer_inside=false)
	if OS.has_feature("web"):
		bridge=JavaScriptBridge.get_interface("mobaTransport")
		if bridge!=null:
			# Web queues keys until process_events, but flushes mouse events immediately.
			# Flush keys in DOM capture, BEFORE the engine starts mouse dispatch.
			before_pointer_callback=JavaScriptBridge.create_callback(_flush_web_keys)
			bridge.beforePointer(before_pointer_callback)
			bridge.loaded()
	else:
		for arg in OS.get_cmdline_user_args():
			if arg.begins_with("--moba-state="):
				_accept_state(JSON.parse_string(FileAccess.get_file_as_string(arg.trim_prefix("--moba-state="))))
			if arg.begins_with("--moba-frames="): offline_frames=int(arg.trim_prefix("--moba-frames="))
	print("MOBA_SCENE_READY")

func _flush_web_keys(_args: Array) -> void:
	_poll_bridge()
	DisplayServer.process_events()

func _poll_bridge() -> void:
	if bridge!=null:
		var packets = JSON.parse_string(str(bridge.poll()))
		if packets is Array:
			for p in packets:
				match str(p.get("type","")):
					"state": _accept_state(p)
					"control":
						blocked_input=bool(p.get("blocked",false))
						ui_rects=p.get("uiRects",[])
						edge_pan=bool(p.get("edgePan",true))
						camera_speed=clampf(float(p.get("cameraSpeed",camera_speed)),24,100)
						edge_width=clampf(float(p.get("edgeWidth",edge_width)),12,40)
						quick_cast=bool(p.get("quick",false))
						cast_mode=str(p.get("castMode","quick" if quick_cast else "normal"))
						volume=float(p.get("volume",.6))
						if blocked_input: _release_held()
					"aim":
						_read_web_controls(false)
						if not blocked_input: _set_aim(str(p.key))
					"focus_lost": _release_held();pointer_inside=false
					"transport_reset":
						last_event=0
						_release_held()
						for effect in effects:
							if is_instance_valid(effect.node): effect.node.queue_free()
						effects.clear()
					"camera": _camera_packet(p)
					"map_ping": _ping_effect(p)

func _process(delta: float) -> void:
	elapsed+=delta
	snapshot_age+=delta
	_poll_bridge()
	_read_web_controls()
	_update_camera(delta)
	mouse_world=_ground(_cursor_position())
	if right_order_held and _pointer_can_command() and elapsed>=right_repeat_at:
		right_repeat_at=elapsed+.09
		_right_order()
	selected=_hover_target(_cursor_position()) if _pointer_can_command() else ""
	labels.selected=selected
	for id in visuals:
		if not entities.has(id): continue
		var node: Node3D=visuals[id]
		var data: Dictionary=entities[id]
		var advance:=minf(snapshot_age,.10)
		var to:=Vector3(float(data.x)+float(data.get("vx",0))*advance,float(data.get("lift",0)),float(data.z)+float(data.get("vz",0))*advance)
		var before:=node.position
		if before.distance_to(to)>8: node.position=to
		else: node.position=node.position.lerp(to,1.0-exp(-delta*(45.0 if id==self_id else 30.0)))
		node.rotation.y=lerp_angle(node.rotation.y,float(data.get("angle",0)),1.0-exp(-delta*18))
		var rig=node.get_node_or_null("Rig")
		if rig!=null:
			rig.animate(delta,(node.position-before)/maxf(delta,.001))
		var aura=node.get_node_or_null("Shield")
		if aura!=null: aura.visible=float(data.get("shield",0))>0
	_update_aim()
	target_marker.visible=not blocked_input and entities.has(selected) and selected!=self_id
	if target_marker.visible:
		target_marker.position=visuals[selected].position
		target_marker.scale=Vector3.ONE*(float(entities[selected].radius)+.35)/1.05
	attack_range.visible=attack_move and entities.has(self_id) and not blocked_input
	if attack_range.visible:
		attack_range.position=visuals[self_id].position
		attack_range.scale=Vector3.ONE*(attack_range_base+(2.0 if bool(entities[self_id].get("ult",false)) else 0.0))/maxf(.1,attack_range_base)
	if marker.visible and elapsed>float(marker.get_meta("until",0)): marker.hide()
	for node in projectile_nodes.values():
		if node.has_meta("target_position"):
			node.position=node.get_meta("target_position")+node.get_meta("velocity",Vector3.ZERO)*minf(snapshot_age,.08)
	for e in effects:
		e.life-=delta
		if is_instance_valid(e.node):
			if str(e.kind)=="flight": e.node.position=e.from.lerp(e.to,clampf(1.0-float(e.life)/float(e.duration),0,1))
			if str(e.kind)=="ring": e.node.scale=Vector3.ONE*(.6+(1.0-float(e.life)/float(e.duration))*.4)
			if str(e.kind)=="stamp_windup": e.node.position.y=.15+3*float(e.life)/float(e.duration)
			if float(e.life)<=0: e.node.queue_free()
	effects=effects.filter(func(e):return float(e.life)>0)
	if elapsed>=diagnostic_at:
		diagnostic_at=elapsed+.25
		if elapsed>=geometry_at:
			geometry_at=elapsed+5
			geometry_count=find_children("*","GeometryInstance3D",true,false).size()
		if bridge!=null:
			var player: Dictionary=entities.get(self_id,{})
			var size:=get_viewport().get_visible_rect().size
			var corners: Array=[]
			for corner in [Vector2.ZERO,Vector2(size.x,0),size,Vector2(0,size.y)]:
				var ground:=_ground(corner)
				corners.append({"x":ground.x,"z":ground.z})
			bridge.diagnostic(JSON.stringify({"viewCorners":corners,"cameraZoom":camera_zoom,"castMode":cast_mode,"cameraSpeed":camera_speed,"edgeWidth":edge_width,"edgeDirection":{"x":edge_direction.x,"y":edge_direction.y},"pointerInside":pointer_inside,"pointerOverUI":pointer_over_ui,"middleDragging":middle_dragging,"minimapPeeking":minimap_peeking,"rightHeld":right_order_held,"localFeedback":last_local_feedback}))
			var screen_heroes: Array=[]
			for id in entities:
				var e: Dictionary=entities[id]
				if str(e.kind)!="hero" or float(e.hp)<=0: continue
				var point:=camera.unproject_position(visuals[id].position+Vector3(0,1,0))
				screen_heroes.append({"id":id,"heroId":e.heroId,"team":e.team,"x":point.x,"y":point.y})
			bridge.diagnostic(JSON.stringify({"screenHeroes":screen_heroes,"effectCount":effects.size(),"selectedTarget":selected}))
			bridge.diagnostic(JSON.stringify({"ready":true,"geometryInstances":geometry_count,"threadedCullThreshold":ProjectSettings.get_setting_with_override("rendering/limits/spatial_indexer/threaded_cull_minimum_instances"),"selfId":self_id,"x":player.get("x",0),"z":player.get("z",0),"entities":entities.size(),"aim":aiming,"attackMove":attack_move,"lastKey":last_key_event,"blocked":blocked_input,"cameraLocked":camera_locked,"temporaryCenter":temporary_center,"cameraX":camera_center.x,"cameraZ":camera_center.z,"fps":Engine.get_frames_per_second(),"snapshotAge":snapshot_age,"viewport":{"w":get_viewport().get_visible_rect().size.x,"h":get_viewport().get_visible_rect().size.y},"cursor":{"x":mouse_world.x,"z":mouse_world.z}}))
	if offline_frames>0:
		offline_frames-=1
		if offline_frames==0:
			print("MOBA_SCENE_VERIFIED entities=",entities.size())
			get_tree().quit()

func _ground(mouse: Vector2) -> Vector3:
	var origin:=camera.project_ray_origin(mouse)
	var ray:=camera.project_ray_normal(mouse)
	if absf(ray.y)<.001: return Vector3.ZERO
	return origin+ray*(-origin.y/ray.y)

func _command_point(raw: Vector3) -> Vector3:
	var limit := float(config.map.get("boundary",144.0))
	if absf(raw.x)<=limit and absf(raw.z)<=limit: return raw
	var own: Dictionary=entities.get(self_id,{})
	var start := Vector3(float(own.get("x",0)),0,float(own.get("z",0)))
	var direction := raw-start
	var fraction := 1.0
	if direction.x>0.0001: fraction=minf(fraction,(limit-start.x)/direction.x)
	elif direction.x<-.0001: fraction=minf(fraction,(-limit-start.x)/direction.x)
	if direction.z>0.0001: fraction=minf(fraction,(limit-start.z)/direction.z)
	elif direction.z<-.0001: fraction=minf(fraction,(-limit-start.z)/direction.z)
	var result := start+direction*clampf(fraction,0,1)
	return Vector3(clampf(result.x,-limit,limit),0,clampf(result.z,-limit,limit))

func _cursor_position() -> Vector2:
	return web_pointer if web_pointer_active else get_viewport().get_mouse_position()

func _pointer_can_command() -> bool:
	return not blocked_input and pointer_inside and not pointer_over_ui and not minimap_peeking

func _read_web_controls(reconcile := true) -> void:
	if bridge==null: return
	var controls = JSON.parse_string(str(bridge.inputState()))
	if not controls is Dictionary: return
	blocked_input=bool(controls.get("blocked",false))
	cast_mode=str(controls.get("castMode","normal"))
	edge_pan=bool(controls.get("edgePan",edge_pan))
	camera_speed=clampf(float(controls.get("cameraSpeed",camera_speed)),24,100)
	edge_width=clampf(float(controls.get("edgeWidth",edge_width)),12,40)
	var point = controls.get("pointer")
	if point is Dictionary:
		web_pointer_active=true
		var size := get_viewport().get_visible_rect().size
		web_pointer=Vector2(float(point.get("x",.5))*size.x,float(point.get("y",.5))*size.y)
		web_view_size=Vector2(float(point.get("width",size.x)),float(point.get("height",size.y)))
		pointer_inside=bool(point.get("inside",false))
		pointer_over_ui=bool(point.get("overUI",false))
		web_buttons=int(point.get("buttons",0))
	var keys = controls.get("keys")
	if keys is Array:
		web_keys=keys
		web_keys_active=true
	if blocked_input:
		_release_held()
		return
	if not reconcile: return
	# Captured DOM state may only release an existing gesture, never synthesize one.
	if web_pointer_active:
		if (web_buttons & 2)==0: right_order_held=false
		if (web_buttons & 4)==0: middle_dragging=false
	if web_keys_active:
		if not web_keys.has("Space"): temporary_center=false
		if not web_keys.has("Backquote"): target_heroes_only=false
		if not focus_key.is_empty() and not web_keys.has(focus_key): focus_key="";focus_ally=""
		if not release_armed_key.is_empty() and not web_keys.has(release_armed_key) and (pointer_over_ui or not pointer_inside): _set_aim("")

func _release_held() -> void:
	temporary_center=false
	right_order_held=false
	middle_dragging=false
	minimap_peeking=false
	focus_ally=""
	focus_key=""
	target_heroes_only=false
	edge_direction=Vector2.ZERO
	web_keys.clear()
	web_buttons=0
	if not aiming.is_empty() or attack_move: _set_aim("")

func _camera_packet(p: Dictionary) -> void:
	var phase := str(p.get("phase","set"))
	if phase in ["end","cancel"]:
		minimap_peeking=false
		return
	_read_web_controls(false)
	if blocked_input: return
	if phase not in ["start","move","set"]: return
	if not p.has("x") or not p.has("z"): return
	var x := float(p.x)
	var z := float(p.z)
	if not is_finite(x) or not is_finite(z): return
	right_order_held=false
	middle_dragging=false
	_set_aim("")
	minimap_peeking=phase!="set"
	# Legacy one-shot camera commands remain free-camera positioning commands.
	if phase=="set": camera_locked=false;temporary_center=false;focus_ally="";focus_key=""
	camera_center=Vector3(x,0,z)

func _apply_camera_transform() -> void:
	camera.position=camera_center+Vector3(0,camera_zoom,camera_zoom*.7)
	camera.look_at(camera_center,Vector3.UP)

func _clamp_camera(following: bool) -> void:
	if following:
		_apply_camera_transform()
		return
	var bounds: Dictionary=config.map.cameraBounds
	# Bound the center, not the whole projected viewport. Every playable position
	# must remain centerable, including fountains and a hero at the outer boundary.
	var playable := float(config.map.get("boundary",144.0))
	camera_center.x=clampf(camera_center.x,minf(float(bounds.minX),-playable),maxf(float(bounds.maxX),playable))
	camera_center.z=clampf(camera_center.z,minf(float(bounds.minZ),-playable),maxf(float(bounds.maxZ),playable))
	_apply_camera_transform()

func _pan_screen(direction: Vector2, delta: float) -> void:
	if direction.length_squared()<.001: return
	var size := get_viewport().get_visible_rect().size
	var center := size*.5
	var ground := _ground(center)
	var horizontal := _ground(center+Vector2(1,0))-ground
	var vertical := _ground(center+Vector2(0,1))-ground
	var unit := direction.normalized()
	# Speed is a viewport-height fraction per second, independent of DPR/zoom.
	camera_center+=(horizontal*unit.x+vertical*unit.y)*size.y*(camera_speed/56.0)*minf(delta,.1)

func _update_camera(delta: float) -> void:
	edge_direction=Vector2.ZERO
	var focused := focus_ally if not focus_ally.is_empty() else self_id
	var following := not minimap_peeking and (camera_locked or temporary_center or not focus_ally.is_empty()) and visuals.has(focused)
	if following:
		camera_center=visuals[focused].position*Vector3(1,0,1)
	_apply_camera_transform()
	if not blocked_input and not minimap_peeking:
		var keyboard_pan := Vector2.ZERO
		if web_keys_active:
			keyboard_pan=Vector2(float(web_keys.has("ArrowRight"))-float(web_keys.has("ArrowLeft")),float(web_keys.has("ArrowDown"))-float(web_keys.has("ArrowUp")))
		else:
			keyboard_pan=Vector2(float(Input.is_physical_key_pressed(KEY_RIGHT))-float(Input.is_physical_key_pressed(KEY_LEFT)),float(Input.is_physical_key_pressed(KEY_DOWN))-float(Input.is_physical_key_pressed(KEY_UP)))
		if keyboard_pan.length_squared()>0 and not temporary_center and focus_ally.is_empty():
			camera_locked=false
			following=false
			_pan_screen(keyboard_pan,delta)
		elif middle_dragging and _pointer_can_command():
			camera_center+=middle_anchor-_ground(_cursor_position())
			following=false
		elif not following and edge_pan and pointer_inside:
			var mouse := _cursor_position()
			var size := get_viewport().get_visible_rect().size
			# Native fallback uses viewport pixels; web coordinates are normalized.
			var edge := Vector2(edge_width,edge_width)
			if web_pointer_active and web_view_size.x>0 and web_view_size.y>0: edge=Vector2(edge_width*size.x/web_view_size.x,edge_width*size.y/web_view_size.y)
			edge_direction=Vector2(-1 if mouse.x<edge.x else 1 if mouse.x>size.x-edge.x else 0,-1 if mouse.y<edge.y else 1 if mouse.y>size.y-edge.y else 0)
			# Camera edge gestures stay usable across parent HUD; commands remain blocked there.
			_pan_screen(edge_direction,delta)
	_clamp_camera(following)

func _after_frame_draw() -> void:
	if pending_local_feedback.is_empty() or not marker.visible: return
	var rendered := pending_local_feedback.duplicate()
	pending_local_feedback.clear()
	rendered.stage="render"
	rendered.latencyMs=float(Time.get_ticks_usec()-int(rendered.atUs))/1000.0
	last_local_feedback=rendered
	if bridge!=null: bridge.localFeedback(JSON.stringify(rendered))

func _local_intent(data: Dictionary) -> void:
	var kind := str(data.get("type",""))
	if kind not in ["move","attack","attack_move","cast","summoner","ward","stop","hold","recall"]: return
	var at := mouse_world
	if data.has("x") and data.has("z"): at=Vector3(float(data.x),0,float(data.z))
	var target := str(data.get("target",""))
	if visuals.has(target): at=visuals[target].position*Vector3(1,0,1)
	if kind in ["stop","hold","recall"] and visuals.has(self_id): at=visuals[self_id].position*Vector3(1,0,1)
	var style := "move" if kind=="move" else "attack" if kind in ["attack","attack_move"] else "stop" if kind in ["stop","hold","recall"] else "cast"
	for key in marker_shapes: marker_shapes[key].visible=key==style
	marker.position=at
	marker.set_meta("until",elapsed+.35)
	marker.show()
	local_intent_id+=1
	pending_local_feedback={"localId":local_intent_id,"type":kind,"stage":"intent","atUs":Time.get_ticks_usec()}
	last_local_feedback=pending_local_feedback.duplicate()
	if bridge!=null: bridge.localFeedback(JSON.stringify(pending_local_feedback))

func _target(mouse: Vector2, mode := "any") -> String:
	var result:=""
	var closest:=42.0
	for id in entities:
		var e: Dictionary=entities[id]
		if float(e.hp)<=0: continue
		if target_heroes_only and str(e.kind)!="hero": continue
		if mode in ["enemy","ally"]:
			if str(e.kind)!="hero": continue
			if mode=="enemy" and int(e.team)==team: continue
			if mode=="ally" and int(e.team)!=team: continue
		var p:=Vector3(float(e.x),1,float(e.z))
		var d:=camera.unproject_position(p).distance_to(mouse)
		if d<closest:
			closest=d
			result=id
	return result

func _set_aim(key: String) -> void:
	right_order_held=false
	release_armed_key=""
	aiming=key
	attack_move=false
	for child in aim_cursor.get_children(): child.queue_free()
	if bridge!=null: bridge.aim(key)
	if key.is_empty() or not snapshot.has("self") or snapshot.self==null: return
	var skill: Dictionary=_skill_data(key)
	var radius:=float(skill.get("radius",0))
	var mode:=str(skill.get("target","direction"))
	if mode in ["enemy","ally"]:
		MapView.ring(aim_cursor,float(skill.range),Color("d6bf82"),.06)
	elif str(snapshot.self.heroId) in ["custodian","broadcaster"] and key!="e" and (str(snapshot.self.heroId)=="custodian" or key=="r"):
		HeroFX.sector(aim_cursor,float(skill.range),Color("f4d781"))
	elif mode in ["self","point"]:
		MapView.ring(aim_cursor,maxf(.8,radius),Color("f4d781"),.1)
	elif str(snapshot.self.heroId)=="custodian" and key=="e":
		HeroFX.ability(aim_cursor,"guard",0,Color("f4d781"))
	else:
		MapView.box(aim_cursor,Vector3(0,.26,-float(skill.range)*.5),Vector3(maxf(.16,radius*2),.03,maxf(.1,float(skill.range))),Color("f4d781"),true)

func _update_aim() -> void:
	aim_cursor.visible=not aiming.is_empty() and entities.has(self_id) and not blocked_input
	if not aim_cursor.visible: return
	var own: Dictionary=entities[self_id]
	var p:=Vector3(float(own.x),0,float(own.z))
	var skill: Dictionary=_skill_data(aiming)
	var dir:=_command_point(mouse_world)-p
	if str(skill.get("target","")) in ["self","point","enemy","ally"]:
		aim_cursor.position=p+dir.limit_length(float(skill.range)) if float(skill.range)>0 else p
		if str(skill.get("target","")) in ["enemy","ally"]: aim_cursor.position=p
		aim_cursor.rotation.y=0
	else:
		aim_cursor.position=p
		if dir.length()>.01: aim_cursor.rotation.y=atan2(-dir.x,-dir.z)

func _send(data: Dictionary) -> void:
	if blocked_input: return
	if data.has("x") and data.has("z"):
		var point := _command_point(Vector3(float(data.x),0,float(data.z)))
		data.x=point.x;data.z=point.z
	_local_intent(data)
	if bridge!=null: bridge.send(JSON.stringify(data))

func _cast(self_cast := false) -> void:
	if aiming.is_empty(): return
	if blocked_input: return
	mouse_world=_ground(_cursor_position())
	selected=_hover_target(_cursor_position())
	if aiming in ["d","f","ward"]:
		_send({"type":"ward" if aiming=="ward" else "summoner","skill":aiming,"x":mouse_world.x,"z":mouse_world.z,"target":self_id if self_cast else selected})
	else:
		_send({"type":"cast","skill":aiming,"x":mouse_world.x,"z":mouse_world.z,"target":self_id if self_cast else selected})
	_set_aim("")

func _hover_target(mouse: Vector2) -> String:
	if aiming.is_empty(): return _target(mouse)
	if not snapshot.has("self"): return ""
	if aiming in ["d","f","ward"]: return _target(mouse)
	var skill: Dictionary=_skill_data(aiming)
	var mode:=str(skill.get("target","direction"))
	return _target(mouse,mode) if mode in ["enemy","ally"] else ""

func _skill_data(key: String) -> Dictionary:
	if key=="d": return {"range":8.0,"radius":.65,"target":"point"}
	if key=="ward": return {"range":12.0,"radius":1.0,"target":"point"}
	if key=="f": return {"range":10.0,"radius":1.0,"target":"point"}
	return config.heroes[str(snapshot.self.heroId)].skills[key]

func _right_order() -> void:
	if not _pointer_can_command(): return
	selected=_hover_target(_cursor_position())
	var target: Dictionary=entities.get(selected,{})
	if not target.is_empty() and int(target.team)!=team: _send({"type":"attack","target":selected})
	else: _send({"type":"move","x":mouse_world.x,"z":mouse_world.z})


func _unhandled_input(event: InputEvent) -> void:
	# Apply older HUD transitions before this native input, not a frame after it.
	_poll_bridge()
	# DOM menu close and the next key can arrive before the next process() poll.
	if bridge!=null and (event is InputEventKey or event is InputEventMouseButton):
		_read_web_controls(false)
	if event is InputEventMouse:
		mouse_world=_ground(event.position)
		selected=_hover_target(event.position)
	if event is InputEventKey:
		var key: int=event.physical_keycode
		last_key_event={"key":key,"pressed":event.pressed,"echo":event.echo,"blocked":blocked_input}
		if not event.pressed:
			if key==KEY_SPACE: temporary_center=false
			if key in [KEY_F1,KEY_F2,KEY_F3,KEY_F4,KEY_F5] and focus_key==OS.get_keycode_string(key): focus_ally="";focus_key=""
			if key==KEY_QUOTELEFT: target_heroes_only=false
			if key==KEY_TAB and bridge!=null: bridge.ui("score_hide")
			if not blocked_input and cast_mode=="release" and key in [KEY_Q,KEY_W,KEY_E,KEY_R,KEY_D,KEY_F,KEY_4]:
				var release_key:="ward" if key==KEY_4 else OS.get_keycode_string(key).to_lower()
				if aiming==release_key: _cast()
			return
		if event.pressed and not event.echo:
			if key==KEY_ESCAPE:
				if not aiming.is_empty() or attack_move: _set_aim("");attack_move=false
				elif bridge!=null: blocked_input=true;bridge.ui("menu")
				return
			if blocked_input: return
			if key==KEY_ENTER:
				_set_aim("")
				if bridge!=null: blocked_input=true;bridge.ui("chat")
				return
			if key==KEY_TAB:
				if bridge!=null: bridge.ui("score_hold")
				return
			if key==KEY_P:
				_set_aim("")
				if bridge!=null: blocked_input=true;bridge.ui("shop")
				return
			if key==KEY_SPACE: temporary_center=true
			if key==KEY_Y: camera_locked=not camera_locked;middle_dragging=false;minimap_peeking=false
			if key==KEY_QUOTELEFT: target_heroes_only=true
			if key==KEY_F1: focus_ally=self_id;focus_key="F1"
			if key in [KEY_F2,KEY_F3,KEY_F4,KEY_F5]:
				var allies: Array=snapshot.get("score",[]).filter(func(h):return int(h.team)==team and str(h.id)!=self_id)
				var index:=key-KEY_F2
				if index<allies.size(): focus_ally=str(allies[index].id);focus_key=OS.get_keycode_string(key)
			if key==KEY_B: right_order_held=false;_set_aim("");_send({"type":"recall"})
			if key in [KEY_G,KEY_V] and bridge!=null: bridge.ping("danger" if key==KEY_V else "go",mouse_world.x,mouse_world.z)
			if key==KEY_S: _set_aim("");_send({"type":"stop"})
			if key==KEY_H: _set_aim("");_send({"type":"hold"})
			if key==KEY_A: _set_aim("");attack_move=true
			if key in [KEY_Q,KEY_W,KEY_E,KEY_R,KEY_D,KEY_F,KEY_4]:
				var cast_key:="ward" if key==KEY_4 else OS.get_keycode_string(key).to_lower()
				if event.ctrl_pressed and key in [KEY_Q,KEY_W,KEY_E,KEY_R]: _send({"type":"learn","skill":cast_key});return
				_set_aim(cast_key)
				if cast_mode=="release": release_armed_key="Digit4" if key==KEY_4 else "Key"+OS.get_keycode_string(key)
				if cast_mode=="quick" or event.shift_pressed or event.alt_pressed or str(_skill_data(cast_key).get("target",""))=="self": _cast(event.alt_pressed)
	if event is InputEventMouseButton and not event.pressed:
		if event.button_index==MOUSE_BUTTON_RIGHT: right_order_held=false
		if event.button_index==MOUSE_BUTTON_MIDDLE: middle_dragging=false
	if blocked_input: return
	if event is InputEventMouseButton and event.pressed:
		if not _pointer_can_command(): return
		if event.button_index==MOUSE_BUTTON_MIDDLE:
			camera_locked=false
			temporary_center=false
			focus_ally=""
			focus_key=""
			right_order_held=false
			middle_dragging=true
			middle_anchor=_ground(event.position)
		if event.button_index==MOUSE_BUTTON_WHEEL_UP: camera_zoom=maxf(28,camera_zoom-3)
		if event.button_index==MOUSE_BUTTON_WHEEL_DOWN: camera_zoom=minf(44,camera_zoom+3)
		if event.button_index==MOUSE_BUTTON_RIGHT:
			if not aiming.is_empty() or attack_move: _set_aim("");attack_move=false;return
			if event.shift_pressed:
				_set_aim("");_send({"type":"attack_move","x":mouse_world.x,"z":mouse_world.z});return
			right_order_held=true
			right_repeat_at=elapsed+.16
			_right_order()
		if event.button_index==MOUSE_BUTTON_LEFT:
			if not aiming.is_empty(): _cast()
			elif attack_move:
				_send({"type":"attack_move","x":mouse_world.x,"z":mouse_world.z})
				attack_move=false
	if event is InputEventMouseMotion and middle_dragging and _pointer_can_command():
		camera_center+=middle_anchor-_ground(event.position)
		_clamp_camera(false)

func _accept_state(data: Dictionary) -> void:
	var first:=snapshot.is_empty()
	snapshot=data
	snapshot_age=0
	self_id=str(data.selfId)
	team=int(data.team)
	var next: Dictionary={}
	for e in data.entities:
		var id:=str(e.id)
		next[id]=e
		if not visuals.has(id): visuals[id]=_make_entity(e)
		var node: Node3D=visuals[id]
		node.visible=float(e.hp)>0
		var rig=node.get_node_or_null("Rig")
		if rig!=null:
			if str(e.kind)=="hero":
				rig.apply_state(e,float(data.time))
				continue
			var action:="idle"
			if str(e.get("action",""))=="attack": action="shot" if str(e.kind)=="hero" and str(e.heroId) in ["stapler","printer","barista"] else "melee"
			if str(e.get("action","")).begins_with("cast"): action="cast"
			var equipment:=""
			if str(e.kind)=="hero": equipment=str(config.heroes[str(e.heroId)].weapon)
			rig.apply_state({"hp":e.hp,"lifeState":"ALIVE" if float(e.hp)>0 else "DEAD_WAIT","action":action,"actionSeq":e.get("actionSeq",0),"actionStartedAt":e.get("actionAt",0),"serverTime":data.time,"pitch":0,"grounded":true},equipment)
	for id in visuals.keys():
		if not next.has(id): visuals[id].queue_free();visuals.erase(id)
	entities=next
	for effect in effects:
		if effect.get("cast_source","")=="": continue
		var actor: Dictionary=entities.get(str(effect.cast_source),{})
		if actor.is_empty() or int(actor.get("actionSeq",-1))!=int(effect.cast_seq):
			effect.life=0
			if is_instance_valid(effect.node): effect.node.queue_free()
	if first and entities.has(self_id): camera_center=visuals[self_id].position
	if bridge!=null and data.get("self")!=null and int(data.self.lastSeq)>feedback_seq:
		feedback_seq=int(data.self.lastSeq)
		bridge.feedback(feedback_seq)
	if attack_range.get_child_count()==0 and data.get("self")!=null:
		attack_range_base=float(data.self.stats.range)
		MapView.ring(attack_range,attack_range_base,Color("b3d2bf"),.06)
	_sync_fog(data.get("vision",{}))
	labels.nodes=visuals
	labels.states=entities
	labels.self_id=self_id
	_sync_projectiles(data.get("projectiles",[]))
	_sync_zones(data.get("zones",[]))
	for e in data.get("events",[]):
		if int(e.id)>last_event:
			last_event=int(e.id)
			var age:=maxf(0,float(data.time)-float(e.time))
			if age<.8: _effect(e,age)

func _make_entity(e: Dictionary) -> Node3D:
	var node:=Node3D.new()
	add_child(node)
	node.position=Vector3(float(e.x),0,float(e.z))
	var kind:=str(e.kind)
	var tint:=MapView.BLUE if int(e.team)==0 else MapView.RED if int(e.team)==1 else Color("d8bb6c")
	MapView.ring(node,float(e.radius)+.25,tint,.09)
	if kind=="hero":
		var rig:=HeroRig.new()
		rig.name="Rig"
		node.add_child(rig)
		var hero:=str(e.heroId)
		rig.setup(hero,int(e.team),Color(str(config.heroes[hero].color)))
	elif kind=="monster":
		var rig:=Actor.new()
		rig.name="Rig"
		node.add_child(rig)
		var species:=str(e.get("species","paper"))
		rig.setup("boss_crab" if species=="crab" else "boss_printer" if species in ["printer","archive"] else "boss_coffee_boiler" if species=="coffee" else "paper_lobber",0)
		if species=="archive": rig.scale=Vector3.ONE*1.3
		elif species!="crab": rig.scale=Vector3.ONE*.8
	elif kind=="tower":
		MapView.box(node,Vector3(0,.25,0),Vector3(2.8,.5,2.8),Color("394f55"))
		MapView.box(node,Vector3(0,1.8,0),Vector3(1.9,3.1,1.9),Color("c4c6b3"))
		MapView.box(node,Vector3(0,3.25,0),Vector3(2.5,.45,2.5),tint)
		MapView.box(node,Vector3(0,3.7,0),Vector3(.9,.6,.9),tint,true)
		for y in [.8,1.7,2.6]: MapView.box(node,Vector3(0,y,-.97),Vector3(1.3,.4,.08),Color("45616b"))
		# Raised, non-overlapping face bands: 1/2/3 identify lane tower tiers.
		var tower_tier := clampi(int(e.get("tier",0))+1,1,3)
		for i in range(tower_tier):
			var y := .54+float(i)*.32
			for side in [-1,1]:
				MapView.box(node,Vector3(0,y,float(side)*1.02),Vector3(2.12,.12,.08),tint,true)
				MapView.box(node,Vector3(float(side)*1.02,y,0),Vector3(.08,.12,1.84),tint,true)
		if str(e.get("role",""))=="nexus":
			for side in [-1,1]: MapView.box(node,Vector3(float(side)*.9,3.8,0),Vector3(.16,.7,.16),tint,true)
	elif kind=="inhibitor":
		MapView.box(node,Vector3(0,.3,0),Vector3(3.2,.6,3.2),Color("455e65"))
		for i in range(3): MapView.box(node,Vector3(0,.9+i*.4,0),Vector3(1.7-i*.35,.3,1.7-i*.35),tint,true)
	elif kind=="ward":
		MapView.box(node,Vector3(0,.8,0),Vector3(.16,1.6,.16),tint)
		MapView.box(node,Vector3(0,1.7,0),Vector3(.6,.4,.6),tint,true)
	elif kind=="core":
		Office.building_visual(node,"core",false)
		MapView.ring(node,3.1,tint,.18)
		MapView.box(node,Vector3(0,3.3,0),Vector3(1.2,.35,1.2),tint,true)
	else:
		var siege:=bool(e.get("siege",false))
		if bool(e.get("super",false)):
			node.scale=Vector3.ONE*1.4
		MapView.box(node,Vector3(0,.55,0),Vector3(1.1 if siege else .65,.9,.85 if siege else .6),tint)
		MapView.box(node,Vector3(0,1.1,0),Vector3(.55,.3,.5),Color("e3dcc4"))
		MapView.box(node,Vector3(0,.8,-.5),Vector3(.22,.22,.9 if siege else .5),Color("29424a"))
		for x in [-.36,.36]: MapView.box(node,Vector3(x,.2,0),Vector3(.2,.35,.7),Color("293f46"))
	return node

func _sync_projectiles(rows: Array) -> void:
	var ids: Dictionary={}
	for p in rows:
		var id:=str(p.id)
		ids[id]=true
		if not projectile_nodes.has(id):
			var root:=Node3D.new()
			add_child(root)
			projectile_nodes[id]=root
			var kind:=str(p.kind)
			var half_width:=maxf(.16,float(p.get("width",.3)))
			var edge:=Color("f59575") if int(p.team)!=team else Color("80d7e4")
			if HeroFX.projectile(root,kind,half_width,edge):
				pass
			elif kind in ["paper","paper_wave"]:
				MapView.box(root,Vector3.ZERO,Vector3(half_width*2,.07,.65),Color("f4ebd4"),true)
				for side in [-1,1]:
					var fold:=MapView.box(root,Vector3(side*half_width*.6,.08,-.18),Vector3(half_width*.8,.06,.6),edge,true)
					fold.rotation.z=side*.3
				MapView.box(root,Vector3(0,0,.45),Vector3(.1,.05,.6),Color("ad85d2"),true)
			elif kind=="staple":
				MapView.box(root,Vector3(0,0,.1),Vector3(half_width*2,.14,.16),Color("f8dc76"),true)
				for side in [-1,1]: MapView.box(root,Vector3(side*half_width,0,-.3),Vector3(.12,.14,.8),Color("fff0b6"),true)
			elif kind=="hook":
				MapView.box(root,Vector3(0,0,-.12),Vector3(.13,.16,.8),Color("d1e6d1"),true)
				MapView.box(root,Vector3(.2,0,-.48),Vector3(.5,.16,.14),Color("66ccba"),true)
				MapView.box(root,Vector3(.44,0,-.3),Vector3(.13,.16,.4),Color("d1e6d1"),true)
				var rope:=MapView.box(root,Vector3.ZERO,Vector3.ONE,Color("5c9e99"),true)
				rope.name="Rope"
			elif kind=="coffee_bolt":
				var drop:=MapView.box(root,Vector3.ZERO,Vector3(.3,.3,.42),Color("c69368"),true)
				drop.rotation.z=.6
				MapView.box(root,Vector3(0,.05,.28),Vector3(.12,.12,.4),Color("eed0a4"),true)
			elif kind=="ink_bolt":
				var sheet:=MapView.box(root,Vector3.ZERO,Vector3(.43,.08,.65),Color("e9d9f2"),true)
				sheet.rotation.z=.5
				MapView.box(root,Vector3(0,.05,0),Vector3(.23,.06,.4),Color("ae75d9"),true)
			else:
				MapView.box(root,Vector3.ZERO,Vector3(.14,.14,.75),Color("ffe08a"),true)
				MapView.box(root,Vector3(0,0,-.45),Vector3(.16,.16,.2),Color("fff9d8"),true)
		var node: Node3D=projectile_nodes[id]
		var next_position:=Vector3(float(p.x),1.15,float(p.z))
		if not node.has_meta("target_position"): node.position=next_position
		node.set_meta("target_position",next_position)
		node.set_meta("velocity",Vector3(float(p.dx),0,float(p.dz))*float(p.get("speed",0)))
		node.rotation.y=atan2(-float(p.dx),-float(p.dz))
		if node.has_node("Rope"):
			var rope: Node3D=node.get_node("Rope")
			rope.visible=visuals.has(str(p.get("source","")))
			if rope.visible:
				var start: Vector3=visuals[str(p.source)].position+Vector3(0,1.3,0)
				var end:=next_position
				rope.global_position=(start+end)*.5
				if start.distance_to(end)>.05:
					var up:=Vector3.RIGHT if absf((end-start).normalized().dot(Vector3.UP))>.98 else Vector3.UP
					rope.look_at(end,up)
				rope.scale=Vector3(.045,.045,maxf(.05,start.distance_to(end)))
	for id in projectile_nodes.keys():
		if not ids.has(id): projectile_nodes[id].queue_free();projectile_nodes.erase(id)

func _sync_zones(rows: Array) -> void:
	var ids: Dictionary={}
	for z in rows:
		var id:=str(z.id)
		ids[id]=true
		if not zone_nodes.has(id):
			var node:=Node3D.new()
			add_child(node)
			node.position=Vector3(float(z.x),.12,float(z.z))
			var tea:=str(z.kind)=="tea"
			var radius:=float(z.radius)
			var color:=Color("bcdfb8") if tea else Color("6d4b8c")
			var edge:=Color("9bd4bf") if int(z.team)==team else Color("ef987b")
			if HeroFX.zone(node,str(z.kind),radius,edge):
				zone_nodes[id]=node
				continue
			MapView.ring(node,radius,edge,.13 if int(z.team)==team else .24)
			for i in range(10):
				var a:=i*TAU/10.0
				var tile:=MapView.box(node,Vector3(cos(a)*radius*.52,.015,sin(a)*radius*.52),Vector3(radius*.6,.035,radius*.5),color)
				tile.rotation.y=a if tea else a*.53
				if int(z.team)!=team:
					var warning:=MapView.box(node,Vector3(cos(a)*radius*.9,.055,sin(a)*radius*.9),Vector3(.12,.035,.4),edge,true)
					warning.rotation.y=-a+PI*.5
			if tea:
				MapView.box(node,Vector3(0,.2,0),Vector3(.5,.4,.5),Color("8c6752"))
				MapView.box(node,Vector3(0,.45,0),Vector3(1.3,.13,1.3),Color("e6ce9d"))
				for i in range(3): MapView.box(node,Vector3((i-1)*.36,.65,0),Vector3(.2,.28,.2),Color("fbebcb"))
				var steam:=Node3D.new()
				steam.name="Steam"
				node.add_child(steam)
				for i in range(3): MapView.box(steam,Vector3((i-1)*.4,1.1+i*.13,0),Vector3(.08,.23,.08),Color("d4ecce"),true)
			zone_nodes[id]=node
		var current: Node3D=zone_nodes[id]
		var steam:=current.get_node_or_null("Steam")
		if steam!=null: steam.position.y=sin(float(snapshot.get("time",0))*3)*.12
	for id in zone_nodes.keys():
		if not ids.has(id): zone_nodes[id].queue_free();zone_nodes.erase(id)

func _effect(e: Dictionary, age := 0.0) -> void:
	var kind:=str(e.kind)
	if kind=="cast" and age>=float(e.get("windup",.16)): return
	if kind=="cast" and str(entities.get(str(e.get("source","")),{}).get("action",""))!="cast_"+str(e.skill): return
	var source:=str(e.get("source",""))
	var target:=str(e.get("target",""))
	var p:=Vector3.ZERO
	if e.has("at"): p=Vector3(float(e.at.x),.15,float(e.at.z))
	elif visuals.has(target): p=visuals[target].position
	elif visuals.has(source): p=visuals[source].position
	var root:=Node3D.new()
	add_child(root)
	root.position=p
	var duration:=.35
	var style:=""
	var cue:=""
	match kind:
		"income":
			if source==self_id and age<.6: labels.floating(p,"+"+str(int(e.amount))+" 金")
			root.queue_free()
			return
		"archive_prepare","archive_beam":
			var end:=Vector3(float(e.to.x),.2,float(e.to.z))-p
			MapView.beam(root,Vector3(0,.2,0),end,Color("bba5c9") if kind=="archive_prepare" else Color("eee0c5"),.10 if kind=="archive_prepare" else .85)
			duration=maxf(.01,.55-age) if kind=="archive_prepare" else .22
			if kind=="archive_beam": cue="impact_weak"
		"projectile_end":
			# The authoritative swept segment ends at the actual impact, never the aim point.
			if age<.12 and e.has("from") and e.has("at"):
				var start:=Vector3(float(e.from.x),1.15,float(e.from.z))-p
				var end:=Vector3(0,1.15,0)
				MapView.beam(root,start,end,Color("e3cf9c"),.06)
				duration=.065
			else: root.queue_free();return
		"projectile_spawn": root.queue_free();return
		"hit":
			labels.floating(p,str(int(e.amount)))
			if visuals.has(target):
				var rig=visuals[target].get_node_or_null("Rig")
				if rig!=null: rig.play_action("hit")
			var hero:=str(e.get("hero",""))
			var tint:=Color(str(config.heroes[hero].color)) if config.heroes.has(hero) else Color("ffdc8a")
			var ink_pop:=str(e.get("style",""))=="ink_pop"
			for i in range(8 if ink_pop else 4):
				var a:=i*TAU/(8 if ink_pop else 4)
				var fragment:=MapView.box(root,Vector3(cos(a)*(.65 if ink_pop else .3),1.15+sin(a)*.25,sin(a)*.3),Vector3(.27,.05,.2) if hero=="printer" else Vector3(.13,.17,.13),tint,true)
				fragment.rotation.z=a
			if hero=="guardian":
				for side in [-1,1]: MapView.box(root,Vector3(side*.35,1,0),Vector3(.1,.7,.1),Color("d5e7f1"),true)
			if hero=="courier":
				var cut:=MapView.box(root,Vector3(0,1.2,0),Vector3(.9,.07,.12),tint,true)
				cut.rotation.z=.7
			cue="impact_creature"
		"heal":
			labels.floating(p,"+"+str(int(e.amount)),true)
			MapView.box(root,Vector3(0,2.3,0),Vector3(.15,.65,.12),Color("ade0b0"),true)
			MapView.box(root,Vector3(0,2.3,0),Vector3(.55,.15,.12),Color("ade0b0"),true)
			if visuals.has(source) and source!=target:
				MapView.beam(root,visuals[source].position-p+Vector3(0,1.4,0),Vector3(0,1.4,0),Color("dbbf8b"),.07)
			cue="coffee_share"
		"shield","rally":
			MapView.ring(root,float(e.get("radius",1.3)),Color("b6d9ed"),.18)
			style="ring"
			cue="highfive"
		"attack":
			var hero:=str(entities.get(source,{}).get("heroId",""))
			cue=HeroFX.sound(hero,false)
		"cast":
			cue=HeroFX.sound(str(e.hero),str(e.skill)=="r")
			if str(e.hero)=="lecturer" or (str(e.hero)=="stapler" and str(e.skill)=="e"):
				root.position=Vector3(float(e.to.x),.17,float(e.to.z))
				MapView.ring(root,float(e.radius),Color("ac88d4"),.1)
				duration=float(e.windup)
			if str(e.hero)=="printer" and str(e.skill)=="r":
				root.position=Vector3(float(e.to.x),3.15,float(e.to.z))
				HeroFX.stamp(root,1.6,Color("ce7599"))
				duration=float(e.windup)
				style="stamp_windup"
		"ability":
			var hero:=str(e.hero)
			var shape:=str(e.shape)
			var color:=Color(str(config.heroes[hero].color))
			HeroFX.ability(root,shape,float(e.radius),color)
			if shape in ["clean","sound","guard"]:
				var d:=Vector3(float(e.to.x),0,float(e.to.z))-p
				root.rotation.y=atan2(-d.x,-d.z)
			cue=HeroFX.sound(hero,str(e.skill)=="r")
			duration=.5 if shape=="stamp_drop" else .38
		"blink":
			for side in [-1,1]: MapView.box(root,Vector3(side*.5,1,0),Vector3(.15,1.8,.3),Color("f7e58c"),true)
			if e.has("to"):
				var end:=Vector3(float(e.to.x),0,float(e.to.z))-p
				MapView.ring(root,.9,Color("fff0b3"),.15).position=end+Vector3(0,.2,0)
			cue="paper_throw"
		"smite":
			MapView.beam(root,Vector3(0,5,0),Vector3(0,.3,0),Color("edc785"),.3)
			MapView.ring(root,1.2,Color("ffdc85"),.18)
			cue="impact_weak"
		"dash","hook":
			if e.has("to"):
				var end:=Vector3(float(e.to.x),.2,float(e.to.z))-p
				var hero:=str(e.get("hero","courier"))
				var tint:=Color(str(config.heroes[hero].color)) if config.heroes.has(hero) else Color("9ad2cc")
				MapView.beam(root,Vector3(0,.2,0),end,tint,.08 if hero=="stapler" else .18)
				if hero=="guardian":
					for i in range(5): MapView.box(root,end*float(i)/5+Vector3(0,.15,0),Vector3(.35,.2,.35),Color("aaa18b"))
			cue="paper_throw"
		"slam":
			MapView.ring(root,float(e.radius),Color("edc883"),.22)
			for i in range(12):
				var a:=i*TAU/12.0
				MapView.box(root,Vector3(cos(a)*float(e.radius)*.7,.3,sin(a)*float(e.radius)*.7),Vector3(.3,.5,.3),Color("b6a488"))
				MapView.beam(root,Vector3(cos(a)*.8,.1,sin(a)*.8),Vector3(cos(a)*float(e.radius)*.9,.1,sin(a)*float(e.radius)*.9),Color("eddcb3"),.09)
			style="ring"
			cue="break_partition"
		"crab_prepare":
			if visuals.has(source):
				var rig=visuals[source].get_node_or_null("Rig")
				if rig!=null: rig.play_action("attack")
		"execute":
			MapView.beam(root,Vector3(-.6,1,-.6),Vector3(.6,1,.6),Color("67cfc3"),.2)
			MapView.beam(root,Vector3(-.6,1,.6),Vector3(.6,1,-.6),Color("67cfc3"),.2)
			cue="impact_weak"
		"overdrive":
			for side in [-1,1]: MapView.box(root,Vector3(side*.65,1.4,0),Vector3(.2,.6,.2),Color("ffe17c"),true)
			cue="archive_open"
		"death": cue="impact_creature"
		"level","victory","objective": cue="highfive"
	var remaining:=duration-age if kind=="cast" else duration
	if style=="stamp_windup": root.position.y=.15+3*remaining/duration
	effects.append({"node":root,"life":remaining,"duration":duration,"kind":style,"cast_source":source if kind=="cast" else "","cast_seq":int(entities.get(source,{}).get("actionSeq",0))})
	if not cue.is_empty() and camera_center.distance_to(p)<32:
		var pan:=clampf((p.x-camera_center.x)/20,-1,1)
		var priority:=85 if kind=="cast" and str(e.get("skill",""))=="r" else 65 if kind in ["ability","execute","slam"] else 25 if kind=="hit" else -1
		sounds.play(cue,volume*.5,pan,priority,camera_center.distance_to(p)>18,source)

func _sync_fog(vision: Dictionary) -> void:
	var cells:=str(vision.get("cells",""))
	if cells.is_empty() or cells==fog_cells: return
	fog_cells=cells
	var size:=int(vision.get("size",28))
	if cells.length()!=size*size: return
	var mask:=Image.create(size,size,false,Image.FORMAT_RGBA8)
	for z in range(size):
		for x in range(size):
			mask.set_pixel(x,z,Color(1,1,1,0 if cells[z*size+x]=="1" else 1))
	if fog_mesh==null:
		fog_mesh=MeshInstance3D.new()
		fog_texture=ImageTexture.create_from_image(mask)
		var material:=StandardMaterial3D.new()
		material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
		material.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
		material.cull_mode=BaseMaterial3D.CULL_DISABLED
		material.albedo_color=Color(.035,.08,.1,.58)
		material.albedo_texture=fog_texture
		material.texture_filter=BaseMaterial3D.TEXTURE_FILTER_LINEAR
		fog_mesh.material_override=material
		fog_mesh.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(fog_mesh)
		var mesh:=ArrayMesh.new()
		var arrays:=[]
		arrays.resize(Mesh.ARRAY_MAX)
		var half:=float(config.map.size)*.5
		arrays[Mesh.ARRAY_VERTEX]=PackedVector3Array([Vector3(-half,.25,-half),Vector3(half,.25,-half),Vector3(half,.25,half),Vector3(-half,.25,-half),Vector3(half,.25,half),Vector3(-half,.25,half)])
		arrays[Mesh.ARRAY_TEX_UV]=PackedVector2Array([Vector2(0,0),Vector2(1,0),Vector2(1,1),Vector2(0,0),Vector2(1,1),Vector2(0,1)])
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
		fog_mesh.mesh=mesh
	else:
		fog_texture.update(mask)

func _ping_effect(p: Dictionary) -> void:
	var root:=Node3D.new()
	add_child(root)
	root.position=Vector3(float(p.x),.15,float(p.z))
	var tint:=Color("f2a17d") if str(p.kind)=="danger" else Color("8ed8df")
	MapView.ring(root,1.8,tint,.18)
	MapView.box(root,Vector3(0,1,0),Vector3(.2,1.4,.2),tint,true)
	MapView.box(root,Vector3(.4,1.6,0),Vector3(.8,.4,.1),tint,true)
	effects.append({"node":root,"life":2.5,"duration":2.5,"kind":"ping"})
