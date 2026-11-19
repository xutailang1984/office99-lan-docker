extends RefCounted

# Rebuild the existing world schema from acknowledged transport deltas.
# Shallow copies preserve unchanged collections without cloning the whole island.
const COLLECTIONS := ["players", "items", "containers", "buildings", "turrets", "enemies", "destructibles", "projectiles", "nodes", "pools"]
var current: Dictionary = {}
var snapshot_id := -1
var changed: Array = []

func reset() -> void:
	current = {}
	snapshot_id = -1
	changed = []

func apply(message: Dictionary) -> bool:
	var next_id := int(message.get("snapshotId", -1))
	if str(message.get("type", "")) == "state":
		current = message
		snapshot_id = next_id
		changed = message.keys()
		return true
	if current.is_empty() or int(message.get("baseSnapshotId", -2)) != snapshot_id or next_id <= snapshot_id:
		return false
	var next := current.duplicate()
	var fields: Dictionary = message.get("changes", {})
	changed = fields.keys()
	for key in fields:
		next[key] = fields[key]
	for key in message.get("removedKeys", []):
		next.erase(key)
		changed.append(key)
	var groups: Dictionary = message.get("entities", {})
	for key in groups:
		if key not in COLLECTIONS or not groups[key] is Dictionary:
			return false
		var delta: Dictionary = groups[key]
		var removed: Array = delta.get("remove", [])
		var patches: Dictionary = {}
		for patch in delta.get("patch", []):
			patches[str(patch.id)] = patch
		var values: Array = []
		var ids: Dictionary = {}
		for entity in current.get(key, []):
			var id := str(entity.id)
			if id in removed:
				continue
			var value: Dictionary = entity
			if patches.has(id):
				value = entity.duplicate()
				var patch: Dictionary = patches[id]
				for field in patch.get("set", {}):
					value[field] = patch.set[field]
				for field in patch.get("unset", []):
					value.erase(field)
				patches.erase(id)
			ids[id] = values.size()
			values.append(value)
		if not patches.is_empty():
			return false
		for entity in delta.get("upsert", []):
			var id := str(entity.id)
			if ids.has(id):
				values[ids[id]] = entity
			else:
				ids[id] = values.size()
				values.append(entity)
		next[key] = values
		changed.append(key)
	next.type = "state"
	next.snapshotId = next_id
	current = next
	snapshot_id = next_id
	return true
