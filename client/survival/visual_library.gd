extends RefCounted

# Immutable mesh/material resources are shared; each instance keeps its own joints.
static var scenes: Dictionary = {}

static func reuse(key: String, parent: Node3D) -> bool:
	if not scenes.has(key): return false
	var instance: Node = scenes[key].instantiate()
	for descendant in instance.find_children("*","",true,false): descendant.owner=null
	for child in instance.get_children():
		instance.remove_child(child)
		parent.add_child(child)
	instance.free()
	return true

static func remember(key: String, parent: Node3D) -> void:
	for child in parent.find_children("*","",true,false): child.owner=parent
	var scene := PackedScene.new()
	if scene.pack(parent)==OK: scenes[key]=scene
