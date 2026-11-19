"""Original office voxel tools, built by Blender 5.2 in an isolated CLI scene.
No rendering, textures, simulation, gameplay files or open Blender session access.
Coordinates authored as Godot X-right / Y-up / -Z-front, then rotated to Blender.
"""
import bpy, bmesh, math, json, hashlib
from pathlib import Path

OUT = Path(__file__).resolve().parent
PALETTE = {'ink':'254556','paper':'FFF2D6','metal':'A9CBD0','red':'E56950','mint':'4DB5BC','gold':'E7B84E','shadow':'D7C49F','lid':'DFA951','toolbox':'355363','dark':'243E4B','purple':'B580D6','green':'83B94D','blue':'5A7FC3'}

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


def pistol(g):
    # Compact office stapler: open jaw and broad rear palm grip.
    g.box((0,.015,-.25),(.19,.16,.51),'purple')
    g.box((0,-.071,-.26),(.145,.025,.51),'metal')
    g.box((0,-.112,-.22),(.21,.047,.54),'ink')
    g.box((0,-.22,.025),(.14,.32,.16),'ink')
    g.box((0,.112,-.25),(.15,.035,.34),'paper')
    for x in [-.10,.10]:g.box((x,.015,-.015),(.018,.08,.095),'metal')
    g.box((0,.017,-.515),(.11,.075,.014),'ink')
    g.box((0,.017,-.524),(.053,.025,.008),'gold')

def smg(g):
    # Short chunky thumb-tack applicator with a forward support grip.
    g.box((0,.02,-.28),(.20,.20,.60),'green')
    g.box((0,-.018,-.625),(.135,.13,.16),'ink')
    g.box((0,-.018,-.716),(.16,.155,.023),'metal')
    g.box((0,-.018,-.731),(.076,.065,.012),'ink')
    g.box((0,-.21,.015),(.13,.31,.15),'ink')
    g.box((0,-.19,-.54),(.125,.23,.15),'green')
    g.box((0,.09,-.14),(.16,.064,.17),'paper')
    for x in [-.105,.105]:
        for z in [-.39,-.30,-.21]:g.box((x,.023,z),(.012,.08,.036),'ink')
    g.box((0,.025,.10),(.15,.12,.18),'ink')
    g.box((0,-.04,.23),(.18,.25,.08),'green')

def lmg(g):
    # Wide ring binder feed block with ribbed long front and folded support legs.
    g.box((0,.012,-.26),(.34,.235,.61),'blue')
    # Outer lid extends beyond both receiver sides; never share their depth plane.
    g.box((0,.13,-.30),(.36,.026,.48),'ink')
    g.box((0,.149,-.30),(.25,.013,.29),'paper')
    g.box((0,.01,-.72),(.16,.15,.35),'ink')
    for z in [-.58,-.66,-.74,-.82]:g.box((0,.01,z),(.215,.20,.028),'metal')
    g.box((0,.01,-.926),(.22,.195,.075),'blue')
    g.box((0,.01,-.967),(.10,.07,.012),'ink')
    g.box((0,-.19,.035),(.17,.30,.18),'ink')
    g.box((0,.006,.16),(.19,.18,.26),'ink')
    g.box((0,-.035,.32),(.26,.26,.08),'blue')
    for x in [-.14,.14]:g.box((x,-.15,-.65),(.026,.035,.40),'ink')
    for x in [-.175,.175]:g.box((x,.035,-.26),(.012,.094,.24),'paper')

def rod(g,kind):
    col={'rod_light':'mint','rod_heavy':'gold','rod_magnet':'red'}[kind]
    shaft=.027 if kind=='rod_light' else (.048 if kind=='rod_heavy' else .038)
    height=1.30
    g.box((0,.02,0),(.07,.30,.075),'ink')
    g.box((0,.72,0),(shaft,1.15,shaft),col)
    for y in [.21,.69,1.23]:g.box((0,y,0),(shaft+.015,.035,shaft+.015),'metal')
    g.cylinder_z((.07,.13,0),.067 if kind=='rod_light' else .09,.078,col,8)
    g.cylinder_z((.07,.13,-.047),.035,.015,'ink',8)
    g.box((.12,.13,-.068),(.075,.022,.02),'metal')
    g.box((.155,.11,-.095),(.03,.075,.052),'ink')
    for y in [.50,.9,1.29]:g.ring_z((0,y,-.032),.035,.022,.018,'metal','metal',8)
    if kind=='rod_heavy':
        g.box((-.045,.035,0),(.018,.27,.09),col)
        g.box((.045,.035,0),(.018,.27,.09),col)
        g.box((0,.37,0),(.058,.15,.058),'ink')
    if kind=='rod_magnet':
        # U magnet on the reel housing, distinguishable at first-person scale.
        for x in [-.038,.038]:
            g.box((x,.28,-.105),(.028,.12,.043),'red')
            g.box((x,.34,-.105),(.029,.035,.044),'metal')
        g.box((0,.225,-.105),(.10,.03,.043),'red')

BUILDERS={'pistol':pistol,'smg':smg,'lmg':lmg,'rod_light':lambda g:rod(g,'rod_light'),'rod_heavy':lambda g:rod(g,'rod_heavy'),'rod_magnet':lambda g:rod(g,'rod_magnet')}
summary=[]
for asset_id,builder in BUILDERS.items():
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
    assert len(mesh.loop_triangles)<=700,(asset_id,len(mesh.loop_triangles))
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
    print('S1_EQUIPMENT_BUILT '+json.dumps({k:item[k] for k in ['id','triangles','surfaces','materials','textures']}))
(OUT/'asset-stats.json').write_text(json.dumps({'blenderVersion':bpy.app.version_string,'candidateOnly':True,'integrated':False,'assets':summary},ensure_ascii=False,indent=2),encoding='utf8')
print('OFFICE_TOOLS_BUILD_COMPLETE')
