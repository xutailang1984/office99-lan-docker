extends Node3D
const QueryPhysics=preload("res://survival/static_query_physics.gd")

const Batch = preload("res://survival/static_mesh_batch.gd")
const OfficeTools = preload("res://survival/office_tools.gd")

var data: Dictionary = {}
var head: Node3D
var barrel: Node3D
var assembly: Node3D
var collider: StaticBody3D
var lamp: MeshInstance3D
var recoil := 0.0
var target_yaw := 0.0
var last_hp := 0.0
var flash := 0.0
var shared_materials: Dictionary = {}

func material(color: Color) -> StandardMaterial3D:
	var key := color.to_html()
	if not shared_materials.has(key):
		var value := StandardMaterial3D.new()
		value.albedo_color=color
		value.roughness=0.84
		shared_materials[key]=value
	return shared_materials[key]

func box(parent: Node3D, at: Vector3, size: Vector3, color: Color) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	var cube := BoxMesh.new()
	cube.size=size
	mesh.mesh=cube
	mesh.material_override=material(color)
	parent.add_child(mesh)
	mesh.position=at
	return mesh

func setup(value: Dictionary, settings: Dictionary) -> void:
	position=Vector3(float(value.x),float(value.y),float(value.z))
	set_meta("authority_id",str(value.id))
	box(self,Vector3(0,0.1,0),Vector3(1.65,0.2,1.65),Color("647375"))
	for side in [-1,1]:
		box(self,Vector3(side*0.7,0.21,0),Vector3(0.11,0.04,1.55),Color("c4a568"))
	assembly=Node3D.new()
	add_child(assembly)
	box(assembly,Vector3(0,0.65,0),Vector3(0.95,1.1,0.95),Color("3d5960"))
	box(assembly,Vector3(0,1.27,0),Vector3(0.7,0.16,0.7),Color("a8b2a7"))
	box(assembly,Vector3(0,2.25,0),Vector3(0.3,2.1,0.3),Color("758a83"))
	box(assembly,Vector3(0,0.83,-0.49),Vector3(0.48,0.35,0.07),Color("d3b275"))
	lamp=box(assembly,Vector3(0,0.94,-0.535),Vector3(0.32,0.075,0.025),Color("75dfbc"))
	lamp.name="Lamp"
	head=Node3D.new()
	assembly.add_child(head)
	head.position.y=3.6
	box(head,Vector3(0,-0.12,-0.25),Vector3(0.92,0.15,1.65),Color("344c5d"))
	box(head,Vector3(0,0.08,0.37),Vector3(0.84,0.52,0.42),Color("d47760"))
	box(head,Vector3(0,0.32,-0.25),Vector3(0.92,0.24,1.63),Color("de7960"))
	box(head,Vector3(0,0.12,-1.04),Vector3(0.82,0.50,0.20),Color("de7960"))
	box(head,Vector3(0,0.46,0.02),Vector3(0.60,0.035,0.44),Color("fff1d3"))
	barrel=Node3D.new()
	head.add_child(barrel)
	box(barrel,Vector3(0,-0.015,-0.64),Vector3(0.65,0.09,1.1),Color("a9cbd0"))
	box(barrel,Vector3(0,0,-1.20),Vector3(0.46,0.16,0.17),Color("667f87"))
	box(barrel,Vector3(0,0,-1.29),Vector3(0.29,0.05,0.025),Color("132932"))
	for i in range(5): box(barrel,Vector3(0,0.05,-0.42-i*0.12),Vector3(0.57,0.035,0.032),Color("e4e1cc"))

	collider=StaticBody3D.new()
	collider.set_meta("authority_id",str(value.id))
	add_child(collider)
	for bounds in settings.get("collision",[]):
		var shape := CollisionShape3D.new()
		var cube := BoxShape3D.new()
		cube.size=Vector3(float(bounds.width),float(bounds.height),float(bounds.depth))
		shape.shape=cube
		shape.position=Vector3(float(bounds.x),float(bounds.y),float(bounds.z))
		collider.add_child(shape)
	QueryPhysics.refresh_body(collider)
	Batch.merge_tree(self,["Lamp"])
	apply_state(value)
	head.rotation.y=target_yaw

func apply_state(value: Dictionary) -> void:
	if not data.is_empty() and float(value.get("hp",0))<last_hp:
		flash=0.25
	data=value
	last_hp=float(data.get("hp",0))
	set_meta("data",data)
	target_yaw=float(data.get("yaw",0))
	var installed := int(data.get("level",0))>0
	var active := installed and last_hp>0
	assembly.visible=installed
	assembly.rotation.z=0 if active else 0.28
	assembly.scale=Vector3.ONE if active else Vector3(1,0.32,1)
	for shape in collider.get_children():
		QueryPhysics.set_disabled(shape,not active)
	lamp.material_override=material(Color("75dfbc") if active and int(data.get("ammo",0))>0 else Color("cf7756"))

func fire() -> void:
	recoil=0.18

func _process(delta: float) -> void:
	if head==null:
		return
	recoil=move_toward(recoil,0,delta*0.85)
	flash=move_toward(flash,0,delta)
	head.rotation.y=lerp_angle(head.rotation.y,target_yaw,minf(1,delta*12))
	barrel.position.z=recoil
	assembly.position.x=sin(flash*85)*flash*0.04
