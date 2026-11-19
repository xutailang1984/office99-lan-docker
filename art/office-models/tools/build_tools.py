"""Original office voxel tools, built by Blender 5.2 in an isolated CLI scene.
No rendering, textures, simulation, gameplay files or open Blender session access.
Coordinates authored as Godot X-right / Y-up / -Z-front, then rotated to Blender.
"""
import bpy, bmesh, math, json, hashlib, os
from pathlib import Path

OUT = Path(__file__).resolve().parent
PALETTE = {'ink':'254556','paper':'FFF2D6','metal':'A9CBD0','red':'E56950','mint':'4DB5BC','gold':'E7B84E','shadow':'D7C49F','lid':'DFA951','toolbox':'355363','dark':'243E4B'}

def rgba(key):
    value=PALETTE.get(key,key)
    raw=[int(value[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in raw)+(1,)

def bcoord(g): return (g[0],-g[2],g[1])

class Geometry:
    def __init__(self): self.verts=[];self.faces=[];self.colors=[]
    def poly(self,points,color):
        start=len(self.verts);self.verts.extend(bcoord(p) for p in points)
        self.faces.append(tuple(range(start,start+len(points))));self.colors.append(rgba(color))
    def box(self,c,s,color):
        x,y,z=c;a,b,d=[v/2 for v in s]
        p=[(x-a,y-b,z-d),(x+a,y-b,z-d),(x+a,y+b,z-d),(x-a,y+b,z-d),(x-a,y-b,z+d),(x+a,y-b,z+d),(x+a,y+b,z+d),(x-a,y+b,z+d)]
        self.closed(p,[(3,2,1,0),(4,5,6,7),(0,4,7,3),(1,2,6,5),(2,3,7,6),(0,1,5,4)],color)
    def closed(self,points,faces,color):
        start=len(self.verts);self.verts.extend(bcoord(p) for p in points)
        for f in faces:self.faces.append(tuple(start+i for i in f));self.colors.append(rgba(color))
    def extrude(self,points,front,back,color):
        n=len(points);p=[(x,y,z) for z in [front,back] for x,y in points]
        f=[tuple(reversed(range(n))),tuple(n+i for i in range(n))]
        for i in range(n):j=(i+1)%n;f.append((i,j,n+j,n+i))
        self.closed(p,f,color)
    def cylinder_y(self,c,r,h,color,n=8):
        x,y,z=c;p=[(x+math.cos(i*math.tau/n)*r,yy,z+math.sin(i*math.tau/n)*r) for yy in [y-h/2,y+h/2] for i in range(n)]
        f=[tuple(range(n)),tuple(n+i for i in reversed(range(n)))]
        for i in range(n):j=(i+1)%n;f.append((i,n+i,n+j,j))
        self.closed(p,f,color)
    def cylinder_z(self,c,r,d,color,n=8):
        x,y,z=c;points=[(x+math.cos(math.tau*(i+.5)/n)*r,y+math.sin(math.tau*(i+.5)/n)*r) for i in range(n)]
        self.extrude(points,z-d/2,z+d/2,color)
    def ring_z(self,c,outer,inner,depth,color,inside,n=12):
        x,y,z=c;front=z-depth/2;back=z+depth/2
        for i in range(n):
            a=i*math.tau/n;b=(i+1)*math.tau/n
            o1=(x+outer*math.cos(a),y+outer*math.sin(a));o2=(x+outer*math.cos(b),y+outer*math.sin(b))
            i1=(x+inner*math.cos(a),y+inner*math.sin(a));i2=(x+inner*math.cos(b),y+inner*math.sin(b))
            self.poly([(o1[0],o1[1],front),(i1[0],i1[1],front),(i2[0],i2[1],front),(o2[0],o2[1],front)],color)
            self.poly([(o1[0],o1[1],back),(o2[0],o2[1],back),(i2[0],i2[1],back),(i1[0],i1[1],back)],color)
            self.poly([(o1[0],o1[1],front),(o2[0],o2[1],front),(o2[0],o2[1],back),(o1[0],o1[1],back)],color)
            self.poly([(i1[0],i1[1],front),(i1[0],i1[1],back),(i2[0],i2[1],back),(i2[0],i2[1],front)],inside)

def bandage(g):
    # Actual hollow roll with a wide loose end; no generic first-aid box.
    g.ring_z((-.012,.079,-.095),.106,.046,.112,'paper','shadow',12)
    g.extrude([(.030,.005),(.047,-.044),(.105,-.044),(.097,.029),(.078,.095),(.061,.065)],-.148,-.055,'paper')
    g.box((.073,-.020,-.152),(.059,.025,.012),'red')
    # Two broad winding accents, attached to the roll's exterior.
    g.box((-.012,.178,-.095),(.038,.015,.115),'shadow')
    g.box((-.012,.178,-.095),(.014,.016,.117),'red')

def repair_kit(g):
    # Refined from the isolated v082 original; coordinates remain unchanged.
    g.box((0,.060,-.099),(.24,.208,.15),'toolbox')
    g.box((0,.175,-.099),(.24,.020,.16),'lid')
    g.box((0,.161,-.099),(.242,.008,.162),'dark')
    for x in [-.060,.060]:g.box((x,.21625,-.095),(.025,.0625,.035),'dark')
    g.box((0,.260,-.095),(.145,.025,.035),'dark')
    g.box((0,.261,-.095),(.081,.031,.039),'red')
    g.box((0,.070,-.178),(.170,.118,.006),'dark')
    for x in [-.083,.083]:
        g.box((x,.156,-.182),(.021,.044,.011),'metal')
        g.box((x,.156,-.189),(.010,.013,.004),'lid')
    points=[(-.012,-.070),(.012,-.070),(.012,.027),(.039,.052),(.039,.085),(.020,.075),(.011,.057),(-.011,.057),(-.020,.075),(-.039,.085),(-.039,.052),(-.012,.027)]
    angle=math.radians(-34);sc=.70
    points=[((x*math.cos(angle)-y*math.sin(angle))*sc,(x*math.sin(angle)+y*math.cos(angle))*sc+.068) for x,y in points]
    g.extrude(points,-.191,-.184,'paper')

def coffee_flask(g):
    # Eight-sided insulated flask, recessed dark seams and a genuine open handle.
    g.cylinder_y((-.014,.104,-.055),.073,.30,'mint')
    g.cylinder_y((-.014,-.036,-.055),.076,.022,'ink')
    g.cylinder_y((-.014,.254,-.055),.079,.028,'ink')
    g.cylinder_y((-.014,.278,-.055),.073,.024,'paper')
    g.box((.073,.180,-.055),(.065,.029,.051),'gold')
    g.box((.108,.103,-.055),(.024,.175,.051),'gold')
    g.box((.073,.028,-.055),(.065,.029,.051),'gold')
    g.box((-.014,.110,-.130),(.074,.080,.013),'paper')
    g.box((-.014,.110,-.139),(.022,.045,.009),'gold')

def flash_note(g):
    # Three offset sheets with a cut/folded corner, a broad lightning silhouette.
    g.box((.004,.059,-.024),(.210,.259,.014),'shadow')
    g.box((-.004,.065,-.042),(.216,.264,.016),'gold')
    g.extrude([(-.110,-.070),(.110,-.070),(.110,.142),(.055,.200),(-.110,.200)],-.077,-.052,'paper')
    g.extrude([(.055,.143),(.110,.142),(.055,.200)],-.083,-.078,'gold')
    g.extrude([(-.006,.155),(-.058,.038),(-.017,.038),(-.035,-.034),(.061,.088),(.016,.088),(.038,.155)],-.088,-.078,'red')
    g.box((-.067,-.049,-.082),(.052,.012,.009),'shadow')

def decoy_alarm(g):
    # Squat octagonal clock face; fixed high-contrast hands, bells and feet.
    g.cylinder_z((0,.106,-.068),.116,.130,'gold',8)
    g.cylinder_z((0,.106,-.139),.098,.014,'ink',8)
    g.cylinder_z((0,.106,-.150),.087,.012,'paper',8)
    for x,y,sx,sy in [(0,.175,.010,.021),(0,.037,.010,.021),(-.069,.106,.021,.010),(.069,.106,.021,.010)]:g.box((x,y,-.161),(sx,sy,.009),'ink')
    g.box((0,.131,-.168),(.014,.064,.008),'ink')
    g.box((.024,.106,-.169),(.060,.014,.009),'ink')
    g.cylinder_z((0,.106,-.177),.014,.010,'red',8)
    for x in [-.075,.075]:
        g.box((x,.206,-.068),(.023,.068,.028),'ink')
        g.cylinder_y((x,.252,-.068),.048,.044,'red',8)
        g.box((x,-.012,-.068),(.043,.030,.076),'ink')
    g.box((0,.243,-.068),(.030,.049,.035),'ink')

BUILDERS={'bandage':bandage,'repair_kit':repair_kit,'coffee_flask':coffee_flask,'flash_note':flash_note,'decoy_alarm':decoy_alarm}
selected = set(filter(None, os.environ.get("OFFICE_ASSET_IDS", "").split(",")))
summary=[]
if selected and (OUT/"asset-stats.json").exists():
    summary=[x for x in json.loads((OUT/"asset-stats.json").read_text(encoding="utf8"))["assets"] if x["id"] not in selected]
for asset_id,builder in BUILDERS.items():
    if selected and asset_id not in selected: continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    g=Geometry();builder(g)
    mesh=bpy.data.meshes.new(asset_id+'_VertexColorMesh');mesh.from_pydata(g.verts,[],g.faces);mesh.update()
    obj=bpy.data.objects.new(asset_id,mesh);bpy.context.collection.objects.link(obj)
    colors=mesh.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER')
    for poly,col in zip(mesh.polygons,g.colors):
        poly.use_smooth=False
        for loop in poly.loop_indices:colors.data[loop].color=col
    mesh.color_attributes.active_color=colors
    material=bpy.data.materials.new('OfficeLinearVertexColors');material.use_nodes=True
    bsdf=material.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Metallic'].default_value=0;bsdf.inputs['Roughness'].default_value=.88
    vertex=material.node_tree.nodes.new('ShaderNodeVertexColor');vertex.layer_name='Col';material.node_tree.links.new(vertex.outputs['Color'],bsdf.inputs['Base Color'])
    mesh.materials.append(material)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    mesh.calc_loop_triangles()
    assert len(mesh.loop_triangles)<=400,(asset_id,len(mesh.loop_triangles))
    scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    # The editable file contains this model alone. No cameras/lights or preview floor.
    blend=OUT/(asset_id+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    target=OUT/(asset_id+'.gltf')
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLTF_SEPARATE',use_selection=True,export_yup=True,export_apply=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=False)
    gltf=json.loads(target.read_text(encoding='utf8'))
    # glTF dependency metadata changes even for color-only external .bin edits.
    gltf['asset']['extras']={'bufferSha256':hashlib.sha256((OUT/gltf['buffers'][0]['uri']).read_bytes()).hexdigest()}
    target.write_text(json.dumps(gltf,ensure_ascii=False,indent=2),encoding='utf8')
    assert len(gltf['meshes'])==1 and len(gltf['meshes'][0]['primitives'])==1
    assert len(gltf.get('materials',[]))==1 and not gltf.get('textures') and not gltf.get('images')
    primitive=gltf['meshes'][0]['primitives'][0]
    assert 'COLOR_0' in primitive['attributes']
    gpoints=[(v.co.x,v.co.z,-v.co.y) for v in mesh.vertices]
    lo=[min(p[i] for p in gpoints) for i in range(3)];hi=[max(p[i] for p in gpoints) for i in range(3)]
    paths=[target,OUT/gltf['buffers'][0]['uri'],blend]
    item={'id':asset_id,'triangles':len(mesh.loop_triangles),'sourceVertices':len(mesh.vertices),'meshObjects':1,'surfaces':1,'materials':1,'textures':0,'boundsGodot':{'min':lo,'max':hi,'size':[hi[i]-lo[i] for i in range(3)]},'exportVertices':gltf['accessors'][primitive['attributes']['POSITION']]['count'],'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths},'originGodot':[0,0,0],'godotUp':'+Y','godotFront':'-Z','vertexColorSpace':'linear COLOR_0','rendered':False}
    summary.append(item)
    print('OFFICE_TOOL_BUILT '+json.dumps({k:item[k] for k in ['id','triangles','surfaces','materials','textures']}))
(OUT/'asset-stats.json').write_text(json.dumps({'blenderVersion':bpy.app.version_string,'candidateOnly':True,'integrated':False,'assets':summary},ensure_ascii=False,indent=2),encoding='utf8')
print('OFFICE_TOOLS_BUILD_COMPLETE')
