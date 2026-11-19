extends Node3D

const FONT=preload("res://fonts/IslandSans.ttf")
var game
var state: Dictionary = {}
var objects: Dictionary = {}
var hats: Dictionary = {}
var effects: Array = []
var materials: Dictionary = {}
var seen: Dictionary = {}
var hint: Label
var targets_root: Node3D
var clock := 0.0
var snapshot_age := 0.0

func setup(value) -> void:
	game=value
	if hint==null:
		hint=Label.new()
		hint.name="SocialSideHint"
		hint.set_anchors_and_offsets_preset(Control.PRESET_TOP_LEFT)
		hint.position=Vector2(1002,184)
		hint.size=Vector2(260,66)
		hint.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
		hint.add_theme_font_override("font",FONT)
		hint.add_theme_font_size_override("font_size",13)
		hint.add_theme_color_override("font_color",Color("ecc15d"))
		var background:=StyleBoxFlat.new()
		background.bg_color=Color("142e38")
		background.set_corner_radius_all(6)
		background.content_margin_left=12
		background.content_margin_top=10
		hint.add_theme_stylebox_override("normal",background)
		hint.mouse_filter=Control.MOUSE_FILTER_IGNORE
		hint.visible=false
		game.gui.add_child(hint)

func _material(color: Color) -> StandardMaterial3D:
	var key := color.to_html()
	if not materials.has(key):
		var result:=StandardMaterial3D.new()
		result.albedo_color=color
		result.roughness=.9
		materials[key]=result
	return materials[key]

func _box(parent: Node3D, at: Vector3, size_value: Vector3, color: Color) -> MeshInstance3D:
	var node:=MeshInstance3D.new()
	var mesh:=BoxMesh.new()
	mesh.size=size_value
	node.mesh=mesh
	node.material_override=_material(color)
	node.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(node)
	node.position=at
	return node

func _shape(kind: String) -> Node3D:
	var node:=Node3D.new()
	match kind:
		"airplane":
			_box(node,Vector3.ZERO,Vector3(.12,.045,.6),Color("eee8d5"))
			var wing:=_box(node,Vector3(0,0,.04),Vector3(.64,.025,.23),Color("b9d7d0"))
			wing.rotation.z=.07
			_box(node,Vector3(0,.10,.22),Vector3(.025,.20,.15),Color("eee8d5"))
		"duck":
			_box(node,Vector3(0,.17,0),Vector3(.34,.26,.40),Color("ecc15d"))
			_box(node,Vector3(0,.37,-.12),Vector3(.24,.24,.24),Color("f3d57b"))
			_box(node,Vector3(0,.34,-.28),Vector3(.15,.07,.14),Color("ef9853"))
			_box(node,Vector3(.123,.41,-.15),Vector3(.015,.035,.035),Color("193741"))
			_box(node,Vector3(-.123,.41,-.15),Vector3(.015,.035,.035),Color("193741"))
		"box_hat":
			_box(node,Vector3(0,.23,0),Vector3(.48,.27,.43),Color("c79556"))
			_box(node,Vector3(0,.23,-.222),Vector3(.11,.26,.012),Color("e4c99b"))
		"cupStack", "cup_trophy":
			for row in range(3):
				for col in range(3-row):
					var cup:=_box(node,Vector3((col-(2-row)*.5)*.22,.1+row*.22,0),Vector3(.19,.2,.19),Color("eee8d5") if row%2==0 else Color("ecc15d"))
					cup.set_meta("activity_step",3 if row==2 else 2 if row==1 else 1)
		"noteChain":
			for index in range(3):
				var note:=_box(node,Vector3(-.3+index*.3,.08+index*.02,0),Vector3(.24,.035,.28),Color("84d7bc") if index==1 else Color("ecc15d"))
				note.set_meta("activity_step",index+1)
		"portrait_badge":
			_box(node,Vector3(0,.32,0),Vector3(.36,.5,.055),Color("84d7bc"))
			_box(node,Vector3(0,.42,-.04),Vector3(.12,.12,.025),Color("eee8d5"))
			_box(node,Vector3(0,.22,-.04),Vector3(.24,.09,.025),Color("ecc15d"))
		"message_flower":
			_box(node,Vector3(0,.22,0),Vector3(.035,.44,.035),Color("84d7bc"))
			for index in range(5):
				var angle: float=index*TAU/5
				var petal:=_box(node,Vector3(cos(angle)*.23,.45+sin(angle)*.23,0),Vector3(.16,.16,.04),Color("ecc15d") if index%2==0 else Color("84d7bc"))
				petal.rotation.z=angle
			_box(node,Vector3(0,.45,-.03),Vector3(.13,.13,.035),Color("eee8d5"))
		"field_postcard":
			_box(node,Vector3(0,.23,0),Vector3(.5,.32,.05),Color("eee8d5"))
			_box(node,Vector3(-.12,.23,-.04),Vector3(.17,.17,.025),Color("84d7bc"))
			_box(node,Vector3(.16,.30,-.04),Vector3(.07,.07,.025),Color("ecc15d"))
		"salvage_bottle":
			_box(node,Vector3(0,.2,0),Vector3(.26,.34,.26),Color("84d7bc"))
			_box(node,Vector3(0,.43,0),Vector3(.14,.11,.14),Color("ecc15d"))
			_box(node,Vector3(0,.2,-.146),Vector3(.2,.18,.025),Color("eee8d5"))
		"night_lantern":
			_box(node,Vector3(0,.27,0),Vector3(.32,.42,.25),Color("ecc15d"))
			_box(node,Vector3(0,.27,-.14),Vector3(.22,.29,.025),Color("eee8d5"))
			_box(node,Vector3(0,.54,0),Vector3(.14,.06,.08),Color("84d7bc"))
		"paperball":
			_box(node,Vector3.ZERO,Vector3(.14,.13,.15),Color("eee8d5"))
			_box(node,Vector3(.025,.05,-.02),Vector3(.11,.09,.08),Color("b9c8c0"))
		"highfive":
			for index in range(4):
				var ray:=_box(node,Vector3(0,.18,0),Vector3(.025,.19,.025),Color("ecc15d"))
				ray.rotation.z=index*PI/2
		_: _box(node,Vector3.ZERO,Vector3(.18,.08,.18),Color("ecc15d"))
	return node

func _targets(data: Dictionary) -> void:
	if targets_root!=null: return
	targets_root=Node3D.new()
	add_child(targets_root)
	var plane: Dictionary=data.get("planeTarget",{})
	var ring:=Node3D.new()
	targets_root.add_child(ring)
	ring.position=game._v(plane)
	for index in range(12):
		var angle:=index*TAU/12
		var edge:=_box(ring,Vector3(cos(angle)*1.12,.02,sin(angle)*1.12),Vector3(.38,.045,.10),Color("84d7bc"))
		edge.rotation.y=-angle+PI/2
	_label(ring,"纸飞机靶圈",Vector3(0,.32,0),Color("84d7bc"))
	var bin:=Node3D.new()
	targets_root.add_child(bin)
	bin.position=game._v(data.get("paperBin",{}))
	_box(bin,Vector3(0,.05,0),Vector3(.58,.08,.58),Color("375662"))
	for offset in [-.3,.3]:
		_box(bin,Vector3(offset,.34,0),Vector3(.06,.60,.64),Color("71959e"))
		_box(bin,Vector3(0,.34,offset),Vector3(.56,.60,.06),Color("71959e"))
	_label(bin,"纸团篓",Vector3(0,.86,0),Color("ecc15d"))

func _label(parent: Node3D, value: String, at: Vector3, color: Color) -> Label3D:
	var label:=Label3D.new()
	label.font=FONT
	label.font_size=24
	label.pixel_size=.003
	label.text=value
	label.modulate=color
	label.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test=false
	parent.add_child(label)
	label.position=at
	return label

func _clear() -> void:
	for node in objects.values():
		if is_instance_valid(node): node.queue_free()
	objects.clear()
	for node in hats.values():
		if is_instance_valid(node): node.queue_free()
	hats.clear()
	for value in effects:
		if is_instance_valid(value.node): value.node.queue_free()
	effects.clear()
	if targets_root!=null:
		targets_root.queue_free()
		targets_root=null
	if hint!=null: hint.visible=false

func sync(value: Dictionary) -> void:
	if game==null: return
	if str(state.get("worldId",""))!=str(value.get("worldId","")):
		_clear()
		seen.clear()
	state=value
	snapshot_age=0.0
	var social: Dictionary=state.get("social",{})
	if social.is_empty():
		_clear()
		return
	_targets(social.get("targets",{}))
	var wanted: Dictionary={}
	for row in social.get("planes",[]):
		wanted[str(row.id)]=true
		if not objects.has(str(row.id)):
			var node:=_shape("airplane")
			add_child(node)
			objects[str(row.id)]=node
	for row in social.get("marks",[]):
		wanted[str(row.id)]=true
		if not objects.has(str(row.id)):
			var node:=_shape("duck") if str(row.get("kind",""))=="duck" else Node3D.new()
			add_child(node)
			if str(row.get("kind",""))!="duck":
				var color:=Color("84d7bc") if str(row.get("stampId",""))=="help" else Color("92d7ec") if str(row.get("stampId",""))=="cheer" else Color("ecc15d")
				_box(node,Vector3(0,.03,0),Vector3(.32,.045,.32),color)
				_label(node,str({"thanks":"★","help":"+","cheer":"!"}.get(str(row.get("stampId","")),"★")),Vector3(0,.25,0),color)
			objects[str(row.id)]=node
		objects[str(row.id)].position=game._v(row)
	for row in social.get("activities",[]) + social.get("displays",[]):
		var id: String=str(row.id)
		wanted[id]=true
		if not objects.has(id):
			var kind: String=str(row.get("souvenirId",row.get("kind","")))
			var node:=_shape("duck" if kind=="rubber_duck" else kind)
			add_child(node)
			objects[id]=node
		objects[id].position=game._v(row)
		if row.has("stage"):
			for child in objects[id].get_children():
				if child is Node3D:child.visible=int(child.get_meta("activity_step",1))<=int(row.stage)
	for id in objects.keys():
		if not wanted.has(id):
			if is_instance_valid(objects[id]): objects[id].queue_free()
			objects.erase(id)
	_sync_hats()
	_hint()

func _sync_hats() -> void:
	var wanted: Dictionary={}
	for row in state.get("social",{}).get("playerStates",[]):
		var id:=str(row.playerId)
		if not bool(row.get("hat",false)) or id==str(game.self_id) or not game.actors.has(id): continue
		var actor: Node3D=game.actors[id]
		var rig=actor.get_node_or_null("Rig")
		if rig==null or not rig.joints.has("Head"): continue
		wanted[id]=true
		if hats.has(id) and not is_instance_valid(hats[id]): hats.erase(id)
		if not hats.has(id):
			var hat:=_shape("box_hat")
			rig.joints.Head.add_child(hat)
			hats[id]=hat
	for id in hats.keys():
		if not wanted.has(id):
			if is_instance_valid(hats[id]): hats[id].queue_free()
			hats.erase(id)

func _hint() -> void:
	if hint==null: return
	var viewport: Vector2=game.get_viewport().get_visible_rect().size
	var factor:=minf(viewport.x/1280.0,viewport.y/720.0)
	var offset: Vector2=(viewport-Vector2(1280,720)*factor)/2
	hint.position=offset+Vector2(1002,184)*factor
	hint.size=Vector2(260,66)*factor
	hint.add_theme_font_size_override("font_size",maxi(10,roundi(13*factor)))
	var social: Dictionary=state.get("social",{})
	var paused: bool=bool(social.get("paused",false)) or str(game.player.get("lifeState",""))!="ALIVE"
	var incoming: Array=social.get("offers",[]).filter(func(row): return str(row.get("toId",""))==str(game.self_id))
	hint.visible=not paused and game.overlay.is_empty() and not incoming.is_empty()
	if hint.visible: hint.text=("同事递来咖啡" if str(incoming[0].kind)=="coffee" else "同事邀请合照" if str(incoming[0].kind)=="pose" else "同事邀请击掌")+"\nG 接过或谢绝"
	if targets_root!=null: targets_root.visible=not paused

func handle_event(event: Dictionary) -> void:
	if game==null or not str(event.get("eventType","")).begins_with("Social"): return
	var event_id:=str(event.get("eventId",""))
	if seen.has(event_id): return
	seen[event_id]=true
	if seen.size()>128: seen.erase(seen.keys()[0])
	var payload: Dictionary=event.get("payload",{})
	var kind:=str(event.get("eventType",""))
	if kind=="SocialUnlocked":
		if str(payload.get("actorId",""))==str(game.self_id):
			var found_name: String="纪念品"
			for item in game.catalog.get("social",{}).get("souvenirs",[]):
				if str(item.id)==str(payload.get("souvenirId","")):found_name=str(item.name)
			game._toast("找到%s！G 查看收藏" % found_name)
		return
	if bool(state.get("social",{}).get("paused",false)) or str(game.player.get("lifeState","")) != "ALIVE": return
	if kind=="SocialPlayed" or kind=="SocialCompleted" or kind=="SocialScored":
		var actor_id:=str(payload.get("actorId",""))
		var actor: Dictionary=game._find(state.get("players",[]),actor_id)
		var at: Vector3=game._v(payload.get("position",actor))
		var play_kind:=str(payload.get("kind",""))
		if play_kind=="highfive" or play_kind=="coffee":
			_effect("highfive",at+Vector3.UP*.9,.65)
		elif play_kind=="paperball":
			_effect("paperball",at,.45,game._v(payload.get("from",{})))
			if bool(payload.get("scored",false)) and actor_id==str(game.self_id): game._toast("投进纸篓！",1.5)
		if kind=="SocialScored" and actor_id==str(game.self_id): game._toast("投中靶圈！",1.5)
		# Landing is a separate short reward cue; never replay the throw sound.
		var cue:= "duck" if kind=="SocialScored" else str({"coffee":"coffee_share","highfive":"highfive","airplane":"paper_throw","paperball":"paper_throw","stamp":"stamp","duck":"duck","rubber_duck":"duck","cupStack":"stamp","noteChain":"paper_throw","groupPose":"highfive"}.get(play_kind,""))
		if not cue.is_empty(): game._cue_at(cue,at,12,.35,12,"social:"+actor_id)

func _effect(kind: String, at: Vector3, duration: float, from: Vector3 = Vector3.INF) -> void:
	if effects.size()>=12:
		var old: Dictionary=effects.pop_front()
		if is_instance_valid(old.node): old.node.queue_free()
	var node:=_shape(kind)
	add_child(node)
	node.position=at
	effects.append({"node":node,"at":at,"from":from,"remaining":duration,"duration":duration})

func update(delta: float) -> void:
	if game==null: return
	clock+=delta
	snapshot_age=minf(.2,snapshot_age+maxf(0,delta))
	var social: Dictionary=state.get("social",{})
	var now: float=float(state.get("time",0))+(0.0 if bool(state.get("paused",false)) else snapshot_age)
	var paused: bool=bool(social.get("paused",false)) or str(game.player.get("lifeState",""))!="ALIVE"
	for row in social.get("planes",[]):
		if not objects.has(str(row.id)): continue
		var node: Node3D=objects[str(row.id)]
		node.visible=not paused
		var start: Vector3=game._v(row.get("from",{}))
		var end: Vector3=game._v(row.get("to",{}))
		var fraction:=clampf((now-float(row.get("startedAt",0)))/maxf(.01,float(row.get("landsAt",1))-float(row.get("startedAt",0))),0,1)
		node.position=start.lerp(end,fraction)+Vector3.UP*sin(fraction*PI)*1.2
		node.rotation.y=atan2(-(end.x-start.x),-(end.z-start.z))
		node.rotation.x=-.1 if fraction<1 else 0
	for row in social.get("marks",[]):
		if objects.has(str(row.id)): objects[str(row.id)].visible=not paused
	for index in range(effects.size()-1,-1,-1):
		var value: Dictionary=effects[index]
		value.remaining=float(value.remaining)-delta
		if value.remaining<=0 or paused:
			if is_instance_valid(value.node): value.node.queue_free()
			effects.remove_at(index)
			continue
		if value.from!=Vector3.INF:
			var fraction:=1-float(value.remaining)/float(value.duration)
			value.node.position=value.from.lerp(value.at,fraction)+Vector3.UP*sin(fraction*PI)*.25
		value.node.scale=Vector3.ONE*minf(1,float(value.remaining)*5)
	_hint()
