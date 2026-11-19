extends Node

func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var classic := "--classic" in args or "--smoke-headless" in args
	if "--moba" in args:
		# MOBA collision/skills are simulated by the host worker. The renderer has
		# no physics bodies; avoid unused threadless-Web physics task groups.
		PhysicsServer2D.set_active(false)
		PhysicsServer3D.set_active(false)
		get_tree().change_scene_to_file.call_deferred("res://moba/main.tscn")
		return
	get_tree().change_scene_to_file.call_deferred("res://main.tscn" if classic else "res://survival/main.tscn")
