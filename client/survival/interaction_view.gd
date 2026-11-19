extends Node3D

const StaticMeshBatch = preload("res://survival/static_mesh_batch.gd")
const EnemyStrike = preload("res://survival/enemy_strike.gd")

const OfficeTools = preload("res://survival/office_tools.gd")
const AimProfile = preload("res://survival/aim_profile.gd")
const FishingPresentation = preload("res://survival/fishing_presentation.gd")

const FONT = preload("res://fonts/IslandSans.ttf")
const OLD_ROD = preload("res://assets/rod.gltf")
var rig: Node3D
var camera: Camera3D
var models: Dictionary = {}
var hands: Array[Node3D] = []
var materials: Dictionary = {}
var effects: Array = []
var impact_sources: Dictionary = {}
var effect_water_y := -1000.0
var weapon := "carbine"
var recoil := 0.0
var swing_time := 0.0
var punch_time := 0.0
var punch_left := false
var hit_time := 0.0
var shake := 0.0
var clock := 0.0
var equip_time := 0.0
var cast_time := 0.0
var cast_duration := 0.8
var cast_power := 0.0
var rod_charge := 0.0
var aim_blend := 0.0
var aim_ready := false
var aim_requested := false
var stride := 0.0
var landing := 0.0
var bloom := 0.0
var muzzle_time := 0.0
var reload_elapsed := 0.0
var reload_active := false
var bandage_blend := 0.0
var rod_crank_phase := 0.0
var rod_crank_blend := 0.0
var rod_pull_blend := 0.0
var context: Dictionary = {}
var carry_model: Node3D
var weapon_configs: Array = []
var look_motion := Vector2.ZERO
var stats := {"shots":0,"tracers":0,"impacts":0,"casts":0,"casings":0,"punches":0,"enemy_strikes":0}
var enemy_strike_seen: Dictionary = {}

func material(color: Color, emissive := false) -> StandardMaterial3D:
	var key := color.to_html() + str(emissive)
	if not materials.has(key):
		var mat := StandardMaterial3D.new()
		mat.albedo_color = color
		mat.roughness = 0.78
		if emissive:
			mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		if color.a < 1:
			mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		materials[key] = mat
	return materials[key]

func box(parent: Node, at: Vector3, size: Vector3, color: Color, emissive := false) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	node.mesh = mesh
	node.material_override = material(color, emissive)
	parent.add_child(node)
	node.position = at
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return node

func setup(owner_camera: Camera3D) -> void:
	camera = owner_camera
	rig = Node3D.new()
	camera.add_child(rig)
	for side in [-1, 1]:
		var hand := Node3D.new()
		rig.add_child(hand)
		box(hand, Vector3(0,-0.15,0.08), Vector3(0.155,0.36,0.19), Color("244a58"))
		box(hand, Vector3(0,-0.04,-0.025), Vector3(0.175,0.11,0.205), Color("182e39"))
		box(hand, Vector3(0,0.045,-0.035), Vector3(0.18,0.16,0.18), Color("e5ba90"))
		hand.position = Vector3(side*0.26,-0.43,-0.58)
		hands.append(hand)
	for id in AimProfile.GUNS + ["knife"] + OfficeTools.ROD_IDS + OfficeTools.QUICK_IDS:
		var model := Node3D.new()
		rig.add_child(model)
		models[id] = model
		if id in OfficeTools.NEW_RODS:
			OfficeTools.build_rod(model,id)
		elif id.begins_with("rod"):
			OfficeTools.build_legacy_rod(model,id,0.52)
		elif id == "knife" or OfficeTools.is_quick(id):
			OfficeTools.build(model,id)
		else:
			_build_gun(model, id)
	StaticMeshBatch.merge_tree(rig, ["Bolt", "Pump", "Flash", "BreakAction", "NetMesh", "AssemblyFittings"])
	equip(weapon)

func _build_gun(model: Node3D, id: String) -> void:
	OfficeTools.build(model,id)

func equip(id: String) -> void:
	if weapon != id:
		equip_time = float(_weapon_def(id).get("equip_seconds",0.35))
		punch_time = 0
		aim_blend = 0
		aim_ready = false
		aim_requested = false
		weapon = id
		rod_crank_blend=0
		rod_pull_blend=0
	for key in models:
		models[key].visible = key == weapon

func _weapon_def(id: String) -> Dictionary:
	if context.get("weaponStats") is Dictionary and str(context.weaponStats.get("id",""))==id: return context.weaponStats
	for definition in weapon_configs:
		if str(definition.get("id",""))==id: return definition
	return {}

func set_context(data: Dictionary, charge: float, motion: Vector2) -> void:
	context = data
	if models.has(weapon): OfficeTools.apply_fittings(models[weapon],weapon,str(data.get("heldModuleId","")),str(data.get("heldAttachmentId","")))
	rod_charge = charge
	look_motion = look_motion.lerp(motion.limit_length(30), 0.45)

func muzzle_position() -> Vector3:
	if models.has(weapon) and models[weapon].has_node("Muzzle"):
		return models[weapon].get_node("Muzzle").global_position
	return camera.global_transform * Vector3(0.28,-0.15,-1.2)

func scope_alpha() -> float:
	return smoothstep(0.58,0.94,aim_blend) if weapon == "rifle" else 0.0

func cast_animation(power := 1.0, duration := 0.8) -> void:
	cast_duration = maxf(0.1,duration)
	cast_time = cast_duration
	cast_power = power
	stats.casts += 1

func land(strength := 1.0) -> void:
	landing = minf(0.12, 0.035 + strength*0.025)

func animate(delta: float, moving: float, ads: bool, reloading: bool, sprinting: bool, show_rig: bool) -> void:
	clock += delta
	var bandaging: bool = context.get("work") is Dictionary and str(context.work.get("kind",""))=="Bandage" and weapon=="bandage"
	bandage_blend=move_toward(bandage_blend,1.0 if bandaging else 0.0,delta/0.20)
	stride += delta * (12.5 if sprinting else 8.5) * moving
	recoil = move_toward(recoil,0,delta*0.75)
	swing_time = maxf(0,swing_time-delta*3.0)
	punch_time = maxf(0,punch_time-delta)
	hit_time = maxf(0,hit_time-delta)
	shake = move_toward(shake,0,delta*0.65)
	bloom = move_toward(bloom,0,delta*32)
	landing = move_toward(landing,0,delta*0.38)
	equip_time = maxf(0,equip_time-delta)
	cast_time = maxf(0,cast_time-delta)
	muzzle_time = maxf(0,muzzle_time-delta)
	aim_requested = AimProfile.requested_ads(context,ads,weapon) and not reloading and not sprinting and show_rig
	aim_ready = AimProfile.ready(context,aim_requested,weapon)
	aim_blend = move_toward(aim_blend,1.0 if aim_requested else 0.0,delta/float(_weapon_def(weapon).get("ads_seconds",AimProfile.ADS_READY_SECONDS)))
	if reloading and not reload_active:
		reload_elapsed = 0
	reload_active = reloading
	reload_elapsed += delta if reloading else 0.0
	rig.visible = show_rig
	var bob := Vector3(cos(stride)*moving*0.014,absf(sin(stride))*moving*0.021,0) * (1-aim_blend*0.9)
	var target := bob + AimProfile.view_offset(weapon)*aim_blend + Vector3(0,-landing-equip_time*0.75-recoil*aim_blend*0.80,recoil+equip_time*0.25)
	# In the scope the physical tool drops below the lens, while remaining present
	# for Muzzle/Flash and warmup. One world camera still renders the actual target.
	target.y -= scope_alpha()*0.40
	target += Vector3(-look_motion.x*0.0006,look_motion.y*0.0005,0)*(1-aim_blend*0.9)
	rig.position = rig.position.lerp(target,minf(delta*19,1))
	var reload_roll := float({"pistol":-0.32,"smg":-0.48,"lmg":-0.20}.get(weapon,-0.60))
	rig.rotation = rig.rotation.lerp(Vector3(recoil*lerpf(1.5,0.30,aim_blend)+landing*0.6, -look_motion.x*0.0005*(1-aim_blend*0.9), (reload_roll if reloading else (0.28 if sprinting else 0.0))+bob.x*2),minf(delta*13,1))
	look_motion = look_motion.lerp(Vector2.ZERO,minf(delta*8,1))
	for i in range(hands.size()):
		hands[i].visible = show_rig
		hands[i].position = Vector3(-0.12 if i==0 else 0.26,-0.43,-0.91 if i==0 else -0.53)
		hands[i].rotation = Vector3(0,0,0.2 if i==0 else 0)
		if not models.has(weapon):
			hands[i].position=Vector3(-0.28 if i==0 else 0.28,-0.5,-0.55)
			hands[i].rotation.z=0.16 if i==0 else -0.16
			if punch_time > 0:
				var progress := 1.0 - punch_time / 0.42
				var extension := smoothstep(0.0,0.38,progress) * (1.0-smoothstep(0.45,1.0,progress))
				if i == (0 if punch_left else 1):
					hands[i].position += Vector3(0.13 if i==0 else -0.13,0.16,-0.42) * extension
					hands[i].rotation.x = -0.35 * extension
				else:
					hands[i].position.y += 0.05 * extension
	if models.has(weapon):
		var model: Node3D = models[weapon]
		model.position = Vector3(0.26,-0.29,-0.49)
		model.rotation = Vector3.ZERO
		model.scale=Vector3.ONE*(0.82 if AimProfile.is_gun(weapon) else 1.0)
		if weapon=="rod_net":
			var fishing: Dictionary = context.fishing if context.get("fishing") is Dictionary else {}
			var arc := sin((1.0-cast_time/cast_duration)*PI) if cast_time>0 else 0.0
			var pull := FishingPresentation.reel_weight(fishing)
			model.position=Vector3(.31,-.54+arc*.13,-.71+sin(clock*6)*pull*.07)
			model.rotation=Vector3(-.65-arc*.9+rod_charge*.5,-.2,-.22-arc*.4)
			hands[0].position=Vector3(-.06,-.42,-.69+sin(clock*6)*pull*.12)
			hands[1].position=Vector3(.32,-.52,-.60)
			OfficeTools.animate_net(model,fishing,clock,arc)
		elif weapon.begins_with("rod"):
			var arc := sin((1.0-cast_time/cast_duration)*PI) if cast_time>0 else 0.0
			var fishing: Dictionary = context.fishing if context.get("fishing") is Dictionary else {}
			var tug := float(fishing.get("tension",0))/100.0
			model.position = Vector3(0.42-arc*0.25,-0.52+sin(clock*2.2)*0.008,-0.64+rod_charge*0.16)
			model.rotation = Vector3(-0.5-arc*0.9+rod_charge*0.75-tug*0.08,-0.25,-0.2-arc*0.65-rod_charge*0.20)
			rod_crank_blend=move_toward(rod_crank_blend,FishingPresentation.reel_weight(fishing),delta*10)
			rod_pull_blend=move_toward(rod_pull_blend,FishingPresentation.pull_weight(fishing),delta*4)
			var reel_weight := rod_crank_blend
			var pull_weight := rod_pull_blend
			rod_crank_phase+=delta*(7 if weapon=="rod_heavy" else 11)*reel_weight
			var spool_angle := rod_crank_phase
			model.rotation.x-=pull_weight*0.16
			model.rotation.z+=sin(clock*6)*pull_weight*0.035
			model.position.z+=pull_weight*0.07
			OfficeTools.RodFlex.animate(model,pull_weight,delta,not fishing.is_empty())
			if not fishing.is_empty():
				hands[0].position = Vector3(0.18+cos(spool_angle)*0.045*reel_weight,-0.43+sin(spool_angle)*0.035*reel_weight,-0.66)
				hands[0].rotation.x=-0.25*reel_weight
			else:
				hands[0].visible = false
			hands[1].position = Vector3(0.37,-0.56,-0.53)
		elif weapon == "knife":
			var slash := sin(swing_time*PI)
			model.rotation = Vector3(-slash*1.1,slash*0.8,-slash*1.25)
			model.position += Vector3(-slash*0.32,slash*0.12,-slash*0.39)
			hands[1].position += Vector3(-slash*0.30,slash*0.14,-slash*0.38)
			hands[0].position = Vector3(-0.28,-0.45,-0.54)
		elif OfficeTools.is_quick(weapon):
			var using_tool := str(context.get("action",""))=="tool"
			var progress := clampf((float(context.get("_serverTime",0))-float(context.get("actionStartedAt",0)))/0.65,0,1)
			var use_arc := sin(progress*PI) if using_tool else 0.0
			# Turn the readable face toward the local camera, below the aim line.
			model.position=Vector3(0.28,-0.35,-0.64)
			model.rotation.y=PI
			model.scale=Vector3.ONE*0.80
			if weapon=="coffee_flask":
				model.position+=Vector3(-0.13,0.19,0.18)*use_arc
				model.rotation.x=-use_arc*0.7
			elif weapon in ["flash_note","decoy_alarm"]:
				model.position+=Vector3(-0.10,0.10,-0.36)*use_arc
				model.rotation.x=use_arc*0.65
			else:
				model.position+=Vector3(-0.18,0.06,-0.10)*use_arc
			var wrap_blend := smoothstep(0,1,bandage_blend) if weapon=="bandage" else 0.0
			model.position+=Vector3(-0.18,0.02+sin(clock*6)*0.015,-0.03)*wrap_blend
			hands[0].position=Vector3(-0.27,-0.49,-0.55).lerp(Vector3(0.04,-0.34,-0.69),wrap_blend)
			hands[1].position=model.position+Vector3(0,-0.10,0.04)
		else:
			if weapon=="pistol": hands[0].position=Vector3(0.10,-0.42,-0.56)
			elif weapon=="smg": hands[0].position=Vector3(-0.04,-0.44,-0.77)
			model.get_node("Muzzle/Flash").visible = muzzle_time>0
			model.get_node("Muzzle/Flash").rotation.z = clock*31
			model.get_node("Bolt").position.z = -0.20 + recoil*0.9
			if model.has_node("Pump"):
				model.get_node("Pump").position.z = -0.61 + sin(swing_time*PI)*0.16
			var magazine: Node3D = model.get_node("Magazine")
			magazine.position.y = -0.14
			if reloading:
				var cycle := sin(minf(reload_elapsed/maxf(0.1,float(context.get("_reloadDuration",1.7))),1)*PI)
				magazine.position.y -= cycle*0.30
				# Reach from the support grip and return to it. A fixed end pose put
				# the left sleeve and right hand on the same plane, causing flicker.
				hands[0].position = hands[0].position.lerp(Vector3(0.06,-0.46,-0.72),cycle) + Vector3(0,-cycle*0.30,0)
				hands[0].rotation.x = cycle*0.65
				if weapon == "shotgun":
					hands[0].position = Vector3(0.05,-0.47-absf(sin(reload_elapsed*5.7))*0.18,-0.65)
			OfficeTools.animate_tool(model,weapon,recoil,reloading,reload_elapsed,float(context.get("_reloadDuration",1.7)))
	var social_action := str(context.get("action",""))
	var social_progress := clampf((float(context.get("_serverTime",0))-float(context.get("actionStartedAt",0)))/maxf(.1,float(context.get("actionDuration",.6))),0,1)
	var social_weight := sin(social_progress*PI) if social_action.begins_with("social_") and social_progress < 1 else 0.0
	var downed := str(context.get("lifeState","")) == "DOWNED"
	var aid: bool = context.get("work") is Dictionary and str(context.work.get("kind","")) in ["Revive","SelfRevive"]
	for id in models:
		models[id].visible = id==weapon and not downed and not aid and social_weight <= 0
	if social_weight > 0 and not downed and not aid:
		rig.position=Vector3.ZERO
		rig.rotation=Vector3.ZERO
		for i in range(hands.size()):
			hands[i].visible=show_rig
			hands[i].position=Vector3(-.28 if i==0 else .28,-.5,-.55)
			if i==1:
				hands[i].position+=Vector3(-.08,.28 if social_action=="social_highfive" else .1,-.3)*social_weight
				hands[i].rotation=Vector3(-.5*social_weight,0,-.12)
	if downed or aid:
		rig.position=Vector3.ZERO
		rig.rotation=Vector3.ZERO
		for i in range(hands.size()):
			hands[i].visible=show_rig
			var wave := sin(clock*(3.0 if aid else 5.0)+(PI if i==0 else 0))*(0.025 if aid else moving*0.07)
			hands[i].position=Vector3(-0.30 if i==0 else 0.30,-0.43+wave*0.3,-0.58+wave)
			hands[i].rotation=Vector3(-0.55,0,0.12 if i==0 else -0.12)
			if str(context.get("work",{}).get("kind","") if context.get("work") is Dictionary else "")=="SelfRevive" and i==1:
				hands[i].position=Vector3(0.05,-0.48,-0.40)
				hands[i].rotation=Vector3(-0.2,0,-0.8)
	var carrying: bool=context.get("carryingId")!=null and not downed and not aid
	if carrying and not is_instance_valid(carry_model):
		carry_model=Node3D.new()
		rig.add_child(carry_model)
		preload("res://survival/exploration_view.gd").carry_box(carry_model)
		carry_model.position=Vector3(0,-.57,-.85)
	if is_instance_valid(carry_model): carry_model.visible=carrying and show_rig
	if carrying:
		for model in models.values(): model.visible=false
		for i in range(hands.size()):
			hands[i].visible=show_rig
			hands[i].position=Vector3(-.35 if i==0 else .35,-.58,-.73)
			hands[i].rotation=Vector3(-.4,0,.15 if i==0 else -.15)
	_update_effects(delta)

func punch() -> void:
	if not weapon.is_empty(): return
	punch_time = 0.42
	punch_left = not punch_left
	stats.punches += 1

func fire() -> void:
	swing_time = 1
	if not AimProfile.is_gun(weapon):
		return
	stats.shots += 1
	recoil = minf(recoil+0.06,0.115) if weapon=="carbine" else (0.17 if weapon=="shotgun" else 0.145)
	if weapon=="pistol": recoil=0.105
	elif weapon=="smg": recoil=minf(recoil*0.40+0.04,0.10)
	elif weapon=="lmg": recoil=minf(recoil*0.45+0.08,0.16)
	elif weapon=="doublebarrel": recoil=.21
	elif weapon=="dmr": recoil=.085
	bloom = minf(bloom+6,22)
	muzzle_time = 0.065
	shake = maxf(shake,0.012 if weapon=="carbine" else 0.026)
	if weapon=="doublebarrel": return # Break action keeps shells until reload opens the breech.
	var casing_size := Vector3(0.07,0.02,0.045) if weapon=="carbine" else (Vector3(0.055,0.025,0.08) if weapon=="shotgun" else Vector3(0.025,0.025,0.095))
	var casing := box(self,camera.global_transform*Vector3(0.30,-0.23,-0.74),casing_size,Color("a9cbd0") if weapon!="rifle" else Color("75bcc7"),true)
	_add_effect(casing,1.0,camera.global_basis*Vector3(randf_range(1.5,2.3),randf_range(0.8,1.4),0.15),true)
	stats.casings += 1

func _add_effect(node: Node3D, duration: float, velocity := Vector3.ZERO, gravity := false, kind := "particle") -> void:
	while effects.size()>=220:
		var expendable: Array=effects.filter(func(effect: Dictionary): return not _active_attack_effect(effect))
		var oldest: Dictionary = expendable.front() if not expendable.is_empty() else effects.front()
		effects.erase(oldest)
		if is_instance_valid(oldest.node): oldest.node.queue_free()
	effects.append({"node":node,"life":duration,"duration":duration,"velocity":velocity,"gravity":gravity,"kind":kind,"scale":node.scale})

func _active_attack_effect(effect: Dictionary) -> bool:
	return effect.kind=="enemy_strike" and is_instance_valid(effect.node) and bool(effect.node.travel) and float(effect.node.age)<float(effect.node.active_seconds)

func clear_surface_marks(target_id: String) -> void:
	for effect in effects.duplicate():
		if effect.kind == "surface_mark" and str(effect.get("target_id","")) == target_id:
			if is_instance_valid(effect.node): effect.node.queue_free()
			effects.erase(effect)
	impact_sources.erase(target_id)

func sync_impact_sources(sources: Dictionary, water_y: float) -> void:
	# A replacement model, opened gate, destroyed support or missed destruction
	# event must not leave a world-space mark hanging at the previous surface.
	for id in impact_sources.keys():
		if not sources.has(id) or sources[id].node != impact_sources[id].node or sources[id].signature != impact_sources[id].signature:
			clear_surface_marks(str(id))
	impact_sources = sources
	effect_water_y = water_y

func clear_effects() -> void:
	for effect in effects:
		if is_instance_valid(effect.node): effect.node.queue_free()
	effects.clear()
	impact_sources.clear()
	enemy_strike_seen.clear()

func _update_effects(delta: float) -> void:
	for effect in effects.duplicate():
		if not is_instance_valid(effect.node) or effect.node.is_queued_for_deletion():
			effects.erase(effect)
			continue
		effect.life -= delta
		var submerged: bool = effect.kind == "surface_mark" and effect.node.global_position.y < effect_water_y+0.02
		if effect.life<=0 or submerged:
			effect.node.queue_free()
			effects.erase(effect)
			continue
		effect.node.position += effect.velocity*delta
		if effect.kind == "enemy_strike":
			effect.node.advance(delta)
			continue
		if effect.gravity:
			effect.velocity.y -= 8*delta
			effect.node.rotation += Vector3(3,7,2)*delta
		var fade: float = clampf(float(effect.life)/minf(float(effect.duration)*0.4,0.2),0,1)
		if effect.node is Label3D:
			effect.node.modulate.a = fade
		elif effect.kind == "beam":
			effect.node.scale = Vector3(fade,fade,1)
		elif effect.kind == "ring":
			var growth: float = 1+(1-float(effect.life)/float(effect.duration))*2.5
			effect.node.scale = Vector3(growth,0.08,growth)*fade
		else:
			effect.node.scale = effect.scale*fade

func tracer(from: Vector3, to: Vector3, id := "carbine") -> void:
	if id == "fist": return
	var difference := to-from
	if difference.length()<0.03:
		return
	var width := 0.032 if id=="shotgun" else (0.046 if id=="rifle" else 0.037)
	var beam := box(self,(from+to)*0.5,Vector3(width,width,difference.length()),(Color("a9e9eb") if id=="shotgun" else (Color("79cedf") if id=="rifle" else Color("ffe9a5"))),true)
	beam.look_at(to)
	_add_effect(beam,0.18 if id=="rifle" else 0.14,Vector3.ZERO,false,"beam")
	stats.tracers += 1

func remote_muzzle(at: Vector3) -> void:
	burst(at,Color("fff3af"),4,0.09)

func burst(at: Vector3,color: Color,count: int,duration: float) -> void:
	for i in range(count):
		var particle := box(self,at,Vector3.ONE*randf_range(0.035,0.085),color,true)
		_add_effect(particle,duration,Vector3(randf_range(-1.8,1.8),randf_range(0.4,2.8),randf_range(-1.8,1.8)),true)

func impact(at: Vector3, normal := Vector3.UP, surface := "ground", target_id := "") -> void:
	if surface == "air": return
	stats.impacts += 1
	var tint := Color("90cbd0") if surface in ["water","waterline"] else (Color("9fdce6") if surface in ["metal","terminal","turret"] else (Color("ecb575") if surface in ["wood","wall","gate","building"] else Color("d7d0b1")))
	if surface in ["metal","terminal","turret"]:
		for i in range(6):
			var spark := box(self,at+normal*0.04,Vector3(0.025,0.025,randf_range(0.10,0.20)),tint,true)
			spark.look_at(at+normal+Vector3(randf_range(-0.4,0.4),randf_range(-0.2,0.5),randf_range(-0.4,0.4)))
			_add_effect(spark,0.24,Vector3(randf_range(-2.2,2.2),randf_range(0.8,3.0),randf_range(-2.2,2.2)),true)
	elif surface in ["wood","wall","gate","building","core"]:
		for i in range(5):
			var paper := box(self,at+normal*0.04,Vector3(0.10,0.015,0.075),Color("efe6ce"),true)
			_add_effect(paper,0.38,Vector3(randf_range(-1.5,1.5),randf_range(0.5,2.0),randf_range(-1.5,1.5)),true)
	else:
		burst(at+normal*0.04,tint,7,0.38)
	if surface in ["water","waterline"]:
		ripple(at,Color("c1ece5"))
	elif surface not in ["creature","player"]:
		var anchor: Node3D = self
		if impact_sources.has(target_id):
			anchor = impact_sources[target_id].node
			if not is_instance_valid(anchor) or anchor.is_queued_for_deletion() or not anchor.is_visible_in_tree(): return
		elif surface not in ["ground","terrain"]:
			# Dynamic surfaces without a live owner still get the short hit burst,
			# never a mark. This covers late events and removed snapshot entities.
			return
		var direction := normal.normalized() if normal.length()>0.01 else Vector3.UP
		# Repeated pellets at the same point replace one another. Opaque marks
		# avoid transparent coplanar layers competing as the camera moves.
		for effect in effects.duplicate():
			if effect.kind == "surface_mark" and is_instance_valid(effect.node) and effect.node.global_position.distance_squared_to(at)<0.0225:
				effect.node.queue_free()
				effects.erase(effect)
		var chip := box(anchor,anchor.to_local(at+direction*0.014),Vector3(0.12,0.006,0.12),Color("283c40"))
		chip.global_basis = Basis(Quaternion(Vector3.UP,direction))
		_add_effect(chip,0.85 if anchor != self else 1.1,Vector3.ZERO,false,"surface_mark")
		effects.back()["target_id"] = target_id

func enemy_strike(payload: Dictionary) -> void:
	var owner := str(payload.get("enemyId",""))
	var seq := int(payload.get("attackActionSeq",0))
	var elapsed := maxf(0,float(payload.get("age",0)))
	if seq>0 and not owner.is_empty():
		if seq<=int(enemy_strike_seen.get(owner,0)):
			# A newer snapshot can advance the same wave, never replay or rewind it.
			for effect in effects:
				if effect.kind=="enemy_strike" and str(effect.get("owner_id",""))==owner and int(effect.get("sequence",0))==seq and is_instance_valid(effect.node):
					var correction := maxf(0,elapsed-float(effect.node.age))
					if correction>.05:
						effect.node.advance(correction)
						effect.life=maxf(0,float(effect.node.lifetime)-float(effect.node.age))
			return
		enemy_strike_seen[owner]=seq
		while enemy_strike_seen.size()>128: enemy_strike_seen.erase(enemy_strike_seen.keys()[0])
	var strikes: Array = effects.filter(func(effect: Dictionary): return effect.kind=="enemy_strike")
	if strikes.size()>=EnemyStrike.MAX_ACTIVE:
		var expendable: Array=strikes.filter(func(effect: Dictionary): return not _active_attack_effect(effect))
		if expendable.is_empty(): return
		var oldest: Dictionary = expendable.front()
		if is_instance_valid(oldest.node): oldest.node.queue_free()
		effects.erase(oldest)
	var strike := EnemyStrike.new()
	add_child(strike)
	strike.setup(payload)
	if not strike.advance(elapsed):
		strike.queue_free()
		return
	_add_effect(strike,maxf(.01,strike.lifetime-elapsed),Vector3.ZERO,false,"enemy_strike")
	effects.back()["owner_id"]=owner
	effects.back()["sequence"]=seq
	stats.enemy_strikes+=1

func cancel_enemy_strikes(owner: String, active_only := false) -> void:
	for effect in effects.duplicate():
		if effect.kind=="enemy_strike" and str(effect.get("owner_id",""))==owner and (not active_only or _active_attack_effect(effect)):
			if is_instance_valid(effect.node): effect.node.queue_free()
			effects.erase(effect)

func ripple(at: Vector3,color := Color("a4e1d4")) -> void:
	var mesh := TorusMesh.new()
	mesh.inner_radius = 0.25
	mesh.outer_radius = 0.29
	mesh.rings = 20
	mesh.ring_segments = 4
	var ring := MeshInstance3D.new()
	ring.mesh = mesh
	ring.material_override = material(color,true)
	add_child(ring)
	ring.position = at+Vector3.UP*0.04
	ring.scale.y = 0.08
	_add_effect(ring,0.7,Vector3.ZERO,false,"ring")

func ink_spray(at: Vector3, yaw: float) -> void:
	# Short-lived voxel droplets communicate the cone without leaving a floating stain.
	for i in range(9):
		var angle := yaw+(i-4)*0.23
		var forward := Vector3(-sin(angle),0,-cos(angle))
		var drop:=box(self,at+Vector3.UP*.52+forward*.42,Vector3(.11,.09,.18),Color("a08ace"))
		drop.rotation.y=angle
		_add_effect(drop,.38,forward*(5.0+float(i%3)),false)

func destruction(at: Vector3,kind: String,seed_value: int) -> void:
	if camera.global_position.distance_to(at)>45: return
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var count := 16 if camera.global_position.distance_to(at)<18 else 8
	for i in range(count):
		var paper := kind not in ["barrel","equipment","partition_panel","copier_shell"] and i%3==0
		var size_value := Vector3(rng.randf_range(0.12,0.32),0.015 if paper else rng.randf_range(0.045,0.10),rng.randf_range(0.10,0.23))
		var offset := Vector3(rng.randf_range(-0.35,0.35),rng.randf_range(0.25,1.1),rng.randf_range(-0.35,0.35))
		var color := Color("eee4c8") if paper else Color("b68a5b")
		if kind=="barrel": color=Color("659bab") if i%3 else Color("c0ccd0")
		if kind=="archive_cabinet": color=Color("eee4c8") if paper else (Color("557483") if i%3 else Color("e8b94f"))
		if kind=="partition_panel": color=Color("8aaeb1") if i%3 else Color("324f5d")
		if kind=="copier_shell": color=Color("9cabb2") if i%3 else Color("ffad42")
		var piece := box(self,at+offset,size_value,color)
		var velocity := Vector3(offset.x*5,rng.randf_range(1.5,3.8),offset.z*5)
		_add_effect(piece,rng.randf_range(0.7,1.25),velocity,true)
	burst(at+Vector3.UP*0.7,Color("eacb9d"),4,0.40)

func copier_chain(from: Vector3,to: Vector3) -> void:
	if camera.global_position.distance_to(from)>45 and camera.global_position.distance_to(to)>45: return
	for i in range(6):
		var point := from.lerp(to,float(i+1)/7.0)
		var spark := box(self,point,Vector3(0.055,0.055,0.055),Color("ffb452"),true)
		_add_effect(spark,0.25,Vector3(0,0.6,0),false)
	burst(to,Color("ffb452"),5,0.32)

func confirm_hit(at: Vector3, damage: int, killed: bool, mine := true, weak := false, shielded := false) -> void:
	if mine:
		hit_time = 0.23 if killed else 0.16
		shake = maxf(shake,0.027 if killed else 0.012)
	var distance_squared := camera.global_position.distance_squared_to(at) if is_instance_valid(camera) else 0.0
	if mine or distance_squared<784:
		var amount := (9 if killed else 5) if mine else (4 if killed else 2)
		burst(at,Color("9fcde3") if shielded else (Color("8be5c8") if killed else (Color("fff2be") if weak else Color("facb79"))),amount,0.42)
	if mine:
		var label := Label3D.new()
		label.text = ("弱点 " if weak else "")+str(damage)+(" ×" if killed else "")
		label.font = FONT
		label.font_size = 36 if not killed else 43
		label.pixel_size = 0.007
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.no_depth_test = true
		label.modulate = Color("a4efcf") if killed else Color("ffe8b5")
		add_child(label)
		label.position = at+Vector3.UP*0.3
		_add_effect(label,0.78,Vector3(randf_range(-0.15,0.15),0.65,0))
