(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // UI bits
  const statusText = $("#statusText");
  const offlineBanner = $("#offlineBanner");

  const views = {
    new: $("#view-new"),
    active: $("#view-active"),
    sign: $("#view-sign"),
    history: $("#view-history"),
    export: $("#view-export"),
    settings: $("#view-settings"),
  };

  const eventInput = $("#eventInput");
  const dateInput = $("#dateInput");
  const nameInput = $("#nameInput");
  const startInput = $("#startInput");
  const endInput = $("#endInput");
  const nameList = $("#nameList");
  const eventList = $("#eventList");
  const btnStartShift = $("#btnStartShift");
  const btnResumeActive = $("#btnResumeActive");

  const activeSummary = $("#activeSummary");
  const breakType = $("#breakType");
  const btnStartBreak = $("#btnStartBreak");
  const btnEndBreak = $("#btnEndBreak");
  const breakList = $("#breakList");
  const btnEditTimes = $("#btnEditTimes");
  const btnEndShift = $("#btnEndShift");

  const timesDialog = $("#timesDialog");
  const editStart = $("#editStart");
  const editEnd = $("#editEnd");

  const breakDialog = $("#breakDialog");
  const editBreakType = $("#editBreakType");
  const editBreakStart = $("#editBreakStart");
  const editBreakEnd = $("#editBreakEnd");

  const sigCanvas = $("#sigCanvas");
  const btnClearSig = $("#btnClearSig");
  const btnBackToActive = $("#btnBackToActive");
  const btnSaveShift = $("#btnSaveShift");

  const historyList = $("#historyList");
  const historySearch = $("#historySearch");
  const historyDate = $("#historyDate");
  const btnHistoryClearFilters = $("#btnHistoryClearFilters");
  const detailDialog = $("#detailDialog");
  const detailBody = $("#detailBody");
  const btnDeleteShift = $("#btnDeleteShift");

  const exportEvent = $("#exportEvent");
  const exportFrom = $("#exportFrom");
  const exportTo = $("#exportTo");
  const btnExportShifts = $("#btnExportShifts");
  const btnExportBreaks = $("#btnExportBreaks");

  const btnWipeAll = $("#btnWipeAll");

  $("#btnInstallInfo").addEventListener("click", () => {
    alert("Install on iPad: open this page in Safari, tap Share, tap Add to Home Screen. Open once while online so it can cache for offline use.");
  });
  $("#btnBackupHint").addEventListener("click", () => {
    alert("Backup habit: export CSV after each event. Offline means data lives on this iPad unless you export it.");
  });

  function setStatus(msg){ statusText.textContent = msg; }
  function pad2(n){ return String(n).padStart(2,"0"); }
  function toDateInputValue(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
  function toDTInputValue(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  function parseDTInputValue(v){
    if(!v) return null;
    const [dp,tp]=v.split("T"); if(!dp||!tp) return null;
    const [y,m,d]=dp.split("-").map(Number);
    const [hh,mi]=tp.split(":").map(Number);
    return new Date(y,m-1,d,hh,mi,0,0);
  }
  function formatNice(d){
    return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function escapeHtml(s){
    return (s??"").toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }
  function msToMins(ms){ return Math.max(0, Math.round(ms/60000)); }
  function minsBetween(a,b){ return msToMins(b.getTime()-a.getTime()); }
  function uuid(){ return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function escapeCsv(v){
    const s=(v??"").toString();
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }
  function downloadText(filename, text){
    const blob = new Blob([text], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 800);
  }

  // ---------- PWA offline ----------
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
  }
  function updateOfflineBanner(){
    offlineBanner.hidden = navigator.onLine;
  }
  window.addEventListener("online", updateOfflineBanner);
  window.addEventListener("offline", updateOfflineBanner);

  // ---------- IndexedDB ----------
  const DB_NAME="wow_timesheets_db";
  const DB_VERSION=1;
  let db=null;

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded=(e)=>{
        const d=e.target.result;
        const shifts=d.createObjectStore("shifts",{keyPath:"id"});
        shifts.createIndex("byCreatedAt","createdAt",{unique:false});
        const breaks=d.createObjectStore("breaks",{keyPath:"id"});
        breaks.createIndex("byShiftId","shiftId",{unique:false});
        const meta=d.createObjectStore("meta",{keyPath:"key"});
        meta.put({key:"activeShift", value:null});
        d.createObjectStore("names",{keyPath:"value"});
        d.createObjectStore("events",{keyPath:"value"});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }
  function tx(stores, mode="readonly"){ return db.transaction(stores, mode); }

  function metaGet(key){
    return new Promise((resolve,reject)=>{
      const t=tx(["meta"]);
      const r=t.objectStore("meta").get(key);
      r.onsuccess=()=>resolve(r.result ? r.result.value : null);
      r.onerror=()=>reject(r.error);
    });
  }
  function metaSet(key,value){
    return new Promise((resolve,reject)=>{
      const t=tx(["meta"],"readwrite");
      const r=t.objectStore("meta").put({key,value});
      r.onsuccess=()=>resolve(true);
      r.onerror=()=>reject(r.error);
    });
  }
  function upsertValue(store, value){
    const v=(value??"").trim();
    if(!v) return Promise.resolve();
    return new Promise((resolve)=>{
      const t=tx([store],"readwrite");
      t.objectStore(store).put({value:v});
      t.oncomplete=()=>resolve();
      t.onerror=()=>resolve();
    });
  }
  function listValues(store){
    return new Promise((resolve,reject)=>{
      const t=tx([store]);
      const r=t.objectStore(store).getAll();
      r.onsuccess=()=>resolve(r.result.map(x=>x.value).sort((a,b)=>a.localeCompare(b)));
      r.onerror=()=>reject(r.error);
    });
  }
  function getAll(store){
    return new Promise((resolve,reject)=>{
      const t=tx([store]);
      const r=t.objectStore(store).getAll();
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>reject(r.error);
    });
  }
  function saveShiftAndBreaks(shift, breaksArr){
    return new Promise((resolve,reject)=>{
      const t=tx(["shifts","breaks"],"readwrite");
      t.objectStore("shifts").put(shift);
      const bs=t.objectStore("breaks");
      for(const b of breaksArr){ bs.put(b); }
      t.oncomplete=()=>resolve(true);
      t.onerror=()=>reject(t.error);
    });
  }
  function deleteShift(shiftId){
    return new Promise((resolve,reject)=>{
      const t=tx(["shifts","breaks"],"readwrite");
      t.objectStore("shifts").delete(shiftId);
      const idx=t.objectStore("breaks").index("byShiftId");
      const req=idx.openCursor(IDBKeyRange.only(shiftId));
      req.onsuccess=(e)=>{
        const c=e.target.result;
        if(c){ c.delete(); c.continue(); }
      };
      t.oncomplete=()=>resolve(true);
      t.onerror=()=>reject(t.error);
    });
  }
  function wipeAll(){
    return new Promise((resolve,reject)=>{
      const t=tx(["shifts","breaks","meta","names","events"],"readwrite");
      for(const s of ["shifts","breaks","names","events"]){ t.objectStore(s).clear(); }
      t.objectStore("meta").put({key:"activeShift", value:null});
      t.oncomplete=()=>resolve(true);
      t.onerror=()=>reject(t.error);
    });
  }

  // ---------- View nav ----------
  function showView(name){
    Object.values(views).forEach(v=>v.hidden=true);
    views[name].hidden=false;
    setStatus(`Viewing: ${name}`);
  }
  $$("[data-view]").forEach(b=>{
    b.addEventListener("click", async ()=>{
      const v=b.getAttribute("data-view");
      if(v==="history") await renderHistory();
      if(v==="new") await loadActiveShiftBanner();
      showView(v);
    });
  });

  // ---------- Active shift state ----------
  let activeShift=null;      // {id,event,date,name,startAt,endAtDraft,...}
  let activeBreak=null;      // {id,type,startAt}
  let breaksDraft=[];        // completed breaks in memory
  let breakEditingId=null;   // for edit dialog

  function shiftSummaryHtml(s){
    const start=new Date(s.startAt);
    const end=s.endAtDraft ? new Date(s.endAtDraft) : null;
    return `
      <div><span class="badge">${escapeHtml(s.event)}</span> <span class="badge">${escapeHtml(s.date)}</span></div>
      <div><strong>${escapeHtml(s.name)}</strong></div>
      <div class="small">Start: ${formatNice(start)}${end ? ` · End: ${formatNice(end)}` : ""}</div>
    `;
  }

  function renderBreakList(){
    breakList.innerHTML="";
    if(activeBreak){
      const div=document.createElement("div");
      div.className="item";
      div.innerHTML=`
        <div class="meta">
          <div class="title">${escapeHtml(activeBreak.type)} (running)</div>
          <div class="sub">Start: ${formatNice(new Date(activeBreak.startAt))}</div>
        </div>
        <div class="actions-mini"><span class="badge">running</span></div>
      `;
      breakList.appendChild(div);
    }
    for(const b of breaksDraft){
      const div=document.createElement("div");
      div.className="item";
      const mins=minsBetween(new Date(b.startAt), new Date(b.endAt));
      div.innerHTML=`
        <div class="meta">
          <div class="title">${escapeHtml(b.type)}</div>
          <div class="sub">${formatNice(new Date(b.startAt))} to ${formatNice(new Date(b.endAt))} · ${mins} min</div>
        </div>
        <div class="actions-mini">
          <button class="btn btn-secondary" data-edit-break="${b.id}" type="button">Edit</button>
          <button class="btn btn-danger" data-del-break="${b.id}" type="button">Delete</button>
        </div>
      `;
      breakList.appendChild(div);
    }

    // wire buttons
    $$("[data-edit-break]").forEach(btn=>{
      btn.onclick=()=>{
        const id=btn.getAttribute("data-edit-break");
        openBreakEdit(id);
      };
    });
    $$("[data-del-break]").forEach(btn=>{
      btn.onclick=()=>{
        const id=btn.getAttribute("data-del-break");
        const b=breaksDraft.find(x=>x.id===id);
        if(!b) return;
        if(confirm("Delete this break?")){
          breaksDraft = breaksDraft.filter(x=>x.id!==id);
          persistActiveShift();
          renderBreakList();
        }
      };
    });
  }

  async function persistActiveShift(){
    // Save draft state so you can resume after closing the app
    if(!activeShift){
      await metaSet("activeShift", null);
      return;
    }
    const draft = { activeShift, activeBreak, breaksDraft };
    await metaSet("activeShift", draft);
  }

  async function loadActiveShiftBanner(){
    const draft = await metaGet("activeShift");
    if(draft && draft.activeShift){
      btnResumeActive.hidden=false;
      btnResumeActive.onclick=async ()=>{
        activeShift = draft.activeShift;
        activeBreak = draft.activeBreak;
        breaksDraft = draft.breaksDraft || [];
        await showActiveShift();
      };
    }else{
      btnResumeActive.hidden=true;
    }
  }

  async function refreshAutocomplete(){
    const [names, events] = await Promise.all([listValues("names"), listValues("events")]);
    nameList.innerHTML = names.map(n=>`<option value="${escapeHtml(n)}"></option>`).join("");
    eventList.innerHTML = events.map(e=>`<option value="${escapeHtml(e)}"></option>`).join("");
  }

  // ---------- New shift ----------
  btnStartShift.addEventListener("click", async ()=>{
    const event = (eventInput.value||"").trim();
    const date = (dateInput.value||"").trim();
    const name = (nameInput.value||"").trim();
    if(!event || !date || !name){
      alert("Please fill Event, Date, and Staff name.");
      return;
    }
    await upsertValue("events", event);
    await upsertValue("names", name);
    await refreshAutocomplete();

    const startAt = parseDTInputValue(startInput.value) || new Date();
    activeShift = {
      id: uuid(),
      event,
      date,
      name,
      startAt: startAt.getTime(),
      endAtDraft: null,
      signatureDataUrl: null,
      createdAt: Date.now(),
    };
    activeBreak = null;
    breaksDraft = [];
    await persistActiveShift();
    await showActiveShift();
  });

  async function showActiveShift(){
    activeSummary.innerHTML = shiftSummaryHtml(activeShift);
    btnEndBreak.disabled = !activeBreak;
    btnStartBreak.disabled = !!activeBreak;
    renderBreakList();
    showView("active");
    setStatus("Active shift running");
  }

  // ---------- Breaks ----------
  btnStartBreak.addEventListener("click", async ()=>{
    if(!activeShift){ alert("No active shift."); return; }
    if(activeBreak){ alert("A break is already running."); return; }
    activeBreak = { id: uuid(), type: breakType.value, startAt: Date.now() };
    btnEndBreak.disabled = false;
    btnStartBreak.disabled = true;
    await persistActiveShift();
    renderBreakList();
  });

  btnEndBreak.addEventListener("click", async ()=>{
    if(!activeBreak){ return; }
    const b = {
      id: activeBreak.id,
      shiftId: activeShift.id,
      event: activeShift.event,
      date: activeShift.date,
      type: activeBreak.type,
      startAt: activeBreak.startAt,
      endAt: Date.now()
    };
    breaksDraft.push(b);
    activeBreak = null;
    btnEndBreak.disabled = true;
    btnStartBreak.disabled = false;
    await persistActiveShift();
    renderBreakList();
  });

  function openBreakEdit(id){
    const b = breaksDraft.find(x=>x.id===id);
    if(!b) return;
    breakEditingId = id;
    editBreakType.value = b.type;
    editBreakStart.value = toDTInputValue(new Date(b.startAt));
    editBreakEnd.value = toDTInputValue(new Date(b.endAt));
    breakDialog.showModal();
  }

  breakDialog.addEventListener("close", async ()=>{
    if(breakDialog.returnValue !== "ok") return;
    const b = breaksDraft.find(x=>x.id===breakEditingId);
    if(!b) return;
    const s = parseDTInputValue(editBreakStart.value);
    const e = parseDTInputValue(editBreakEnd.value);
    if(!s || !e || e <= s){
      alert("Break end must be after break start.");
      return;
    }
    b.type = editBreakType.value;
    b.startAt = s.getTime();
    b.endAt = e.getTime();
    await persistActiveShift();
    renderBreakList();
  });

  // ---------- Edit shift times ----------
  btnEditTimes.addEventListener("click", ()=>{
    if(!activeShift) return;
    editStart.value = toDTInputValue(new Date(activeShift.startAt));
    editEnd.value = toDTInputValue(new Date(activeShift.endAtDraft || Date.now()));
    timesDialog.showModal();
  });

  timesDialog.addEventListener("close", async ()=>{
    if(timesDialog.returnValue !== "ok") return;
    const s = parseDTInputValue(editStart.value);
    const e = parseDTInputValue(editEnd.value);
    if(!s || !e || e <= s){
      alert("End time must be after start time.");
      return;
    }
    activeShift.startAt = s.getTime();
    activeShift.endAtDraft = e.getTime();
    activeSummary.innerHTML = shiftSummaryHtml(activeShift);
    await persistActiveShift();
  });

  // ---------- End shift and signature ----------
  btnEndShift.addEventListener("click", async ()=>{
    if(!activeShift) return;
    if(activeBreak){
      alert("End the running break first.");
      return;
    }
    activeShift.endAtDraft = Date.now();
    activeSummary.innerHTML = shiftSummaryHtml(activeShift);
    await persistActiveShift();
    clearSignature();
    showView("sign");
    setStatus("Capture signature");
  });

  btnBackToActive.addEventListener("click", async ()=>{
    showView("active");
  });

  // signature pad
  const sigCtx = sigCanvas.getContext("2d");
  let drawing = false;
  let sigEmpty = true;

  function clearSignature(){
    sigCtx.clearRect(0,0,sigCanvas.width,sigCanvas.height);
    sigCtx.fillStyle = "#ffffff";
    sigCtx.fillRect(0,0,sigCanvas.width,sigCanvas.height);
    sigCtx.strokeStyle = "#111827";
    sigCtx.lineWidth = 3;
    sigCtx.lineCap = "round";
    sigEmpty = true;
  }
  clearSignature();

  function getPos(e){
    const rect = sigCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (sigCanvas.width / rect.width);
    const y = (e.clientY - rect.top) * (sigCanvas.height / rect.height);
    return {x,y};
  }

  function pointerDown(e){
    drawing = true;
    sigCtx.beginPath();
    const p = getPos(e);
    sigCtx.moveTo(p.x, p.y);
    sigEmpty = false;
  }
  function pointerMove(e){
    if(!drawing) return;
    const p = getPos(e);
    sigCtx.lineTo(p.x, p.y);
    sigCtx.stroke();
  }
  function pointerUp(){
    drawing = false;
  }

  sigCanvas.addEventListener("pointerdown", (e)=>{ sigCanvas.setPointerCapture(e.pointerId); pointerDown(e); });
  sigCanvas.addEventListener("pointermove", pointerMove);
  sigCanvas.addEventListener("pointerup", pointerUp);
  sigCanvas.addEventListener("pointercancel", pointerUp);

  btnClearSig.addEventListener("click", clearSignature);

  btnSaveShift.addEventListener("click", async ()=>{
    if(!activeShift) return;
    if(!activeShift.endAtDraft){
      alert("End time is missing. Go back and end the shift.");
      return;
    }
    if(sigEmpty){
      if(!confirm("No signature detected. Save anyway?")) return;
    }

    const signatureDataUrl = sigCanvas.toDataURL("image/png");
    const shift = {
      id: activeShift.id,
      event: activeShift.event,
      date: activeShift.date,
      name: activeShift.name,
      startAt: activeShift.startAt,
      endAt: activeShift.endAtDraft,
      breakMinutes: calcBreakMinutes(breaksDraft),
      workedMinutes: calcWorkedMinutes(activeShift.startAt, activeShift.endAtDraft, breaksDraft),
      notes: "",
      signatureCaptured: sigEmpty ? false : true,
      signatureDataUrl: sigEmpty ? null : signatureDataUrl,
      createdAt: activeShift.createdAt
    };

    // ensure all break objects have shiftId etc already
    await saveShiftAndBreaks(shift, breaksDraft);

    // clear draft
    activeShift = null;
    activeBreak = null;
    breaksDraft = [];
    await metaSet("activeShift", null);
    await loadActiveShiftBanner();
    showView("new");
    setStatus("Shift saved");
    alert("Saved. Remember to export CSV after the event.");
  });

  function calcBreakMinutes(breaksArr){
    return breaksArr.reduce((sum,b)=>sum + minsBetween(new Date(b.startAt), new Date(b.endAt)), 0);
  }
  function calcWorkedMinutes(startAt, endAt, breaksArr){
    const total = msToMins(endAt - startAt);
    return Math.max(0, total - calcBreakMinutes(breaksArr));
  }

  // ---------- History ----------
  async function renderHistory(){
    const search = (historySearch.value||"").trim().toLowerCase();
    const date = (historyDate.value||"").trim();
    const shifts = await getAll("shifts");
    const filtered = shifts
      .filter(s=>{
        if(date && s.date !== date) return false;
        if(search){
          const hay = (s.name + " " + s.event).toLowerCase();
          if(!hay.includes(search)) return false;
        }
        return true;
      })
      .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

    historyList.innerHTML = "";
    if(filtered.length === 0){
      historyList.innerHTML = `<div class="note">No shifts found.</div>`;
      return;
    }

    for(const s of filtered){
      const div=document.createElement("div");
      div.className="item";
      const start=new Date(s.startAt);
      const end=new Date(s.endAt);
      div.innerHTML = `
        <div class="meta">
          <div class="title">${escapeHtml(s.name)} · ${escapeHtml(s.event)}</div>
          <div class="sub">${escapeHtml(s.date)} · ${formatNice(start)} to ${formatNice(end)} · Worked ${s.workedMinutes} min</div>
        </div>
        <div class="actions-mini">
          <button class="btn btn-secondary" data-detail="${s.id}" type="button">View</button>
        </div>
      `;
      historyList.appendChild(div);
    }

    $$("[data-detail]").forEach(btn=>{
      btn.onclick = async ()=>{
        const id=btn.getAttribute("data-detail");
        const shifts = await getAll("shifts");
        const s = shifts.find(x=>x.id===id);
        if(!s) return;
        const br = (await getAll("breaks")).filter(b=>b.shiftId===id).sort((a,b)=>a.startAt-b.startAt);
        detailBody.innerHTML = renderDetailHtml(s, br);
        btnDeleteShift.dataset.shiftId = id;
        detailDialog.showModal();
      };
    });
  }

  function renderDetailHtml(s, br){
    const start=new Date(s.startAt);
    const end=new Date(s.endAt);
    const lines = [];
    lines.push(`<div><span class="badge">${escapeHtml(s.event)}</span> <span class="badge">${escapeHtml(s.date)}</span></div>`);
    lines.push(`<div><strong>${escapeHtml(s.name)}</strong></div>`);
    lines.push(`<div class="small">Start: ${formatNice(start)}<br>End: ${formatNice(end)}</div>`);
    lines.push(`<div class="small">Break minutes: ${s.breakMinutes} · Worked minutes: ${s.workedMinutes}</div>`);
    lines.push(`<div class="divider"></div>`);
    if(br.length){
      lines.push(`<div><strong>Breaks</strong></div>`);
      lines.push(`<ul>`);
      for(const b of br){
        const mins=minsBetween(new Date(b.startAt), new Date(b.endAt));
        lines.push(`<li>${escapeHtml(b.type)}: ${formatNice(new Date(b.startAt))} to ${formatNice(new Date(b.endAt))} (${mins} min)</li>`);
      }
      lines.push(`</ul>`);
    }else{
      lines.push(`<div class="note">No breaks recorded.</div>`);
    }
    lines.push(`<div class="divider"></div>`);
    lines.push(`<div class="small">Signature captured: ${s.signatureCaptured ? "Yes" : "No"}</div>`);
    return lines.join("");
  }

  historySearch.addEventListener("input", ()=>renderHistory());
  historyDate.addEventListener("change", ()=>renderHistory());
  btnHistoryClearFilters.addEventListener("click", ()=>{
    historySearch.value="";
    historyDate.value="";
    renderHistory();
  });

  detailDialog.addEventListener("close", async ()=>{
    if(detailDialog.returnValue !== "delete") return;
    const id = btnDeleteShift.dataset.shiftId;
    if(!id) return;
    if(confirm("Delete this shift and its breaks?")){
      await deleteShift(id);
      await renderHistory();
      setStatus("Shift deleted");
    }
  });

  // ---------- Export ----------
  btnExportShifts.addEventListener("click", async ()=>{
    const ev = (exportEvent.value||"").trim().toLowerCase();
    const from = (exportFrom.value||"").trim();
    const to = (exportTo.value||"").trim();
    const shifts = await getAll("shifts");
    const filtered = shifts.filter(s=>{
      if(ev && s.event.toLowerCase() !== ev) return false;
      if(from && s.date < from) return false;
      if(to && s.date > to) return false;
      return true;
    }).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    const header = ["EntryID","Event","Date","Name","ShiftStart","ShiftEnd","TotalShiftMinutes","BreakMinutes","WorkedMinutes","SignatureCaptured","CreatedAt"];
    const rows = [header.join(",")];
    for(const s of filtered){
      const start=new Date(s.startAt);
      const end=new Date(s.endAt);
      const total = msToMins(s.endAt - s.startAt);
      rows.push([
        s.id,
        s.event,
        s.date,
        s.name,
        start.toISOString(),
        end.toISOString(),
        total,
        s.breakMinutes ?? "",
        s.workedMinutes ?? "",
        s.signatureCaptured ? "Yes" : "No",
        new Date(s.createdAt).toISOString()
      ].map(escapeCsv).join(","));
    }
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    downloadText(`Shifts-${stamp}.csv`, rows.join("\n"));
  });

  btnExportBreaks.addEventListener("click", async ()=>{
    const ev = (exportEvent.value||"").trim().toLowerCase();
    const from = (exportFrom.value||"").trim();
    const to = (exportTo.value||"").trim();
    const breaks = await getAll("breaks");
    const filtered = breaks.filter(b=>{
      if(ev && (b.event||"").toLowerCase() !== ev) return false;
      if(from && b.date < from) return false;
      if(to && b.date > to) return false;
      return true;
    }).sort((a,b)=>a.startAt-b.startAt);

    const header = ["EntryID","Event","Date","BreakType","BreakStart","BreakEnd","BreakMinutes"];
    const rows = [header.join(",")];
    for(const b of filtered){
      const mins = msToMins(b.endAt - b.startAt);
      rows.push([
        b.shiftId,
        b.event || "",
        b.date,
        b.type,
        new Date(b.startAt).toISOString(),
        new Date(b.endAt).toISOString(),
        mins
      ].map(escapeCsv).join(","));
    }
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    downloadText(`Breaks-${stamp}.csv`, rows.join("\n"));
  });

  // ---------- Settings ----------
  btnWipeAll.addEventListener("click", async ()=>{
    if(confirm("Delete ALL shifts and breaks on this iPad? This cannot be undone.")){
      await wipeAll();
      activeShift=null; activeBreak=null; breaksDraft=[];
      await refreshAutocomplete();
      await loadActiveShiftBanner();
      showView("new");
      setStatus("All data deleted");
      alert("All data deleted.");
    }
  });

  // ---------- Init ----------
  async function init(){
    db = await openDb();
    updateOfflineBanner();
    await refreshAutocomplete();

    // defaults
    const today = new Date();
    dateInput.value = toDateInputValue(today);
    startInput.value = toDTInputValue(today);
    endInput.value = "";

    // restore active shift draft if exists
    const draft = await metaGet("activeShift");
    if(draft && draft.activeShift){
      btnResumeActive.hidden=false;
      btnResumeActive.onclick=async ()=>{
        activeShift = draft.activeShift;
        activeBreak = draft.activeBreak;
        breaksDraft = draft.breaksDraft || [];
        await showActiveShift();
      };
    }

    showView("new");
    setStatus("Ready");
  }

  init().catch(err=>{
    console.error(err);
    alert("App failed to start. If this keeps happening, refresh the page.");
  });

})(); 
