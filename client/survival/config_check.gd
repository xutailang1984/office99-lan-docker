extends SceneTree

const AimProfile = preload("res://survival/aim_profile.gd")
const OfficeTools = preload("res://survival/office_tools.gd")

func _init() -> void:
	var config = JSON.parse_string(FileAccess.get_file_as_string("res://survival/balance.json"))
	if not config is Dictionary or str(config.get("content_version","")).is_empty():
		_fail("Survival configuration could not load")
		return
	for id in AimProfile.GUNS:
		if not config.get("weapons",[]).any(func(def): return str(def.get("id",""))==id):
			_fail("Missing supported weapon: "+id)
			return
	for def in config.get("weapons",[]):
		if not AimProfile.is_gun(str(def.get("id",""))) or float(def.get("magazine",0))<=0:
			_fail("Unsupported weapon presentation")
			return
	for id in OfficeTools.ROD_IDS:
		if not config.get("rods",[]).any(func(def): return str(def.get("id",""))==id):
			_fail("Missing supported rod: "+id)
			return
	var stations: Array = config.get("level", {}).get("terminals", [])
	if stations.size() != 10 or not stations.any(func(value): return str(value.get("id", "")) == "craft" and str(value.get("type", "")) == "craft") or not stations.any(func(value): return str(value.get("id", "")) == "emergency_craft" and str(value.get("type", "")) == "craft"):
		_fail("Missing crafting stations")
		return
	print("SURVIVAL_CONFIG_READY")
	quit()

func _fail(message: String) -> void:
	push_error(message)
	quit(1)
