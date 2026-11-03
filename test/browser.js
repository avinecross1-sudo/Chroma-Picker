const { chromium } = require('playwright'); const path=require('path');
(async()=>{
  const out=process.argv[2]; const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:300,height:1250},deviceScaleFactor:1});
  const errs=[]; pg.on('pageerror',e=>errs.push('pageerror '+e.message)); pg.on('console',m=>{ if(m.type()==='error'||m.type()==='warning') errs.push(m.type()+' '+m.text()); });
  await pg.goto('file://'+path.resolve(__dirname,'../plugin/index.html')); await pg.waitForTimeout(800);
  await pg.screenshot({path:out+'/s1.png',fullPage:true});
  const st=()=>pg.evaluate(()=>({shape:ChromaPicker.state.colors.shape,fg:CPBridge._mock.fg,bg:CPBridge._mock.bg,az:ChromaPicker.state.az,yaw:ChromaPicker.state.yaw}));
  console.log('init',await st());
  // drag in field
  const f=await pg.$('#field'); const fb=await f.boundingBox();
  await pg.mouse.move(fb.x+fb.width*0.9,fb.y+fb.height*0.1); await pg.mouse.down(); await pg.mouse.move(fb.x+fb.width*0.8,fb.y+fb.height*0.2,{steps:5}); await pg.mouse.up();
  await pg.waitForTimeout(400); console.log('after field',await st());
  // strip (hue)
  const s=await pg.$('#strip'); const sb=await s.boundingBox(); await pg.mouse.click(sb.x+9,sb.y+sb.height*0.4); await pg.waitForTimeout(300); console.log('after hue',await st());
  // undo
  await pg.click('#undoBtn'); await pg.waitForTimeout(300); console.log('after undo',await st());
  // light drag
  const p=await pg.$('#preview'); const pb=await p.boundingBox();
  await pg.mouse.move(pb.x+pb.width*0.5,pb.y+pb.height*0.5); await pg.mouse.down(); await pg.mouse.move(pb.x+pb.width*0.15,pb.y+pb.height*0.25,{steps:5}); await pg.mouse.up();
  await pg.waitForTimeout(400); console.log('after light',await st());
  // modes
  for(const m of ['RGB','LAB','CMYK','CUBE','HSB']){ await pg.click(`#modeSeg button[data-v="${m}"]`); await pg.waitForTimeout(150); }
  await pg.click('#modeSeg button[data-v="LAB"]'); 
  // time of day + cube + true color
  await pg.click('#lightModeSeg button[data-v="time"]'); await pg.click('#shapeSeg button[data-v="cube"]'); await pg.click('#trueColorBtn');
  await pg.waitForTimeout(600); await pg.screenshot({path:out+'/s2.png',fullPage:true});
  // sky target edit -> bakes to manual
  await pg.click('#targetSeg button[data-v="sky"]'); await pg.fill('#hexInput','#203060'); await pg.press('#hexInput','Enter'); await pg.waitForTimeout(300);
  console.log('lightMode',await pg.evaluate(()=>ChromaPicker.state.lightMode+' '+ChromaPicker.state.colors.sky));
  // palette click & sample
  await pg.click('#trueColorBtn'); await pg.click('#targetSeg button[data-v="shape"]');
  await pg.click('#paletteRows .pal-row:nth-child(2)'); await pg.waitForTimeout(200); console.log('after palette hi',await st());
  await pg.click('#dragMode button[data-v="sample"]'); await pg.mouse.click(pb.x+pb.width*0.5,pb.y+pb.height*0.45); await pg.waitForTimeout(200); console.log('after sample',await st());
  // external host change -> imported
  await pg.evaluate(()=>{CPBridge._mock.fg='#11AA55'}); await pg.waitForTimeout(1500); console.log('after host change',await st());
  // swap
  await pg.keyboard.press('x'); await pg.waitForTimeout(300); console.log('after swap',await st());
  await pg.click('#pinBtn'); await pg.click('#compactBtn'); await pg.waitForTimeout(300); await pg.screenshot({path:out+'/s3.png',fullPage:true});
  await pg.click('#compactBtn'); await pg.click('#presetSelect'); await pg.selectOption('#presetSelect','2'); await pg.waitForTimeout(500);
  await pg.screenshot({path:out+'/s4.png',fullPage:true});
  console.log('errors',errs); await b.close();
})();
