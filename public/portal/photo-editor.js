
(() => {
  const $ = (id) => document.getElementById(id);
  const section = $("photo-editor");
  if (!section) return;

  const canvas = $("photo-editor-canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const wrap = $("photo-editor-canvas-wrap");
  const empty = $("photo-editor-empty");
  const status = $("photo-editor-status");
  const progress = $("photo-editor-progress");
  const meta = $("photo-editor-meta");
  const fileInput = $("photo-editor-file");

  let original = null;
  let base = null;
  let currentFile = null;
  let fileNameBase = "edited-photo";
  let undoStack = [];
  let redoStack = [];
  let dirty = false;
  let exported = false;
  let mode = null;
  let zoom = 1;
  let dragging = false;
  let startPoint = null;
  let lastPoint = null;
  let selection = null;
  let selectionSnapshot = null;
  let cropRatio = "free";
  let cropHandle = null;
  let lastBrushSource = null;
  let panStart = null;
  let adjustmentOrigin = null;
  let beforePreviewState = null;
  let worker = null;
  let busy = false;

  const controls = Array.from(section.querySelectorAll("button, input, select")).filter(el => el.id !== "photo-editor-file");
  const imageControls = controls.filter(el => !["photo-editor-file","photo-editor-upload-label"].includes(el.id));

  function say(message, error = false) {
    status.textContent = message || "";
    status.style.color = error ? "var(--red)" : "var(--muted)";
  }
  function setBusy(on, label = "") {
    busy = !!on;
    section.setAttribute("aria-busy", on ? "true" : "false");
    if (progress) {
      progress.hidden = !on;
      progress.value = 0;
    }
    if (on && label) say(label);
  }
  function setDirty(value = true) {
    dirty = !!value;
    if (dirty) exported = false;
    const badge = $("photo-editor-unsaved");
    if (badge) {
      badge.hidden = !dirty;
      badge.textContent = dirty ? "Unsaved edits" : "";
    }
  }
  function updateMeta(extra = "") {
    if (!canvas.width || !canvas.height) {
      meta.textContent = "No photo loaded.";
      return;
    }
    const mp = ((canvas.width * canvas.height) / 1000000).toFixed(1);
    meta.textContent = canvas.width + " × " + canvas.height + " px • " + mp + " MP" + (extra ? " • " + extra : "");
  }
  function updateHistory() {
    const u = $("photo-editor-undo");
    const r = $("photo-editor-redo");
    u.disabled = !undoStack.length;
    r.disabled = !redoStack.length;
    u.textContent = undoStack.length ? "Undo: " + undoStack[undoStack.length - 1].action : "Undo";
    r.textContent = redoStack.length ? "Redo: " + redoStack[redoStack.length - 1].action : "Redo";
  }
  function state() {
    return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  }
  function pushUndo(action, snapshot = state()) {
    undoStack.push({ action, state: snapshot });
    if (undoStack.length > 30) undoStack.shift();
    redoStack = [];
    updateHistory();
    setDirty(true);
  }
  function restore(s) {
    canvas.width = s.width;
    canvas.height = s.height;
    ctx.putImageData(s.data, 0, 0);
    base = ctx.getImageData(0, 0, canvas.width, canvas.height);
    selection = null;
    updateMeta();
    applyZoom();
  }
  function enableImageControls(on) {
    section.querySelectorAll("[data-photo-requires-image]").forEach(el => { el.disabled = !on; });
  }

  function applyZoom() {
    if (!canvas.width) return;
    canvas.style.width = Math.max(1, canvas.width * zoom) + "px";
    canvas.style.height = Math.max(1, canvas.height * zoom) + "px";
    $("photo-editor-zoom-value").textContent = Math.round(zoom * 100) + "%";
  }
  function fitToScreen() {
    if (!canvas.width) return;
    const maxW = Math.max(100, wrap.clientWidth - 32);
    const maxH = Math.max(240, Math.min(window.innerHeight * .65, 720));
    zoom = Math.min(1, maxW / canvas.width, maxH / canvas.height);
    applyZoom();
    wrap.scrollLeft = 0;
    wrap.scrollTop = 0;
    say("Fit to screen.");
  }
  function actualSize() {
    if (!canvas.width) return;
    zoom = 1;
    applyZoom();
    say("Actual size: 100%.");
  }
  function changeZoom(multiplier) {
    if (!canvas.width) return;
    zoom = Math.max(.1, Math.min(5, zoom * multiplier));
    applyZoom();
  }

  function updateRangeLabel(id, suffix = "") {
    const input = $(id);
    const out = $(id + "-value");
    if (input && out) out.textContent = input.value + suffix;
  }
  const rangeIds = [
    ["photo-editor-brightness","%"],["photo-editor-contrast","%"],["photo-editor-saturation","%"],
    ["photo-editor-exposure",""],["photo-editor-highlights",""],["photo-editor-shadows",""],
    ["photo-editor-warmth",""],["photo-editor-sharpness","%"],["photo-editor-straighten","°"],
    ["photo-editor-blur-strength"," px"],["photo-editor-brush-size"," px"],["photo-editor-jpg-quality","%"]
  ];
  rangeIds.forEach(([id,s]) => $(id)?.addEventListener("input", () => updateRangeLabel(id,s)));
  rangeIds.forEach(([id,s]) => updateRangeLabel(id,s));

  function pixelAdjustPreview() {
    if (!base) return;
    ctx.putImageData(base,0,0);
    const img = ctx.getImageData(0,0,canvas.width,canvas.height);
    const d = img.data;
    const exposure = Number($("photo-editor-exposure").value);
    const highlights = Number($("photo-editor-highlights").value);
    const shadows = Number($("photo-editor-shadows").value);
    const warmth = Number($("photo-editor-warmth").value);
    const bright = Number($("photo-editor-brightness").value) / 100;
    const contrast = Number($("photo-editor-contrast").value) / 100;
    const sat = Number($("photo-editor-saturation").value) / 100;
    const expMul = Math.pow(2, exposure / 100);
    const c = contrast;
    for (let i=0;i<d.length;i+=4) {
      let r=d[i]*bright*expMul, g=d[i+1]*bright*expMul, b=d[i+2]*bright*expMul;
      r=(r-128)*c+128; g=(g-128)*c+128; b=(b-128)*c+128;
      const lum=.2126*r+.7152*g+.0722*b;
      r=lum+(r-lum)*sat; g=lum+(g-lum)*sat; b=lum+(b-lum)*sat;
      const tone=lum/255;
      const shadowBoost=(1-tone)*(shadows/100)*55;
      const highlightBoost=tone*(highlights/100)*55;
      r += shadowBoost + highlightBoost + warmth*.45;
      g += shadowBoost + highlightBoost;
      b += shadowBoost + highlightBoost - warmth*.45;
      d[i]=Math.max(0,Math.min(255,r)); d[i+1]=Math.max(0,Math.min(255,g)); d[i+2]=Math.max(0,Math.min(255,b));
    }
    ctx.putImageData(img,0,0);
  }
  const adjustmentIds=["photo-editor-brightness","photo-editor-contrast","photo-editor-saturation","photo-editor-exposure","photo-editor-highlights","photo-editor-shadows","photo-editor-warmth"];
  adjustmentIds.forEach(id => {
    const el=$(id); if(!el)return;
    el.addEventListener("pointerdown",()=>{ if(base&&!adjustmentOrigin) adjustmentOrigin=state(); });
    el.addEventListener("input",()=>{ if(!adjustmentOrigin&&base) adjustmentOrigin=state(); pixelAdjustPreview(); });
    el.addEventListener("change",()=>{
      if(!base)return;
      if(adjustmentOrigin) pushUndo("Adjust",adjustmentOrigin);
      base=ctx.getImageData(0,0,canvas.width,canvas.height);
      adjustmentOrigin=null;
      adjustmentIds.forEach(x=>$(x).value=(x.includes("brightness")||x.includes("contrast")||x.includes("saturation"))?100:0);
      adjustmentIds.forEach(x=>updateRangeLabel(x,x.includes("brightness")||x.includes("contrast")||x.includes("saturation")?"%":""));
      say("Adjustments applied.");
    });
  });

  function rotateArbitrary(deg, action = "Straighten") {
    if(!canvas.width) return;
    const before=state();
    const temp=document.createElement("canvas");
    temp.width=canvas.width; temp.height=canvas.height; temp.getContext("2d").drawImage(canvas,0,0);
    ctx.save(); ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.translate(canvas.width/2,canvas.height/2); ctx.rotate(deg*Math.PI/180);
    ctx.drawImage(temp,-temp.width/2,-temp.height/2); ctx.restore();
    pushUndo(action,before); base=ctx.getImageData(0,0,canvas.width,canvas.height);
  }
  let straightenOrigin=null;
  $("photo-editor-straighten")?.addEventListener("pointerdown",()=>{ if(base&&!straightenOrigin) straightenOrigin=state(); });
  $("photo-editor-straighten")?.addEventListener("input",()=>{
    if(!base)return;
    if(!straightenOrigin) straightenOrigin=state();
    restore(straightenOrigin);
    const deg=Number($("photo-editor-straighten").value);
    const temp=document.createElement("canvas"); temp.width=canvas.width; temp.height=canvas.height; temp.getContext("2d").putImageData(straightenOrigin.data,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height); ctx.save(); ctx.translate(canvas.width/2,canvas.height/2); ctx.rotate(deg*Math.PI/180); ctx.drawImage(temp,-temp.width/2,-temp.height/2); ctx.restore();
  });
  $("photo-editor-straighten")?.addEventListener("change",()=>{
    if(!straightenOrigin)return;
    pushUndo("Straighten",straightenOrigin);
    base=ctx.getImageData(0,0,canvas.width,canvas.height);
    straightenOrigin=null;
    $("photo-editor-straighten").value=0; updateRangeLabel("photo-editor-straighten","°");
  });

  function createWorker() {
    if (worker) return worker;
    worker = new Worker("/portal/photo-editor-worker.js");
    return worker;
  }
  function runSharpen(strength, action="Sharpen") {
    if(!canvas.width||busy)return;
    const pixels=canvas.width*canvas.height;
    if(pixels>12000000){ say("Crop or resize this image before sharpening; it is too large for safe processing.",true); return; }
    const before=state();
    setBusy(true,"Sharpening…");
    const w=createWorker();
    w.onmessage=(event)=>{
      if(event.data.type==="progress"){ if(progress) progress.value=event.data.progress; return; }
      if(event.data.type==="done"){
        const arr=new Uint8ClampedArray(event.data.data);
        ctx.putImageData(new ImageData(arr,event.data.width,event.data.height),0,0);
        base=ctx.getImageData(0,0,canvas.width,canvas.height);
        pushUndo(action,before);
        setBusy(false);
        say(action+" applied.");
      }
    };
    w.onerror=()=>{ setBusy(false); say("Unable to complete sharpening.",true); };
    const copy=new Uint8ClampedArray(before.data.data);
    w.postMessage({width:before.width,height:before.height,data:copy.buffer,strength:Number(strength)},[copy.buffer]);
  }
  $("photo-editor-deblur")?.addEventListener("click",()=>runSharpen($("photo-editor-sharpness").value,"Deblur / Sharpen"));
  $("photo-editor-sharpness")?.addEventListener("change",()=>{ if(Number($("photo-editor-sharpness").value)>0) runSharpen($("photo-editor-sharpness").value,"Sharpness"); });

  function point(e){
    const r=canvas.getBoundingClientRect();
    return {x:(e.clientX-r.left)*(canvas.width/r.width),y:(e.clientY-r.top)*(canvas.height/r.height)};
  }
  function setMode(next){
    mode=next;
    ["blur-box","blur-brush","erase-brush","crop","pan"].forEach(m=>{
      const id={"blur-box":"photo-editor-blur-mode","blur-brush":"photo-editor-brush-mode","erase-brush":"photo-editor-erase-brush","crop":"photo-editor-crop-mode","pan":"photo-editor-pan"}[m];
      $(id)?.classList.toggle("photo-editor-mode",next===m);
    });
    wrap.classList.toggle("selection-active",!!next&&next!=="pan");
    if(next==="blur-brush") lastBrushSource=state();
    say(next?("Mode: "+next.replace("-"," ")+". Press Esc to cancel."):"Selection mode off.");
  }
  $("photo-editor-blur-mode")?.addEventListener("click",()=>setMode(mode==="blur-box"?null:"blur-box"));
  $("photo-editor-brush-mode")?.addEventListener("click",()=>setMode(mode==="blur-brush"?null:"blur-brush"));
  $("photo-editor-erase-brush")?.addEventListener("click",()=>setMode(mode==="erase-brush"?null:"erase-brush"));
  $("photo-editor-crop-mode")?.addEventListener("click",()=>setMode(mode==="crop"?null:"crop"));
  $("photo-editor-pan")?.addEventListener("click",()=>setMode(mode==="pan"?null:"pan"));

  function ratioAdjusted(a,b){
    if(cropRatio==="free")return b;
    const ratios={square:1,"4:5":4/5,"3:4":3/4,"16:9":16/9};
    const ratio=ratios[cropRatio]||1;
    let w=b.x-a.x,h=b.y-a.y; const sx=Math.sign(w)||1,sy=Math.sign(h)||1;
    if(Math.abs(w/h)>ratio) w=Math.abs(h)*ratio*sx; else h=Math.abs(w)/ratio*sy;
    return {x:a.x+w,y:a.y+h};
  }
  function drawSelection(previewBlur=false){
    if(!selectionSnapshot||!startPoint||!lastPoint)return;
    ctx.putImageData(selectionSnapshot,0,0);
    const end=mode==="crop"?ratioAdjusted(startPoint,lastPoint):lastPoint;
    const x=Math.min(startPoint.x,end.x), y=Math.min(startPoint.y,end.y), w=Math.abs(end.x-startPoint.x), h=Math.abs(end.y-startPoint.y);
    if(previewBlur&&w>2&&h>2){
      const temp=document.createElement("canvas");temp.width=w;temp.height=h;
      temp.getContext("2d").drawImage(canvas,x,y,w,h,0,0,w,h);
      ctx.save();ctx.filter="blur("+$("photo-editor-blur-strength").value+"px)";ctx.drawImage(temp,x,y,w,h);ctx.restore();ctx.filter="none";
    }
    ctx.save(); ctx.strokeStyle="#000"; ctx.lineWidth=Math.max(4,canvas.width/500); ctx.strokeRect(x,y,w,h);
    ctx.strokeStyle="#fff";ctx.lineWidth=Math.max(2,canvas.width/900);ctx.setLineDash([10,7]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);
    if(mode==="crop"){
      const hs=Math.max(12,canvas.width/80);
      [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].forEach(([hx,hy])=>{ctx.fillStyle="#fff";ctx.strokeStyle="#000";ctx.lineWidth=2;ctx.fillRect(hx-hs/2,hy-hs/2,hs,hs);ctx.strokeRect(hx-hs/2,hy-hs/2,hs,hs);});
    }
    ctx.restore();
    $("photo-editor-selection-size").textContent=Math.round(w)+" × "+Math.round(h)+" px";
  }
  function blurBrushAt(p, erase=false){
    const radius=Number($("photo-editor-brush-size").value)/2;
    if(erase&&lastBrushSource){
      ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.clip();ctx.putImageData(lastBrushSource.data,0,0);ctx.restore();return;
    }
    const x=Math.max(0,Math.floor(p.x-radius)),y=Math.max(0,Math.floor(p.y-radius)),size=Math.max(2,Math.ceil(radius*2));
    const w=Math.min(size,canvas.width-x),h=Math.min(size,canvas.height-y);
    const temp=document.createElement("canvas");temp.width=w;temp.height=h;temp.getContext("2d").drawImage(canvas,x,y,w,h,0,0,w,h);
    ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.clip();ctx.filter="blur("+$("photo-editor-blur-strength").value+"px)";ctx.drawImage(temp,x,y);ctx.restore();ctx.filter="none";
  }

  canvas.addEventListener("pointerdown",(e)=>{
    if(!mode||busy)return;
    e.preventDefault();
    if(mode==="pan"){panStart={x:e.clientX,y:e.clientY,left:wrap.scrollLeft,top:wrap.scrollTop};dragging=true;canvas.setPointerCapture(e.pointerId);return;}
    dragging=true;startPoint=point(e);lastPoint=startPoint;selectionSnapshot=ctx.getImageData(0,0,canvas.width,canvas.height);
    canvas.setPointerCapture(e.pointerId);
    if(mode==="blur-brush"||mode==="erase-brush") blurBrushAt(startPoint,mode==="erase-brush");
  });
  canvas.addEventListener("pointermove",(e)=>{
    if(!dragging||!mode)return;e.preventDefault();
    if(mode==="pan"&&panStart){wrap.scrollLeft=panStart.left-(e.clientX-panStart.x);wrap.scrollTop=panStart.top-(e.clientY-panStart.y);return;}
    lastPoint=point(e);
    if(mode==="blur-box") drawSelection(true);
    else if(mode==="crop") drawSelection(false);
    else if(mode==="blur-brush"||mode==="erase-brush") blurBrushAt(lastPoint,mode==="erase-brush");
  });
  canvas.addEventListener("pointerup",(e)=>{
    if(!dragging)return;e.preventDefault();dragging=false;
    if(mode==="pan"){panStart=null;return;}
    const active=mode;
    if(active==="blur-brush"||active==="erase-brush"){
      if(selectionSnapshot) pushUndo(active==="blur-brush"?"Brush blur":"Erase blur",{width:canvas.width,height:canvas.height,data:selectionSnapshot});
      base=ctx.getImageData(0,0,canvas.width,canvas.height);selectionSnapshot=null;return;
    }
    if(!startPoint||!lastPoint)return;
    if(selectionSnapshot)ctx.putImageData(selectionSnapshot,0,0);
    let end=active==="crop"?ratioAdjusted(startPoint,lastPoint):lastPoint;
    let x=Math.max(0,Math.floor(Math.min(startPoint.x,end.x))),y=Math.max(0,Math.floor(Math.min(startPoint.y,end.y)));
    let w=Math.min(canvas.width-x,Math.floor(Math.abs(end.x-startPoint.x))),h=Math.min(canvas.height-y,Math.floor(Math.abs(end.y-startPoint.y)));
    if(w<12||h<12){say("Selection is too small. Drag a larger area.",true);selection=null;setMode(null);return;}
    if(active==="blur-box"){
      pushUndo("Blur area",{width:canvas.width,height:canvas.height,data:selectionSnapshot});
      const temp=document.createElement("canvas");temp.width=w;temp.height=h;temp.getContext("2d").drawImage(canvas,x,y,w,h,0,0,w,h);
      ctx.save();ctx.filter="blur("+$("photo-editor-blur-strength").value+"px)";ctx.drawImage(temp,x,y);ctx.restore();ctx.filter="none";
      base=ctx.getImageData(0,0,canvas.width,canvas.height);selection=null;setMode(null);say("Selected area blurred.");
    } else if(active==="crop"){
      selection={x,y,w,h};
      drawCropOverlay();
      $("photo-editor-apply-crop").disabled=false;
      say("Crop selected. Drag a corner handle to resize, then Apply Crop.");
    }
    startPoint=lastPoint=selectionSnapshot=null;
  });
  canvas.addEventListener("pointercancel",()=>{if(selectionSnapshot)ctx.putImageData(selectionSnapshot,0,0);dragging=false;startPoint=lastPoint=selectionSnapshot=null;});

  function drawCropOverlay(){
    if(!selection||!base)return;
    ctx.putImageData(base,0,0);
    const {x,y,w,h}=selection;
    ctx.save();ctx.fillStyle="rgba(0,0,0,.42)";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.clearRect(x,y,w,h);ctx.putImageData(base,0,0,x,y,w,h);
    ctx.strokeStyle="#fff";ctx.lineWidth=Math.max(3,canvas.width/600);ctx.strokeRect(x,y,w,h);ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(x,y,w,h);
    const hs=Math.max(14,canvas.width/75);[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].forEach(([hx,hy])=>{ctx.fillStyle="#fff";ctx.strokeStyle="#000";ctx.fillRect(hx-hs/2,hy-hs/2,hs,hs);ctx.strokeRect(hx-hs/2,hy-hs/2,hs,hs);});ctx.restore();
  }
  $("photo-editor-crop-ratio")?.addEventListener("change",e=>{cropRatio=e.target.value;});
  $("photo-editor-apply-crop")?.addEventListener("click",()=>{
    if(!selection||!base)return;
    ctx.putImageData(base,0,0);
    const before=state(),{x,y,w,h}=selection;
    const temp=document.createElement("canvas");temp.width=w;temp.height=h;temp.getContext("2d").drawImage(canvas,x,y,w,h,0,0,w,h);
    canvas.width=w;canvas.height=h;ctx.drawImage(temp,0,0);base=ctx.getImageData(0,0,w,h);pushUndo("Crop",before);selection=null;$("photo-editor-apply-crop").disabled=true;setMode(null);updateMeta();fitToScreen();say("Crop applied.");
  });

  $("photo-editor-blur-strength")?.addEventListener("input",()=>{ if(mode==="blur-box"&&dragging) drawSelection(true); });

  $("photo-editor-blur-all")?.addEventListener("click",()=>{
    if(!canvas.width)return;const before=state();const temp=document.createElement("canvas");temp.width=canvas.width;temp.height=canvas.height;temp.getContext("2d").drawImage(canvas,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.filter="blur("+$("photo-editor-blur-strength").value+"px)";ctx.drawImage(temp,0,0);ctx.filter="none";base=ctx.getImageData(0,0,canvas.width,canvas.height);pushUndo("Blur entire photo",before);say("Entire photo blurred.");
  });

  $("photo-editor-grayscale")?.addEventListener("click",()=>{
    if(!base)return;const before=state(),img=ctx.getImageData(0,0,canvas.width,canvas.height),d=img.data;
    for(let i=0;i<d.length;i+=4){const y=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];d[i]=d[i+1]=d[i+2]=y;}
    ctx.putImageData(img,0,0);base=ctx.getImageData(0,0,canvas.width,canvas.height);pushUndo("Black & white",before);
  });
  function rotate90(dir){
    if(!canvas.width)return;const before=state(),temp=document.createElement("canvas");temp.width=canvas.width;temp.height=canvas.height;temp.getContext("2d").drawImage(canvas,0,0);
    canvas.width=temp.height;canvas.height=temp.width;ctx.save();ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(dir*Math.PI/2);ctx.drawImage(temp,-temp.width/2,-temp.height/2);ctx.restore();base=ctx.getImageData(0,0,canvas.width,canvas.height);pushUndo("Rotate",before);updateMeta();fitToScreen();
  }
  $("photo-editor-rotate-left")?.addEventListener("click",()=>rotate90(-1));
  $("photo-editor-rotate-right")?.addEventListener("click",()=>rotate90(1));
  $("photo-editor-flip")?.addEventListener("click",()=>{
    if(!canvas.width)return;const before=state(),temp=document.createElement("canvas");temp.width=canvas.width;temp.height=canvas.height;temp.getContext("2d").drawImage(canvas,0,0);
    ctx.save();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.translate(canvas.width,0);ctx.scale(-1,1);ctx.drawImage(temp,0,0);ctx.restore();base=ctx.getImageData(0,0,canvas.width,canvas.height);pushUndo("Flip",before);
  });

  $("photo-editor-zoom-in")?.addEventListener("click",()=>changeZoom(1.25));
  $("photo-editor-zoom-out")?.addEventListener("click",()=>changeZoom(.8));
  $("photo-editor-fit")?.addEventListener("click",fitToScreen);
  $("photo-editor-actual")?.addEventListener("click",actualSize);

  $("photo-editor-before-after")?.addEventListener("pointerdown",()=>{
    if(!original)return;beforePreviewState=state();restore(original);say("Showing original. Release to return to edited photo.");
  });
  const endBefore=()=>{if(beforePreviewState){restore(beforePreviewState);beforePreviewState=null;say("Showing edited photo.");}};
  $("photo-editor-before-after")?.addEventListener("pointerup",endBefore);
  $("photo-editor-before-after")?.addEventListener("pointerleave",endBefore);

  $("photo-editor-reset")?.addEventListener("click",()=>{
    if(!original)return;if(!confirm("Reset all photo edits and return to the original?"))return;
    pushUndo("Reset");restore(original);setDirty(false);exported=false;say("Reset to original.");
  });
  $("photo-editor-clear")?.addEventListener("click",()=>{
    if(dirty&&!exported&&!confirm("Clear this photo and discard unsaved edits?"))return;
    canvas.width=0;canvas.height=0;canvas.style.display="none";empty.style.display="block";original=base=currentFile=null;undoStack=[];redoStack=[];selection=null;setDirty(false);enableImageControls(false);updateHistory();updateMeta();say("Photo cleared.");fileInput.value="";
  });

  $("photo-editor-undo")?.addEventListener("click",()=>{
    if(!undoStack.length)return;const entry=undoStack.pop();redoStack.push({action:entry.action,state:state()});restore(entry.state);setDirty(true);updateHistory();say("Undid: "+entry.action+".");
  });
  $("photo-editor-redo")?.addEventListener("click",()=>{
    if(!redoStack.length)return;const entry=redoStack.pop();undoStack.push({action:entry.action,state:state()});restore(entry.state);setDirty(true);updateHistory();say("Redid: "+entry.action+".");
  });

  async function decodeFile(file){
    if(file.size>25*1024*1024&&!confirm("This image is over 25 MB and may use significant memory. Continue?")) throw new Error("Image loading canceled.");
    const type=(file.type||"").toLowerCase();
    if((type.includes("heic")||type.includes("heif")) && typeof createImageBitmap!=="function") throw new Error("This browser cannot decode HEIC/HEIF. On iPhone, open the image in Photos and share/export it as JPEG, or use Safari with HEIC support.");
    if(typeof createImageBitmap==="function"){
      try{return await createImageBitmap(file,{imageOrientation:"from-image"});}catch{}
    }
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error("Unable to decode this image format."));img.src=url;});
      return img;
    } finally { setTimeout(()=>URL.revokeObjectURL(url),1000); }
  }
  async function loadFile(file){
    if(!file)return;
    if(dirty&&!exported&&!confirm("Replace the current photo? Unsaved edits will be discarded.")){fileInput.value="";return;}
    setBusy(true,"Loading photo…");
    try{
      const source=await decodeFile(file);
      const sw=source.width||source.naturalWidth,sh=source.height||source.naturalHeight;
      const megapixels=sw*sh/1000000;
      let scale=1;
      if(megapixels>18){
        const proceed=confirm("This photo is "+megapixels.toFixed(1)+" MP. To reduce freezing, the editor will create a working copy capped near 18 MP. Continue?");
        if(!proceed)throw new Error("Image loading canceled.");
        scale=Math.sqrt(18000000/(sw*sh));
      }
      canvas.width=Math.max(1,Math.round(sw*scale));canvas.height=Math.max(1,Math.round(sh*scale));
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);
      source.close?.();
      original=state();base=ctx.getImageData(0,0,canvas.width,canvas.height);currentFile=file;
      fileNameBase=(file.name||"edited-photo").replace(/\.[^.]+$/,"")||"edited-photo";$("photo-editor-filename").value=fileNameBase;
      undoStack=[];redoStack=[];updateHistory();setDirty(false);exported=false;enableImageControls(true);empty.style.display="none";canvas.style.display="block";updateMeta(file.type||"image");fitToScreen();say("Photo loaded. EXIF orientation is respected when supported by your browser.");
    }catch(err){say(err.message||"Unable to load photo.",true);}
    finally{setBusy(false);}
  }
  fileInput.addEventListener("change",()=>loadFile(fileInput.files?.[0]));

  function exportBlob(type,quality){
    return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Export failed.")),type,quality));
  }
  async function download(type){
    if(!canvas.width||busy)return;setBusy(true,"Exporting…");
    try{
      const quality=Number($("photo-editor-jpg-quality").value)/100;
      const blob=await exportBlob(type,type==="image/jpeg"?quality:undefined);
      const url=URL.createObjectURL(blob),a=document.createElement("a"),name=($("photo-editor-filename").value||fileNameBase||"edited-photo").trim();
      a.href=url;a.download=name+"."+(type==="image/png"?"png":"jpg");a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);exported=true;setDirty(false);say("Export complete.");
    }catch(err){say(err.message||"Export failed.",true);}finally{setBusy(false);}
  }
  $("photo-editor-download-jpg")?.addEventListener("click",()=>download("image/jpeg"));
  $("photo-editor-download-png")?.addEventListener("click",()=>download("image/png"));

  async function galleryPayload(){
    let work=canvas,quality=.86;
    for(let attempt=0;attempt<5;attempt++){
      const dataUrl=work.toDataURL("image/webp",quality),b64=dataUrl.split(",")[1];
      if(b64.length<=2850000)return {mime_type:"image/webp",image_base64:b64};
      const smaller=document.createElement("canvas");smaller.width=Math.max(1,Math.round(work.width*.82));smaller.height=Math.max(1,Math.round(work.height*.82));smaller.getContext("2d").drawImage(work,0,0,smaller.width,smaller.height);work=smaller;quality=Math.max(.68,quality-.04);
    }
    throw new Error("Edited photo is still too large for the gallery.");
  }
  $("photo-editor-save-gallery")?.addEventListener("click",async()=>{
    if(!canvas.width||busy)return;
    const slot=Number($("photo-editor-gallery-slot").value);
    if(!slot){say("Choose a Muse Gallery slot first.",true);return;}
    if(!confirm("Save this edited copy to Muse Gallery slot "+slot+"? Existing content in that slot will be replaced."))return;
    setBusy(true,"Preparing gallery copy…");
    try{
      const image=await galleryPayload();if(progress)progress.value=60;
      const res=await fetch("/api/admin/gallery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slot,...image,alt_text:"Kendra Bexly gallery photo"})});
      const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.message||"Unable to save gallery copy.");
      if(progress)progress.value=100;exported=true;setDirty(false);say("Edited copy saved to Muse Gallery slot "+slot+".");
    }catch(err){say(err.message||"Unable to save gallery copy.",true);}finally{setBusy(false);}
  });

  document.addEventListener("keydown",(e)=>{
    const active=document.body.dataset.adminSection==="photo-editor";
    if(!active)return;
    const tag=document.activeElement?.tagName?.toLowerCase();if(tag==="input"||tag==="select"||tag==="textarea")return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?$("photo-editor-redo").click():$("photo-editor-undo").click();}
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();$("photo-editor-redo").click();}
    else if(e.key==="Escape"){e.preventDefault();if(selectionSnapshot)ctx.putImageData(selectionSnapshot,0,0);selection=null;setMode(null);say("Selection canceled.");}
    else if(e.key==="0"){e.preventDefault();fitToScreen();}
    else if(e.key==="1"){e.preventDefault();actualSize();}
  });

  window.addEventListener("beforeunload",(e)=>{if(dirty&&!exported){e.preventDefault();e.returnValue="";}});
  window.addEventListener("resize",()=>{if(canvas.width&&zoom<1)fitToScreen();},{passive:true});

  enableImageControls(false);
  updateHistory();
  updateMeta();
})();