extends RefCounted

# Display names only. Stable IDs keep existing adventures and balance compatible.
const TITLE := "办公室的99夜"
const NAMES = {"pistol":"订书手枪","smg":"图钉冲锋枪","lmg":"装订轻机枪","doublebarrel":"双联回形针霰弹枪","dmr":"批注半自动步枪","rod_net":"团建抛网","rod_light":"轻快鱼竿","rod_heavy":"重载鱼竿","rod_magnet":"磁吸打捞竿","carbine":"订书突击步枪", "shotgun":"回形针霰弹枪", "rifle":"签字笔狙击枪", "knife": "拆箱小刀", "rod_basic": "午休鱼竿", "rod_pro": "远投鱼竿", "ammo_light": "订书钉", "ammo_shell": "回形针包", "ammo_heavy": "墨水芯", "bandage": "急救绷带", "catch_shore": "小型渔获", "catch_silver": "旧版银鱼干", "catch_crab": "返工蟹钳", "catch_eel": "电鳗线圈", "treasure": "灵感宝盒", "scrap": "回收零件", "boss_trophy": "搞定奖杯", "silverfish": "便签鱼", "crab": "返工蟹", "eel": "催办电鳗", "boss_crab": "加单巨蟹", "core": "协作灯", "wall": "文件柜墙", "gate": "办公室门", "turret": "自动订书塔"}

# Category colors stay identical on icons, fitted parts and held models.
const EQUIPMENT_COLORS := {"carbine":Color("e56950"),"shotgun":Color("4db5bc"),"rifle":Color("e7b84e"),"pistol":Color("b580d6"),"smg":Color("83b94d"),"lmg":Color("5a7fc3"),"doublebarrel":Color("c58a57"),"dmr":Color("d5e6d8"),"rod_net":Color("ad90c5"),"rod_basic":Color("b98157"),"rod_pro":Color("6489df"),"rod_light":Color("4db5bc"),"rod_heavy":Color("e7b84e"),"rod_magnet":Color("e56950")}
const EQUIPMENT_ROLES := {"carbine":"中程稳定 · 按住连射","shotgun":"近距散射 · 逐发装填","rifle":"远距重击 · 逐发拉栓","pistol":"单击重击 · 装填快","smg":"近距快射 · 腰射灵活","lmg":"站稳压制 · 移动较慢","doublebarrel":"快速两发 · 折开装填","dmr":"连续点射 · 控制后坐","rod_net":"等鱼入网 · 分段收网","rod_basic":"等浮漂动 · 轻松上手","rod_pro":"远投找鱼 · 横移侧拉","rod_light":"收一下停一下 · 逗鱼追饵","rod_heavy":"鱼冲时放线 · 鱼累时收线","rod_magnet":"按住扫底 · 换角解卡"}
