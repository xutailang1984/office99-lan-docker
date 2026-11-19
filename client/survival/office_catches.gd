extends RefCounted

const DayCatches=preload("res://survival/office_day_catches.gd")
const KINDS := ["spring_shrimp","ink_cuttle","manager_koi","clip_crab","receipt_ray","staple_squid","seal_puffer"]
const DARK := Color("283b51")
const PAPER := Color("f3e3bb")
const GOLD := Color("e7b74e")

static func build(rig) -> void:
	if rig.kind in DayCatches.KINDS:
		DayCatches.build(rig)
		return
	var shrimp: bool = rig.kind=="spring_shrimp"
	var koi: bool = rig.kind=="manager_koi"
	var color: Color = Color("eb8770") if shrimp else Color("e5a243") if koi else Color("9476c1")
	var torso: Node3D = rig._joint(rig.body,"Torso",Vector3(0,.65 if koi else .45,0),[
		rig._cube(Vector3.ZERO,Vector3(1.2,.7,.85) if koi else Vector3(.55,.46,.68),color),
		rig._cube(Vector3(-.3 if koi else -.15,.12,-.44 if koi else -.35),Vector3(.12,.11,.035),PAPER),
		rig._cube(Vector3(.3 if koi else .15,.12,-.44 if koi else -.35),Vector3(.12,.11,.035),PAPER),
		rig._cube(Vector3(-.3 if koi else -.15,.12,-.463 if koi else -.374),Vector3(.055,.055,.02),DARK),
		rig._cube(Vector3(.3 if koi else .15,.12,-.463 if koi else -.374),Vector3(.055,.055,.02),DARK)])
	if shrimp:
		for side in [-1.0,1.0]:
			var suffix := "L" if side<0 else "R"
			rig._joint(torso,"Antenna"+suffix,Vector3(side*.20,.22,-.27),[rig._cube(Vector3(side*.08,.17,-.08),Vector3(.045,.35,.045),GOLD,Vector3(-.35,0,-side*.4))])
			for i in range(3):
				rig._joint(torso,"Leg"+suffix+str(i),Vector3(side*.28,-.17,-.23+i*.22),[rig._cube(Vector3(side*.10,-.05,0),Vector3(.23,.07,.075),DARK,Vector3(0,0,side*.3))])
		var tail: Node3D=rig._joint(torso,"Tail",Vector3(0,-.01,.35))
		for i in range(3): rig._geometry(tail,[rig._cube(Vector3(0,i*.09,i*.14),Vector3(.39-i*.065,.12,.15),PAPER if i==1 else color)])
	elif koi:
		rig._geometry(torso,[rig._cube(Vector3(0,.10,-.455),Vector3(.15,.26,.04),DARK),rig._cube(Vector3(0,-.15,-.49),Vector3(.19,.26,.04),GOLD)])
		for side in [-1.0,1.0]:
			rig._joint(torso,"Fin"+("L" if side<0 else "R"),Vector3(side*.62,-.05,.10),[rig._cube(Vector3(side*.14,0,0),Vector3(.30,.08,.44),PAPER)])
			rig._geometry(torso,[rig._cube(Vector3(side*.23,.36,.08),Vector3(.24,.04,.34),PAPER)])
		rig._joint(torso,"Tail",Vector3(0,0,.44),[rig._cube(Vector3(0,0,.23),Vector3(.11,.64,.46),color.darkened(.15))])
	else:
		rig._geometry(torso,[rig._cube(Vector3(0,.32,.04),Vector3(.40,.23,.46),DARK),rig._cube(Vector3(0,.445,.04),Vector3(.24,.04,.27),color.lightened(.25))])
		for i in range(6):
			var angle := i*TAU/6.0
			var limb: Node3D=rig._joint(torso,"Tentacle"+str(i),Vector3(sin(angle)*.23,-.24,cos(angle)*.23))
			limb.rotation.y=angle
			rig._geometry(limb,[rig._cube(Vector3(0,-.035,.12),Vector3(.11,.13,.30),color),rig._cube(Vector3(0,-.07,.30),Vector3(.105,.08,.12),PAPER)])
		rig._joint(torso,"Nozzle",Vector3(0,-.10,-.37),[rig._cube(Vector3(0,0,-.08),Vector3(.18,.13,.20),DARK)])

static func animate(rig, delta: float = 0.0) -> void:
	if rig.kind in DayCatches.KINDS:
		DayCatches.animate(rig,delta)
		return
	var warning: float=rig._enemy_warning
	var weight: float=rig.move_weight*(1-warning*.8)*(1-rig._enemy_stun*.9)
	var charge: bool=str(rig.state.get("state",""))=="CHARGE"
	var attack: float=rig._pulse("attack")
	var remaining: float=maxf(0,float(rig.state.get("phaseRemaining",0))-(rig.clock-rig.state_sample_clock))
	var hop: float=sin(clampf(remaining/.45,0,1)*PI) if charge else 0.0
	# Snapshot timing only chooses the target pose. The local render clock keeps it continuous.
	rig.catch_hop=move_toward(rig.catch_hop,hop,maxf(0,delta)*9.0)
	rig.joints.Torso.rotation.x=-warning*.22+attack*.20
	if rig.kind=="spring_shrimp":
		rig.joints.Torso.position.y-=warning*.12
		rig.body.position.y+=rig.catch_hop*.24+absf(sin(rig.stride))*weight*.045*(1-rig.catch_hop)
		rig.joints.Tail.rotation.x=warning*.6-attack*.8
		for side in ["L","R"]:
			rig.joints["Antenna"+side].rotation.x=-warning*.3
			for i in range(3): rig.joints["Leg"+side+str(i)].rotation.y=sin(rig.stride+i)*weight*.3
	elif rig.kind=="manager_koi":
		rig.joints.Tail.rotation.y=sin(rig.clock*3.2)*(.10+weight*.30)+attack*.30
		for side in ["L","R"]: rig.joints["Fin"+side].rotation.z=(1 if side=="L" else -1)*(.15+sin(rig.clock*2.5)*.1+warning*.4)
		rig.body.position.y+=rig.catch_hop*.17+absf(sin(rig.stride))*weight*.025*(1-rig.catch_hop)
	else:
		rig.joints.Torso.scale=Vector3(1+warning*.18,1-warning*.1,1+warning*.1)
		rig.joints.Nozzle.position.z-=attack*.15
		for i in range(6):
			rig.joints["Tentacle"+str(i)].rotation.x=sin(rig.stride+i*.9)*weight*.20-warning*.25
			rig.joints["Tentacle"+str(i)].rotation.y=i*TAU/6.0
