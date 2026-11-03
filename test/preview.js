const path=require('path'),fs=require('fs'); const dir=path.join(__dirname,'..','plugin','js');
const C=globalThis.CPColor=require(path.join(dir,'color.js')); const R=require(path.join(dir,'render.js')),P=require(path.join(dir,'png.js'));
const lin=h=>C.rgbToLinear(C.hexToRgb(h)); const out=process.argv[2];
const base={albedo:lin('#C8643C'),flatAlbedoRgb:[200,100,60],sky:lin('#86A9E0'),horizon:lin('#E6DCCB'),ground:lin('#6E6253'),groundEnv:lin('#6E6253'),lights:[{dir:R.dirFromAngles(-25,40),color:lin('#FFF3E2'),intensity:1.1,spot:false},{dir:R.dirFromAngles(140,25),color:lin('#9FC4FF'),intensity:0.35,spot:false}],ambient:0.4,specular:0.35,reflectivity:0.08,subsurface:0,toon:false,chrome:false,fog:0,contrast:1,shape:'sphere',yaw:25,pitch:18,split:null};
const vars=[{},{shape:'cube'},{shape:'trio',sky:lin('#2E7BEA'),horizon:lin('#9EC9E8'),ground:lin('#5E8A6A'),groundEnv:lin('#5E8A6A'),albedo:lin('#D14949')},{toon:true},{shape:'trio'},{reflectivity:0.8,chrome:true}];
vars.forEach((v,i)=>{const r=R.render(Object.assign({},base,v),280,220,2); fs.writeFileSync(out+'/r'+i+'.png',P.encode(r.rgb,280,220));});
