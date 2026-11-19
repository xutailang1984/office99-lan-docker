"""Original Office99 stations: one vertex-colour surface per fixed anchor.
Coordinates are authored in Godot meters (+Y up, front -Z). No runtime textures.
Run in a NEW background Blender process; user Blender scenes are not touched.
"""
import bpy, math, json, hashlib
from pathlib import Path
OUT=Path(__file__).resolve().parent
PALETTE={'ink':'294957','dark':'173440','mint':'65AAA5','paper':'F2E6CB','gold':'EABB61','rust':'DA8061','metal':'AFCBD0','sage':'91AE7A','screen':'8FDCC1','teal':'447D8B'}
verts=[];faces=[];cols=[]
def color(key):
 v=PALETTE.get(key,key); c=[int(v[i:i+2],16)/255 for i in (0,2,4)]
 return tuple(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in c)+(1,)
def point(g):return (g[0],-g[2],g[1])
def polygon(points,col):
 start=len(verts);verts.extend(point(p) for p in points);faces.append(tuple(range(start,len(verts))));cols.append(color(col))
def box(center,size,col):
 x,y,z=center;a,b,c=[n/2 for n in size]
 v=[(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),(x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)]
 for f in [(3,2,1,0),(4,5,6,7),(0,4,7,3),(1,2,6,5),(2,3,7,6),(0,1,5,4)]:polygon([v[i] for i in f],col)
def prism(outline,z0,z1,col):
 # Clockwise front is -Z; include a solid rear so every station reads from both sides.
 polygon([(x,y,z0) for x,y in reversed(outline)],col)
 polygon([(x,y,z1) for x,y in outline],col)
 for i in range(len(outline)):
  j=(i+1)%len(outline);a,b=outline[i],outline[j]
  polygon([(a[0],a[1],z0),(b[0],b[1],z0),(b[0],b[1],z1),(a[0],a[1],z1)],col)
def chamfer(center,size,cut,col):
 x,y,z=center;w,h,d=size;a=w/2;b=h/2;c=min(cut,a,b)
 p=[(x-a+c,y-b),(x+a-c,y-b),(x+a,y-b+c),(x+a,y+b-c),(x+a-c,y+b),(x-a+c,y+b),(x-a,y+b-c),(x-a,y-b+c)]
 prism(p,z-d/2,z+d/2,col)
def legible_stripes(x,y,z,col='paper'):
 for dy,w in [(0,.32),(-.075,.21)]:box((x,y+dy,z),(w,.027,.012),col)
def base(col):
 box((0,.08,0),(1.60,.16,.94),'dark')
 box((0,.60,0),(1.60,.88,.94),col)
 box((0,1.055,0),(1.65,.09,1.0),'paper')
 box((0,.18,-.48),(1.58,.09,.018),'dark')
 for side in [-1,1]:
  box((side*.803,.58,0),(.018,.76,.73),col)
  for z in [-.23,0,.23]:box((side*.816,.50,z),(.012,.025,.10),'dark')
def supply():
 base('mint')
 for x in [-.40,.4]:
  box((x,.61,-.478),(.73,.67,.018),'ink')
  box((x,.91,-.50),(.24,.042,.035),'gold')
 # Coffee / supply dispenser and visible tray: no large floating sign.
 chamfer((.35,1.37,.12),(.62,.54,.53),.055,'dark')
 box((.35,1.47,-.156),(.43,.22,.015),'mint')
 box((.35,1.52,-.168),(.28,.04,.012),'screen')
 box((.35,1.34,-.17),(.08,.11,.06),'metal')
 box((.35,1.115,-.15),(.51,.035,.37),'ink')
 box((.35,1.20,-.21),(.15,.16,.16),'paper')
 box((.454,1.22,-.21),(.06,.08,.07),'gold')
 for i in range(3):
  box((-.50+i*.12,1.14,.15),(.10,.08,.42),'rust' if i%2 else 'paper')
 box((-.45,1.20,-.27),(.28,.19,.16),'gold')
 legible_stripes(-.45,1.235,-.358,'dark')
 # Rear machine casing has a small normal vent pattern.
 for x in [.17,.35,.53]:box((x,1.4,.39),(.10,.018,.015),'teal')
def storage():
 base('ink')
 for x in [-.4,.4]:
  for row in range(2):
   y=.41+row*.39
   box((x,y,-.48),(.735,.33,.027),'teal' if row else 'mint')
   box((x,y+.075,-.51),(.25,.042,.055),'metal')
   box((x-.20,y-.08,-.502),(.19,.065,.012),'paper')
 # Three distinct folders held by two bookends, below eye-level.
 for i in range(4):
  x=-.35+i*.20
  box((x,1.23,.12),(.17,.26,.38),'paper' if i%2 else 'gold')
  box((x,1.32,-.08),(.10,.06,.03),'rust' if i==2 else 'mint')
 for x in [-.50,.46]:
  box((x,1.22,.12),(.035,.25,.40),'dark')
 box((0,.58,.478),(1.36,.62,.018),'teal')
 legible_stripes(0,.67,.492)
def upgrade():
 base('rust')
 for x in [-.4,.4]:
  box((x,.59,-.48),(.72,.65,.02),'dark')
  box((x,.72,-.50),(.27,.06,.04),'gold')
 # Perforated toolboard contour, vice and loose hardware.
 box((0,1.37,.385),(1.38,.55,.055),'ink')
 box((0,1.67,.385),(1.45,.05,.07),'gold')
 for x in [-.51,-.34,.34,.51]:
  for y in [1.25,1.40,1.55]:box((x,y,.348),(.035,.035,.015),'metal')
 # Open-jaw spanner emblem is actual silhouette geometry, not a medical cross.
 outline=[(-.035,1.16),(.035,1.16),(.035,1.44),(.13,1.50),(.13,1.61),(.075,1.59),(.055,1.53),(-.055,1.53),(-.075,1.59),(-.13,1.61),(-.13,1.50),(-.035,1.44)]
 prism(outline,.312,.328,'paper')
 box((-.37,1.14,-.18),(.51,.08,.38),'dark')
 for x in [-.56,-.21]:box((x,1.26,-.17),(.14,.18,.28),'metal')
 box((-.38,1.19,-.17),(.45,.08,.12),'teal')
 for i in range(2):box((.38,1.14+i*.055,-.18),(.30,.045,.26),'gold' if i else 'metal')
 box((0,.65,.48),(1.32,.22,.018),'ink')
 for x in [-.44,0,.44]:box((x,.65,.495),(.24,.045,.014),'gold')
def recycle():
 base('sage')
 # Receiving chute: chamfered rim and dark recess stay inside the body footprint.
 chamfer((0,.70,-.487),(1.14,.36,.035),.06,'dark')
 box((0,.76,-.51),(.92,.10,.025),'ink')
 box((0,.57,-.53),(1.04,.06,.11),'gold')
 for x in [-.58,.58]:box((x,.68,-.51),(.035,.26,.025),'paper')
 box((0,1.12,.15),(1.16,.045,.55),'ink')
 for i in range(3):
  box((-.33+i*.32,1.17,.17),(.29,.06,.38),'paper' if i!=1 else 'gold')
  box((-.33+i*.32,1.208,.17),(.042,.008,.38),'mint')
 # Recycling arrows on a rear upright, also readable when approached from behind.
 box((0,1.35,.365),(.72,.43,.055),'sage')
 for z in [.329,.402]:
  for flip in [-1,1]:
   x=flip*.13;y=1.36+flip*.07
   box((x,y,z),(.28,.042,.014),'paper')
   prism([(flip*.28,y),(flip*.17,y-.08),(flip*.17,y+.08)],z-.008,z+.008,'paper')
 legible_stripes(0,.64,.485,'dark')

bpy.ops.wm.read_factory_settings(use_empty=True)
mat=bpy.data.materials.new('OfficeVertexColours');mat.use_nodes=True
bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.88
v=mat.node_tree.nodes.new('ShaderNodeVertexColor');v.layer_name='Col';mat.node_tree.links.new(v.outputs['Color'],bs.inputs['Base Color'])
rows=[]
for name,fn in [('station_supply',supply),('station_storage',storage),('station_upgrade',upgrade),('station_recycle',recycle)]:
 verts=[];faces=[];cols=[];fn()
 mesh=bpy.data.meshes.new(name+'_mesh');mesh.from_pydata(verts,[],faces);mesh.update()
 obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
 attr=mesh.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER');mesh.color_attributes.active_color=attr
 for poly,col in zip(mesh.polygons,cols):
  for index in poly.loop_indices:attr.data[index].color=col
 mesh.materials.append(mat);mesh.calc_loop_triangles()
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
 # Explicit single selected model; no cameras/lights/exported scene extras.
 filepath=OUT/(name+'.gltf')
 bpy.ops.export_scene.gltf(filepath=str(filepath),export_format='GLTF_SEPARATE',use_selection=True,export_yup=True,export_apply=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=False)
 raw=json.loads(filepath.read_text(encoding='utf-8'))
 assert not raw.get('images') and len(raw['meshes'])==1 and len(raw['meshes'][0]['primitives'])==1
 tri=len(mesh.loop_triangles);assert tri<=550,(name,tri)
 points=[(p.co.x,p.co.z,-p.co.y) for p in mesh.vertices];lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
 rows.append({'id':name,'triangles':tri,'surfaces':1,'materials':1,'textures':0,'bounds':{'min':lo,'max':hi},'bytes':sum((OUT/f).stat().st_size for f in [name+'.gltf',raw['buffers'][0]['uri']]),'gltfSha256':hashlib.sha256(filepath.read_bytes()).hexdigest()})
 obj.hide_render=True;obj.hide_set(True)
for i,obj in enumerate(bpy.context.scene.objects):
 obj.hide_render=False;obj.hide_set(False);obj.location.x=i*2.4
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'office-stations.blend'))
(OUT/'manifest.json').write_text(json.dumps({'version':'0.8.3','blender':bpy.app.version_string,'coordinates':'Godot +Y up / front -Z / base ground at Y=0','license':'Original project geometry; no external assets','items':rows},indent=2),encoding='utf-8')
print('OFFICE_STATIONS_BUILT '+json.dumps(rows))
