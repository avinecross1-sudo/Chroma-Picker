const path=require('path'), assert=require('assert');
const dir=path.join(__dirname,'..','plugin','js');
const C=globalThis.CPColor=require(path.join(dir,'color.js'));
const SW=require(path.join(dir,'swatches.js')), R=require(path.join(dir,'render.js'));
let n=0; const ok=(c,m)=>{assert(c,m);n++;};
// hex
ok(C.rgbToHex([255,128,0])==='#FF8000','hex'); ok(C.hexToRgb('#f80').join()==='255,136,0','short hex'); ok(C.hexToRgb('zz')===null,'bad hex');
// round trips over random colors
for(let i=0;i<2000;i++){
  const rgb=[Math.random()*255|0,Math.random()*255|0,Math.random()*255|0], hex=C.rgbToHex(rgb);
  for(const m of Object.keys(C.MODES)){ const M=C.MODES[m]; const back=C.rgbToHex(M.to(M.from(rgb))); ok(back===hex, m+' roundtrip '+hex+' -> '+back); }
}
// known Lab values (D50, Photoshop-like): white, black, sRGB red ~ (54.3, 80.8, 69.9)
const w=C.rgbToLab([255,255,255]); ok(Math.abs(w[0]-100)<0.01&&Math.abs(w[1])<0.05&&Math.abs(w[2])<0.05,'white lab '+w);
const red=C.rgbToLab([255,0,0]); ok(Math.abs(red[0]-54.29)<0.3&&Math.abs(red[1]-80.8)<1&&Math.abs(red[2]-69.9)<1,'red lab '+red);
ok(!C.labInGamut([50,127,-128]),'gamut'); ok(C.labInGamut([50,0,0]),'gamut gray');
// hue preserved at s=0
ok(C.MODES.HSB.from([128,128,128],[200,0,50])[0]===200,'hue kept');
// ASE structure
const buf=Buffer.from(SW.toASE([{name:'A',hex:'#FF0000'},{name:'Bb',hex:'#00FF80'}]));
ok(buf.toString('ascii',0,4)==='ASEF'&&buf.readUInt32BE(8)===2,'ase header');
let p=12; for(const nm of ['A','Bb']){ ok(buf.readUInt16BE(p)===1,'block type'); const len=buf.readUInt32BE(p+2); const nl=buf.readUInt16BE(p+6);
  ok(nl===nm.length+1,'name len'); const model=buf.toString('ascii',p+8+nl*2,p+12+nl*2); ok(model==='RGB ','model'); p+=6+len; }
ok(p===buf.length,'ase length');
ok(SW.toGPL('X',[{name:'A',hex:'#0A0B0C'}]).includes(' 10  11  12\tA'),'gpl');
// renderer sanity: sphere under white light, lit side brighter than shadow side, palette ordering
const lin=h=>C.rgbToLinear(C.hexToRgb(h));
const S={albedo:lin('#808080'),sky:lin('#8899BB'),horizon:lin('#CCCCCC'),ground:lin('#665544'),groundEnv:lin('#665544'),lights:[{dir:R.dirFromAngles(30,40),color:[1,1,1],intensity:1,spot:false}],ambient:0.5,specular:0.3,reflectivity:0,subsurface:0,toon:false,chrome:false,fog:0,contrast:1,shape:'sphere',yaw:25,pitch:14,split:null};
const lum=c=>C.luminance(c);
for(const shape of ['sphere','cube','head','asaro']){ S.shape=shape; const r=R.render(S,120,100,1);
  ok(r.rgb.length===120*100*3,'size'); const pl=r.palette; ok(lum(pl.hi)>lum(pl.mid)&&lum(pl.mid)>lum(pl.shadow),shape+' palette order '+JSON.stringify(pl)); }
const t0=Date.now(); R.render(S,220,173,2); console.log('HQ render ms', Date.now()-t0);
// planar head: closed surface (every facet edge off the center line is shared by exactly two facets), and it fills the frame
const H=require(path.join(dir,'head.js')); const edges={};
H.facets.forEach(f=>f.forEach((k,i)=>{ ok(H.points[k],'head point '+k); const e=[k,f[(i+1)%f.length]].sort().join('|'); edges[e]=(edges[e]||0)+1; }));
Object.keys(edges).forEach(e=>{ const [a,b]=e.split('|'), center=H.points[a][0]===0&&H.points[b][0]===0; ok(edges[e]===(center?1:2),'head edge '+e+' used '+edges[e]); });
console.log('passed',n,'assertions');
