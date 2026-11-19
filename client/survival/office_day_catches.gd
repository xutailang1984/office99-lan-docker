extends RefCounted
const KINDS := ["clip_crab","receipt_ray","staple_squid","seal_puffer"]
const INK := Color("294652")
const PAPER := Color("eee9cf")
static func build(rig) -> void:
	var id: String=rig.kind
	var color: Color={"clip_crab":Color("72b8c5"),"receipt_ray":PAPER,"staple_squid":Color("da9883"),"seal_puffer":Color("b2a0d5")}[id]
	var torso: Node3D=rig._joint(rig.body,"Torso",Vector3(0,.43,0),[rig._cube(Vector3.ZERO,Vector3(.6,.4,.64),color)])
	for side in [-1.0,1.0]:
		rig._geometry(torso,[rig._cube(Vector3(side*.17,.1,-.336),Vector3(.08,.09,.025),INK)])
	if id=="clip_crab":
		for side in [-1.0,1.0]:
			var suffix: String="L" if side<0 else "R"
			rig._joint(torso,"Claw"+suffix,Vector3(side*.35,.05,-.15),[rig._cube(Vector3(side*.12,0,-.09),Vector3(.28,.17,.27),INK),rig._cube(Vector3(side*.12,.08,-.16),Vector3(.20,.07,.28),PAPER)])
			for i in range(3):rig._joint(torso,"Leg"+suffix+str(i),Vector3(side*.3,-.18,-.15+i*.16),[rig._cube(Vector3(side*.09,-.04,0),Vector3(.22,.06,.07),INK)])
	elif id=="receipt_ray":
		for side in [-1.0,1.0]:rig._joint(torso,"Fin"+("L" if side<0 else "R"),Vector3(side*.34,-.02,0),[rig._cube(Vector3(side*.16,0,0),Vector3(.40,.055,.6),color),rig._cube(Vector3(side*.16,.037,.08),Vector3(.2,.018,.06),INK)])
		rig._joint(torso,"Tail",Vector3(0,0,.33),[rig._cube(Vector3(0,0,.28),Vector3(.065,.07,.55),INK)])
		for i in range(3):rig._geometry(torso,[rig._cube(Vector3(0,.212,-.15+i*.15),Vector3(.28,.022,.035),INK)])
	elif id=="staple_squid":
		rig._geometry(torso,[rig._cube(Vector3(0,.26,.04),Vector3(.4,.16,.46),INK),rig._cube(Vector3(0,.356,.04),Vector3(.30,.025,.30),PAPER)])
		for i in range(4):rig._joint(torso,"Tentacle"+str(i),Vector3(-.24+i*.16,-.2,0),[rig._cube(Vector3(0,-.12,.07),Vector3(.10,.24,.18),color),rig._cube(Vector3(0,-.24,-.02),Vector3(.115,.065,.20),PAPER)])
	else:
		rig._geometry(torso,[rig._cube(Vector3(0,.26,0),Vector3(.43,.12,.43),PAPER)])
		for side in [-1.0,1.0]:rig._joint(torso,"Fin"+("L" if side<0 else "R"),Vector3(side*.31,0,.06),[rig._cube(Vector3(side*.1,0,0),Vector3(.22,.07,.32),PAPER)])
		rig._joint(torso,"Stamp",Vector3(0,-.12,-.34),[rig._cube(Vector3(0,0,-.09),Vector3(.28,.16,.19),INK),rig._cube(Vector3(0,0,-.194),Vector3(.21,.10,.022),Color("e89a88"))])
static func animate(rig, _delta: float=0.0) -> void:
	var warning: float=smoothstep(0,1,rig._enemy_warning)
	var move: float=rig.move_weight*(1-rig._enemy_stun*.9)*(1-warning*.8)
	var attack: float=rig._pulse("attack")
	match rig.kind:
		"clip_crab":
			for side in ["L","R"]:
				rig.joints["Claw"+side].rotation.y=(1 if side=="L" else -1)*(warning*.5-attack*.8)
				for i in range(3):rig.joints["Leg"+side+str(i)].rotation.y=sin(rig.stride+i)*move*.25
		"receipt_ray":
			for side in ["L","R"]:rig.joints["Fin"+side].rotation.z=(1 if side=="L" else -1)*sin(rig.clock*3)*(.08+move*.16)
			rig.joints.Tail.rotation.y=sin(rig.clock*2.7)*(.08+move*.25)
		"staple_squid":
			for i in range(4):rig.joints["Tentacle"+str(i)].rotation.x=sin(rig.stride+i)*move*.22-warning*.4+attack*.5
		"seal_puffer":
			rig.joints.Torso.scale=Vector3.ONE*(1+warning*.22)
			rig.joints.Stamp.position.z-=attack*.15
			for side in ["L","R"]:rig.joints["Fin"+side].rotation.z=(1 if side=="L" else -1)*sin(rig.clock*2)*.13
