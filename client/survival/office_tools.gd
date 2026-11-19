extends RefCounted

# Original voxel office tools. Existing weapon IDs and animated node paths stay stable.
const Assets = preload("res://survival/office_assets.gd")
const Batch = preload("res://survival/static_mesh_batch.gd")
const Library = preload("res://survival/visual_library.gd")
const AimProfile = preload("res://survival/aim_profile.gd")
const OfficeTheme = preload("res://survival/office_theme.gd")
const OLD_ROD = preload("res://assets/rod.gltf")
const RodFlex = preload("res://survival/rod_flex.gd")
static var _pro_materials: Dictionary = {}
const INK := Color("254556")
const PAPER := Color("fff2d6")
const METAL := Color("a9cbd0")
const STAPLER := Color("e56950")
const CLIP := Color("4db5bc")
const PEN := Color("e7b84e")
const ROD_IDS := ["rod_basic", "rod_pro", "rod_light", "rod_heavy", "rod_magnet", "rod_net"]
const NEW_GUNS := ["pistol", "smg", "lmg"]
const NEW_RODS := ["rod_light", "rod_heavy", "rod_magnet", "rod_net"]
const QUICK_IDS := ["bandage","repair_kit","coffee_flask","flash_note","decoy_alarm","folding_cover","tape_trap","scan_note"]

static func muzzle_offset(id: String) -> Vector3:
	return Vector3(0,0.045,float({"pistol":-0.54,"smg":-0.73,"lmg":-0.96,"doublebarrel":-0.85,"dmr":-1.05}.get(id,-0.94)))

static func build_rod(model: Node3D, id: String) -> void:
	assert(id in NEW_RODS)
	if id=="rod_net":
		build_net(model)
		return
	Assets.attach(model,id)
	var tip := Marker3D.new()
	tip.name="Muzzle"
	tip.position=Vector3(0,1.3,0)
	model.add_child(tip)
	_no_shadows(model)
	RodFlex.attach(model)

static func build_net(model: Node3D) -> void:
	if Library.reuse("tool:rod_net",model): return
	var tint: Color = OfficeTheme.EQUIPMENT_COLORS.rod_net
	box(model,Vector3(0,0.22,0),Vector3(0.075,0.44,0.075),INK)
	box(model,Vector3(0,0.13,0),Vector3(0.086,0.17,0.086),tint)
	var bundle := _group(model,"NetMesh",Vector3(0,0.51,0))
	for side in [-1,1]:
		box(bundle,Vector3(side*0.23,0.15,0),Vector3(0.034,0.38,0.035),tint)
		box(bundle,Vector3(0,0.15,side*0.14),Vector3(0.48,0.034,0.032),PAPER)
	for index in range(7):
		box(bundle,Vector3(-0.21+index*0.07,0.11,0),Vector3(0.009,0.32,0.011),METAL)
	for index in range(5):
		box(bundle,Vector3(0,-0.03+index*0.07,.013),Vector3(0.43,0.01,0.008),tint.darkened(.25))
	# Slender crossed wires leave holes. No transparent sheet or overlapping planes.
	var tip := Marker3D.new()
	tip.name="Muzzle"
	tip.position=Vector3(0,.78,0)
	model.add_child(tip)
	Batch.merge_tree(model,["NetMesh"])
	_no_shadows(model)
	Library.remember("tool:rod_net",model)

static func animate_net(model: Node3D, fishing: Dictionary, clock: float, casting: float = 0) -> void:
	if not model.has_node("NetMesh"): return
	var net: Node3D = model.get_node("NetMesh")
	var pull := FishingWeight(fishing)
	net.scale=Vector3(1.0+casting*.35,1.0-pull*.2,1.0+casting*.35)
	net.rotation.z=sin(clock*4)*pull*.08

static func FishingWeight(fishing: Dictionary) -> float:
	return .7 if str(fishing.get("state",""))=="REEL" and str(fishing.get("cue",""))=="net_pull" else .15

static func build_legacy_rod(model: Node3D, id: String, scale_value: float) -> void:
	var original: Node3D = OLD_ROD.instantiate()
	model.add_child(original)
	original.scale=Vector3.ONE*scale_value
	if id=="rod_pro":
		# Preserve the original bent tip/reel; the whole shaft now identifies the long cast rod.
		_tint_pro(original)
	_no_shadows(model)
	RodFlex.attach(model)

static func _tint_pro(node: Node) -> void:
	if node is MeshInstance3D:
		for surface in range(node.mesh.get_surface_count()):
			var mat: Material = node.get_active_material(surface)
			if mat is StandardMaterial3D and mat.resource_name in ["woodlight","navy","gold"]:
				var key := mat.resource_name
				if not _pro_materials.has(key):
					var copy: StandardMaterial3D = mat.duplicate()
					copy.albedo_color=OfficeTheme.EQUIPMENT_COLORS.rod_pro if key!="gold" else METAL
					_pro_materials[key]=copy
				node.set_surface_override_material(surface,_pro_materials[key])
	for child in node.get_children(): _tint_pro(child)

static func is_quick(id: String) -> bool:
	return id in QUICK_IDS

static func _quick_model(model: Node3D, id: String) -> void:
	if id in ["folding_cover","tape_trap","scan_note"]:
		if Library.reuse("quick:"+id,model): return
		if id=="folding_cover":
			box(model,Vector3(0,.08,0),Vector3(.34,.36,.065),CLIP)
			box(model,Vector3(0,.08,-.04),Vector3(.055,.36,.012),INK)
			box(model,Vector3(0,.2,-.055),Vector3(.22,.045,.035),PAPER)
		elif id=="tape_trap":
			for side in [-1,1]: box(model,Vector3(side*.12,.06,0),Vector3(.06,.25,.16),PEN)
			box(model,Vector3(0,.15,0),Vector3(.25,.065,.16),PEN)
			box(model,Vector3(0,-.07,0),Vector3(.25,.065,.16),PEN)
		else:
			box(model,Vector3(0,.1,0),Vector3(.28,.32,.045),Color("a782c2"))
			for side in [-1,1]:
				box(model,Vector3(side*.075,.1,-.032),Vector3(.022,.18,.014),PAPER)
				box(model,Vector3(0,.1+side*.08,-.032),Vector3(.16,.022,.014),PAPER)
		Batch.merge_tree(model)
		Library.remember("quick:"+id,model)
		return
	Assets.attach(model,id)


static func box(parent: Node3D, at: Vector3, size: Vector3, color: Color, unlit := false) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	node.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.88
	if unlit: mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	node.material_override = mat
	parent.add_child(node)
	node.position = at
	return node

static func _group(parent: Node3D, title: String, at := Vector3.ZERO) -> Node3D:
	var node := Node3D.new()
	node.name = title
	parent.add_child(node)
	node.position = at
	return node

static func clip(parent: Node3D, at: Vector3, scale_value := 1.0, color := METAL) -> void:
	# Five flat wire bars: visible paperclip silhouette, without transparency.
	for spec in [[Vector3(-0.04,0,0),Vector3(0.018,0.025,0.18)], [Vector3(0.04,0,0.025),Vector3(0.018,0.025,0.23)], [Vector3(0,0,0.13),Vector3(0.095,0.025,0.018)], [Vector3(0,0,-0.09),Vector3(0.065,0.025,0.018)], [Vector3(0.012,0,0.012),Vector3(0.018,0.025,0.13)]]:
		box(parent, at + spec[0]*scale_value, spec[1]*scale_value, color)

static func build(model: Node3D, id: String) -> void:
	if is_quick(id):
		# Imported scenes already share meshes/materials. Repacking their ownership
		# into a second PackedScene can orphan imported children on reinstancing.
		_quick_model(model,id)
		_no_shadows(model)
		return
	if id in NEW_GUNS:
		# The imported body owns its cached mesh; moving fittings stay separate.
		Assets.attach(model,id)
		var magazine := _group(model,"Magazine",Vector3(0,-0.14,-0.33))
		if id=="pistol":
			box(magazine,Vector3(0,-0.17,0.355),Vector3(0.10,0.20,0.12),INK)
			box(magazine,Vector3(0,-0.285,0.355),Vector3(0.15,0.03,0.18),OfficeTheme.EQUIPMENT_COLORS[id])
		elif id=="smg":
			box(magazine,Vector3(0,-0.11,0.015),Vector3(0.11,0.26,0.14),METAL)
			box(magazine,Vector3(0,-0.25,-0.01),Vector3(0.12,0.05,0.18),OfficeTheme.EQUIPMENT_COLORS[id])
		else:
			box(magazine,Vector3(0,-0.11,0),Vector3(0.30,0.26,0.28),INK)
			for z in [-0.09,0.0,0.09]: box(magazine,Vector3(0,-0.25,z),Vector3(0.28,0.025,0.026),OfficeTheme.EQUIPMENT_COLORS[id])
		_open_sight(model,id)
		_gun_hardware(model,id)
		animate_tool(model,id,0,false,0)
		Batch.merge_tree(model,["Bolt","Pump","Flash"])
		_no_shadows(model)
		return
	if Library.reuse("tool:"+id,model): return
	if id == "knife":
		box(model,Vector3(0,0.03,0),Vector3(0.10,0.29,0.075),PEN)
		box(model,Vector3(0,0.03,-0.046),Vector3(0.055,0.23,0.020),INK)
		box(model,Vector3(0,0.14,-0.062),Vector3(0.049,0.075,0.028),STAPLER)
		box(model,Vector3(0,0.32,0),Vector3(0.075,0.30,0.025),METAL)
		for y in [0.23,0.31,0.39]:
			var seam := box(model,Vector3(0,y,-0.014),Vector3(0.077,0.006,0.004),INK)
			seam.rotation.z = -0.28
		Batch.merge_tree(model)
		_no_shadows(model)
		Library.remember("tool:"+id,model)
		return
	var magazine := _group(model,"Magazine",Vector3(0,-0.14,-0.33))
	if id == "carbine":
		# A broad base, open mouth, rear hinge and raised pressing arm make a stapler.
		box(model,Vector3(0,-0.06,-0.40),Vector3(0.25,0.07,0.97),INK)
		box(model,Vector3(0,-0.015,-0.44),Vector3(0.18,0.028,0.84),METAL)
		box(model,Vector3(0,0.055,0.04),Vector3(0.23,0.22,0.18),STAPLER)
		box(model,Vector3(0,-0.075,0.11),Vector3(0.19,0.18,0.22),STAPLER)
		var jaw := _group(model,"TopJaw",Vector3(0,0.11,0.10))
		box(jaw,Vector3(0,0.045,-0.45),Vector3(0.265,0.105,0.91),STAPLER)
		box(jaw,Vector3(0,-0.045,-0.93),Vector3(0.24,0.23,0.09),STAPLER)
		box(jaw,Vector3(0,0.105,-0.25),Vector3(0.18,0.022,0.33),PAPER)
		for side in [-1,1]: box(model,Vector3(side*0.132,0.058,0.04),Vector3(0.020,0.11,0.11),METAL)
		box(magazine,Vector3(0,0.035,0),Vector3(0.115,0.07,0.36),METAL)
		for z in [-0.10,-0.05,0.0,0.05,0.10]: box(magazine,Vector3(0,0.08,z),Vector3(0.12,0.020,0.012),PAPER)
	elif id == "shotgun":
		box(model,Vector3(0,0.015,-0.32),Vector3(0.29,0.20,0.57),CLIP)
		# Sleeve sits 3 mm below the receiver; coplanar underside used to flicker.
		box(model,Vector3(0,0.06,-0.14),Vector3(0.20,0.296,0.25),PAPER)
		box(model,Vector3(0,0.08,-0.59),Vector3(0.27,0.17,0.25),INK)
		box(model,Vector3(0,0.05,-0.83),Vector3(0.35,0.27,0.18),CLIP)
		box(model,Vector3(0,0.045,-0.935),Vector3(0.27,0.19,0.025),INK)
		box(model,Vector3(0,-0.16,0),Vector3(0.15,0.30,0.15),CLIP)
		for side in [-1,1]:
			box(model,Vector3(side*0.152,0.015,-0.29),Vector3(0.02,0.14,0.33),INK)
			var badge := _group(model,"ClipBadge"+str(side),Vector3(side*0.166,0.045,-0.29))
			badge.rotation.z=PI/2
			clip(badge,Vector3.ZERO,0.75,PAPER)
		var pump := _group(model,"Pump",Vector3(0,-0.08,-0.61))
		box(pump,Vector3.ZERO,Vector3(0.32,0.10,0.22),CLIP.darkened(0.18))
		for z in [-0.07,0,0.07]: box(pump,Vector3(0,-0.055,z),Vector3(0.34,0.025,0.020),PAPER)
		box(magazine,Vector3(0,-0.06,0),Vector3(0.16,0.18,0.19),PAPER)
		clip(magazine,Vector3(0,0.05,0),0.60,INK)
	elif id=="doublebarrel":
		var tint: Color = OfficeTheme.EQUIPMENT_COLORS[id]
		box(model,Vector3(0,-.01,-.05),Vector3(.25,.18,.36),tint)
		box(model,Vector3(0,-.07,.21),Vector3(.22,.2,.26),INK)
		box(model,Vector3(0,-.19,.04),Vector3(.13,.24,.13),tint)
		var barrels := _group(model,"BreakAction",Vector3(0,.01,-.20))
		for side in [-1,1]:
			box(barrels,Vector3(side*.079,.035,-.32),Vector3(.13,.13,.63),METAL)
			box(barrels,Vector3(side*.079,.035,-.65),Vector3(.096,.096,.025),INK)
			box(magazine,Vector3(side*.076,.12,.12),Vector3(.065,.07,.15),tint)
		box(barrels,Vector3(0,-.065,-.23),Vector3(.26,.065,.25),tint)
		clip(model,Vector3(.139,.024,-.04),.4,PAPER)
	elif id=="dmr":
		var tint: Color = OfficeTheme.EQUIPMENT_COLORS[id]
		box(model,Vector3(0,.005,-.30),Vector3(.18,.16,.68),tint)
		box(model,Vector3(0,.025,-.84),Vector3(.072,.072,.4),INK)
		box(model,Vector3(0,-.05,.20),Vector3(.16,.17,.33),INK)
		box(model,Vector3(0,-.17,-.02),Vector3(.10,.24,.11),tint)
		for z in [-.55,-.45,-.35]: box(model,Vector3(.094,.015,z),Vector3(.009,.06,.06),Color("438b99"))
		box(magazine,Vector3(0,-.03,0),Vector3(.10,.22,.17),INK)
		box(magazine,Vector3(0,-.15,0),Vector3(.12,.026,.19),tint)
	else:
		# Thick hexagonal pen body, gold nib and blue ink window; no long barrel swap.
		box(model,Vector3(0,0.035,-0.31),Vector3(0.15,0.15,0.75),PEN)
		box(model,Vector3(0,0.035,-0.72),Vector3(0.12,0.12,0.13),METAL)
		box(model,Vector3(0,0.035,-0.83),Vector3(0.085,0.085,0.12),PEN)
		box(model,Vector3(0,0.04,-0.925),Vector3(0.045,0.035,0.07),INK)
		box(model,Vector3(0,-0.055,0.13),Vector3(0.18,0.21,0.27),INK)
		box(model,Vector3(0,0.14,0.14),Vector3(0.09,0.025,0.25),METAL)
		box(model,Vector3(0,0.13,-0.05),Vector3(0.06,0.06,0.12),METAL)
		# Hollow sight, never an opaque solid "lens" across the viewing ray.
		box(model,Vector3(-0.083,0.035,-0.32),Vector3(0.02,0.067,0.25),CLIP)
		box(magazine,Vector3(0,-0.04,0),Vector3(0.055,0.18,0.075),CLIP)
		box(magazine,Vector3(0,-0.14,0),Vector3(0.080,0.035,0.090),PEN)
	_open_sight(model,id)
	_gun_hardware(model,id)
	animate_tool(model,id,0,false,0)
	Batch.merge_tree(model,["Bolt","Pump","Flash","BreakAction"])
	_no_shadows(model)
	Library.remember("tool:"+id,model)

static func _gun_hardware(model: Node3D, id: String) -> void:
	var side := float({"carbine":0.10,"shotgun":0.15,"rifle":0.082,"pistol":0.10,"smg":0.11,"lmg":0.181}.get(id,0.14))
	var bolt := box(model,Vector3(side,-0.015 if id=="carbine" else 0.045,-0.20),Vector3(0.045,0.055,0.115),METAL)
	bolt.name="Bolt"
	var muzzle := Marker3D.new()
	muzzle.name="Muzzle"
	muzzle.position=muzzle_offset(id)
	model.add_child(muzzle)
	var flash_size: Vector3 = {"pistol":Vector3(0.09,0.09,0.13),"smg":Vector3(0.10,0.10,0.17),"lmg":Vector3(0.17,0.13,0.25),"shotgun":Vector3(0.22,0.18,0.22)}.get(id,Vector3(0.15,0.15,0.20))
	var flash := box(muzzle,Vector3(0,0,-0.085),flash_size,Color("fff2b4"),true)
	flash.name="Flash"
	flash.visible=false

static func _open_sight(model: Node3D, id: String) -> void:
	var height := AimProfile.sight_height(id)
	var width := 0.24 if id == "shotgun" else 0.18
	var tint: Color = OfficeTheme.EQUIPMENT_COLORS.get(id,STAPLER)
	# Rear aperture: side posts and a lower bridge, with clear air at its center.
	for side in [-1,1]:
		box(model,Vector3(side*width*0.5,height,-0.13),Vector3(0.022,0.15,0.045),INK)
		box(model,Vector3(side*width*0.5,height+0.046,-0.105),Vector3(0.014,0.028,0.014),tint,true)
	box(model,Vector3(0,height-0.075,-0.13),Vector3(width+0.022,0.022,0.045),INK)
	# Apertures must be attached, not hover above the receiver. Supports stop at
	# the bridge plane (opposing contact normals) and leave the central aim ray free.
	var rear_base := float({"carbine":0.15,"shotgun":0.13,"rifle":0.08,"pistol":0.07,"smg":0.08,"lmg":0.10}.get(id,0.08))
	var rear_top := height-0.086
	for side in [-1,1]:
		var rear_side := 0.055 if id=="rifle" else width*0.5
		box(model,Vector3(side*rear_side,(rear_base+rear_top)*0.5,-0.13),Vector3(0.018,rear_top-rear_base,0.042),INK)
	if id == "rifle":
		box(model,Vector3(0,height+0.075,-0.13),Vector3(width+0.022,0.022,0.045),INK)
	else:
		# Two small front guides preserve a sight picture without blocking the dot.
		for side in [-1,1]:
			box(model,Vector3(side*width*0.38,height-0.018,muzzle_offset(id).z+0.12),Vector3(0.012,0.065,0.024),tint)
			var front_base := float({"carbine":0.12,"shotgun":0.10,"pistol":0.05,"smg":0.015,"lmg":0.05}.get(id,0.05))
			var front_top := height-0.0505
			box(model,Vector3(side*width*0.38,(front_base+front_top)*0.5,muzzle_offset(id).z+0.12),Vector3(0.012,front_top-front_base,0.024),INK)
	var anchor := Marker3D.new()
	anchor.name = "AimAnchor"
	anchor.position = Vector3(0,height,-0.13)
	model.add_child(anchor)

static func _no_shadows(parent: Node) -> void:
	for child in parent.get_children():
		if child is GeometryInstance3D: child.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_no_shadows(child)

static func animate_tool(model: Node3D, id: String, recoil: float, reloading: bool, reload_elapsed: float, reload_duration: float = 1.7) -> void:
	if id=="doublebarrel":
		var progress := clampf(reload_elapsed/maxf(.1,reload_duration),0,1)
		var opening := smoothstep(.04,.22,progress)*(1.0-smoothstep(.72,.96,progress)) if reloading else 0.0
		if model.has_node("BreakAction"): model.get_node("BreakAction").rotation.x=-opening*.68
		if model.has_node("Magazine"):
			model.get_node("Magazine").position=Vector3(0,-.14-opening*.15,-.33)
			model.get_node("Magazine").visible=reloading and progress>.24 and progress<.70
	if model.has_node("TopJaw"):
		var lift := sin(minf(reload_elapsed/1.7,1.0)*PI)*0.46 if reloading else recoil*1.4
		model.get_node("TopJaw").rotation.x=lift
	if id=="shotgun" and model.has_node("Magazine"):
		model.get_node("Magazine").rotation.z=sin(reload_elapsed*5.7)*0.22 if reloading else 0.0

	if id in NEW_GUNS or id=="dmr":
		var progress := clampf(reload_elapsed/maxf(0.1,reload_duration),0,1)
		# Withdraw, hold, insert, then charge: distinct motion beats follow actual reload time.
		var cycle := (smoothstep(0.06,0.25,progress)*(1.0-smoothstep(0.52,0.74,progress))) if reloading else 0.0
		if model.has_node("Magazine"):
			var magazine: Node3D = model.get_node("Magazine")
			magazine.position=Vector3(0.22*cycle if id=="lmg" else 0.0,(-0.14 if id=="pistol" else -0.10)-cycle*(0.16 if id=="lmg" else 0.25),-0.33)
			magazine.rotation.z=cycle*(0.40 if id=="lmg" else -0.08 if id=="smg" else -0.20)
		if model.has_node("Bolt"):
			var pull := sin(smoothstep(0.72,1.0,progress)*PI)*0.08 if reloading else 0.0
			model.get_node("Bolt").position.z=-0.20+recoil*(0.7 if id=="pistol" else 0.9)+pull

static func apply_fittings(model: Node3D, id: String, core: String, accessory: String) -> void:
	if core in ["<null>","Null","null"]: core=""
	if accessory in ["<null>","Null","null"]: accessory=""
	var signature := id+":"+core+":"+accessory
	if str(model.get_meta("fittings",""))==signature: return
	model.set_meta("fittings",signature)
	if model.has_node("AssemblyFittings"): model.get_node("AssemblyFittings").free()
	var fittings := _group(model,"AssemblyFittings")
	var is_rod := id in ROD_IDS
	if not core.is_empty():
		var at := Vector3(.14,.055,-.36) if not is_rod else Vector3(.10,.23,.02)
		box(fittings,at,Vector3(.036,.065,.13),Color("f5d089"))
		box(fittings,at+Vector3(.020,0,0),Vector3(.009,.033,.070),INK)
	if accessory=="gun_grip":
		box(fittings,Vector3(.13,-.19,-.36),Vector3(.067,.18,.10),Color("596b6f"))
	elif accessory=="gun_brake":
		box(fittings,Vector3(0,-.05,.37),Vector3(.24,.19,.055),Color("735784"))
	elif accessory=="rod_marker":
		box(fittings,Vector3(.13,.45,.02),Vector3(.065,.075,.055),Color("f5d089"),true)
	elif accessory=="rod_keeper":
		box(fittings,Vector3(.12,.14,.01),Vector3(.075,.045,.085),Color("596b6f"))
	Batch.merge_tree(fittings)
	_no_shadows(fittings)
