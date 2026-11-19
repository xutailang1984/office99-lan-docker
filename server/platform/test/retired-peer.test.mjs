import test from 'node:test';
import assert from 'node:assert/strict';
import {roomHasPeer,rememberRetiredMembers,isRetiredRelayNotice} from '../../../client/platform/retired-peer.mjs';
const room=(ids=['host'],epoch=1,id='room-a')=>({id,epoch,members:ids.map(peerId=>({peerId}))});
const notice=extra=>({type:'relay_error',code:'NOT_MEMBER',roomId:'room-a',epoch:1,to:'old',...extra});
test('only an actual retired member of this exact room/epoch can suppress NOT_MEMBER',()=>{
 const retired=new Set();rememberRetiredMembers(room(['host','old']),room(),retired);
 assert(retired.has('old'));assert(isRetiredRelayNotice(notice(),room(),retired));
 for(const m of [notice({to:'unknown'}),notice({to:'host'}),notice({roomId:'other'}),notice({epoch:2}),notice({epoch:'1'}),notice({code:'RATE_LIMIT'}),notice({type:'fatal'}),notice({roomId:undefined}),notice({epoch:undefined}),notice({to:undefined}),notice({to:'x'.repeat(129)})])assert.equal(isRetiredRelayNotice(m,room(),retired),false);
 assert.equal(isRetiredRelayNotice(notice(),room(['host','old']),retired),false);
 assert.equal(isRetiredRelayNotice(notice(),null,retired),false);
});
test('rejoining, changing room/epoch and bounded history cannot turn unknown targets into retired members',()=>{
 const retired=new Set();rememberRetiredMembers(room(['host','old']),room(),retired);rememberRetiredMembers(room(),room(['host','old']),retired);assert(!retired.has('old'));assert(roomHasPeer(room(['host','old']),'old'));
 for(let i=0;i<150;i++)rememberRetiredMembers(room(['host','retired-'+i]),room(),retired);assert.equal(retired.size,128);assert(!retired.has('retired-0'));assert(retired.has('retired-149'));
 rememberRetiredMembers(room(),room(['host'],2),retired);assert.equal(retired.size,0);retired.add('old');rememberRetiredMembers(room(),room(['host'],1,'room-b'),retired);assert.equal(retired.size,0);
});
