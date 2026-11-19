extends Node

# Real samples cover combat and material feedback. These compact synth profiles
# remain as a last-resort fallback when an asset cannot be loaded.
const PROFILES = {"reel":[0.065,680,0.46],"spool":[0.18,340,0.55],"sonar":[0.10,1230,0.05],"metal_catch":[0.16,900,0.22],"snag":[0.16,190,0.38],"splash":[0.13,210,0.85],"pistol":[0.095,610,0.38],"smg":[0.075,540,0.64],"lmg":[0.15,230,0.82],"carbine":[0.11,430,0.58],"shotgun":[0.2,310,0.78],"rifle":[0.17,790,0.44],"break":[0.24,190,0.94],"impact":[0.085,340,0.74],"step":[0.075,115.0,0.70],"swim":[0.16,235.0,0.85],"land":[0.14,80.0,0.82],"reload":[0.14,530,0.45],"reload_insert":[0.095,980,0.48],"equip":[0.075,610,0.28],"cast":[0.24,280.0,0.72],"hook":[0.12,610.0,0.18],"swing":[0.15,175.0,0.74],"dry":[0.045,740,0.34],"hit":[0.065,830.0,0.18],"weak":[0.10,1050.0,0.14],"kill":[0.18,720.0,0.10],"hurt":[0.19,85.0,0.45],"phase":[0.40,360.0,0.10]}
const MANIFEST_PATH := "res://audio/sfx/manifest.json"
const ASSET_ROOT := "res://audio/sfx/"
const PAN_BUSES := ["GameSFX-L2", "GameSFX-L1", "GameSFX-C", "GameSFX-R1", "GameSFX-R2"]

var manifest: Dictionary = {}
var streams: Dictionary = {}
var fallback_streams: Dictionary = {}
var voices: Array[AudioStreamPlayer] = []
var voice_priority: Array[int] = []
var voice_started: Array[int] = []
var last_variation: Dictionary = {}
var last_played: Dictionary = {}


func _ready() -> void:
	_load_manifest()
	if _uses_browser_audio():
		JavaScriptBridge.eval("window.preloadTidalAudio && window.preloadTidalAudio()")
		return
	_ensure_buses()
	var limit := clampi(int(manifest.get("voice_limit", 24)), 12, 40)
	for _i in range(limit):
		var voice := AudioStreamPlayer.new()
		voice.bus = "GameSFX-C"
		add_child(voice)
		voices.append(voice)
		voice_priority.append(0)
		voice_started.append(0)
	_preload_assets()


func _uses_browser_audio() -> bool:
	return OS.has_feature("web") and bool(JavaScriptBridge.eval("!!window.islandAudioFallback"))


func _load_manifest() -> void:
	if not FileAccess.file_exists(MANIFEST_PATH):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST_PATH))
	if parsed is Dictionary and parsed.get("cues") is Dictionary:
		manifest = parsed


func _ensure_buses() -> void:
	var parent := AudioServer.get_bus_index("GameSFX")
	if parent < 0:
		AudioServer.add_bus()
		parent = AudioServer.bus_count - 1
		AudioServer.set_bus_name(parent, "GameSFX")
		AudioServer.set_bus_send(parent, "Master")
		AudioServer.add_bus_effect(parent, AudioEffectLimiter.new())
	for i in range(PAN_BUSES.size()):
		var name: String = PAN_BUSES[i]
		var index := AudioServer.get_bus_index(name)
		if index < 0:
			AudioServer.add_bus()
			index = AudioServer.bus_count - 1
			AudioServer.set_bus_name(index, name)
			AudioServer.set_bus_send(index, "GameSFX")
			var panner := AudioEffectPanner.new()
			panner.pan = (float(i) - 2.0) * 0.42
			AudioServer.add_bus_effect(index, panner)


func _preload_assets() -> void:
	var cues: Dictionary = manifest.get("cues", {})
	for value in cues.values():
		if not value is Dictionary:
			continue
		for field in ["near", "far"]:
			for relative in value.get(field, []):
				var path := ASSET_ROOT + str(relative)
				if not streams.has(path):
					var stream = load(path)
					if stream != null:
						streams[path] = stream


func _entry(kind: String) -> Dictionary:
	return manifest.get("cues", {}).get(kind, {}) if manifest.get("cues") is Dictionary else {}


func _pick_stream(kind: String, distant: bool):
	var entry := _entry(kind)
	if entry.is_empty():
		return _fallback(kind)
	var field := "far" if distant and not entry.get("far", []).is_empty() else "near"
	var files: Array = entry.get(field, [])
	if files.is_empty():
		return _fallback(kind)
	var key := kind + ":" + field
	var choice := 0
	if files.size() > 1:
		choice = randi_range(0, files.size() - 1)
		if choice == int(last_variation.get(key, -1)):
			choice = (choice + 1 + randi_range(0, files.size() - 2)) % files.size()
	last_variation[key] = choice
	var path := ASSET_ROOT + str(files[choice])
	if not streams.has(path):
		var stream = load(path)
		if stream != null:
			streams[path] = stream
	return streams[path] if streams.has(path) else _fallback(kind)


func _fallback(kind: String):
	if fallback_streams.has(kind):
		return fallback_streams[kind]
	var data: Array = PROFILES.get(kind, PROFILES.equip)
	var duration := float(data[0])
	var base := float(data[1])
	var noise := float(data[2])
	var bytes := PackedByteArray()
	bytes.resize(int(duration * 22050) * 2)
	var smooth_noise := 0.0
	for i in range(bytes.size() / 2):
		var time := i / 22050.0
		var life := time / duration
		var envelope := minf(time / 0.006, 1) * pow(1 - life, 2.2)
		smooth_noise = lerpf(smooth_noise, randf_range(-1, 1), 0.40)
		var tone := sin(TAU * (base * time - base * 0.3 * time * time / duration))
		bytes.encode_s16(i * 2, int(clampf((smooth_noise * noise + tone * (1 - noise)) * envelope, -1, 1) * 22000))
	var wave := AudioStreamWAV.new()
	wave.format = AudioStreamWAV.FORMAT_16_BITS
	wave.mix_rate = 22050
	wave.data = bytes
	fallback_streams[kind] = wave
	return wave


func _acquire_voice(priority: int) -> int:
	for i in range(voices.size()):
		if not voices[i].playing:
			return i
	var candidate := 0
	for i in range(1, voices.size()):
		if voice_priority[i] < voice_priority[candidate] or (voice_priority[i] == voice_priority[candidate] and voice_started[i] < voice_started[candidate]):
			candidate = i
	if priority < voice_priority[candidate]:
		return -1
	return candidate


func play(kind: String, loudness: float, pan := 0.0, priority := -1, distant := false, source_key := "") -> void:
	if loudness <= 0:
		return
	var entry := _entry(kind)
	var actual_priority := int(entry.get("priority", 45)) if priority < 0 else int(priority)
	var now := Time.get_ticks_msec()
	var cooldown := int(entry.get("cooldown_ms", 0))
	var throttle_key := kind + ":" + str(source_key)
	if cooldown > 0 and now - int(last_played.get(throttle_key, -1000000)) < cooldown:
		return
	last_played[throttle_key] = now
	if _uses_browser_audio():
		var request := {"kind": kind, "volume": clampf(loudness, 0, 1), "pan": clampf(float(pan), -1, 1), "priority": actual_priority, "distant": bool(distant), "source": str(source_key)}
		JavaScriptBridge.eval("window.playTidalCue && window.playTidalCue(%s)" % JSON.stringify(request))
		return
	if voices.is_empty():
		return
	var slot := _acquire_voice(actual_priority)
	if slot < 0:
		return
	var voice := voices[slot]
	if voice.playing:
		voice.stop()
	voice.stream = _pick_stream(kind, distant)
	if voice.stream == null:
		return
	voice.volume_db = linear_to_db(clampf(loudness * float(entry.get("gain", 1.0)), 0.001, 1.0))
	voice.pitch_scale = randf_range(float(entry.get("pitch_min", 0.96)), float(entry.get("pitch_max", 1.04)))
	var bus_slot := clampi(roundi((clampf(float(pan), -1, 1) + 1.0) * 2.0), 0, PAN_BUSES.size() - 1)
	voice.bus = PAN_BUSES[bus_slot]
	voice_priority[slot] = actual_priority
	voice_started[slot] = now
	voice.play()
