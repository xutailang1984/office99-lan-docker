extends Node3D
const QueryPhysics=preload("res://survival/static_query_physics.gd")

# Bounded decorations only. Authority owns the boxes, locks, timer and rewards.
const Tools = preload("res://survival/office_tools.gd")
const Batch = preload("res://survival/static_mesh_batch.gd")
const Library = preload("res://survival/visual_library.gd")
const DARK := Color("344c5d")
const PALE := Color("eee8d5")
const MINT := Color("78bbb2")
const GOLD := Color("ecc15d")
const SOLID_EVENTS := ["desk_alarm","desk_sort","desk_stamp","desk_print","supply_dial","supply_cool"]
const CRATE_EVENTS := ["supply_seal","parcel_intact","parcel_rush","parcel_invoice"]
var nodes := {}

static func carry_box(parent: Node3D) -> void:
	if Library.reuse("exploration:carry_box",parent): return
	Tools.box(parent,Vector3.ZERO,Vector3(.64,.45,.48),Color("a88964"))
	Tools.box(parent,Vector3(0,.236,0),Vector3(.14,.018,.486),GOLD)
	Tools.box(parent,Vector3(0,0,-.248),Vector3(.30,.20,.012),MINT)
	Tools.box(parent,Vector3(0,0,-.261),Vector3(.07,.13,.018),PALE)
	Tools.box(parent,Vector3(0,0,-.262),Vector3(.17,.05,.019),PALE)
	Batch.merge_tree(parent)
	Library.remember("exploration:carry_box",parent)

static func symbol(parent: Node3D, index: int, at: Vector3) -> void:
	var color: Color=[MINT,GOLD,Color("b29ad6")][posmod(index,3)]
	for i in range(index+1): Tools.box(parent,at+Vector3((i-index*.5)*.13,0,0),Vector3(.07,.17,.025),color)

static func build(parent: Node3D, type: String, index: int = 0) -> void:
	index=clampi(index,0,2)
	var key := "exploration:"+type+":"+str(index if type in ["desk_sort","desk_stamp","parcel_rush","parcel_invoice"] else 0)
	if Library.reuse(key,parent): return
	if type=="receiver":
		for side in [-1.0,1.0]:
			Tools.box(parent,Vector3(side*.75,.07,0),Vector3(.12,.10,1.6),MINT)
			Tools.box(parent,Vector3(0,.07,side*.75),Vector3(1.35,.10,.12),MINT)
		Tools.box(parent,Vector3(.8,.72,.8),Vector3(.08,1.44,.08),DARK)
		Tools.box(parent,Vector3(.8,1.44,.8),Vector3(.55,.38,.10),MINT)
		Tools.box(parent,Vector3(.8,1.44,.738),Vector3(.29,.07,.02),PALE)
	elif type in ["supply_carry","parcel_relay"]:
		var box := Node3D.new()
		parent.add_child(box)
		box.position.y=.25
		carry_box(box)
	elif type in SOLID_EVENTS:
		Tools.box(parent,Vector3(0,.47,0),Vector3(.9,.94,.65),DARK)
		Tools.box(parent,Vector3(0,.5,-.34),Vector3(.78,.72,.035),Color("779e9c"))
		Tools.box(parent,Vector3(0,.31,-.385),Vector3(.27,.055,.065),PALE)
		Tools.box(parent,Vector3(0,1.01,0),Vector3(1.02,.10,.78),Color("b69771"))
		if type in ["desk_sort","desk_stamp"]:
			symbol(parent,index,Vector3(0,.71,-.375))
			if type=="desk_stamp":
				Tools.box(parent,Vector3(0,1.17,0),Vector3(.12,.22,.12),GOLD)
				Tools.box(parent,Vector3(0,1.065,0),Vector3(.26,.05,.24),DARK)
		elif type=="desk_print":
			Tools.box(parent,Vector3(0,1.15,0),Vector3(.68,.20,.49),DARK)
			Tools.box(parent,Vector3(0,1.267,-.05),Vector3(.48,.024,.29),PALE)
			Tools.box(parent,Vector3(0,.7,-.38),Vector3(.48,.21,.024),PALE)
		elif type=="supply_dial":
			Tools.box(parent,Vector3(0,.71,-.4),Vector3(.20,.20,.10),GOLD)
			for i in range(3):symbol(parent,i,Vector3(-.28+i*.28,.9,-.38))
		elif type=="supply_cool":
			Tools.box(parent,Vector3(0,1.20,0),Vector3(.37,.28,.25),Color("bd9672"))
			Tools.box(parent,Vector3(0,1.345,0),Vector3(.16,.035,.12),GOLD)
		else:
			Tools.box(parent,Vector3(.27,1.12,-.1),Vector3(.20,.13,.20),GOLD)
			Tools.box(parent,Vector3(.27,1.215,-.1),Vector3(.07,.06,.07),PALE)
	else:
		# Existing destructible owns the box. Its event marker never becomes a second shell.
		var color: Color=GOLD if type=="parcel_rush" else MINT if type=="parcel_intact" else Color("b29ad6")
		Tools.box(parent,Vector3(0,1.215,0),Vector3(.18,.025,1.22),color)
		Tools.box(parent,Vector3(0,.78,-.616),Vector3(.46,.31,.024),color)
		if type=="supply_seal":
			for i in range(3): Tools.box(parent,Vector3((i-1)*.14,.8,-.639),Vector3(.06,.17,.018),PALE)
		elif type in ["parcel_rush","parcel_invoice"]: symbol(parent,index,Vector3(0,.78,-.645))
		else: Tools.box(parent,Vector3(0,.78,-.645),Vector3(.08,.18,.022),PALE)
	Batch.merge_tree(parent)
	Library.remember(key,parent)

func sync_state(state: Dictionary, props: Dictionary = {}) -> void:
	var live_ids := []
	for event in state.get("exploration",{}).get("events",[]):
		if bool(event.get("done",false)): continue
		for part in event.get("parts",[]):
			if bool(part.get("opened",false)) or part.get("carrierId")!=null: continue
			var anchor: Node3D=null
			if str(event.type) in CRATE_EVENTS:
				var prop=props.get(str(part.id))
				if not is_instance_valid(prop) or prop.is_queued_for_deletion(): continue
				anchor=prop.visual
			_sync_part(str(part.id),str(event.type),int(part.index),Vector3(float(part.x),float(part.y),float(part.z)),live_ids,anchor)
		if event.get("receiver") is Dictionary:
			var at: Dictionary=event.receiver
			_sync_part(str(event.id)+"-receiver","receiver",0,Vector3(float(at.x),float(at.y),float(at.z)),live_ids)
	for id in nodes.keys():
		if id not in live_ids:
			if is_instance_valid(nodes[id]): nodes[id].queue_free()
			nodes.erase(id)

func _sync_part(id: String, type: String, index: int, at: Vector3, live_ids: Array, anchor: Node3D = null) -> void:
	live_ids.append(id)
	if nodes.has(id) and not is_instance_valid(nodes[id]): nodes.erase(id)
	if not nodes.has(id):
		var node := Node3D.new()
		(anchor if anchor!=null else self).add_child(node)
		build(node,type,index)
		if type in SOLID_EVENTS:
			var body := StaticBody3D.new()
			node.add_child(body)
			body.set_meta("authority_id",id)
			var collision := CollisionShape3D.new()
			var shape := BoxShape3D.new()
			shape.size=Vector3(1.02,1.06,.78)
			collision.shape=shape
			collision.position.y=.53
			body.add_child(collision)
			var top_specs: Dictionary={"desk_stamp":[Vector3(.26,.24,.24),Vector3(0,1.17,0)],"desk_print":[Vector3(.68,.23,.49),Vector3(0,1.165,0)],"supply_cool":[Vector3(.37,.3025,.25),Vector3(0,1.21125,0)]}
			if top_specs.has(type):
				var top:=CollisionShape3D.new()
				var top_shape:=BoxShape3D.new()
				top_shape.size=top_specs[type][0]
				top.shape=top_shape
				top.position=top_specs[type][1]
				body.add_child(top)
		nodes[id]=node
	nodes[id].position=at if anchor==null else Vector3.ZERO
	if type in SOLID_EVENTS:
		for child in nodes[id].get_children():
			if child is StaticBody3D: QueryPhysics.refresh_body(child)

func clear() -> void:
	for node in nodes.values():
		if is_instance_valid(node): node.queue_free()
	nodes.clear()
