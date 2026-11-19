extends RefCounted

# Original voxel silhouettes. All movement stays on joints; server owns hits.
const Catches = preload("res://survival/office_catches.gd")
const KINDS := ["clip_crab","receipt_ray","staple_squid","seal_puffer","spring_shrimp","ink_cuttle","manager_koi","courier", "shield_bug", "jammer", "medic_bug", "breaker", "spore_slug", "bubble_puffer", "lantern_fish", "paper_drone", "stamp_bat", "archive_guard"]
const DARK := Color("263e4c")
const PAPER := Color("f3e3bb")
const GOLD := Color("e7b74e")
const RED := Color("d9745c")
const MINT := Color("83c9ad")

static func handles(id: String) -> bool:
	return id in KINDS

static func build(rig) -> void:
	if rig.kind in Catches.KINDS:
		Catches.build(rig)
		return
	var id: String = rig.kind
	if id in ["paper_drone","stamp_bat"]:
		build_flyer(rig)
		return
	if id=="archive_guard":
		build_archive(rig)
		return
	var color: Color = {"courier":RED,"shield_bug":Color("6c91a5"),"jammer":Color("9981be"),"medic_bug":MINT,"breaker":Color("aa865e"),"spore_slug":GOLD,"bubble_puffer":Color("b7d2c2"),"lantern_fish":Color("557d91")}[id]
	var height := 0.70 if id in ["courier","shield_bug","jammer"] else 0.40
	var torso: Node3D = rig._joint(rig.body,"Torso",Vector3(0,height,0),[
		rig._cube(Vector3.ZERO,Vector3(0.64,0.56 if height>0.5 else 0.38,0.64),color),
		rig._cube(Vector3(-0.17,0.10,-0.33),Vector3(0.10,0.065,0.025),DARK),
		rig._cube(Vector3(0.17,0.10,-0.33),Vector3(0.10,0.065,0.025),DARK)])
	if id in ["bubble_puffer","lantern_fish","spore_slug"]:
		for side in [-1.0,1.0]:
			rig._joint(torso,"Fin"+("L" if side<0 else "R"),Vector3(side*0.32,-0.03,0.1),[rig._cube(Vector3(side*0.10,0,0),Vector3(0.22,0.06,0.30),color.lightened(0.2))])
		rig._joint(torso,"Tail",Vector3(0,0,0.35),[rig._cube(Vector3(0,0,0.16),Vector3(0.08,0.32,0.32),color.darkened(0.2))])
	else:
		for side in [-1.0,1.0]:
			for i in range(2):
				rig._joint(rig.body,"Foot"+("L" if side<0 else "R")+str(i),Vector3(side*0.29,height*0.48,-0.20+i*0.42),[
					rig._cube(Vector3(0,-height*0.21,0),Vector3(0.17,height*0.56,0.18),DARK),
					rig._cube(Vector3(side*0.04,-height*0.38,-0.03),Vector3(0.26,0.12,0.32),color)])
	match id:
		"courier":
			rig._joint(torso,"Parcel",Vector3(0,0.33,0.09),[
				rig._cube(Vector3(0,0.12,0),Vector3(0.67,0.28,0.55),Color("bc9263")),
				rig._cube(Vector3(0,0.264,0),Vector3(0.14,0.025,0.56),PAPER),
				rig._cube(Vector3(0.21,0.12,-0.283),Vector3(0.17,0.14,0.022),PAPER)])
			rig._joint(torso,"Badge",Vector3(0,-0.1,-0.35),[rig._cube(Vector3.ZERO,Vector3(0.27,0.16,0.04),GOLD)])
		"shield_bug":
			rig._joint(torso,"Shield",Vector3(0,0,-0.41),[
				rig._cube(Vector3.ZERO,Vector3(0.94,1.03,0.16),color.darkened(0.2)),
				rig._cube(Vector3(0,0,-0.09),Vector3(0.75,0.79,0.035),PAPER),
				rig._cube(Vector3(0,0.29,-0.115),Vector3(0.28,0.07,0.04),DARK),
				rig._cube(Vector3(0,-0.29,-0.115),Vector3(0.28,0.07,0.04),DARK)])
			rig._geometry(torso,[rig._cube(Vector3(0,0,0.35),Vector3(0.32,0.29,0.04),RED)])
		"jammer":
			for side in [-1.0,1.0]:
				rig._joint(torso,"Antenna"+("L" if side<0 else "R"),Vector3(side*0.25,0.28,0.06),[
					rig._cube(Vector3(0,0.27,0),Vector3(0.055,0.56,0.055),DARK),
					rig._cube(Vector3(0,0.55,0),Vector3(0.17,0.11,0.17),GOLD)])
			rig._joint(torso,"Screen",Vector3(0,-0.08,-0.36),[rig._cube(Vector3.ZERO,Vector3(0.31,0.17,0.05),MINT)])
		"medic_bug":
			rig._joint(torso,"Medkit",Vector3(0,0.24,0.1),[
				rig._cube(Vector3.ZERO,Vector3(0.70,0.35,0.49),PAPER),
				rig._cube(Vector3(0,0.19,0),Vector3(0.09,0.025,0.30),RED),
				rig._cube(Vector3(0,0.19,0),Vector3(0.30,0.025,0.09),RED)])
			rig._joint(torso,"Nozzle",Vector3(0,-0.04,-0.42),[rig._cube(Vector3(0,0,-0.10),Vector3(0.14,0.14,0.35),MINT)])
		"breaker":
			rig._joint(torso,"Drill",Vector3(0,0,-0.34),[
				rig._cube(Vector3(0,0,-0.12),Vector3(0.35,0.30,0.25),DARK),
				rig._cube(Vector3(0,0,-0.31),Vector3(0.23,0.21,0.21),PAPER),
				rig._cube(Vector3(0,0,-0.47),Vector3(0.10,0.10,0.17),GOLD)])
			rig._joint(torso,"Helmet",Vector3(0,0.28,0),[rig._cube(Vector3.ZERO,Vector3(0.76,0.17,0.66),GOLD)])
		"spore_slug":
			for i in range(3):
				rig._joint(torso,"Note"+str(i),Vector3(-0.20+i*0.20,0.22,0.06+i*0.02),[rig._cube(Vector3(0,0.13,0),Vector3(0.18,0.26,0.09),PAPER if i%2==0 else RED)])
		"bubble_puffer":
			for side in [-1.0,1.0]:
				rig._geometry(torso,[rig._cube(Vector3(side*0.38,0.145,0),Vector3(0.16,0.12,0.14),PAPER),rig._cube(Vector3(side*0.18,0.33,0.07),Vector3(0.10,0.16,0.12),PAPER)])
		"lantern_fish":
			rig._joint(torso,"Lamp",Vector3(0,0.2,-0.16),[
				rig._cube(Vector3(0,0.19,0),Vector3(0.055,0.39,0.055),DARK),
				rig._cube(Vector3(0,0.36,-0.13),Vector3(0.055,0.055,0.27),DARK),
				rig._cube(Vector3(0,0.29,-0.27),Vector3(0.21,0.22,0.19),GOLD)])

static func animate(rig, delta: float = 0.0) -> void:
	if rig.kind in Catches.KINDS:
		Catches.animate(rig,delta)
		return
	var warning: float = smoothstep(0,1,rig._enemy_warning)
	var attack: float = rig.strike_weight()
	var stride: float = rig.stride
	var weight: float = rig.move_weight*(1-rig._enemy_warning*.8)*(1-rig._enemy_stun*.9)*(1-rig._enemy_recover*.7)
	var phase: String = str(rig.state.get("state",""))
	if rig.kind in ["paper_drone","stamp_bat"]:
		rig.body.position.y+=sin(rig.clock*3.2)*.055
		var flap: float=sin(rig.clock*6)*(.16 if rig.kind=="paper_drone" else .38)*(1-rig._enemy_stun*.75)
		for side in ["L","R"]:
			rig.joints["Wing"+side].rotation.z=(1 if side=="L" else -1)*(flap+warning*.34)
		rig.joints.Torso.rotation.x=-warning*.23+attack*.27
		if phase=="CHARGE": rig.joints.Torso.rotation.x=-.4
		if rig.joints.has("Stamp"): rig.joints.Stamp.position.y-=attack*.18
		if rig.joints.has("Nozzle"): rig.joints.Nozzle.position.z+=attack*.10
		return
	if rig.kind=="archive_guard":
		for side in ["L","R"]:
			rig.joints["Track"+side].rotation.x=sin(stride)*weight*.06
		rig.joints.Torso.rotation.x=-warning*.08+attack*.09
		rig.joints.Barrels.position.z+=attack*.20
		rig.joints.Lid.rotation.x=-warning*.30
		return
	rig.body.position.y += absf(sin(stride))*weight*0.035
	rig.joints.Torso.rotation.x = -warning*0.22+attack*0.34
	rig.joints.Torso.position.z -= attack*.17
	for side in ["L","R"]:
		var sign_value := -1.0 if side=="L" else 1.0
		for i in range(2):
			var key: String = "Foot"+side+str(i)
			if rig.joints.has(key): rig.joints[key].rotation.x = sin(stride+i*PI)*sign_value*weight*0.60
		if rig.joints.has("Fin"+side): rig.joints["Fin"+side].rotation.z = sign_value*(0.15+sin(stride)*0.25)
	if rig.joints.has("Tail"): rig.joints.Tail.rotation.y = sin(stride)*0.24
	match rig.kind:
		"courier":
			rig.joints.Torso.rotation.x += -0.38 if phase=="CHARGE" else 0.0
			rig.joints.Torso.position.y-=warning*.16
			rig.joints.Torso.position.z+=warning*.16
			rig.joints.Parcel.rotation.x = warning*.48
		"shield_bug":
			rig.joints.Shield.rotation.x = -warning*0.15+attack*0.34
			rig.joints.Shield.position.z -= attack*0.36
			rig.joints.Torso.rotation.y=warning*.25-attack*.3
			rig.joints.Shield.position.x+=warning*.12-attack*.15
		"jammer":
			for side in ["L","R"]: rig.joints["Antenna"+side].rotation.z = (1 if side=="L" else -1)*(0.16+warning*0.18)
			rig.joints.Screen.scale = Vector3.ONE*(1+warning*0.18)
		"medic_bug":
			rig.joints.Medkit.position.y += warning*0.12
			rig.joints.Nozzle.rotation.x = -warning*0.25
		"breaker":
			# Integrate the instantaneous rate; changing attack state never rephases elapsed time.
			rig._breaker_drill_phase = fposmod(rig._breaker_drill_phase+maxf(delta,0.0)*(18.0 if attack>0 else 3.0+warning*11),TAU)
			rig.joints.Drill.rotation.z = rig._breaker_drill_phase
			rig.joints.Drill.position.z -= attack*0.43
		"spore_slug":
			rig.joints.Torso.scale=Vector3(1+warning*.18,1-warning*.28,1+warning*.12)
			rig.joints.Torso.position.y+=attack*.18
			for i in range(3): rig.joints["Note"+str(i)].rotation.z = sin(rig.clock*2+i)*0.12+warning*(i-1)*0.35
		"bubble_puffer":
			rig.joints.Torso.scale = Vector3.ONE*(1+warning*0.45+attack*0.2)
		"lantern_fish":
			rig.joints.Lamp.rotation.x = sin(rig.clock*2)*0.08-warning*0.35
			rig.joints.Lamp.scale = Vector3.ONE*(1+warning*0.22)

static func build_flyer(rig) -> void:
	var paper: bool=rig.kind=="paper_drone"
	var color: Color=PAPER if paper else RED
	var torso: Node3D=rig._joint(rig.body,"Torso",Vector3(0,.48,0),[
		rig._cube(Vector3.ZERO,Vector3(.38,.25,.64),color),
		rig._cube(Vector3(0,.08,-.30),Vector3(.25,.10,.06),DARK),
		rig._cube(Vector3(0,.10,-.34),Vector3(.09,.05,.02),GOLD)])
	for side in [-1.0,1.0]:
		var letter := "L" if side<0 else "R"
		rig._joint(torso,"Wing"+letter,Vector3(side*.18,.02,0),[
			rig._cube(Vector3(side*.23,0,.05),Vector3(.52,.055,.48),color,Vector3(0,side*.32,side*.10)),
			rig._cube(Vector3(side*.51,.03,.12),Vector3(.20,.045,.31),GOLD if paper else DARK,Vector3(0,side*.52,side*.18))])
	if paper:
		rig._joint(torso,"Nozzle",Vector3(0,-.07,-.35),[rig._cube(Vector3(0,0,-.10),Vector3(.15,.12,.27),Color("659dba"))])
	else:
		rig._joint(torso,"Stamp",Vector3(0,-.19,0),[
			rig._cube(Vector3.ZERO,Vector3(.15,.24,.15),DARK),
			rig._cube(Vector3(0,-.16,0),Vector3(.46,.11,.36),RED),
			rig._cube(Vector3(0,-.225,0),Vector3(.36,.02,.26),PAPER)])

static func build_archive(rig) -> void:
	var torso: Node3D=rig._joint(rig.body,"Torso",Vector3(0,.77,0),[
		rig._cube(Vector3.ZERO,Vector3(.93,.81,.67),Color("698395")),
		rig._cube(Vector3(0,.14,-.36),Vector3(.64,.28,.07),DARK),
		rig._cube(Vector3(0,.19,-.40),Vector3(.46,.08,.015),GOLD),
		rig._cube(Vector3(0,-.20,.36),Vector3(.60,.23,.04),RED)])
	for side in [-1.0,1.0]:
		rig._joint(rig.body,"Track"+("L" if side<0 else "R"),Vector3(side*.44,.23,0),[
			rig._cube(Vector3.ZERO,Vector3(.26,.37,.84),DARK),
			rig._cube(Vector3(0,0,-.23),Vector3(.28,.16,.15),PAPER),
			rig._cube(Vector3(0,0,.23),Vector3(.28,.16,.15),PAPER)])
	var barrels: Array=[]
	for i in range(3): barrels.append(rig._cube(Vector3((i-1)*.21,0,-.15),Vector3(.14,.17,.39),GOLD if i==1 else PAPER))
	rig._joint(torso,"Barrels",Vector3(0,-.12,-.43),barrels)
	rig._joint(torso,"Lid",Vector3(0,.46,.22),[
		rig._cube(Vector3(0,0,-.21),Vector3(.96,.10,.68),Color("39596b")),
		rig._cube(Vector3(0,.08,-.21),Vector3(.55,.06,.40),PAPER)])
