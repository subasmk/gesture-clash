const assert=require('node:assert/strict');const {shotHit,validatePosition,localAddresses}=require('./logic');
let count=0;function test(n,f){f();console.log('PASS',n);count++;}
const s={x:0,z:8,yaw:-Math.PI/2,pitch:0},t={x:5,z:8};
test('horizontal body hit',()=>assert.equal(shotHit(s,t,[]).hit,true));
test('upward miss',()=>assert.equal(shotHit({...s,pitch:.9},t,[]).hit,false));
test('downward miss',()=>assert.equal(shotHit({...s,pitch:-.9},t,[]).hit,false));
test('cover blocks',()=>assert.equal(shotHit(s,t,[{x:2,z:8,w:1,d:2,h:3}]).blocked,true));
test('nonfinite rejected',()=>assert.equal(shotHit({...s,yaw:Infinity},t,[]).hit,false));
const p={x:0,z:0,yaw:0,pitch:0};
test('teleport capped',()=>assert.ok(validatePosition(p,{x:100,z:0,yaw:0,pitch:0},.1,{size:46,boxes:[]}).x<.8));
test('cover collision',()=>assert.ok(validatePosition(p,{x:1,z:0},.2,{size:46,boxes:[{x:1,z:0,w:.5,d:2}]}).x<.25));
test('wifi preferred virtual excluded',()=>assert.deepEqual(localAddresses({Docker:[{family:'IPv4',address:'172.18.0.1'}],'Wi-Fi':[{family:'IPv4',address:'192.168.1.2'}],bad:[{family:'IPv4',address:'169.254.0.1'}]}),['192.168.1.2','172.18.0.1']));
console.log(count,'logic tests passed');
