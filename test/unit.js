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
for(const shape of ['sphere','cube','asaro','asaroLow']){ S.shape=shape; const r=R.render(S,120,100,1);
  ok(r.rgb.length===120*100*3,'size'); const pl=r.palette; ok(lum(pl.hi)>lum(pl.mid)&&lum(pl.mid)>lum(pl.shadow),shape+' palette order '+JSON.stringify(pl)); }
const t0=Date.now(); R.render(S,220,173,2); console.log('HQ render ms', Date.now()-t0);
// edge smoothing only touches edge pixels: flat areas match the plain render, and the silhouette gains in-between tones
S.shape='asaro'; { const a=R.render(S,90,110,1), b=R.render(S,90,110,1,3); let same=0,diff=0; for(let i=0;i<a.rgb.length;i+=3){ if(a.rgb[i]===b.rgb[i]&&a.rgb[i+1]===b.rgb[i+1]&&a.rgb[i+2]===b.rgb[i+2]) same++; else diff++; }
  ok(diff>50&&same>diff,'edge pass changed '+diff+' of '+(same+diff)+' pixels'); ok(a.rgb[0]===b.rgb[0],'corner untouched'); }
// OBJ import: quads, concave n-gons, negative indices, mixed winding, welding, reduction, lossless quarter turns
const O=require(path.join(dir,'obj.js'));
const words=b=>{const x=Buffer.from(b,'base64');const o=[];for(let i=0;i+1<x.length;i+=2)o.push(x.readUInt16LE(i));return o;};
const vol=d=>{const p=words(d.points),t=words(d.tris);let v=0;const P=i=>[p[i*3],p[i*3+1],p[i*3+2]].map((q,k)=>d.lo[k]+q/65535*(d.hi[k]-d.lo[k]));
  for(let i=0;i<t.length;i+=3){const a=P(t[i]),b=P(t[i+1]),c=P(t[i+2]);v+=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);}return v/6;};
{ const cube='v 0 0 0\nv 0 0 2\nv 0 2 0\nv 0 2 2\nv 2 0 0\nv 2 0 2\nv 2 2 0\nv 2 2 2\nvt 0 0\nvn 0 0 1\n'+
    'f 1/1/1 2/1/1 4/1/1 3/1/1\nf 5 7 8 6\nf 1 5 6 2\nf 3 4 8 7\nf -8 -6 -2 -4\nf 2 6 8 4\n';  // last-but-one face uses negative indices, and is wound inward
  const r=O.load(cube); ok(r.triangles===12&&r.points===8,'cube quads '+r.triangles); ok(Math.abs(vol(r.data)-8)<0.01,'cube faces outward, volume '+vol(r.data));
  // the same cube as triangle soup with every face wound inward: welded and turned outward
  const soup=O.load(cube.replace(/f (\S+) (\S+) (\S+) (\S+)/g,'f $4 $3 $2\nf $4 $2 $1'));
  ok(soup.triangles===12&&Math.abs(vol(soup.data)-8)<0.01,'inward cube turned outward '+vol(soup.data));
  // four quarter turns about either axis give back the same data
  let d=r.data; for(let i=0;i<4;i++) d=O.quarterTurn(d,'x'); ok(d.points===r.data.points&&d.lo.join()===r.data.lo.join(),'4 tips lossless');
  d=r.data; for(let i=0;i<4;i++) d=O.quarterTurn(d,'y'); ok(d.points===r.data.points,'4 turns lossless');
  ok(Math.abs(vol(O.quarterTurn(r.data,'x'))-8)<0.01,'tip keeps facing'); }
{ // a ten-pointed star prism: its caps are concave and must not be fanned across the notches
  let v='',f=''; for(const h of [0,1]) for(let k=0;k<10;k++){const r=k%2?0.4:1,a=k*Math.PI/5; v+=`v ${r*Math.cos(a)} ${h} ${r*Math.sin(a)}\n`;}
  f+='f '+[10,9,8,7,6,5,4,3,2,1].join(' ')+'\nf '+[11,12,13,14,15,16,17,18,19,20].join(' ')+'\n';
  for(let k=0;k<10;k++){const a=k+1,b=(k+1)%10+1; f+=`f ${a} ${b} ${b+10} ${a+10}\n`;}
  const r=O.load(v+f), star=10*0.5*1*0.4*Math.sin(Math.PI/5);  // star cap area
  ok(r.triangles===36,'star tris '+r.triangles); ok(Math.abs(vol(r.data)-star)<0.01,'star volume '+vol(r.data)+' vs '+star); }
{ // a dense sphere is reduced under the budget and still renders like the other models
  let v='',f='';const nu=200,nv=100; for(let i=0;i<=nv;i++)for(let j=0;j<nu;j++){const t=Math.PI*i/nv,p=2*Math.PI*j/nu;v+=`v ${Math.sin(t)*Math.cos(p)} ${Math.cos(t)} ${Math.sin(t)*Math.sin(p)}\n`;}
  for(let i=0;i<nv;i++)for(let j=0;j<nu;j++){const a=i*nu+j+1,b=i*nu+(j+1)%nu+1;f+=`f ${a} ${b+nu} ${a+nu}\nf ${a} ${b} ${b+nu}\n`;}
  const r=O.load(v+f,{maxTriangles:3000}); ok(r.reduced&&r.triangles<=3000&&r.triangles>1500,'reduced to '+r.triangles); ok(vol(r.data)>3.5,'reduced sphere outward '+vol(r.data));
  R.setModel('custom',r.data); S.shape='custom'; S.yaw=25; const img=R.render(S,80,100,1),pl=img.palette; ok(lum(pl.hi)>lum(pl.mid)&&lum(pl.mid)>lum(pl.shadow),'custom palette order');
  R.setModel('custom',null); }
let threw=null; try{O.load('# nothing\nv 0 0 0\n');}catch(e){threw=e.message;} ok(threw==='No faces found in this file','empty obj message');
console.log('passed',n,'assertions');
