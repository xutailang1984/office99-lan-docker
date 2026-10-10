// Social toys carry no economic value and never create inventory items.
export const SOCIAL_RULES = Object.freeze({
  range: 3, offerSeconds: 10, offerLimit: 16, cooldownSeconds: 1.2,
  planeRange: 12, planeSeconds: 1.2, planeLifetime: 24, planeLimit: 8,
  markRange: 6, markLifetime: 30, markLimit: 16, ownerMarkLimit: 2,
  paperBallRange: 8, repeatTargetSeconds: 5,
  activityLimit:4,activitySeconds:60,displayLimit:8,
});
export const SOCIAL_STAMPS = Object.freeze([
  {id:'thanks',name:'谢谢',symbol:'★',color:'#ecc15d'},
  {id:'help',name:'帮忙',symbol:'+',color:'#84d7bc'},
  {id:'cheer',name:'加油',symbol:'!',color:'#92d7ec'},
]);
export const SOCIAL_SOUVENIRS = Object.freeze([
  {id:'box_hat',name:'纸箱帽',source:'亲手拆开办公杂物'},
  {id:'rubber_duck',name:'橡皮鸭',source:'完成外勤，或把纸飞机投进靶圈'},
  {id:'cup_trophy',name:'纸杯奖杯',source:'完成一座三层纸杯塔'},
  {id:'portrait_badge',name:'合照工牌',source:'独自拍照，或接受合照邀请'},
  {id:'message_flower',name:'便签花',source:'按图完成三张便签接龙'},
  {id:'field_postcard',name:'外勤明信片',source:'在仓库交付一次外勤'},
  {id:'salvage_bottle',name:'漂流瓶',source:'用磁吸钓具捞起物资'},
  {id:'night_lantern',name:'守夜小灯',source:'成功守住一次夜晚'},
]);
export function socialCatalog() {
  return {rules:{...SOCIAL_RULES},stamps:SOCIAL_STAMPS.map(x=>({...x})),souvenirs:SOCIAL_SOUVENIRS.map(x=>({...x})),
    actions:[{id:'offerCoffee',name:'递咖啡'},{id:'highFive',name:'击掌'},
      {id:'airplane',name:'纸飞机'},{id:'paperBall',name:'纸团'},{id:'stamp',name:'印章'},{id:'cupStack',name:'纸杯叠塔'},{id:'groupPose',name:'合照摆姿'},{id:'noteChain',name:'便签接龙'}]};
}
export const SOUVENIR_IDS=Object.freeze(SOCIAL_SOUVENIRS.map(q=>q.id));
export function collectionOf(value){const row=value??{schema:1,unlocked:[],hat:false};if(row?.schema!==1||!Array.isArray(row.unlocked)||row.unlocked.length>8||new Set(row.unlocked).size!==row.unlocked.length||row.unlocked.some(id=>!SOUVENIR_IDS.includes(id))||typeof row.hat!=='boolean'||row.hat&&!row.unlocked.includes('box_hat'))throw Error('Invalid collection');return structuredClone(row);}
export function mergeCollection(previous,current){const a=collectionOf(previous),b=collectionOf(current);return{schema:1,unlocked:SOUVENIR_IDS.filter(id=>a.unlocked.includes(id)||b.unlocked.includes(id)),hat:b.hat};}
