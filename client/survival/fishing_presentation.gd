extends RefCounted

# Shared presentation only. The host owns catches, tension, cue and progress.
# Shapes are (distance along player -> cast anchor, perpendicular offset in metres).
# The caller interpolates them and clips the resulting points to actual sea water.
const CALM := Color("7ec8bd")
const ACTIVE := Color("f2c76b")
const STRAIN := Color("f28568")
const METAL := Color("83c4e7")

static func mode(fishing: Dictionary) -> String:
	var value := str(fishing.get("mode", ""))
	if not value.is_empty(): return value
	match str(fishing.get("rodId", "rod_basic")):
		"rod_light": return "lure"
		"rod_pro": return "angle"
		"rod_heavy": return "power"
		"rod_magnet": return "magnet"
		"rod_net": return "net"
	return "float"

static func title(fishing: Dictionary) -> String:
	if bool(fishing.get("special",false)): return "大鱼来了！"
	match mode(fishing):
		"lure": return "轻拉逗鱼"
		"angle": return "远投走位"
		"power": return "重竿卸力"
		"magnet": return "磁吸寻宝"
		"net": return "撒网聚鱼"
	return "浮漂等鱼"

static func cue_hint(fishing: Dictionary) -> String:
	var state := str(fishing.get("state", ""))
	var style := mode(fishing)
	if bool(fishing.get("special",false)) and state == "BITE": return "大鱼在拉！左键挑战 · 右键放过"
	if state == "CAST": return "撒网入水" if style=="net" else "磁钩入水" if style == "magnet" else "浮漂入水"
	if state == "BITE": return "鱼咬钩了 · 点击左键"
	if state == "LAND": return "物资上岸 · 靠近拾取" if style == "magnet" else "鱼上岸了 · 打倒回收"
	if state == "REEL" and float(fishing.get("tension",0))>=78:
		return "线绷紧了 · 松手卸力"
	match str(fishing.get("cue", "")):
		"net_wait": return "等鱼聚齐 · 左键收网"
		"net_ready": return "鱼入网了 · 左键收网"
		"net_close": return "收紧网口 · 分段拉回"
		"net_pull": return "拉一下网 · 再松手"
		"net_rest": return "网绷紧了 · 松手缓一缓"
		"tow_pull": return "慢拖发力 · 再松手"
		"tow_rest": return "持续轻拖 · 半秒后发力"
		"pump_pull": return "短拉发力！"
		"pump_rest": return "松一下 · 再短拉"
		"manual_pull": return "提竿正好 · 快收！"
		"auto_hook": return "铃铛响了 · 自动提竿"
		"rhythm_ready": return "节拍对了 · 再轻拉"
		"rhythm_pull": return "跟上节拍 · 快收！"
		"anchor_brace": return "站稳松线 · 等鱼泄力"
		"anchor_ready": return "支架稳了 · 按住快收"
		"anchor_pull": return "稳稳拉回！"
		"winch_ready": return "棘轮松开 · 按住解卡"
		"winch_free": return "解卡成功 · 拖回物资"
		"rebound_rest": return "顺线了 · 松手蓄能"
		"rebound_ready": return "卷轴蓄满 · 按住快收"
		"rebound_pull": return "回弹快收！"
		"lure_pull": return "左键轻拉 · 再松手"
		"lure_pause": return "松手一下 · 再轻拉" if state=="REEL" else "停一下 · 等鱼追来"
		"scan": return "按住扫底 · 听信号"
		"attached": return "吸住了 · 按住拖回"
		"dart": return "鱼在窜 · 松手缓一缓"
		"rush": return "鱼在冲 · 松手卸力"
		"tired": return "鱼累了 · 按住收线"
		"side_left", "side_right": return "横移找角 · 按住收线"
		"snag": return "卡住了 · 侧走或松手"
		"free": return "松开了 · 按住拖回"
	if state == "WAIT":
		if style == "lure": return "左键轻拉 · 再松手"
		if style == "magnet": return "按住扫底 · 听信号"
		return "等浮漂动 · 右键收回"
	if style == "magnet": return "按住拖回 · 松手卸力"
	if float(fishing.get("tension", 0)) >= 78: return "线绷紧了 · 松手卸力"
	return "按住收线 · 松手降压"

static func cue_color(fishing: Dictionary) -> Color:
	var cue := str(fishing.get("cue", ""))
	if cue in ["rush", "snag", "net_rest", "pump_rest"] or float(fishing.get("tension", 0)) >= 78: return STRAIN
	if cue in ["rebound_ready", "rebound_pull", "rhythm_ready", "rhythm_pull", "anchor_ready", "anchor_pull", "winch_ready", "winch_free", "auto_hook"]: return ACTIVE
	if cue in ["tired", "free", "rebound_rest"]: return CALM
	if mode(fishing) == "magnet": return METAL
	if str(fishing.get("state", "")) == "BITE" or cue in ["lure_pull", "side_left", "side_right", "dart"]: return ACTIVE
	return CALM

static func reel_weight(fishing: Dictionary) -> float:
	# Release is a visible stop, including WAIT luring and magnetic scanning.
	if not bool(fishing.get("reeling", false)): return 0.0
	var state := str(fishing.get("state", ""))
	if state not in ["WAIT", "REEL"]: return 0.0
	var style := mode(fishing)
	if state == "WAIT" and style != "lure" and style != "magnet": return 0.0
	if str(fishing.get("cue","")) in ["rebound_pull","rhythm_pull","anchor_pull","winch_free"]: return 1.0
	if style == "magnet": return 0.18 if str(fishing.get("cue", "")) == "snag" else 0.48
	if style == "power": return 0.25 if str(fishing.get("cue", "")) == "rush" else 0.68
	if style == "net": return .8 if str(fishing.get("cue",""))=="net_pull" else .1
	if style == "lure": return 1.0
	if str(fishing.get("cue", "")) == "rebound_pull": return 1.0
	return 0.78 if state == "REEL" else 0.0

static func pull_weight(fishing: Dictionary) -> float:
	if str(fishing.get("state", "")) not in ["BITE", "REEL", "LAND"]: return 0.0
	var tension := clampf(float(fishing.get("tension", 0)) / 100.0, 0.0, 1.0)
	var activity := clampf(float(fishing.get("activity", 0)), 0.0, 1.0)
	var cue := str(fishing.get("cue", ""))
	if cue == "rush": return clampf(0.48 + tension * 0.42 + activity * 0.10, 0.0, 1.0)
	if cue == "snag": return clampf(0.35 + tension * 0.50, 0.0, 1.0)
	if cue == "tired": return tension * 0.36
	return tension * 0.68 + activity * 0.12

static func water_shape(fishing: Dictionary, clock: float) -> Vector2:
	var state := str(fishing.get("state", ""))
	if state == "CAST": return Vector2(1.0, 0.0)
	var style := mode(fishing)
	var cue := str(fishing.get("cue", ""))
	var activity := clampf(float(fishing.get("activity", 0)), 0.0, 1.0)
	var motion := clampf(float(fishing.get("motion", 0)), -1.0, 1.0)
	var progress := clampf(float(fishing.get("progress", 0)) / 100.0, 0.0, 1.0)
	var ratio := lerpf(1.0, 0.18, progress) if state in ["REEL", "LAND"] else 1.0
	var sideways := 0.0
	if state == "WAIT" and style == "lure":
		ratio = 1.0 - activity * 0.12
		sideways = motion * 0.16
	elif state in ["REEL", "LAND"]:
		if style == "net":
			sideways=0.0
		elif style == "magnet":
			# A snagged object stays put. Strain belongs to the line and rod.
			sideways = 0.0 if cue == "snag" else motion * 0.08
		elif style == "power":
			ratio += 0.12 * activity if cue == "rush" else 0.0
			sideways = motion * (0.40 if cue == "rush" else 0.10)
		else:
			sideways = motion * (0.32 if style == "angle" else 0.22)
	# Fixed-frequency water drift stays phase-continuous when a cue changes.
	if style != "magnet": sideways += sin(clock * 2.2) * 0.025
	return Vector2(clampf(ratio, 0.18, 1.0), sideways)

static func shadow_shape(fishing: Dictionary, clock: float) -> Vector2:
	var shape := water_shape(fishing, clock)
	var activity := clampf(float(fishing.get("activity", 0)), 0.0, 1.0)
	if str(fishing.get("state", "")) == "WAIT":
		# The approaching silhouette closes its gap to the bait as interest rises.
		shape.x = minf(1.08, shape.x + (1.0 - activity) * 0.08)
		shape.y += (1.0 - activity) * 0.95
	return shape
