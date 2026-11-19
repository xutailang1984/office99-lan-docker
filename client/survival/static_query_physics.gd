extends RefCounted
# The authority and local predictor own movement. Web uses Godot for static
# visibility/interaction rays, avoiding unused solver Groups in single-thread builds.
static var enabled := false
static var refresh_count := 0

static func configure(query_only: bool) -> void:
 enabled=query_only
 PhysicsServer2D.set_active(not enabled)
 PhysicsServer3D.set_active(not enabled)

static func refresh_body(value: Variant) -> void:
 if not enabled or not is_instance_valid(value) or not value is StaticBody3D:
  return
 var body: StaticBody3D=value
 if not body.is_inside_tree() or body.is_queued_for_deletion():
  return
 body.force_update_transform()
 for child in body.get_children():
  if child is CollisionShape3D:
   child.force_update_transform()
 PhysicsServer3D.body_set_state(body.get_rid(),PhysicsServer3D.BODY_STATE_TRANSFORM,body.global_transform)
 refresh_count+=1

static func set_disabled(shape: CollisionShape3D, disabled: bool) -> void:
 if not is_instance_valid(shape):
  return
 if bool(shape.get_meta("query_disable_target",shape.disabled))==disabled:
  return
 shape.set_meta("query_disable_target",disabled)
 shape.set_deferred('disabled',disabled)
 if enabled:
  refresh_body.call_deferred(shape.get_parent())
