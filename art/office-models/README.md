# 办公室体素模型制作源

由本项目用 Blender 5.2.1 LTS 原创制作，无外部模型、贴图或字体依赖。客户端只接收导出的 glTF 和二进制，不打包 Blender 文件。

- `stations/office-stations.blend`：四工作站排布源；茶水间咖啡机、储物柜档案、维修台工具板、回收台进料口。
- `tools/*.blend`：绷带卷、维修箱、保温杯、闪光便签、闹钟。各自以真实手持锚点为原点。
- 每目录的 `build_*.py` 在一个新建的 Blender 后台进程中可以重建该目录的 `.blend` 和 `.gltf` + `.bin`，不要从未保存的个人工程运行。

示例命令（在项目根目录，以新后台进程执行）：

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/office-models/stations/build_stations.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/office-models/tools/build_tools.py
```

作者颜色为 sRGB 调色板，Blender/glTF 存储线性 COLOR_0。运行时的色彩适配由 client/survival/office_assets.gd 统一处理；不可直接替换为未启用顶点色的默认材质。Godot坐标 +Y向上、-Z正面，不要再额外转轴。

每件一个静态网格、一个表面、无贴图。枪械、鱼竿和角色动画骨架继续使用原节点，快捷工具只替换挂点下的几何。
