extends RefCounted

# Original office machines. Server states drive telegraphs and weak windows.
const KINDS := ["boss_shredder", "boss_printer", "broadcast_cart", "paper_lobber", "boss_stamp_press", "boss_coffee_boiler", "eraser_cart", "battery_mite"]
const DARK := Color("263e4c")
const PAPER := Color("f3e3bb")
const GOLD := Color("e7b74e")
const RED := Color("d9745c")
const BLUE := Color("668ea2")

static func handles(id: String) -> bool:
	return id in KINDS

static func _wheels(rig, width: float, depth: float) -> void:
	for side in [-1.0, 1.0]:
		for index in range(2):
			rig._joint(rig.body, "Wheel"+("L" if side<0 else "R")+str(index), Vector3(side*width, .2, -depth+index*depth*2), [
				rig._cube(Vector3.ZERO, Vector3(.24,.38,.38), DARK),
				rig._cube(Vector3(side*.13,0,0), Vector3(.035,.16,.16), GOLD)])

static func _weak_material(rig) -> void:
	rig.weak_material = StandardMaterial3D.new()
	rig.weak_material.albedo_color = GOLD
	rig.weak_material.roughness = .9
	rig.weak_material.emission_enabled = true
	rig.weak_material.emission = Color("ff895d")
	rig.weak_material.emission_energy_multiplier = .2

static func build(rig) -> void:
	match rig.kind:
		"boss_shredder": _shredder(rig)
		"boss_printer": _printer(rig)
		"broadcast_cart": _broadcast(rig)
		"paper_lobber": _lobber(rig)
		"boss_stamp_press", "boss_coffee_boiler", "eraser_cart", "battery_mite": _tactical(rig)

static func _tactical(rig) -> void:
	var boss: bool=rig.kind.begins_with("boss_")
	var coffee: bool=rig.kind=="boss_coffee_boiler"
	var tint: Color=Color("a782c2") if rig.kind=="boss_stamp_press" else Color("a9744d") if coffee else Color("de8993") if rig.kind=="eraser_cart" else Color("7fc5bd")
	var width: float=1.6 if boss else .72
	var height: float=1.2 if boss else .65
	var torso: Node3D=rig._joint(rig.body,"Torso",Vector3(0,height*.5+.32,0),[
		rig._cube(Vector3.ZERO,Vector3(width,height,width*.8),tint),
		rig._cube(Vector3(-width*.25,height*.18,-width*.415),Vector3(.13,.10,.035),DARK),
		rig._cube(Vector3(width*.25,height*.18,-width*.415),Vector3(.13,.10,.035),DARK)])
	_wheels(rig,width*.52,width*.25)
	var tool: Node3D=rig._joint(torso,"WorkArm",Vector3(0,height*.5+.20,-width*.25))
	if rig.kind=="boss_stamp_press":
		rig._geometry(tool,[rig._cube(Vector3(0,.2,0),Vector3(.24,.65,.24),DARK),rig._cube(Vector3(0,-.25,0),Vector3(1.15,.25,.9),RED),rig._cube(Vector3(0,-.4,0),Vector3(.88,.035,.65),PAPER)])
	elif coffee:
		rig._geometry(tool,[rig._cube(Vector3(0,0,-.50),Vector3(.27,.20,.72),DARK),rig._cube(Vector3(0,0,-.88),Vector3(.42,.32,.10),GOLD),rig._cube(Vector3(.48,.05,.08),Vector3(.20,.40,.20),PAPER)])
	else:
		rig._geometry(tool,[rig._cube(Vector3(0,-.10,-.24),Vector3(.18,.16,.48),DARK),rig._cube(Vector3(0,-.07,-.5),Vector3(.5,.24,.22),PAPER if rig.kind=="eraser_cart" else GOLD)])
	if boss:
		_weak_material(rig)
		rig.weak_point=rig._joint(torso,"WeakPoint",Vector3.ZERO)
		var at: Vector3=Vector3(0,0,-width*.445) if coffee else Vector3(width*.53,0,0)
		rig._geometry(rig.weak_point,[rig._cube(at,Vector3(.32,.35,.12) if coffee else Vector3(.12,.35,.4),GOLD)],rig.weak_material)
		rig._joint(torso,"ValveCover",at+Vector3(0,0,-.085) if coffee else at+Vector3(.085,0,0),[rig._cube(Vector3.ZERO,Vector3(.44,.46,.04) if coffee else Vector3(.04,.46,.5),tint.darkened(.25))])
		if not coffee:
			rig._geometry(rig.weak_point,[rig._cube(Vector3(-at.x,at.y,at.z),Vector3(.12,.35,.4),GOLD)],rig.weak_material)
			rig._joint(torso,"ValveCoverLeft",Vector3(-at.x-.085,at.y,at.z),[rig._cube(Vector3.ZERO,Vector3(.04,.46,.5),tint.darkened(.25))])

static func _shredder(rig) -> void:
	var torso: Node3D = rig._joint(rig.body, "Torso", Vector3(0,1.1,0), [
		rig._cube(Vector3.ZERO, Vector3(1.62,1.5,1.4), BLUE),
		rig._cube(Vector3(0,-.45,-.72), Vector3(1.4,.55,.07), DARK),
		rig._cube(Vector3(0,.765,0), Vector3(1.76,.07,1.48), DARK),
		rig._cube(Vector3(0,.81,-.08), Vector3(1.2,.03,.14), DARK),
		rig._cube(Vector3(.55,.46,-.73), Vector3(.16,.2,.06), RED)])
	for index in range(6):
		rig._geometry(torso, [rig._cube(Vector3(-.55+index*.22,-.44,-.765),Vector3(.07,.43,.035),PAPER)])
	_wheels(rig,.84,.47)
	rig._joint(torso,"FeedPaper",Vector3(0,.96,-.08),[
		rig._cube(Vector3(0,.23,0),Vector3(.92,.5,.04),PAPER),
		rig._cube(Vector3(0,.30,-.032),Vector3(.60,.035,.018),RED),
		rig._cube(Vector3(0,.17,-.032),Vector3(.60,.025,.018),DARK)])
	_weak_material(rig)
	rig.weak_point=rig._joint(torso,"WeakPoint",Vector3.ZERO)
	for side in [-1.0,1.0]:
		var suffix := "L" if side<0 else "R"
		rig._geometry(rig.weak_point,[rig._cube(Vector3(side*.87,.02,.10),Vector3(.13,.44,.5),GOLD)],rig.weak_material)
		rig._joint(torso,"MotorCover"+suffix,Vector3(side*.965,.02,.10),[
			rig._cube(Vector3.ZERO,Vector3(.035,.55,.62),BLUE.darkened(.15)),
			rig._cube(Vector3(side*.025,.02,0),Vector3(.022,.08,.35),DARK)])
	rig._joint(torso,"Teeth",Vector3(0,-.28,-.83),[
		rig._cube(Vector3(-.45,0,0),Vector3(.32,.12,.24),PAPER,Vector3(0,0,-.12)),
		rig._cube(Vector3(.45,0,0),Vector3(.32,.12,.24),PAPER,Vector3(0,0,.12))])

static func _printer(rig) -> void:
	var torso: Node3D = rig._joint(rig.body,"Torso",Vector3(0,1.03,0),[
		rig._cube(Vector3.ZERO,Vector3(1.76,1.28,1.4),PAPER),
		rig._cube(Vector3(0,-.28,-.735),Vector3(1.5,.20,.07),DARK),
		rig._cube(Vector3(.46,.37,-.73),Vector3(.46,.22,.05),BLUE),
		rig._cube(Vector3(-.49,.39,-.73),Vector3(.14,.14,.06),GOLD)])
	_wheels(rig,.9,.47)
	rig._joint(torso,"PrinterLid",Vector3(0,.70,.12),[
		rig._cube(Vector3.ZERO,Vector3(1.88,.13,1.55),BLUE),
		rig._cube(Vector3(0,.085,0),Vector3(1.35,.025,1.02),DARK)])
	rig._joint(torso,"OutputPaper",Vector3(0,-.25,-.82),[
		rig._cube(Vector3(0,0,-.19),Vector3(1.10,.035,.55),PAPER),
		rig._cube(Vector3(0,.035,-.27),Vector3(.7,.015,.035),RED)])
	_weak_material(rig)
	rig.weak_point=rig._joint(torso,"WeakPoint",Vector3(0,.04,.78))
	rig._geometry(rig.weak_point,[rig._cube(Vector3.ZERO,Vector3(.86,.46,.09),GOLD),rig._cube(Vector3(0,.02,.07),Vector3(.66,.05,.04),PAPER)],rig.weak_material)
	rig._joint(torso,"JamDoor",Vector3(0,.04,.88),[rig._cube(Vector3.ZERO,Vector3(1.02,.58,.04),BLUE),rig._cube(Vector3(0,.08,.04),Vector3(.32,.07,.05),DARK)])

static func _broadcast(rig) -> void:
	var torso: Node3D=rig._joint(rig.body,"Torso",Vector3(0,.68,0),[
		rig._cube(Vector3.ZERO,Vector3(.68,.8,.58),RED),
		rig._cube(Vector3(0,-.13,-.32),Vector3(.45,.23,.04),DARK),
		rig._cube(Vector3(.20,.21,-.32),Vector3(.10,.10,.04),GOLD)])
	_wheels(rig,.35,.20)
	rig._joint(torso,"Speaker",Vector3(0,.29,-.32),[
		rig._cube(Vector3(0,0,-.08),Vector3(.42,.30,.16),DARK),
		rig._cube(Vector3(0,0,-.20),Vector3(.60,.45,.08),GOLD),
		rig._cube(Vector3(0,0,-.25),Vector3(.40,.25,.035),DARK)])
	rig._joint(torso,"Beacon",Vector3(0,.50,0),[rig._cube(Vector3.ZERO,Vector3(.20,.19,.20),GOLD)])

static func _lobber(rig) -> void:
	var torso: Node3D=rig._joint(rig.body,"Torso",Vector3(0,.62,0),[
		rig._cube(Vector3.ZERO,Vector3(.72,.63,.61),BLUE),
		rig._cube(Vector3(-.19,.10,-.325),Vector3(.10,.08,.035),DARK),
		rig._cube(Vector3(.19,.10,-.325),Vector3(.10,.08,.035),DARK)])
	_wheels(rig,.37,.20)
	rig._joint(torso,"ThrowArm",Vector3(0,.40,.08),[
		rig._cube(Vector3(0,.06,-.25),Vector3(.17,.13,.65),RED),
		rig._cube(Vector3(0,.16,-.50),Vector3(.46,.24,.42),PAPER),
		rig._cube(Vector3(0,.16,-.725),Vector3(.15,.11,.018),DARK)])
	rig._joint(torso,"PaperRolls",Vector3(0,.04,.37),[
		rig._cube(Vector3(-.20,0,0),Vector3(.27,.44,.22),PAPER),
		rig._cube(Vector3(.20,0,0),Vector3(.27,.44,.22),PAPER)])

static func animate(rig, _delta: float=0.0) -> void:
	var phase: String=str(rig.state.get("state","CHASE"))
	var warning: float=rig._enemy_warning
	var attack: float=rig.strike_weight()
	var kind: String=str(rig.state.get("attackKind",""))
	var active: float=1.0 if phase in ["ATTACK","CHARGE"] else 0.0
	var exposed: float=1.0 if bool(rig.state.get("weak",false)) or phase=="WEAK" else 0.0
	var weight: float=rig.move_weight*(1-warning*.8)*(1-exposed*.8)
	for side in ["L","R"]:
		for index in range(2):
			rig.joints["Wheel"+side+str(index)].rotation.x=sin(rig.stride)*weight*.12
	rig.joints.Torso.rotation.x=-warning*.18+attack*.24
	rig.joints.Torso.position.y-=attack*.13
	match rig.kind:
		"boss_shredder":
			rig.joints.FeedPaper.position.y-=warning*.16+attack*.19
			rig.joints.FeedPaper.rotation.z=sin(rig.clock*8)*warning*.05
			rig.joints.Teeth.position.z-=attack*.42
			rig.joints.Teeth.rotation.x=sin(rig.clock*26)*minf(1,warning+active)*(.12+warning*.12)
			if kind=="shredder_fan":
				rig.joints.Torso.rotation.y=-warning*.45+attack*.8
			else:
				rig.joints.Torso.rotation.x=-warning*.28
			rig.joints.Torso.rotation.y+=sin(rig._phase("attack")*PI)*attack*.22
			if phase=="CHARGE": rig.joints.Torso.rotation.x=-.19
			for side in ["L","R"]:
				var sign_value: float=-1.0 if side=="L" else 1.0
				rig.joints["MotorCover"+side].position.y+=exposed*.47
				rig.joints["MotorCover"+side].rotation.z=sign_value*exposed*.20
		"boss_printer":
			rig.joints.OutputPaper.position.z-=warning*.18+attack*.85
			rig.joints.PrinterLid.rotation.x=-warning*.08-exposed*.15
			rig.joints.JamDoor.rotation.x=exposed*1.25
			rig.joints.JamDoor.position.y-=exposed*.24
			rig.joints.Torso.rotation.z=sin(rig.clock*9)*exposed*.045
			if kind=="printer_wave":
				rig.joints.OutputPaper.scale.z=1+warning*.7+active*1.1
				rig.joints.OutputPaper.rotation.x=-warning*.3+active*.35
			elif kind=="printer_shift":
				rig.joints.Torso.rotation.z=warning*.12+active*.16
		"broadcast_cart":
			rig.joints.Speaker.rotation.x=-warning*.28+attack*.15
			rig.joints.Beacon.scale=Vector3.ONE*(1+warning*.35)
		"paper_lobber":
			rig.joints.ThrowArm.rotation.x=warning*.85-attack*1.0
			rig.joints.PaperRolls.rotation.z=sin(rig.clock*3)*warning*.08
		"boss_stamp_press":
			rig.joints.WorkArm.position.y+=pow(warning,.7)*1.1-attack*.85
			rig.joints.WorkArm.rotation.y=warning*.14
			rig.joints.Torso.position.y-=attack*.16
			rig.joints.ValveCover.position.y+=exposed*.5
			rig.joints.ValveCoverLeft.position.y+=exposed*.5
		"boss_coffee_boiler":
			if kind=="coffee_line":
				rig.joints.WorkArm.rotation.x=-warning*.55+attack*.26
				rig.joints.WorkArm.position.z-=active*.28
			elif kind=="coffee_ring":
				var strike_age: float=maxf(0,float(rig.state.get("serverTime",0))+rig.clock-rig.state_sample_clock-float(rig.state.get("attackActionAt",0)))
				rig.joints.WorkArm.rotation.y=warning*1.4+active*(1.4+minf(strike_age,.8)*TAU/.8)
				rig.joints.Torso.scale=Vector3(1+warning*.12,1-warning*.07,1+warning*.12)
			else:
				rig.joints.WorkArm.rotation.x=warning*.75-attack*.3
				rig.joints.Torso.position.y+=warning*.12-attack*.18
			rig.joints.ValveCover.position.x+=exposed*.55
		"eraser_cart", "battery_mite":
			rig.joints.WorkArm.rotation.x=-warning*.4+attack*.5
	if rig.weak_point!=null:
		var overtime: bool=int(rig.state.get("combatPhase",1))>=2
		rig.weak_material.emission_energy_multiplier=.25+exposed*(.65+sin(rig.clock*4)*.10)+(.16 if overtime and exposed<=0 else 0.0)
		rig.weak_material.albedo_color=GOLD if exposed>0 else RED if overtime else GOLD.darkened(.3)
