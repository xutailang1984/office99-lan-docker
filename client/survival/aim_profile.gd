extends RefCounted

# Presentation helpers only. Damage, FOV and spread remain in balance/server data.
const ADS_READY_SECONDS := 0.15
const GUNS := ["carbine", "shotgun", "rifle", "pistol", "smg", "lmg", "doublebarrel", "dmr"]

static func is_gun(id: String) -> bool:
	return id in GUNS

static func sight_height(id: String) -> float:
	return float({"pistol":0.24,"smg":0.28,"lmg":0.33,"doublebarrel":0.30,"dmr":0.31}.get(id,0.37 if id == "rifle" else (0.34 if id == "shotgun" else 0.32)))

static func view_offset(id: String) -> Vector3:
	return Vector3(-0.26, 0.29 - sight_height(id) * 0.82, 0)

static func requested_ads(player: Dictionary, requested: bool, id: String) -> bool:
	return requested and is_gun(id) and str(player.get("lifeState", "ALIVE")) == "ALIVE" and not bool(player.get("swimming", false)) and not bool(player.get("sprinting", false)) and player.get("reload") == null and player.get("work") == null and player.get("fishing") == null

static func ready(player: Dictionary, requested: bool, id: String) -> bool:
	# The public ads flag only becomes true after the server's weapon-specific dwell.
	# Local right-button timing alone must never promise the tighter spread.
	return requested_ads(player, requested, id) and bool(player.get("ads", false))

static func target_fov(base_fov: float, weapon_config: Dictionary, requested: bool) -> float:
	return float(weapon_config.get("ads_fov", base_fov)) if requested else base_fov

static func sensitivity_scale(base_fov: float, current_camera_fov: float) -> float:
	return clampf(tan(deg_to_rad(current_camera_fov) * 0.5) / maxf(0.01, tan(deg_to_rad(base_fov) * 0.5)), 0.1, 2.0)

static func spread_degrees(weapon_config: Dictionary, player: Dictionary, requested: bool) -> float:
	var id := str(weapon_config.get("id", ""))
	var key := "ads_spread_deg" if ready(player, requested, id) else "hip_spread_deg"
	var movement := clampf(float(player.get("moveSpeed",0.0))/2.0,0.0,1.0)
	return (float(weapon_config.get(key, 0.0)) + float(weapon_config.get("move_spread_deg",0.0))*movement) * lerpf(1.0,float(weapon_config.get("moving_spread_multiplier",1.0)),movement) * (0.75 if bool(player.get("crouching", false)) else 1.0)

static func spread_pixels(degrees: float, current_camera_fov: float, logical_height: float) -> float:
	return tan(deg_to_rad(absf(degrees))) * logical_height * 0.5 / maxf(0.01, tan(deg_to_rad(current_camera_fov) * 0.5))

static func spread_bounds(degrees: float, pitch: float, current_camera_fov: float, logical_height: float) -> Rect2:
	# The authority scatters yaw and pitch independently, clamping pitch to +/-1.5.
	# A projected envelope avoids displaying an inaccurate circle at steep aim angles.
	var angle := deg_to_rad(absf(degrees))
	var focal := logical_height*0.5/maxf(0.01,tan(deg_to_rad(current_camera_fov)*0.5))
	var minimum := Vector2.ZERO
	var maximum := Vector2.ZERO
	for yaw_delta in [-angle,0.0,angle]:
		for pitch_delta in [-angle,0.0,angle]:
			var scattered_pitch := clampf(pitch+pitch_delta,-1.5,1.5)
			var depth := sin(scattered_pitch)*sin(pitch)+cos(scattered_pitch)*cos(yaw_delta)*cos(pitch)
			var point := Vector2(-sin(yaw_delta)*cos(scattered_pitch),-sin(scattered_pitch)*cos(pitch)+cos(scattered_pitch)*cos(yaw_delta)*sin(pitch))*focal/maxf(0.01,depth)
			minimum=minimum.min(point)
			maximum=maximum.max(point)
	return Rect2(minimum,maximum-minimum)
