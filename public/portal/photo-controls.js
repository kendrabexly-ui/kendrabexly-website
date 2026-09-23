(() => {
  const pages = [
    ["invitation","Home"],["meet-kendra","Meet Kendra"],["our-time","Our Time"],["the-details","The Details"]
  ];
  const targets = pages.map(([key,label]) => ({type:"page",key,label}))
    .concat(Array.from({length:13},(_,i)=>({type:"gallery",key:String(i+1),label:"Gallery photo "+(i+1)})));
  const byId = id => document.getElementById(id);
  const status = msg => { const el=byId("photo-controls-status"); if(el) el.textContent=msg||""; };
  let styles = new Map();
  const getKey = (t,k) => t+":"+k;
  async function load() {
    const r=await fetch("/api/admin/photo-styles",{headers:{Accept:"application/json"}});
    const d=await r.json();
    if(!r.ok||!d.ok) throw new Error(d.message||"Unable to load photo controls.");
    styles=new Map((d.styles||[]).map(x=>[getKey(x.target_type,x.target_key),x]));
    render();
  }
  function render() {
    const select=byId("photo-controls-target"); if(!select)return;
    const current=select.value||getKey(targets[0].type,targets[0].key);
    select.innerHTML=targets.map(t=>'<option value="'+getKey(t.type,t.key)+'">'+t.label+"</option>").join("");
    select.value=current;
    const [type,key]=select.value.split(":");
    const style=styles.get(getKey(type,key))||{width_percent:100,height_percent:100,opacity:1};
    byId("photo-control-width").value=style.width_percent;
    byId("photo-control-height").value=style.height_percent;
    byId("photo-control-opacity").value=Math.round(Number(style.opacity)*100);
    byId("photo-control-width-value").textContent=style.width_percent+"%";
    byId("photo-control-height-value").textContent=style.height_percent+"%";
    byId("photo-control-opacity-value").textContent=Math.round(Number(style.opacity)*100)+"%";
  }
  async function save() {
    const [type,key]=byId("photo-controls-target").value.split(":");
    const payload={target_type:type,target_key:key,width_percent:Number(byId("photo-control-width").value),height_percent:Number(byId("photo-control-height").value),opacity:Number(byId("photo-control-opacity").value)/100};
    status("Saving…");
    const r=await fetch("/api/admin/photo-styles",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const d=await r.json();
    if(!r.ok||!d.ok) throw new Error(d.message||"Unable to save.");
    styles.set(getKey(type,key),d.style); render(); status("Saved. Refresh the website page to see the updated photo.");
  }
  document.addEventListener("DOMContentLoaded",()=>{
    if(!byId("photo-controls"))return;
    byId("photo-controls-target").addEventListener("change",render);
    ["width","height","opacity"].forEach(k=>byId("photo-control-"+k).addEventListener("input",()=>{
      const v=byId("photo-control-"+k).value;
      byId("photo-control-"+k+"-value").textContent=v+(k==="opacity"?"%":"%");
    }));
    byId("photo-controls-save").addEventListener("click",()=>save().catch(e=>status(e.message)));
    byId("photo-controls-reset").addEventListener("click",async()=>{
      const [type,key]=byId("photo-controls-target").value.split(":");
      styles.delete(getKey(type,key)); render();
      status("Reset to default preview. Save to persist the reset.");
      try {
        const r=await fetch("/api/admin/photo-styles",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target_type:type,target_key:key,width_percent:100,height_percent:100,opacity:1})});
        const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.message||"Unable to reset.");
        styles.set(getKey(type,key),d.style); render(); status("Reset saved.");
      } catch(e){status(e.message);}
    });
    load().catch(e=>status(e.message));
  });
})();