export const VERSION='moba-0.5.0';
export const RULES=Object.freeze({players:10,teamSize:5,hz:30,snapshotHz:20,waveSeconds:30,firstWave:45,maxUnits:180,maxLevel:18,vision:24,brushVision:3,startingGold:500,passiveGold:2.5,checkpointSeconds:2,itemSlots:6,recallSeconds:8});
const skill=(name,hint,cooldown,mana,range,radius=0,target='direction',icon='bolt',windup=.16)=>({name,hint,cooldown,mana,range,radius,target,icon,windup});
export const HEROES={
 stapler:{name:'速印弩手',role:'射手',roleId:'marksman',lane:2,style:'持续输出',icon:'crossbow',color:'#e6b84a',weapon:'crossbow',hp:820,mana:320,speed:6.7,attack:65,range:10,interval:.82,armor:18,passive:'连续攻击同一目标，每第三箭更强。',weakness:'没有位移，需要队友保护。',
  skills:{q:skill('穿页箭','纸箭直线穿透敌人。',7,35,15,1,'direction','pierce'),e:skill('封箱带','洒出胶带，减速范围内敌人。',12,40,9,2.5,'point','zone',.25),r:skill('加急连印','六秒内提高攻速和射程。',55,90,0,0,'self','rapid')}},
 courier:{name:'外勤影客',role:'打野',roleId:'jungle',lane:-1,style:'近身收割',icon:'blades',color:'#44b9b0',weapon:'knife',hp:930,mana:350,speed:7.3,attack:75,range:2.3,interval:.9,armor:24,passive:'脱战后首次攻击更强，对野怪伤害提高。',weakness:'突进交出后难以撤退。',
  skills:{q:skill('急送','向前冲刺，伤害沿途敌人。',8,35,7,1.2,'direction','dash'),e:skill('签收钩','钩中首个敌人并拉近。',12,45,12,.75,'direction','hook'),r:skill('最后一单','突袭选中敌人，残血时更强。',50,85,10,0,'enemy','execute')}},
 printer:{name:'印章术师',role:'法师',roleId:'mage',lane:1,style:'单体爆发',icon:'stamp',color:'#bb779f',weapon:'stamp',hp:760,mana:460,speed:6.5,attack:42,range:8.5,interval:1.05,armor:14,passive:'技能命中三次引爆印记，还能削掉护盾。',weakness:'没有位移，技能交完需要退让。',
  skills:{q:skill('飞章','飞出公章，击中首个敌人。',6,35,13,.65,'direction','stamp'),e:skill('暂缓','定身选中的敌人，仍可攻击。',12,55,8,0,'enemy','bind',.25),r:skill('终审','巨章砸向选中敌人，造成高伤害。',55,100,9,0,'enemy','burst',.45)}},
 guardian:{name:'档案铁卫',role:'坦克',roleId:'tank',lane:0,style:'主动开团',icon:'shield',color:'#6f9bcd',weapon:'fists',hp:1300,mana:330,speed:6.1,attack:54,range:2.6,interval:1,armor:42,passive:'持续承伤时获得短暂护盾。',weakness:'攻击距离短，容易被远处牵制。',
  skills:{q:skill('开路','冲向前方，撞晕首个英雄。',11,40,7,1.6,'direction','dash'),e:skill('护档','为自己加盾，队友共享最多两人份护盾。',13,45,0,4.5,'self','shield'),r:skill('全员留步','蓄力砸地，击飞附近敌人。',65,90,0,5,'self','burst',.6)}},
 barista:{name:'茶水搭子',role:'辅助',roleId:'support',lane:2,style:'治疗续航',icon:'cup',color:'#e58f9c',weapon:'cup',hp:850,mana:480,speed:6.8,attack:38,range:8,interval:1,armor:20,passive:'照顾受伤队友时治疗更强，附近助攻有额外收入。',weakness:'独自清线和爆发能力低。',
  skills:{q:skill('续杯','治疗选中队友，未选中则治疗自己。',7,45,10,0,'ally','heal'),e:skill('保温','周围队友分盾，最多三人份。',13,60,0,5,'self','shield'),r:skill('茶歇时间','茶桌每次治疗区内伤势最重的三人。',65,110,9,5,'point','zone')}},
 archer:{name:'橡皮筋游侠',role:'射手',roleId:'marksman',lane:2,style:'换位强攻',icon:'bow',color:'#83c653',weapon:'bow',hp:800,mana:340,speed:6.8,attack:62,range:9.5,interval:1,armor:17,passive:'技能后下一次普攻更强，不能叠加。',weakness:'位移有冷却，持续输出较低。',skills:{q:skill('穿线箭','射出穿透长箭。',7,35,15,.6,'direction','pierce'),e:skill('弹步','翻滚换位，强化下一箭。',10,40,4.5,0,'direction','dash'),r:skill('满弦','拉满大弓，射出强力穿透箭。',52,90,19,1,'direction','bow',.4)}},
 mechanic:{name:'检修斗士',role:'打野',roleId:'jungle',lane:-1,style:'持续近战',icon:'wrench',color:'#ed9345',weapon:'wrench',hp:1050,mana:350,speed:6.6,attack:70,range:2.6,interval:.95,armor:28,passive:'技能后下一次普攻恢复生命，对野怪伤害提高。',weakness:'攻击距离短，怕远程拉扯。',skills:{q:skill('扳手横扫','横扫身边敌人。',7,35,0,3.2,'self','sweep',.25),e:skill('赶修','短时加速追近敌人。',12,40,0,0,'self','dash'),r:skill('满载运转','六秒内加快近战攻击。',60,90,0,0,'self','rapid')}},
 lecturer:{name:'投影讲师',role:'法师',roleId:'mage',lane:1,style:'范围控场',icon:'projector',color:'#8d8bea',weapon:'light',hp:780,mana:480,speed:6.5,attack:40,range:8,interval:1.05,armor:15,passive:'对移动受限的敌人造成更多技能伤害。',weakness:'单体爆发低，怕敌人贴身。',skills:{q:skill('光幕','投下光幕，伤害并减速。',7,40,11,2.7,'point','zone',.25),e:skill('定格','短暂延迟后定身区域内敌人。',12,55,11,2.5,'point','bind',.6),r:skill('全屏演示','内圈伤害更高，整个投影区减速。',65,110,12,4.5,'point','projector',.35)}},
 custodian:{name:'保洁队长',role:'坦克',roleId:'tank',lane:0,style:'反手保护',icon:'mop',color:'#39a6aa',weapon:'mop',hp:1250,mana:350,speed:6.2,attack:52,range:2.7,interval:1.1,armor:40,passive:'身边有队友时，受到的伤害降低。',weakness:'缺少突进，防护挡不住绕后。',skills:{q:skill('清场','向前横扫，击退敌人。',9,40,4,0,'direction','sweep',.25),e:skill('挡板','举板三秒，身后队友也能少受正面普攻。',13,45,0,0,'direction','shield'),r:skill('大扫除','清洁浪击退并击晕前方敌人。',60,90,7,0,'direction','waves',.45)}},
 broadcaster:{name:'广播搭子',role:'辅助',roleId:'support',lane:2,style:'带队进退',icon:'speaker',color:'#c5aaee',weapon:'sound',hp:850,mana:460,speed:6.9,attack:38,range:8,interval:1,armor:20,passive:'技能协助的队友击败敌人时可获得助攻。',weakness:'没有治疗，独自战斗较弱。',skills:{q:skill('点名','声波击中首个敌人，伤害并减速。',7,35,13,.8,'direction','speaker'),e:skill('集合','解除当前减速，带身边队友加速三秒。',13,55,0,5,'self','group'),r:skill('静音通知','扇形声波让敌人暂时不能放技能。',65,100,8,0,'direction','mute',.35)}}
};
// Four familiar ability slots. W adds a clear utility decision to each existing kit.
const utility={
 stapler:skill('换匣','重置普攻，下一箭更强。',13,35,0,0,'self','rapid',.08),
 archer:skill('散页箭','扇形射出三箭，减速敌人。',11,45,12,.5,'direction','bow',.18),
 courier:skill('赶路','加速三秒，获得短暂护盾。',14,40,0,0,'self','dash',.08),
 mechanic:skill('隔热服','获得护盾，挡住贴身反击。',14,45,0,0,'self','shield',.08),
 printer:skill('退件','身边墨浪伤害并减速敌人。',13,50,0,3.8,'self','zone',.2),
 lecturer:skill('护眼屏','为选中队友加盾，未选中则给自己。',12,45,10,0,'ally','shield',.12),
 guardian:skill('震档','近身震击，减速周围敌人。',10,40,0,3.8,'self','sweep',.22),
 custodian:skill('湿地牌','铺下湿地，减速经过的敌人。',12,45,8,3,'point','zone',.2),
 barista:skill('热茶','投出茶滴，伤害并减速首个敌人。',9,40,12,.65,'direction','cup',.15),
 broadcaster:skill('好消息','为选中队友加盾，未选中则给自己。',12,45,10,0,'ally','shield',.12)
};
for(const [id,hero]of Object.entries(HEROES)){
 hero.skills={q:hero.skills.q,w:utility[id],e:hero.skills.e,r:hero.skills.r};
 for(const def of Object.values(hero.skills))def.damageType=['mage','support'].includes(hero.roleId)?'magic':'physical';
}
export const damageTypeFor=(heroId,kind='attack')=>kind==='smite'?'true':kind==='attack'||kind==='tower'?'physical':['mage','support'].includes(HEROES[heroId]?.roleId)?'magic':'physical';
export const MINION_REWARDS=Object.freeze({melee:{gold:21,xp:60},ranged:{gold:14,xp:30},siege:{gold:60,xp:90},super:{gold:60,xp:90}});
export const SUPPORT_INCOME=Object.freeze({capacity:30,perMinute:120,lastHit:8,combat:10,combatCooldown:8,radius:16});
export const HERO_IDS=Object.keys(HEROES);
// One decision a new player can use in lane, with allies, or against this hero.
export const TACTICS={
 stapler:['胶带减速，再连射同一目标。','队友赶走刺客，你跟兵点塔。','从侧面逼他换目标，打断第三箭。'],
 archer:['穿箭接普攻，翻滚后再补一箭。','等队友留人，从侧面射穿后排。','先逼出翻滚，再上前抓她。'],
 courier:['钩近接普攻，留突袭追残血。','队友压低后排血量，你从侧面收尾。','用小兵挡钩，留定身防突袭。'],
 mechanic:['加速贴身，每次用技能后敲一下回血。','守住野区入口，让他安心打巨蟹。','拉开距离，让他敲不到人回血。'],
 printer:['先定身，再飞章、砸大章引爆。','队友留住目标，三次命中能破盾。','小兵能挡飞章，等定身交掉再切入。'],
 lecturer:['光幕减速，再定格，把人留在投影里。','把投影铺在路口，接队友的减速或眩晕。','从另一侧进场，别在投影里久留。'],
 guardian:['先撞晕，等队友跟上再砸地。','站在队友够得着的位置开团。','分散站位，横移躲冲锋。'],
 custodian:['面对来敌举板，贴近后把人扫走。','让射手站在板后，转向挡住敌方普攻。','绕向侧后方，避开挡板正面。'],
 barista:['先套盾接伤，再给受伤队友续杯。','把茶桌放在队友能守住的兵线旁。','逼队友离开茶桌，再集中打一个人。'],
 broadcaster:['先减速，再带队接近，留沉默断施法。','等队友被减速，再集合带队冲出路口。','分开躲扇面，沉默时仍能走和普攻。']
};
export const ROLE_IDS=['marksman','jungle','mage','tank','support'];
export const ROLE_HEROES=Object.fromEntries(ROLE_IDS.map(role=>[role,HERO_IDS.filter(id=>HEROES[id].roleId===role)]));
export const defaultTeam=team=>ROLE_IDS.map(role=>ROLE_HEROES[role][team%2]);
export const ITEMS={
 boots:{name:'轻便鞋',icon:'boot',price:450,speed:1,branch:'utility',hint:'走位、追击和支援更快。'},
 stapler:{name:'强力钉',icon:'bolt',price:600,attack:22,branch:'output',hint:'强化普攻与物理技能。'},
 battery:{name:'备用电',icon:'battery',price:650,power:45,mana:100,branch:'output',hint:'强化法术与治疗。'},
 vest:{name:'防护衣',icon:'shield',price:650,armor:22,hp:100,branch:'survival',hint:'抵挡普攻与物理技能。'},
 flask:{name:'保温杯',icon:'cup',price:650,magicResist:22,hp:100,branch:'survival',hint:'抵挡法师与辅助的技能伤害。'},
 timer:{name:'计时器',icon:'clock',price:700,haste:.15,mana:100,branch:'utility',hint:'更频繁地使用技能。'},
 belt:{name:'连发器',icon:'crosshair',price:750,attack:12,attackSpeed:.2,branch:'output',hint:'持续普攻更快。'},
 badge:{name:'协作章',icon:'heart',price:650,power:25,hp:120,healing:.15,branch:'utility',hint:'提高治疗，保护队友。'}
};
export const RECOMMENDED={stapler:['boots','stapler','belt'],courier:['boots','stapler','vest'],printer:['battery','boots','timer'],guardian:['vest','boots','flask'],barista:['badge','boots','timer']};
export const LANES={stapler:'下路 · 持续输出',courier:'野区 · 游走支援',printer:'中路 · 清线控场',guardian:'上路 · 扛伤开团',barista:'下路 · 保护队友'};
Object.assign(RECOMMENDED,{archer:['boots','stapler','timer'],mechanic:['boots','stapler','flask'],lecturer:['battery','boots','timer'],custodian:['vest','boots','flask'],broadcaster:['badge','boots','timer']});
for(const id of HERO_IDS)LANES[id]=({marksman:'下路',jungle:'野区',mage:'中路',tank:'上路',support:'游走'})[HEROES[id].roleId]+' · '+HEROES[id].style;
export const upgradePrice=id=>Math.ceil(ITEMS[id].price*1.5);
export const skillRank=(hero,key)=>hero.skillRanks?.[key]??0;
export const skillPoints=hero=>Math.max(0,hero.level-Object.values(hero.skillRanks??{}).reduce((a,b)=>a+b,0));
export const canLearn=(hero,key)=>['q','w','e','r'].includes(key)&&skillPoints(hero)>0&&(key==='r'?skillRank(hero,key)<3&&hero.level>=6+skillRank(hero,key)*5:skillRank(hero,key)<5&&hero.level>=skillRank(hero,key)*2+1);
export function stats(hero){
 const base=HEROES[hero.heroId],level=hero.level-1;
 const out={hp:base.hp+level*70,mana:base.mana+level*22,attack:base.attack+level*4,power:level*4,armor:base.armor+level*2.4,magicResist:30+level*1.5,speed:base.speed,range:base.range,interval:base.interval,haste:0,attackSpeed:0,regen:2,healing:0};
 for(const id of hero.items??[])for(const [key,value]of Object.entries(ITEMS[id]??{}))if(key in out&&typeof value==='number')out[key]+=value*(hero.itemRanks?.[id]===1?1.5:1);
 out.interval/=1+out.attackSpeed;out.haste=Math.min(.35,out.haste);return out;
}
