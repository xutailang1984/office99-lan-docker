extends Node3D

# MOBA-only silhouettes and action poses. Does not change the PVE fisherman.
const View = preload("res://moba/map_view.gd")
const INK := Color("20343e")
const PAPER := Color("f3e8cf")
const SKIN := Color("dab18d")
var hero := "stapler"
var accent := Color("efc44c")
var body: Node3D
var torso: Node3D
var head: Node3D
var left: Node3D
var right: Node3D
var leg_l: Node3D
var leg_r: Node3D
var prop: Node3D
var stamp_grip: Node3D
var projector: Node3D
var projector_stands: Array[Node3D] = []
var ornaments: Array[Node3D] = []
var state: Dictionary = {}
var server_clock := 0.0
var sample_clock := 0.0
var clock := 0.0
var hit_age := 10.0
var status_root: Node3D
var buff_root: Node3D
var stun_root: Node3D
var ink_root: Node3D
var shield_root: Node3D
var guard_panel: Node3D
var root_mark: Node3D
var silence_mark: Node3D
var team_color := Color("62c1e2")

func part(parent: Node3D, at: Vector3) -> Node3D:
	var n := Node3D.new()
	parent.add_child(n)
	n.position=at
	return n

func block(parent: Node3D, at: Vector3, size: Vector3, color: Color, glow := false) -> void:
	View.box(parent,at,size,color,glow)

func setup(id: String, own_team: int, hero_color: Color) -> void:
	hero=id
	accent=hero_color
	team_color=View.BLUE if own_team==0 else View.RED
	body=part(self,Vector3.ZERO)
	var heavy:=hero in ["guardian","custodian","mechanic"]
	torso=part(body,Vector3(0,1.12,0))
	var torso_size:=Vector3(1.2,1.18,.74) if heavy else Vector3(.72,.91,.47)
	block(torso,Vector3.ZERO,torso_size,accent if hero!="printer" else PAPER)
	head=part(body,Vector3(0,2.02 if heavy else 1.92,0))
	block(head,Vector3.ZERO,Vector3(.5,.48,.48),SKIN)
	block(head,Vector3(0,.02,-.255),Vector3(.34,.08,.035),INK)
	left=part(body,Vector3(-.74 if heavy else -.5,1.48,0))
	right=part(body,Vector3(.74 if heavy else .5,1.48,0))
	for arm in [left,right]:
		block(arm,Vector3(0,-.25,0),Vector3(.3 if heavy else .23,.62,.3 if heavy else .25),accent)
		block(arm,Vector3(0,-.59,0),Vector3(.32 if heavy else .24,.23,.28),PAPER if hero in ["guardian","printer"] else SKIN)
	leg_l=part(body,Vector3(-.28 if heavy else -.2,.65,0))
	leg_r=part(body,Vector3(.28 if heavy else .2,.65,0))
	for leg in [leg_l,leg_r]:
		block(leg,Vector3(0,-.22,0),Vector3(.36 if heavy else .25,.56,.3),INK)
		block(leg,Vector3(0,-.54,-.08),Vector3(.42 if heavy else .29,.2,.48),INK.lightened(.08))
	prop=part(right,Vector3(0,-.55,-.3))
	match hero:
		"stapler":
			block(head,Vector3(0,.26,.01),Vector3(.7,.13,.64),INK)
			block(head,Vector3(0,.22,-.33),Vector3(.7,.06,.3),accent)
			block(torso,Vector3(0,.1,-.26),Vector3(.19,.66,.07),PAPER)
			block(prop,Vector3(0,.06,-.45),Vector3(.38,.24,1.28),accent)
			block(prop,Vector3(0,-.13,-.47),Vector3(.26,.12,1.1),INK)
			block(prop,Vector3(0,.17,-.87),Vector3(.37,.12,.22),PAPER)
			block(prop,Vector3(0,.03,-1.1),Vector3(.29,.11,.1),INK)
			block(prop,Vector3(0,.04,-.75),Vector3(1.7,.15,.2),PAPER)
			View.beam(prop,Vector3(-.85,.1,-.75),Vector3(0,.1,-.1),INK,.04)
			View.beam(prop,Vector3(.85,.1,-.75),Vector3(0,.1,-.1),INK,.04)
		"courier":
			block(head,Vector3(0,.21,0),Vector3(.61,.23,.57),accent)
			block(head,Vector3(0,.04,-.29),Vector3(.53,.16,.1),INK)
			block(torso,Vector3(0,0,.42),Vector3(.88,.9,.4),Color("926347"))
			block(torso,Vector3(0,0,.65),Vector3(.16,.9,.06),PAPER)
			for i in range(3):
				var scarf:=part(torso,Vector3(.17,-.08-i*.15,.48+i*.23))
				block(scarf,Vector3.ZERO,Vector3(.25,.09,.35),accent)
				ornaments.append(scarf)
			block(prop,Vector3(0,.08,-.32),Vector3(.13,.12,.8),PAPER)
			block(prop,Vector3(0,.08,.02),Vector3(.32,.18,.18),INK)
			block(left,Vector3(0,-.55,-.2),Vector3(.35,.3,.5),INK)
		"printer":
			# Both hands and the press share a pivot so the grip stays together on impact.
			torso.position.y = 1.01
			head.position.y = 1.68
			block(head,Vector3(0,.29,0),Vector3(.65,.16,.63),accent)
			block(torso,Vector3(0,-.30,0),Vector3(1.05,.30,.65),accent)
			stamp_grip = part(body, Vector3(0,1.40,0))
			left.reparent(stamp_grip, false)
			right.reparent(stamp_grip, false)
			left.position = Vector3(-.48,0,0)
			right.position = Vector3(.48,0,0)
			# A broad, layered stamp foot and a free-standing bridge handle.
			block(stamp_grip,Vector3(0,-.70,-.78),Vector3(1.65,.20,1.08),INK)
			block(stamp_grip,Vector3(0,-.52,-.78),Vector3(1.53,.18,1.00),Color("bb475c"))
			for side in [-1,1]:
				block(stamp_grip,Vector3(side*.54,-.28,-.66),Vector3(.13,.37,.22),accent)
			block(stamp_grip,Vector3(0,-.12,-.66),Vector3(1.24,.18,.22),PAPER)
		"guardian":
			block(head,Vector3(0,.2,.02),Vector3(.7,.26,.63),INK)
			for y in [-.3,.1,.5]:
				block(torso,Vector3(0,y,-.4),Vector3(.88,.3,.08),INK.lightened(.15))
				block(torso,Vector3(0,y,-.47),Vector3(.26,.05,.07),PAPER)
			block(left,Vector3(-.13,-.25,-.27),Vector3(.77,1.62,.34),accent)
			block(left,Vector3(-.13,-.25,-.46),Vector3(.57,1.34,.05),PAPER)
			block(left,Vector3(-.13,-.25,-.5),Vector3(.17,.94,.04),accent)
			block(prop,Vector3(0,-.04,-.08),Vector3(.56,.55,.63),INK)
			block(prop,Vector3(0,-.04,-.42),Vector3(.48,.41,.08),PAPER)
		"barista":
			block(torso,Vector3(0,-.12,-.26),Vector3(.58,.87,.08),PAPER)
			block(torso,Vector3(0,-.18,-.32),Vector3(.32,.24,.06),accent)
			block(head,Vector3(0,.28,0),Vector3(.64,.18,.62),PAPER)
			block(head,Vector3(0,.46,0),Vector3(.46,.23,.45),PAPER)
			block(torso,Vector3(0,.13,.39),Vector3(.6,.79,.35),Color("684d43"))
			block(prop,Vector3(0,.1,-.15),Vector3(.35,.39,.35),PAPER)
			block(prop,Vector3(.24,.11,-.15),Vector3(.13,.26,.2),accent)
			block(left,Vector3(0,-.49,-.25),Vector3(.76,.08,.66),Color("a57656"))
		"archer":
			block(head,Vector3(0,.23,.04),Vector3(.64,.24,.65),accent)
			block(torso,Vector3(.3,.02,.35),Vector3(.32,.85,.35),Color("947452"))
			for i in range(3): block(torso,Vector3(.2+i*.12,.65,.38),Vector3(.06,.6,.06),PAPER)
			var bow:=part(left,Vector3(0,-.5,-.4))
			for side in [-1,1]:
				View.beam(bow,Vector3(0,0,-.3),Vector3(0,side*.55,-.48),accent,.14)
				View.beam(bow,Vector3(0,side*.55,-.48),Vector3(0,side*1.05,0),accent,.14)
			View.beam(bow,Vector3(0,-1.05,0),Vector3(0,1.05,0),PAPER,.035)
			block(prop,Vector3(0,0,-.4),Vector3(.07,.07,1.25),PAPER)
		"mechanic":
			block(head,Vector3(0,.25,0),Vector3(.72,.2,.7),accent)
			block(torso,Vector3(0,.12,.54),Vector3(.8,.8,.4),INK)
			block(torso,Vector3(0,.12,.76),Vector3(.46,.43,.08),Color("8dc65c"),true)
			block(prop,Vector3(0,-.15,-.3),Vector3(.2,1.4,.23),PAPER)
			block(prop,Vector3(0,.6,-.3),Vector3(.7,.3,.25),INK.lightened(.25))
			for side in [-1,1]: block(prop,Vector3(side*.3,.88,-.3),Vector3(.18,.4,.25),PAPER)
		"lecturer":
			block(torso,Vector3(0,-.5,0),Vector3(.85,.5,.6),INK)
			block(head,Vector3(.27,.01,-.24),Vector3(.18,.23,.08),accent,true)
			# The rear slide feeder and long lens read from above, even facing away.
			projector = part(torso,Vector3(.65,.47,.01))
			block(projector,Vector3(-.06,0,.16),Vector3(.66,.45,1.12),PAPER)
			block(projector,Vector3(0,.02,-.84),Vector3(.29,.29,1.12),INK)
			block(projector,Vector3(0,.02,-1.53),Vector3(.64,.54,.40),accent)
			block(projector,Vector3(0,.02,-1.76),Vector3(.43,.36,.08),PAPER,true)
			var feeder:=part(projector,Vector3(0,.26,.62))
			feeder.rotation.x = -.30
			for side in [-1,1]:
				block(feeder,Vector3(side*.35,.44,0),Vector3(.14,.88,.14),accent)
			block(feeder,Vector3(0,.89,0),Vector3(.84,.13,.14),PAPER)
			block(projector,Vector3(0,-.34,-.16),Vector3(.18,.31,.21),INK)
			for side in [-1,1]:
				var stand:=part(projector,Vector3(side*.12,-.18,-.68))
				block(stand,Vector3(0,-.65,0),Vector3(.10,1.30,.12),INK)
				block(stand,Vector3(0,-1.31,0),Vector3(.22,.10,.24),PAPER)
				projector_stands.append(stand)
		"custodian":
			block(body,Vector3(0,.35,0),Vector3(1.7,.65,1.55),accent)
			for side in [-1,1]:
				block(body,Vector3(side*.87,.26,0),Vector3(.24,.45,1.05),INK)
			block(head,Vector3(0,.25,0),Vector3(.75,.18,.65),PAPER)
			block(prop,Vector3(0,0,-.6),Vector3(.13,.13,1.5),PAPER)
			block(prop,Vector3(0,-.12,-1.3),Vector3(1.4,.3,.4),Color("cedcc2"))
			guard_panel=part(left,Vector3(0,-.25,-.3))
			block(guard_panel,Vector3.ZERO,Vector3(.8,1.25,.14),PAPER)
			block(guard_panel,Vector3(0,0,-.1),Vector3(.5,.7,.06),accent)
		"broadcaster":
			for side in [-1,1]: block(head,Vector3(side*.31,0,0),Vector3(.18,.3,.3),INK)
			block(head,Vector3(0,.3,0),Vector3(.7,.12,.2),INK)
			block(torso,Vector3(0,.02,.48),Vector3(.7,.87,.4),accent)
			block(torso,Vector3(.28,.7,.5),Vector3(.045,.75,.045),PAPER)
			block(prop,Vector3(0,0,-.18),Vector3(.25,.25,.5),PAPER)
			block(prop,Vector3(0,0,-.5),Vector3(.64,.6,.18),accent)
			block(prop,Vector3(0,0,-.61),Vector3(.44,.4,.06),INK)
	status_root=part(self,Vector3.ZERO)
	buff_root=part(status_root,Vector3.ZERO)
	for i in range(4):
		var a:=i*TAU/4
		block(buff_root,Vector3(cos(a)*.95,.45,sin(a)*.95),Vector3(.13,.5,.13),accent,true)
	stun_root=part(status_root,Vector3(0,2.7,0))
	for i in range(3):
		block(stun_root,Vector3(cos(i*TAU/3)*.4,0,sin(i*TAU/3)*.4),Vector3(.16,.16,.16),Color("ffd878"),true)
	ink_root=part(status_root,Vector3(0,2.55,0))
	for i in range(2): block(ink_root,Vector3((i-.5)*.3,0,0),Vector3(.2,.24,.2),Color("bb89f5"),true)
	shield_root=part(status_root,Vector3.ZERO)
	for i in range(6):
		var a:=i*TAU/6
		var shard:=part(shield_root,Vector3(cos(a)*1.05,.95,sin(a)*1.05))
		shard.rotation.y=-a
		block(shard,Vector3.ZERO,Vector3(.08,.68,.38),team_color,true)

	root_mark=part(self,Vector3.ZERO)
	for side in [-1,1]: block(root_mark,Vector3(side*.53,.2,0),Vector3(.16,.38,1.05),Color("eed5a1"),true)
	silence_mark=part(self,Vector3(0,2.9,0))
	View.beam(silence_mark,Vector3(-.22,-.22,0),Vector3(.22,.22,0),Color("f2cf95"),.09)
	View.beam(silence_mark,Vector3(.22,-.22,0),Vector3(-.22,.22,0),Color("f2cf95"),.09)

func apply_state(data: Dictionary, time: float) -> void:
	state=data
	# Bound extrapolation: the lobby/loading clock can remain paused for minutes.
	sample_clock=time
	server_clock=clampf(server_clock,time,time+.05)

func play_action(action: String) -> void:
	if action=="hit": hit_age=0

func open_projector_stands(deployment: float) -> void:
	for i in range(projector_stands.size()):
		var stand:=projector_stands[i]
		stand.rotation.x=lerpf(-PI*.5,0, deployment)
		stand.rotation.z=(i*2-1)*.48*deployment
		stand.scale.y=lerpf(.52,1.0,deployment)

func animate(delta: float, velocity: Vector3) -> void:
	clock+=delta
	server_clock=minf(sample_clock+.10,server_clock+delta)
	hit_age+=delta
	var speed:=minf(1,Vector2(velocity.x,velocity.z).length()/6.5)
	var stride:=sin(clock*(9.0 if hero=="guardian" else 12.0))*.6*speed
	body.position=Vector3(0,absf(sin(clock*12))*.06*speed,0)
	body.rotation=Vector3.ZERO
	torso.rotation=Vector3.ZERO
	head.rotation=Vector3.ZERO
	left.rotation=Vector3(-stride*.55,0,.06)
	right.rotation=Vector3(stride*.55,0,-.06)
	leg_l.rotation=Vector3(stride,0,0)
	leg_r.rotation=Vector3(-stride,0,0)
	if hero=="courier":
		body.rotation.x=-speed*.24
		for i in range(ornaments.size()): ornaments[i].rotation.x=sin(clock*13-i)*.25
	if hero=="printer":
		stamp_grip.position.y=1.40
		stamp_grip.rotation=Vector3.ZERO
		left.rotation=Vector3(-1.30,0,.06)
		right.rotation=Vector3(-1.30,0,-.06)
		leg_l.rotation.x*=.62
		leg_r.rotation.x*=.62
	if hero=="lecturer":
		projector.rotation=Vector3.ZERO
		open_projector_stands(0)
		right.rotation=Vector3(-1.12,0,-.04)
		left.rotation=Vector3(-.80,0,.34)
	if hero=="stapler": right.rotation.x=-.65;left.rotation.x=-.55
	if hero=="barista": left.rotation.x=-.55
	if hero=="archer": left.rotation.x=-1.25;right.rotation.x=-.8;torso.rotation.y=.2
	if hero=="mechanic": right.rotation.x=-.25;body.rotation.z=sin(clock*6)*speed*.06
	if hero=="custodian": leg_l.rotation=Vector3.ZERO;leg_r.rotation=Vector3.ZERO;left.rotation.x=-.7 if bool(state.get("guarding",false)) else -.2
	if hero=="broadcaster": right.rotation.x=-.7

	var age:=maxf(0,server_clock-float(state.get("actionAt",-10)))
	var action:=str(state.get("action",""))
	if action=="attack" and age<.45:
		var swing:=sin(clampf(age/.32,0,1)*PI)
		match hero:
			"stapler": right.rotation.x=-.8-swing*.35;torso.rotation.z=-swing*.07
			"courier": right.rotation=Vector3(-1.2+swing*1.6,-swing*.6,-.2);torso.rotation.y=-swing*.5
			"printer": stamp_grip.rotation.x=swing*.55
			"guardian": right.rotation.x=-1.5*swing;torso.rotation.y=-swing*.3
			"barista": right.rotation.x=-1.15*swing;right.rotation.z=-swing*.25
		if hero=="archer": right.rotation=Vector3(-1.2,0,-swing*.8);left.rotation.x=-1.3
		if hero=="mechanic": right.rotation=Vector3(-1.7+swing*2,0,-swing*.5);torso.rotation.y=-swing*.5
		if hero=="lecturer": projector.rotation.x=swing*.13;torso.rotation.y=-.12*swing
		if hero=="custodian": right.rotation=Vector3(-.7,-swing*1.2,0);torso.rotation.y=-swing*.5
		if hero=="broadcaster": right.rotation.x=-1.1;head.rotation.x=sin(age*20)*.05
	if action.begins_with("cast_"):
		var key:=action.trim_prefix("cast_")
		var windup:=maxf(.08,float(state.get("castWindup",.16)))
		var hold:=.65 if hero in ["printer","lecturer"] and key=="r" else .28
		if age<windup+hold:
			var preparation:=clampf(age/windup,0,1)
			var release:=clampf((age-windup)/hold,0,1)
			var weight:=1-release
			match hero:
				"stapler":
					right.rotation.x=-1.1+release*.4;left.rotation.x=-.95
					if key=="e": body.rotation.z=-.32*weight;body.position.y-=.23*weight
					if key=="r": right.rotation.z=-.6*weight;head.rotation.x=-.2*weight
				"courier":
					if key=="q": body.rotation.x=-.65*weight;right.rotation.x=.8*weight
					elif key=="e": left.rotation.x=-1.7*weight;torso.rotation.y=.35*weight
					else: right.rotation=Vector3(-1.7*weight,0,-.9*weight);left.rotation=Vector3(-1.7*weight,0,.9*weight);body.rotation.y=release*TAU
				"printer":
					if key=="r":
						var lift := preparation if age<windup else maxf(0,1-release*6)
						stamp_grip.rotation.x=lift*1.85
						stamp_grip.position.y+=lift*.51
						head.rotation.x=-.25*lift
					elif key=="e":
						stamp_grip.rotation.z=.32*weight
						stamp_grip.rotation.x=.52*weight
					else:
						stamp_grip.rotation.x=.90*weight
				"guardian":
					if key=="q": left.rotation.x=-.6*weight;body.rotation.x=-.32*weight
					elif key=="e": left.rotation=Vector3(-.8*weight,-.7*weight,0);right.rotation=Vector3(-.8*weight,.7*weight,0)
					else:
						var rise:=-2.6*preparation if age<windup else lerpf(-2.6,.6,minf(1,release*3))
						left.rotation.x=rise;right.rotation.x=rise;body.position.y=-.22*preparation if age<windup else -.3*weight;torso.rotation.x=.35*release*weight
				"barista":
					if key=="q": right.rotation.x=-1.3*weight;left.rotation.x=-.8
					elif key=="e": right.rotation.x=-2.8*weight;left.rotation.z=.65*weight
					else: left.rotation.x=-1.1*weight;right.rotation.x=-1.8*weight;body.rotation.y=sin(release*PI)*.3
			if hero=="archer":
				left.rotation.x=-1.35;right.rotation=Vector3(-1,0,-preparation*.9*weight)
				if key=="e": body.rotation.z=sin(release*PI)*1.1;body.position.y=-.3*weight
			if hero=="mechanic":
				right.rotation.x=-2.4*preparation*weight
				if key=="q": body.rotation.y=release*TAU*.7
				if key=="r": left.rotation.z=.8*weight;body.position.y=.2*sin(age*8)
			if hero=="lecturer":
				var brace:=preparation*weight
				leg_l.rotation.x-=.50*brace
				leg_r.rotation.x+=.50*brace
				torso.rotation.x=-.22*brace
				left.rotation.x=-.8-brace*.65
				projector.rotation.y=sin(release*PI)*.26 if key=="q" else 0.0
				projector.rotation.x=.12*brace if key=="r" else .04*brace
				if key=="r": open_projector_stands(minf(1.0,brace*1.6))
			if hero=="custodian":
				if key!="e": torso.rotation.y=sin(release*PI)*1.1;right.rotation.y=-preparation*weight
				else: left.rotation.x=-1.2*weight
			if hero=="broadcaster": right.rotation.x=-1.5*weight;left.rotation.z=.9*weight
	if bool(state.get("recalling",false)):
		left.rotation.x=-.6;right.rotation.x=-.6;head.rotation.x=.25;body.position.y+=sin(clock*4)*.06
	if hit_age<.2: torso.rotation.x+=sin(hit_age/.2*PI)*.18
	# Arms hang along -Y; positive X lifts the hand toward the character's -Z front.
	left.rotation.x=-left.rotation.x
	right.rotation.x=-right.rotation.x
	if hero=="stapler": prop.rotation.x=-right.rotation.x
	buff_root.visible=bool(state.get("ult",false)) or bool(state.get("empowered",false)) or bool(state.get("buff",false))
	buff_root.rotation.y=clock*2
	stun_root.visible=bool(state.get("stunned",false))
	stun_root.rotation.y=clock*4
	var ink_count:=int(state.get("inkStacks",0))
	ink_root.visible=ink_count>0
	for i in range(ink_root.get_child_count()): ink_root.get_child(i).visible=i<ink_count
	root_mark.visible=bool(state.get("rooted",false))
	silence_mark.visible=bool(state.get("silenced",false))
	if guard_panel!=null: guard_panel.scale=Vector3(1.8,1.3,1) if bool(state.get("guarding",false)) else Vector3.ONE
	shield_root.visible=float(state.get("shield",0))>0
	shield_root.rotation.y=sin(clock)*.06
