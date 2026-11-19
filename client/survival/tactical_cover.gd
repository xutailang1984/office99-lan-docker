extends Node3D
const Tools=preload("res://survival/office_tools.gd")
const QueryPhysics=preload("res://survival/static_query_physics.gd")
func setup(id: String) -> void:
	Tools.box(self,Vector3(0,.7,0),Vector3(2,1.4,.28),Color("4ba8ad"))
	Tools.box(self,Vector3(0,.75,-.151),Vector3(.035,1.25,.015),Color("254556"))
	for side in [-1,1]:Tools.box(self,Vector3(side*.5,1.15,-.156),Vector3(.45,.09,.02),Color("fff2d6"))
	var body:=StaticBody3D.new()
	add_child(body)
	body.set_meta("authority_id",id)
	var collision:=CollisionShape3D.new()
	var shape:=BoxShape3D.new()
	shape.size=Vector3(2,1.4,.28)
	collision.shape=shape
	collision.position.y=.7
	body.add_child(collision)
	QueryPhysics.refresh_body(body)
func update_zone(data: Dictionary,_friendly: bool=false) -> void:
	position=Vector3(float(data.x),float(data.y),float(data.z))
	for child in get_children():
		if child is StaticBody3D:QueryPhysics.refresh_body(child)
